# Bathke Aegis

Plataforma experimental de XDR/SIEM assistida por inteligência artificial.

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

BF 05 — Investigations CRUD (casos humanos que agrupam incidentes, conclusão obrigatória para encerrar) concluído. Os quatro CRUDs acadêmicos (Hosts, Detection Rules, Incidents, Investigations) estão completos.

| Componente | Status |
| --- | --- |
| Aegis Web (React + TS + Vite): `/`, `/login`, `/cadastro`, `/dashboard`, `/perfil` | **IMPLEMENTADO** |
| Aegis API (Fastify + TS): health, cadastro, login (JWT), `GET/PUT /users/me` | **IMPLEMENTADO** |
| `@aegis/contracts` (schemas Zod), `@aegis/domain` (Email, CPF, política de senha, erros) | **IMPLEMENTADO** |
| Aegis MCP (7 ferramentas, secret guard) | **IMPLEMENTADO** (base) |
| Docker Compose + Nginx (somente Nginx exposto) | **IMPLEMENTADO** (validado localmente) |
| MySQL + Drizzle: usuários, workspaces, hosts, regras, incidentes, investigações e relações com migrations versionadas | **IMPLEMENTADO** |
| Autenticação (Argon2id + JWT), usuário, workspace pessoal + membership OWNER | **IMPLEMENTADO** |
| Hosts CRUD por workspace (cadastro manual, paginação, busca), workspace ativo | **IMPLEMENTADO** |
| Detection Rules CRUD (regras declarativas v1, escopo por host) — configuração, ainda não executadas | **IMPLEMENTADO** |
| Incidents CRUD — registro manual com ciclo de vida, hosts envolvidos e regras relacionadas | **IMPLEMENTADO** |
| Investigations CRUD — caso humano que agrupa incidentes; encerrar exige conclusão e torna a investigação somente leitura | **IMPLEMENTADO** |
| Detection Engine (execução das regras), eventos, alertas, correlação automática, IA, workspaces compartilhados | **PLANEJADO** |
| Aegis Collector (Rust), camada de telemetria eBPF | **PLANEJADO** |
| Aegis Verified Core (Ada/SPARK), experimentos x86-64 | **PLANEJADO** |
| Análise assistida por IA (API externa) | **PLANEJADO** |

## Arquitetura atual

```
browser ──► Nginx :8080 ──┬── /      ──► web (Nginx estático, SPA)
                          └── /api/  ──► api (Fastify) ──► mysql
```

Redes: `aegis_edge` (nginx), `aegis_application` (nginx, web, api — interna),
`aegis_data` (api, mysql — interna). Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Arquitetura alvo

```
Linux host ─► eBPF (planejado) ─► Aegis Collector (planejado) ─► Aegis API
  ─► Detection ─► Correlation ─► Incidents ─► IA (opcional) ─► Aegis Web
```

## Tecnologia

- **Atual:** TypeScript (strict), React, Vite, React Router, TanStack Query, React Hook Form, Zod, Fastify, @fastify/rate-limit, Drizzle ORM, MySQL 8.4, Argon2id (`argon2`), JWT (`jose`), Nginx, Docker Compose, Vitest, Testing Library, MCP SDK.
- **Planejado (Aegis Labs):** Rust, Aya/eBPF, Ada/SPARK + GNATprove, NASM x86-64.

## Estrutura do repositório

```
apps/web            Aegis Web
apps/api            Aegis API
packages/contracts  contratos de transporte compartilhados
packages/domain     primitivas de domínio (Entity, DomainError)
tools/aegis-mcp     Aegis MCP
native/             componentes low-level planejados (README apenas)
agents/skills/      skills para agentes
infra/              Dockerfiles e Nginx
docs/               documentação
```

## Desenvolvimento

Requisitos: Node.js ≥ 22, npm, Docker (opcional).

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

Projeto acadêmico privado, sem licença de uso definida. Todos os direitos reservados.
