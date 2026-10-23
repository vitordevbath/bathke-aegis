import { ConflictError, type Cpf, type Email } from '@aegis/domain';
import { User, type UserSnapshot } from '../../src/domain/user.js';
import { Workspace, type WorkspaceSnapshot } from '../../src/domain/workspace.js';
import { Membership, type MembershipSnapshot } from '../../src/domain/membership.js';
import { Host, type HostSnapshot } from '../../src/domain/host.js';
import { DetectionRule, type DetectionRuleSnapshot } from '../../src/domain/detection-rule.js';
import { Incident, type IncidentSnapshot } from '../../src/domain/incident.js';
import { Investigation, type InvestigationSnapshot } from '../../src/domain/investigation.js';
import { TelemetryEvent, type TelemetryEventSnapshot } from '../../src/domain/telemetry-event.js';
import { offsetOf, type Page } from '../../src/application/pagination.js';
import type {
  DetectionRuleListFilter,
  DetectionRuleRepository,
  EventListFilter,
  EventRepository,
  HostListFilter,
  HostRepository,
  IncidentListFilter,
  IncidentRepository,
  InvestigationListFilter,
  InvestigationRepository,
  MembershipRepository,
  Repositories,
  StoredEvent,
  UnitOfWork,
  UserRepository,
  WorkspaceMembership,
  WorkspaceRepository,
} from '../../src/application/ports/repositories.js';

/**
 * Test double for the persistence ports. Stores snapshots (so reads go through
 * `restore` like the real adapter) and mimics MySQL's unique and foreign-key
 * constraints closely enough for application tests.
 */
export class InMemoryStore {
  users = new Map<string, UserSnapshot>();
  workspaces = new Map<string, WorkspaceSnapshot>();
  memberships = new Map<string, MembershipSnapshot>();
  hosts = new Map<string, HostSnapshot>();
  detectionRules = new Map<string, DetectionRuleSnapshot>();
  incidents = new Map<string, IncidentSnapshot>();
  investigations = new Map<string, InvestigationSnapshot>();
  events = new Map<string, TelemetryEventSnapshot>();

  clone(): InMemoryStore {
    const copy = new InMemoryStore();
    copy.users = new Map(this.users);
    copy.workspaces = new Map(this.workspaces);
    copy.memberships = new Map(this.memberships);
    copy.hosts = new Map(this.hosts);
    copy.detectionRules = new Map(this.detectionRules);
    copy.incidents = new Map(this.incidents);
    copy.investigations = new Map(this.investigations);
    copy.events = new Map(this.events);
    return copy;
  }

  replaceWith(other: InMemoryStore): void {
    this.users = other.users;
    this.workspaces = other.workspaces;
    this.memberships = other.memberships;
    this.hosts = other.hosts;
    this.detectionRules = other.detectionRules;
    this.incidents = other.incidents;
    this.investigations = other.investigations;
    this.events = other.events;
  }
}

class InMemoryUserRepository implements UserRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: string): Promise<User | null> {
    const snapshot = this.store.users.get(id);
    return snapshot ? User.restore(snapshot) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const snapshot = [...this.store.users.values()].find((user) => user.email === email.value);
    return snapshot ? User.restore(snapshot) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    return [...this.store.users.values()].some((user) => user.email === email.value);
  }

  async existsByCpf(cpf: Cpf, exceptUserId?: string): Promise<boolean> {
    return [...this.store.users.values()].some((user) => user.cpf === cpf.value && user.id !== exceptUserId);
  }

  async insert(user: User): Promise<void> {
    const snapshot = user.toSnapshot();
    for (const existing of this.store.users.values()) {
      if (existing.email === snapshot.email) throw new ConflictError('Este email já está cadastrado.', 'email');
      if (existing.cpf === snapshot.cpf) throw new ConflictError('Este CPF já está cadastrado.', 'cpf');
    }
    this.store.users.set(snapshot.id, snapshot);
  }

  async update(user: User): Promise<void> {
    const current = this.store.users.get(user.id);
    if (!current) return;
    const snapshot = user.toSnapshot();
    for (const existing of this.store.users.values()) {
      if (existing.id !== user.id && existing.cpf === snapshot.cpf) throw new ConflictError('Este CPF já está cadastrado.', 'cpf');
    }
    // Mirrors the SQL adapter: email is never written by an update.
    this.store.users.set(user.id, { ...snapshot, email: current.email });
  }
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insert(workspace: Workspace): Promise<void> {
    this.store.workspaces.set(workspace.id, workspace.toSnapshot());
  }
}

class InMemoryMembershipRepository implements MembershipRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insert(membership: Membership): Promise<void> {
    const key = `${membership.userId}:${membership.workspaceId}`;
    if (!this.store.users.has(membership.userId) || !this.store.workspaces.has(membership.workspaceId)) {
      throw new Error('foreign key constraint fails');
    }
    if (this.store.memberships.has(key)) throw new Error('duplicate membership');
    this.store.memberships.set(key, membership.toSnapshot());
  }

  async find(userId: string, workspaceId: string): Promise<Membership | null> {
    const snapshot = this.store.memberships.get(`${userId}:${workspaceId}`);
    return snapshot ? Membership.restore(snapshot) : null;
  }

  async listForUser(userId: string): Promise<WorkspaceMembership[]> {
    return [...this.store.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .flatMap((membership) => {
        const workspace = this.store.workspaces.get(membership.workspaceId);
        return workspace ? [{ workspace: Workspace.restore(workspace), membership: Membership.restore(membership) }] : [];
      });
  }
}

/** Same contract as the SQL adapter: workspace-scoped, createdAt DESC then id DESC, case-insensitive search. */
class InMemoryHostRepository implements HostRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insert(host: Host): Promise<void> {
    if (!this.store.workspaces.has(host.workspaceId)) throw new Error('foreign key constraint fails');
    this.store.hosts.set(host.id, host.toSnapshot());
  }

  async findInWorkspace(workspaceId: string, hostId: string): Promise<Host | null> {
    const snapshot = this.store.hosts.get(hostId);
    return snapshot && snapshot.workspaceId === workspaceId ? Host.restore(snapshot) : null;
  }

  async lockInWorkspace(workspaceId: string, hostId: string): Promise<Host | null> {
    // Single-threaded store: nothing to lock.
    return this.findInWorkspace(workspaceId, hostId);
  }

  async findManyInWorkspace(workspaceId: string, hostIds: readonly string[]): Promise<Host[]> {
    return [...this.store.hosts.values()]
      .filter((host) => host.workspaceId === workspaceId && hostIds.includes(host.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
      .map((host) => Host.restore(host));
  }

  async listInWorkspace(workspaceId: string, filter: HostListFilter): Promise<Page<Host>> {
    const needle = filter.search?.toLowerCase();
    const matching = [...this.store.hosts.values()]
      .filter((host) => host.workspaceId === workspaceId)
      .filter((host) => !needle || host.displayName.toLowerCase().includes(needle) || (host.description ?? '').toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const start = offsetOf(filter);
    return {
      items: matching.slice(start, start + filter.pageSize).map((host) => Host.restore(host)),
      total: matching.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(host: Host): Promise<void> {
    const current = this.store.hosts.get(host.id);
    if (!current || current.workspaceId !== host.workspaceId) return;
    const { displayName, description, updatedAt } = host.toSnapshot();
    this.store.hosts.set(host.id, { ...current, displayName, description, updatedAt });
  }

  async deleteInWorkspace(workspaceId: string, hostId: string): Promise<boolean> {
    const current = this.store.hosts.get(hostId);
    if (!current || current.workspaceId !== workspaceId) return false;
    // Mirrors ON DELETE RESTRICT on detection_rule_targets.host_id, incident_hosts.host_id and events.host_id.
    if (
      [...this.store.detectionRules.values()].some((rule) => rule.targetHostIds.includes(hostId)) ||
      [...this.store.incidents.values()].some((incident) => incident.hostIds.includes(hostId)) ||
      [...this.store.events.values()].some((event) => event.hostId === hostId)
    ) {
      throw new Error('foreign key constraint fails (restrict)');
    }
    return this.store.hosts.delete(hostId);
  }
}

/** Same contract as the SQL adapter, including FK checks on workspace and target hosts. */
class InMemoryDetectionRuleRepository implements DetectionRuleRepository {
  constructor(private readonly store: InMemoryStore) {}

  private assertForeignKeys(snapshot: DetectionRuleSnapshot): void {
    if (!this.store.workspaces.has(snapshot.workspaceId)) throw new Error('foreign key constraint fails (workspace)');
    for (const hostId of snapshot.targetHostIds) {
      if (!this.store.hosts.has(hostId)) throw new Error('foreign key constraint fails (host)');
    }
  }

  async insert(rule: DetectionRule): Promise<void> {
    const snapshot = rule.toSnapshot();
    this.assertForeignKeys(snapshot);
    this.store.detectionRules.set(rule.id, snapshot);
  }

  async findInWorkspace(workspaceId: string, ruleId: string): Promise<DetectionRule | null> {
    const snapshot = this.store.detectionRules.get(ruleId);
    return snapshot && snapshot.workspaceId === workspaceId ? DetectionRule.restore(snapshot) : null;
  }

  async findManyInWorkspace(workspaceId: string, ruleIds: readonly string[]): Promise<DetectionRule[]> {
    return [...this.store.detectionRules.values()]
      .filter((rule) => rule.workspaceId === workspaceId && ruleIds.includes(rule.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((rule) => DetectionRule.restore(rule));
  }

  async listInWorkspace(workspaceId: string, filter: DetectionRuleListFilter): Promise<Page<DetectionRule>> {
    const needle = filter.search?.toLowerCase();
    const matching = [...this.store.detectionRules.values()]
      .filter((rule) => rule.workspaceId === workspaceId)
      .filter((rule) => !needle || rule.name.toLowerCase().includes(needle) || (rule.description ?? '').toLowerCase().includes(needle))
      .filter((rule) => !filter.severity || rule.severity === filter.severity)
      .filter((rule) => !filter.eventCategory || rule.eventCategory === filter.eventCategory)
      .filter((rule) => filter.enabled === undefined || rule.enabled === filter.enabled)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const start = offsetOf(filter);
    return {
      items: matching.slice(start, start + filter.pageSize).map((rule) => DetectionRule.restore(rule)),
      total: matching.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(rule: DetectionRule): Promise<void> {
    const current = this.store.detectionRules.get(rule.id);
    if (!current || current.workspaceId !== rule.workspaceId) return;
    const snapshot = rule.toSnapshot();
    this.assertForeignKeys(snapshot);
    this.store.detectionRules.set(rule.id, { ...snapshot, createdAt: current.createdAt });
  }

  async deleteInWorkspace(workspaceId: string, ruleId: string): Promise<boolean> {
    const current = this.store.detectionRules.get(ruleId);
    if (!current || current.workspaceId !== workspaceId) return false;
    // Mirrors ON DELETE RESTRICT on incident_detection_rules.detection_rule_id.
    if ([...this.store.incidents.values()].some((incident) => incident.detectionRuleIds.includes(ruleId))) {
      throw new Error('foreign key constraint fails (restrict)');
    }
    return this.store.detectionRules.delete(ruleId);
  }

  async isHostTargeted(hostId: string): Promise<boolean> {
    return [...this.store.detectionRules.values()].some((rule) => rule.targetHostIds.includes(hostId));
  }
}

/** Same contract as the SQL adapter, including FK checks on workspace, hosts and rules. */
class InMemoryIncidentRepository implements IncidentRepository {
  constructor(private readonly store: InMemoryStore) {}

  private assertForeignKeys(snapshot: IncidentSnapshot): void {
    if (!this.store.workspaces.has(snapshot.workspaceId)) throw new Error('foreign key constraint fails (workspace)');
    if (snapshot.hostIds.some((hostId) => !this.store.hosts.has(hostId))) throw new Error('foreign key constraint fails (host)');
    if (snapshot.detectionRuleIds.some((ruleId) => !this.store.detectionRules.has(ruleId))) throw new Error('foreign key constraint fails (rule)');
  }

  async insert(incident: Incident): Promise<void> {
    const snapshot = incident.toSnapshot();
    this.assertForeignKeys(snapshot);
    this.store.incidents.set(incident.id, snapshot);
  }

  async findInWorkspace(workspaceId: string, incidentId: string): Promise<Incident | null> {
    const snapshot = this.store.incidents.get(incidentId);
    return snapshot && snapshot.workspaceId === workspaceId ? Incident.restore(snapshot) : null;
  }

  async findManyInWorkspace(workspaceId: string, incidentIds: readonly string[]): Promise<Incident[]> {
    return [...this.store.incidents.values()]
      .filter((incident) => incident.workspaceId === workspaceId && incidentIds.includes(incident.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .map((incident) => Incident.restore(incident));
  }

  async listInWorkspace(workspaceId: string, filter: IncidentListFilter): Promise<Page<Incident>> {
    const needle = filter.search?.toLowerCase();
    const matching = [...this.store.incidents.values()]
      .filter((incident) => incident.workspaceId === workspaceId)
      .filter((incident) => !needle || incident.title.toLowerCase().includes(needle) || (incident.description ?? '').toLowerCase().includes(needle))
      .filter((incident) => !filter.severity || incident.severity === filter.severity)
      .filter((incident) => !filter.status || incident.status === filter.status)
      .filter((incident) => !filter.origin || incident.origin === filter.origin)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const start = offsetOf(filter);
    return {
      items: matching.slice(start, start + filter.pageSize).map((incident) => Incident.restore(incident)),
      total: matching.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(incident: Incident): Promise<void> {
    const current = this.store.incidents.get(incident.id);
    if (!current || current.workspaceId !== incident.workspaceId) return;
    const snapshot = incident.toSnapshot();
    this.assertForeignKeys(snapshot);
    // Mirrors the SQL adapter: origin and createdAt are never written by an update.
    this.store.incidents.set(incident.id, { ...snapshot, origin: current.origin, createdAt: current.createdAt });
  }

  async deleteInWorkspace(workspaceId: string, incidentId: string): Promise<boolean> {
    const current = this.store.incidents.get(incidentId);
    if (!current || current.workspaceId !== workspaceId) return false;
    // Mirrors ON DELETE RESTRICT on investigation_incidents.incident_id.
    if ([...this.store.investigations.values()].some((investigation) => investigation.incidentIds.includes(incidentId))) {
      throw new Error('foreign key constraint fails (restrict)');
    }
    return this.store.incidents.delete(incidentId);
  }

  async isHostInvolved(hostId: string): Promise<boolean> {
    return [...this.store.incidents.values()].some((incident) => incident.hostIds.includes(hostId));
  }

  async isRuleRelated(ruleId: string): Promise<boolean> {
    return [...this.store.incidents.values()].some((incident) => incident.detectionRuleIds.includes(ruleId));
  }
}

/** Same contract as the SQL adapter, including FK checks on workspace and incidents. */
class InMemoryInvestigationRepository implements InvestigationRepository {
  constructor(private readonly store: InMemoryStore) {}

  private assertForeignKeys(snapshot: InvestigationSnapshot): void {
    if (!this.store.workspaces.has(snapshot.workspaceId)) throw new Error('foreign key constraint fails (workspace)');
    if (snapshot.incidentIds.some((incidentId) => !this.store.incidents.has(incidentId))) throw new Error('foreign key constraint fails (incident)');
  }

  async insert(investigation: Investigation): Promise<void> {
    const snapshot = investigation.toSnapshot();
    this.assertForeignKeys(snapshot);
    this.store.investigations.set(investigation.id, snapshot);
  }

  async findInWorkspace(workspaceId: string, investigationId: string): Promise<Investigation | null> {
    const snapshot = this.store.investigations.get(investigationId);
    return snapshot && snapshot.workspaceId === workspaceId ? Investigation.restore(snapshot) : null;
  }

  async listInWorkspace(workspaceId: string, filter: InvestigationListFilter): Promise<Page<Investigation>> {
    const needle = filter.search?.toLowerCase();
    const matches = (text: string | null) => (text ?? '').toLowerCase().includes(needle ?? '');
    const matching = [...this.store.investigations.values()]
      .filter((investigation) => investigation.workspaceId === workspaceId)
      .filter((investigation) => !needle || matches(investigation.title) || matches(investigation.description) || matches(investigation.conclusion))
      .filter((investigation) => !filter.status || investigation.status === filter.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const start = offsetOf(filter);
    return {
      items: matching.slice(start, start + filter.pageSize).map((investigation) => Investigation.restore(investigation)),
      total: matching.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async update(investigation: Investigation): Promise<void> {
    const current = this.store.investigations.get(investigation.id);
    if (!current || current.workspaceId !== investigation.workspaceId) return;
    const snapshot = investigation.toSnapshot();
    this.assertForeignKeys(snapshot);
    // Mirrors the SQL adapter: createdAt is never written by an update.
    this.store.investigations.set(investigation.id, { ...snapshot, createdAt: current.createdAt });
  }

  async deleteInWorkspace(workspaceId: string, investigationId: string): Promise<boolean> {
    const current = this.store.investigations.get(investigationId);
    if (!current || current.workspaceId !== workspaceId) return false;
    return this.store.investigations.delete(investigationId);
  }

  async isIncidentInvestigated(incidentId: string): Promise<boolean> {
    return [...this.store.investigations.values()].some((investigation) => investigation.incidentIds.includes(incidentId));
  }
}

/** Same contract as the SQL adapter: append-only, unique (hostId, sourceEventId), FKs, timeline order. */
class InMemoryEventRepository implements EventRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insertMany(items: readonly TelemetryEvent[]): Promise<void> {
    const snapshots = items.map((item) => item.toSnapshot());
    for (const snapshot of snapshots) {
      if (!this.store.workspaces.has(snapshot.workspaceId) || !this.store.hosts.has(snapshot.hostId)) throw new Error('foreign key constraint fails');
      const taken = [...this.store.events.values(), ...snapshots.filter((other) => other !== snapshot)].some(
        (other) => other.hostId === snapshot.hostId && other.sourceEventId === snapshot.sourceEventId,
      );
      if (taken) throw new Error('duplicate entry for events_host_source_unique');
    }
    for (const snapshot of snapshots) this.store.events.set(snapshot.id, snapshot);
  }

  async fingerprintsBySourceId(hostId: string, sourceEventIds: readonly string[]): Promise<Map<string, string>> {
    return new Map(
      [...this.store.events.values()]
        .filter((event) => event.hostId === hostId && sourceEventIds.includes(event.sourceEventId))
        .map((event) => [event.sourceEventId, event.fingerprint]),
    );
  }

  async findInWorkspace(workspaceId: string, eventId: string): Promise<StoredEvent | null> {
    const snapshot = this.store.events.get(eventId);
    return snapshot && snapshot.workspaceId === workspaceId ? this.toStored(snapshot) : null;
  }

  async listInWorkspace(workspaceId: string, filter: EventListFilter): Promise<Page<StoredEvent>> {
    const matching = [...this.store.events.values()]
      .filter((event) => event.workspaceId === workspaceId)
      .filter((event) => !filter.hostId || event.hostId === filter.hostId)
      .filter((event) => !filter.category || event.category === filter.category)
      .filter((event) => !filter.eventType || event.type === filter.eventType)
      .filter((event) => !filter.from || event.occurredAt.getTime() >= (filter.from?.getTime() ?? 0))
      .filter((event) => !filter.to || event.occurredAt.getTime() <= (filter.to?.getTime() ?? 0))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const start = offsetOf(filter);
    return {
      items: matching.slice(start, start + filter.pageSize).map((event) => this.toStored(event)),
      total: matching.length,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async existsForHost(hostId: string): Promise<boolean> {
    return [...this.store.events.values()].some((event) => event.hostId === hostId);
  }

  private toStored(snapshot: TelemetryEventSnapshot): StoredEvent {
    return { event: TelemetryEvent.restore(snapshot), hostDisplayName: this.store.hosts.get(snapshot.hostId)?.displayName ?? '' };
  }
}

export function repositoriesFor(store: InMemoryStore): Repositories {
  return {
    users: new InMemoryUserRepository(store),
    workspaces: new InMemoryWorkspaceRepository(store),
    memberships: new InMemoryMembershipRepository(store),
    hosts: new InMemoryHostRepository(store),
    detectionRules: new InMemoryDetectionRuleRepository(store),
    incidents: new InMemoryIncidentRepository(store),
    investigations: new InMemoryInvestigationRepository(store),
    events: new InMemoryEventRepository(store),
  };
}

/** Works on a copy of the store and swaps it in only if `work` succeeds. */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly store: InMemoryStore) {}

  async run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const draft = this.store.clone();
    const result = await work(repositoriesFor(draft));
    this.store.replaceWith(draft);
    return result;
  }
}

export function createInMemoryPersistence() {
  const store = new InMemoryStore();
  return { store, repositories: repositoriesFor(store), unitOfWork: new InMemoryUnitOfWork(store) };
}
