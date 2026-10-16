# Roadmap

| Fase | Nome | Escopo | Status |
| --- | --- | --- | --- |
| 00 | Foundation | Monorepo, web/api base, health, contracts, Docker/Nginx, MCP, docs, CI | IN_PROGRESS (BF 00) |
| 01 | Academic Core | Tratamento de erros, paginação genérica, base de repositórios/use cases | TODO |
| 02 | Authentication & User Management | Cadastro, login, JWT, Argon2, validação de email/CPF/senha, edição do próprio usuário | TODO |
| 03 | CRUD Domain | Workspace + Membership (ADR-009); Hosts, Detection Rules, Incidents, Investigations por workspace, com relações e paginação | TODO |
| 04 | Event Model | Schema de eventos normalizados, ingestão via API | TODO |
| 05 | Aegis Collector | Agente Rust: buffering, batching, envio autenticado | TODO (Linux) |
| 06 | eBPF Telemetry | Probes Aya: exec/exit, parent/child, arquivo, rede (sem payload) | TODO (Linux) |
| 07 | Detection Engine | Avaliação de regras sobre eventos | TODO |
| 08 | Correlation & Incidents | Agrupamento de alertas em incidentes, timeline | TODO |
| 09 | Aegis Verified Core | Ada/SPARK + GNATprove para transições e severidade | TODO (Linux) |
| 10 | x86-64 Experiments | NASM + benchmarks vs referência | TODO (Linux) |
| 11 | AI Assistance | Resumo/triagem de incidentes via API externa | TODO |
| 12 | Observability | Métricas, logs estruturados, tracing | TODO |
| 13 | Hardening | TLS, rate limiting, headers, revisão de segurança | TODO |
| 14 | Presentation / Demo | Workspace AEGIS DEMO, pareamento temporário de laboratório, roteiro mapeado à rubrica | TODO |
