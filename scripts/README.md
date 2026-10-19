# scripts/

Repository maintenance scripts.

- `backup.ps1` — creates a clean `bathke-aegis-bootstrap.zip` (no `.git`, `node_modules`, build output or secrets).
- `test-infra.mjs` (`npm run test:infra`) — builds and starts the real Compose stack as an isolated project
  (`aegis-infra-test`, own volume and networks, host port 18080), then checks: `compose config`, empty
  database, MySQL healthy, all migrations applied by `migrate`, `/api/health` and `/` through Nginx,
  reverse-proxy routing, security headers and CSP, that only Nginx publishes a port, network membership and
  `internal` flags, isolation (web/nginx cannot reach MySQL, API has no internet egress), the named MySQL
  volume and persistence across `docker compose down`/`up`. It always runs `down -v` on the test project
  only (also on failure or Ctrl+C). Needs Docker with Compose v2; does not read `.env` — it generates
  disposable test credentials in a temporary file and never prints them. Overrides:
  `AEGIS_INFRA_HTTP_PORT`, `AEGIS_INFRA_PROJECT`.
