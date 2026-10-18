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
| Web | `/`, `/login`, `/cadastro`, `/dashboard`, `/perfil`; AuthContext | CRUD screens, timeline, graph |
| API | health, register/login (Argon2id + JWT), `GET/PUT /users/me` | 4 CRUDs, events, detection |
| Data | `users`, `workspaces`, `memberships` (versioned migrations, Drizzle repositories) | resource tables per workspace |
| Tooling | Aegis MCP, CI (typecheck/build/test) | rubric engine expansion |
| Native | READMEs only | collector, eBPF, SPARK, NASM |

Details: `docs/ARCHITECTURE.md`. Check `aegis_architecture_info` (Aegis MCP) before claiming something exists.

## Repository Map

```
apps/web            React + TS + Vite (src/app, pages, features, components, lib, styles, types)
apps/api            Fastify + TS (src/presentation, application, domain, infrastructure, shared; drizzle/ migrations)
packages/contracts  transport DTOs shared by web and api — never domain entities
packages/domain     Entity, DomainError hierarchy, Email, Cpf, PasswordPolicy
tools/aegis-mcp     restricted MCP server
native/             planned low-level components (README only)
agents/skills/      backend-engineering, frontend-engineering, security-review
infra/              Dockerfiles, Nginx
docs/               architecture, roadmap, rubric, security, decisions
```

## Development Workflow

1. Read the relevant skill in `agents/skills/` for the area you touch.
2. Make the smallest change that delivers real behavior.
3. Run `npm run typecheck && npm run build && npm test` from the root.
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
- Graph/timeline libraries (e.g. Cytoscape.js) only when the screen using them is built.
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
| `native/aegis-collector` | Aegis Collector | PLANNED | Rust |
| `native/ebpf` | eBPF telemetry | PLANNED | Rust + Aya |
| `native/spark-core` | Aegis Verified Core | PLANNED | Ada/SPARK, GNATprove |
| `native/asm64` | x86-64 experiments | PLANNED | NASM, System V AMD64 ABI |

Setup: `docs/LINUX_SETUP.md`. These are developed on the Linux workstation only.
