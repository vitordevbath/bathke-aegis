# Aegis MCP

Model Context Protocol server (stdio) for agents working on Bathke Aegis.

## Tools

| Tool | What it does |
| --- | --- |
| `aegis_project_structure` | Directory tree of allowlisted paths |
| `aegis_architecture_info` | CURRENT vs PLANNED components |
| `aegis_rubric_status` | Evidence-based rubric status (TODO / IN_PROGRESS / PASS / BLOCKED) |
| `aegis_run_typecheck` | `npm run typecheck` (fixed command, no arguments) |
| `aegis_run_tests` | `npm run test` (fixed command, no arguments) |
| `aegis_security_check` | Secret-pattern scan + `.gitignore` check; reports file/line/rule, never values |
| `aegis_dependency_info` | Declared dependencies per workspace |

The rubric evaluator checks implementation evidence for UI componentization,
domain modeling, inheritance/abstract classes, substitutable repository ports,
TypeScript `any` via the TypeScript AST, Compose/volume topology and agent file
guardrails. Criteria whose quality needs architectural judgment (getter utility,
SOLID responsibility, Open/Closed, Liskov and naming consistency) report
`IN_PROGRESS` for manual review; repository text alone never upgrades them to PASS.

## Security model

- **No shell tool.** Only the two fixed npm scripts above can run.
- **No arbitrary reads.** Every path goes through `resolveRepoPath` (`src/policy/protected-paths.ts`):
  must stay inside the repo, be under an allowlisted top-level directory/file, and not be protected.
- **Protected:** `.env`, `.env.*` (except `.env.example`), `secrets/`, `credentials/`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.
- **Output redaction:** script output passes through `redactSecrets` before being returned.

## Usage

```bash
npm run build -w @aegis/mcp
```

Client configuration (e.g. `.mcp.json`):

```json
{
  "mcpServers": {
    "aegis": { "command": "node", "args": ["tools/aegis-mcp/dist/server.js"] }
  }
}
```
