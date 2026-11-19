# Bathke Aegis

Instructions for any agent (human or AI) working in this repository.

## Mission

Build Bathke Aegis, an experimental, **defensive** XDR/SIEM web platform, while keeping
every academic rubric requirement explicitly demonstrable (`docs/RUBRICA.md`).
Quality over quantity: no fake features, no fake architecture, no TODO marked as PASS.

## Architecture

- **Aegis Core** (must always work): `apps/web`, `apps/api`, `packages/*`, MySQL, Nginx, Docker.
- **Aegis Labs** (optional, experimental): `native/*`, AI integration. Labs must never break Core.

| | CURRENT | PLANNED |
| --- | --- | --- |
| Web | incident reconstruction on the incident detail (timeline with history, alerts and nearby events; relation graph in plain SVG, ADR-054); `/alertas` (read-only list/detail, alerts on incident and rule detail, ADR-053); AEGIS DEMO read-only for viewers (banner, write actions hidden, `ManagerOnly` on create/edit routes, ADR-052); public site at `/` (WebGL contour field, lazy chunk, ADR-050), auth pages, `/dashboard` (attention-first: active incidents, silent hosts, recent events, real Collector state), `/perfil`, `/hosts`, `/regras`, `/incidentes` and `/investigacoes` (list/create/detail/edit), `/eventos` (read-only list/detail), host detail with Collector communication state, pairing (generate/cancel code), credential rotation/revocation and history; AuthContext, WorkspaceContext | investigation-level reconstruction |
| API | health, register/login (Argon2id + JWT), `GET/PUT /users/me`, Hosts, Detection Rules, Incidents and Investigations CRUD per workspace (enabled rules are evaluated on ingestion by the detection engine; incidents are manual or opened by the engine; investigations group incidents and close only with a human conclusion); alerts read-only, correlated into DETECTION_ENGINE incidents (ADR-053); immutable incident activity log written with each change and `GET …/incidents/:id/timeline` (ADR-054); Event Contract v1 ingestion (machine credentials, idempotent batches, revocation re-checked in the transaction), event list/detail; Collector pairing (code cancel, persistent per-IP limits), machine credentials, rotation and revocation; machine heartbeat with derived ONLINE/OFFLINE; AEGIS DEMO provisioning, VIEWER for every account and a simulator that drives demo hosts through the machine use cases (ADR-052) | investigation-level timeline |
| Data | `users`, `workspaces`, `memberships`, `hosts`, `detection_rules`, `detection_rule_targets`, `incidents`, `incident_hosts`, `incident_detection_rules`, `investigations`, `investigation_incidents`, `events` (append-only), `pairing_challenges`, `machine_credentials`, `rate_limit_counters`, `alerts`, `incident_activities` (14 versioned migrations, Drizzle repositories) | remaining resource tables per workspace |
| Tooling | Aegis MCP, CI (typecheck/build/test, `npm run test:infra` on the real Compose stack, Rust fmt/clippy/test/build, `npm run test:collector-e2e` with the real Collector binary) | rubric engine expansion |
| Native | `native/aegis-collector`: Rust CLI run in the foreground by the user (pair, run, status, replace-credential, unpair), SYSTEM events, heartbeat, SQLite queue | eBPF (PROCESS/NETWORK), SPARK, NASM |

Details: `docs/ARCHITECTURE.md`; event contract: `docs/EVENTOS.md` (events are immutable — never add update/delete paths, command lines, environment or payload capture). Check `aegis_architecture_info` (Aegis MCP) before claiming something exists.

## Repository Map

```
apps/web            React + TS + Vite (src/app, pages, features, components, lib, styles, types)
apps/api            Fastify + TS (src/presentation, application, domain, infrastructure, shared; drizzle/ migrations)
packages/contracts  transport DTOs shared by web and api — never domain entities
packages/domain     Entity, DomainError hierarchy, Email, Cpf, PasswordPolicy, host rules and presence policy, shared severity, detection rule schema v1, incident and investigation lifecycles, Event Contract v1 (event registry + field catalog shared with rules), machine scopes
tools/aegis-mcp     restricted MCP server
native/             aegis-collector (Rust, CURRENT); planned low-level components (README only)
agents/skills/      backend-engineering, frontend-engineering, security-review
infra/              Dockerfiles, Nginx
docs/               architecture, roadmap, rubric, security, decisions
```

## Development Workflow

1. Read the relevant skill in `agents/skills/` for the area you touch.
2. Make the smallest change that delivers real behavior.
3. Run `npm run typecheck && npm run build && npm test` from the root; for the Collector, `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` in `native/aegis-collector`.
4. Update `docs/RUBRICA.md` only with real evidence (file, endpoint, test).
5. Commit one logical change.

## Testing Rules

- Vitest for api and MCP; API routes are tested with `app.inject` (no open port).
- Test behavior and boundaries (validation, authorization, 404, protected paths), not getters.
- Every security policy (path guard, redaction, ownership) needs tests.
- Never put real secrets in fixtures; assemble sensitive-looking strings at runtime if needed.

## Security Rules

- Defensive scope only; see Non-Goals in `docs/SECURITY.md`. Refuse keylogging, credential capture, evasion, exploitation, hidden persistence.
- Never print, log or commit tokens, passwords, API keys, private keys or credentialed connection strings.
- Validate all external input with Zod at the presentation boundary.
- Authorization is enforced server-side; the frontend is never trusted.
- Human and machine identity never substitute each other: user routes take a user JWT, machine routes take a machine credential with an explicit scope (ADR-037, ADR-040).
- Pairing codes and machine tokens exist in plain form only in the single response that delivers them: stored as hashes, never logged, never in browser storage.

## Protected Resources

Agents **must not read, open, print or copy**:

```
.env
.env.*          (exception: .env.example)
secrets/**
credentials/**
*.pem  *.key  *.p12  *.pfx
```

Never copy a secret into logs, README, docs, fixtures, tests, commits, issues or MCP output.
Aegis MCP enforces this in `tools/aegis-mcp/src/policy/protected-paths.ts`.

## Dependency Rules

- No dependency without a current use in code. No Express, Nx, Turborepo, Lerna, heavy CSS frameworks.
- Prefer well-maintained packages; pin through `package-lock.json`; run `npm ci` in CI.
- Graph/timeline libraries (e.g. Cytoscape.js) only when a screen needs more than the plain SVG graph of ADR-054.
- Native toolchains never become prerequisites for Core builds or the main CI.

## Documentation Rules

- Always distinguish **CURRENT/IMPLEMENTED** from **PLANNED**. Write "planned eBPF telemetry layer", never "uses eBPF" until it runs.
- Never claim formal verification before GNATprove proves it.
- Record significant decisions in `docs/DECISIONS.md`.

## Git Rules

- Do not change Git identity (`git config user.name/email`); use the owner's configured identity. If none is configured, stop before committing.
- No backdating, timestamp manipulation, empty commits or history rewriting to inflate history.
- Never force-push `main`.

## Commit Rules

- Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore` with optional scope (`web`, `api`, `contracts`, `domain`, `mcp`, `agents`).
- One small logical change per commit; do not split trivial changes artificially.
- **No AI tool attribution** in commits, tags, PRs, docs or comments (no `Co-Authored-By` for AI tools, no "Generated with ...").

## Experimental Components

| Path | Component | Status | Toolchain |
| --- | --- | --- | --- |
| `native/aegis-collector` | Aegis Collector | CURRENT (BF 08): SYSTEM events, heartbeat, queue; own CI jobs (ADR-049) | Rust stable |
| `native/ebpf` | eBPF telemetry | PLANNED | Rust + Aya |
| `native/spark-core` | Aegis Verified Core | PLANNED | Ada/SPARK, GNATprove |
| `native/asm64` | x86-64 experiments | PLANNED | NASM, System V AMD64 ABI |

Setup: `docs/LINUX_SETUP.md`. The Collector never becomes a dependency of the Core builds or Docker images (`.dockerignore` excludes `native/`); the planned components are developed on the Linux workstation only.
