import type { Cpf, Email } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { Workspace } from '../../domain/workspace.js';
import type { Membership } from '../../domain/membership.js';
import type { Host } from '../../domain/host.js';
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
  /** Ordered by `createdAt` DESC, then `id` DESC (stable across pages). */
  listInWorkspace(workspaceId: string, filter: HostListFilter): Promise<Page<Host>>;
  /** Persists the administrative fields only. */
  update(host: Host): Promise<void>;
  /** Returns false when no such host exists in that workspace. */
  deleteInWorkspace(workspaceId: string, hostId: string): Promise<boolean>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipRepository;
  readonly hosts: HostRepository;
}

/**
 * Runs `work` atomically: every write made through the given repositories is
 * committed together, or none is (the transaction is rolled back and the
 * error re-thrown).
 */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
