# Roadmap

| Fase | Nome | Escopo | Status |
| --- | --- | --- | --- |
| 00 | Foundation | Monorepo, web/api base, health, contracts, Docker/Nginx, MCP, docs, CI | DONE — base (BF 00–00.7); infraestrutura validada automaticamente no CI (BF 05.5) |
| 01 | Academic Core | Tratamento de erros, paginação genérica, base de repositórios/use cases | DONE — erros, repositórios, use cases, UnitOfWork (BF 01); paginação genérica (BF 02) |
| 02 | Authentication & User Management | Cadastro, login, JWT, Argon2, validação de email/CPF/senha, edição do próprio usuário | DONE (BF 01) |
| 03 | CRUD Domain | Workspace + Membership (ADR-009); Hosts, Detection Rules, Incidents, Investigations por workspace, com relações e paginação | DONE — Workspace pessoal + Membership OWNER (BF 01); Hosts CRUD com paginação e isolamento por workspace (BF 02); Detection Rules CRUD com DSL declarativa e targets por host (BF 03); Incidents CRUD manual com ciclo de vida e relações N:N com hosts e regras (BF 04); Investigations CRUD com relação N:N com incidentes, conclusão obrigatória para encerrar e estado final somente leitura (BF 05). Os quatro CRUDs acadêmicos estão concluídos; novos CRUDs não são planejados |
| 04 | Event Model | Schema de eventos normalizados, ingestão via API | DONE — Event Contract v1 (6 tipos, 3 categorias, OS-independente), Event Store imutável e idempotente, ingestão em lote com autenticação de usuário (laboratório) e navegador de eventos (BF 06). Credenciais de máquina e pareamento: BF 07 (substituiu a ingestão com autenticação de usuário). Collector: fase 05 |
| 05 | Aegis Collector | Agente Rust: buffering, batching, envio autenticado | DONE (BF 08) — CLI Rust em primeiro plano (pair, run, status, replace-credential, unpair), credencial local `0600`, heartbeat com ONLINE/OFFLINE derivado, eventos SYSTEM (boot e serviços systemd), fila SQLite persistente e limitada, reenvio idempotente; validado no Fedora e no CI (E2E com o binário real). PROCESS/NETWORK dependem da fase 06 |
| 06 | eBPF Telemetry | Probes Aya: exec/exit, parent/child, arquivo, rede (sem payload) | TODO (Linux) |
| 07 | Detection Engine | Avaliação de regras sobre eventos | DONE (BF 10, ADR-053) — regras habilitadas avaliadas na transação de ingestão; alertas imutáveis (`alerts`, migration 0012) |
| 08 | Correlation & Incidents | Agrupamento de alertas em incidentes, timeline | DONE — correlação automática por regra e host em janela de 30 min, incidentes `DETECTION_ENGINE` (BF 10, ADR-053); histórico imutável do incidente, linha do tempo com alertas e eventos ao redor e grafo de relações (BF 11, ADR-054, migration 0013) |
| 09 | Aegis Verified Core | Ada/SPARK + GNATprove para transições e severidade | TODO (Linux) |
| 10 | x86-64 Experiments | NASM + benchmarks vs referência | TODO (Linux) |
| 11 | AI Assistance | Resumo/triagem de incidentes via API externa | TODO |
| 12 | Observability | Métricas, logs estruturados, tracing | TODO |
| 13 | Hardening | TLS, rate limiting, headers, revisão de segurança | PARTIAL — headers/CSP (BF 00–05), revogação confirmada na transação e rate limit de pareamento persistente (BF 08); TLS no Nginx com HSTS, redirecionamento e Let's Encrypt opcional, verificado no `test:infra` (BF 12, ADR-055); limites persistentes nas demais rotas: TODO |
| 14 | Presentation / Demo | Workspace AEGIS DEMO, demonstração de pareamento em laboratório, roteiro mapeado à rubrica | PARTIAL — roteiro reproduzível Fedora → Collector → API → Web em [LINUX_SETUP.md](LINUX_SETUP.md#aegis-collector--demonstração-no-fedora) (BF 08); site público e painel focado em atenção (BF 08.5, ADR-050); workspace AEGIS DEMO somente leitura, simulado ao vivo, com host real opcional (BF 09, ADR-052) |

## Primeiro MVP operacional (BF 08)

```
Fedora → Rust Collector → credencial de máquina → heartbeat + eventos SYSTEM → fila persistente → API → Event Store → Aegis Web
```

**Implementado:** autenticação; workspaces; quatro CRUDs; regras declarativas (configuração); incidentes
(manuais); investigações; Event Store; pareamento de máquina; credenciais de máquina (rotação, revogação,
histórico, cancelamento de código); Rust Collector; heartbeat; eventos SYSTEM.

**Futuro:** eBPF; eventos PROCESS; eventos NETWORK; execução das Detection Rules; Alerts; correlação
automática; resposta remota; arquivamento de hosts; IA.

## Pendência acadêmica identificada no BF 05.6

Resolvida no BF 06: SOLID Open/Closed e Liskov passaram a `PASS` com evidências que surgiram do modelo de eventos (registro de definições de tipos; suíte de contrato do `EventRepository` em memória e MySQL). Nenhuma hierarquia foi criada para atender à rubrica. Não há critério acadêmico conhecido pendente.
