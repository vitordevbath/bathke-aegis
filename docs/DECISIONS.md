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

**Status:** implementado pelo ADR-052; a regra "nunca contém telemetria real" passou a ter uma exceção opcional e explícita (o host `aegis-server`).

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

**Status:** o Collector existe desde o BF 08; `lastSeenAt` é escrito pelo heartbeat e `ONLINE`/`OFFLINE` são derivados dele (ADR-043). Hostname, SO e arquitetura ainda não são informados. A exclusão de hosts com telemetria ou credenciais é bloqueada (ADR-036, ADR-041).
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
**Status:** substituído pelo ADR-042 (BF 07): a rota não aceita mais JWT de usuário.

## ADR-036 — Host com telemetria não pode ser excluído
**Decisão:** `events.host_id` é `ON DELETE RESTRICT`; `DeleteHost` responde 409 quando o host tem eventos, depois de confirmar que o host pertence ao workspace (host alheio continua 404). A exclusão do workspace continua em cascata (eventos e hosts saem juntos).
**Motivo:** apagar um host não pode destruir telemetria histórica em silêncio.
**Consequência:** hosts com eventos ficam até existir arquivamento ou política de retenção.

## ADR-037 — Identidade de máquina separada da identidade humana
**Decisão:** uma máquina se autentica com uma credencial própria, nunca com a sessão de uma pessoa. O contexto de máquina (`MachineAuthContext`, em `request.machineAuth`, preenchido por `authenticateMachine`) é distinto do contexto humano (`request.currentUser`, preenchido por `authenticate`): não há tipo união nem verificação espalhada. O contexto de máquina não tem usuário, papel nem membership. As rotas administrativas aceitam só JWT; a rota de ingestão aceita só credencial de máquina. Uma credencial vale para exatamente um host e, por ele, um workspace.
**Motivo:** um Collector não pode depender de uma sessão humana que expira, e o comprometimento de uma máquina não pode dar acesso à conta de ninguém.
**Consequência:** o formato do JWT (três segmentos) e o da credencial (prefixo fixo e dois segmentos) são estruturalmente incompatíveis, e testes percorrem todas as rotas humanas com um token de máquina. Uma nova rota de máquina precisa declarar `authenticateMachine` e o escopo no caso de uso.

## ADR-038 — Pareamento por código temporário de uso único
**Decisão:** um OWNER gera, para um host, um código `aegis_pair_<43 base64url>` (256 bits de `randomBytes`) válido por 10 minutos (`PAIRING_POLICY`). O código é exibido uma vez e armazenado só como SHA-256. `POST /agent/pair` recebe apenas o código; workspace e host vêm do challenge. Um novo código revoga o anterior do mesmo host. Host já pareado responde 409: a troca é por rotação, ou revogação seguida de novo pareamento. O uso único é garantido em camadas, todas na mesma transação: lock do host (mesma ordem da ingestão, sem deadlock), releitura do challenge com `FOR UPDATE`, `UPDATE` condicional com uma linha afetada e, no banco, `UNIQUE(code_hash)`, `UNIQUE(open_host_id)` (coluna gerada: um código aberto por host), `UNIQUE(pairing_challenge_id)` e `UNIQUE(active_host_id)` em `machine_credentials`. Limites configuráveis: requisições por IP em `/agent/pair`, códigos recusados por IP em janela que expira sozinha (contador próprio, em memória) e códigos por host por hora (contados no banco). Um código inválido não aponta para nenhum host, por isso o limite por host recai sobre a emissão.
**Motivo:** o instalador do Collector precisa de algo que possa ser digitado ou copiado uma vez, de vida curta e inútil depois de usado. O teste com 10 requisições simultâneas contra MySQL real resulta em exatamente uma credencial; removendo locks e o `UPDATE` condicional, os índices ainda impedem a segunda.
**Consequência:** toda falha responde o mesmo 401; o motivo fica só no log. Nenhum bloqueio é permanente. Os contadores por IP são por instância e zeram ao reiniciar a API. Quem compartilha IP com um atacante pode ter o pareamento pausado até a janela expirar.

**Status:** os contadores por IP passaram a ser persistentes em MySQL (ADR-046).
## ADR-039 — Credenciais opacas de alta entropia armazenadas como hash
**Decisão:** a credencial é `aegis_agent_<id32hex>.<43 base64url>`: identificador público (UUID sem hífens) e segredo de 256 bits, gerados por `randomBytes`. Não é JWT. O id localiza a linha sem varrer hashes; o segredo é comparado por SHA-256 com `timingSafeEqual`, atrás do port `MachineSecrets`. Nenhuma biblioteca nova. `token_prefix` deriva do id, então não revela nada do segredo. Credencial inexistente ainda executa uma comparação; o segredo é verificado antes do estado de revogação.
**Motivo:** com 256 bits aleatórios não há o que um KDF lento proteja, e cada requisição de máquina precisa ser barata; Argon2 continua exclusivo das senhas humanas (ADR-016). Token opaco permite revogação imediata sem lista de bloqueio.
**Consequência:** o segredo só existe na resposta de pareamento ou de rotação (`Cache-Control: no-store`); mappers usam allowlist e o hash nunca sai da API. `lastUsedAt` é gravado no máximo uma vez por minuto. Coluna gerada e índice `UNIQUE` garantem uma credencial ativa por host.

## ADR-040 — Escopo mínimo de credenciais
**Decisão:** o único escopo é `events:ingest`, concedido no pareamento (`MACHINE_SCOPES`, conjunto fechado). Escopos ficam em JSON validado na emissão e ao reidratar: um valor desconhecido invalida a credencial, nunca é ignorado. Cada caso de uso declara o que exige com `requireScope`. Uma credencial genuína sem o escopo recebe 403.
**Motivo:** menor privilégio; capacidades fictícias não entram no código. Um novo escopo é uma entrada na lista e uma chamada no caso de uso que precisa dele, sem condicionais por string nas rotas.
**Consequência:** a máquina não lê dados, não gerencia recursos e não cria nem revoga credenciais.

**Status:** ampliado pelo ADR-044 (`host:heartbeat`); o princípio de escopo mínimo é o mesmo.
## ADR-041 — Rotação e revogação imediatas
**Decisão:** ambas exigem OWNER e rodam em uma transação com o host travado. Rotação revoga a credencial atual, cria a sucessora ligada por `rotated_from_credential_id`, mantém host e escopos e devolve o novo segredo uma vez, sem período de transição. Revogação é lógica e definitiva: a linha permanece para auditoria, `DELETE` é idempotente (204, mantendo o primeiro `revoked_at`) e voltar a operar exige novo pareamento. Host com qualquer credencial, mesmo revogada, não pode ser excluído (409, FK `RESTRICT`); códigos nunca usados saem com o host. `hosts.connection_state` ganhou `PAIRED` (credencial ativa, sem afirmar conectividade) e `agent_id` guarda o id da credencial ativa, na mesma transação; `ONLINE`, `OFFLINE` e `last_seen_at` seguem reservados ao heartbeat.
**Motivo:** credencial suspeita precisa parar de funcionar agora; o histórico mínimo precisa sobreviver.
**Consequência:** uma requisição que já passou da autenticação quando a revogação é confirmada ainda termina; fechar essa janela exigiria checar credenciais dentro do `EventIngestionService`, misturando responsabilidades. Host pareado uma vez fica permanente até existir arquivamento. Como não há rota de exclusão de workspace, o cascade só é exercitado por teste; a FK `credentials_workspace_fk` tem esse nome de propósito, porque o InnoDB aplica cascades em ordem de nome de constraint e as credenciais precisam sair antes dos hosts que restringem (verificado em MySQL 8.4).

**Status:** a consequência sobre requisições em andamento foi substituída pelo ADR-045 (releitura da credencial dentro da transação); `ONLINE`/`OFFLINE` passaram a ser derivados do heartbeat (ADR-043); a rotação passou a emitir os escopos padrão atuais em vez de copiar os anteriores (ADR-044).
## ADR-042 — Ingestão autenticada por máquina
**Decisão:** `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest` passa a exigir credencial de máquina; JWT de usuário recebe 401, mesmo de OWNER. `IngestEventsAsUser` foi substituído por `IngestEventsAsMachine`, que exige `events:ingest` e compara `workspaceId`/`hostId` da URL com a identidade autenticada; divergência responde o mesmo 404 de um host inexistente (ADR-020). `EventIngestionService` não mudou e continua recebendo só a origem. A rota virou um plugin próprio, para que o hook de sessão humana não se aplique a ela.
**Motivo:** substituir o adaptador temporário do ADR-035. A identidade da máquina é a autoridade sobre o host, não o endereço da requisição.
**Consequência:** Event Contract v1, limites, idempotência, atomicidade e imutabilidade permanecem. Sem Collector, a ingestão só ocorre por um cliente que execute o contrato de pareamento (documentado em ARCHITECTURE.md). Ingerir não marca o host como `ONLINE`.

## ADR-043 — Heartbeat e estado ONLINE/OFFLINE derivado
**Decisão:** o Collector chama `POST /workspaces/:workspaceId/hosts/:hostId/heartbeat` (corpo vazio) a cada `HOST_PRESENCE_POLICY.heartbeatIntervalMs` (30 s; a resposta devolve o intervalo). O servidor grava apenas `hosts.last_seen_at`, com o **próprio relógio**, lido depois do lock do host, e nunca o move para trás; `updated_at` não muda (não é alteração administrativa) e nenhum evento é criado. O estado exibido é **derivado** na resposta por `hostConnectionStateOf`: `UNPAIRED` (sem credencial ativa), `PAIRED` (credencial ativa, nenhum heartbeat), `ONLINE` (último heartbeat há menos de `onlineWindowMs` = 90 s, três intervalos) e `OFFLINE` (pareado, silencioso além disso). `hosts.connection_state` passa a guardar só o fato de pareamento (`UNPAIRED`/`PAIRED`); os valores ONLINE/OFFLINE do enum não são mais escritos. A política fica em `@aegis/domain` e é reexportada por `@aegis/contracts`: a API deriva o estado, o web só atualiza a cada meio intervalo e explica.
**Motivo:** um estado persistido como ONLINE ficaria verdadeiro depois que o Collector parou; derivar do último contato elimina essa classe de erro. Pareado, comunicação recente e telemetria são fatos diferentes.
**Consequência:** a ingestão de eventos continua sem alterar `last_seen_at`; um host revogado guarda o último contato como histórico e aparece como `UNPAIRED`. Uma migração do enum não foi necessária.

## ADR-044 — Escopo `host:heartbeat` e credenciais anteriores
**Decisão:** `MACHINE_SCOPES = ['events:ingest', 'host:heartbeat']`; o caso de uso `RecordHeartbeat` exige `host:heartbeat` e o host da URL igual ao da credencial (outro host → mesmo 404 de host inexistente; sem escopo → 403). Pareamento e **rotação** emitem `DEFAULT_MACHINE_SCOPES` (os dois). Credenciais emitidas no BF 07 mantêm o conjunto com que foram emitidas (`events:ingest`): não há migração que amplie escopos de credenciais vivas. O painel avisa quando a credencial ativa não tem `host:heartbeat` e orienta a rotacioná-la; o Collector trata o 403 do heartbeat desativando só o heartbeat, continua enviando eventos e instala a credencial rotacionada com `aegis-collector replace-credential`, que a valida com um heartbeat antes de gravar.
**Motivo:** menor privilégio e nenhuma ampliação silenciosa de permissões; a rotação já é uma ação explícita de OWNER.
**Consequência:** hosts pareados antes do BF 08 só aparecem como ONLINE depois de uma rotação. A máquina continua sem poder ler dados ou administrar recursos.

## ADR-045 — Garantia de revogação dentro da transação
**Decisão:** substitui a consequência do ADR-041 sobre requisições em andamento. A ingestão e o heartbeat, **dentro da própria transação e depois do lock do host**, releem a credencial com leitura de bloqueio compartilhado (`SELECT … FOR SHARE`, `MachineCredentialRepository.lockForUse`) e recusam com 401 (`REVOKED_IN_FLIGHT`, auditado) se ela foi revogada ou não é mais do host. Revogação e rotação travam o host primeiro (mesma ordem, sem deadlock) e leem o relógio **depois** dos locks. O `EventIngestionService` continua sem conhecer credenciais: recebe uma etapa opcional `confirmSource` que o caso de uso de máquina fornece.
**Garantia:** depois que a revogação retorna sucesso, nenhuma ingestão ou heartbeat feito com aquela credencial é confirmado. Uma operação confirmada antes da revogação permanece, e então `ingested_at`/`last_seen_at` ≤ `revoked_at`. Leituras de bloqueio veem a última versão confirmada, não o snapshot de `REPEATABLE READ`.
**Evidência:** `apps/api/test/integration/heartbeat-revocation.mysql.test.ts` em MySQL real: requisição autenticada antes da revogação e executada depois é recusada sem gravar; revogação espera uma ingestão/heartbeat que já segura o host e só então retorna; rajada concorrente de ingestões e heartbeats com revogação no meio, verificando o invariante. Sem a releitura, o primeiro teste falha (verificado removendo a chamada).
**Consequência:** cada lote e cada heartbeat fazem uma leitura indexada a mais; `lastUsedAt` continua gravado fora da transação, e só para credenciais não revogadas.

## ADR-046 — Rate limit de pareamento persistente em MySQL
**Decisão:** os limites por IP de `POST /agent/pair` (requisições por minuto e códigos recusados por janela) saem da memória (`@fastify/rate-limit` e `AttemptWindow`) para a tabela `rate_limit_counters` (migration 0011): chave `(scope, subject_hash)`, contador e fim da janela fixa. `hit` é um `INSERT … ON DUPLICATE KEY UPDATE` (reinicia a janela vencida) seguido da leitura da mesma linha na mesma transação; o lock exclusivo da linha serializa acessos concorrentes. O endereço nunca é gravado: `subject_hash` é HMAC-SHA-256 com chave derivada por HKDF do `JWT_SECRET` com rótulo próprio (um SHA-256 simples de um IPv4 seria reversível por enumeração). `request.ip` vem do único proxy confiável (`trustOnlyNginx`): entradas de `X-Forwarded-For` escritas pelo cliente são ignoradas. A resposta 429 traz `Retry-After`. Contadores vencidos são removidos em lotes de 1000 a cada 10 minutos. Sem Redis.
**Motivo:** o limite não pode zerar ao reiniciar a API nem divergir entre instâncias.
**Consequência:** cada tentativa de pareamento faz uma transação curta a mais. Trocar o `JWT_SECRET` zera os contadores (as chaves mudam). Login, cadastro, ingestão e heartbeat seguem com limite em memória por instância (limitação documentada).

**Status:** a limitação sobre login, cadastro, ingestão e heartbeat foi resolvida pelo ADR-051.

## ADR-047 — Fila local persistente do Collector em SQLite
**Decisão:** cada host pareado tem uma fila `~/.local/state/aegis-collector/hosts/<hostId>/spool.sqlite3` (SQLite embutido via `rusqlite`/`bundled`, WAL, `synchronous=FULL`, arquivo `0600` em diretório `0700`, aberto com `O_NOFOLLOW`). Cada evento é gravado com `sourceEventId` fixo, `occurredAt`, categoria, tipo, `data` validado e data local; sai da fila **somente** após 2xx com `received` igual ao lote. Limites: 10 000 eventos e 16 MiB; cheia, a fila recusa o evento novo, avisa e conta em `dropped_events` (nunca descarta os enfileirados). 409/400 colocam em quarentena só os eventos apontados; 413 reduz o lote; 429 respeita `Retry-After`; 5xx e rede usam backoff exponencial com jitter; 401 encerra a transmissão. A fila é por host: parear outro host nunca envia eventos de um anterior. Uma trava (`flock`) impede dois `run` para o mesmo host.
**Motivo:** reenvio idempotente após falhas exige que o fato e seu id sobrevivam a queda de energia; SQLite dá transações atômicas (evento + "boot reportado" juntos) sem serviço extra. Um arquivo de log anexado exigiria compactação e recuperação próprias.
**Consequência:** o binário embute SQLite (C), compilado no build Rust; o Core não é afetado. Sem expiração por idade: a API aceita eventos antigos e os limites já limitam o disco.

## ADR-048 — Coleta SYSTEM sem privilégios
**Decisão:** o primeiro Collector coleta só a categoria SYSTEM do Event Contract v1, sem root e sem eBPF. `SYSTEM_BOOT`: `boot_id` do kernel e `btime` de `/proc/stat`, `sourceEventId` UUID v5 do `boot_id`, `occurredAt` = hora do boot em UTC, enfileirado uma vez por boot. `SYSTEM_SERVICE_STATE_CHANGED`: `systemctl list-units --type=service --all --plain --no-legend --no-pager --quiet` por caminho absoluto fixo, sem shell, com ambiente limpo, timeout de 10 s e saída máxima de 4 MiB, a cada 15 s; só nome e `ActiveState` (mapeados para os estados portáveis); a primeira leitura de cada execução é linha de base; unidade que sai da lista equivale a STOPPED; falha de consulta não infere nada. `occurredAt` é a hora da observação. Sem systemd, a coleta de serviços é desativada com aviso.
**Motivo:** entregar telemetria real com o menor privilégio e sem coleta de conteúdo; `systemctl` sem privilégios lê o estado do gerenciador do sistema.
**Consequência:** mudanças ocorridas com o Collector parado e transições mais curtas que o intervalo não são reportadas. PROCESS e NETWORK continuam planejados (eBPF).

## ADR-049 — O Collector entra no Core operacional, com CI próprio
**Decisão:** refina o ADR-006. `native/aegis-collector` passa a CURRENT e tem jobs próprios no CI: `rust` (`cargo fmt --check`, `clippy -D warnings`, `test`, `build --release`, artefato) e `collector-e2e` (o binário desse job contra a stack Compose isolada, com verificação de layout em Chrome headless). Os jobs `typescript` e `infrastructure` não dependem de Rust; as imagens Docker do Core excluem `native/` (`.dockerignore`). O Collector é executado explicitamente pelo usuário, em primeiro plano; não há instalador, serviço systemd ou persistência automática.
**Motivo:** o fluxo Fedora → Collector → API → Web é o MVP operacional e precisa de prova contínua com o binário real; o Core continua construível e testável sem toolchain nativa.
**Consequência:** eBPF, SPARK e NASM seguem como Aegis Labs, fora do CI principal.

## ADR-050 — Site público com WebGL próprio, carregado sob demanda
**Decisão:** aplica o ADR-015. O hero do site público desenha curvas de nível de um campo de ruído num shader WebGL 2 escrito no projeto (`apps/web/src/features/landing/`), sem Three.js: um triângulo de tela cheia e um fragment shader. O canvas é decorativo (`aria-hidden`), pausa fora da tela ou em aba oculta, limita a densidade de pixels a 1,5, renderiza um quadro parado com `prefers-reduced-motion` e, sem WebGL 2, a página mantém um fundo em CSS. O movimento ligado ao scroll escreve variáveis CSS via CSSOM (permitido pela CSP `style-src 'self'`). A rota `/` é carregada sob demanda, com CSS próprio (`landing.css`). A tipografia Geist (`@fontsource-variable/geist`, `geist-mono`) é servida pelo próprio app, porque a CSP bloqueia fontes externas.
**Motivo:** um conceito visual único e leve, sem dependência 3D para uma única cena; o painel continua sem custo de WebGL.
**Consequência:** o bundle do painel não inclui o código nem o CSS do site público. Visualizações 3D de dados reais, se vierem, reavaliam o uso de uma biblioteca.

## ADR-051 — Limites por rota nos contadores persistentes
**Decisão:** completa o ADR-046. O `@fastify/rate-limit` passa a usar um store próprio (`persistentRateLimitStore`, em `apps/api/src/presentation/http/persistent-rate-limit.ts`) sobre o mesmo port `RateLimitStore` e a mesma tabela `rate_limit_counters`. Login, cadastro, ingestão e heartbeat mantêm limites, janelas e respostas (429 com `Retry-After`); só o lugar do contador muda. Cada rota tem um escopo `http:` + digest de método e padrão de caminho (cabe no `VARCHAR(32)`), então os contadores continuam separados por rota. O endereço do cliente segue guardado apenas como HMAC (ADR-046), e a limpeza periódica de contadores vencidos já cobre esses escopos. Sem migração, sem dependência nova.
**Motivo:** os limites de autenticação e de máquina zeravam ao reiniciar a API e divergiam entre instâncias (limitação do ADR-046).
**Evidência:** `apps/api/test/integration/route-limits.mysql.test.ts` em MySQL real: duas instâncias da API no mesmo banco somam as tentativas de login e a segunda responde 429 com `Retry-After`; cadastro tem contador próprio; só hashes de 64 caracteres são gravados. Sem o store, o teste falha (verificado).
**Consequência:** cada requisição limitada faz uma transação curta a mais (um upsert e uma leitura indexada). Com o MySQL indisponível, as rotas limitadas falham em vez de passar sem limite (`skipOnError` desligado); o login já dependeria do banco de qualquer forma.

## ADR-052 — AEGIS DEMO: somente leitura, simulado ao vivo e com um host real opcional
**Decisão:** implementa o ADR-012. Na inicialização da API (`DEMO_WORKSPACE=on`, padrão), `DemoProvisioner` cria uma única vez o workspace `demo` "AEGIS DEMO", cujo OWNER é uma conta de sistema ("Operador do AEGIS DEMO", `operador@aegis-demo.invalid`) com senha aleatória de 256 bits descartada após o hash Argon2id: ninguém entra com ela. Hosts, regras, incidentes e uma investigação de exemplo são criados **pelos casos de uso normais**, agindo como o operador. Toda conta recebe o papel `VIEWER` no demo: as novas na transação do cadastro, as existentes em lote (`INSERT … SELECT`) a cada inicialização. `VIEWER` já era só leitura por padrão (`requireManager`); o painel esconde as ações de escrita e protege as telas de criação/edição (`ManagerOnly`). O workspace pessoal vem sempre primeiro nas listagens e é o ativo por padrão.
**Simulação:** `DemoSimulator` age como um Collector para três hosts simulados: o operador pede o código de pareamento, o simulador o troca por uma credencial de máquina (mantida só em memória) e chama `RecordHeartbeat` e `IngestEventsAsMachine` a cada 30 s — os mesmos caminhos de `POST …/heartbeat` e `POST …/events/ingest`, sem escrita por fora. Ao reiniciar, a credencial anterior (cujo segredo se perdeu) é revogada pelo operador antes do novo pareamento, o que aparece no histórico de credenciais. Os eventos (`SYSTEM_BOOT`, `SYSTEM_SERVICE_STATE_CHANGED`) têm `sourceEventId` UUID v5 determinístico por host e janela, então reinícios ou duas instâncias não duplicam nada. A VM de laboratório fica 10 de cada 30 minutos desligada, para o demo mostrar Offline. Como eventos são imutáveis, a geração de eventos para em 20.000 eventos no demo (heartbeats continuam).
**Host real opcional:** o host `aegis-server` só recebe telemetria se o operador do servidor parear o Collector nele de propósito: `npm run demo:pairing-code` (ou `docker compose exec api node apps/api/dist/cli/demo-pairing-code.js`) imprime o código uma vez no terminal; `demo:revoke-server` revoga. Isso refina o ADR-012: o demo pode conter telemetria real **dessa** máquina, limitada ao Event Contract v1 (boot e estado de serviços do systemd), visível a todas as contas enquanto estiver pareada.
**Motivo:** permitir a avaliação acadêmica sem instalar nada e com o produto "vivo", sem atalhos que contornem as regras que a avaliação quer ver funcionando.
**Consequência:** cada inicialização com o demo ligado faz o provisionamento (idempotente) e alguns pareamentos; uma falha só é registrada em log e não derruba a API. Duas instâncias inicializando juntas pela primeira vez poderiam criar dois demos (a stack Compose tem uma instância só); a listagem usa o mais antigo. Quem compartilha a instância vê os dados de exemplo e, se pareado, o boot e os serviços do `aegis-server`.

## ADR-053 — Motor de detecção na ingestão, alertas imutáveis e correlação em incidentes
**Decisão:** o `EventIngestionService` passa a chamar o `DetectionEngine` **na mesma transação**, depois do lock do host e do insert dos eventos novos do lote. Para cada evento novo, as regras habilitadas do workspace com a categoria do evento e cujo escopo inclui o host (`ALL_HOSTS` ou alvo) são avaliadas por `matchesDetection` (`@aegis/domain`, função pura). Semântica: campo ausente nunca satisfaz uma condição (nem `NOT_EQUALS`); strings exatas e sensíveis a maiúsculas; `GREATER_THAN`/`LESS_THAN` só para números; `ALL` exige todas, `ANY` ao menos uma. Cada casamento gera um **alerta** (`alerts`, migration 0012): fato imutável, único por (regra, evento), com a severidade da regra no momento. O alerta é correlacionado ao incidente aberto (`OPEN` ou `INVESTIGATING`) do último alerta da mesma regra no mesmo host criado nos últimos 30 minutos (`CORRELATION_WINDOW_MS`); sem esse incidente, abre-se um novo com origem `DETECTION_ENGINE` (reservada desde o BF 04), a severidade da regra, aquele host e aquela regra. Não há ciclo de vida de alerta: triagem e resolução acontecem no incidente. A API expõe só leitura (`GET …/alerts`, `GET …/alerts/:id`, filtros por severidade, regra, host e incidente). A resposta da ingestão não muda (`received`, `inserted`, `deduplicated`).
**Motivo:** fechar o fluxo evento → regra → alerta → incidente sem um serviço separado nem fila, com atomicidade (evento sem alerta, ou alerta sem incidente, não existem) e sem inventar estados que ninguém operaria.
**Consequência:** só eventos **novos** são avaliados: reenvios idempotentes não geram alertas, e regras criadas ou alteradas depois não reavaliam o passado. Lotes do mesmo host serializam no lock do host, então não abrem incidentes gêmeos (verificado em MySQL com lotes concorrentes). Excluir um incidente mantém seus alertas (`incident_id` vira NULL); uma regra que já gerou alertas não pode ser excluída (409, desabilite-a). Cada lote faz uma consulta de regras por categoria e uma de correlação por regra que casou. No AEGIS DEMO, as regras de exemplo passam a disparar com os eventos simulados.

## ADR-054 — Histórico imutável do incidente, linha do tempo e grafo a partir de uma leitura
**Decisão:** toda mudança de um incidente grava, **na mesma transação**, entradas imutáveis em `incident_activities` (migration 0013): `OPENED` (por uma pessoa ou pelo motor), `STATUS_CHANGED` e `SEVERITY_CHANGED` (valor anterior e novo), `DETAILS_UPDATED` (quais campos: título, descrição, hosts, regras; comparados como conjunto), `INVESTIGATION_LINKED`, `INVESTIGATION_UNLINKED` (também quando a investigação é excluída) e `INVESTIGATION_CLOSED`. O diff é uma função pura de `@aegis/domain`; salvar sem mudar nada não registra nada. A entrada guarda o autor (`USER` com `actor_user_id` → `SET NULL`, ou `DETECTION_ENGINE`) e o título da investigação como estava, então o texto continua legível depois de renomear ou excluir. Excluir o incidente leva o histórico junto (`CASCADE`). A migration faz backfill do que as linhas existentes provam (abertura em `created_at`, vínculos e conclusões de investigações) com o autor `HISTORY_BACKFILL`, porque quem fez nunca foi registrado; mudanças de status anteriores não são inventadas. `GET …/incidents/:id/timeline` (qualquer membro) devolve o incidente, o histórico, os alertas correlacionados (até 200), os eventos dos hosts envolvidos de 15 min antes do primeiro fato até a resolução ou agora (até 100, sem repetir os eventos dos alertas) e as investigações atuais, com indicação quando uma lista foi cortada. A web monta a **linha do tempo** (filtros, contexto dobrado) e o **grafo de relações** (colunas host → evento → regra → alerta → incidente → investigação; relações registradas à mão tracejadas; foco ou hover acendem a linhagem do nó) a partir dessa única resposta, em SVG próprio.
**Motivo:** investigar é reconstruir uma ordem de fatos. Sem histórico, o incidente mostrava só o estado atual. Gravar na transação garante que não existe mudança sem registro, e uma leitura só evita que as duas vistas discordem.
**Consequência:** entradas de uma mesma mudança têm o mesmo instante; a ordem entre elas vem da ordem do `ENUM` (o MySQL ordena pela posição declarada). Alertas e eventos aparecem no instante da máquina, o histórico no instante do servidor; com relógios diferentes, um alerta pode aparecer antes da abertura que ele causou, e isso é a verdade dos dois relógios. Nenhuma biblioteca de grafos foi adicionada: com no máximo 8 alertas desenhados (o resto vira um nó "+N"), o layout em colunas não precisa de força nem de física. Excluir uma investigação deixou de ser uma chamada de repositório e passou a ser uma transação (registra a saída em cada incidente antes de excluir).

## ADR-055 — HTTPS opcional no Nginx, com cabeçalhos de um único arquivo
**Decisão:** o modo HTTP de `compose.yaml` continua o padrão (desenvolvimento e `test:infra`). HTTPS entra por um override, `compose.tls.yaml`, que troca a configuração do Nginx por `nginx.tls.conf`, publica `AEGIS_HTTPS_PORT` e monta `AEGIS_TLS_DIR` (padrão `./certs`, fora do Git). Os blocos `server` vivem em `templates/aegis-tls.conf.template`, renderizado pelo entrypoint da imagem oficial com `envsubst` limitado a `^AEGIS_` (nome do servidor, porta pública, caminhos do certificado) num `tmpfs`, porque o entrypoint ignora a renderização se a pasta de saída não for gravável. A porta 80 só redireciona (`301`, preservando caminho e query) e serve `/.well-known/acme-challenge/` para o HTTP-01. A 443 aceita TLS 1.2 e 1.3 com as suítes "intermediate" da Mozilla, sem tickets de sessão, HTTP/2 e HSTS de um ano só para o host. CSP e demais cabeçalhos saem de `snippets/security-headers.conf` e as rotas de `snippets/aegis-routes.conf`, incluídos pelos dois modos. O certificado vem de `npm run tls:self-signed` (EC P-256, 30 dias, chave `0600`, nunca exibida) ou do certbot (`--profile letsencrypt`, imagem fixada); o passo a passo está em [HOSPEDAGEM.md](HOSPEDAGEM.md).
**Motivo:** TLS era o item aberto da fase 13 e o pré-requisito da hospedagem pública. Um override mantém o caminho de desenvolvimento simples; um arquivo único de cabeçalhos impede que a CSP de um modo divirja da do outro.
**Consequência:** `test:infra` passa a recriar o Nginx com o override, gerar o certificado com o script do projeto e verificar o redirecionamento, o desafio ACME fora dele, HSTS e a mesma CSP no SPA e na API, TLS 1.3 por padrão, TLS 1.2 aceito e TLS 1.1 recusado **pelo servidor** (`openssl s_client` com o nível de segurança rebaixado oferece 1.1 de verdade e precisa receber o alerta 70; o cliente Node sozinho não provaria isso), e a cadeia validada contra o próprio certificado, nunca com a verificação desligada. O Collector só aceita certificados válidos para o sistema: com certificado autoassinado, a máquina dele precisa confiar no `fullchain.pem`. A hospedagem pública da demonstração continua planejada.

