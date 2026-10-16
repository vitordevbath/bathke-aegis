# Rubrica — matriz rastreável

Estados: `TODO` · `IN_PROGRESS` · `PASS` · `BLOCKED`.
**PASS exige implementação e evidência**, nunca apenas documentação.
A ferramenta `aegis_rubric_status` do Aegis MCP avalia parte destes itens automaticamente.

## Usuário e autenticação

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Cadastro de usuário | TODO | - | - | - | Fase 02 |
| Login / autenticação | TODO | - | - | - | `/login` é placeholder |
| JWT | TODO | - | - | - | |
| Validação de email | TODO | - | - | - | Hoje só client-side no `/login` |
| Validação de CPF | TODO | - | - | - | |
| Validação de senha + confirmação | TODO | - | - | - | |
| Senha com hash seguro | TODO | - | - | - | Argon2 planejado |
| Usuário só edita a si mesmo | TODO | - | - | - | |
| Email imutável na edição | TODO | - | - | - | |

## CRUDs (User não conta)

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Hosts CRUD | TODO | - | - | - | |
| Detection Rules CRUD | TODO | - | - | - | pertence a User |
| Incidents CRUD | TODO | - | - | - | Host/Rule → Incident |
| Investigations CRUD | TODO | - | - | - | User, Incident → Investigation |
| Paginação | TODO | - | - | - | |
| Relacionamentos | TODO | - | - | - | |
| Recurso inexistente (404) | TODO | - | - | - | |
| Autorização por CRUD | TODO | - | - | - | |

## TypeScript / POO

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| TypeScript strict | PASS | `tsconfig.base.json` | `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`; `npm run typecheck` | CI | |
| Classes / abstract classes | IN_PROGRESS | `packages/domain/src/entity.ts` | base `Entity` | - | sem subclasses reais |
| Interfaces / type aliases | IN_PROGRESS | `packages/contracts`, `apps/web/src/types` | - | - | |
| Generics | TODO | - | - | - | `Entity<TId>` existe, sem uso |
| Exceções customizadas | IN_PROGRESS | `packages/domain/src/domain-error.ts` | base | - | sem erros concretos |
| SOLID / DIP | IN_PROGRESS | camadas em `apps/api/src` | - | - | sem use cases |

## Infraestrutura

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| Docker | IN_PROGRESS | `compose.yaml`, `infra/docker/*` | stack sobe; `/api/health` 200 via Nginx (BF 00, Windows) | - | |
| MySQL | IN_PROGRESS | serviço `mysql`, `apps/api/src/infrastructure/db` | container healthy | - | sem migrations/uso |
| Nginx | IN_PROGRESS | `infra/nginx/nginx.conf` | `/` e `/api/` roteados | - | |
| Isolamento de rede | IN_PROGRESS | redes no `compose.yaml` | só nginx publica porta | - | |
| Endpoint de health | PASS | `apps/api/src/presentation/http/routes/health.route.ts` | `GET /health` | `apps/api/test/health.test.ts` | |

## Agentes de IA

| Requisito | Status | Implementação | Evidência | Testes | Notas |
| --- | --- | --- | --- | --- | --- |
| AGENTS.md | PASS | `AGENTS.md` | - | - | |
| 3 Skills | PASS | `agents/skills/*/SKILL.md` | - | - | |
| MCP próprio | IN_PROGRESS | `tools/aegis-mcp` | 7 ferramentas via stdio | `tools/aegis-mcp/test` | rubric engine parcial |
| Proteção de segredos | PASS | `tools/aegis-mcp/src/policy/*`, `.gitignore` | `isProtectedPath`, `redactSecrets` | `protected-paths.test.ts`, `redact.test.ts` | |
