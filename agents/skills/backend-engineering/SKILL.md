---
name: backend-engineering
description: Implement or change Aegis API (Fastify + TypeScript + Drizzle/MySQL) following the layered architecture, validation and testing rules of Bathke Aegis.
---

# Backend Engineering — Aegis API

## Purpose

Deliver API behavior (auth, CRUDs, events) that is correct, layered, tested and
traceable to the rubric.

## Responsibilities

- Model entities and domain errors in `domain/`; orchestration in `application/` use cases.
- Define ports (repository interfaces) in `application/`, implement them in `infrastructure/`.
- Keep Fastify routes thin: parse with Zod → call use case → map result/error to HTTP.
- Expose transport types only via `@aegis/contracts`.
- Enforce authentication and ownership server-side for every write.

## Scope

`apps/api/**`, `packages/contracts/**`, `packages/domain/**`, Drizzle schema and migrations.
Not in scope: `apps/web`, `native/*`, infra (coordinate with security-review for compose/nginx).

## Relevant Files

- `apps/api/src/presentation/http/app.ts` — `buildApp()`, route registration
- `apps/api/src/presentation/http/routes/` — one file per resource
- `apps/api/src/shared/env.ts` — env schema (add new variables here and to `.env.example`)
- `apps/api/src/infrastructure/db/schema.ts`, `client.ts`, `apps/api/drizzle.config.ts`
- `packages/domain/src/` — `Entity`, `DomainError`
- `apps/api/test/` — `app.inject` tests

## Allowed Actions

- Add routes, use cases, entities, repositories, migrations, tests.
- Add a dependency when code uses it in the same change (e.g. `argon2`, `@fastify/jwt`).
- Map `DomainError.code` to HTTP status in a single error handler.

## Forbidden Actions

- Express, or business logic inside route handlers.
- `any`, non-null assertions to silence `noUncheckedIndexedAccess`, disabling strict flags.
- Returning Drizzle rows or entities directly as responses (always map to a contract).
- Storing plain or reversibly-encrypted passwords; logging request bodies with credentials.
- Reading `.env` or other protected resources.
- Creating empty abstraction layers "for later".

## Validation Commands

```bash
npm run typecheck
npm run test -w @aegis/api
npm run build
```

## Completion Criteria

- Endpoint has Zod validation, auth/ownership checks where applicable, 404 for missing resources, pagination for lists.
- Tests cover happy path, validation failure, unauthorized/forbidden and not-found.
- Contract type added/updated in `@aegis/contracts`.
- `docs/RUBRICA.md` updated with implementation file, endpoint and test as evidence.
- All validation commands pass.
