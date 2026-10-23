# Architecture Decision Log

## ADR-001 — Use npm workspaces
**Decisão:** monorepo com npm workspaces (`apps/*`, `packages/*`, `tools/*`).
**Motivo:** suficiente para poucos pacotes; sem Nx/Turborepo/Lerna.

## ADR-002 — Use React + TypeScript + Vite
**Decisão:** SPA com React Router, TanStack Query, React Hook Form e Zod. CSS próprio via tokens; sem framework CSS por enquanto.

## ADR-003 — Use Fastify
**Decisão:** Fastify em vez de Express: tipagem melhor, `inject` para testes, plugins encapsulados.

## ADR-004 — Use MySQL due to academic requirement
**Decisão:** MySQL 8.4 com Drizzle ORM. Requisito da rubrica.

## ADR-005 — Expose only Nginx in final container topology
**Decisão:** apenas `nginx` publica porta. `aegis_application` e `aegis_data` são redes `internal`.
**Consequência:** a API não tem egress; será adicionada rede dedicada quando houver integração externa (IA).

## ADR-006 — Keep experimental components optional
**Decisão:** componentes Aegis Labs (Rust, eBPF, SPARK, ASM) nunca são dependência de build/run do Core nem do CI principal.

## ADR-007 — No local LLM requirement
**Decisão:** IA via API externa, opcional. A aplicação funciona integralmente sem IA.

## ADR-008 — Use custom MCP with restricted capabilities
**Decisão:** Aegis MCP próprio em TypeScript com ferramentas fixas, allowlist de caminhos e secret guard; sem shell arbitrário.

## ADR-009 — Workspace será a fronteira principal de organização dos recursos
**Decisão:** `User → Membership → Workspace → (Hosts, Detection Rules, Incidents, Investigations)`.
**Motivo:** suportar uso individual, equipes e workspace de demonstração sem remodelar dados.
**Consequência:** autorização verifica membership no workspace do recurso. Ainda não implementado em código ou banco.

## ADR-010 — Linux será a plataforma de referência inicial, mas a arquitetura não será Linux-only
**Decisão:** primeiro Collector é Linux (Rust + Aya/eBPF). A API recebe eventos por um contrato de telemetria independente de SO.
**Consequência:** campos específicos de plataforma ficam em extensões do evento, não no núcleo do contrato; collectors Windows/macOS podem ser adicionados sem alterar o pipeline.

## ADR-012 — O produto terá workspace de demonstração seguro e preferencialmente somente leitura
**Decisão:** workspace "AEGIS DEMO" com dados gerados/curados para avaliação sem instalar nada.
**Consequência:** nunca contém telemetria real; escrita bloqueada ou restrita para visitantes.

## ADR-013 — Pareamento temporário será o mecanismo futuro para demonstrações com hosts de laboratório
**Decisão:** hosts são adicionados por código/token temporário gerado no painel.
**Consequência:** tokens expiram, são revogáveis, limitados a ingestão em um workspace e auditados.

## ADR-011 — A primeira versão prioriza observar, detectar e investigar antes de resposta remota
**Decisão:** nenhuma ação remota (matar processo, alterar firewall, bloquear conexão, isolar host) na primeira versão.
**Motivo:** menor risco, escopo menor, postura claramente defensiva.
**Consequência:** o Collector é somente leitura; o canal API → Collector não aceita comandos até uma fase futura com ADR próprio.

## ADR-014 — IA será externa, opcional e não essencial para funcionamento do produto
**Decisão:** refina o ADR-007. A IA recebe apenas incidentes estruturados e devolve explicação; não controla hosts, não monitora máquinas, não substitui o Detection Engine.
**Consequência:** saída da IA é marcada como interpretação, separada da evidência original, que permanece imutável.

## ADR-015 — Site público e aplicação operacional terão linguagens visuais relacionadas, porém níveis diferentes de movimento/efeitos
**Decisão:** mesmos tokens de marca; site público pode usar WebGL/Three.js e animação expressiva; aplicação autenticada prioriza densidade, legibilidade e desempenho.
**Consequência:** dependências 3D/WebGL ficam isoladas no site público e não entram no bundle da aplicação operacional.

## ADR-016 — Autenticação com Argon2id e JWT HS256 stateless
**Decisão:** senhas com Argon2id (`argon2`, m=64 MiB, t=3, p=4 — RFC 9106 §4, segunda opção recomendada; parâmetros em `argon2-password-hasher.ts`). Access token JWT HS256 (`jose`) com apenas `sub`, `typ=access`, `iss`, `aud`, `iat`, `exp`; validade padrão de 1 h (`JWT_TTL_SECONDS`). `JWT_SECRET` é obrigatório, ≥ 32 caracteres e rejeitado se contiver placeholder/valor fraco — não há fallback.
**Motivo:** KDF memory-hard recomendada; token mínimo sem dado pessoal; nenhuma sessão no servidor nesta fase.
**Consequências:** logout apenas descarta o token no cliente; token roubado vale até expirar; troca de senha não invalida tokens já emitidos. Revogação (ex.: `token_version` no usuário) fica para fase futura. Rotas protegidas recarregam o usuário a cada requisição: token válido de usuário removido → 401.

## ADR-017 — Token de acesso em localStorage por exigência acadêmica
**Decisão:** o frontend guarda o JWT em `localStorage` (chave `aegis.auth.token`, acesso só por `apps/web/src/lib/auth-storage.ts`), conforme a rubrica.
**Riscos:** qualquer script executado na página lê o token; XSS equivale a sequestro de sessão.
**Mitigações obrigatórias:** CSP estrita no Nginx (`script-src 'self'`, sem inline/terceiros, `frame-ancestors 'none'`); React escapa saída e o projeto não usa `dangerouslySetInnerHTML`; TTL curto; `Cache-Control: no-store` nas respostas de auth.
**Futuro:** se a exigência deixar de existir, avaliar cookie `HttpOnly` + `SameSite` com proteção CSRF.

## ADR-018 — Regras de validação compartilhadas; entidades apenas na API
**Decisão:** value objects e políticas puras (`Email`, `Cpf`, `PasswordPolicy`) e a hierarquia `DomainError` ficam em `@aegis/domain`. `@aegis/contracts` adapta essas regras para schemas Zod usados pelos formulários do web e pela validação de entrada da API. Entidades (`User`, `Workspace`, `Membership`), use cases e ports ficam em `apps/api`.
**Motivo:** uma única implementação do dígito verificador do CPF e da política de senha; contracts continuam sendo DTOs de transporte, sem entidades.
**Consequência:** `contracts` depende de `domain`; a raiz compila `domain` → `contracts` antes dos apps (`npm run build:packages`).

## ADR-019 — Migrations versionadas aplicadas por serviço one-shot
**Decisão:** schema Drizzle gera SQL versionado em `apps/api/drizzle` (`npm run db:generate`); `npm run db:migrate` aplica via migrator do Drizzle (runtime, sem `drizzle-kit push`). No Compose, o serviço `migrate` (mesma imagem da API, sem porta, só na rede `aegis_data`) roda antes da API (`service_completed_successfully`).
**Motivo:** migrations reproduzíveis e auditáveis; a API não altera schema ao iniciar.
**Consequência:** o CI aplica as migrations num MySQL vazio e os testes de integração criam um banco novo por execução.

## ADR-020 — Isolamento por workspace: 404 para recursos de outros tenants
**Decisão:** recursos são endereçados por `/workspaces/:workspaceId/...`. `WorkspaceAccess` resolve a membership do usuário antes de qualquer consulta; não membro → `NotFoundError` (404), idêntico a recurso inexistente. Repositórios só expõem operações escopadas por workspace (`findInWorkspace`, `listInWorkspace`, `deleteInWorkspace`), sem `findById` solto. IDs malformados também respondem 404. Escrita exige papel que gerencie recursos — por ora apenas OWNER (deny-by-default; ADMIN/ANALYST/VIEWER sem comportamento até o compartilhamento existir; membro sem permissão → 403).
**Motivo:** não confirmar a existência de workspaces/recursos alheios; impedir que um handler esqueça o filtro de tenant.
**Consequência:** Detection Rules, Incidents e Investigations reutilizam `WorkspaceAccess`, o padrão de rotas e o contrato `PaginatedResponse<T>`.

## ADR-021 — Host: campos administrativos vs. fatos do Collector
**Decisão:** o usuário edita apenas `displayName` e `description`. `agentId`, `hostname`, `osName`, `osVersion`, `architecture`, `connectionState` e `lastSeenAt` pertencem ao futuro Aegis Collector: começam nulos/`UNPAIRED`, não têm setter na entidade, não são escritos pelo UPDATE e enviá-los à API é 400 (sem mass assignment). A UI mostra "Não pareado" / "Ainda não informado" / "Nunca", nunca "Online"/"Offline" sem Collector. Exclusão é física porque ainda não há telemetria vinculada.
**Consequência:** quando eventos referenciarem hosts, a política de exclusão será revista (ex.: arquivamento) e um fluxo de pareamento (ADR-013) passará a preencher os fatos do Collector.

## ADR-022 — Detection Rules usam DSL declarativa estruturada e não executável
**Decisão:** a definição de uma regra é JSON versionado (`version: 1`) com `match` (`ALL`/`ANY`) e 1–10 condições `{ field, operator, value }`. Campos vêm de uma allowlist por categoria (`PROCESS`, `NETWORK`, `SYSTEM`) que reflete o contrato de telemetria **planejado**; operadores são um conjunto fechado (`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `IN`, `GREATER_THAN`, `LESS_THAN`) restrito ao tipo do campo; valores são tipados e limitados. Um único validador (`validateDetectionDefinition`, `@aegis/domain`) é usado pelo schema da API, pelo formulário web e pela entidade (inclusive ao reidratar do banco); propriedades desconhecidas são rejeitadas.
**Não usamos:** JavaScript, `eval`/`Function`, SQL, shell, regex arbitrária, templates executáveis, parser ou linguagem própria, grupos booleanos aninhados.
**Motivo:** regras são dados auditáveis; nenhuma entrada de usuário vira código; a futura avaliação pode ser implementada (e verificada) sobre uma estrutura fechada.
**Consequência:** mudanças de formato exigem `version: 2` e migração explícita das regras existentes (não implementada ainda). Nesta fase as regras são apenas configuração: nada as avalia, não há eventos nem alertas.

## ADR-023 — Targets regra ↔ host: cascade na regra, restrict no host
**Decisão:** `detection_rule_targets (detection_rule_id, host_id)` com PK composta. Excluir uma regra remove seus targets (`ON DELETE CASCADE`). Excluir um host que é alvo é bloqueado (`ON DELETE RESTRICT`); a API responde 409 com orientação. Escopo `ALL_HOSTS` não tem targets; `SELECTED_HOSTS` exige ≥ 1. Hosts alvo são validados como pertencentes ao workspace da regra dentro da mesma transação que grava os targets; host inexistente e host de outro workspace recebem o mesmo 400.
**Motivo:** uma regra `SELECTED_HOSTS` nunca perde silenciosamente seu último alvo; nenhuma regra aponta para host de outro tenant.
**Consequência:** para excluir um host alvo, o usuário primeiro o remove das regras (ou exclui as regras).

## ADR-024 — Incident relaciona-se com Hosts e Detection Rules por N:N
**Decisão:** `incident_hosts (incident_id, host_id)` e `incident_detection_rules (incident_id, detection_rule_id)`, ambas com PK composta e índice na FK reversa. Sem `incident.host_id` ou `incident.detection_rule_id` únicos. Um incidente exige **pelo menos 1 host** (todo incidente manual do Aegis envolve um endpoint cadastrado) e aceita **0 ou mais regras** (relação opcional, escolhida à mão; regra desabilitada também pode ser relacionada). FKs a partir do incidente são `ON DELETE CASCADE`; para host e regra, `ON DELETE RESTRICT`, coerente com ADR-023: a API responde 409 ("Remova-o desses incidentes antes de excluí-lo") em vez de apagar o incidente ou a referência em silêncio. Hosts e regras são validados no workspace do incidente dentro da mesma transação que grava as relações; inexistente e de outro workspace recebem o mesmo 400. A regra é buscada no workspace antes da checagem de vínculo, para que uma regra alheia seja 404, nunca 409.
**Motivo:** um caso real envolve vários endpoints e pode ter vários indícios; nenhuma referência some sem decisão humana; nenhum incidente aponta para dados de outro tenant.
**Consequência:** para excluir host ou regra vinculados, o usuário primeiro edita o incidente (ou o exclui). Incidente puramente organizacional (sem host) fica para quando houver caso de negócio.

## ADR-025 — Incidents são manuais até existir Correlation Engine
**Decisão:** `origin` tem `MANUAL` e `DETECTION_ENGINE`, mas o servidor sempre cria `MANUAL`; o cliente não pode enviar `origin` (nem `status`, `resolvedAt`, ids ou timestamps: 400). `DETECTION_ENGINE` só existe para compatibilidade futura e nenhum código o grava. Não existem Event, Alert, Detection Engine nem Correlation Engine; regras não são executadas; relacionar uma regra não significa que ela "disparou". A UI diz isso explicitamente e não usa "Alerta" nem "ameaça detectada".
**Motivo:** honestidade do produto; a cadeia Evento → Regra → Alerta → Incidente → Investigação será construída de baixo para cima.
**Consequência:** quando a correlação existir, ela criará incidentes `DETECTION_ENGINE` pelo mesmo agregado, sem migração de tipo.

## ADR-026 — Ciclo de vida inicial de Incident
**Decisão:** `OPEN → INVESTIGATING → RESOLVED → CLOSED`, mais `OPEN → RESOLVED` (resolvido sem investigação separada) e `RESOLVED → INVESTIGATING` (reabertura antes do encerramento). `CLOSED` é final: sem transições e com o incidente **somente leitura** (editar → 409; excluir continua permitido, ADR-027). A tabela `INCIDENT_TRANSITIONS` (`@aegis/domain`) é a única fonte; `Incident.transitionTo` é o único ponto que muda `status` e `resolvedAt`: entrar em `RESOLVED` define `resolvedAt`, reabrir limpa, `CLOSED` preserva (só é alcançável a partir de `RESOLVED`). Pedir o status atual é no-op. `restore` recusa linhas incoerentes (ex.: `RESOLVED` sem `resolvedAt`). Transição inválida lança `InvalidIncidentTransitionError` (subclasse de `InvalidStateError`), que a API traduz para **409 `INVALID_STATE`** com issue no campo `status` — 409 porque o pedido é bem formado, mas conflita com o estado atual do recurso. O status muda pelo mesmo `PUT` (campo `status` opcional; omitido = inalterado); a API devolve `availableTransitions` e o web só desenha os botões recebidos, sem replicar regras. Sem biblioteca ou framework de state machine.
**Consequência:** novos estados (ex.: `FALSE_POSITIVE`) exigem atualizar a tabela, a migration do enum e os rótulos.

## ADR-027 — Exclusão física de Incident enquanto não há evidência imutável
**Decisão:** `DELETE` remove o incidente fisicamente (204); as relações saem por cascade; hosts e regras permanecem. A UI avisa que a remoção é definitiva. Não há timeline nem audit log neste estágio (nada é inventado na tela).
**Motivo:** incidentes ainda não contêm eventos, alertas ou evidências que precisem ser preservados.
**Consequência:** quando Event/Alert existirem, reavaliar retenção, auditoria e soft delete; um audit log persistido é pré-requisito para qualquer timeline.

## ADR-028 — Investigation agrupa Incidents por relação N:N
**Decisão:** `investigation_incidents (investigation_id, incident_id)` com PK composta e índice em `incident_id`. Uma investigação exige **pelo menos 1 incidente** no cadastro e em toda edição (lista vazia → 400); um mesmo incidente pode ser analisado por várias investigações com objetivos diferentes. Incidentes de qualquer status podem ser agrupados (não há regra de negócio que impeça revisar um caso encerrado). Os incidentes são validados no workspace da investigação dentro da transação que grava as relações; inexistente e de outro workspace recebem o mesmo 400. FK para a investigação `ON DELETE CASCADE`; para o incidente `ON DELETE RESTRICT` (ADR-030).
**Motivo:** uma investigação sem incidentes não tem significado; impedir N:N exigiria uma regra de domínio que não existe.
**Consequência:** a listagem traz só `incidentCount` (ids carregados em uma consulta por página, sem N+1); o detalhe traz cada incidente resumido (título, severidade, status, origem).

## ADR-029 — Investigation encerrada exige conclusão e torna-se somente leitura
**Decisão:** ciclo `OPEN → IN_PROGRESS → CLOSED`, mais `OPEN → CLOSED` e `IN_PROGRESS → OPEN` (pausar: a análise para e o caso volta à fila, comum quando falta informação). `CLOSED` é final. `conclusion` é rascunho opcional enquanto aberta; `Investigation.transitionTo('CLOSED')` exige conclusão com ≥ 10 caracteres e lança `InvestigationConclusionRequiredError` (subclasse de `ValidationError`, 400 no campo `conclusion`) — 400 e não 409 porque falta um dado que o próprio pedido pode trazer. O `PUT` aplica a nova conclusão antes da transição, então escrever e encerrar cabem em uma requisição. `closedAt` é definido ao encerrar e nunca volta a null. Encerrada, qualquer edição (título, descrição, conclusão, incidentes, status) → 409 `INVALID_STATE`. A regra vive na tabela `INVESTIGATION_TRANSITIONS` e em `closingConclusionProblem` (`@aegis/domain`), compartilhadas pelo formulário web, que só desenha `availableTransitions`.
**Motivo:** uma investigação não pode terminar sem registrar o resultado humano; o registro encerrado não deve mudar depois.
**Consequência:** reabrir uma investigação exigirá um novo ADR (e, idealmente, audit log).

## ADR-030 — Incident referenciado por Investigation não pode ser excluído
**Decisão:** `DeleteIncident` busca o incidente no workspace (404 se ausente ou alheio) e, se ele estiver em alguma investigação — inclusive encerrada —, responde 409 "Remova-o dessas investigações antes de excluí-lo". A FK `RESTRICT` cobre a corrida e é traduzida para o mesmo 409. A investigação nunca é apagada em cascata.
**Motivo:** uma investigação não perde casos em silêncio; o 409 não confirma a existência de dados de outro tenant.
**Consequência:** um incidente agrupado por investigação encerrada só sai excluindo a investigação (a encerrada é somente leitura).

## ADR-031 — Exclusão física de Investigation enquanto não há audit log
**Decisão:** `DELETE` remove a investigação fisicamente (204), inclusive encerrada; os vínculos saem por cascade; os incidentes permanecem. A UI avisa que a remoção é definitiva.
**Motivo:** coerente com ADR-027; ainda não há evidência imutável nem audit log.
**Consequência:** quando audit log ou evidências existirem, reavaliar retenção e soft delete — especialmente para investigações encerradas.

## ADR-032 — Events são fatos imutáveis e normalizados
**Decisão:** um evento é um fato técnico observado em um host autorizado, gravado uma única vez como a representação validada do Event Contract v1 (`payload` JSON + colunas de envelope). Não há `PUT`, `DELETE`, formulário de criação ou métodos de mutação em `TelemetryEvent`; o servidor define `id` (UUID próprio, distinto de `sourceEventId`), `workspaceId`, `hostId` e `ingestedAt`. O nome da entidade é `TelemetryEvent` para não colidir com eventos do DOM. Eventos não são alertas, incidentes nem logs textuais, e nada os avalia nesta etapa.
**Motivo:** telemetria só tem valor como registro fiel; editar um fato observado destruiria a confiança em detecções e investigações futuras.
**Consequência:** correções chegam como novos eventos; retenção e expurgo serão uma política explícita futura, nunca exclusão individual.

## ADR-033 — Event Contract versionado e independente de sistema operacional
**Decisão:** `schemaVersion: 1`, três categorias (`PROCESS`, `NETWORK`, `SYSTEM`) e seis tipos, modelados como união discriminada em TypeScript e descritos por um registro (`EVENT_DEFINITIONS`) com a presença de cada campo por tipo. Um único validador estrito, genérico sobre o registro, rejeita propriedades desconhecidas, normaliza timestamps para UTC e preenche opcionais com `null`. Os campos detectáveis do catálogo (`EVENT_FIELDS`) são a fonte de `DETECTION_FIELDS` das regras — uma lista só. Sem `FILE`/`AUTH`, linha de comando, ambiente ou payload de rede.
**Motivo:** Collectors de Linux, Windows e macOS devem falar o mesmo idioma; regras não podem referenciar campos que eventos não carregam; adicionar um tipo não deve exigir mexer no pipeline de ingestão.
**Consequência:** um tipo novo exige sua definição, o membro da união e o valor do enum (migration); uma `schemaVersion: 2` deverá conviver com eventos v1 armazenados.

## ADR-034 — Ingestão idempotente por host + sourceEventId + fingerprint
**Decisão:** `UNIQUE(host_id, source_event_id)` e um fingerprint SHA-256 (`node:crypto`) do evento canônico. Replay idêntico é deduplicado (sem nova linha); o mesmo `sourceEventId` com conteúdo diferente responde 409 `EVENT_ID_CONFLICT`. O lote (1–100) é validado inteiro antes de qualquer I/O (um inválido → 400, nada gravado); dentro de uma transação, a linha do host é travada (`SELECT … FOR UPDATE`) para serializar lotes concorrentes do mesmo host, os fingerprints existentes são comparados, um conflito desfaz o lote inteiro e os novos são inseridos num INSERT multi-linha. Duplicatas idênticas no mesmo lote são deduplicadas; conflitantes são 409. Resposta 200 `{received, inserted, deduplicated}`.
**Motivo:** o Collector reenviará lotes após timeouts; reenviar não pode duplicar, e reaproveitar um id para outro conteúdo é erro da fonte que não pode sobrescrever um fato.
**Consequência:** a resposta de um lote é previsível (tudo ou nada); a vazão por host é serializada, aceitável nesta etapa.

## ADR-035 — Ingestão com autenticação de usuário é temporária
**Decisão:** `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest` usa o JWT de usuário existente e exige OWNER. É um adaptador de laboratório/desenvolvimento (`IngestEventsAsUser`) sobre `EventIngestionService`, que recebe só `{workspaceId, hostId}` e o lote e não depende de HTTP, Fastify, JWT ou usuário. Rate limit próprio (`INGEST_RATE_LIMIT_MAX`), corpo ≤ 1 MiB. Ingerir não marca o host como `ONLINE` nem atualiza `lastSeenAt`.
**Motivo:** validar contrato, armazenamento e consulta antes de existir sensor, sem inventar o protocolo do Collector junto com o sensor.
**Consequência:** o BF 07 adiciona credenciais de máquina (pareamento) chamando o mesmo serviço; esta rota continua apenas para laboratório ou é removida.

## ADR-036 — Host com telemetria não pode ser excluído
**Decisão:** `events.host_id` é `ON DELETE RESTRICT`; `DeleteHost` responde 409 quando o host tem eventos, depois de confirmar que o host pertence ao workspace (host alheio continua 404). A exclusão do workspace continua em cascata (eventos e hosts saem juntos).
**Motivo:** apagar um host não pode destruir telemetria histórica em silêncio.
**Consequência:** hosts com eventos ficam até existir arquivamento ou política de retenção.

