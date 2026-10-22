# Aegis Event Contract v1

Status: **CURRENT** (BF 06) — contrato, Event Store, API de ingestão e navegador de eventos.
O **Aegis Collector não existe ainda** (PLANNED, BF 07+): hoje os eventos só chegam pela rota de
ingestão de laboratório com autenticação de usuário.

Fonte única: [`packages/domain/src/event-contract.ts`](../packages/domain/src/event-contract.ts).

## O que é um evento

Um **fato técnico imutável observado em um host autorizado** (processo iniciado, conexão observada,
serviço mudou de estado…). Evento **não** é alerta, incidente, investigação, regra nem log textual.
Nada é executado sobre eventos nesta etapa: regras não são avaliadas, alertas e incidentes
automáticos não existem.

O contrato é **independente de sistema operacional**: Linux é a plataforma inicial, mas os campos
(pid, executável, usuário, endereço/porta, estado de serviço) existem também em Windows e macOS.

## Envelope

```json
{
  "schemaVersion": 1,
  "sourceEventId": "3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f",
  "occurredAt": "2026-05-01T10:00:05.123Z",
  "category": "PROCESS",
  "type": "PROCESS_STARTED",
  "data": { "process": { "pid": 4242, "parentPid": 1000, "name": "bash", "executable": "/usr/bin/bash", "parentName": "nginx", "user": "www-data" } }
}
```

| Campo | Origem | Regra |
| --- | --- | --- |
| `schemaVersion` | fonte | sempre `1`; qualquer outro valor → 400 |
| `sourceEventId` | fonte | UUID; identifica o mesmo fato entre reenvios; normalizado para minúsculas |
| `occurredAt` | fonte | RFC 3339 **com fuso** (`Z` ou `±hh:mm`); datas impossíveis recusadas; normalizado para UTC com milissegundos; até 5 min no futuro (clock skew); eventos antigos (fila offline) são aceitos |
| `category`, `type` | fonte | cada tipo pertence a exatamente uma categoria |
| `data` | fonte | exatamente uma chave, a da categoria (`process`, `network` ou `system`) |
| `id` | servidor | UUID do Aegis, distinto de `sourceEventId` |
| `workspaceId`, `hostId` | servidor | vêm da rota autenticada, nunca do payload |
| `ingestedAt` | servidor | hora em que o Aegis persistiu o evento (UTC) |

## Categorias e tipos

| Categoria | Tipos | `data` |
| --- | --- | --- |
| `PROCESS` | `PROCESS_STARTED`, `PROCESS_EXITED` | `process` |
| `NETWORK` | `NETWORK_CONNECTION`, `NETWORK_LISTEN` | `network` |
| `SYSTEM` | `SYSTEM_BOOT`, `SYSTEM_SERVICE_STATE_CHANGED` | `system` |

Sem `FILE`, `AUTH` ou categorias especulativas nesta versão.

## Payloads

`R` = obrigatório · `O` = opcional (ausente vira `null`) · `—` = proibido (deve ser ausente/`null`) · valor fixo entre aspas.

**process** — `PROCESS_STARTED` e `PROCESS_EXITED`

| Campo | Tipo e limite | Presença |
| --- | --- | --- |
| `pid` | inteiro 1 … 4294967295 | R |
| `parentPid` | inteiro 0 … 4294967295 | O |
| `name` | texto ≤ 255 | R |
| `executable` | texto ≤ 4096 | R |
| `parentName` | texto ≤ 255 | O |
| `user` | texto ≤ 256 | O |

**network**

| Campo | Tipo e limite | `NETWORK_CONNECTION` | `NETWORK_LISTEN` |
| --- | --- | --- | --- |
| `protocol` | `TCP` \| `UDP` | R | R |
| `localAddress` | IPv4 ou IPv6 | O | O |
| `localPort` | inteiro 0 … 65535 | O | R |
| `remoteAddress` | IPv4 ou IPv6 | R | — |
| `remotePort` | inteiro 0 … 65535 | R | — |
| `pid` | inteiro 1 … 4294967295 | O | O |
| `processName` | texto ≤ 255 | O | O |

**system**

| Campo | Tipo | `SYSTEM_BOOT` | `SYSTEM_SERVICE_STATE_CHANGED` |
| --- | --- | --- | --- |
| `eventType` | `BOOT` \| `SERVICE_STATE_CHANGED` | `"BOOT"` | `"SERVICE_STATE_CHANGED"` |
| `serviceName` | texto ≤ 256 | — | R |
| `state` | `STARTING` \| `RUNNING` \| `STOPPING` \| `STOPPED` \| `FAILED` | — | R |

Textos não podem ser vazios nem conter caracteres de controle. Valores ausentes nunca são inventados.

## Validação estrita e privacidade

Propriedades desconhecidas, em qualquer nível, são **rejeitadas** (400), nunca descartadas em
silêncio — `{"password": "…"}` não entra no Event Store. O que é persistido é exatamente a
representação validada (`payload`), nunca o corpo da requisição.

O Event Store v1 **não contém e não aceita**: linha de comando, argumentos (`argv`), variáveis de
ambiente, senhas, tokens, segredos, teclas digitadas, área de transferência, conteúdo de arquivos,
conteúdo de mensagens ou payload de rede (sem packet capture). Somente metadados.

## Imutabilidade

Não existe `PUT` nem `DELETE` de evento, nem tela de criação ou edição. A entidade `TelemetryEvent`
não tem métodos de mutação. Um host com eventos não pode ser excluído (409; FK `RESTRICT`), para não
apagar telemetria histórica — política de retenção virá depois (ADR-036).

## Ingestão em lote

```
POST /api/workspaces/:workspaceId/hosts/:hostId/events/ingest
{ "events": [ … 1 a 100 eventos … ] }
→ 200 { "received": 10, "inserted": 7, "deduplicated": 3 }
```

- Corpo limitado a 1 MiB (413 acima disso); rate limit próprio por IP (`INGEST_RATE_LIMIT_MAX`, padrão 60 lotes/min).
- **Atomicidade:** o lote inteiro é validado antes de qualquer I/O; um evento inválido → 400 com
  issues `events.<i>.<campo>` e nada é armazenado.
- O host deve existir no workspace da rota; host inexistente ou de outro workspace → o mesmo 404.
- Ingerir eventos **não** muda o host para `ONLINE` nem atualiza `lastSeenAt` (não há Collector autenticado).

## Idempotência e fingerprint

- Chave: `UNIQUE(host_id, source_event_id)` — o mesmo `sourceEventId` pode existir em hosts diferentes.
- **Fingerprint:** SHA-256 (`node:crypto`) do evento canônico (envelope + `data` na ordem do catálogo,
  `occurredAt` em UTC, `sourceEventId` em minúsculas). Mesma informação em outra representação
  (fuso diferente, UUID em maiúsculas) gera o mesmo fingerprint.
- **Replay idêntico** (mesmo `sourceEventId`, mesmo fingerprint): não cria linha; conta como `deduplicated`.
- **Reuso conflitante** (mesmo `sourceEventId`, fingerprint diferente): **409 `EVENT_ID_CONFLICT`**
  apontando `events.<i>.sourceEventId`; a transação é desfeita (nenhum evento do lote é gravado) e o
  evento original permanece intacto.
- **Duplicatas no mesmo lote:** idênticas são deduplicadas; conflitantes → 409.
- Lotes concorrentes para o mesmo host são serializados por um lock na linha do host
  (`SELECT … FOR UPDATE`), então não há corrida entre a verificação e a inserção.

## Autenticação temporária (USER-AUTH INGESTION)

A rota de ingestão usa o JWT de usuário existente e exige papel de escrita (OWNER) no workspace.
É um **adaptador de laboratório/desenvolvimento**, não o protocolo do Collector (ADR-035). O núcleo,
`EventIngestionService`, não conhece HTTP, JWT nem usuário: recebe `{workspaceId, hostId}` e o lote.
O BF 07 acrescentará credenciais próprias de Collector chamando o mesmo serviço.

## Consulta

- `GET /api/workspaces/:workspaceId/events?page=&pageSize=&hostId=&category=&eventType=&from=&to=` —
  timeline `occurred_at DESC, id DESC`, `PaginatedResponse<EventSummary>`; `from`/`to` são RFC 3339
  inclusivos (`from ≤ to`); tipo de outra categoria → 400. O resumo traz o nome do host (join, sem N+1)
  e uma linha técnica curta, nunca o payload.
- `GET /api/workspaces/:workspaceId/events/:eventId` — evento validado completo (sem fingerprint);
  inexistente, malformado ou de outro workspace → o mesmo 404.

## Relação com Detection Rules

Os campos que uma regra pode referenciar (`DETECTION_FIELDS`) são **derivados** do catálogo de
eventos (`EVENT_FIELDS`, campos marcados como detectáveis). Não há segunda lista: um teste fixa que os
ids, tipos e limites são os mesmos usados pelas regras existentes. Regras continuam **não executadas**.

## Versionamento

Adicionar um tipo de evento é declarar sua definição em `EVENT_DEFINITIONS` (e o membro da união
TypeScript e o valor do enum na migration); validador, fingerprint, serviço de ingestão, repositório e
rotas não mudam. Uma futura `schemaVersion: 2` conviverá com eventos v1 armazenados — não implementada.

## Roadmap

Pareamento e credenciais de Collector (BF 07) → Collector Rust → telemetria Linux → eBPF →
Detection Engine → Alerts → Correlation → incidentes automáticos. Todos **PLANNED**.
