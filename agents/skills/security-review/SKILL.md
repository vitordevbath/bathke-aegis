---
name: security-review
description: Review changes to Bathke Aegis for secret exposure, auth/authorization flaws, network exposure and defensive-scope violations before they are committed.
---

# Security Review

## Purpose

Catch security regressions and scope violations before commit. Bathke Aegis is a
security product: its own repository must meet the bar it claims.

## Responsibilities

- Secrets: nothing sensitive in code, docs, fixtures, logs, commits or MCP output.
- AuthN/AuthZ: every protected route authenticates; every write checks ownership.
- Input: Zod validation at the boundary; no raw SQL string concatenation.
- Topology: only `nginx` publishes ports; `mysql` never publishes 3306.
- Scope: telemetry is metadata-only and authorized; reject offensive capabilities.
- MCP: no arbitrary shell, no arbitrary file read, protected paths denied.

## Scope

All changes. Primary files: `compose.yaml`, `infra/**`, `apps/api/src/**`, `tools/aegis-mcp/src/policy/**`,
`.gitignore`, `.dockerignore`, `.env.example`, future `native/**`.

## Relevant Files

- `docs/SECURITY.md` — threat model and Non-Goals
- `tools/aegis-mcp/src/policy/protected-paths.ts`, `redact.ts`
- `tools/aegis-mcp/src/tools/security-check.ts`
- `compose.yaml`, `infra/nginx/nginx.conf`

## Allowed Actions

- Run the validation commands; read diffs (`git diff`, `git diff --staged`).
- Propose or apply fixes that reduce exposure; add tests for security policies.
- Block a commit and report the finding (file, line, rule — never the secret value).

## Forbidden Actions

- Reading `.env`, `.env.*` (except `.env.example`), `secrets/**`, `credentials/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.
- Printing a discovered secret, even partially.
- Adding offensive tooling: keylogging, credential capture, evasion, exploitation, hidden persistence.
- Weakening a guard (allowlist, redaction, internal network) without an ADR in `docs/DECISIONS.md`.

## Validation Commands

```bash
npm test -w @aegis/mcp                              # path guard + redaction tests
git diff --staged --name-only                       # no protected file staged
git check-ignore -v .env secrets/x a.pem            # must all be ignored
MYSQL_PASSWORD=x MYSQL_ROOT_PASSWORD=y docker compose config | grep -n "published"   # only nginx
```

Plus the `aegis_security_check` tool from Aegis MCP.

## Completion Criteria

- No protected file staged; `aegis_security_check` reports no findings.
- Only `nginx` has `ports:`; data/application networks remain `internal`.
- New endpoints have auth + ownership tests (or are explicitly public, like `/health`).
- No Non-Goal capability introduced.
- Findings documented with file/line and fix, or explicitly accepted in `docs/DECISIONS.md`.
