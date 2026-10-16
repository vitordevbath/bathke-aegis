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
