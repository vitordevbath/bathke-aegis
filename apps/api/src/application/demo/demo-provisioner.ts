import { randomBytes, randomInt } from 'node:crypto';
import { Cpf, Email } from '@aegis/domain';
import { Membership } from '../../domain/membership.js';
import { User } from '../../domain/user.js';
import { Workspace } from '../../domain/workspace.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../ports/repositories.js';
import type { CreateHost } from '../use-cases/hosts/create-host.js';
import type { ListHosts } from '../use-cases/hosts/list-hosts.js';
import type { CreateDetectionRule } from '../use-cases/detection-rules/create-detection-rule.js';
import type { CreateIncident } from '../use-cases/incidents/create-incident.js';
import type { UpdateIncident } from '../use-cases/incidents/update-incident.js';
import type { CreateInvestigation } from '../use-cases/investigations/create-investigation.js';
import type { UpdateInvestigation } from '../use-cases/investigations/update-investigation.js';
import { DEMO_HOSTS, DEMO_INCIDENTS, DEMO_INVESTIGATION, DEMO_OPERATOR, DEMO_RULES, type DemoHostKey } from './demo-catalog.js';

export interface DemoUseCases {
  readonly createHost: CreateHost;
  readonly listHosts: ListHosts;
  readonly createDetectionRule: CreateDetectionRule;
  readonly createIncident: CreateIncident;
  readonly updateIncident: UpdateIncident;
  readonly createInvestigation: CreateInvestigation;
  readonly updateInvestigation: UpdateInvestigation;
}

export interface DemoWorkspace {
  readonly workspaceId: string;
  readonly operator: User;
  /** Demo host ids by catalog key; a host removed by hand is simply absent. */
  readonly hostIds: ReadonlyMap<DemoHostKey, string>;
  /** True when this call created the workspace and its sample content. */
  readonly created: boolean;
  /** Accounts that received read-only access in this call. */
  readonly viewersAdded: number;
}

/** A syntactically valid CPF for the system account; it is never shown and nobody signs in with it. */
function syntheticCpf(): Cpf {
  for (;;) {
    const base = Array.from({ length: 9 }, () => randomInt(10));
    const digit = (digits: number[]) => {
      const remainder = (digits.reduce((total, value, index) => total + value * (digits.length + 1 - index), 0) * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    const first = digit(base);
    const raw = [...base, first, digit([...base, first])].join('');
    if (Cpf.isValid(raw)) return Cpf.create(raw);
  }
}

/**
 * Creates the AEGIS DEMO workspace once and keeps it reachable (ADR-052):
 * - a system OWNER that cannot sign in (random password, never stored in clear);
 * - sample hosts, rules, incidents and an investigation, created through the same use cases a
 *   person would use, so every invariant and validation applies;
 * - read-only (VIEWER) access for every account, including those created before the demo existed.
 * Safe to run on every start: an existing demo is reused and never re-seeded.
 */
export class DemoProvisioner {
  constructor(
    private readonly repositories: Repositories,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly useCases: DemoUseCases,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ensure(): Promise<DemoWorkspace> {
    const existing = await this.repositories.workspaces.findFirstOfKind('demo');
    const { operator, workspace } = existing ? { operator: await this.operatorOf(), workspace: existing } : await this.createWorkspace();
    if (!existing) await this.seed(operator, workspace.id);
    const viewersAdded = await this.repositories.memberships.grantToUsersWithout(workspace.id, 'VIEWER', this.clock());
    return { workspaceId: workspace.id, operator, hostIds: await this.hostIds(operator, workspace.id), created: !existing, viewersAdded };
  }

  private async operatorOf(): Promise<User> {
    const operator = await this.repositories.users.findByEmail(Email.create(DEMO_OPERATOR.email));
    if (!operator) throw new Error('AEGIS DEMO exists without its operator account');
    return operator;
  }

  /** Operator, workspace and OWNER membership in one transaction: no user without a workspace, no workspace without an owner. */
  private async createWorkspace(): Promise<{ operator: User; workspace: Workspace }> {
    const now = this.clock();
    let cpf = syntheticCpf();
    while (await this.repositories.users.existsByCpf(cpf)) cpf = syntheticCpf();
    // 256 random bits hashed with Argon2id and then forgotten: the account exists for ownership and audit only.
    const passwordHash = await this.hasher.hash(randomBytes(32).toString('base64url'));
    const operator = User.register({ name: DEMO_OPERATOR.name, email: Email.create(DEMO_OPERATOR.email), cpf, passwordHash }, now);
    const workspace = Workspace.createDemo(now);
    await this.unitOfWork.run(async ({ users, workspaces, memberships }) => {
      await users.insert(operator);
      await workspaces.insert(workspace);
      await memberships.insert(Membership.grantOwner(operator, workspace, now));
    });
    return { operator, workspace };
  }

  private async seed(operator: User, workspaceId: string): Promise<void> {
    const hosts = new Map<DemoHostKey, string>();
    for (const spec of DEMO_HOSTS) {
      const host = await this.useCases.createHost.execute(operator, workspaceId, { displayName: spec.displayName, description: spec.description });
      hosts.set(spec.key, host.id);
    }
    const hostIdsOf = (keys: readonly DemoHostKey[]) => keys.map((key) => hosts.get(key) ?? '');

    const rules = new Map<string, string>();
    for (const { key, targets, ...details } of DEMO_RULES) {
      const rule = await this.useCases.createDetectionRule.execute(operator, workspaceId, { ...details, targetHostIds: hostIdsOf(targets) });
      rules.set(key, rule.rule.id);
    }

    const incidents = new Map<string, string>();
    for (const spec of DEMO_INCIDENTS) {
      const details = {
        title: spec.title,
        description: spec.description,
        severity: spec.severity,
        hostIds: hostIdsOf(spec.hosts),
        detectionRuleIds: spec.rules.map((key) => rules.get(key) ?? ''),
      };
      const created = await this.useCases.createIncident.execute(operator, workspaceId, details);
      incidents.set(spec.key, created.incident.id);
      if (spec.status !== 'OPEN') await this.useCases.updateIncident.execute(operator, workspaceId, created.incident.id, details, spec.status);
    }

    const investigation = {
      title: DEMO_INVESTIGATION.title,
      description: DEMO_INVESTIGATION.description,
      incidentIds: DEMO_INVESTIGATION.incidents.map((key) => incidents.get(key) ?? ''),
    };
    const opened = await this.useCases.createInvestigation.execute(operator, workspaceId, investigation);
    await this.useCases.updateInvestigation.execute(
      operator,
      workspaceId,
      opened.investigation.id,
      { ...investigation, conclusion: DEMO_INVESTIGATION.conclusion },
      'IN_PROGRESS',
    );
  }

  private async hostIds(operator: User, workspaceId: string): Promise<Map<DemoHostKey, string>> {
    const page = await this.useCases.listHosts.execute(operator, workspaceId, { page: 1, pageSize: 100 });
    const byName = new Map(page.items.map((host) => [host.displayName, host.id]));
    const ids = new Map<DemoHostKey, string>();
    for (const spec of DEMO_HOSTS) {
      const id = byName.get(spec.displayName);
      if (id) ids.set(spec.key, id);
    }
    return ids;
  }
}
