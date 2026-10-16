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
| Aegis Web | `apps/web` | Rotas `/`, `/login` (validação client-side, sem autenticação), `/dashboard` (cards zerados, status real da API via `/api/health`) |
| Aegis API | `apps/api` | `GET /health`; env validado com Zod; schema Drizzle `users` + factory de cliente **não conectados** a nenhuma rota |
| Contracts | `packages/contracts` | `HealthResponse` |
| Domain | `packages/domain` | `Entity<TId>`, `DomainError` |
| MySQL | `compose.yaml` | MySQL 8.4 com healthcheck e volume; sem migrations |
| Nginx | `infra/nginx` | Reverse proxy + headers básicos |
| Aegis MCP | `tools/aegis-mcp` | Servidor MCP stdio, 7 ferramentas, allowlist e secret guard |

### Camadas da API

```
presentation  → rotas HTTP, validação de request, mapeamento de erros
application   → casos de uso + ports (interfaces)          [vazio]
domain        → entidades, value objects, erros de domínio [vazio]
infrastructure→ adapters (Drizzle/MySQL, hash, JWT) implementam ports
shared        → configuração transversal
```

Dependências apontam para dentro: `presentation → application → domain`.
`infrastructure` depende de `application` (implementa ports), nunca o contrário.
Diretórios só são criados quando há código real.

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

### Fronteira de dados (planejada)

Todo recurso de segurança pertence a um **Workspace**; usuários acessam workspaces
por **Membership** (ADR-009). Ver [PRODUTO.md](PRODUTO.md#modelo-de-workspace).
