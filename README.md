# Bathke Aegis

Plataforma experimental de segurança defensiva, inspirada em conceitos de SIEM, XDR e EDR.

> **Status:** Projeto acadêmico e plataforma experimental em desenvolvimento.

**AEGIS by Bathke** — Security telemetry, detection and investigation platform.

## Contexto acadêmico

O Bathke Aegis está sendo desenvolvido como um projeto acadêmico do
curso de Engenharia de Software do Centro Universitário Integrado.

O projeto surgiu a partir de uma atividade que exige o desenvolvimento
de uma aplicação web full-stack com autenticação, operações CRUD
relacionais, TypeScript, MySQL, Docker, Nginx e práticas de
desenvolvimento assistido por agentes de inteligência artificial.

Em vez de implementar somente o escopo mínimo solicitado, o projeto
utiliza esses requisitos como base para a construção de uma plataforma
experimental de XDR/SIEM voltada inicialmente à telemetria de segurança
em sistemas Linux.

Os requisitos acadêmicos permanecem explicitamente rastreáveis em
[`docs/RUBRICA.md`](docs/RUBRICA.md), enquanto os componentes experimentais são
desenvolvidos separadamente dentro da arquitetura Aegis Labs.

O Linux é a plataforma de referência inicial do projeto devido ao uso
planejado de eBPF e à forte presença de Linux em servidores e ambientes
de infraestrutura. A arquitetura, entretanto, será projetada para
permitir suporte futuro a coletores para outros sistemas operacionais.

## Status atual

BF 08 — **primeiro MVP operacional**: o Aegis Collector em Rust, executado em um host Fedora/Linux, pareia por código temporário, envia heartbeat (o painel mostra Online/Offline) e eventos SYSTEM reais (boot e mudanças de serviços systemd) por uma fila local persistente; a revogação no painel interrompe a máquina ([docs/LINUX_SETUP.md](docs/LINUX_SETUP.md#aegis-collector--demonstração-no-fedora), [native/aegis-collector](native/aegis-collector/README.md)).

```
Fedora → Rust Collector → credencial de máquina → heartbeat + eventos SYSTEM → fila persistente → API → Event Store → Aegis Web
```

### Status acadêmico

- autenticação, usuário e workspace: concluídos;
- 4 CRUDs (Hosts, Detection Rules, Incidents, Investigations): concluídos;
- banco relacional (MySQL 8.4, migrations, relações): concluído;
- infraestrutura (Docker Compose, Nginx, isolamento): validada automaticamente;
- agentes (AGENTS.md, 3 skills, MCP): concluídos;
- matriz Tech Forge: componentização, POO, tipos, camadas e SOLID (S, O, L, DIP) evidenciados;
- telemetria: contrato de eventos, ingestão, identidade de máquina, Collector Rust (SYSTEM + heartbeat) implementados; eBPF (PROCESS/NETWORK), detecção, alertas e IA planejados.

Detalhes e pendências: [docs/RUBRICA.md](docs/RUBRICA.md).

| Componente | Status |
| --- | --- |
| Aegis Web (React + TS + Vite): site público, `/login`, `/cadastro`, `/dashboard`, `/perfil`, `/hosts`, `/regras`, `/incidentes` (com reconstrução: linha do tempo e grafo), `/investigacoes`, `/eventos`, `/alertas` | **IMPLEMENTADO** |
| Aegis API (Fastify + TS): health, autenticação, `/users/me`, CRUDs por workspace, eventos, motor de detecção, alertas, timeline do incidente, pareamento (`/agent/pair`), credenciais, heartbeat e ingestão por máquina | **IMPLEMENTADO** |
| `@aegis/contracts` (schemas Zod), `@aegis/domain` (Email, CPF, política de senha, severidade, regras de host/incidente/investigação, Event Contract, identidade de máquina, erros) | **IMPLEMENTADO** |
| Aegis MCP (7 ferramentas, secret guard) | **IMPLEMENTADO** (base) |
| Docker Compose + Nginx (somente Nginx exposto, redes internas) | **IMPLEMENTADO** (teste automatizado `npm run test:infra` no CI) |
| HTTPS opcional: TLS 1.2/1.3, HSTS, HTTP → HTTPS, Let's Encrypt ou autoassinado (`compose.tls.yaml`, [guia](docs/HOSPEDAGEM.md)) | **IMPLEMENTADO** (BF 12, ADR-055; verificado no `test:infra`) |
| MySQL + Drizzle: usuários, workspaces, hosts, regras, incidentes, investigações, eventos, identidade de máquina e relações com migrations versionadas | **IMPLEMENTADO** |
| Autenticação (Argon2id + JWT), usuário, workspace pessoal + membership OWNER | **IMPLEMENTADO** |
| Hosts CRUD por workspace (cadastro manual, paginação, busca), workspace ativo | **IMPLEMENTADO** |
| Detection Rules CRUD (regras declarativas v1, escopo por host), avaliadas pelo motor de detecção | **IMPLEMENTADO** |
| Incidents CRUD — registro manual com ciclo de vida, hosts envolvidos e regras relacionadas | **IMPLEMENTADO** |
| Investigations CRUD — caso humano que agrupa incidentes; encerrar exige conclusão e torna a investigação somente leitura | **IMPLEMENTADO** |
| Event Contract v1 + Event Store: ingestão em lote idempotente (credencial de máquina) e navegador `/eventos` somente leitura | **IMPLEMENTADO** |
| Pareamento por código de uso único (cancelável), credenciais de máquina com escopo, rotação, revogação confirmada na transação e histórico; painel no detalhe do host | **IMPLEMENTADO** |
| Aegis Collector (Rust): pareamento, heartbeat (Online/Offline derivado), eventos SYSTEM (boot, serviços systemd), fila SQLite persistente com reenvio idempotente | **IMPLEMENTADO** (BF 08; validado no Fedora 44; E2E com o binário real no CI) |
| AEGIS DEMO: workspace somente leitura para toda conta, hosts simulados ao vivo e host real opcional (`aegis-server`) | **IMPLEMENTADO** (ADR-052) |
| Motor de detecção (regras avaliadas em cada evento), alertas imutáveis e correlação automática em incidentes | **IMPLEMENTADO** (BF 10, ADR-053) |
| Reconstrução do incidente: histórico imutável (abertura, status, severidade, edições, investigações), linha do tempo com alertas e eventos ao redor, grafo de relações | **IMPLEMENTADO** (BF 11, ADR-054) |
| Workspaces compartilhados | **PLANEJADO** |
| Camada de telemetria eBPF, eventos PROCESS e NETWORK | **PLANEJADO** |
| Aegis Verified Core (Ada/SPARK), experimentos x86-64 | **PLANEJADO** |
| Análise assistida por IA (API externa) | **PLANEJADO** |

## Arquitetura atual

```
browser ─────────┐
                 ├──► Nginx :8080 ──┬── /      ──► web (Nginx estático, SPA)
Aegis Collector ─┘                  └── /api/  ──► api (Fastify) ──► mysql
(Rust, host Linux)
```

O navegador usa JWT de usuário; o Collector usa credencial de máquina com escopo
(`events:ingest`, `host:heartbeat`). Os dois contextos de autenticação são separados.

Com `compose.tls.yaml` o Nginx também escuta em HTTPS e a porta HTTP só redireciona; veja
[docs/HOSPEDAGEM.md](docs/HOSPEDAGEM.md).

Redes: `aegis_edge` (nginx), `aegis_application` (nginx, web, api — interna),
`aegis_data` (api, mysql — interna). Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Arquitetura alvo

```
Linux host ─► eBPF (planejado) ─► Aegis Collector (atual: SYSTEM + heartbeat) ─► Aegis API
  ─► Detection ─► Alerts ─► Correlation ─► Incidents ─► Aegis Web     (IA: planejada)
```

## Tecnologia

- **Atual:** TypeScript (strict), React, Vite, React Router, TanStack Query, React Hook Form, Zod, Fastify, @fastify/rate-limit, Drizzle ORM, MySQL 8.4, Argon2id (`argon2`), JWT (`jose`), Nginx, Docker Compose, Vitest, Testing Library, MCP SDK; Rust (Collector: `ureq` + rustls, `rusqlite`, `serde`).
- **Planejado (Aegis Labs):** Aya/eBPF, Ada/SPARK + GNATprove, NASM x86-64.

## Estrutura do repositório

```
apps/web            Aegis Web
apps/api            Aegis API
packages/contracts  contratos de transporte compartilhados
packages/domain     regras e primitivas de domínio (Entity, DomainError, Event Contract, identidade de máquina)
tools/aegis-mcp     Aegis MCP
native/             Aegis Collector (Rust, atual) e componentes low-level planejados
agents/skills/      skills para agentes
infra/              Dockerfiles e Nginx
docs/               documentação
```

## Desenvolvimento

Requisitos: Node.js ≥ 22, npm, Docker (opcional), Rust stable (somente para o Collector).

```bash
npm ci
npm run dev          # api :3000 + web :5173 (proxy /api)
npm run typecheck
npm run build
npm test
```

Stack completa em containers:

```bash
cp .env.example .env   # edite as senhas
docker compose up -d --build
# http://localhost:8080  e  http://localhost:8080/api/health
```

Teste automatizado da infraestrutura (stack isolada, limpa ao final): `npm run test:infra`.

Collector e fluxo ponta a ponta (requer Rust):

```bash
(cd native/aegis-collector && cargo build --release)
npm run test:collector-e2e     # stack isolada + binário real: pareamento, heartbeat, eventos, revogação
```

## Escopo de segurança

Projeto **exclusivamente defensivo**, para máquinas próprias, de laboratório ou
explicitamente autorizadas. Sem keylogging, captura de credenciais, evasão ou
exploração. Ver [docs/SECURITY.md](docs/SECURITY.md).

## Requisitos acadêmicos

Matriz rastreável em [docs/RUBRICA.md](docs/RUBRICA.md). Nenhum requisito é marcado
como concluído sem implementação e evidência.

## Roadmap

Visão de produto em [docs/PRODUTO.md](docs/PRODUTO.md). Fases 00–14 em [docs/ROADMAP.md](docs/ROADMAP.md).

## Licença / Status

Projeto acadêmico com repositório público, sem licença de uso definida. Todos os direitos reservados.
