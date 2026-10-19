import { and, asc, count, desc, eq, inArray, like, ne, or, type SQL } from 'drizzle-orm';
import type { MySqlDatabase } from 'drizzle-orm/mysql-core';
import type { MySql2PreparedQueryHKT, MySql2QueryResultHKT } from 'drizzle-orm/mysql2';
import { ConflictError, type Cpf, type Email } from '@aegis/domain';
import { User } from '../../domain/user.js';
import { Workspace } from '../../domain/workspace.js';
import { Membership } from '../../domain/membership.js';
import { Host } from '../../domain/host.js';
import { DetectionRule } from '../../domain/detection-rule.js';
import { Incident } from '../../domain/incident.js';
import { Investigation } from '../../domain/investigation.js';
import { offsetOf, type Page } from '../../application/pagination.js';
import type {
  DetectionRuleListFilter,
  DetectionRuleRepository,
  HostListFilter,
  HostRepository,
  IncidentListFilter,
  IncidentRepository,
  InvestigationListFilter,
  InvestigationRepository,
  MembershipRepository,
  Repositories,
  UnitOfWork,
  UserRepository,
  WorkspaceMembership,
  WorkspaceRepository,
} from '../../application/ports/repositories.js';
import { CPF_TAKEN_MESSAGE, EMAIL_TAKEN_MESSAGE } from '../../application/use-cases/register-user.js';
import { HOST_IN_INCIDENT_MESSAGE, HOST_TARGETED_MESSAGE } from '../../application/use-cases/hosts/delete-host.js';
import { RULE_IN_INCIDENT_MESSAGE } from '../../application/use-cases/detection-rules/delete-detection-rule.js';
import { INCIDENT_IN_INVESTIGATION_MESSAGE } from '../../application/use-cases/incidents/delete-incident.js';
import type { Database } from './client.js';
import * as schema from './schema.js';
import {
  detectionRuleTargets,
  detectionRules,
  hosts,
  incidentDetectionRules,
  incidentHosts,
  incidents,
  investigationIncidents,
  investigations,
  memberships,
  users,
  workspaces,
} from './schema.js';

/** Either the pooled database or a transaction handle — both expose the same query API. */
type Executor = MySqlDatabase<MySql2QueryResultHKT, MySql2PreparedQueryHKT, typeof schema>;

/** Finds the driver error under Drizzle's wrapper (`DrizzleQueryError.cause`). */
function driverError(error: unknown): { code?: unknown; message?: unknown } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current) return current as { code?: unknown; message?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A FK RESTRICT refused the delete (a referencing row was written concurrently). */
function referencedBy(error: unknown): string | undefined {
  const cause = driverError(error);
  if (cause?.code !== 'ER_ROW_IS_REFERENCED_2') return undefined;
  return typeof cause.message === 'string' ? cause.message : '';
}

/** Maps unique-key violations to domain conflicts; anything else propagates unchanged. */
function rethrowUniqueViolation(error: unknown): never {
  const cause = driverError(error);
  if (cause?.code === 'ER_DUP_ENTRY' && typeof cause.message === 'string') {
    if (cause.message.includes('users_email_unique')) throw new ConflictError(EMAIL_TAKEN_MESSAGE, 'email');
    if (cause.message.includes('users_cpf_unique')) throw new ConflictError(CPF_TAKEN_MESSAGE, 'cpf');
  }
  throw error;
}

class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? User.restore(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.value)).limit(1);
    return row ? User.restore(row) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email.value)).limit(1);
    return rows.length > 0;
  }

  async existsByCpf(cpf: Cpf, exceptUserId?: string): Promise<boolean> {
    const condition = exceptUserId ? and(eq(users.cpf, cpf.value), ne(users.id, exceptUserId)) : eq(users.cpf, cpf.value);
    const rows = await this.db.select({ id: users.id }).from(users).where(condition).limit(1);
    return rows.length > 0;
  }

  async insert(user: User): Promise<void> {
    try {
      await this.db.insert(users).values(user.toSnapshot());
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async update(user: User): Promise<void> {
    const { name, cpf, passwordHash, updatedAt } = user.toSnapshot();
    try {
      // `email` is intentionally absent from the SET list.
      await this.db.update(users).set({ name, cpf, passwordHash, updatedAt }).where(eq(users.id, user.id));
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }
}

class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Executor) {}

  async insert(workspace: Workspace): Promise<void> {
    await this.db.insert(workspaces).values(workspace.toSnapshot());
  }
}

class DrizzleMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Executor) {}

  async insert(membership: Membership): Promise<void> {
    await this.db.insert(memberships).values(membership.toSnapshot());
  }

  async find(userId: string, workspaceId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    return row ? Membership.restore(row) : null;
  }

  async listForUser(userId: string): Promise<WorkspaceMembership[]> {
    const rows = await this.db
      .select({ workspace: workspaces, membership: memberships })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt), asc(workspaces.name));
    return rows.map((row) => ({ workspace: Workspace.restore(row.workspace), membership: Membership.restore(row.membership) }));
  }
}

/** Escapes LIKE wildcards so user input is matched literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

class DrizzleHostRepository implements HostRepository {
  constructor(private readonly db: Executor) {}

  async insert(host: Host): Promise<void> {
    await this.db.insert(hosts).values(host.toSnapshot());
  }

  async findInWorkspace(workspaceId: string, hostId: string): Promise<Host | null> {
    const [row] = await this.db
      .select()
      .from(hosts)
      .where(and(eq(hosts.workspaceId, workspaceId), eq(hosts.id, hostId)))
      .limit(1);
    return row ? Host.restore(row) : null;
  }

  async findManyInWorkspace(workspaceId: string, hostIds: readonly string[]): Promise<Host[]> {
    if (hostIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(hosts)
      .where(and(eq(hosts.workspaceId, workspaceId), inArray(hosts.id, [...hostIds])))
      .orderBy(asc(hosts.displayName), asc(hosts.id));
    return rows.map((row) => Host.restore(row));
  }

  async listInWorkspace(workspaceId: string, filter: HostListFilter): Promise<Page<Host>> {
    const search = filter.search
      ? or(like(hosts.displayName, containsPattern(filter.search)), like(hosts.description, containsPattern(filter.search)))
      : undefined;
    const where = and(eq(hosts.workspaceId, workspaceId), search);

    // Two queries per page (rows + total), both served by hosts_workspace_created_idx.
    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(hosts)
        .where(where)
        .orderBy(desc(hosts.createdAt), desc(hosts.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.db.select({ total: count() }).from(hosts).where(where),
    ]);

    return { items: rows.map((row) => Host.restore(row)), total: totals?.total ?? 0, page: filter.page, pageSize: filter.pageSize };
  }

  async update(host: Host): Promise<void> {
    const { workspaceId, displayName, description, updatedAt } = host.toSnapshot();
    // Only administrative columns are written; collector columns are never touched here.
    await this.db
      .update(hosts)
      .set({ displayName, description, updatedAt })
      .where(and(eq(hosts.workspaceId, workspaceId), eq(hosts.id, host.id)));
  }

  async deleteInWorkspace(workspaceId: string, hostId: string): Promise<boolean> {
    try {
      const [result] = await this.db.delete(hosts).where(and(eq(hosts.workspaceId, workspaceId), eq(hosts.id, hostId)));
      return result.affectedRows > 0;
    } catch (error) {
      // FK RESTRICT from detection_rule_targets or incident_hosts (a reference was added concurrently).
      const message = referencedBy(error);
      if (message !== undefined) throw new ConflictError(message.includes('incident_hosts') ? HOST_IN_INCIDENT_MESSAGE : HOST_TARGETED_MESSAGE);
      throw error;
    }
  }
}

type DetectionRuleRow = typeof detectionRules.$inferSelect;

class DrizzleDetectionRuleRepository implements DetectionRuleRepository {
  constructor(private readonly db: Executor) {}

  async insert(rule: DetectionRule): Promise<void> {
    const { targetHostIds, ...row } = rule.toSnapshot();
    await this.db.insert(detectionRules).values(row);
    await this.insertTargets(rule.id, targetHostIds, row.createdAt);
  }

  async findInWorkspace(workspaceId: string, ruleId: string): Promise<DetectionRule | null> {
    const [row] = await this.db
      .select()
      .from(detectionRules)
      .where(and(eq(detectionRules.workspaceId, workspaceId), eq(detectionRules.id, ruleId)))
      .limit(1);
    if (!row) return null;
    const targets = await this.targetsOf([row.id]);
    return this.toEntity(row, targets);
  }

  async findManyInWorkspace(workspaceId: string, ruleIds: readonly string[]): Promise<DetectionRule[]> {
    if (ruleIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(detectionRules)
      .where(and(eq(detectionRules.workspaceId, workspaceId), inArray(detectionRules.id, [...ruleIds])))
      .orderBy(asc(detectionRules.name), asc(detectionRules.id));
    const targets = await this.targetsOf(rows.map((row) => row.id));
    return rows.map((row) => this.toEntity(row, targets));
  }

  async listInWorkspace(workspaceId: string, filter: DetectionRuleListFilter): Promise<Page<DetectionRule>> {
    const conditions: (SQL | undefined)[] = [eq(detectionRules.workspaceId, workspaceId)];
    if (filter.search) {
      const pattern = containsPattern(filter.search);
      conditions.push(or(like(detectionRules.name, pattern), like(detectionRules.description, pattern)));
    }
    if (filter.severity) conditions.push(eq(detectionRules.severity, filter.severity));
    if (filter.eventCategory) conditions.push(eq(detectionRules.eventCategory, filter.eventCategory));
    if (filter.enabled !== undefined) conditions.push(eq(detectionRules.enabled, filter.enabled));
    const where = and(...conditions);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(detectionRules)
        .where(where)
        .orderBy(desc(detectionRules.createdAt), desc(detectionRules.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.db.select({ total: count() }).from(detectionRules).where(where),
    ]);
    // One query for the targets of the whole page (no N+1).
    const targets = await this.targetsOf(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toEntity(row, targets)),
      total: totals?.total ?? 0,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(rule: DetectionRule): Promise<void> {
    const { id, workspaceId, createdAt: _createdAt, targetHostIds, ...changes } = rule.toSnapshot();
    await this.db
      .update(detectionRules)
      .set(changes)
      .where(and(eq(detectionRules.workspaceId, workspaceId), eq(detectionRules.id, id)));
    await this.db.delete(detectionRuleTargets).where(eq(detectionRuleTargets.detectionRuleId, id));
    await this.insertTargets(id, targetHostIds, changes.updatedAt);
  }

  async deleteInWorkspace(workspaceId: string, ruleId: string): Promise<boolean> {
    try {
      const [result] = await this.db
        .delete(detectionRules)
        .where(and(eq(detectionRules.workspaceId, workspaceId), eq(detectionRules.id, ruleId)));
      return result.affectedRows > 0;
    } catch (error) {
      // FK RESTRICT from incident_detection_rules (an incident related the rule concurrently).
      if (referencedBy(error) !== undefined) throw new ConflictError(RULE_IN_INCIDENT_MESSAGE);
      throw error;
    }
  }

  async isHostTargeted(hostId: string): Promise<boolean> {
    const rows = await this.db
      .select({ hostId: detectionRuleTargets.hostId })
      .from(detectionRuleTargets)
      .where(eq(detectionRuleTargets.hostId, hostId))
      .limit(1);
    return rows.length > 0;
  }

  private async insertTargets(ruleId: string, hostIds: readonly string[], createdAt: Date): Promise<void> {
    if (hostIds.length === 0) return;
    await this.db.insert(detectionRuleTargets).values(hostIds.map((hostId) => ({ detectionRuleId: ruleId, hostId, createdAt })));
  }

  private async targetsOf(ruleIds: readonly string[]): Promise<Map<string, string[]>> {
    const byRule = new Map<string, string[]>();
    if (ruleIds.length === 0) return byRule;
    const rows = await this.db
      .select({ ruleId: detectionRuleTargets.detectionRuleId, hostId: detectionRuleTargets.hostId })
      .from(detectionRuleTargets)
      .where(inArray(detectionRuleTargets.detectionRuleId, [...ruleIds]))
      .orderBy(asc(detectionRuleTargets.createdAt), asc(detectionRuleTargets.hostId));
    for (const row of rows) byRule.set(row.ruleId, [...(byRule.get(row.ruleId) ?? []), row.hostId]);
    return byRule;
  }

  private toEntity(row: DetectionRuleRow, targets: Map<string, string[]>): DetectionRule {
    return DetectionRule.restore({ ...row, targetHostIds: targets.get(row.id) ?? [] });
  }
}

type IncidentRow = typeof incidents.$inferSelect;

/** Groups (owner, related) pairs by owner, keeping the query order. */
function groupBy(rows: readonly { owner: string; related: string }[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) grouped.set(row.owner, [...(grouped.get(row.owner) ?? []), row.related]);
  return grouped;
}

class DrizzleIncidentRepository implements IncidentRepository {
  constructor(private readonly db: Executor) {}

  async insert(incident: Incident): Promise<void> {
    const { hostIds, detectionRuleIds, ...row } = incident.toSnapshot();
    await this.db.insert(incidents).values(row);
    await this.insertRelations(incident.id, hostIds, detectionRuleIds, row.createdAt);
  }

  async findInWorkspace(workspaceId: string, incidentId: string): Promise<Incident | null> {
    const [row] = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.workspaceId, workspaceId), eq(incidents.id, incidentId)))
      .limit(1);
    if (!row) return null;
    const [hostsOf, rulesOf] = await this.relationsOf([row.id]);
    return this.toEntity(row, hostsOf, rulesOf);
  }

  async findManyInWorkspace(workspaceId: string, incidentIds: readonly string[]): Promise<Incident[]> {
    if (incidentIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.workspaceId, workspaceId), inArray(incidents.id, [...incidentIds])))
      .orderBy(desc(incidents.createdAt), desc(incidents.id));
    const [hostsOf, rulesOf] = await this.relationsOf(rows.map((row) => row.id));
    return rows.map((row) => this.toEntity(row, hostsOf, rulesOf));
  }

  async listInWorkspace(workspaceId: string, filter: IncidentListFilter): Promise<Page<Incident>> {
    const conditions: (SQL | undefined)[] = [eq(incidents.workspaceId, workspaceId)];
    if (filter.search) {
      const pattern = containsPattern(filter.search);
      conditions.push(or(like(incidents.title, pattern), like(incidents.description, pattern)));
    }
    if (filter.severity) conditions.push(eq(incidents.severity, filter.severity));
    if (filter.status) conditions.push(eq(incidents.status, filter.status));
    if (filter.origin) conditions.push(eq(incidents.origin, filter.origin));
    const where = and(...conditions);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(incidents)
        .where(where)
        .orderBy(desc(incidents.createdAt), desc(incidents.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.db.select({ total: count() }).from(incidents).where(where),
    ]);
    // One query per relation table for the whole page (no N+1).
    const [hostsOf, rulesOf] = await this.relationsOf(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toEntity(row, hostsOf, rulesOf)),
      total: totals?.total ?? 0,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(incident: Incident): Promise<void> {
    const { id, workspaceId, title, description, severity, status, updatedAt, resolvedAt, hostIds, detectionRuleIds } = incident.toSnapshot();
    // `origin`, `workspace_id` and `created_at` are intentionally absent from the SET list.
    await this.db
      .update(incidents)
      .set({ title, description, severity, status, updatedAt, resolvedAt })
      .where(and(eq(incidents.workspaceId, workspaceId), eq(incidents.id, id)));
    await this.db.delete(incidentHosts).where(eq(incidentHosts.incidentId, id));
    await this.db.delete(incidentDetectionRules).where(eq(incidentDetectionRules.incidentId, id));
    await this.insertRelations(id, hostIds, detectionRuleIds, updatedAt);
  }

  async deleteInWorkspace(workspaceId: string, incidentId: string): Promise<boolean> {
    try {
      const [result] = await this.db.delete(incidents).where(and(eq(incidents.workspaceId, workspaceId), eq(incidents.id, incidentId)));
      return result.affectedRows > 0;
    } catch (error) {
      // FK RESTRICT from investigation_incidents (an investigation grouped the incident concurrently).
      if (referencedBy(error) !== undefined) throw new ConflictError(INCIDENT_IN_INVESTIGATION_MESSAGE);
      throw error;
    }
  }

  async isHostInvolved(hostId: string): Promise<boolean> {
    const rows = await this.db.select({ hostId: incidentHosts.hostId }).from(incidentHosts).where(eq(incidentHosts.hostId, hostId)).limit(1);
    return rows.length > 0;
  }

  async isRuleRelated(ruleId: string): Promise<boolean> {
    const rows = await this.db
      .select({ ruleId: incidentDetectionRules.detectionRuleId })
      .from(incidentDetectionRules)
      .where(eq(incidentDetectionRules.detectionRuleId, ruleId))
      .limit(1);
    return rows.length > 0;
  }

  private async insertRelations(incidentId: string, hostIds: readonly string[], ruleIds: readonly string[], createdAt: Date): Promise<void> {
    if (hostIds.length > 0) await this.db.insert(incidentHosts).values(hostIds.map((hostId) => ({ incidentId, hostId, createdAt })));
    if (ruleIds.length > 0) {
      await this.db.insert(incidentDetectionRules).values(ruleIds.map((detectionRuleId) => ({ incidentId, detectionRuleId, createdAt })));
    }
  }

  private async relationsOf(incidentIds: readonly string[]): Promise<[Map<string, string[]>, Map<string, string[]>]> {
    if (incidentIds.length === 0) return [new Map(), new Map()];
    const ids = [...incidentIds];
    const [hostRows, ruleRows] = await Promise.all([
      this.db
        .select({ owner: incidentHosts.incidentId, related: incidentHosts.hostId })
        .from(incidentHosts)
        .where(inArray(incidentHosts.incidentId, ids))
        .orderBy(asc(incidentHosts.createdAt), asc(incidentHosts.hostId)),
      this.db
        .select({ owner: incidentDetectionRules.incidentId, related: incidentDetectionRules.detectionRuleId })
        .from(incidentDetectionRules)
        .where(inArray(incidentDetectionRules.incidentId, ids))
        .orderBy(asc(incidentDetectionRules.createdAt), asc(incidentDetectionRules.detectionRuleId)),
    ]);
    return [groupBy(hostRows), groupBy(ruleRows)];
  }

  private toEntity(row: IncidentRow, hostsOf: Map<string, string[]>, rulesOf: Map<string, string[]>): Incident {
    return Incident.restore({ ...row, hostIds: hostsOf.get(row.id) ?? [], detectionRuleIds: rulesOf.get(row.id) ?? [] });
  }
}

type InvestigationRow = typeof investigations.$inferSelect;

class DrizzleInvestigationRepository implements InvestigationRepository {
  constructor(private readonly db: Executor) {}

  async insert(investigation: Investigation): Promise<void> {
    const { incidentIds, ...row } = investigation.toSnapshot();
    await this.db.insert(investigations).values(row);
    await this.insertIncidents(investigation.id, incidentIds, row.createdAt);
  }

  async findInWorkspace(workspaceId: string, investigationId: string): Promise<Investigation | null> {
    const [row] = await this.db
      .select()
      .from(investigations)
      .where(and(eq(investigations.workspaceId, workspaceId), eq(investigations.id, investigationId)))
      .limit(1);
    if (!row) return null;
    return this.toEntity(row, await this.incidentsOf([row.id]));
  }

  async listInWorkspace(workspaceId: string, filter: InvestigationListFilter): Promise<Page<Investigation>> {
    const conditions: (SQL | undefined)[] = [eq(investigations.workspaceId, workspaceId)];
    if (filter.search) {
      const pattern = containsPattern(filter.search);
      conditions.push(or(like(investigations.title, pattern), like(investigations.description, pattern), like(investigations.conclusion, pattern)));
    }
    if (filter.status) conditions.push(eq(investigations.status, filter.status));
    const where = and(...conditions);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(investigations)
        .where(where)
        .orderBy(desc(investigations.createdAt), desc(investigations.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.db.select({ total: count() }).from(investigations).where(where),
    ]);
    // One query for the incident ids of the whole page (no N+1).
    const incidentsOf = await this.incidentsOf(rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toEntity(row, incidentsOf)),
      total: totals?.total ?? 0,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(investigation: Investigation): Promise<void> {
    const { id, workspaceId, title, description, conclusion, status, updatedAt, closedAt, incidentIds } = investigation.toSnapshot();
    // `workspace_id` and `created_at` are intentionally absent from the SET list.
    await this.db
      .update(investigations)
      .set({ title, description, conclusion, status, updatedAt, closedAt })
      .where(and(eq(investigations.workspaceId, workspaceId), eq(investigations.id, id)));
    await this.db.delete(investigationIncidents).where(eq(investigationIncidents.investigationId, id));
    await this.insertIncidents(id, incidentIds, updatedAt);
  }

  async deleteInWorkspace(workspaceId: string, investigationId: string): Promise<boolean> {
    const [result] = await this.db
      .delete(investigations)
      .where(and(eq(investigations.workspaceId, workspaceId), eq(investigations.id, investigationId)));
    return result.affectedRows > 0;
  }

  async isIncidentInvestigated(incidentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ incidentId: investigationIncidents.incidentId })
      .from(investigationIncidents)
      .where(eq(investigationIncidents.incidentId, incidentId))
      .limit(1);
    return rows.length > 0;
  }

  private async insertIncidents(investigationId: string, incidentIds: readonly string[], createdAt: Date): Promise<void> {
    if (incidentIds.length === 0) return;
    await this.db.insert(investigationIncidents).values(incidentIds.map((incidentId) => ({ investigationId, incidentId, createdAt })));
  }

  private async incidentsOf(investigationIds: readonly string[]): Promise<Map<string, string[]>> {
    if (investigationIds.length === 0) return new Map();
    const rows = await this.db
      .select({ owner: investigationIncidents.investigationId, related: investigationIncidents.incidentId })
      .from(investigationIncidents)
      .where(inArray(investigationIncidents.investigationId, [...investigationIds]))
      .orderBy(asc(investigationIncidents.createdAt), asc(investigationIncidents.incidentId));
    return groupBy(rows);
  }

  private toEntity(row: InvestigationRow, incidentsOf: Map<string, string[]>): Investigation {
    return Investigation.restore({ ...row, incidentIds: incidentsOf.get(row.id) ?? [] });
  }
}

export function createDrizzleRepositories(db: Executor): Repositories {
  return {
    users: new DrizzleUserRepository(db),
    workspaces: new DrizzleWorkspaceRepository(db),
    memberships: new DrizzleMembershipRepository(db),
    hosts: new DrizzleHostRepository(db),
    detectionRules: new DrizzleDetectionRuleRepository(db),
    incidents: new DrizzleIncidentRepository(db),
    investigations: new DrizzleInvestigationRepository(db),
  };
}

/** MySQL transaction: commit when `work` resolves, rollback when it throws. */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(createDrizzleRepositories(tx)));
  }
}
