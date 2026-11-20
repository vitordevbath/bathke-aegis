import type { Alert } from '../../domain/alert.js';
import type { IncidentActivity } from '../../domain/incident-activity.js';
import type { Cpf, Email } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { Workspace, WorkspaceKind } from '../../domain/workspace.js';
import type { Membership, MembershipRole } from '../../domain/membership.js';
import type { Host } from '../../domain/host.js';
import type { DetectionRule } from '../../domain/detection-rule.js';
import type { Incident } from '../../domain/incident.js';
import type { Investigation } from '../../domain/investigation.js';
import type { TelemetryEvent } from '../../domain/telemetry-event.js';
import type { PairingChallenge } from '../../domain/pairing-challenge.js';
import type { MachineCredential } from '../../domain/machine-credential.js';
import type {
  DetectionEventCategory,
  DetectionSeverity,
  EventCategory,
  EventType,
  IncidentOrigin,
  IncidentStatus,
  InvestigationStatus,
  Severity,
} from '@aegis/domain';
import type { Page, PageRequest } from '../pagination.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  existsByEmail(email: Email): Promise<boolean>;
  /** `exceptUserId` lets a user keep their own CPF when editing. */
  existsByCpf(cpf: Cpf, exceptUserId?: string): Promise<boolean>;
  /** Throws `ConflictError` if email or CPF is already taken. */
  insert(user: User): Promise<void>;
  /** Persists editable fields. Never writes the email. Throws `ConflictError` on CPF clash. */
  update(user: User): Promise<void>;
}

export interface WorkspaceRepository {
  insert(workspace: Workspace): Promise<void>;
  /** The oldest workspace of that kind, if any (used for the single AEGIS DEMO workspace). */
  findFirstOfKind(kind: WorkspaceKind): Promise<Workspace | null>;
}

/** A workspace together with the role a given user holds in it. */
export interface WorkspaceMembership {
  readonly workspace: Workspace;
  readonly membership: Membership;
}

export interface MembershipRepository {
  insert(membership: Membership): Promise<void>;
  /** The user's membership in that workspace, or null if they are not a member. */
  find(userId: string, workspaceId: string): Promise<Membership | null>;
  /** The personal workspace first, then the others by membership date (ADR-052). */
  listForUser(userId: string): Promise<WorkspaceMembership[]>;
  /** Gives `role` in the workspace to every user without a membership there; returns how many were added. Idempotent. */
  grantToUsersWithout(workspaceId: string, role: MembershipRole, now: Date): Promise<number>;
}

export interface HostListFilter extends PageRequest {
  /** Case-insensitive substring match on display name or description. */
  readonly search?: string | undefined;
}

/**
 * Every read and delete is scoped by workspace: there is deliberately no
 * `findById(hostId)`, so a caller cannot forget the tenant filter.
 */
export interface HostRepository {
  insert(host: Host): Promise<void>;
  findInWorkspace(workspaceId: string, hostId: string): Promise<Host | null>;
  /**
   * Like `findInWorkspace`, but holds a row lock until the surrounding
   * transaction ends, so concurrent writers for the same host serialize
   * (event ingestion). Must run inside a `UnitOfWork`.
   */
  lockInWorkspace(workspaceId: string, hostId: string): Promise<Host | null>;
  /** The subset of `hostIds` that exist in that workspace (others are silently absent), ordered by name. */
  findManyInWorkspace(workspaceId: string, hostIds: readonly string[]): Promise<Host[]>;
  /** Ordered by `createdAt` DESC, then `id` DESC (stable across pages). */
  listInWorkspace(workspaceId: string, filter: HostListFilter): Promise<Page<Host>>;
  /** Persists the administrative fields only. */
  update(host: Host): Promise<void>;
  /** Persists only `agentId`, `connectionState` and `updatedAt`, set by the pairing flow. */
  updatePairing(host: Host): Promise<void>;
  /** Persists only `lastSeenAt`, and never moves it backwards. Must run inside the `UnitOfWork` that locked the host. */
  updatePresence(host: Host): Promise<void>;
  /** Returns false when no such host exists in that workspace. */
  deleteInWorkspace(workspaceId: string, hostId: string): Promise<boolean>;
}

export interface DetectionRuleListFilter extends PageRequest {
  /** Case-insensitive substring match on name or description. */
  readonly search?: string | undefined;
  readonly severity?: DetectionSeverity | undefined;
  readonly eventCategory?: DetectionEventCategory | undefined;
  readonly enabled?: boolean | undefined;
}

/**
 * Workspace-scoped like `HostRepository`. `insert` and `update` write the rule
 * row and its targets, so they must run inside a `UnitOfWork`.
 */
export interface DetectionRuleRepository {
  insert(rule: DetectionRule): Promise<void>;
  findInWorkspace(workspaceId: string, ruleId: string): Promise<DetectionRule | null>;
  /** The subset of `ruleIds` that exist in that workspace (others are silently absent), ordered by name. */
  findManyInWorkspace(workspaceId: string, ruleIds: readonly string[]): Promise<DetectionRule[]>;
  /** Ordered by `createdAt` DESC, then `id` DESC. Targets are loaded in one extra query per page (no N+1). */
  listInWorkspace(workspaceId: string, filter: DetectionRuleListFilter): Promise<Page<DetectionRule>>;
  /** Updates the row and replaces the targets. */
  update(rule: DetectionRule): Promise<void>;
  /** Targets are removed by cascade. Returns false when no such rule exists in that workspace. */
  deleteInWorkspace(workspaceId: string, ruleId: string): Promise<boolean>;
  isHostTargeted(hostId: string): Promise<boolean>;
  /** Enabled rules of the workspace for one event category, with their targets (detection engine, ADR-053). */
  listEnabledFor(workspaceId: string, category: DetectionEventCategory): Promise<DetectionRule[]>;
}

export interface IncidentListFilter extends PageRequest {
  /** Case-insensitive substring match on title or description. */
  readonly search?: string | undefined;
  readonly severity?: Severity | undefined;
  readonly status?: IncidentStatus | undefined;
  readonly origin?: IncidentOrigin | undefined;
}

/**
 * Workspace-scoped like the other resources. `insert` and `update` write the
 * incident row and both relation tables, so they must run inside a `UnitOfWork`.
 */
export interface IncidentRepository {
  insert(incident: Incident): Promise<void>;
  findInWorkspace(workspaceId: string, incidentId: string): Promise<Incident | null>;
  /** The subset of `incidentIds` that exist in that workspace (others are silently absent), newest first. */
  findManyInWorkspace(workspaceId: string, incidentIds: readonly string[]): Promise<Incident[]>;
  /** Ordered by `createdAt` DESC, then `id` DESC. Relations are loaded with one query per table per page (no N+1). */
  listInWorkspace(workspaceId: string, filter: IncidentListFilter): Promise<Page<Incident>>;
  /** Updates the row (never `origin`, `workspaceId` or `createdAt`) and replaces both relations. */
  update(incident: Incident): Promise<void>;
  /** Relations are removed by cascade. Returns false when no such incident exists in that workspace. */
  deleteInWorkspace(workspaceId: string, incidentId: string): Promise<boolean>;
  isHostInvolved(hostId: string): Promise<boolean>;
  isRuleRelated(ruleId: string): Promise<boolean>;
}

export interface InvestigationListFilter extends PageRequest {
  /** Case-insensitive substring match on title, description or conclusion. */
  readonly search?: string | undefined;
  readonly status?: InvestigationStatus | undefined;
}

/**
 * Workspace-scoped like the other resources. `insert` and `update` write the
 * investigation row and its incident relations, so they must run inside a `UnitOfWork`.
 */
export interface InvestigationRepository {
  insert(investigation: Investigation): Promise<void>;
  findInWorkspace(workspaceId: string, investigationId: string): Promise<Investigation | null>;
  /** Ordered by `createdAt` DESC, then `id` DESC. Incident ids are loaded with one query per page (no N+1). */
  listInWorkspace(workspaceId: string, filter: InvestigationListFilter): Promise<Page<Investigation>>;
  /** Updates the row (never `workspaceId` or `createdAt`) and replaces the incident relations. */
  update(investigation: Investigation): Promise<void>;
  /** Relations are removed by cascade. Returns false when no such investigation exists in that workspace. */
  deleteInWorkspace(workspaceId: string, investigationId: string): Promise<boolean>;
  isIncidentInvestigated(incidentId: string): Promise<boolean>;
  /** Investigations that group the incident, newest first. */
  listForIncident(workspaceId: string, incidentId: string): Promise<Investigation[]>;
}

export interface EventListFilter extends PageRequest {
  readonly hostId?: string | undefined;
  readonly category?: EventCategory | undefined;
  readonly eventType?: EventType | undefined;
  /** Inclusive bounds on `occurredAt`. */
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

/** A stored event plus the display name of its host (read in the same query, no N+1). */
export interface StoredEvent {
  readonly event: TelemetryEvent;
  readonly hostDisplayName: string;
}

/**
 * Append-only and workspace-scoped: there is deliberately no update or
 * delete. `insertMany` must run inside the `UnitOfWork` that checked
 * idempotency, so a batch is stored entirely or not at all.
 */
export interface EventRepository {
  insertMany(events: readonly TelemetryEvent[]): Promise<void>;
  /** Fingerprints of already stored events of that host, keyed by `sourceEventId`. */
  fingerprintsBySourceId(hostId: string, sourceEventIds: readonly string[]): Promise<Map<string, string>>;
  findInWorkspace(workspaceId: string, eventId: string): Promise<StoredEvent | null>;
  /** Timeline: `occurredAt` DESC, then `id` DESC. */
  listInWorkspace(workspaceId: string, filter: EventListFilter): Promise<Page<StoredEvent>>;
  /** Events of those hosts with `from <= occurredAt <= to`, oldest first, at most `limit` (incident timeline context). */
  listForHostsBetween(workspaceId: string, hostIds: readonly string[], from: Date, to: Date, limit: number): Promise<StoredEvent[]>;
  existsForHost(hostId: string): Promise<boolean>;
}

/** Codes are looked up by hash; everything else is scoped to a host of a workspace. */
export interface PairingChallengeRepository {
  insert(challenge: PairingChallenge): Promise<void>;
  /** Plain read. The hash is the proof of possession, and a code names its own tenant. */
  findByCodeHash(codeHash: string): Promise<PairingChallenge | null>;
  /** Re-reads under a row lock. Must run inside a `UnitOfWork`, after locking the host. */
  lockById(challengeId: string): Promise<PairingChallenge | null>;
  /** The code that was neither used nor revoked, expired or not; at most one per host. */
  findOpenForHost(workspaceId: string, hostId: string): Promise<PairingChallenge | null>;
  /** A code of that host, under a row lock. Must run inside a `UnitOfWork`, after locking the host. */
  lockInHost(workspaceId: string, hostId: string, challengeId: string): Promise<PairingChallenge | null>;
  /** Codes requested for the host since `since`, whatever became of them. */
  countCreatedSince(workspaceId: string, hostId: string, since: Date): Promise<number>;
  /** Writes the consumption only if the row is still open. Returns false when it no longer was. */
  markConsumed(challenge: PairingChallenge): Promise<boolean>;
  /** Writes the revocation only if the row is still open. Returns false when it no longer was. */
  markRevoked(challenge: PairingChallenge): Promise<boolean>;
}

export interface MachineCredentialRepository {
  insert(credential: MachineCredential): Promise<void>;
  /** The only unscoped read: machine authentication learns the tenant from this row. */
  findForAuthentication(credentialId: string): Promise<MachineCredential | null>;
  /** Holds a row lock. Must run inside a `UnitOfWork`, after locking the host. */
  lockInHost(workspaceId: string, hostId: string, credentialId: string): Promise<MachineCredential | null>;
  /**
   * Re-reads a credential with a shared lock, inside the `UnitOfWork` that
   * already locked its host: a locking read sees the latest committed
   * revocation, never an older snapshot, and holds back a later one until the
   * transaction ends (ADR-045).
   */
  lockForUse(credentialId: string): Promise<MachineCredential | null>;
  /** Most recent first. */
  listForHost(workspaceId: string, hostId: string, limit: number): Promise<MachineCredential[]>;
  markRevoked(credential: MachineCredential): Promise<void>;
  /** Records usage unless a newer value exists or the credential was revoked meanwhile. */
  touchLastUsed(credentialId: string, usedAt: Date, olderThan: Date): Promise<void>;
  existsForHost(hostId: string): Promise<boolean>;
}

export interface AlertListFilter extends PageRequest {
  readonly severity?: Severity | undefined;
  readonly ruleId?: string | undefined;
  readonly hostId?: string | undefined;
  readonly incidentId?: string | undefined;
}

/** An alert plus the names it is shown with, read in the same query (no N+1). */
export interface StoredAlert {
  readonly alert: Alert;
  readonly ruleName: string;
  readonly hostDisplayName: string;
  readonly incidentTitle: string | null;
  readonly eventType: EventType;
  readonly eventSummary: string;
}

/** Append-only like events (ADR-053): alerts are inserted, read and listed, never updated or deleted on their own. */
export interface AlertRepository {
  insertMany(alerts: readonly Alert[]): Promise<void>;
  /**
   * The incident of the most recent alert of `ruleId` on `hostId` raised at or after `since`, when that
   * incident still exists and is OPEN or INVESTIGATING; otherwise null. Must run inside the ingestion
   * transaction that locked the host.
   */
  findCorrelatedIncident(workspaceId: string, ruleId: string, hostId: string, since: Date): Promise<string | null>;
  /** Newest first: `createdAt` DESC, then `id` DESC. */
  listInWorkspace(workspaceId: string, filter: AlertListFilter): Promise<Page<StoredAlert>>;
  findInWorkspace(workspaceId: string, alertId: string): Promise<StoredAlert | null>;
  /** Alerts correlated into the incident, oldest event first (`occurredAt` ASC, then `id`), at most `limit`. */
  listForIncident(workspaceId: string, incidentId: string, limit: number): Promise<StoredAlert[]>;
  existsForRule(ruleId: string): Promise<boolean>;
}

/** An activity entry plus the current name of the user who caused it (null when not a user, or no longer one). */
export interface StoredIncidentActivity {
  readonly activity: IncidentActivity;
  readonly actorName: string | null;
}

/** Append-only (ADR-054): entries are inserted with the change they describe and read back per incident. */
export interface IncidentActivityRepository {
  insertMany(activities: readonly IncidentActivity[]): Promise<void>;
  /** Oldest first: `createdAt` ASC, then the order of `INCIDENT_ACTIVITY_KINDS`, then `id`. */
  listForIncident(workspaceId: string, incidentId: string): Promise<StoredIncidentActivity[]>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipRepository;
  readonly hosts: HostRepository;
  readonly detectionRules: DetectionRuleRepository;
  readonly incidents: IncidentRepository;
  readonly investigations: InvestigationRepository;
  readonly events: EventRepository;
  readonly pairingChallenges: PairingChallengeRepository;
  readonly machineCredentials: MachineCredentialRepository;
  readonly alerts: AlertRepository;
  readonly incidentActivities: IncidentActivityRepository;
}

/**
 * Runs `work` atomically: every write made through the given repositories is
 * committed together, or none is (the transaction is rolled back and the
 * error re-thrown).
 */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
