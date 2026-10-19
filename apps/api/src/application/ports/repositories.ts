import type { Cpf, Email } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { Workspace } from '../../domain/workspace.js';
import type { Membership } from '../../domain/membership.js';
import type { Host } from '../../domain/host.js';
import type { DetectionRule } from '../../domain/detection-rule.js';
import type { Incident } from '../../domain/incident.js';
import type { Investigation } from '../../domain/investigation.js';
import type { DetectionEventCategory, DetectionSeverity, IncidentOrigin, IncidentStatus, InvestigationStatus, Severity } from '@aegis/domain';
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
  listForUser(userId: string): Promise<WorkspaceMembership[]>;
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
  /** The subset of `hostIds` that exist in that workspace (others are silently absent), ordered by name. */
  findManyInWorkspace(workspaceId: string, hostIds: readonly string[]): Promise<Host[]>;
  /** Ordered by `createdAt` DESC, then `id` DESC (stable across pages). */
  listInWorkspace(workspaceId: string, filter: HostListFilter): Promise<Page<Host>>;
  /** Persists the administrative fields only. */
  update(host: Host): Promise<void>;
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
}

export interface Repositories {
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipRepository;
  readonly hosts: HostRepository;
  readonly detectionRules: DetectionRuleRepository;
  readonly incidents: IncidentRepository;
  readonly investigations: InvestigationRepository;
}

/**
 * Runs `work` atomically: every write made through the given repositories is
 * committed together, or none is (the transaction is rolled back and the
 * error re-thrown).
 */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
