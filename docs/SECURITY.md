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
| Telemetria de hosts | coleta excessiva/privada | PLANNED: allowlist de eventos, sem payload |
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

### Limitações conhecidas

- Logout é local; tokens emitidos continuam válidos até expirar (sem revogação).
- Troca de senha não invalida sessões existentes.
- Rate limit em memória zera quando a API reinicia e não é compartilhado entre instâncias.

## Fronteiras

```
Internet/LAN ─► nginx (aegis_edge) ─► web/api (aegis_application, internal) ─► mysql (aegis_data, internal)
```

## Agent security

Agentes seguem `AGENTS.md`: não leem `.env`, `.env.*` (exceto `.env.example`),
`secrets/**`, `credentials/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.

## MCP security

- Sem ferramenta de shell arbitrário; apenas `npm run typecheck` e `npm run test` fixos.
- Leitura limitada a allowlist de diretórios; `resolveRepoPath` bloqueia traversal e caminhos protegidos.
- Saída de scripts passa por `redactSecrets`.
- `aegis_security_check` reporta arquivo/linha/regra, nunca o valor encontrado.

## Permissões futuras do collector

Executará com o mínimo necessário para carregar programas eBPF (capabilities
específicas como `CAP_BPF`/`CAP_PERFMON` em vez de root completo, quando possível),
como serviço visível e documentado, com desinstalação simples.

## Privacidade

Coleta de metadados (pid, ppid, executável, caminho, endereço/porta), nunca de
conteúdo: sem payload de rede, sem conteúdo de arquivos, sem teclado.

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

## Workspace de demonstração e pareamento (planejado)

- **AEGIS DEMO:** somente dados gerados/curados; nenhuma telemetria real; acesso de visitantes preferencialmente somente leitura (ADR-012).
- **Pareamento:** token temporário com expiração curta, revogável, escopo limitado à ingestão de um workspace, armazenado apenas como hash e com auditoria de uso (ADR-013).

## Limites de resposta e IA

- **Sem resposta remota na primeira versão** (ADR-011): o Collector apenas observa; não executa comandos recebidos da API.
- **IA** (ADR-014): recebe somente incidentes estruturados; não acessa hosts; não altera evidências; nunca dispara ações. Resultados são exibidos como análise, não como fato.
