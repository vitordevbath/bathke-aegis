# Aegis API

Fastify + TypeScript backend.

## Layers (`src/`)

| Layer | Purpose | Current content |
| --- | --- | --- |
| `domain/` | Entities | `User`, `Workspace`, `Membership`, `Host`, `DetectionRule`, `Incident`, `Investigation`, `TelemetryEvent` (immutable, SHA-256 fingerprint) (value objects, errors, the rule schema and the incident and investigation lifecycle tables come from `@aegis/domain`) |
| `application/` | Use cases and ports (interfaces) | auth/user use cases; host, detection rule, incident and investigation CRUD use cases; `EventIngestionService` (transport-independent) and event queries; `WorkspaceAccess`; `Page<T>`; repository, unit-of-work, hasher and token ports |
| `infrastructure/` | Adapters | Drizzle/MySQL repositories + transactional unit of work, migrations runner, Argon2id, jose JWT |
| `presentation/` | HTTP routes, request validation, error mapping | `/health`, `/auth/*`, `/users/me`, `/workspaces/:workspaceId/hosts[/:hostId]`, `/workspaces/:workspaceId/detection-rules[/:ruleId]`, `/workspaces/:workspaceId/incidents[/:incidentId]`, `/workspaces/:workspaceId/investigations[/:investigationId]`, `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest`, `GET /workspaces/:workspaceId/events[/:eventId]`; bearer preHandler; single error handler (`InvalidStateError` → 409 `INVALID_STATE`) |
| `shared/` | Cross-cutting config | `env.ts` (Zod-validated env; strong `JWT_SECRET` required) |

`composition-root.ts` wires use cases to production adapters (`main.ts`) or to test doubles.

Dependency direction: `presentation → application → domain`; `infrastructure` implements application ports.

## Scripts

```bash
npm run dev -w @aegis/api        # tsx watch
npm run test -w @aegis/api       # vitest
npm run build -w @aegis/api
npm run db:generate -w @aegis/api   # new SQL migration in drizzle/ from schema.ts
npm run db:migrate -w @aegis/api    # apply pending migrations (needs DATABASE_URL)
```

Integration tests (`test/integration/*`) run only when `TEST_DATABASE_URL` points to a
disposable MySQL server whose user can create databases; each run creates a fresh database,
applies all migrations from zero and drops it afterwards. CI provides one. `vitest.config.ts` raises the
hook timeout to 60 s because the suites migrate their databases in parallel.
