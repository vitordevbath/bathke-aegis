import { ConflictError, type Cpf, type Email } from '@aegis/domain';
import { User, type UserSnapshot } from '../../src/domain/user.js';
import { Workspace, type WorkspaceSnapshot } from '../../src/domain/workspace.js';
import { Membership, type MembershipSnapshot } from '../../src/domain/membership.js';
import type {
  MembershipRepository,
  Repositories,
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

  clone(): InMemoryStore {
    const copy = new InMemoryStore();
    copy.users = new Map(this.users);
    copy.workspaces = new Map(this.workspaces);
    copy.memberships = new Map(this.memberships);
    return copy;
  }

  replaceWith(other: InMemoryStore): void {
    this.users = other.users;
    this.workspaces = other.workspaces;
    this.memberships = other.memberships;
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

  async listForUser(userId: string): Promise<WorkspaceMembership[]> {
    return [...this.store.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .flatMap((membership) => {
        const workspace = this.store.workspaces.get(membership.workspaceId);
        return workspace ? [{ workspace: Workspace.restore(workspace), membership: Membership.restore(membership) }] : [];
      });
  }
}

export function repositoriesFor(store: InMemoryStore): Repositories {
  return {
    users: new InMemoryUserRepository(store),
    workspaces: new InMemoryWorkspaceRepository(store),
    memberships: new InMemoryMembershipRepository(store),
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
