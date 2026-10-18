import { ConflictError, type Cpf, type Email } from '@aegis/domain';
import { User, type UserSnapshot } from '../../src/domain/user.js';
import { Workspace, type WorkspaceSnapshot } from '../../src/domain/workspace.js';
import { Membership, type MembershipSnapshot } from '../../src/domain/membership.js';
import { Host, type HostSnapshot } from '../../src/domain/host.js';
import { offsetOf, type Page } from '../../src/application/pagination.js';
import type {
  HostListFilter,
  HostRepository,
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
  hosts = new Map<string, HostSnapshot>();

  clone(): InMemoryStore {
    const copy = new InMemoryStore();
    copy.users = new Map(this.users);
    copy.workspaces = new Map(this.workspaces);
    copy.memberships = new Map(this.memberships);
    copy.hosts = new Map(this.hosts);
    return copy;
  }

  replaceWith(other: InMemoryStore): void {
    this.users = other.users;
    this.workspaces = other.workspaces;
    this.memberships = other.memberships;
    this.hosts = other.hosts;
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
    return this.store.hosts.delete(hostId);
  }
}

export function repositoriesFor(store: InMemoryStore): Repositories {
  return {
    users: new InMemoryUserRepository(store),
    workspaces: new InMemoryWorkspaceRepository(store),
    memberships: new InMemoryMembershipRepository(store),
    hosts: new InMemoryHostRepository(store),
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
