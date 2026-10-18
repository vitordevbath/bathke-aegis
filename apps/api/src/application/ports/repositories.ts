import type { Cpf, Email } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { Workspace } from '../../domain/workspace.js';
import type { Membership } from '../../domain/membership.js';

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
  listForUser(userId: string): Promise<WorkspaceMembership[]>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipRepository;
}

/**
 * Runs `work` atomically: every write made through the given repositories is
 * committed together, or none is (the transaction is rolled back and the
 * error re-thrown).
 */
export interface UnitOfWork {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
