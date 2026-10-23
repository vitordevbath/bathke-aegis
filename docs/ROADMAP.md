# Roadmap

| Fase | Nome | Escopo | Status |
| --- | --- | --- | --- |
| 00 | Foundation | Monorepo, web/api base, health, contracts, Docker/Nginx, MCP, docs, CI | DONE — base (BF 00–00.7); infraestrutura validada automaticamente no CI (BF 05.5) |
| 01 | Academic Core | Tratamento de erros, paginação genérica, base de repositórios/use cases | DONE — erros, repositórios, use cases, UnitOfWork (BF 01); paginação genérica (BF 02) |
| 02 | Authentication & User Management | Cadastro, login, JWT, Argon2, validação de email/CPF/senha, edição do próprio usuário | DONE (BF 01) |
| 03 | CRUD Domain | Workspace + Membership (ADR-009); Hosts, Detection Rules, Incidents, Investigations por workspace, com relações e paginação | DONE — Workspace pessoal + Membership OWNER (BF 01); Hosts CRUD com paginação e isolamento por workspace (BF 02); Detection Rules CRUD com DSL declarativa e targets por host (BF 03); Incidents CRUD manual com ciclo de vida e relações N:N com hosts e regras (BF 04); Investigations CRUD com relação N:N com incidentes, conclusão obrigatória para encerrar e estado final somente leitura (BF 05). Os quatro CRUDs acadêmicos estão concluídos; novos CRUDs não são planejados |
| 04 | Event Model | Schema de eventos normalizados, ingestão via API | DONE — Event Contract v1 (6 tipos, 3 categorias, OS-independente), Event Store imutável e idempotente, ingestão em lote com autenticação de usuário (laboratório) e navegador de eventos (BF 06). Collector e credenciais de máquina: BF 07 |
| 05 | Aegis Collector | Agente Rust: buffering, batching, envio autenticado | TODO (Linux) |
| 06 | eBPF Telemetry | Probes Aya: exec/exit, parent/child, arquivo, rede (sem payload) | TODO (Linux) |
| 07 | Detection Engine | Avaliação de regras sobre eventos | TODO — regras já são cadastradas e validadas (schema v1, BF 03), mas não executadas |
| 08 | Correlation & Incidents | Agrupamento de alertas em incidentes, timeline | TODO — incidentes já existem como registro manual (origem `MANUAL`, BF 04); correlação automática, alertas e timeline não |
| 09 | Aegis Verified Core | Ada/SPARK + GNATprove para transições e severidade | TODO (Linux) |
| 10 | x86-64 Experiments | NASM + benchmarks vs referência | TODO (Linux) |
| 11 | AI Assistance | Resumo/triagem de incidentes via API externa | TODO |
| 12 | Observability | Métricas, logs estruturados, tracing | TODO |
| 13 | Hardening | TLS, rate limiting, headers, revisão de segurança | TODO |
| 14 | Presentation / Demo | Workspace AEGIS DEMO, pareamento temporário de laboratório, roteiro mapeado à rubrica | TODO |

## Pendência acadêmica identificada no BF 05.6

Resolvida no BF 06: SOLID Open/Closed e Liskov passaram a `PASS` com evidências que surgiram do modelo de eventos (registro de definições de tipos; suíte de contrato do `EventRepository` em memória e MySQL). Nenhuma hierarquia foi criada para atender à rubrica. Não há critério acadêmico conhecido pendente.
