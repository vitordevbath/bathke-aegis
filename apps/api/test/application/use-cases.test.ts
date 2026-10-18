import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticationError, ConflictError, ValidationError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import type { TokenService } from '../../src/application/ports/token-service.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { AuthenticateUser, INVALID_CREDENTIALS_MESSAGE } from '../../src/application/use-cases/authenticate-user.js';
import { ResolveAuthenticatedUser } from '../../src/application/use-cases/resolve-authenticated-user.js';
import { UpdateCurrentUser } from '../../src/application/use-cases/update-current-user.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { OTHER_PASSWORD, TEST_PASSWORD, makeCpf, makeRegistration } from '../support/fixtures.js';

/** Transparent fake: records calls so tests can assert on hashing behavior without Argon2 cost. */
class RecordingHasher implements PasswordHasher {
  verifications: string[] = [];
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }
  async verify(hash: string, plain: string): Promise<boolean> {
    this.verifications.push(hash);
    return hash === `hashed:${plain}`;
  }
}

const tokens: TokenService = {
  issue: async (userId) => ({ token: `token-for-${userId}`, expiresIn: 60 }),
  verify: async (token) => {
    if (!token.startsWith('token-for-')) throw new AuthenticationError();
    return { userId: token.slice('token-for-'.length) };
  },
};

/** Decorates a unit of work so that one repository insert fails mid-transaction. */
function failingOn(unitOfWork: UnitOfWork, table: 'workspaces' | 'memberships'): UnitOfWork {
  return {
    run: (work) =>
      unitOfWork.run((repositories) => {
        const boom = async () => {
          throw new Error(`simulated ${table} failure`);
        };
        const sabotaged: Repositories =
          table === 'workspaces'
            ? { ...repositories, workspaces: { insert: boom } }
            : { ...repositories, memberships: { insert: boom, listForUser: (id) => repositories.memberships.listForUser(id) } };
        return work(sabotaged);
      }),
  };
}

describe('RegisterUser', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let hasher: RecordingHasher;

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    hasher = new RecordingHasher();
  });

  it('creates user, personal workspace and OWNER membership together', async () => {
    const register = new RegisterUser(persistence.repositories, persistence.unitOfWork, hasher);
    const { user, workspaces } = await register.execute(makeRegistration({ name: 'Ana Teste' }));

    expect(persistence.store.users.size).toBe(1);
    expect(persistence.store.workspaces.size).toBe(1);
    expect(persistence.store.memberships.size).toBe(1);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.workspace).toMatchObject({ kind: 'personal', name: 'Workspace de Ana Teste' });
    expect(workspaces[0]?.membership).toMatchObject({ userId: user.id, role: 'OWNER' });
    expect(persistence.store.users.get(user.id)?.passwordHash).toBe(`hashed:${TEST_PASSWORD}`);
  });

  it.each(['workspaces', 'memberships'] as const)('leaves no partial state when the %s insert fails', async (table) => {
    const register = new RegisterUser(persistence.repositories, failingOn(persistence.unitOfWork, table), hasher);

    await expect(register.execute(makeRegistration())).rejects.toThrow(`simulated ${table} failure`);
    expect(persistence.store.users.size).toBe(0);
    expect(persistence.store.workspaces.size).toBe(0);
    expect(persistence.store.memberships.size).toBe(0);
  });

  it('rejects duplicate email and duplicate CPF with field-addressed conflicts', async () => {
    const register = new RegisterUser(persistence.repositories, persistence.unitOfWork, hasher);
    const first = makeRegistration();
    await register.execute(first);

    await expect(register.execute(makeRegistration({ email: first.email.toUpperCase() }))).rejects.toMatchObject({
      constructor: ConflictError,
      field: 'email',
    });
    await expect(register.execute(makeRegistration({ cpf: first.cpf }))).rejects.toMatchObject({ field: 'cpf' });
    expect(persistence.store.users.size).toBe(1);
  });

  it('re-validates the password policy even if called without the HTTP schema', async () => {
    const register = new RegisterUser(persistence.repositories, persistence.unitOfWork, hasher);
    await expect(register.execute(makeRegistration({ password: 'weak' }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('AuthenticateUser', () => {
  it('returns the same generic error for unknown email and wrong password, verifying a hash in both cases', async () => {
    const { repositories, unitOfWork } = createInMemoryPersistence();
    const hasher = new RecordingHasher();
    const registration = makeRegistration();
    await new RegisterUser(repositories, unitOfWork, hasher).execute(registration);
    const login = new AuthenticateUser(repositories, hasher, tokens);

    const unknown = login.execute({ email: 'ninguem@example.test', password: TEST_PASSWORD });
    await expect(unknown).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    const wrong = login.execute({ email: registration.email, password: OTHER_PASSWORD });
    await expect(wrong).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

    expect(hasher.verifications).toHaveLength(2);
  });
});

describe('ResolveAuthenticatedUser', () => {
  it('rejects a valid token whose user no longer exists', async () => {
    const { repositories, store } = createInMemoryPersistence();
    const resolve = new ResolveAuthenticatedUser(tokens, repositories.users);
    store.users.clear();
    await expect(resolve.execute('token-for-deleted-user')).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('UpdateCurrentUser', () => {
  it('keeps the own CPF, rejects another user CPF and requires the right current password', async () => {
    const { repositories, unitOfWork } = createInMemoryPersistence();
    const hasher = new RecordingHasher();
    const register = new RegisterUser(repositories, unitOfWork, hasher);
    const { user } = await register.execute(makeRegistration());
    const other = await register.execute(makeRegistration({ cpf: makeCpf(42) }));
    const update = new UpdateCurrentUser(repositories, hasher);

    await expect(update.execute(user, { name: 'Novo Nome', cpf: user.cpf })).resolves.toBeDefined();
    await expect(update.execute(user, { name: 'Novo Nome', cpf: other.user.cpf })).rejects.toBeInstanceOf(ConflictError);
    await expect(
      update.execute(user, { name: 'Novo Nome', cpf: user.cpf, passwordChange: { currentPassword: 'Wrong-Pass-1', newPassword: OTHER_PASSWORD } }),
    ).rejects.toMatchObject({ issues: [{ field: 'currentPassword' }] });
  });
});
