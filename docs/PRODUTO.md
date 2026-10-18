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
| Host | Máquina cadastrada em um workspace. Hoje é cadastro manual (nome e descrição); hostname, SO, arquitetura, estado de conexão e último contato serão informados pelo Aegis Collector após o pareamento (PLANNED). Sem Collector, o host é "Não pareado". |
| Telemetria | Dados técnicos produzidos pelo host/collector |
| Evento | Ocorrência individual normalizada |
| Regra | Condição utilizada para detectar comportamento relevante |
| Alerta | Resultado de uma regra acionada |
| Incidente | Conjunto de eventos/alertas relacionados que merece análise |
| Investigação | Caso humano que agrupa e analisa um ou mais incidentes |

## Componentes e responsabilidades

| Componente | Responsabilidade | Status |
| --- | --- | --- |
| Aegis Web | Interface web | CURRENT (base) |
| Aegis API | Backend principal | CURRENT (base) |
| Aegis Collector | Software instalado em hosts autorizados | PLANNED |
| Aegis Detection Engine | Avalia regras sobre eventos | PLANNED |
| Aegis Correlation Engine | Relaciona eventos e alertas | PLANNED |
| Aegis Incident Engine | Organiza incidentes | PLANNED |
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

## Telemetria inicial do Collector (planejada)

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

- dados seguros, hosts simulados ou previamente preparados;
- eventos e incidentes demonstrativos;
- navegação completa;
- preferencialmente somente leitura.

O workspace de demonstração **jamais** revela dados de hosts reais do desenvolvedor:
os dados demo são gerados/curados, nunca copiados de telemetria real.

### Pareamento temporário de laboratório

Modo futuro para demonstração ao vivo (ADR-013):

```
Usuário autenticado
  → Adicionar host
  → Aegis gera código/token temporário
  → Collector é iniciado em Linux / VM / WSL autorizado
  → Collector usa o código
  → Host aparece no painel
  → Telemetria começa a chegar
```

Requisitos: token temporário, revogável, de escopo limitado (um workspace, apenas
ingestão) e com registro de auditoria.

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

Planejado: React, TypeScript, WebGL, Three.js / React Three Fiber se fizer sentido,
animações e transições com função, profundidade, tipografia forte, visualização de
rede/hosts, identidade Aegis própria.

### Aplicação autenticada

Mais contida. Prioridades: legibilidade, densidade de informação, desempenho,
hierarquia, navegação rápida, grafos, timelines, tabelas e estados claros.
Animações apenas quando apoiam o entendimento — o dashboard operacional não é uma
página de vitrine.

### Evitar (ambas)

Matrix verde, caveiras, neon hacker, estética genérica de "cybersecurity",
animação excessiva sem função.
