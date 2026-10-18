import type { RepoReader } from '../repo.js';

export type RubricState = 'TODO' | 'IN_PROGRESS' | 'PASS' | 'BLOCKED';

export interface RubricResult {
  readonly requirement: string;
  readonly state: RubricState;
  readonly evidence: string;
}

interface RubricCheck {
  readonly requirement: string;
  /** Inspects the repository and returns the state backed by concrete evidence. */
  readonly evaluate: (repo: RepoReader) => { state: RubricState; evidence: string };
}

const todo = (evidence = 'not implemented') => () => ({ state: 'TODO' as const, evidence });

const contains = (repo: RepoReader, file: string, pattern: RegExp): boolean =>
  repo.exists(file) && pattern.test(repo.readText(file));

/** PASS only when every implementation pattern and its test are present; IN_PROGRESS if only some are. */
const implementedAndTested =
  (evidence: string, requirements: readonly { file: string; pattern: RegExp }[]) =>
  (repo: RepoReader): { state: RubricState; evidence: string } => {
    const met = requirements.filter(({ file, pattern }) => contains(repo, file, pattern));
    if (met.length === requirements.length) return { state: 'PASS', evidence };
    if (met.length === 0) return { state: 'TODO', evidence: 'not implemented' };
    const missing = requirements.filter((requirement) => !met.includes(requirement)).map(({ file }) => file);
    return { state: 'IN_PROGRESS', evidence: `missing evidence in ${[...new Set(missing)].join(', ')}` };
  };

const API = 'apps/api/src';
const API_TEST = 'apps/api/test';

/**
 * PASS requires implementation evidence found in the repository, never
 * documentation alone. Checks are upgraded as features land.
 */
const CHECKS: readonly RubricCheck[] = [
  {
    requirement: 'User registration',
    evaluate: implementedAndTested('POST /auth/register: user + personal workspace + OWNER membership in one transaction', [
      { file: `${API}/presentation/http/routes/auth.route.ts`, pattern: /'\/auth\/register'/ },
      { file: `${API}/application/use-cases/register-user.ts`, pattern: /unitOfWork\.run/ },
      { file: `${API_TEST}/http/auth.test.ts`, pattern: /POST \/auth\/register/ },
      { file: `${API_TEST}/integration/mysql-repositories.test.ts`, pattern: /rolls back/ },
    ]),
  },
  {
    requirement: 'Authentication',
    evaluate: implementedAndTested('POST /auth/login with generic error; bearer preHandler on protected routes', [
      { file: `${API}/presentation/http/routes/auth.route.ts`, pattern: /'\/auth\/login'/ },
      { file: `${API}/presentation/http/authenticate.ts`, pattern: /Bearer/ },
      { file: `${API_TEST}/http/auth.test.ts`, pattern: /Email ou senha inválidos/ },
    ]),
  },
  {
    requirement: 'JWT',
    evaluate: implementedAndTested('HS256 via jose; sub/typ/iss/aud/exp only; secret validated at startup', [
      { file: `${API}/infrastructure/security/jose-token-service.ts`, pattern: /jwtVerify/ },
      { file: `${API}/shared/env.ts`, pattern: /JWT_SECRET/ },
      { file: `${API_TEST}/security.test.ts`, pattern: /expired token/ },
    ]),
  },
  {
    requirement: 'Email validation',
    evaluate: implementedAndTested('Email value object (trim, lower-case, pattern) shared by API and web via contracts', [
      { file: 'packages/domain/src/email.ts', pattern: /EMAIL_PATTERN/ },
      { file: 'packages/contracts/src/fields.ts', pattern: /Email\.isValid/ },
      { file: 'packages/domain/test/value-objects.test.ts', pattern: /describe\('Email'/ },
    ]),
  },
  {
    requirement: 'CPF validation',
    evaluate: implementedAndTested('Cpf value object: shape, repeated digits, both check digits; stored as 11 digits', [
      { file: 'packages/domain/src/cpf.ts', pattern: /checkDigit/ },
      { file: 'packages/domain/test/value-objects.test.ts', pattern: /rejects repeated digits/ },
    ]),
  },
  {
    requirement: 'Password validation',
    evaluate: implementedAndTested('PasswordPolicy (10–128, lower, upper, digit, special) + confirmation on register and edit', [
      { file: 'packages/domain/src/password-policy.ts', pattern: /MIN_LENGTH = 10/ },
      { file: 'packages/contracts/src/auth.ts', pattern: /passwordConfirmation/ },
      { file: 'packages/contracts/test/schemas.test.ts', pattern: /mismatched confirmation/ },
    ]),
  },
  {
    requirement: 'Password hashing',
    evaluate: implementedAndTested('Argon2id (m=64 MiB, t=3, p=4) behind PasswordHasher port', [
      { file: `${API}/infrastructure/security/argon2-password-hasher.ts`, pattern: /argon2id/ },
      { file: `${API_TEST}/security.test.ts`, pattern: /\$argon2id/ },
    ]),
  },
  {
    requirement: 'User ownership',
    evaluate: (repo) => {
      const selfOnly =
        contains(repo, `${API}/presentation/http/routes/users.route.ts`, /'\/users\/me'/) &&
        // No route *registration* with a user id parameter (comments may mention it).
        !contains(repo, `${API}/presentation/http/routes/users.route.ts`, /app\.\w+\(\s*'\/users\/:/) &&
        contains(repo, `${API_TEST}/http/users.test.ts`, /another user cannot be targeted/);
      return selfOnly
        ? { state: 'PASS', evidence: 'only /users/me (identity from JWT); body identity fields rejected; tested' }
        : { state: 'TODO', evidence: 'self-service user routes or tests missing' };
    },
  },
  {
    requirement: 'Email immutability',
    evaluate: implementedAndTested('PUT /users/me rejects email; repository never writes it', [
      { file: 'packages/contracts/src/users.ts', pattern: /EMAIL_IMMUTABLE_MESSAGE/ },
      { file: `${API}/infrastructure/db/drizzle-repositories.ts`, pattern: /`email` is intentionally absent/ },
      { file: `${API_TEST}/http/users.test.ts`, pattern: /email cannot be changed/ },
    ]),
  },
  {
    requirement: 'Hosts CRUD',
    evaluate: implementedAndTested('create/list/read/update/delete under /workspaces/:id/hosts; authenticated; membership-checked; web screens; tests', [
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /app\.post\('\/workspaces\/:workspaceId\/hosts'/ },
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/hosts'/ },
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/hosts\/:hostId'/ },
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /app\.put\('\/workspaces\/:workspaceId\/hosts\/:hostId'/ },
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /app\.delete\('\/workspaces\/:workspaceId\/hosts\/:hostId'/ },
      { file: `${API}/presentation/http/routes/hosts.route.ts`, pattern: /addHook\('preHandler', authenticate/ },
      { file: `${API}/application/workspace-access.ts`, pattern: /requireMember/ },
      { file: 'apps/web/src/pages/hosts/CreateHostPage.tsx', pattern: /HostForm/ },
      { file: 'apps/web/src/pages/hosts/EditHostPage.tsx', pattern: /HostForm/ },
      { file: 'apps/web/src/pages/hosts/HostsPage.tsx', pattern: /Pagination/ },
      { file: `${API_TEST}/http/hosts.test.ts`, pattern: /multi-tenant isolation/ },
      { file: 'apps/web/test/hosts.test.tsx', pattern: /create host \(separate screen\)/ },
    ]),
  },
  { requirement: 'Detection Rules CRUD', evaluate: todo() },
  { requirement: 'Incidents CRUD', evaluate: todo() },
  { requirement: 'Investigations CRUD', evaluate: todo() },
  {
    requirement: 'Pagination',
    evaluate: implementedAndTested('generic PaginationQuerySchema + PaginatedResponse<T>; Hosts list; reusable web Pagination', [
      { file: 'packages/contracts/src/pagination.ts', pattern: /interface PaginatedResponse<T>/ },
      { file: `${API}/presentation/http/mappers.ts`, pattern: /toPaginatedResponse/ },
      { file: 'apps/web/src/components/Pagination.tsx', pattern: /aria-current/ },
      { file: `${API_TEST}/http/hosts.test.ts`, pattern: /paginates 25 hosts/ },
    ]),
  },
  {
    requirement: 'Relationships',
    evaluate: (repo) =>
      contains(repo, `${API}/infrastructure/db/schema.ts`, /workspaceId: char\('workspace_id'[\s\S]*?references\(\(\) => workspaces\.id/)
        ? { state: 'IN_PROGRESS', evidence: 'User–Membership–Workspace and Workspace 1–N Host with real FKs; CRUD-to-CRUD relations (Incident) pending' }
        : { state: 'TODO', evidence: 'not implemented' },
  },
  {
    requirement: 'TypeScript strict',
    evaluate: (repo) => {
      const ok =
        contains(repo, 'tsconfig.base.json', /"strict":\s*true/) &&
        contains(repo, 'tsconfig.base.json', /"noImplicitAny":\s*true/) &&
        contains(repo, 'tsconfig.base.json', /"noUncheckedIndexedAccess":\s*true/);
      return ok
        ? { state: 'PASS', evidence: 'tsconfig.base.json: strict, noImplicitAny, noUncheckedIndexedAccess' }
        : { state: 'TODO', evidence: 'strict flags missing in tsconfig.base.json' };
    },
  },
  {
    requirement: 'Generics',
    evaluate: implementedAndTested('Entity<string> subclasses; UnitOfWork.run<T>; apiRequest<T>', [
      { file: `${API}/domain/user.ts`, pattern: /extends Entity<string>/ },
      { file: `${API}/application/ports/repositories.ts`, pattern: /run<T>/ },
    ]),
  },
  {
    requirement: 'SOLID',
    evaluate: implementedAndTested('use cases depend on ports; Drizzle/Argon2/jose adapters wired in composition root', [
      { file: `${API}/application/ports/repositories.ts`, pattern: /interface UserRepository/ },
      { file: `${API}/composition-root.ts`, pattern: /createUseCases/ },
      { file: `${API_TEST}/application/use-cases.test.ts`, pattern: /createInMemoryPersistence/ },
    ]),
  },
  {
    requirement: 'Custom exceptions',
    evaluate: implementedAndTested('DomainError → Validation/Authentication/Conflict/NotFound, mapped to HTTP in one handler', [
      { file: 'packages/domain/src/domain-error.ts', pattern: /class ConflictError extends DomainError/ },
      { file: `${API}/presentation/http/error-handler.ts`, pattern: /instanceof ConflictError/ },
      { file: 'packages/domain/test/domain-error.test.ts', pattern: /stable code/ },
    ]),
  },
  {
    requirement: 'Docker',
    evaluate: (repo) =>
      repo.exists('compose.yaml')
        ? { state: 'IN_PROGRESS', evidence: 'compose.yaml with nginx/web/api/mysql' }
        : { state: 'TODO', evidence: 'no compose.yaml' },
  },
  {
    requirement: 'MySQL',
    evaluate: implementedAndTested('versioned Drizzle migrations, repositories and integration tests against MySQL 8.4', [
      { file: 'compose.yaml', pattern: /image:\s*mysql/ },
      { file: 'apps/api/drizzle/meta/_journal.json', pattern: /init_auth_user_workspace/ },
      { file: `${API}/infrastructure/db/drizzle-repositories.ts`, pattern: /DrizzleUnitOfWork/ },
      { file: `${API_TEST}/integration/mysql-repositories.test.ts`, pattern: /MySQL persistence/ },
    ]),
  },
  {
    requirement: 'Nginx',
    evaluate: (repo) =>
      repo.exists('infra/nginx/nginx.conf')
        ? { state: 'IN_PROGRESS', evidence: 'infra/nginx/nginx.conf routes / and /api/' }
        : { state: 'TODO', evidence: 'no nginx config' },
  },
  {
    requirement: 'Network isolation',
    evaluate: (repo) =>
      contains(repo, 'compose.yaml', /aegis_data:[\s\S]*internal:\s*true/)
        ? { state: 'IN_PROGRESS', evidence: 'compose networks declared; only nginx publishes ports' }
        : { state: 'TODO', evidence: 'networks not declared' },
  },
  {
    requirement: 'AGENTS.md',
    evaluate: (repo) =>
      contains(repo, 'AGENTS.md', /## Security Rules/) && contains(repo, 'AGENTS.md', /## Protected Resources/)
        ? { state: 'PASS', evidence: 'AGENTS.md with security and protected-resource sections' }
        : { state: 'TODO', evidence: 'AGENTS.md missing or incomplete' },
  },
  {
    requirement: '3 Skills',
    evaluate: (repo) => {
      const skills = ['backend-engineering', 'frontend-engineering', 'security-review'];
      const present = skills.filter((skill) => repo.exists(`agents/skills/${skill}/SKILL.md`));
      return present.length === skills.length
        ? { state: 'PASS', evidence: present.map((skill) => `agents/skills/${skill}/SKILL.md`).join(', ') }
        : { state: 'IN_PROGRESS', evidence: `${present.length}/3 skills present` };
    },
  },
  {
    requirement: 'Secret Protection',
    evaluate: (repo) =>
      repo.exists('tools/aegis-mcp/src/policy/protected-paths.ts') &&
      repo.exists('tools/aegis-mcp/test/protected-paths.test.ts') &&
      contains(repo, '.gitignore', /^\.env$/m)
        ? { state: 'PASS', evidence: 'MCP isProtectedPath + tests; .gitignore excludes secrets' }
        : { state: 'TODO', evidence: 'secret guard or tests missing' },
  },
];

export function evaluateRubric(repo: RepoReader): RubricResult[] {
  return CHECKS.map((check) => ({ requirement: check.requirement, ...check.evaluate(repo) }));
}

export function formatRubric(results: readonly RubricResult[]): string {
  const width = 30;
  return results
    .map((result) => `${result.requirement} ${'.'.repeat(Math.max(2, width - result.requirement.length))} ${result.state}  (${result.evidence})`)
    .join('\n');
}
