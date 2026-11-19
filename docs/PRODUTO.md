# Produto — Bathke Aegis

> Documento de visão. Tudo aqui é **PLANEJADO**, salvo indicação contrária.
> O estado implementado está em [ARCHITECTURE.md](ARCHITECTURE.md) e [RUBRICA.md](RUBRICA.md).

## Visão

Bathke Aegis é uma plataforma web experimental de XDR/SIEM. O usuário instala o
Aegis Collector em máquinas Linux autorizadas; essas máquinas enviam telemetria
para o Aegis; no painel web o usuário visualiza hosts, estado de segurança,
firewall, interfaces, portas e serviços, processos e suas relações, conexões,
eventos, regras, alertas, incidentes, investigações e análises assistidas por IA.

A primeira versão é focada em:

```
OBSERVAR → DETECTAR → INVESTIGAR
```

Resposta remota ativa (matar processo, alterar firewall, bloquear conexão,
isolar host) fica explicitamente para fases futuras.

## Persona

**Rafael, 31 anos, responsável por TI de uma empresa de 40 pessoas no interior do Paraná.** Cuida
sozinho de uma dúzia de máquinas Linux (servidores de arquivos e de sistema interno, algumas estações)
além do suporte do dia a dia. Não tem orçamento nem equipe para um SIEM comercial, e as ferramentas que
encontra pedem agentes com root, coletam mais do que ele consegue justificar à diretoria ou exigem dias
de configuração.

O que ele precisa, e onde o Aegis responde (estado atual entre parênteses):

| Dor do Rafael | Resposta do Aegis |
| --- | --- |
| "Quando um servidor reinicia ou um serviço cai, eu só descubro quando alguém reclama." | Collector com heartbeat e eventos de sistema; host Online/Offline e último contato no Painel (CURRENT) |
| "Não posso instalar algo que leia arquivos e senhas dos usuários." | Coleta só metadados do Event Contract v1, sem argumentos, conteúdo ou pacotes; o site diz o que **não** é coletado (CURRENT) |
| "Preciso autorizar e desautorizar máquinas sem dor de cabeça." | Pareamento por código de uso único, credencial por máquina, rotação e revogação imediatas (CURRENT) |
| "Não tenho tempo de olhar evento por evento." | Regras declarativas, motor de detecção e alertas agrupados em incidentes automaticamente (CURRENT) |
| "Quando algo acontece, preciso explicar para a diretoria o que houve e em que ordem." | Reconstrução do incidente: histórico imutável, linha do tempo e grafo de relações; investigação que só fecha com conclusão escrita (CURRENT) |
| "Quero ver funcionando antes de instalar em produção." | AEGIS DEMO somente leitura para toda conta, com hosts simulados e uma máquina real (CURRENT) |
| "Não tenho como rodar uma infraestrutura pesada." | Uma stack Docker Compose com Nginx, API, web e MySQL; só o Nginx exposto (CURRENT) |

**Persona secundária: estudante ou professor de segurança** que precisa de um laboratório defensivo,
auditável e reproduzível, sem nenhuma capacidade ofensiva. O modelo de ameaças, os ADRs e os testes de
infraestrutura existem também para que esse público consiga verificar cada afirmação do produto.

## Princípio de produto

> Bathke Aegis deve primeiro enxergar e explicar muito bem o que acontece nos hosts
> antes de ganhar capacidade de alterar remotamente essas máquinas.

Isso reduz risco, simplifica a primeira versão e mantém o projeto claramente defensivo.

## Modelo conceitual de segurança

```
TELEMETRIA → EVENTO → REGRA → ALERTA → INCIDENTE → INVESTIGAÇÃO
```

| Conceito | Definição |
| --- | --- |
| Host | Máquina cadastrada em um workspace. Cadastro manual (nome e descrição); um OWNER autoriza um Collector por código temporário (CURRENT, BF 07). O Collector informa atividade por heartbeat e o Aegis deriva **online/offline** e o **último contato** (CURRENT, BF 08). Hostname, SO e arquitetura ainda não são informados (PLANNED). "Pareado" significa que existe uma credencial ativa; não significa conectado. |
| Telemetria | Dados técnicos produzidos pelo host/collector |
| Evento | Fato técnico imutável observado em um host autorizado, no formato OS-independente do Event Contract v1 (processo, rede, sistema). Somente metadados. CURRENT desde o BF 06; a ingestão exige credencial de máquina desde o BF 07; o Collector envia eventos SYSTEM reais desde o BF 08 ([EVENTOS.md](EVENTOS.md)) |
| Regra | Condição declarativa (schema v1: campo da allowlist, operador fechado, valor tipado) para detectar comportamento relevante. Pertence a um workspace e vale para todos os hosts ou para hosts selecionados. Hoje é apenas configuração: o motor de detecção ainda não existe. |
| Alerta | Resultado de uma regra acionada |
| Incidente | Caso de segurança que merece acompanhamento humano, no workspace, envolvendo um ou mais hosts e, opcionalmente, regras relacionadas. Tem severidade e ciclo de vida (Aberto → Em investigação → Resolvido → Encerrado, com reabertura antes do encerramento). Hoje é **registrado manualmente** (origem "Manual"); no futuro também agrupará eventos/alertas via correlação (PLANNED). |
| Investigação | Caso humano que agrupa e analisa um ou mais incidentes do mesmo workspace (um incidente pode estar em várias investigações). Ciclo de vida: Aberta → Em andamento → Encerrada, com pausa (Em andamento → Aberta) e encerramento direto a partir de Aberta. Encerrar exige uma **conclusão escrita por uma pessoa**; encerrada, fica somente leitura. Não cria telemetria, não executa regras e não gera alertas. Sem IA nesta etapa. |

## Componentes e responsabilidades

| Componente | Responsabilidade | Status |
| --- | --- | --- |
| Aegis Web | Interface web | CURRENT |
| Aegis API | Backend principal | CURRENT |
| Aegis Collector | Software executado em hosts Linux autorizados | CURRENT (BF 08): eventos SYSTEM, heartbeat, fila local; eBPF PLANNED |
| Aegis Detection Engine | Avalia regras sobre eventos | PLANNED |
| Aegis Correlation Engine | Relaciona eventos e alertas | PLANNED |
| Aegis Incident Engine | Organiza incidentes | PARTIAL — CRUD manual com ciclo de vida (BF 04); criação automática PLANNED |
| Aegis AI | Explicação e auxílio de análise | PLANNED |
| Aegis MCP | Ferramentas seguras para agentes de desenvolvimento | CURRENT (base) |
| Aegis Verified Core | Núcleo formal em Ada/SPARK | PLANNED |
| Aegis Labs | Experimentos: eBPF, Assembly, métodos formais, otimizações | PLANNED |

## Modelo de Workspace

Hosts e demais recursos **não** pertencem diretamente ao usuário. O Workspace é a
fronteira principal de organização e isolamento (ver ADR-009).

```
User
  │
  └── Membership
         │
         ▼
      Workspace
         │
         ├── Hosts
         ├── Detection Rules
         ├── Incidents
         └── Investigations
```

Permite: uso individual, equipes, empresas, workspace de demonstração e múltiplos
usuários compartilhando recursos. Autorização futura será verificada por
*membership* no workspace dono do recurso.

## Plataforma: Linux-first, não Linux-only

Linux é a plataforma de referência inicial (eBPF, servidores, VPS, observabilidade
de kernel, Rust/Aya). Ambiente principal do desenvolvedor: **Fedora KDE 44**.

O backend recebe eventos em formato **independente de sistema operacional**.
Collectors futuros convergem para um contrato comum (ADR-010):

```
Linux Collector   ─┐
Windows Collector ─┼─► Telemetry Event Contract ─► Aegis API
macOS Collector   ─┘   (eventual)
```

## Telemetria do Collector

CURRENT (BF 08): boot e mudanças de estado de serviços systemd (SYSTEM), heartbeat. O restante abaixo é
planejado.

| Categoria | Dados |
| --- | --- |
| Host | hostname, sistema operacional, versão, arquitetura, uptime, versão do Collector, online/offline |
| Processos | início, encerramento, PID, PPID, executável, usuário quando apropriado, relação pai/filho |
| Rede | interfaces, conexões, protocolo, porta local/remota, processo relacionado quando possível, estado técnico |
| Firewall | status, regras relevantes, portas expostas, serviços escutando (integração concreta definida depois, por plataforma) |
| Eventos do sistema | apenas eventos técnicos necessários e autorizados |

**Nunca coletado:** teclas, senhas, conteúdo privado, mensagens, documentos pessoais,
payload de rede.

## Modos de uso

### Workspace pessoal

```
Usuário → Workspace pessoal → Hosts autorizados
```

Uso normal: acesso completo aos recursos do próprio workspace.

### Workspace de demonstração — AEGIS DEMO

Permite que professor, avaliador ou visitante autorizado conheça o produto **sem
instalar o Collector e sem acessar máquinas reais** (ADR-012).

**Implementado (ADR-052):** toda conta recebe acesso somente leitura ao AEGIS DEMO e alterna
pelo seletor de workspace. Três hosts simulados enviam heartbeat e eventos de sistema sintéticos
pelos mesmos caminhos de um Collector; há regras, incidentes em vários estados e uma investigação
em andamento. O painel avisa, sempre, que os dados são de exemplo e simulados.

O demo **não** copia telemetria real. A única exceção é opcional e explícita: o host
`aegis-server`, que só recebe dados se o operador do servidor parear o Collector nele
(`npm run demo:pairing-code`) e pode ser revogado a qualquer momento (`demo:revoke-server`).

### Pareamento de hosts

O mecanismo (BF 07, ADR-037 a ADR-042) e o Collector que o usa (BF 08, ADR-043 a ADR-049) estão
**implementados**. Roteiro completo em [LINUX_SETUP.md](LINUX_SETUP.md#aegis-collector--demonstração-no-fedora).

```
Usuário OWNER
  → Abre o host e escolhe "Parear Collector"
  → Aegis gera um código temporário, exibido uma única vez (cancelável)   (CURRENT)
  → aegis-collector pair troca o código por uma credencial do host        (CURRENT)
  → Host aparece como "Pareado, sem comunicação"                          (CURRENT)
  → aegis-collector run: heartbeat → "Online"; eventos SYSTEM chegam      (CURRENT)
  → Revogar no painel: o Collector para de transmitir                     (CURRENT)
```

A credencial pertence a um único host, só permite enviar eventos dele e pode ser rotacionada ou
revogada pelo painel. "Pareado", "online", "última utilização da credencial" e "último evento
recebido" são conceitos diferentes, e a interface não os confunde.

## IA: componente auxiliar

A IA **não** recebe controle do host, **não** monitora máquinas diretamente e
**não** substitui o Detection Engine (ADR-014).

```
telemetria → normalização → regras → correlação → incidente estruturado → IA externa → explicação
```

| A IA poderá | A IA não poderá |
| --- | --- |
| resumir incidente | criar evidência falsa |
| explicar timeline | modificar evidência |
| destacar relações | executar ação remota automaticamente |
| auxiliar triagem | ser tratada como fonte factual |
| sugerir pontos para análise | |

A plataforma funciona integralmente com a IA offline.

## Direção visual

Duas experiências com linguagens visuais relacionadas, mas níveis diferentes de
movimento e efeitos (ADR-015).

### Site público

Acabamento visual de produto moderno e preciso — referência de **nível** de
qualidade semelhante à Linear, sem copiar sua identidade.

Implementado (BF 08.5, ADR-050): campo topográfico em WebGL 2 próprio (sem Three.js),
com uma lente que segue o cursor; tipografia Geist empacotada localmente; prévia do
painel que "assenta" com o scroll; fluxo Parear → Observar → Entregar → Investigar
guiado pelo scroll; a lista do que o Aegis não coleta; e uma seção que separa o que
funciona hoje do que está em construção. Respeita `prefers-reduced-motion`, a CSP
estrita e carrega sob demanda, fora do bundle do painel.

Planejado: visualização de rede/hosts com dados reais.

### Aplicação autenticada

Mais contida. Prioridades: legibilidade, densidade de informação, desempenho,
hierarquia, navegação rápida, grafos, timelines, tabelas e estados claros.
Animações apenas quando apoiam o entendimento — o dashboard operacional não é uma
página de vitrine. No BF 08.5: o painel começa pelo que precisa de atenção
(incidentes ativos por severidade, hosts sem comunicação, eventos recentes, estado
real do Collector), o perfil fica no botão de conta e a troca de tela usa um
crossfade curto (View Transitions API, onde houver suporte).

### Evitar (ambas)

Matrix verde, caveiras, neon hacker, estética genérica de "cybersecurity",
animação excessiva sem função.
