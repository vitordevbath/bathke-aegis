# Segurança

## Escopo defensivo

Bathke Aegis monitora apenas máquinas próprias, de laboratório ou explicitamente
autorizadas. Toda coleta futura será explícita, documentada, auditável, visível,
configurável e removível.

## Threat model inicial

| Ativo | Ameaça | Mitigação atual / planejada |
| --- | --- | --- |
| Credenciais de usuários | vazamento, brute force, enumeração | CURRENT: Argon2id, rate limit por IP em `/auth/*`, erro de login genérico + verificação Argon2 também para email inexistente |
| Tokens JWT | roubo, forja | CURRENT: HS256 com segredo validado no startup, `alg` fixo, `iss`/`aud`/`exp` verificados, TTL 1 h; token em localStorage mitigado por CSP (ADR-017). PLANNED: revogação |
| Banco MySQL | acesso direto | CURRENT: porta 3306 não publicada; rede `aegis_data` interna |
| API | exposição direta | CURRENT: somente Nginx publica porta |
| Telemetria de hosts | coleta excessiva/privada | CURRENT: Event Contract v1 (só metadados), propriedades desconhecidas rejeitadas; Collector coleta só SYSTEM (boot e estado de serviços), sem conteúdo |
| Credenciais de máquina | roubo, reuso, escalada, troca de host | CURRENT: segredos de 256 bits só como hash, código de uso único e curta duração (cancelável), escopos mínimos por host, rotação e revogação imediatas e confirmadas dentro da transação, limites persistentes por IP e por host |
| Credencial no host Linux | leitura por outro usuário, vazamento em logs/argumentos | CURRENT: arquivo `0600` em diretório `0700`, sem seguir links, nunca em argumentos, logs ou na fila; não criptografado (ver Aegis Collector) |
| Segredos no repositório | commit acidental | CURRENT: `.gitignore`, `.dockerignore`, MCP secret guard |
| Agentes de IA | leitura/exfiltração de segredos | CURRENT: AGENTS.md + MCP restrito |

## Segredos

- Somente `.env.example` (valores fictícios) é versionado.
- `compose.yaml` exige `MYSQL_PASSWORD`/`MYSQL_ROOT_PASSWORD`/`JWT_SECRET` do ambiente; não há defaults de senha nem de segredo.
- O placeholder de `JWT_SECRET` do `.env.example` é rejeitado pela API no startup.
- Testes geram segredos em tempo de execução; o CI usa credenciais descartáveis apenas para o MySQL de teste.
- Segredos nunca aparecem em logs, docs, fixtures, testes, commits, issues ou saída do MCP.
- `loadEnv` reporta apenas nomes de variáveis inválidas, nunca valores.

## Autenticação e usuários (CURRENT, BF 01)

- **Senhas:** Argon2id (m=64 MiB, t=3, p=4), salt aleatório embutido no hash. Política: 10–128 caracteres com minúscula, maiúscula, número e caractere especial, validada no web e — como autoridade — na API.
- **Login:** erro único "Email ou senha inválidos." para email inexistente e senha errada; o caminho de email inexistente também executa uma verificação Argon2 para não revelar contas pelo tempo de resposta.
- **Cadastro:** responde 409 para email/CPF já cadastrados (exigência funcional). Isso permite descobrir se um email existe; a mitigação é o rate limit em `/auth/register`.
- **JWT:** ver ADR-016. Rotas protegidas exigem `Authorization: Bearer`, verificam assinatura/expiração/claims e recarregam o usuário (inexistente → 401).
- **Autorização:** o usuário só lê/edita a si mesmo (`/users/me`); identidade vem do token; `id`/`userId`/`email` no corpo são rejeitados. Não existe conta universal, superusuário ou bypass.
- **Rate limiting:** `@fastify/rate-limit` em memória, por IP, `AUTH_RATE_LIMIT_MAX` (padrão 10/min) em `/auth/login` e `/auth/register`. A API confia em exatamente um proxy (Nginx) para obter o IP do cliente. Uma instância só; sem store distribuído.
- **Dados expostos:** respostas usam mapeamento explícito (`mappers.ts`); `password_hash` nunca sai da API. CPF é retornado apenas ao próprio usuário.
- **Logs:** Fastify registra método/URL/status, nunca corpo nem cabeçalhos. Erros inesperados são logados só com tipo, código e stack frames — a mensagem de drivers pode conter parâmetros (hash, CPF) e é descartada. Respostas de erro nunca contêm stack trace ou SQL.
- **Token no navegador:** localStorage por exigência acadêmica (ADR-017), com CSP estrita no Nginx.

### Isolamento entre workspaces (CURRENT, BF 02)

- Toda rota de recurso é autenticada e passa por `WorkspaceAccess` antes de qualquer consulta.
- Workspace de que o usuário não é membro, recurso inexistente, recurso de outro workspace e ID malformado produzem o **mesmo** 404 ("Recurso não encontrado."), sem IDs, nomes ou metadados alheios (ADR-020).
- Repositórios só oferecem operações escopadas por workspace; o `workspaceId` vem da rota e da membership, nunca do corpo.
- Campos controlados pelo sistema (workspace, fatos do Collector, estado de conexão, timestamps) são rejeitados no corpo (400) — sem mass assignment (ADR-021).
- Escrita restrita a OWNER; demais papéis ainda não têm permissões (deny-by-default).
- Busca usa `LIKE` parametrizado com `%`/`_`/`\` escapados.
- O workspace ativo salvo no navegador (`aegis.workspace.active`) é só preferência: um ID que não pertence mais ao usuário é ignorado, e a API decide.
- Nenhuma telemetria é simulada: sem Collector, hosts são "Não pareado".

### Definições de regras de detecção (CURRENT, BF 03)

- Regras são dados declarativos (ADR-022): sem JavaScript, `eval`, SQL, shell, regex ou templates. Campos e operadores vêm de allowlists; valores são tipados e limitados; propriedades desconhecidas são rejeitadas, inclusive dentro da definição.
- O mesmo validador roda na API (autoridade), no formulário web e ao reidratar do banco — uma definição corrompida no banco é recusada, não interpretada.
- Nenhuma regra é executada nesta fase; não há eventos, alertas ou worker em segundo plano.
- Targets só apontam para hosts do mesmo workspace (verificado na transação que os grava); host alheio e host inexistente recebem a mesma resposta (ADR-023).

### Incidentes (CURRENT, BF 04)

- Incidentes são registros manuais: o cliente não escolhe `origin` (sempre `MANUAL`), `status` inicial, `resolvedAt`, ids, workspace ou timestamps — todos rejeitados no cadastro (400). `DETECTION_ENGINE` é reservado e nenhum código o grava (ADR-025).
- Hosts e regras relacionados são validados no workspace do incidente, na mesma transação que grava as relações; host ou regra de outro workspace e inexistente recebem o mesmo 400; qualquer falha desfaz tudo (ADR-024).
- Host envolvido ou regra relacionada não podem ser excluídos (409 com orientação; FK `RESTRICT` cobre corridas). A existência no workspace é conferida antes do vínculo, então um id alheio continua 404 e o 409 nunca confirma recurso de outro tenant.
- Transições de status são decididas só pelo domínio; transição inválida e edição de incidente encerrado → 409 `INVALID_STATE` (ADR-026). O web apenas exibe as `availableTransitions` recebidas.
- Descrição é texto puro (até 5000 caracteres): armazenada como digitada e renderizada escapada pelo React com `white-space: pre-wrap`, nunca como HTML. Validado em navegador real: `<script>` digitado aparece como texto.
- Nenhuma ação de resposta existe (matar processo, bloquear IP, isolar host, firewall). Exclusão é física enquanto não há evidência imutável (ADR-027).

### Investigações (CURRENT, BF 05)

- O cliente não escolhe `status` inicial (sempre `OPEN`), `conclusion` no cadastro, `closedAt`, ids, workspace ou timestamps — todos rejeitados (400).
- Incidentes agrupados são validados no workspace da investigação, na mesma transação que grava as relações; incidente de outro workspace e inexistente recebem o mesmo 400; qualquer falha desfaz tudo (ADR-028). A lista nunca pode ficar vazia.
- Incidente agrupado não pode ser excluído (409 com orientação; FK `RESTRICT` cobre corridas). O incidente é buscado no workspace antes da checagem de vínculo: um id alheio continua 404 e o 409 nunca confirma recurso de outro tenant (ADR-030).
- "Não encerra sem conclusão" é regra do domínio (`Investigation.transitionTo`), não só do formulário: a API responde 400 no campo `conclusion`. Encerrada, a investigação é somente leitura (409 `INVALID_STATE`) — ADR-029.
- Descrição e conclusão são texto puro (até 5000 / 10000 caracteres), renderizadas escapadas pelo React, nunca como HTML; testado com `<script>` e `onerror`.
- Conclusão é humana: nenhuma IA gera, resume ou sugere conclusões nesta etapa. Exclusão é física enquanto não há audit log (ADR-031).

### Eventos (CURRENT, BF 06)

- **Sem dados sensíveis por construção:** o Event Contract v1 só tem metadados. Linha de comando, argumentos, ambiente, senhas, tokens, segredos, teclas, área de transferência, conteúdo de arquivos ou mensagens e payload de rede não existem no contrato; propriedades desconhecidas em qualquer nível são rejeitadas (400), nunca descartadas em silêncio. Persiste-se só a representação validada.
- **Imutável:** sem `PUT`/`DELETE` de evento; host com eventos não pode ser excluído (409, FK `RESTRICT`), checado só depois de confirmar que o host é do workspace (host alheio continua 404) — ADR-036.
- **Tenant:** `workspaceId` e `hostId` vêm da rota autenticada, nunca do payload; host de outro workspace e inexistente recebem o mesmo 404; leitura de evento alheio é 404.
- **Ingestão por credencial de máquina** (ADR-042): JWT de usuário é recusado; não marca o host como `ONLINE`. Limites: 1–100 eventos por lote, corpo ≤ 1 MiB (413), `INGEST_RATE_LIMIT_MAX` lotes/min por IP (separado do limite de login), `occurredAt` no máximo 5 min no futuro.
- **Idempotência sem sobrescrita:** reuso de `sourceEventId` com conteúdo diferente → 409 `EVENT_ID_CONFLICT` e rollback; o evento original nunca é alterado (ADR-034).
- **Logs:** a ingestão registra só contagens e duração — nunca payload, endereços, dados de processo ou `sourceEventId`.

### Identidade de máquina (CURRENT, BF 07)

- **Separação:** JWT humano e credencial de máquina têm formatos incompatíveis e contextos distintos. Credencial de máquina recebe 401 em toda rota humana (coberto por teste que percorre as rotas); JWT recebe 401 na ingestão (ADR-037).
- **Segredos:** código e credencial têm 256 bits (`randomBytes`) e são gravados só como SHA-256, comparados em tempo constante. Aparecem uma única vez, em resposta `no-store`; consultas administrativas têm allowlist de campos e nunca devolvem segredo nem hash (ADR-038, ADR-039).
- **Uso único:** transação com lock do host, releitura `FOR UPDATE`, `UPDATE` condicional e índices `UNIQUE` no banco. Dez requisições simultâneas em MySQL real criam exatamente uma credencial.
- **Escopo:** `events:ingest` e `host:heartbeat` (BF 08), verificados em cada caso de uso. A máquina não lê dados nem administra recursos (ADR-040, ADR-044). Credenciais emitidas antes do BF 08 não ganham `host:heartbeat` automaticamente: só uma rotação feita por OWNER emite o conjunto atual.
- **Isolamento:** workspace e host vêm do challenge ou da credencial, nunca do cliente. URL divergente responde o mesmo 404 de host inexistente; FK composta impede vínculo entre host e workspace diferentes no banco.
- **Erros genéricos:** todo código recusado recebe o mesmo 401; toda credencial inválida recebe o mesmo 401 do JWT inválido. Id desconhecido custa uma comparação, e revogação só é distinguível por quem tem o segredo real.
- **Abuso:** `PAIR_RATE_LIMIT_MAX` por IP/min; `PAIR_INVALID_ATTEMPTS_MAX` códigos recusados por IP em janela de `PAIR_INVALID_ATTEMPTS_WINDOW_SECONDS` — ambos em MySQL (`rate_limit_counters`), compartilhados entre instâncias e preservados após reinício, com o endereço guardado só como HMAC (ADR-046); 429 traz `Retry-After`. `PAIR_CODES_PER_HOST_PER_HOUR` por host; um código aberto por host, cancelável pelo OWNER. A ingestão mantém `INGEST_RATE_LIMIT_MAX` e o heartbeat `HEARTBEAT_RATE_LIMIT_MAX`. Todos expiram: não há bloqueio permanente. O IP é o que o Nginx anexou ao `X-Forwarded-For` (único proxy confiável); valores escritos pelo cliente nesse cabeçalho são ignorados (teste `test/http/trust-proxy.test.ts`).
- **Revogação (ADR-045):** ingestão e heartbeat releem a credencial com leitura de bloqueio dentro da transação, depois do lock do host que a revogação também trava. Depois que a revogação retorna, nenhuma operação com a credencial é confirmada; testado em MySQL real com espera de lock e rajadas concorrentes.
- **Heartbeat (ADR-043):** só `last_seen_at` muda, com o relógio do servidor; o corpo deve ser vazio (qualquer campo → 400), o host vem da credencial (outro host → 404) e nenhum evento é criado. ONLINE/OFFLINE são derivados, nunca gravados.
- **Auditoria:** linhas `audit` no log estruturado para código solicitado, pareamento concluído ou recusado (com motivo, inclusive expirado), rotação, revogação e autenticação de máquina inválida, com ids internos e horário. Nunca contêm código, token, segredo, hash ou cabeçalho `Authorization` (coberto por teste que captura o log). Não há tabela de auditoria.
- **Frontend:** código e credencial ficam só no estado do componente, nunca em `localStorage`; as mutações usam `gcTime: 0`, para não permanecerem no cache do TanStack Query, e o valor some ao sair da tela.
- **Aegis MCP:** `aegis_security_check` e a redação de saída reconhecem o formato de tokens e códigos do Aegis.

### Aegis Collector (CURRENT, BF 08)

- **Execução explícita:** o usuário roda `aegis-collector run` em primeiro plano. Não há instalador, serviço, persistência automática, elevação de privilégios ou ocultação. Encerra com Ctrl+C/SIGTERM preservando a fila.
- **Sem privilégios:** lê `/proc/sys/kernel/random/boot_id`, `/proc/stat` e `systemctl list-units` como usuário comum. `systemctl` é chamado por caminho absoluto fixo, argumentos fixos, sem shell, com ambiente limpo, timeout e limite de saída. Nada vindo do servidor ou do usuário vira comando; o Collector não aceita instruções remotas (ADR-011).
- **Coleta mínima (ADR-048):** somente `SYSTEM_BOOT` e `SYSTEM_SERVICE_STATE_CHANGED` (nome da unidade e estado). Nunca linhas de comando, argumentos, ambiente, conteúdo de arquivos ou logs, mensagens, teclas, senhas ou tráfego.
- **Credencial local:** `~/.config/aegis-collector/config.json`, `0600` em diretório `0700`, dono = usuário; links simbólicos, donos diferentes e permissões abertas são recusados (o erro indica o `chmod` correto); escrita atômica que nunca sobrescreve uma configuração existente (exceto `replace-credential`, explícito e validado). Protege contra outros usuários locais sem privilégio; **não** protege contra root nem contra código da mesma conta, e o arquivo **não é criptografado**.
- **Segredos fora de argumentos e logs:** código e credencial são lidos do terminal sem eco (ou da entrada padrão); `--code`/`--token` são recusados sem ecoar o valor. O tipo `Secret` não tem `Display` e seu `Debug` oculta o valor; `status` mostra só o rótulo público `aegis_agent_<8 hex>`. Testes capturam todo o log dos fluxos de pareamento, envio, 401 e rotação e verificam que nenhum segredo aparece.
- **Transporte:** TLS sempre verificado pelas raízes do sistema (`rustls-platform-verifier`), sem opção de desativar; HTTPS obrigatório fora de loopback; URL sem credenciais, query ou fragmento; redirecionamentos não seguidos (teste prova que a credencial não chega ao destino); timeouts e respostas limitadas a 64 KiB.
- **Fila local:** SQLite `0600`, sem credenciais, limitada (10 000 eventos / 16 MiB); cheia, recusa e conta o que não coube (ADR-047).
- **Revogação:** 401 encerra a transmissão (exit 3) sem laço de tentativas.

### AEGIS DEMO (ADR-052)

- Toda conta é `VIEWER` no demo: a API recusa qualquer escrita (403) e o painel não oferece ações de escrita.
- O dono do demo é uma conta de sistema sem senha conhecida (256 bits aleatórios, descartados após o hash); o endereço usa o domínio reservado `.invalid`.
- O simulador usa credenciais de máquina reais, com o mesmo escopo mínimo, guardadas só em memória; a cada reinício a anterior é revogada (auditável no histórico).
- O host real `aegis-server` é opcional: o código de pareamento só é emitido por quem executa comandos no servidor, aparece uma vez no terminal e nunca em log. Enquanto pareado, boot e estado de serviços dessa máquina ficam visíveis a todas as contas. `DEMO_WORKSPACE=off` desliga o demo inteiro.

### Limitações conhecidas

- Login, cadastro, ingestão e heartbeat têm rate limit em memória: zera quando a API reinicia e não é compartilhado entre instâncias (o do pareamento é persistente, ADR-046).
- Quem compartilha IP com um atacante pode ter o pareamento pausado até a janela expirar. Trocar o `JWT_SECRET` zera os contadores persistentes.
- Logout é local; tokens emitidos continuam válidos até expirar (sem revogação).
- Troca de senha não invalida sessões existentes.
- A credencial do Collector é protegida só por permissões do sistema de arquivos (sem criptografia, sem keyring).
- Mudanças de serviço ocorridas com o Collector parado, ou mais curtas que o intervalo de 15 s, não são reportadas; `occurredAt` de uma mudança é a hora em que foi observada.
- Hosts que já tiveram credencial não podem ser excluídos (sem arquivamento nesta fase).

## Fronteiras

```
Internet/LAN ─► nginx (aegis_edge) ─► web/api (aegis_application, internal) ─► mysql (aegis_data, internal)
```

Verificado automaticamente por `npm run test:infra` (CI, job `infrastructure`) contra os
containers reais: só o nginx tem porta publicada; nginx e web não resolvem `mysql`; a API não
alcança a internet; os headers (`Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`) e a ausência de versão do nginx são conferidos em `/` e
`/api/`. O teste usa credenciais descartáveis geradas em runtime, nunca lê `.env` e não imprime
a configuração resolvida.

## Agent security

Agentes seguem `AGENTS.md`: não leem `.env`, `.env.*` (exceto `.env.example`),
`secrets/**`, `credentials/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.

## MCP security

- Sem ferramenta de shell arbitrário; apenas `npm run typecheck` e `npm run test` fixos.
- Leitura limitada a allowlist de diretórios; `resolveRepoPath` bloqueia traversal e caminhos protegidos.
- Saída de scripts passa por `redactSecrets`.
- `aegis_security_check` reporta arquivo/linha/regra, nunca o valor encontrado.

## Permissões do Collector

CURRENT: nenhuma além das de um usuário comum. PLANNED (eBPF): o mínimo necessário para carregar
programas eBPF (capabilities específicas como `CAP_BPF`/`CAP_PERFMON` em vez de root completo, quando
possível), como serviço visível e documentado, com desinstalação simples — exigirá ADR próprio.

## Privacidade

CURRENT: boot e estado de serviços (SYSTEM). PLANNED: metadados de processo e rede (pid, ppid,
executável, endereço/porta). Nunca conteúdo: sem payload de rede, sem conteúdo de arquivos, sem teclado.

## Non-Goals

O projeto **não** implementa e não aceitará contribuições de:

- keylogging ou captura de entrada;
- captura de senhas ou roubo de credenciais;
- captura oculta de conteúdo privado / spyware;
- persistência maliciosa ou ocultação do agente;
- evasão de EDR/AV ou bypass de controles de segurança;
- exploração automatizada ou invasão de terceiros;
- execução remota não autorizada;
- criptografia própria.

## Workspace de demonstração (planejado)

- **AEGIS DEMO:** somente dados gerados/curados; nenhuma telemetria real; acesso de visitantes preferencialmente somente leitura (ADR-012).

## Limites de resposta e IA

- **Sem resposta remota na primeira versão** (ADR-011): o Collector apenas observa; não executa comandos recebidos da API.
- **IA** (ADR-014): recebe somente incidentes estruturados; não acessa hosts; não altera evidências; nunca dispara ações. Resultados são exibidos como análise, não como fato.
