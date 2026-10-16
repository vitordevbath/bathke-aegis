---
name: frontend-engineering
description: Implement or change Aegis Web (React + TypeScript + Vite) screens, data fetching and forms using the internal design tokens.
---

# Frontend Engineering — Aegis Web

## Purpose

Build clear, professional security-product screens that demonstrate each rubric
requirement (auth flows, distinct CRUD screens, pagination) and later telemetry views.

## Responsibilities

- Routes in `src/app/router.tsx`; one page component per route in `src/pages/`.
- Feature logic (queries, mutations, schemas) in `src/features/<feature>/`.
- Server state only through TanStack Query; forms through React Hook Form + Zod.
- API access only through `src/lib/api-client.ts` and types from `@aegis/contracts`.
- Styling only through tokens in `src/styles/tokens.css`.

## Scope

`apps/web/**`. Reads `packages/contracts`. Does not change API behavior.

## Relevant Files

- `apps/web/src/app/App.tsx`, `router.tsx`
- `apps/web/src/pages/*`
- `apps/web/src/features/health/use-api-health.ts` — reference pattern for queries
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/styles/tokens.css`, `global.css`
- `apps/web/vite.config.ts` — dev proxy `/api` → `localhost:3000`

## Allowed Actions

- Add pages, features, components, hooks, CSS using existing tokens (add tokens when a new value is genuinely needed).
- Add a library when a screen being built needs it (e.g. Cytoscape.js for the relationship graph).

## Forbidden Actions

- `.js`/`.jsx` files in `src`; `any`.
- Hard-coded colors/spacings outside tokens.
- "Hacker" aesthetics: neon green, Matrix effects, skulls.
- Showing a planned component as working (use `not-configured` state instead).
- Storing JWT or secrets in `localStorage` without a decision recorded in `docs/DECISIONS.md`.
- Trusting client-side validation as the only check.

## Validation Commands

```bash
npm run typecheck -w @aegis/web
npm run build -w @aegis/web
npm run dev:web   # manual check at http://localhost:5173
```

## Completion Criteria

- Screen handles loading, empty, error and success states.
- Forms show field-level validation messages matching server rules.
- Lists support pagination when the API is paginated.
- Typecheck and build pass; screen manually checked at desktop and narrow widths.
- `docs/RUBRICA.md` updated with the screen as evidence where applicable.
