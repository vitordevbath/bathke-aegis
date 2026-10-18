import { and, asc, eq, ne } from 'drizzle-orm';
import type { MySqlDatabase } from 'drizzle-orm/mysql-core';
import type { MySql2PreparedQueryHKT, MySql2QueryResultHKT } from 'drizzle-orm/mysql2';
import { ConflictError, type Cpf, type Email } from '@aegis/domain';
import { User } from '../../domain/user.js';
import { Workspace } from '../../domain/workspace.js';
import { Membership } from '../../domain/membership.js';
import type {
  MembershipRepository,
  Repositories,
  UnitOfWork,
  UserRepository,
  WorkspaceMembership,
  WorkspaceRepository,
} from '../../application/ports/repositories.js';
import { CPF_TAKEN_MESSAGE, EMAIL_TAKEN_MESSAGE } from '../../application/use-cases/register-user.js';
import type { Database } from './client.js';
import * as schema from './schema.js';
import { memberships, users, workspaces } from './schema.js';

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

export function createDrizzleRepositories(db: Executor): Repositories {
  return {
    users: new DrizzleUserRepository(db),
    workspaces: new DrizzleWorkspaceRepository(db),
    memberships: new DrizzleMembershipRepository(db),
  };
}

/** MySQL transaction: commit when `work` resolves, rollback when it throws. */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(createDrizzleRepositories(tx)));
  }
}
