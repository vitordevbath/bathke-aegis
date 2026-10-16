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

## ADR-009 — Workspace será a fronteira principal de organização dos recursos
**Decisão:** `User → Membership → Workspace → (Hosts, Detection Rules, Incidents, Investigations)`.
**Motivo:** suportar uso individual, equipes e workspace de demonstração sem remodelar dados.
**Consequência:** autorização verifica membership no workspace do recurso. Ainda não implementado em código ou banco.

## ADR-010 — Linux será a plataforma de referência inicial, mas a arquitetura não será Linux-only
**Decisão:** primeiro Collector é Linux (Rust + Aya/eBPF). A API recebe eventos por um contrato de telemetria independente de SO.
**Consequência:** campos específicos de plataforma ficam em extensões do evento, não no núcleo do contrato; collectors Windows/macOS podem ser adicionados sem alterar o pipeline.

## ADR-012 — O produto terá workspace de demonstração seguro e preferencialmente somente leitura
**Decisão:** workspace "AEGIS DEMO" com dados gerados/curados para avaliação sem instalar nada.
**Consequência:** nunca contém telemetria real; escrita bloqueada ou restrita para visitantes.

## ADR-013 — Pareamento temporário será o mecanismo futuro para demonstrações com hosts de laboratório
**Decisão:** hosts são adicionados por código/token temporário gerado no painel.
**Consequência:** tokens expiram, são revogáveis, limitados a ingestão em um workspace e auditados.
