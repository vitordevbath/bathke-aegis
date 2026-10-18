import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { ConflictError, Cpf, Email } from '@aegis/domain';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { Argon2PasswordHasher } from '../../src/infrastructure/security/argon2-password-hasher.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { User } from '../../src/domain/user.js';
import { Workspace } from '../../src/domain/workspace.js';
import { Membership } from '../../src/domain/membership.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { failingOn } from '../support/failing-unit-of-work.js';
import { makeCpf, makeRegistration } from '../support/fixtures.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

describe.skipIf(!TEST_DATABASE_URL)('MySQL persistence (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;
  let register: RegisterUser;

  const count = async (table: 'users' | 'workspaces' | 'memberships') => {
    const [rows] = (await connection.db.execute(sql.raw(`SELECT COUNT(*) AS total FROM ${table}`))) as unknown as [
      { total: number }[],
    ];
    return Number(rows[0]?.total);
  };

  beforeAll(async () => {
    database = await createMigratedDatabase();
    connection = createDatabase(database.url);
    repositories = createDrizzleRepositories(connection.db);
    register = new RegisterUser(repositories, new DrizzleUnitOfWork(connection.db), new Argon2PasswordHasher());
  });

  afterAll(async () => {
    await connection?.close();
    await database?.drop();
  });

  it('commits user, personal workspace and OWNER membership in one transaction', async () => {
    const { user } = await register.execute(makeRegistration({ name: 'Integração Teste' }));

    const stored = await repositories.users.findById(user.id);
    expect(stored?.email).toBe(user.email);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    const workspaces = await repositories.memberships.listForUser(user.id);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.workspace).toMatchObject({ kind: 'personal', name: 'Workspace de Integração Teste' });
    expect(workspaces[0]?.membership.role).toBe('OWNER');
  });

  it.each(['workspaces', 'memberships'] as const)('rolls back the user when the %s insert fails', async (table) => {
    const before = { users: await count('users'), workspaces: await count('workspaces'), memberships: await count('memberships') };
    const registration = makeRegistration();
    const sabotaged = new RegisterUser(repositories, failingOn(new DrizzleUnitOfWork(connection.db), table), new Argon2PasswordHasher());

    await expect(sabotaged.execute(registration)).rejects.toThrow(`simulated ${table} failure`);

    expect(await repositories.users.existsByEmail(Email.create(registration.email))).toBe(false);
    expect({ users: await count('users'), workspaces: await count('workspaces'), memberships: await count('memberships') }).toEqual(
      before,
    );
  });

  it('enforces email and CPF uniqueness at the database level', async () => {
    const { user } = await register.execute(makeRegistration());
    const hash = user.passwordHash;

    const sameEmail = User.register({ name: 'Outra Pessoa', email: Email.create(user.email), cpf: Cpf.create(makeCpf(7)), passwordHash: hash });
    await expect(repositories.users.insert(sameEmail)).rejects.toMatchObject({ constructor: ConflictError, field: 'email' });

    const sameCpf = User.register({ name: 'Outra Pessoa', email: Email.create('outra.pessoa@example.test'), cpf: Cpf.create(user.cpf), passwordHash: hash });
    await expect(repositories.users.insert(sameCpf)).rejects.toMatchObject({ constructor: ConflictError, field: 'cpf' });
  });

  it('enforces real foreign keys and forbids duplicate memberships', async () => {
    const { user, workspaces } = await register.execute(makeRegistration());
    const orphan = Membership.restore({ userId: user.id, workspaceId: '00000000-0000-4000-8000-000000000000', role: 'VIEWER', createdAt: new Date() });
    await expect(repositories.memberships.insert(orphan)).rejects.toThrow();

    const personal = workspaces[0]?.workspace as Workspace;
    await expect(repositories.memberships.insert(Membership.grantOwner(user, personal))).rejects.toThrow();
  });

  it('updates profile fields without ever writing the email', async () => {
    const { user } = await register.execute(makeRegistration());
    const originalEmail = user.email;
    user.updateProfile({ name: 'Nome Atualizado', cpf: Cpf.create(makeCpf(99_000_001)) });
    await repositories.users.update(user);

    const stored = await repositories.users.findById(user.id);
    expect(stored).toMatchObject({ name: 'Nome Atualizado', email: originalEmail, cpf: makeCpf(99_000_001) });
  });
});
