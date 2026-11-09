# Arquitetura

Regra fundamental: **Aegis Labs nunca impede Aegis Core de funcionar.** Componentes
experimentais são opcionais; a aplicação web funciona sem eles.

## CURRENT ARCHITECTURE

```
browser
   │
   ▼
nginx (única porta publicada: ${AEGIS_HTTP_PORT:-8080} → 80)     redes: aegis_edge, aegis_application
   ├── /       → web:80    Nginx servindo o build estático do Vite (SPA fallback)
   └── /api/   → api:3000  Fastify; prefixo /api removido
                    │
                    ▼  rede aegis_data (internal)
                 mysql:3306 (não publicado)
```

| Componente | Local | O que existe |
| --- | --- | --- |
| Aegis Web | `apps/web` | `/`, `/login`, `/cadastro` (públicas); `/dashboard`, `/perfil`, `/hosts`, `/hosts/novo`, `/hosts/:hostId`, `/hosts/:hostId/editar`, `/regras`, `/regras/nova`, `/regras/:ruleId`, `/regras/:ruleId/editar`, `/incidentes`, `/incidentes/novo`, `/incidentes/:incidentId`, `/incidentes/:incidentId/editar`, `/investigacoes`, `/investigacoes/nova`, `/investigacoes/:investigationId`, `/investigacoes/:investigationId/editar`, `/eventos`, `/eventos/:eventId` (somente leitura) (protegidas; pareamento do Collector no detalhe do host; telas de CRUD carregadas sob demanda); `AuthContext`, `WorkspaceContext` (workspace ativo), cliente HTTP central, token em localStorage (ADR-017) |
| Aegis API | `apps/api` | `GET /health`; `POST /auth/register`, `POST /auth/login`; `GET`/`PUT /users/me`; CRUD `/workspaces/:workspaceId/hosts[/:hostId]`, `/workspaces/:workspaceId/detection-rules[/:ruleId]`, `/workspaces/:workspaceId/incidents[/:incidentId]` e `/workspaces/:workspaceId/investigations[/:investigationId]` com paginação; ingestão `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest` (credencial de máquina) e consulta `GET /workspaces/:workspaceId/events[/:eventId]`; pareamento `POST /agent/pair`, `POST …/hosts/:hostId/pairing-codes`, `GET …/hosts/:hostId/pairing`, rotação e revogação em `…/hosts/:hostId/credentials/:credentialId`; Argon2id, JWT, rate limit em `/auth/*`, na ingestão e no pareamento |
| Contracts | `packages/contracts` | DTOs + schemas Zod de auth, usuário, hosts, detection rules, incidents, investigations, events e identidade de máquina; `PaginationQuerySchema` + `PaginatedResponse<T>`; envelope de erro |
| Domain | `packages/domain` | `Entity<TId>`, hierarquia `DomainError`, value objects `Email`, `Cpf`, `PasswordPolicy`, regras do Host, escala de severidade compartilhada, schema v1 de regras de detecção, ciclos de vida de incidentes e investigações e regras de identidade de máquina (ADR-018, ADR-022, ADR-026, ADR-029, ADR-037–041) |
| MySQL | `compose.yaml` | MySQL 8.4; tabelas `users`, `workspaces`, `memberships`, `hosts`, `detection_rules`, `detection_rule_targets`, `incidents`, `incident_hosts`, `incident_detection_rules`, `investigations`, `investigation_incidents`, `events`, `pairing_challenges`, `machine_credentials` via migrations versionadas aplicadas pelo serviço `migrate` (ADR-019) |
| Nginx | `infra/nginx` | Reverse proxy, headers de segurança e CSP estrita |
| Aegis MCP | `tools/aegis-mcp` | Servidor MCP stdio, 7 ferramentas, allowlist e secret guard |

### Camadas da API

```
presentation  → rotas, preHandler de autenticação, error handler, mappers → contracts
application   → use cases (RegisterUser, AuthenticateUser, ResolveAuthenticatedUser,
                GetCurrentUser, UpdateCurrentUser, Create/List/Get/Update/DeleteHost,
                Create/List/Get/Update/DeleteDetectionRule,
                Create/List/Get/Update/DeleteIncident,
                Create/List/Get/Update/DeleteInvestigation),
                RequestPairingCode, RedeemPairingCode, AuthenticateMachine,
                RotateMachineCredential, RevokeMachineCredential, GetHostPairing,
                IngestEventsAsMachine, EventIngestionService,
                WorkspaceAccess (membership/papel), MachineAuthContext, Page<T> + ports
                (repositórios, UnitOfWork, PasswordHasher, TokenService, MachineSecrets)
domain        → User, Workspace, Membership, Host, DetectionRule, Incident, Investigation, TelemetryEvent, PairingChallenge, MachineCredential (value objects/erros/schema/lifecycle vêm de @aegis/domain)
infrastructure→ Drizzle/MySQL (repositórios + UnitOfWork transacional), Argon2id, jose, node:crypto (segredos de máquina)
shared        → env validado com Zod
composition-root.ts → conecta use cases aos adapters (produção ou dublês de teste)
```

Dependências apontam para dentro: `presentation → application → domain`.
`infrastructure` depende de `application` (implementa ports), nunca o contrário.
Diretórios só são criados quando há código real.

### Modelo de dados (CURRENT)

```
users (id UUID, name, email UNIQUE, cpf UNIQUE [11 dígitos], password_hash, created_at, updated_at)
  │ 1
  │        memberships (user_id FK, workspace_id FK, role, created_at)   PK (user_id, workspace_id)
  │ N ───────────────────────────────────── N
workspaces (id UUID, name, kind ∈ personal|demo|organization|lab, created_at, updated_at)
  │ 1
  │ N
hosts (id UUID, workspace_id FK, display_name, description,          ← administrativos (usuário)
       agent_id UNIQUE NULL (id da credencial ativa),                ← preenchido pelo pareamento
       hostname, os_name, os_version, architecture, last_seen_at,     ← fatos do Collector (futuro)
       connection_state ∈ UNPAIRED|PAIRED|ONLINE|OFFLINE,
       created_at, updated_at)   INDEX (workspace_id, created_at, id), UNIQUE (id, workspace_id)
  │ 1                                      │ N (RESTRICT)
  │ N                                      │
detection_rules (id UUID, workspace_id FK, name, description, severity,
       enabled, event_category, scope ∈ ALL_HOSTS|SELECTED_HOSTS,
       definition JSON v1, created_at, updated_at)   INDEX (workspace_id, created_at, id)
  │ 1 (CASCADE)
  │ N
detection_rule_targets (detection_rule_id FK, host_id FK, created_at)   PK (rule, host), INDEX (host_id)

workspaces 1 ── N incidents (id UUID, workspace_id FK CASCADE, title, description TEXT,
       severity, status ∈ OPEN|INVESTIGATING|RESOLVED|CLOSED, origin ∈ MANUAL|DETECTION_ENGINE,
       created_at, updated_at, resolved_at NULL)
       INDEX (workspace_id, created_at, id), INDEX (workspace_id, status, created_at, id)
  │ 1 (CASCADE)                                 │ 1 (CASCADE)
  │ N                                           │ N
incident_hosts (incident_id, host_id FK RESTRICT,     incident_detection_rules (incident_id,
       created_at) PK (incident, host),                      detection_rule_id FK RESTRICT, created_at)
       INDEX (host_id) — mínimo 1 por incidente              PK (incident, rule), INDEX (detection_rule_id) — opcional

workspaces 1 ── N investigations (id UUID, workspace_id FK CASCADE, title, description TEXT,
       conclusion TEXT NULL, status ∈ OPEN|IN_PROGRESS|CLOSED, created_at, updated_at, closed_at NULL)
       INDEX (workspace_id, created_at, id), INDEX (workspace_id, status, created_at, id)
  │ 1 (CASCADE)
  │ N
investigation_incidents (investigation_id, incident_id FK RESTRICT → incidents, created_at)
       PK (investigation, incident), INDEX (incident_id) — mínimo 1 por investigação; N:N
```

Detection rules são **configuração**: ficam armazenadas e validadas, mas nada as avalia
(sem ingestão de eventos, sem Detection Engine). Ver ADR-022 e ADR-023.

Incidents são **registros manuais**: o servidor sempre grava `origin = MANUAL`, o status
segue o ciclo de vida do domínio e as relações com hosts e regras são escolhidas pelo usuário.
Não existem Event, Alert nem Correlation Engine; nada cria incidentes automaticamente.
Ver ADR-024 a ADR-027.

Investigations são **casos humanos** que agrupam um ou mais incidentes do mesmo workspace
(N:N: um incidente pode estar em várias investigações). Não criam telemetria, não executam
regras, não geram alertas e não controlam hosts. A conclusão é escrita por uma pessoa; não
há IA. Um incidente agrupado não pode ser excluído (409). Ver ADR-028 a ADR-031.

Events (CURRENT, BF 06) são **fatos técnicos imutáveis** observados em um host, no formato
OS-independente do Event Contract v1 ([EVENTOS.md](EVENTOS.md)). Não há Collector implementado: a
ingestão exige uma credencial de máquina (BF 07) e chama o `EventIngestionService`, que não conhece
HTTP, JWT nem credenciais. Nada avalia eventos: regras não rodam, alertas e incidentes automáticos
não existem. Ver ADR-032 a ADR-036 e ADR-042.

```
workspaces 1 ── N events (id UUID, workspace_id FK CASCADE, host_id FK RESTRICT, source_event_id,
       schema_version, category, event_type, occurred_at, ingested_at, payload JSON, fingerprint)
       UNIQUE (host_id, source_event_id) — idempotência
       INDEX (workspace_id, occurred_at, id), (workspace_id, host_id, occurred_at, id),
             (workspace_id, category, occurred_at, id)

POST …/hosts/:hostId/events/ingest ─► authenticateMachine ─► IngestEventsAsMachine (escopo + host) ─► EventIngestionService
   valida o lote inteiro (Event Contract v1) ─► 400, nada gravado
   transação: lock do host ─► fingerprints por sourceEventId ─► igual: dedup · diferente: 409, rollback
              ─► INSERT multi-linha dos novos
```

### Identidade de máquina (CURRENT, BF 07)

Uma máquina age em nome do host ao qual foi pareada e somente dentro de seus escopos. Identidade
humana (JWT, `request.currentUser`) e de máquina (credencial opaca, `request.machineAuth`) não se
substituem. Ver ADR-037 a ADR-042. O Collector **não está implementado**; isto é a fundação que ele usará.

```
workspaces 1 ── N hosts 1 ── N pairing_challenges (id, workspace_id, host_id, code_hash UNIQUE,
       created_by FK users RESTRICT, created_at, expires_at, consumed_at, revoked_at,
       open_host_id gerada UNIQUE)   FK (host_id, workspace_id) → hosts CASCADE
hosts 1 ── N machine_credentials (id, workspace_id, host_id, token_hash, token_prefix, scopes JSON,
       created_at, last_used_at, revoked_at, pairing_challenge_id UNIQUE SET NULL,
       rotated_from_credential_id UNIQUE SET NULL, active_host_id gerada UNIQUE)
       FK (host_id, workspace_id) → hosts RESTRICT · workspace CASCADE

OWNER ─► POST …/hosts/:hostId/pairing-codes ─► lock host ─► limite por host ─► revoga código aberto
         ─► grava só o hash ─► 201 { code, expiresAt } (exibido uma vez; o host segue UNPAIRED)
máquina ─► POST /agent/pair { code } ─► transação: lock host ─► relê challenge FOR UPDATE
         ─► consome (UPDATE condicional) ─► cria credencial ─► host PAIRED
         ─► 201 { token, credentialId, workspaceId, hostId, scopes } (uma única vez)
máquina ─► POST …/events/ingest (Bearer) ─► authenticateMachine ─► requireScope ─► requireHost ─► ingestão
```

### Contrato do futuro Aegis Collector (PLANNED)

O Collector ainda não existe; este é o contrato que ele deverá seguir.

1. Recebe do operador o código temporário gerado no painel. Não há instalador nesta etapa.
2. Envia `POST /api/agent/pair` com `{ "code": "<código>" }`, sem nenhum outro campo: workspace e host vêm do servidor.
3. Em `201`, recebe `token`, `credentialId`, `workspaceId`, `hostId` e `scopes`. O `token` não pode ser obtido de novo.
4. Armazena o `token` localmente de forma protegida (arquivo legível só pelo serviço), e nunca o escreve em logs nem o transmite a outros serviços.
5. Envia eventos com `Authorization: Bearer <token>` para `POST /api/workspaces/<workspaceId>/hosts/<hostId>/events/ingest`, no formato do Event Contract v1.

| Resposta | Significado | Ação esperada |
| --- | --- | --- |
| `401` em `/agent/pair` | código inválido, expirado, usado ou revogado (indistinguíveis) | pedir um novo código ao operador |
| `401` na ingestão | credencial inválida, rotacionada ou revogada | parar de enviar e pedir nova credencial |
| `404` na ingestão | URL não corresponde à identidade da credencial | erro de configuração; não repetir |
| `429` | limite atingido | aguardar e tentar de novo |

### Ciclo de vida do incidente (CURRENT)

```
OPEN ──► INVESTIGATING ──► RESOLVED ──► CLOSED (final, somente leitura)
OPEN ──► RESOLVED                       (resolvido sem investigação separada)
RESOLVED ──► INVESTIGATING              (reabertura antes do encerramento)
resolved_at: definido ao entrar em RESOLVED, limpo na reabertura, preservado em CLOSED
transição inválida ─► InvalidIncidentTransitionError ─► 409 INVALID_STATE (campo status)
```

### Ciclo de vida da investigação (CURRENT)

```
OPEN ──► IN_PROGRESS ──► CLOSED (final, somente leitura)
OPEN ──► CLOSED                  (concluída sem fase de análise separada)
IN_PROGRESS ──► OPEN             (análise pausada, caso volta à fila)
conclusion: rascunho opcional enquanto OPEN/IN_PROGRESS; obrigatória (≥ 10 caracteres) para CLOSED
closed_at: definido ao entrar em CLOSED, nunca volta a null
fechar sem conclusão ─► InvestigationConclusionRequiredError ─► 400 VALIDATION_ERROR (campo conclusion)
transição inválida / edição de encerrada ─► 409 INVALID_STATE
```

Somente `personal` e `OWNER` têm comportamento nesta fase; os demais valores são reservados
(ADR-009, ADR-012). Hosts, Detection Rules, Incidents e Investigations pertencem ao workspace, nunca
diretamente ao usuário. Events também pertencem ao workspace, sempre por meio de um host dele.

### Acesso a recursos do workspace (CURRENT)

```
GET /workspaces/:workspaceId/hosts/:hostId
  └─ authenticate (Bearer) ─► WorkspaceAccess.requireMember(user, workspaceId)
       não membro / id inválido ─► 404 "Recurso não encontrado."
       └─ HostRepository.findInWorkspace(workspaceId, hostId) ─► ausente ─► 404
escrita ─► WorkspaceAccess.requireManager (OWNER) ─► senão 403
```

Ver ADR-020 (isolamento) e ADR-021 (campos do Host).

### Fluxo de cadastro e sessão (CURRENT)

```
POST /auth/register ─► Zod (contracts) ─► RegisterUser
                         valida Email/Cpf/PasswordPolicy, checa duplicidade, Argon2id
                         UnitOfWork (transação MySQL): INSERT user → workspace → membership OWNER
                         falha em qualquer passo → ROLLBACK
POST /auth/login    ─► AuthenticateUser ─► JWT { sub, typ, iss, aud, iat, exp }
GET|PUT /users/me   ─► Bearer ─► ResolveAuthenticatedUser (token válido + usuário existente)
web: token em localStorage → AuthContext → GET /users/me ao recarregar → 401 limpa a sessão
```

### Contratos vs domínio

O frontend consome apenas `@aegis/contracts` (DTOs de transporte). Entidades de
domínio nunca são serializadas diretamente.

## TARGET ARCHITECTURE

```
Linux host (autorizado)
   │  eBPF (Rust + Aya)                       PLANNED
   ▼
Aegis Collector (Rust)                        PLANNED
   │  batches autenticados (HTTPS)
   ▼
Aegis API ─► Event Pipeline ─► Detection ─► Correlation ─► Incidents
   │                                                          │
   │                                     Aegis Verified Core (SPARK)  PLANNED
   │                                                          │
   │                                    evidência estruturada ─► IA externa  PLANNED
   ▼
Aegis Web (timeline, grafo de relações, investigações)
```

| Componente planejado | Local | Notas |
| --- | --- | --- |
| Aegis Collector | `native/aegis-collector` | Normalização, buffering, batching, health; apenas Linux autorizado |
| eBPF | `native/ebpf` | Metadados de processo/arquivo/rede; nunca payload, teclado ou senhas |
| Aegis Verified Core | `native/spark-core` | Máquina de estados de incidentes e severidade; só alegamos verificação após GNATprove passar |
| x86-64 | `native/asm64` | Kernels pequenos e medidos, sempre com implementação de referência segura |
| IA | — | API externa; sumariza evidências, nunca as cria ou altera; app funciona sem ela |

Nota: `aegis_application` e `aegis_data` são `internal: true`, portanto a API não
tem saída para a internet. Quando a integração de IA chegar (Fase 11), uma rede de
egress dedicada será adicionada apenas para a API.

### Fronteira de dados

User → Membership → Workspace → Host / DetectionRule / Incident / Investigation / Event já existe (CURRENT), com autorização por membership
no workspace do recurso (ADR-009, ADR-020). Planejado: os demais recursos de segurança
seguem o mesmo caminho. Ver [PRODUTO.md](PRODUTO.md#modelo-de-workspace).

### Contrato de telemetria (planejado)

Collectors de qualquer sistema operacional enviam eventos no mesmo
**Telemetry Event Contract** (futuro `@aegis/contracts`). O pipeline de detecção
não depende de detalhes de um SO específico (ADR-010).
