import type { RepoReader } from '../repo.js';
import ts from 'typescript';

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

const contains = (repo: RepoReader, file: string, pattern: RegExp): boolean =>
  repo.exists(file) && pattern.test(repo.readText(file));

const sourceFiles = (repo: RepoReader, roots: readonly string[]): string[] =>
  roots.flatMap((root) => repo.listFiles(root)).filter((file) => /\.(?:ts|tsx)$/.test(file));

function visitSource(repo: RepoReader, files: readonly string[], visit: (node: ts.Node, file: string) => void): void {
  for (const file of files) {
    const source = ts.createSourceFile(file, repo.readText(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const walk = (node: ts.Node): void => {
      visit(node, file);
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
}

const manualReview = (evidence: string) => (): { state: RubricState; evidence: string } => ({
  state: 'IN_PROGRESS',
  evidence: `manual design review required; ${evidence}`,
});

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
const INFRA_TEST = 'scripts/test-infra.mjs';
/** The infra test only counts if it exists, is wired to npm and actually runs in CI. */
const INFRA_TEST_EVIDENCE = [
  { file: 'package.json', pattern: /"test:infra": "node scripts\/test-infra\.mjs"/ },
  { file: '.github/workflows/ci.yml', pattern: /run: npm run test:infra/ },
  { file: INFRA_TEST, pattern: /finally \{\s*cleanup\(\);/ },
] as const;

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
  {
    requirement: 'Detection Rules CRUD',
    evaluate: implementedAndTested('CRUD under /workspaces/:id/detection-rules; declarative schema v1; host targets; web builder; tests', [
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /app\.post\('\/workspaces\/:workspaceId\/detection-rules'/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/detection-rules'/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/detection-rules\/:ruleId'/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /app\.put\('\/workspaces\/:workspaceId\/detection-rules\/:ruleId'/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /app\.delete\('\/workspaces\/:workspaceId\/detection-rules\/:ruleId'/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /addHook\('preHandler', authenticate/ },
      { file: `${API}/presentation/http/routes/detection-rules.route.ts`, pattern: /toPaginatedResponse/ },
      { file: 'packages/domain/src/detection-rule-schema.ts', pattern: /validateDetectionDefinition/ },
      { file: 'apps/web/src/pages/rules/CreateRulePage.tsx', pattern: /DetectionRuleForm/ },
      { file: 'apps/web/src/pages/rules/EditRulePage.tsx', pattern: /DetectionRuleForm/ },
      { file: `${API_TEST}/http/detection-rules.test.ts`, pattern: /multi-tenant isolation/ },
      { file: `${API_TEST}/integration/detection-rules.mysql.test.ts`, pattern: /rolls back the rule row/ },
      { file: 'apps/web/test/rules.test.tsx', pattern: /condition builder/ },
    ]),
  },
  {
    requirement: 'Incidents CRUD',
    evaluate: implementedAndTested('CRUD under /workspaces/:id/incidents; manual origin; domain lifecycle; N:N hosts/rules; web screens; tests incl. MySQL', [
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.post\('\/workspaces\/:workspaceId\/incidents'/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/incidents'/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/incidents\/:incidentId'/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.put\('\/workspaces\/:workspaceId\/incidents\/:incidentId'/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.delete\('\/workspaces\/:workspaceId\/incidents\/:incidentId'/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /addHook\('preHandler', authenticate/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /toPaginatedResponse/ },
      { file: `${API}/domain/incident.ts`, pattern: /transitionTo\(/ },
      { file: 'apps/api/drizzle/0005_incident_relations.sql', pattern: /CREATE TABLE `incident_hosts`/ },
      { file: 'apps/web/src/pages/incidents/CreateIncidentPage.tsx', pattern: /IncidentForm/ },
      { file: 'apps/web/src/pages/incidents/EditIncidentPage.tsx', pattern: /IncidentForm/ },
      { file: `${API_TEST}/http/incidents.test.ts`, pattern: /multi-tenant isolation/ },
      { file: `${API_TEST}/integration/incidents.mysql.test.ts`, pattern: /rolls back the incident row/ },
      { file: 'apps/web/test/incidents.test.tsx', pattern: /create incident \(separate screen\)/ },
    ]),
  },
  {
    requirement: 'Investigations CRUD',
    evaluate: implementedAndTested(
      'CRUD under /workspaces/:id/investigations; N:N incidents; conclusion required to close; CLOSED read-only; grouped incident protected; web screens; tests incl. MySQL',
      [
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /app\.post\('\/workspaces\/:workspaceId\/investigations'/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/investigations'/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /app\.get\('\/workspaces\/:workspaceId\/investigations\/:investigationId'/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /app\.put\('\/workspaces\/:workspaceId\/investigations\/:investigationId'/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /app\.delete\('\/workspaces\/:workspaceId\/investigations\/:investigationId'/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /addHook\('preHandler', authenticate/ },
        { file: `${API}/presentation/http/routes/investigations.route.ts`, pattern: /toPaginatedResponse/ },
        { file: `${API}/domain/investigation.ts`, pattern: /InvestigationConclusionRequiredError/ },
        { file: `${API}/application/use-cases/incidents/delete-incident.ts`, pattern: /isIncidentInvestigated/ },
        { file: 'apps/api/drizzle/0007_investigation_incidents.sql', pattern: /CREATE TABLE `investigation_incidents`/ },
        { file: 'apps/web/src/pages/investigations/CreateInvestigationPage.tsx', pattern: /InvestigationForm/ },
        { file: 'apps/web/src/pages/investigations/EditInvestigationPage.tsx', pattern: /InvestigationForm/ },
        { file: `${API_TEST}/http/investigations.test.ts`, pattern: /multi-tenant isolation/ },
        { file: `${API_TEST}/integration/investigations.mysql.test.ts`, pattern: /rolls back the investigation row/ },
        { file: 'apps/web/test/investigations.test.tsx', pattern: /create investigation \(separate screen\)/ },
      ],
    ),
  },
  {
    requirement: 'Pagination',
    evaluate: implementedAndTested('generic PaginationQuerySchema + PaginatedResponse<T>; Hosts, Rules, Incidents and Investigations lists; reusable web Pagination', [
      { file: 'packages/contracts/src/pagination.ts', pattern: /interface PaginatedResponse<T>/ },
      { file: `${API}/presentation/http/mappers.ts`, pattern: /toPaginatedResponse/ },
      { file: 'apps/web/src/components/Pagination.tsx', pattern: /aria-current/ },
      { file: `${API_TEST}/http/hosts.test.ts`, pattern: /paginates 25 hosts/ },
      { file: `${API_TEST}/http/incidents.test.ts`, pattern: /paginates 25 incidents/ },
      { file: `${API_TEST}/http/investigations.test.ts`, pattern: /paginates 25 investigations/ },
    ]),
  },
  {
    requirement: 'Relationships',
    evaluate: implementedAndTested(
      'Rule ↔ Host, Incident ↔ Host, Incident ↔ Rule and Investigation ↔ Incident (N:N, real FKs, same-workspace check in a transaction, RESTRICT → 409); Workspace 1–N resources',
      [
        { file: 'apps/api/drizzle/0003_detection_rule_targets.sql', pattern: /FOREIGN KEY \(`host_id`\) REFERENCES `hosts`/ },
        { file: `${API}/application/use-cases/detection-rules/detection-rule-view.ts`, pattern: /findManyInWorkspace/ },
        { file: `${API_TEST}/integration/detection-rules.mysql.test.ts`, pattern: /cascades targets on rule delete/ },
        { file: `${API_TEST}/http/detection-rules.test.ts`, pattern: /host of another workspace/ },
        { file: 'apps/api/drizzle/0005_incident_relations.sql', pattern: /REFERENCES `detection_rules`\(`id`\) ON DELETE restrict/ },
        { file: `${API}/application/use-cases/incidents/incident-view.ts`, pattern: /findManyInWorkspace/ },
        { file: `${API_TEST}/integration/incidents.mysql.test.ts`, pattern: /restricts deleting a related host or rule/ },
        { file: 'apps/api/drizzle/0007_investigation_incidents.sql', pattern: /REFERENCES `incidents`\(`id`\) ON DELETE restrict/ },
        { file: `${API}/application/use-cases/investigations/investigation-view.ts`, pattern: /findManyInWorkspace/ },
        { file: `${API_TEST}/integration/investigations.mysql.test.ts`, pattern: /restricts deleting a grouped incident/ },
      ],
    ),
  },
  {
    requirement: 'Frontend componentization',
    evaluate: implementedAndTested('Pages consume shared components and feature forms; create/edit routes reuse the same forms; CRUD flow tests exercise the screens', [
      { file: 'apps/web/src/pages/hosts/HostsPage.tsx', pattern: /from ['"]\.\.\/\.\.\/components\/(?:EmptyState|Pagination)/ },
      { file: 'apps/web/src/pages/incidents/IncidentsPage.tsx', pattern: /from ['"]\.\.\/\.\.\/components\/(?:EmptyState|Pagination)/ },
      { file: 'apps/web/src/pages/hosts/CreateHostPage.tsx', pattern: /HostForm/ },
      { file: 'apps/web/src/pages/hosts/EditHostPage.tsx', pattern: /HostForm/ },
      { file: 'apps/web/src/pages/rules/CreateRulePage.tsx', pattern: /DetectionRuleForm/ },
      { file: 'apps/web/src/pages/rules/EditRulePage.tsx', pattern: /DetectionRuleForm/ },
      { file: 'apps/web/src/pages/incidents/CreateIncidentPage.tsx', pattern: /IncidentForm/ },
      { file: 'apps/web/src/pages/incidents/EditIncidentPage.tsx', pattern: /IncidentForm/ },
      { file: 'apps/web/src/pages/investigations/CreateInvestigationPage.tsx', pattern: /InvestigationForm/ },
      { file: 'apps/web/src/pages/investigations/EditInvestigationPage.tsx', pattern: /InvestigationForm/ },
      { file: 'apps/web/test/hosts.test.tsx', pattern: /create host \(separate screen\)/ },
      { file: 'apps/web/test/investigations.test.tsx', pattern: /create investigation \(separate screen\)/ },
    ]),
  },
  {
    requirement: 'Pages and components organization',
    evaluate: implementedAndTested('Route pages live in src/pages, reusable UI in src/components, and feature-specific behavior/forms in src/features; pages import these modules', [
      { file: 'apps/web/src/app/router.tsx', pattern: /from ['"].*pages\// },
      { file: 'apps/web/src/pages/hosts/HostsPage.tsx', pattern: /from ['"].*components\// },
      { file: 'apps/web/src/pages/hosts/CreateHostPage.tsx', pattern: /from ['"].*features\/hosts\/HostForm/ },
      { file: 'apps/web/src/features/hosts/HostForm.tsx', pattern: /from ['"].*components\/TextField/ },
    ]),
  },
  {
    requirement: 'Encapsulation',
    evaluate: implementedAndTested('Domain entities use runtime #private state and controlled domain methods; entity tests cover state and invariants', [
      { file: `${API}/domain/user.ts`, pattern: /readonly #email/ },
      { file: `${API}/domain/incident.ts`, pattern: /#status: IncidentStatus/ },
      { file: `${API}/domain/incident.ts`, pattern: /transitionTo\(/ },
      { file: `${API_TEST}/domain/entities.test.ts`, pattern: /private|snapshot|passwordHash/i },
      { file: `${API_TEST}/domain/incident.test.ts`, pattern: /transition|closed/i },
    ]),
  },
  {
    requirement: 'Valid constructors and invariants',
    evaluate: implementedAndTested('Private entity constructors are reached through factories/restore methods that validate; domain tests cover invalid values and lifecycle restoration', [
      { file: `${API}/domain/user.ts`, pattern: /private constructor/ },
      { file: `${API}/domain/user.ts`, pattern: /static register\(/ },
      { file: `${API}/domain/incident.ts`, pattern: /static open\(/ },
      { file: `${API}/domain/incident.ts`, pattern: /static restore\([\s\S]*assertLifecycle[\s\S]*validate/ },
      { file: `${API_TEST}/domain/incident.test.ts`, pattern: /invalid|inconsistent|reject/i },
      { file: `${API_TEST}/domain/investigation.test.ts`, pattern: /invalid|inconsistent|reject/i },
    ]),
  },
  {
    requirement: 'Getters and setters',
    evaluate: manualReview('domain entities expose values consumed by use cases and repositories; state changes go through named domain methods; automated absence checks cannot determine whether each getter is useful'),
  },
  {
    requirement: 'Object-oriented domain model',
    evaluate: implementedAndTested('User, Workspace, Membership, Host, DetectionRule, Incident and Investigation hold invariants and behavior; use cases call factories, update methods and lifecycle transitions', [
      { file: `${API}/domain/user.ts`, pattern: /class User extends Entity/ },
      { file: `${API}/domain/workspace.ts`, pattern: /createPersonal\(/ },
      { file: `${API}/domain/membership.ts`, pattern: /canManageResources/ },
      { file: `${API}/domain/host.ts`, pattern: /updateDetails\(/ },
      { file: `${API}/domain/detection-rule.ts`, pattern: /update\(/ },
      { file: `${API}/domain/incident.ts`, pattern: /transitionTo\(/ },
      { file: `${API}/domain/investigation.ts`, pattern: /transitionTo\(/ },
      { file: `${API_TEST}/domain/investigation.test.ts`, pattern: /conclusion|required|transition/i },
    ]),
  },
  {
    requirement: 'Inheritance',
    evaluate: implementedAndTested('Production domain entities extend Entity<TId>; specialized incident/investigation errors extend domain errors; tests exercise these types', [
      { file: 'packages/domain/src/entity.ts', pattern: /abstract class Entity/ },
      { file: `${API}/domain/user.ts`, pattern: /class User extends Entity<string>/ },
      { file: 'packages/domain/src/incident-rules.ts', pattern: /class InvalidIncidentTransitionError extends InvalidStateError/ },
      { file: 'packages/domain/src/investigation-rules.ts', pattern: /class InvestigationConclusionRequiredError extends ValidationError/ },
      { file: `${API_TEST}/domain/incident.test.ts`, pattern: /InvalidIncidentTransitionError/ },
      { file: `${API_TEST}/domain/investigation.test.ts`, pattern: /InvestigationConclusionRequiredError/ },
    ]),
  },
  {
    requirement: 'Abstract classes',
    evaluate: implementedAndTested('Entity<TId> and DomainError are abstract classes with concrete production subclasses; abstract declarations are separate from interfaces', [
      { file: 'packages/domain/src/entity.ts', pattern: /export abstract class Entity/ },
      { file: 'packages/domain/src/domain-error.ts', pattern: /export abstract class DomainError/ },
      { file: `${API}/domain/incident.ts`, pattern: /class Incident extends Entity<string>/ },
      { file: 'packages/domain/src/domain-error.ts', pattern: /class ValidationError extends DomainError/ },
    ]),
  },
  {
    requirement: 'Polymorphism',
    evaluate: implementedAndTested('The same application ports are implemented by production Drizzle repositories and in-memory test repositories; createUseCases accepts those ports and runs the same use cases with either adapter', [
      { file: `${API}/application/ports/repositories.ts`, pattern: /interface UserRepository/ },
      { file: `${API}/infrastructure/db/drizzle-repositories.ts`, pattern: /class DrizzleUserRepository implements UserRepository/ },
      { file: `${API_TEST}/support/in-memory-persistence.ts`, pattern: /class InMemoryUserRepository implements UserRepository/ },
      { file: `${API}/composition-root.ts`, pattern: /createUseCases\(adapters: Adapters/ },
      { file: `${API_TEST}/support/test-app.ts`, pattern: /createUseCases\(/ },
    ]),
  },
  {
    requirement: 'Interfaces and type aliases',
    evaluate: implementedAndTested('Repository/security ports and public transport interfaces/type aliases define boundaries between domain, application and web/API; consumers compile under strict TypeScript', [
      { file: `${API}/application/ports/repositories.ts`, pattern: /export interface (?:UserRepository|HostRepository|IncidentRepository)/ },
      { file: `${API}/application/ports/password-hasher.ts`, pattern: /export interface PasswordHasher/ },
      { file: 'packages/contracts/src/pagination.ts', pattern: /interface PaginatedResponse<T>/ },
      { file: 'packages/contracts/src/incidents.ts', pattern: /type (?:CreateIncidentRequest|IncidentListQuery)/ },
      { file: 'packages/domain/src/severity.ts', pattern: /type Severity/ },
    ]),
  },
  {
    requirement: 'Avoid explicit any',
    evaluate: (repo) => {
      const files = sourceFiles(repo, ['apps/api/src', 'apps/web/src', 'packages/domain/src', 'packages/contracts/src', 'tools/aegis-mcp/src']);
      const matches = new Set<string>();
      visitSource(repo, files, (node, file) => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) matches.add(file);
      });
      return matches.size === 0
        ? { state: 'PASS', evidence: `TypeScript AST scan found no explicit any types in ${files.length} production source files` }
        : { state: 'IN_PROGRESS', evidence: `explicit any type found in ${[...matches].join(', ')}` };
    },
  },
  {
    requirement: 'SOLID / Single Responsibility',
    evaluate: manualReview('one operation per use-case module, route files parse/dispatch/map, repositories isolate persistence, and web features own form/query behavior; automated patterns do not establish responsibility quality'),
  },
  {
    requirement: 'SOLID / Open-Closed',
    evaluate: manualReview('application ports allow alternate adapters, while adding a full resource still changes routes/composition/schema; the breadth of extension without core edits needs design review'),
  },
  {
    requirement: 'SOLID / Liskov Substitution',
    evaluate: manualReview('there are real Entity and DomainError hierarchies, but no dedicated substitutability contract suite; assess behavioral compatibility before PASS'),
  },
  {
    requirement: 'SOLID / Dependency Inversion',
    evaluate: implementedAndTested('Use cases consume application ports; Drizzle/Argon2/jose implementations are wired only in the composition root; in-memory implementations run the same cases in tests', [
      { file: `${API}/application/ports/repositories.ts`, pattern: /export interface Repositories/ },
      { file: `${API}/application/ports/password-hasher.ts`, pattern: /export interface PasswordHasher/ },
      { file: `${API}/application/ports/token-service.ts`, pattern: /export interface TokenService/ },
      { file: `${API}/composition-root.ts`, pattern: /createUseCases/ },
      { file: `${API_TEST}/support/in-memory-persistence.ts`, pattern: /implements UserRepository/ },
      { file: `${API_TEST}/application/use-cases.test.ts`, pattern: /createInMemoryPersistence/ },
    ]),
  },
  {
    requirement: 'Layered organization',
    evaluate: implementedAndTested('domain entities/rules map to domain; use cases and repository ports map to services/repositories; Drizzle adapters map to infrastructure repositories; Fastify routes map to presentation', [
      { file: `${API}/domain/incident.ts`, pattern: /export class Incident/ },
      { file: `${API}/application/use-cases/incidents/create-incident.ts`, pattern: /export class CreateIncident/ },
      { file: `${API}/application/ports/repositories.ts`, pattern: /export interface IncidentRepository/ },
      { file: `${API}/infrastructure/db/drizzle-repositories.ts`, pattern: /class DrizzleIncidentRepository implements IncidentRepository/ },
      { file: `${API}/presentation/http/routes/incidents.route.ts`, pattern: /app\.post\(/ },
      { file: `${API_TEST}/application/incidents.test.ts`, pattern: /describe\(/ },
    ]),
  },
  {
    requirement: 'Naming conventions',
    evaluate: manualReview('source uses PascalCase for types/components, camelCase for functions/properties, kebab-case for non-component modules and numbered snake_case SQL migrations; consistency is a manual judgment'),
  },
  {
    requirement: 'TypeScript application without injected JavaScript',
    evaluate: (repo) => {
      const files = repo.listFiles('apps').filter((file) => /\.(?:js|jsx)$/.test(file) && /\/src\//.test(file));
      const tsFiles = sourceFiles(repo, ['apps/api/src', 'apps/web/src']);
      const dynamicCode = new Set<string>();
      visitSource(repo, tsFiles, (node, file) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') dynamicCode.add(file);
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') dynamicCode.add(file);
      });
      const problems = [...files, ...dynamicCode];
      return problems.length === 0
        ? { state: 'PASS', evidence: `application source is TypeScript/TSX (${tsFiles.length} files); no JS/JSX or eval/new Function; .mjs files are infrastructure tooling` }
        : { state: 'IN_PROGRESS', evidence: `application JavaScript/dynamic code requires review: ${[...new Set(problems)].join(', ')}` };
    },
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
    requirement: 'Custom exceptions',
    evaluate: implementedAndTested('DomainError → Validation/Authentication/Forbidden/Conflict/NotFound/InvalidState, mapped to HTTP in one handler', [
      { file: 'packages/domain/src/domain-error.ts', pattern: /class ConflictError extends DomainError/ },
      { file: `${API}/presentation/http/error-handler.ts`, pattern: /instanceof ConflictError/ },
      { file: 'packages/domain/test/domain-error.test.ts', pattern: /stable code/ },
    ]),
  },
  {
    requirement: 'Docker',
    evaluate: implementedAndTested('compose.yaml (nginx/web/api/mysql + one-shot migrate, healthcheck, named volume) built and started from zero by npm run test:infra in CI', [
      { file: 'compose.yaml', pattern: /condition: service_completed_successfully/ },
      { file: 'compose.yaml', pattern: /healthcheck:/ },
      { file: 'compose.yaml', pattern: /mysql_data:\/var\/lib\/mysql/ },
      { file: 'infra/docker/api.Dockerfile', pattern: /USER node/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'migrations'/ },
      { file: INFRA_TEST, pattern: /'persistence across down\/up'/ },
    ]),
  },
  {
    requirement: 'Docker Compose services and environment',
    evaluate: implementedAndTested('Compose separates nginx, web, api, mysql and one-shot migrate, wires dependencies and passes values through environment variables; the isolated stack test starts the services from an empty volume', [
      { file: 'compose.yaml', pattern: /services:\s*\n\s+nginx:/ },
      { file: 'compose.yaml', pattern: /\n\s+web:/ },
      { file: 'compose.yaml', pattern: /\n\s+api:/ },
      { file: 'compose.yaml', pattern: /\n\s+mysql:/ },
      { file: 'compose.yaml', pattern: /\n\s+migrate:/ },
      { file: 'compose.yaml', pattern: /environment:/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'stack starts'/ },
    ]),
  },
  {
    requirement: 'Frontend and backend separation',
    evaluate: implementedAndTested('Web and API are separate Compose services behind Nginx routing; infra test validates SPA and API responses through the proxy', [
      { file: 'compose.yaml', pattern: /\n  web:/ },
      { file: 'compose.yaml', pattern: /\n  api:/ },
      { file: 'infra/nginx/nginx.conf', pattern: /location \/api\/ \{[\s\S]*proxy_pass http:\/\/aegis_api/ },
      { file: 'infra/nginx/nginx.conf', pattern: /location \/ \{[\s\S]*proxy_pass http:\/\/aegis_web/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'\/api\/health via nginx'/ },
      { file: INFRA_TEST, pattern: /'\/ via nginx serves Aegis Web'/ },
    ]),
  },
  {
    requirement: 'Persistent MySQL volume',
    evaluate: implementedAndTested('Named mysql_data volume is mounted at /var/lib/mysql and survives Compose down/up; the infra test inspects the mount and verifies a row plus migrations after restart', [
      { file: 'compose.yaml', pattern: /mysql_data:\/var\/lib\/mysql/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'mysql volume'/ },
      { file: INFRA_TEST, pattern: /'persistence across down\/up'/ },
    ]),
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
    evaluate: implementedAndTested('nginx is the public entry: /api/* → api (prefix stripped), /* → web; security headers and CSP verified over HTTP by the infra test', [
      { file: 'infra/nginx/nginx.conf', pattern: /location \/api\/ \{\s*proxy_pass http:\/\/aegis_api\/;/ },
      { file: 'infra/nginx/nginx.conf', pattern: /location \/ \{\s*proxy_pass http:\/\/aegis_web;/ },
      { file: 'infra/nginx/nginx.conf', pattern: /Content-Security-Policy/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'reverse proxy routing'/ },
      { file: INFRA_TEST, pattern: /'security headers and CSP'/ },
    ]),
  },
  {
    requirement: 'Network isolation',
    evaluate: implementedAndTested('only nginx publishes a port; application/data networks internal; web/nginx cannot reach mysql; api has no egress — inspected on the running stack', [
      { file: 'compose.yaml', pattern: /aegis_application:\s*internal:\s*true/ },
      { file: 'compose.yaml', pattern: /aegis_data:\s*internal:\s*true/ },
      ...INFRA_TEST_EVIDENCE,
      { file: INFRA_TEST, pattern: /'published ports'/ },
      { file: INFRA_TEST, pattern: /'networks'/ },
      { file: INFRA_TEST, pattern: /'network isolation'/ },
    ]),
  },
  {
    requirement: 'AGENTS.md',
    evaluate: (repo) =>
      contains(repo, 'AGENTS.md', /## Security Rules/) && contains(repo, 'AGENTS.md', /## Protected Resources/)
        ? { state: 'PASS', evidence: 'AGENTS.md with security and protected-resource sections' }
        : { state: 'TODO', evidence: 'AGENTS.md missing or incomplete' },
  },
  {
    requirement: 'Agent guardrails',
    evaluate: implementedAndTested('AGENTS.md and all three specialist skills state allowed/prohibited work and validation boundaries; MCP tools use an allowlist and tests cover policy boundaries', [
      { file: 'AGENTS.md', pattern: /## Security Rules[\s\S]*## Protected Resources/ },
      { file: 'agents/skills/backend-engineering/SKILL.md', pattern: /## Allowed Actions[\s\S]*## Forbidden Actions/ },
      { file: 'agents/skills/frontend-engineering/SKILL.md', pattern: /## Allowed Actions[\s\S]*## Forbidden Actions/ },
      { file: 'agents/skills/security-review/SKILL.md', pattern: /## Allowed Actions[\s\S]*## Forbidden Actions/ },
      { file: 'tools/aegis-mcp/src/policy/protected-paths.ts', pattern: /ALLOWED_ROOT_DIRECTORIES/ },
      { file: 'tools/aegis-mcp/test/protected-paths.test.ts', pattern: /protected|blocked|denied/i },
    ]),
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
  {
    requirement: 'Sensitive file read and exposure protection',
    evaluate: implementedAndTested('MCP path resolution denies .env, credentials and key files; repository reads and security scans use the guard; tests cover path rejection and redaction', [
      { file: 'AGENTS.md', pattern: /Agents \*\*must not read, open, print or copy\*\*:/ },
      { file: 'tools/aegis-mcp/src/policy/protected-paths.ts', pattern: /\.env|\.pem|credentials/ },
      { file: 'tools/aegis-mcp/src/repo.ts', pattern: /resolveRepoPath\(this\.root, relativePath\)/ },
      { file: 'tools/aegis-mcp/test/protected-paths.test.ts', pattern: /\.env/ },
      { file: 'tools/aegis-mcp/test/redact.test.ts', pattern: /secret|token|redact/i },
      { file: 'tools/aegis-mcp/src/tools/security-check.ts', pattern: /matched value|finding\.file/ },
    ]),
  },
];

const CRUDS = ['Hosts CRUD', 'Detection Rules CRUD', 'Incidents CRUD', 'Investigations CRUD'] as const;
/** Each CRUD check already demands its own routes, auth hook, pagination, separate create/edit screens and tests. */
const CRUDS_PREREQUISITES = [...CRUDS, 'Authentication', 'Pagination', 'MySQL'] as const;

/** Derived from the checks above, never from documentation: PASS only when all four CRUDs and their prerequisites pass. */
function academicCruds(results: readonly RubricResult[]): RubricResult {
  const passing = CRUDS.filter((name) => results.some((result) => result.requirement === name && result.state === 'PASS'));
  const missing = CRUDS_PREREQUISITES.filter((name) => !results.some((result) => result.requirement === name && result.state === 'PASS'));
  if (missing.length === 0) return { requirement: 'Academic CRUDs (4/4)', state: 'PASS', evidence: `${passing.length}/4 CRUDs with authentication, pagination, MySQL and web screens` };
  return {
    requirement: 'Academic CRUDs (4/4)',
    state: passing.length === 0 ? 'TODO' : 'IN_PROGRESS',
    evidence: `${passing.length}/4 CRUDs; not yet PASS: ${missing.join(', ')}`,
  };
}

export function evaluateRubric(repo: RepoReader): RubricResult[] {
  const results = CHECKS.map((check) => ({ requirement: check.requirement, ...check.evaluate(repo) }));
  return [...results, academicCruds(results)];
}

export function formatRubric(results: readonly RubricResult[]): string {
  const width = 30;
  return results
    .map((result) => `${result.requirement} ${'.'.repeat(Math.max(2, width - result.requirement.length))} ${result.state}  (${result.evidence})`)
    .join('\n');
}
