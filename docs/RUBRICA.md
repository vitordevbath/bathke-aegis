# Rubrica — matriz rastreável

Estados: `PASS` · `IN_PROGRESS` · `TODO` · `BLOCKED`.
**PASS exige implementação e evidência**, nunca apenas documentação.
A ferramenta `aegis_rubric_status` do Aegis MCP avalia parte destes itens automaticamente.

## Usuário e autenticação

Rotas da API sem o prefixo `/api` (removido pelo Nginx). Testes HTTP usam `app.inject`;
os testes `integration/*` rodam contra MySQL 8.4 real (CI e local via `TEST_DATABASE_URL`).

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Cadastro de usuário | PASS | `apps/api/src/application/use-cases/register-user.ts`, `presentation/http/routes/auth.route.ts`, `apps/web/src/pages/RegisterPage.tsx` | `POST /auth/register` → 201; cria User + Workspace pessoal + Membership OWNER numa transação | `apps/api/test/http/auth.test.ts`, `test/application/use-cases.test.ts` (rollback), `test/integration/mysql-repositories.test.ts` (rollback em MySQL), `apps/web/test/auth-flows.test.tsx` | Sucesso redireciona para `/login` (sem login automático) |
| Login / autenticação | PASS | `use-cases/authenticate-user.ts`, `presentation/http/authenticate.ts`, `apps/web/src/features/auth/AuthContext.tsx` | `POST /auth/login` → 200 com token; erro genérico "Email ou senha inválidos."; rotas protegidas exigem Bearer e usuário existente | `test/http/auth.test.ts`, `test/http/users.test.ts`, `apps/web/test/auth-flows.test.tsx` | Email inexistente também paga uma verificação Argon2 (anti-enumeração por tempo) |
| JWT | PASS | `apps/api/src/infrastructure/security/jose-token-service.ts`, `shared/env.ts` | HS256; claims `sub`, `typ`, `iss`, `aud`, `iat`, `exp`; segredo validado no startup (sem fallback) | `test/security.test.ts` (expirado, outra chave, `alg: none`, adulterado), `test/env.test.ts` | Stateless: logout é local; sem revogação (ADR-016) |
| Validação de email | PASS | `packages/domain/src/email.ts`, `packages/contracts/src/fields.ts` | trim + minúsculas + regex; único no banco (`users_email_unique`) | `packages/domain/test/value-objects.test.ts`, `test/http/auth.test.ts` (409 case-insensitive) | Mesma regra no web (Zod) e na API |
| Validação de CPF | PASS | `packages/domain/src/cpf.ts` | formato, dígitos repetidos, dois dígitos verificadores; armazenado com 11 dígitos; único (`users_cpf_unique`) | `packages/domain/test/value-objects.test.ts`, `test/http/auth.test.ts`, `test/http/users.test.ts` | Fixtures sintéticas (`test/support/fixtures.ts`) |
| Validação de senha + confirmação | PASS | `packages/domain/src/password-policy.ts`, `packages/contracts/src/auth.ts`, `users.ts` | 10–128 caracteres, minúscula, maiúscula, número, especial; confirmação validada no web **e** na API (cadastro e edição) | `packages/contracts/test/schemas.test.ts`, `test/http/auth.test.ts`, `test/http/users.test.ts`, `apps/web/test/auth-flows.test.tsx` | Checklist ao vivo no formulário usa as mesmas regras |
| Senha com hash seguro | PASS | `apps/api/src/infrastructure/security/argon2-password-hasher.ts` | Argon2id, m=64 MiB, t=3, p=4 (RFC 9106); hash nunca retornado nem logado | `test/security.test.ts`, `test/http/auth.test.ts` (resposta sem hash) | |
| Usuário só edita a si mesmo | PASS | `presentation/http/routes/users.route.ts`, `use-cases/update-current-user.ts` | só `GET/PUT /users/me`; identidade vem do JWT; `id`/`userId` no corpo → 400; não existe `/users/:id` | `test/http/users.test.ts` | Troca de senha exige a senha atual |
| Email imutável na edição | PASS | `packages/contracts/src/users.ts`, `infrastructure/db/drizzle-repositories.ts`, `apps/web/src/pages/ProfilePage.tsx` | `email` no corpo → 400 "O email não pode ser alterado."; UPDATE não escreve email; campo readonly/disabled no web | `test/http/users.test.ts`, `test/integration/mysql-repositories.test.ts`, `apps/web/test/auth-flows.test.tsx` | |
| Workspace pessoal + Membership OWNER | PASS | `apps/api/src/domain/workspace.ts`, `membership.ts`, `apps/api/drizzle/0000_init_auth_user_workspace.sql` | criados no cadastro; PK composta impede membership duplicada; FKs reais | `test/integration/mysql-repositories.test.ts` | Somente OWNER tem comportamento; demais papéis reservados (ADR-009) |
| Token em localStorage | PASS | `apps/web/src/lib/auth-storage.ts` | chave única `aegis.auth.token`; acesso centralizado | `apps/web/test/auth-flows.test.tsx` | Riscos e mitigação (CSP) em ADR-017 |

## CRUDs (User não conta)

Todos os recursos pertencem a um **Workspace** (ADR-009); usuários os acessam por Membership:

```
Workspace
├── Hosts
├── Detection Rules
├── Incidents
└── Investigations
```

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Hosts CRUD | PASS | `apps/api/src/presentation/http/routes/hosts.route.ts`, `application/use-cases/hosts/*`, `apps/web/src/pages/hosts/*` | `POST/GET /workspaces/:workspaceId/hosts`, `GET/PUT/DELETE /workspaces/:workspaceId/hosts/:hostId` (201/200/200/200/204); telas `/hosts`, `/hosts/novo`, `/hosts/:hostId`, `/hosts/:hostId/editar` | `apps/api/test/http/hosts.test.ts`, `test/application/hosts.test.ts`, `test/integration/hosts.mysql.test.ts`, `apps/web/test/hosts.test.tsx` | Host manual, sem Collector; campos de telemetria não editáveis (ADR-021) |
| Detection Rules CRUD | PASS | `apps/api/src/presentation/http/routes/detection-rules.route.ts`, `application/use-cases/detection-rules/*`, `packages/domain/src/detection-rule-schema.ts`, `apps/web/src/pages/rules/*` | `POST/GET /workspaces/:workspaceId/detection-rules`, `GET/PUT/DELETE /workspaces/:workspaceId/detection-rules/:ruleId` (201/200/200/200/204); telas `/regras`, `/regras/nova`, `/regras/:ruleId`, `/regras/:ruleId/editar`; construtor de condições e seletor de hosts | `apps/api/test/http/detection-rules.test.ts`, `test/application/detection-rules.test.ts`, `test/integration/detection-rules.mysql.test.ts`, `test/domain/detection-rule.test.ts`, `packages/domain/test/detection-rule-schema.test.ts`, `apps/web/test/rules.test.tsx` | Configuração apenas: nenhuma regra é executada (motor inexistente). DSL declarativa v1 (ADR-022) |
| Incidents CRUD | PASS | `apps/api/src/presentation/http/routes/incidents.route.ts`, `application/use-cases/incidents/*`, `apps/api/src/domain/incident.ts`, `packages/domain/src/incident-rules.ts`, `apps/web/src/pages/incidents/*` | `POST/GET /workspaces/:workspaceId/incidents`, `GET/PUT/DELETE /workspaces/:workspaceId/incidents/:incidentId` (201/200/200/200/204); telas `/incidentes`, `/incidentes/novo`, `/incidentes/:incidentId`, `/incidentes/:incidentId/editar`; botões de status no detalhe | `apps/api/test/http/incidents.test.ts`, `test/application/incidents.test.ts`, `test/integration/incidents.mysql.test.ts`, `test/domain/incident.test.ts`, `packages/domain/test/incident-rules.test.ts`, `packages/contracts/test/incidents.test.ts`, `apps/web/test/incidents.test.tsx` | Registro **manual**: origem `MANUAL` definida pelo servidor; sem Alert, evento ou correlação. Ciclo de vida no domínio (ADR-024–027) |
| Investigations CRUD | PASS | `apps/api/src/presentation/http/routes/investigations.route.ts`, `application/use-cases/investigations/*`, `apps/api/src/domain/investigation.ts`, `packages/domain/src/investigation-rules.ts`, `apps/web/src/pages/investigations/*` | `POST/GET /workspaces/:workspaceId/investigations`, `GET/PUT/DELETE /workspaces/:workspaceId/investigations/:investigationId` (201/200/200/200/204); telas `/investigacoes`, `/investigacoes/nova`, `/investigacoes/:investigationId`, `/investigacoes/:investigationId/editar`; botões de status e painel de encerramento com conclusão no detalhe | `apps/api/test/http/investigations.test.ts`, `test/application/investigations.test.ts`, `test/integration/investigations.mysql.test.ts`, `test/domain/investigation.test.ts`, `packages/domain/test/investigation-rules.test.ts`, `packages/contracts/test/investigations.test.ts`, `apps/web/test/investigations.test.tsx`; fluxo validado em Firefox 156 real contra a stack Docker | Caso humano que agrupa ≥ 1 incidente (N:N). Encerrar exige conclusão; encerrada é somente leitura; incidente agrupado protegido (ADR-028–031). Sem IA |
| Paginação | PASS | `packages/contracts/src/pagination.ts`, `presentation/http/mappers.ts` (`toPaginatedResponse`), `apps/web/src/components/Pagination.tsx`; reutilizada por Hosts, Detection Rules, Incidents e Investigations | `?page=&pageSize=&q=`; padrão 1/20, `pageSize` ≤ 100; `{ items, pagination: { page, pageSize, total, totalPages } }`; ordem `created_at DESC, id DESC` | `test/http/{hosts,detection-rules,incidents,investigations}.test.ts` (25 itens → 10/10/5, inválidos → 400), `test/integration/{hosts,detection-rules,incidents,investigations}.mysql.test.ts`, `apps/web/test/{hosts,rules,incidents,investigations}.test.tsx` | Regras acrescentam `severity`, `eventCategory`, `enabled`; incidentes, `severity`, `status`, `origin`; investigações, `status` (busca também na conclusão) — sem novo formato |
| Relacionamentos | PASS | `apps/api/drizzle/0003_detection_rule_targets.sql`, `0005_incident_relations.sql`, `infrastructure/db/schema.ts`, `application/use-cases/detection-rules/detection-rule-view.ts`, `application/use-cases/incidents/incident-view.ts`, `0007_investigation_incidents.sql`, `application/use-cases/investigations/investigation-view.ts` | DetectionRule N–N Host (`detection_rule_targets`), Incident N–N Host (`incident_hosts`, mínimo 1) , Incident N–N DetectionRule (`incident_detection_rules`, opcional) e Investigation N–N Incident (`investigation_incidents`, mínimo 1): PK composta, CASCADE a partir do dono, RESTRICT para host, regra e incidente (→ 409); referências validadas no mesmo workspace dentro da transação; Workspace 1–N Host, DetectionRule, Incident e Investigation | `test/integration/{detection-rules,incidents,investigations}.mysql.test.ts` (FKs, cascade, restrict, rollback), `test/http/{detection-rules,incidents,investigations}.test.ts` (recurso de outro workspace, 409 ao excluir vinculado), `test/application/{detection-rules,incidents,investigations}.test.ts` | ADR-023, ADR-024, ADR-028, ADR-030 |
| Recurso inexistente (404) | PASS | `application/use-cases/{hosts,detection-rules,incidents,investigations}/*`, `apps/web/src/pages/{hosts/HostNotFound,rules/RuleNotFound,incidents/IncidentNotFound,investigations/InvestigationNotFound}.tsx` | GET/PUT/DELETE de host, regra, incidente ou investigação inexistente (ou id malformado) → 404; de outro workspace → mesmo 404 | `test/http/hosts.test.ts`, `test/http/detection-rules.test.ts`, `test/http/incidents.test.ts`, `test/http/investigations.test.ts` ("404 for a missing or malformed investigation on GET, PUT and DELETE"), `apps/web/test/{hosts,rules,incidents,investigations}.test.tsx` | |
| Autorização por CRUD | PASS | `apps/api/src/application/workspace-access.ts` | Hosts, Detection Rules, Incidents e Investigations: membership obrigatória, escrita só OWNER, isolamento entre workspaces | `test/http/{hosts,detection-rules,incidents,investigations}.test.ts` ("multi-tenant isolation"), `test/application/{hosts,detection-rules,incidents,investigations}.test.ts` | 4 de 4 CRUDs |
| Rotas autenticadas (CRUD) | PASS | `hosts.route.ts`, `detection-rules.route.ts`, `incidents.route.ts`, `investigations.route.ts` (`preHandler` `authenticate`) | todas as rotas de hosts, regras, incidentes e investigações exigem Bearer | `test/http/hosts.test.ts` ("hosts: authentication"), `test/http/detection-rules.test.ts` ("detection rules: authentication"), `test/http/incidents.test.ts` ("incidents: authentication"), `test/http/investigations.test.ts` ("investigations: authentication") | |
| Telas separadas de criação e edição | PASS | `apps/web/src/pages/hosts/{Create,Edit}HostPage.tsx`, `pages/rules/{Create,Edit}RulePage.tsx`, `pages/incidents/{Create,Edit}IncidentPage.tsx`, `pages/investigations/{Create,Edit}InvestigationPage.tsx`; formulários `HostForm`, `DetectionRuleForm`, `IncidentForm`, `InvestigationForm` | `/hosts/novo` e `/hosts/:hostId/editar`; `/regras/nova` e `/regras/:ruleId/editar`; `/incidentes/novo` e `/incidentes/:incidentId/editar`; `/investigacoes/nova` e `/investigacoes/:investigationId/editar` | `apps/web/test/{hosts,rules,incidents,investigations}.test.tsx` | Status de incidente e investigação muda no detalhe, não no formulário |

## Frontend / componentização

| Requisito | Status | Evidência | Testes |
| --- | --- | --- | --- |
| Componentes reutilizáveis e telas compostas por partes | PASS | `apps/web/src/components/{Pagination,EmptyState,ConfirmAction,SeverityBadge,TextField,TextAreaField,SelectField}.tsx` são importados por páginas/features; `WorkspaceSelector` é usado por `AppShell`; componentes de status específicos ficam nas features | `apps/web/test/{hosts,rules,incidents,investigations}.test.tsx` percorrem telas que os consomem |
| Páginas separadas de componentes | PASS | Rotas em `apps/web/src/app/router.tsx` carregam páginas de `src/pages`; UI comum fica em `src/components`; comportamento de domínio e formulários ficam em `src/features` | Os testes de fluxo web validam criação, edição, listagem e detalhe sem embutir páginas em `router.tsx` |
| Componentes específicos de página/feature extraídos | PASS | `HostForm`, `DetectionRuleForm`, `IncidentForm` e `InvestigationForm` são componentes em `src/features/*` e reutilizados pelas páginas Create/Edit; seletores, avisos e ações de ciclo de vida também têm módulos próprios | `apps/web/test/{hosts,rules,incidents,investigations}.test.tsx`; `npm test` |

## TypeScript, domínio e critérios de engenharia

| Requisito | Status | Evidência objetiva | Observação |
| --- | --- | --- | --- |
| TypeScript strict | PASS | `tsconfig.base.json` habilita `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`; `npm run typecheck` passa em todos os workspaces | |
| TypeScript na aplicação sem JavaScript injetado | PASS | `apps/web/src`, `apps/api/src` e `packages/*/src` contêm TS/TSX; a auditoria AST do MCP verifica `eval` e `new Function`; busca atual não encontrou `.js`/`.jsx` dentro de `src` | Scripts `.mjs` em `scripts/` são tooling de infraestrutura, fora do código da aplicação |
| Evitar `any` explícito | PASS | Varredura da AST TypeScript nos arquivos de produção em `apps`, `packages` e `tools/aegis-mcp/src` não encontrou `AnyKeyword`; flags strict mantidas | Menções em comentários/documentação não contam como anotação de tipo |
| Interfaces e type aliases | PASS | `apps/api/src/application/ports/repositories.ts` define ports de repositório; `password-hasher.ts` e `token-service.ts` definem portas; `packages/contracts/src/*.ts` expõe interfaces e aliases de DTOs; `packages/domain/src/severity.ts` define `Severity` | Compilação strict e testes de aplicação validam o uso dos ports |
| Generics | PASS | `packages/domain/src/entity.ts` usa `Entity<TId>`; `apps/api/src/application/ports/repositories.ts` usa `UnitOfWork.run<T>` e `Page<T>`; `packages/contracts/src/pagination.ts` define `PaginatedResponse<T>`; `apps/web/src/lib/api-client.ts` usa `apiRequest<T>` | Usados em entidades, persistência, transporte e cliente HTTP |
| Modelagem orientada a objetos | PASS | `apps/api/src/domain/{user,workspace,membership,host,detection-rule,incident,investigation}.ts` modela entidades com invariantes e comportamento (`register`, `createPersonal`, `updateDetails`, `update`, `revise`, `transitionTo`, `canManageResources`) | Testes de domínio e aplicação exercitam regras e transições; não são apenas interfaces de dados |
| Encapsulamento | PASS | Entidades de domínio usam campos runtime-private `#`; fábricas controlam construção; estado de incidentes/investigações muda por métodos de domínio; por exemplo, `apps/api/src/domain/incident.ts` | Testes `apps/api/test/domain/{entities,incident,investigation}.test.ts` |
| Construtores limpos e estado válido | PASS | Entidades têm construtores privados e fábricas; `Incident.open` e `Investigation.open` validam detalhes, `restore` revalida invariantes, `User.register` normaliza nome e valida hash; `Workspace` também verifica o nome no construtor | Testes de domínio cobrem valores inválidos e restauração de ciclos de vida inconsistentes |
| Getters e setters | PASS | Auditoria de `apps/api/src/domain` e `packages/domain/src`: não há accessors `set`; getters publicados são valores usados por application/repositories/contracts; mutações são nomeadas (`updateProfile`, `changePasswordHash`, `updateDetails`, `update`, `revise`, `transitionTo`) | Não há setter genérico. A ferramenta MCP mantém revisão manual para julgar a utilidade semântica de cada getter |
| Herança | PASS | `User`, `Workspace`, `Host`, `DetectionRule`, `Incident` e `Investigation` estendem `Entity<string>`; erros específicos estendem `InvalidStateError`/`ValidationError` em `packages/domain/src/{incident-rules,investigation-rules}.ts` | Hierarquias existentes no domínio e em erros; não foram criadas para preencher a rubrica |
| Classes abstratas | PASS | `packages/domain/src/entity.ts` declara `abstract class Entity<TId>` e `domain-error.ts` declara `abstract class DomainError`; ambas têm classes concretas de produção derivadas | Interface não foi tratada como classe abstrata |
| Polimorfismo | PASS | `UserRepository` é implementado por `DrizzleUserRepository` em `apps/api/src/infrastructure/db/drizzle-repositories.ts` e por `InMemoryUserRepository` nos testes; `createUseCases` recebe as abstrações e executa os mesmos casos de uso com os dois conjuntos de adapters | Evidência de implementações substituíveis usadas em produção/testes, não apenas de DI declarada |
| SOLID — Single Responsibility | PASS | `apps/api/src/presentation/http/routes/*.route.ts` valida/encaminha/mapa HTTP; cada ação fica em use case próprio em `application/use-cases`; repositórios isolam persistência; no web, pages, features e components têm papéis separados | Revisão arquitetural BF 05.6; exemplos e arquivos citados permitem inspeção |
| SOLID — Open/Closed | IN_PROGRESS | Ports permitem substituir adaptadores sem alterar use cases (`apps/api/src/application/ports`, `composition-root.ts`) | Extensão de adaptador está demonstrada; adicionar um recurso completo ainda altera schema, use cases, composição e rotas. Falta demonstrar extensão de comportamento sem mudanças amplas no núcleo |
| SOLID — Liskov Substitution | IN_PROGRESS | Existem hierarquias reais `Entity` e `DomainError` e subclasses específicas; `error-handler.ts` reconhece os erros concretos | Ainda não há uma suíte explícita de contratos comportamentais de substituibilidade para as hierarquias. Não se considera LSP provado apenas por não haver violação conhecida |
| SOLID — Dependency Inversion | PASS | Use cases dependem de `Repositories`, `PasswordHasher`, `TokenService` e `UnitOfWork` em `apps/api/src/application/ports`; Drizzle/Argon2/jose são conectados em `composition-root.ts`; testes usam adapters em memória | `apps/api/test/application/use-cases.test.ts` e `test/integration/*` |
| Exceções customizadas | PASS | `DomainError` → `ValidationError`, `AuthenticationError`, `ForbiddenError`, `ConflictError`, `NotFoundError`, `InvalidStateError`; erros de transição/conclusão especializam classes de domínio; `error-handler.ts` mapeia para respostas HTTP | `packages/domain/test/{domain-error,incident-rules,investigation-rules}.test.ts`; `apps/api/test/http/*.test.ts` |
| Organização em camadas (entidades, serviços e repositórios) | PASS | `apps/api/src/domain` contém entidades/regras; `application/use-cases` contém serviços de aplicação; `application/ports` define repositórios; `infrastructure/db` implementa persistência; `presentation/http` contém rotas e mapeamento | Mapeamento equivalente à terminologia da rubrica; arquitetura não foi renomeada artificialmente |
| Convenções de nomenclatura | PASS | Auditoria de `apps`, `packages` e `tools`: tipos/classes/componentes em PascalCase; funções/propriedades em camelCase; módulos não-componentes em kebab-case; migrations SQL numeradas com nomes snake_case | Revisão manual BF 05.6; exemplos em `apps/api/src/domain/incident.ts`, `apps/web/src/features/incidents/IncidentForm.tsx` e `apps/api/drizzle/0007_investigation_incidents.sql` |

## Infraestrutura

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Docker Compose organizado | PASS | `compose.yaml` separa `nginx`, `web`, `api`, `mysql` e `migrate`; dependências ordenam MySQL saudável → migrations concluídas → API; configuração injeta valores por variáveis de ambiente sem versionar `.env` | `scripts/test-infra.mjs` valida config, build e subida real dos serviços em projeto isolado; `.github/workflows/ci.yml` executa a verificação | Porta do host configurável por `AEGIS_HTTP_PORT` (padrão 8080) |
| Frontend e backend separados | PASS | Serviços Compose `web` e `api` têm imagens/processos independentes; `infra/nginx/nginx.conf` roteia `/api/*` para API e `/` para SPA | Teste de infraestrutura valida ambas as respostas através do Nginx |
| Docker | PASS | `compose.yaml`, `infra/docker/{api,web}.Dockerfile` | Stack construída e iniciada do zero como projeto isolado; dependências de serviço, healthcheck MySQL, env vars e inicialização de migrations | `scripts/test-infra.mjs`; job `infrastructure` em `.github/workflows/ci.yml` | |
| MySQL | PASS | serviço `mysql` (8.4), `apps/api/drizzle/*`, `apps/api/src/infrastructure/db/*` | migrations versionadas (`npm run db:migrate`) aplicadas do zero no CI e pelo serviço `migrate` do Compose; repositórios Drizzle | `apps/api/test/integration/*` (MySQL real no CI) e `scripts/test-infra.mjs` ("migrations") | |
| Volume persistente MySQL | PASS | `compose.yaml`: volume nomeado `mysql_data` em `/var/lib/mysql` | `scripts/test-infra.mjs` confirma o tipo/nome do mount e insere marcador que permanece após `docker compose down`/`up`; schema e migrations permanecem íntegros | Verificações “mysql volume” e “persistence across down/up” no CI e local |
| Nginx | PASS | `infra/nginx/nginx.conf`, `infra/nginx/web.conf` | entrada pública única; `/api/*` → api com prefixo removido, `/*` → web (fallback SPA); CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `server_tokens off` | `scripts/test-infra.mjs`: `/api/health` 200 `{status:ok, service:aegis-api}` e `/` 200 com o SPA construído, via Nginx; `/api/rota-inexistente` → 404 JSON da API e `/health` → SPA (roteamento por prefixo); headers e CSP comparados ao `nginx.conf` em `/` e `/api/`; CI | CSP validada funcionalmente em Firefox real (BF 04, BF 05) |
| Isolamento de rede | PASS | redes `aegis_edge`, `aegis_application` (`internal`), `aegis_data` (`internal`) no `compose.yaml` | só nginx publica porta; web, api, mysql (3306) e migrate não publicam nada (`docker inspect` dos containers reais, não `EXPOSE`); nginx: edge + application; web: application; api: application + data; mysql e migrate: data | `scripts/test-infra.mjs` ("published ports", "networks", "network isolation": nginx e web não resolvem `mysql`, api resolve; api sem saída para a internet); CI | Egress da API será uma rede dedicada quando a IA existir (ARCHITECTURE.md) |
| Endpoint de health | PASS | `apps/api/src/presentation/http/routes/health.route.ts` | `GET /health` | `apps/api/test/health.test.ts` | |

## Agentes de IA

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | PASS | `AGENTS.md` | missão, arquitetura CURRENT/PLANNED, fluxo, regras de teste, segurança, recursos protegidos, dependências, git e commits | Verificação estrutural do MCP e `aegis_security_check` |
| 3 Skills | PASS | `agents/skills/{backend-engineering,frontend-engineering,security-review}/SKILL.md` | três skills por área descrevem escopo, ações permitidas/proibidas, comandos de validação e critérios de conclusão | Verificação estrutural do MCP |
| Guardrails de agentes | PASS | `AGENTS.md` e as três `agents/skills/*/SKILL.md` | instruções delimitam escopo defensivo, recursos proibidos, validação, proteção de segredos e operações permitidas | Testes de política do MCP; `tools/aegis-mcp/src/policy/*` |
| MCP próprio | PASS | `tools/aegis-mcp` | 7 ferramentas via stdio, somente leitura e com allowlist; `aegis_rubric_status` avalia auth, CRUDs, paginação, relações, UI/componentes, POO, hierarquias, ports substituíveis, tipos/`any` via AST, camadas, Compose/volume/rede e guardrails; itens arquiteturais subjetivos retornam `IN_PROGRESS` para revisão manual | `tools/aegis-mcp/test` (`protected-paths`, `redact`, `rubric-status`, incluindo testes de degradação) | Após rebuild do MCP, o cliente precisa reconectar (`/mcp`) para carregar o código novo |
| Proteção de arquivos sensíveis e `.env` | PASS | `AGENTS.md`, `tools/aegis-mcp/src/policy/protected-paths.ts`, `repo.ts`, `security-check.ts`, `.gitignore` | ferramentas MCP negam leitura de `.env`, `secrets/**`, `credentials/**` e arquivos de chave; saídas de segurança informam somente caminho/regra; credenciais de teste são geradas em memória/runtime | `tools/aegis-mcp/test/{protected-paths,redact}.test.ts`; `aegis_security_check` sem achados; `test-infra.mjs` usa env temporário e nunca carrega `.env` |

## Reconciliação BF 05.6

### Fonte e limite de fidelidade

O repositório não contém o arquivo/transcrição integral da rubrica acadêmica original; a matriz até BF 05.5 registrava essa limitação e deixava critérios citados nos BFs sem status. Esta reconciliação usa os critérios explícitos fornecidos nos BFs e na especificação BF 05.6 como a lista verificável conhecida. Não afirma que isso substitui uma cópia primária assinada/versionada da rubrica; qualquer redação original adicional ainda não fornecida permanece uma divergência documental, não foi inventada.

### Critérios antes omitidos e decisão

- **Frontend:** componentização reutilizável, divisão entre pages/components e componentes de feature separados foram adicionados com evidência de importações e formulários compartilhados por rotas de criação/edição.
- **Infraestrutura:** organização dos serviços Compose, env vars, separação web/API e volume MySQL persistente foram explicitados. Nginx, redes internas e exposição somente pelo Nginx permanecem nas linhas existentes, consolidadas com verificações automatizadas.
- **Agentes:** guardrails, três skills, proteção de arquivos sensíveis e proibição de ler/expor `.env` agora estão representados separadamente e ligados às políticas/testes MCP.
- **Engenharia de software:** encapsulamento, construtores/invariantes, getters/setters, modelagem POO, herança, classes abstratas, polimorfismo, interfaces/type aliases, Generics, `any`, SOLID S/O/L/DIP, exceções customizadas, camadas e nomenclatura foram explicitados.
- A antiga linha “Classes / abstract classes” foi dividida em **herança** e **classes abstratas**. A linha anterior “SOLID / DIP” foi expandida em S, O, L e DIP; não foi adicionado Interface Segregation (I), pois a instrução BF 05.6 afirma que a rubrica original não o cita.
- Os critérios de **Open/Closed** e **Liskov Substitution** ficam `IN_PROGRESS`: existem pontos de extensão e hierarquias reais, porém falta demonstrar extensão ampla sem alteração do núcleo e testes explícitos de contrato de substituibilidade, respectivamente.
- A auditoria não criou hierarquia, classe, interface ou abstração nova para elevar status. As classes abstratas e subclasses citadas já são usadas em domínio e erros.
- Para getters/setters, Single Responsibility e nomenclatura, a revisão BF 05.6 atribui status após inspeção manual; o MCP responde `IN_PROGRESS` nesses pontos porque seu scanner não consegue concluir qualidade semântica. A resposta do MCP sinaliza revisão humana e não substitui a matriz revisada.

### Situação consolidada

#### Requisitos plenamente atendidos — CORE ACADÊMICO

Autenticação e gestão do usuário/workspace; quatro CRUDs e seus fluxos web; paginação; relacionamentos; validação e segurança de senha; TypeScript strict e ausência de `any` explícito; componentização; encapsulamento; construtores/invariantes; getters sem setters genéricos; modelagem POO; herança; classes abstratas; polimorfismo por ports substituíveis; interfaces/type aliases; Generics; SOLID S e DIP; exceções; camadas; nomenclatura; Compose, serviços e variáveis; web/API separadas; MySQL e volume persistente; Nginx; redes internas e exposição somente pelo Nginx; AGENTS, skills, guardrails, MCP e proteção de `.env`/segredos. Cada critério aponta para arquivo, teste ou verificação automatizada na tabela correspondente.

#### Requisitos parcialmente atendidos

- **SOLID O — Open/Closed (`IN_PROGRESS`):** a troca de adapter por port é possível; ainda não foi demonstrado um novo comportamento completo sem alterar composição, rotas e persistência centrais.
- **SOLID L — Liskov (`IN_PROGRESS`):** a hierarquia de entidades/erros é real, mas falta uma suíte explícita que prove os contratos comportamentais de substituibilidade.

#### Requisitos não atendidos

Nenhum critério conhecido está `TODO`.

#### Requisitos bloqueados

Nenhum. A confirmação literal contra a rubrica primária depende de uma cópia integral/versionada que não existe no repositório; isso é documentado como limite de fonte, não classificado como `BLOCKED` de implementação.

#### AEGIS EXPERIMENTAL — PLANNED, fora do PASS acadêmico atual

Events e ingestão, Collector, eBPF/Aya, Detection Engine, Alerts e correlação automática, IA, Ada/SPARK e Assembly continuam planejados. Nenhum deles é contado como evidência implementada nesta matriz.

```
CORE ACADÊMICO (com O/L em IN_PROGRESS)  AEGIS EXPERIMENTAL (PLANNED)
├── Auth, JWT, Argon2id               ├── Events + ingestão
├── User (self-service)               ├── Collector (Rust) · eBPF
├── 4 CRUDs + paginação + relações    ├── Detection Engine · Alerts
├── MySQL + migrations                ├── Correlation · incidentes automáticos
├── Docker · Nginx · isolamento       ├── IA
├── AGENTS.md · 3 skills · MCP        └── SPARK · Assembly
└── TypeScript strict / POO / camadas
```
