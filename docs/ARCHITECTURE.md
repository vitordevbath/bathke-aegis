# Arquitetura

Regra fundamental: **Aegis Labs nunca impede Aegis Core de funcionar.** Componentes
experimentais são opcionais; a aplicação web funciona sem eles.

## CURRENT ARCHITECTURE

```
browser
   │
   ▼
nginx (única porta publicada: 8080 → 80)     redes: aegis_edge, aegis_application
   ├── /       → web:80    Nginx servindo o build estático do Vite (SPA fallback)
   └── /api/   → api:3000  Fastify; prefixo /api removido
                    │
                    ▼  rede aegis_data (internal)
                 mysql:3306 (não publicado)
```

| Componente | Local | O que existe |
| --- | --- | --- |
| Aegis Web | `apps/web` | `/`, `/login`, `/cadastro` (públicas); `/dashboard`, `/perfil`, `/hosts`, `/hosts/novo`, `/hosts/:hostId`, `/hosts/:hostId/editar`, `/regras`, `/regras/nova`, `/regras/:ruleId`, `/regras/:ruleId/editar` (protegidas; telas de CRUD carregadas sob demanda); `AuthContext`, `WorkspaceContext` (workspace ativo), cliente HTTP central, token em localStorage (ADR-017) |
| Aegis API | `apps/api` | `GET /health`; `POST /auth/register`, `POST /auth/login`; `GET`/`PUT /users/me`; CRUD `/workspaces/:workspaceId/hosts[/:hostId]` e `/workspaces/:workspaceId/detection-rules[/:ruleId]` com paginação; Argon2id, JWT, rate limit em `/auth/*` |
| Contracts | `packages/contracts` | DTOs + schemas Zod de auth, usuário, hosts e detection rules; `PaginationQuerySchema` + `PaginatedResponse<T>`; envelope de erro |
| Domain | `packages/domain` | `Entity<TId>`, hierarquia `DomainError`, value objects `Email`, `Cpf`, `PasswordPolicy`, regras do Host e schema v1 de regras de detecção (ADR-018, ADR-022) |
| MySQL | `compose.yaml` | MySQL 8.4; tabelas `users`, `workspaces`, `memberships`, `hosts`, `detection_rules`, `detection_rule_targets` via migrations versionadas aplicadas pelo serviço `migrate` (ADR-019) |
| Nginx | `infra/nginx` | Reverse proxy, headers de segurança e CSP estrita |
| Aegis MCP | `tools/aegis-mcp` | Servidor MCP stdio, 7 ferramentas, allowlist e secret guard |

### Camadas da API

```
presentation  → rotas, preHandler de autenticação, error handler, mappers → contracts
application   → use cases (RegisterUser, AuthenticateUser, ResolveAuthenticatedUser,
                GetCurrentUser, UpdateCurrentUser, Create/List/Get/Update/DeleteHost,
                Create/List/Get/Update/DeleteDetectionRule),
                WorkspaceAccess (membership/papel), Page<T> + ports (repositórios,
                UnitOfWork, PasswordHasher, TokenService)
domain        → User, Workspace, Membership, Host, DetectionRule (value objects/erros/schema vêm de @aegis/domain)
infrastructure→ Drizzle/MySQL (repositórios + UnitOfWork transacional), Argon2id, jose
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
       agent_id UNIQUE NULL, hostname, os_name, os_version,          ← fatos do Collector (futuro)
       architecture, connection_state=UNPAIRED, last_seen_at,
       created_at, updated_at)   INDEX (workspace_id, created_at, id)
  │ 1                                      │ N (RESTRICT)
  │ N                                      │
detection_rules (id UUID, workspace_id FK, name, description, severity,
       enabled, event_category, scope ∈ ALL_HOSTS|SELECTED_HOSTS,
       definition JSON v1, created_at, updated_at)   INDEX (workspace_id, created_at, id)
  │ 1 (CASCADE)
  │ N
detection_rule_targets (detection_rule_id FK, host_id FK, created_at)   PK (rule, host), INDEX (host_id)
```

Detection rules são **configuração**: ficam armazenadas e validadas, mas nada as avalia
(sem ingestão de eventos, sem Detection Engine). Ver ADR-022 e ADR-023.

Somente `personal` e `OWNER` têm comportamento nesta fase; os demais valores são reservados
(ADR-009, ADR-012). Hosts e Detection Rules já pertencem ao workspace; Incidents e Investigations
seguirão o mesmo modelo, nunca vinculados diretamente ao usuário.

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

User → Membership → Workspace → Host já existe (CURRENT), com autorização por membership
no workspace do recurso (ADR-009, ADR-020). Planejado: os demais recursos de segurança
seguem o mesmo caminho. Ver [PRODUTO.md](PRODUTO.md#modelo-de-workspace).

### Contrato de telemetria (planejado)

Collectors de qualquer sistema operacional enviam eventos no mesmo
**Telemetry Event Contract** (futuro `@aegis/contracts`). O pipeline de detecção
não depende de detalhes de um SO específico (ADR-010).
