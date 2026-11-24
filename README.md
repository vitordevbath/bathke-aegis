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

## Como rodar

Tudo na pasta do projeto. Só precisa de Docker (e de Rust para compilar o Collector, uma vez).

### 1. Subir a stack

```bash
cp .env.example .env              # só na primeira vez; troque as senhas e o JWT_SECRET
docker compose up -d --build      # constrói e sobe nginx, web, api e mysql
docker compose ps                 # só o nginx publica porta
curl -s http://localhost:8080/api/health
```

Abra **http://localhost:8080**. Não use `npm run dev` para a demonstração: ele sobe uma versão de
desenvolvimento fora do Docker, na porta 5173, que exige configuração própria.

### 2. Monitorar uma máquina Linux com o Aegis Collector

```bash
(cd native/aegis-collector && cargo build --release)     # uma vez
```

1. No painel: **Hosts → Adicionar host**, abra o host e clique em **Parear Collector**. O código
   aparece uma vez e vale 10 minutos.
2. Na máquina, rode o comando abaixo **primeiro** e cole o código quando ele pedir (não aparece na tela):

```bash
./native/aegis-collector/target/release/aegis-collector pair --server http://localhost:8080
./native/aegis-collector/target/release/aegis-collector run -v     # em primeiro plano; Ctrl+C para parar
./native/aegis-collector/target/release/aegis-collector status     # pareamento, fila e último heartbeat
./native/aegis-collector/target/release/aegis-collector unpair     # remove o pareamento local
```

Em menos de um minuto o host fica **Online** e o evento de inicialização aparece em **Eventos**.

### 3. Parar

```bash
docker compose stop     # para sem apagar nada
docker compose down     # remove os containers; o volume do banco continua (nunca use down -v)
```

### Atalhos do notebook da apresentação

No notebook usado na apresentação existem scripts locais em `.aegis-local/` (fora do Git), criados no
setup para rodar dois Collectors na mesma máquina: um para o workspace pessoal e outro que aparece no
AEGIS DEMO como `aegis-server`.

```bash
bash .aegis-local/ligar.sh       # sobe a stack e os dois Collectors, sem duplicar
bash .aegis-local/status.sh      # estado dos dois Collectors e últimas linhas de log
bash .aegis-local/desligar.sh    # para os dois Collectors (a fila é preservada)
```

### Mostrar a infraestrutura

```bash
docker compose ps                                   # só o nginx publica porta (0.0.0.0:8080->80)
docker network ls --filter name=bathke-aegis        # aegis_edge, aegis_application, aegis_data
docker network inspect bathke-aegis_aegis_data --format '{{.Internal}} {{range .Containers}}{{.Name}} {{end}}'
docker compose exec -T api getent hosts mysql       # a API enxerga o banco
docker compose exec -T nginx getent hosts mysql     # o Nginx não enxerga (sem resposta)
curl -s http://localhost:8080/api/health            # a API responde através do Nginx
curl -s -m 3 http://localhost:3000/health           # e não responde direto: não está exposta
curl -sI http://localhost:8080/ | grep -iE "content-security|x-frame|x-content"
docker volume ls --filter name=mysql_data           # o banco mora num volume nomeado
docker compose logs --tail 20 api
```

### Demonstração do motor de detecção

Com uma regra **Sistema › Serviço · é igual a · `systemd-hostnamed.service`** habilitada:

```bash
hostnamectl status     # só lê informações, mas liga esse serviço por alguns segundos
```

Em menos de um minuto aparecem o alerta (**Alertas**), o incidente aberto pelo motor (**Incidentes**)
e, no detalhe dele, a **Reconstrução** com a linha do tempo e o grafo.

### Auditoria da rubrica

```bash
npm ci                     # uma vez, requer Node.js ≥ 22
npm run audit:rubrica      # 35 verificações do back-end contra a stack rodando
npm run test:infra         # stack isolada: Compose, volume, Nginx, redes e HTTPS
```

## Usando o Aegis

| Conceito | O que é | Como se cria |
| --- | --- | --- |
| **Host** | Uma máquina monitorada | Hosts → Adicionar host, depois Parear Collector |
| **Evento** | Um fato que a máquina relatou (boot, serviço mudou). Imutável | Chega sozinho pelo Collector |
| **Regra** | O que você quer vigiar: categoria, condições, severidade e quais hosts | Regras → Nova regra |
| **Alerta** | "A regra X casou com o evento Y". Imutável, um por regra e evento | O motor cria na hora em que o evento chega |
| **Incidente** | O caso que uma pessoa precisa tratar | Automático (motor) ou Incidentes → Novo incidente |
| **Investigação** | O trabalho de entender um ou mais incidentes, com conclusão escrita | Investigações → Nova investigação |

**Ciclo do incidente:** Aberto → Em investigação → Resolvido → Encerrado. Um incidente resolvido pode
voltar para investigação; encerrado é final. Alertas da mesma regra no mesmo host em até 30 minutos
entram no mesmo incidente aberto.

**Ciclo da investigação:** Aberta ⇄ Em andamento → Encerrada. Só encerra com uma conclusão de pelo
menos 10 caracteres. Um incidente que está numa investigação não pode ser excluído.

**Fluxo típico:** criar uma regra → o motor gera alertas e abre o incidente → **Iniciar investigação**
no incidente → criar uma investigação agrupando os incidentes relacionados → escrever a conclusão e
encerrar → resolver e encerrar o incidente. Cada passo fica no histórico do incidente (**Reconstrução**).

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
