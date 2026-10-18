# Rubrica — matriz rastreável

Estados: `TODO` · `IN_PROGRESS` · `PASS` · `BLOCKED`.
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
| Hosts CRUD | TODO | - | - | - | |
| Detection Rules CRUD | TODO | - | - | - | pertence ao Workspace |
| Incidents CRUD | TODO | - | - | - | pertence ao Workspace; Host/Rule → Incident |
| Investigations CRUD | TODO | - | - | - | pertence ao Workspace; Incident → Investigation (autor: User) |
| Paginação | TODO | - | - | - | |
| Relacionamentos | TODO | - | - | - | |
| Recurso inexistente (404) | TODO | - | - | - | |
| Autorização por CRUD | TODO | - | - | - | |

## TypeScript / POO

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| TypeScript strict | PASS | `tsconfig.base.json` | `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`; `npm run typecheck` | CI | |
| Classes / abstract classes | PASS | `packages/domain/src/entity.ts`, `domain-error.ts`, `apps/api/src/domain/*.ts` | `Entity<TId>` abstrata → `User`, `Workspace`; `DomainError` abstrata → 4 erros; construtores `private` + factories | `apps/api/test/domain/entities.test.ts` | Campos `#private` em `User` (hash nunca serializado) |
| Interfaces / type aliases | PASS | `apps/api/src/application/ports/*.ts`, `packages/contracts/src/*.ts` | ports `UserRepository`, `PasswordHasher`, `TokenService`, `UnitOfWork`; DTOs de transporte | `test/application/use-cases.test.ts` (dublês implementam os ports) | |
| Generics | PASS | `packages/domain/src/entity.ts`, `application/ports/repositories.ts`, `apps/web/src/lib/api-client.ts` | `Entity<string>`, `UnitOfWork.run<T>`, `apiRequest<T>` | `test/integration/mysql-repositories.test.ts` | |
| Exceções customizadas | PASS | `packages/domain/src/domain-error.ts`, `apps/api/src/presentation/http/error-handler.ts` | `ValidationError` 400, `AuthenticationError` 401, `ConflictError` 409, `NotFoundError` 404; 500 genérico sem stack | `packages/domain/test/domain-error.test.ts`, `test/http/*.test.ts` | |
| SOLID / DIP | PASS | `apps/api/src/application`, `infrastructure`, `composition-root.ts` | use cases dependem de ports; adapters Drizzle/Argon2/jose injetados na composição | `test/application/use-cases.test.ts` (in-memory), `test/integration/*` (MySQL) | |

## Infraestrutura

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Docker | IN_PROGRESS | `compose.yaml`, `infra/docker/*` | stack sobe com serviço `migrate` one-shot; fluxo de auth validado via Nginx (BF 01, Fedora) | - | sem teste automatizado da stack |
| MySQL | PASS | serviço `mysql`, `apps/api/drizzle/*`, `apps/api/src/infrastructure/db/*` | migrations versionadas (`npm run db:migrate`) aplicadas do zero no CI e no Compose; repositórios Drizzle | `apps/api/test/integration/*` | |
| Nginx | IN_PROGRESS | `infra/nginx/nginx.conf` | `/` e `/api/` roteados; CSP estrita | - | |
| Isolamento de rede | IN_PROGRESS | redes no `compose.yaml` | só nginx publica porta | - | |
| Endpoint de health | PASS | `apps/api/src/presentation/http/routes/health.route.ts` | `GET /health` | `apps/api/test/health.test.ts` | |

## Agentes de IA

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | PASS | `AGENTS.md` | - | - | |
| 3 Skills | PASS | `agents/skills/*/SKILL.md` | - | - | |
| MCP próprio | IN_PROGRESS | `tools/aegis-mcp` | 7 ferramentas via stdio; `aegis_rubric_status` avalia auth/usuário/MySQL por evidência | `tools/aegis-mcp/test` (inclui `rubric-status.test.ts`) | rubric engine parcial (CRUDs, infra) |
| Proteção de segredos | PASS | `tools/aegis-mcp/src/policy/*`, `.gitignore` | `isProtectedPath`, `redactSecrets` | `protected-paths.test.ts`, `redact.test.ts` | |
