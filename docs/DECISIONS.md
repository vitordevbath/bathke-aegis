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
