# Arquitetura

Regra fundamental: **Aegis Labs nunca impede Aegis Core de funcionar.** Componentes
experimentais são opcionais; a aplicação web funciona sem eles.

## CURRENT ARCHITECTURE

```
browser                       Aegis Collector (Rust, no host Linux, executado pelo usuário)
   │                                │  HTTPS (HTTP só em loopback) · credencial de máquina
   ▼                                ▼
nginx (única porta publicada: ${AEGIS_HTTP_PORT:-8080} → 80)     redes: aegis_edge, aegis_application
   ├── /       → web:80    Nginx servindo o build estático do Vite (SPA fallback)
   └── /api/   → api:3000  Fastify; prefixo /api removido
                    │
                    ▼  rede aegis_data (internal)
                 mysql:3306 (não publicado)
```

| Componente | Local | O que existe |
| --- | --- | --- |
| Aegis Web | `apps/web` | `/`, `/login`, `/cadastro` (públicas); `/dashboard`, `/perfil`, `/hosts`, `/hosts/novo`, `/hosts/:hostId`, `/hosts/:hostId/editar`, `/regras`, `/regras/nova`, `/regras/:ruleId`, `/regras/:ruleId/editar`, `/incidentes`, `/incidentes/novo`, `/incidentes/:incidentId`, `/incidentes/:incidentId/editar`, `/investigacoes`, `/investigacoes/nova`, `/investigacoes/:investigationId`, `/investigacoes/:investigationId/editar`, `/eventos`, `/eventos/:eventId` (somente leitura) (protegidas; no detalhe do host: estado de comunicação derivado, último heartbeat, eventos recebidos, código de pareamento com cancelamento, rotação, revogação e credenciais anteriores, atualizados periodicamente; telas de CRUD carregadas sob demanda); `AuthContext`, `WorkspaceContext` (workspace ativo), cliente HTTP central, token em localStorage (ADR-017) |
| Aegis API | `apps/api` | `GET /health`; `POST /auth/register`, `POST /auth/login`; `GET`/`PUT /users/me`; CRUD `/workspaces/:workspaceId/hosts[/:hostId]`, `/workspaces/:workspaceId/detection-rules[/:ruleId]`, `/workspaces/:workspaceId/incidents[/:incidentId]` e `/workspaces/:workspaceId/investigations[/:investigationId]` com paginação; ingestão `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest` (credencial de máquina) e consulta `GET /workspaces/:workspaceId/events[/:eventId]`; pareamento `POST /agent/pair`, `POST`/`DELETE …/hosts/:hostId/pairing-codes[/:challengeId]`, `GET …/hosts/:hostId/pairing`, rotação e revogação em `…/hosts/:hostId/credentials/:credentialId`; heartbeat `POST …/hosts/:hostId/heartbeat` (credencial de máquina, escopo `host:heartbeat`); Argon2id, JWT, rate limit em `/auth/*`, na ingestão e no heartbeat (memória) e no pareamento (MySQL, persistente) |
| Contracts | `packages/contracts` | DTOs + schemas Zod de auth, usuário, hosts, detection rules, incidents, investigations, events e identidade de máquina; `PaginationQuerySchema` + `PaginatedResponse<T>`; envelope de erro |
| Domain | `packages/domain` | `Entity<TId>`, hierarquia `DomainError`, value objects `Email`, `Cpf`, `PasswordPolicy`, regras do Host, escala de severidade compartilhada, schema v1 de regras de detecção, ciclos de vida de incidentes e investigações e regras de identidade de máquina (ADR-018, ADR-022, ADR-026, ADR-029, ADR-037–041) |
| MySQL | `compose.yaml` | MySQL 8.4; tabelas `users`, `workspaces`, `memberships`, `hosts`, `detection_rules`, `detection_rule_targets`, `incidents`, `incident_hosts`, `incident_detection_rules`, `investigations`, `investigation_incidents`, `events`, `pairing_challenges`, `machine_credentials`, `rate_limit_counters` via 12 migrations versionadas (0000–0011) aplicadas pelo serviço `migrate` (ADR-019) |
| Nginx | `infra/nginx` | Reverse proxy, headers de segurança e CSP estrita (um snippet compartilhado); HTTPS opcional via `compose.tls.yaml` (ADR-055) |
| Aegis MCP | `tools/aegis-mcp` | Servidor MCP stdio, 7 ferramentas, allowlist e secret guard; `aegis_architecture_info` testado contra o repositório |
| Aegis Collector | `native/aegis-collector` | CLI Rust executada em primeiro plano pelo usuário (sem root, sem serviço, sem eBPF): `pair`, `run`, `status`, `replace-credential`, `unpair`; eventos SYSTEM, heartbeat e fila SQLite local ([README](../native/aegis-collector/README.md), ADR-047–049) |

### Camadas da API

```
presentation  → rotas, preHandler de autenticação, error handler, mappers → contracts
application   → use cases (RegisterUser, AuthenticateUser, ResolveAuthenticatedUser,
                GetCurrentUser, UpdateCurrentUser, Create/List/Get/Update/DeleteHost,
                Create/List/Get/Update/DeleteDetectionRule,
                Create/List/Get/Update/DeleteIncident,
                Create/List/Get/Update/DeleteInvestigation),
                RequestPairingCode, CancelPairingCode, RedeemPairingCode, AuthenticateMachine,
                RotateMachineCredential, RevokeMachineCredential, GetHostPairing,
                RecordHeartbeat, IngestEventsAsMachine, EventIngestionService, PairingThrottle,
                WorkspaceAccess (membership/papel), MachineAuthContext, Page<T> + ports
                (repositórios, UnitOfWork, PasswordHasher, TokenService, MachineSecrets, RateLimitStore)
domain        → User, Workspace, Membership, Host, DetectionRule, Incident, Investigation, TelemetryEvent, PairingChallenge, MachineCredential (value objects/erros/schema/lifecycle vêm de @aegis/domain)
infrastructure→ Drizzle/MySQL (repositórios + UnitOfWork transacional, contadores de rate limit), Argon2id, jose, node:crypto (segredos de máquina, HMAC)
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
       hostname, os_name, os_version, architecture,                  ← fatos do Collector (ainda não informados)
       last_seen_at,                                                 ← último heartbeat, relógio do servidor (BF 08)
       connection_state ∈ UNPAIRED|PAIRED (gravado; ONLINE/OFFLINE são derivados, ADR-043),
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

Detection rules habilitadas são **avaliadas pelo motor de detecção** (BF 10, ADR-053) dentro da
transação de ingestão, sobre cada evento novo da sua categoria e dos hosts do seu escopo. Um evento
que casa gera um **alerta** (tabela `alerts`, migration 0012, imutável, único por regra e evento) e o
alerta é correlacionado a um incidente `DETECTION_ENGINE`: o aberto ou em investigação do último alerta
da mesma regra no mesmo host nos últimos 30 minutos, ou um novo. Regras desabilitadas continuam só
configuração. Ver ADR-022, ADR-023 e ADR-053.

Incidents têm duas origens: `MANUAL` (criados por uma pessoa, relações escolhidas por ela) e
`DETECTION_ENGINE` (abertos pelo motor de detecção, com o host e a regra do alerta, ADR-053). O status
segue o mesmo ciclo de vida do domínio nos dois casos; o trabalho humano acontece no incidente.
Ver ADR-024 a ADR-027.

Cada incidente tem um **histórico imutável** (tabela `incident_activities`, migration 0013, BF 11,
ADR-054): abertura (por uma pessoa ou pelo motor), mudança de status, de severidade e dos demais
campos, entrada, saída e conclusão de investigações. Cada entrada é escrita na mesma transação da
mudança que descreve; editar sem mudar nada não registra nada. `GET …/incidents/:id/timeline` junta
esse histórico aos alertas do incidente, aos eventos dos hosts envolvidos ao redor dele (de 15 min
antes do primeiro fato até a resolução, com limite) e às investigações atuais. O painel desenha a
**linha do tempo** e o **grafo de relações** (SVG próprio, sem biblioteca) a partir dessa única leitura.

```
incidents 1 ── N incident_activities (id, workspace_id FK CASCADE, incident_id FK CASCADE, kind,
       actor USER | DETECTION_ENGINE | HISTORY_BACKFILL, actor_user_id FK SET NULL,
       from_value, to_value, investigation_id FK SET NULL, investigation_title, fields JSON, created_at)
       INDEX (incident_id, created_at, id) — sem caminho de update ou delete próprio
```

Investigations são **casos humanos** que agrupam um ou mais incidentes do mesmo workspace
(N:N: um incidente pode estar em várias investigações). Não criam telemetria, não executam
regras, não geram alertas e não controlam hosts. A conclusão é escrita por uma pessoa; não
há IA. Um incidente agrupado não pode ser excluído (409). Ver ADR-028 a ADR-031.

Events (CURRENT, BF 06) são **fatos técnicos imutáveis** observados em um host, no formato
OS-independente do Event Contract v1 ([EVENTOS.md](EVENTOS.md)). Desde o BF 08 o Aegis Collector envia
eventos SYSTEM reais; a ingestão exige uma credencial de máquina (BF 07) e chama o
`EventIngestionService`, que não conhece HTTP, JWT nem credenciais; na mesma transação, o motor de
detecção avalia os eventos novos (BF 10). Ver ADR-032 a ADR-036, ADR-042, ADR-045 e ADR-053.

```
workspaces 1 ── N events (id UUID, workspace_id FK CASCADE, host_id FK RESTRICT, source_event_id,
       schema_version, category, event_type, occurred_at, ingested_at, payload JSON, fingerprint)
       UNIQUE (host_id, source_event_id) — idempotência
       INDEX (workspace_id, occurred_at, id), (workspace_id, host_id, occurred_at, id),
             (workspace_id, category, occurred_at, id)

POST …/hosts/:hostId/events/ingest ─► authenticateMachine ─► IngestEventsAsMachine (escopo + host) ─► EventIngestionService
   valida o lote inteiro (Event Contract v1) ─► 400, nada gravado
   transação: lock do host ─► releitura da credencial FOR SHARE (revogada ─► 401, ADR-045)
              ─► fingerprints por sourceEventId ─► igual: dedup · diferente: 409, rollback
              ─► INSERT multi-linha dos novos
```

### Identidade de máquina (CURRENT, BF 07)

Uma máquina age em nome do host ao qual foi pareada e somente dentro de seus escopos. Identidade
humana (JWT, `request.currentUser`) e de máquina (credencial opaca, `request.machineAuth`) não se
substituem. Ver ADR-037 a ADR-046. O Aegis Collector (BF 08) é o cliente real desta identidade.

```
workspaces 1 ── N hosts 1 ── N pairing_challenges (id, workspace_id, host_id, code_hash UNIQUE,
       created_by FK users RESTRICT, created_at, expires_at, consumed_at, revoked_at,
       open_host_id gerada UNIQUE)   FK (host_id, workspace_id) → hosts CASCADE
rate_limit_counters (scope, subject_hash HMAC, hits, window_expires_at)   PK (scope, subject_hash), INDEX (window_expires_at)
hosts 1 ── N machine_credentials (id, workspace_id, host_id, token_hash, token_prefix, scopes JSON,
       created_at, last_used_at, revoked_at, pairing_challenge_id UNIQUE SET NULL,
       rotated_from_credential_id UNIQUE SET NULL, active_host_id gerada UNIQUE)
       FK (host_id, workspace_id) → hosts RESTRICT · workspace CASCADE

OWNER ─► POST …/hosts/:hostId/pairing-codes ─► lock host ─► limite por host ─► revoga código aberto
         ─► grava só o hash ─► 201 { code, expiresAt } (exibido uma vez; o host segue UNPAIRED)
OWNER ─► DELETE …/hosts/:hostId/pairing-codes/:challengeId ─► lock host ─► challenge FOR UPDATE
         ─► aberto: revoga (UPDATE condicional) · usado/cancelado: nada muda ─► 204 (idempotente)
máquina ─► POST /agent/pair { code } ─► limites persistentes por IP (MySQL, HMAC) ─► 429 + Retry-After
         ─► transação: lock host ─► relê challenge FOR UPDATE
         ─► consome (UPDATE condicional) ─► cria credencial ─► host PAIRED
         ─► 201 { token, credentialId, workspaceId, hostId, scopes } (uma única vez)
máquina ─► POST …/events/ingest (Bearer) ─► authenticateMachine ─► requireScope ─► requireHost ─► ingestão
máquina ─► POST …/hosts/:hostId/heartbeat (Bearer, corpo vazio) ─► requireScope(host:heartbeat) ─► requireHost
         ─► transação: lock host ─► releitura da credencial ─► last_seen_at = relógio do servidor
         ─► 200 { lastSeenAt, heartbeatIntervalSeconds }
GET host ─► connectionState = UNPAIRED | PAIRED (sem heartbeat) | ONLINE (< 90 s) | OFFLINE (derivado, ADR-043)
```

### Aegis Collector (CURRENT, BF 08)

CLI Rust em `native/aegis-collector`, executada explicitamente pelo usuário em primeiro plano, sem
root. Detalhes em [native/aegis-collector/README.md](../native/aegis-collector/README.md).

```
Fedora/Linux
  /proc (boot_id, btime) ──┐
  systemctl list-units ────┼─► Collector ─► fila SQLite (0600, por host, limitada) ─► lotes ≤ 100 ─► POST …/events/ingest
                           │       └─► heartbeat a cada 30 s ─────────────────────────────────────► POST …/hosts/:hostId/heartbeat
  ~/.config/aegis-collector/config.json (0600): servidor, host, credencial de máquina
```

1. `aegis-collector pair --server <URL>` lê o código do terminal sem eco e envia só `{ "code" }` a
   `POST /api/agent/pair`; grava `token`, `credentialId`, `workspaceId`, `hostId` e `scopes` em arquivo
   `0600` que nunca é sobrescrito em silêncio.
2. `aegis-collector run` envia `SYSTEM_BOOT` uma vez por boot e `SYSTEM_SERVICE_STATE_CHANGED` só quando
   um serviço muda (linha de base na primeira leitura), sempre pela fila local; o `sourceEventId` é fixo
   desde a observação, então reenvios são deduplicados pela API (ADR-034).
3. Os eventos saem da fila só após 2xx; o heartbeat atualiza `last_seen_at` e o painel mostra ONLINE.

| Resposta | Comportamento do Collector |
| --- | --- |
| `401` em `/agent/pair` | código inválido, expirado, usado ou cancelado: pedir outro código |
| `401` no heartbeat ou na ingestão | credencial revogada, rotacionada ou inválida: para de transmitir (exit 3), preserva a fila |
| `403` no heartbeat | credencial sem `host:heartbeat` (anterior ao BF 08): desativa só o heartbeat e orienta a rotação |
| `403`/`404` na ingestão | sem escopo ou host divergente: para (exit 4) |
| `409`/`400` | quarentena dos eventos apontados, sem retry infinito |
| `429` | espera `Retry-After` |
| `5xx`, rede | backoff exponencial com jitter (2 s … 5 min) |

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
   │  eBPF (Rust + Aya): PROCESS, NETWORK    PLANNED
   │  /proc + systemctl: SYSTEM              CURRENT (BF 08)
   ▼
Aegis Collector (Rust)                        CURRENT (BF 08): heartbeat, fila, SYSTEM
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
| Aegis Collector — eventos PROCESS/NETWORK | `native/aegis-collector` + `native/ebpf` | O Collector existe (SYSTEM, heartbeat, fila); faltam as fontes eBPF |
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

### Contrato de telemetria

Collectors de qualquer sistema operacional enviam eventos no mesmo **Event Contract v1**
(CURRENT, `@aegis/domain` + `@aegis/contracts`, [EVENTOS.md](EVENTOS.md)); o Collector Linux do BF 08 é
o primeiro a usá-lo. Collectors de outros sistemas e o pipeline de detecção (PLANNED) não dependem de
detalhes de um SO específico (ADR-010).
