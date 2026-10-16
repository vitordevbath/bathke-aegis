# Architecture Decision Log

## ADR-001 — Use npm workspaces
**Decisão:** monorepo com npm workspaces (`apps/*`, `packages/*`, `tools/*`).
**Motivo:** suficiente para poucos pacotes; sem Nx/Turborepo/Lerna.

## ADR-002 — Use React + TypeScript + Vite
**Decisão:** SPA com React Router, TanStack Query, React Hook Form e Zod. CSS próprio via tokens; sem framework CSS por enquanto.

## ADR-003 — Use Fastify
**Decisão:** Fastify em vez de Express: tipagem melhor, `inject` para testes, plugins encapsulados.

## ADR-004 — Use MySQL due to academic requirement
**Decisão:** MySQL 8.4 com Drizzle ORM. Requisito da rubrica.

## ADR-005 — Expose only Nginx in final container topology
**Decisão:** apenas `nginx` publica porta. `aegis_application` e `aegis_data` são redes `internal`.
**Consequência:** a API não tem egress; será adicionada rede dedicada quando houver integração externa (IA).

## ADR-006 — Keep experimental components optional
**Decisão:** componentes Aegis Labs (Rust, eBPF, SPARK, ASM) nunca são dependência de build/run do Core nem do CI principal.

## ADR-007 — No local LLM requirement
**Decisão:** IA via API externa, opcional. A aplicação funciona integralmente sem IA.

## ADR-008 — Use custom MCP with restricted capabilities
**Decisão:** Aegis MCP próprio em TypeScript com ferramentas fixas, allowlist de caminhos e secret guard; sem shell arbitrário.
