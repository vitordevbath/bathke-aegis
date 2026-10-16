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

/**
 * PASS requires implementation evidence found in the repository, never
 * documentation alone. Checks are upgraded as features land.
 */
const CHECKS: readonly RubricCheck[] = [
  { requirement: 'Authentication', evaluate: todo() },
  { requirement: 'JWT', evaluate: todo() },
  { requirement: 'Email validation', evaluate: todo('server-side validation not implemented') },
  { requirement: 'CPF validation', evaluate: todo() },
  { requirement: 'Password validation', evaluate: todo() },
  { requirement: 'User ownership', evaluate: todo() },
  { requirement: 'Hosts CRUD', evaluate: todo() },
  { requirement: 'Detection Rules CRUD', evaluate: todo() },
  { requirement: 'Incidents CRUD', evaluate: todo() },
  { requirement: 'Investigations CRUD', evaluate: todo() },
  { requirement: 'Pagination', evaluate: todo() },
  { requirement: 'Relationships', evaluate: todo() },
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
  { requirement: 'Generics', evaluate: todo('only Entity<TId> base exists; no use in features yet') },
  { requirement: 'SOLID', evaluate: () => ({ state: 'IN_PROGRESS', evidence: 'layered api structure; no use cases yet' }) },
  {
    requirement: 'Custom exceptions',
    evaluate: (repo) =>
      repo.exists('packages/domain/src/domain-error.ts')
        ? { state: 'IN_PROGRESS', evidence: 'DomainError base exists; no concrete domain errors yet' }
        : { state: 'TODO', evidence: 'no DomainError' },
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
    evaluate: (repo) =>
      contains(repo, 'compose.yaml', /image:\s*mysql/) && repo.exists('apps/api/src/infrastructure/db/schema.ts')
        ? { state: 'IN_PROGRESS', evidence: 'mysql service + Drizzle schema; no migrations or repositories' }
        : { state: 'TODO', evidence: 'mysql not configured' },
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
