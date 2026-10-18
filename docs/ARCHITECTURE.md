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
| Aegis Web | `apps/web` | `/`, `/login`, `/cadastro` (públicas); `/dashboard`, `/perfil` (protegidas); `AuthContext`, cliente HTTP central, token em localStorage (ADR-017) |
| Aegis API | `apps/api` | `GET /health`; `POST /auth/register`, `POST /auth/login`; `GET`/`PUT /users/me`; Argon2id, JWT, rate limit em `/auth/*` |
| Contracts | `packages/contracts` | DTOs + schemas Zod de cadastro, login e edição de usuário; envelope de erro |
| Domain | `packages/domain` | `Entity<TId>`, hierarquia `DomainError`, value objects `Email`, `Cpf`, `PasswordPolicy` (ADR-018) |
| MySQL | `compose.yaml` | MySQL 8.4; tabelas `users`, `workspaces`, `memberships` via migrations versionadas aplicadas pelo serviço `migrate` (ADR-019) |
| Nginx | `infra/nginx` | Reverse proxy, headers de segurança e CSP estrita |
| Aegis MCP | `tools/aegis-mcp` | Servidor MCP stdio, 7 ferramentas, allowlist e secret guard |

### Camadas da API

```
presentation  → rotas, preHandler de autenticação, error handler, mappers → contracts
application   → use cases (RegisterUser, AuthenticateUser, ResolveAuthenticatedUser,
                GetCurrentUser, UpdateCurrentUser) + ports (repositórios, UnitOfWork,
                PasswordHasher, TokenService)
domain        → User, Workspace, Membership (value objects/erros vêm de @aegis/domain)
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
```

Somente `personal` e `OWNER` têm comportamento nesta fase; os demais valores são reservados
(ADR-009, ADR-012). Recursos futuros (Hosts, Rules, Incidents, Investigations) pertencerão ao
workspace, não ao usuário.

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

User → Membership → Workspace já existe (CURRENT). Planejado: todo recurso de segurança
pertencerá a um **Workspace**, e a autorização verificará a membership no workspace do
recurso (ADR-009). Ver [PRODUTO.md](PRODUTO.md#modelo-de-workspace).

### Contrato de telemetria (planejado)

Collectors de qualquer sistema operacional enviam eventos no mesmo
**Telemetry Event Contract** (futuro `@aegis/contracts`). O pipeline de detecção
não depende de detalhes de um SO específico (ADR-010).
