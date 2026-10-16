# Aegis API

Fastify + TypeScript backend.

## Layers (`src/`)

| Layer | Purpose | Current content |
| --- | --- | --- |
| `domain/` | Entities, value objects, domain errors | empty — arrives with BF 02 (User) |
| `application/` | Use cases and ports (interfaces) | empty |
| `infrastructure/` | Adapters: Drizzle/MySQL, hashing, JWT | Drizzle schema (`users`) + client factory, not yet wired |
| `presentation/` | HTTP routes, request validation, error mapping | `GET /health` |
| `shared/` | Cross-cutting config | `env.ts` (Zod-validated env) |

Dependency direction: `presentation → application → domain`; `infrastructure` implements application ports.

## Scripts

```bash
npm run dev -w @aegis/api        # tsx watch
npm run test -w @aegis/api       # vitest
npm run build -w @aegis/api
```
