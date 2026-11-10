import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CREDENTIAL_LAST_USED_RESOLUTION_MS,
  CredentialRevokedError,
  ForbiddenError,
  HostAlreadyPairedError,
  MachineAuthenticationError,
  NotFoundError,
  PAIRING_POLICY,
  PairingRejectedError,
  TooManyRequestsError,
  formatMachineToken,
} from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { RequestPairingCode } from '../../src/application/use-cases/machine-identity/request-pairing-code.js';
import { RedeemPairingCode } from '../../src/application/use-cases/machine-identity/redeem-pairing-code.js';
import { AuthenticateMachine } from '../../src/application/use-cases/machine-identity/authenticate-machine.js';
import { RotateMachineCredential } from '../../src/application/use-cases/machine-identity/rotate-machine-credential.js';
import { RevokeMachineCredential } from '../../src/application/use-cases/machine-identity/revoke-machine-credential.js';
import { GetHostPairing } from '../../src/application/use-cases/machine-identity/get-host-pairing.js';
import { Membership } from '../../src/domain/membership.js';
import { NodeMachineSecrets } from '../../src/infrastructure/security/node-machine-secrets.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };

describe('NodeMachineSecrets', () => {
  const secrets = new NodeMachineSecrets();

  it('generates 256-bit base64url secrets that do not repeat', () => {
    const values = Array.from({ length: 50 }, () => secrets.generate());
    expect(new Set(values).size).toBe(50);
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes deterministically to SHA-256 hex and never echoes the input', () => {
    const value = secrets.generate();
    expect(secrets.hash(value)).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.hash(value)).toBe(secrets.hash(value));
    expect(secrets.hash(value)).not.toContain(value);
  });

  it('compares against the stored hash and treats malformed hashes as a mismatch', () => {
    const value = secrets.generate();
    expect(secrets.matches(value, secrets.hash(value))).toBe(true);
    expect(secrets.matches(`${value}x`, secrets.hash(value))).toBe(false);
    for (const malformed of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64)]) expect(secrets.matches(value, malformed)).toBe(false);
  });
});

describe('machine identity use cases', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;
  let now: Date;
  const clock = () => now;
  const secrets = new NodeMachineSecrets();

  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  const tenant = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    const workspaceId = account.workspaces[0]?.workspace.id ?? '';
    const host = await new CreateHost(access, persistence.repositories.hosts).execute(account.user, workspaceId, { displayName: 'servidor' });
    return { user: account.user, workspaceId, hostId: host.id };
  };

  const request = (limit = 100) => new RequestPairingCode(access, persistence.unitOfWork, secrets, limit, clock);
  const redeem = (unitOfWork: UnitOfWork = persistence.unitOfWork) => new RedeemPairingCode(unitOfWork, secrets, clock);
  const authenticate = () => new AuthenticateMachine(persistence.repositories.machineCredentials, secrets, clock);
  const rotate = (unitOfWork: UnitOfWork = persistence.unitOfWork) => new RotateMachineCredential(access, unitOfWork, secrets, clock);
  const revoke = () => new RevokeMachineCredential(access, persistence.unitOfWork, clock);
  const pairingOf = () => new GetHostPairing(access, persistence.repositories.hosts, persistence.repositories.pairingChallenges, persistence.repositories.machineCredentials, clock);

  const paired = async () => {
    const t = await tenant();
    const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
    const redeemed = await redeem().execute(code);
    return { ...t, ...redeemed };
  };

  const reasonOf = async (action: Promise<unknown>) => {
    const error = await action.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PairingRejectedError);
    return (error as PairingRejectedError).reason;
  };

  const authFailureOf = async (action: Promise<unknown>) => {
    const error = await action.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MachineAuthenticationError);
    return (error as MachineAuthenticationError).reason;
  };

  /** Lets `work` run for real, then fails: whatever it wrote must be undone. */
  const failingAfter = (sabotage: (repositories: Repositories) => Repositories): UnitOfWork => ({
    run: (work) => persistence.unitOfWork.run((repositories) => work(sabotage(repositories))),
  });

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
    now = new Date('2026-05-01T12:00:00.000Z');
  });

  describe('RequestPairingCode', () => {
    it('stores only the hash, returns the code once and leaves the host unpaired', async () => {
      const t = await tenant();
      const issued = await request().execute(t.user, t.workspaceId, t.hostId);
      expect(issued.code).toMatch(/^aegis_pair_[A-Za-z0-9_-]{43}$/);
      expect(issued.expiresAt).toEqual(new Date(now.getTime() + PAIRING_POLICY.codeTtlMs));
      const [stored] = [...persistence.store.pairingChallenges.values()];
      expect(stored).toMatchObject({ workspaceId: t.workspaceId, hostId: t.hostId, createdBy: t.user.id, codeHash: secrets.hash(issued.code) });
      expect(JSON.stringify(stored)).not.toContain(issued.code);
      expect(persistence.store.hosts.get(t.hostId)).toMatchObject({ connectionState: 'UNPAIRED', agentId: null });
    });

    it('a new code revokes the previous one for the same host', async () => {
      const t = await tenant();
      const first = await request().execute(t.user, t.workspaceId, t.hostId);
      const second = await request().execute(t.user, t.workspaceId, t.hostId);
      expect(await reasonOf(redeem().execute(first.code))).toBe('REVOKED');
      await expect(redeem().execute(second.code)).resolves.toMatchObject({ challengeId: second.challengeId });
    });

    it('requires a manager; outsiders and foreign hosts get 404', async () => {
      const owner = await tenant();
      const viewer = await tenant();
      const outsider = await tenant();
      persistence.store.memberships.set(
        `${viewer.user.id}:${owner.workspaceId}`,
        Membership.restore({ userId: viewer.user.id, workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: now }).toSnapshot(),
      );
      await expect(request().execute(viewer.user, owner.workspaceId, owner.hostId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(request().execute(outsider.user, owner.workspaceId, owner.hostId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(request().execute(owner.user, owner.workspaceId, outsider.hostId)).rejects.toBeInstanceOf(NotFoundError);
      expect(persistence.store.pairingChallenges.size).toBe(0);
    });

    it('refuses a host that already has an active credential', async () => {
      const t = await paired();
      await expect(request().execute(t.user, t.workspaceId, t.hostId)).rejects.toBeInstanceOf(HostAlreadyPairedError);
    });

    it('limits codes per host per hour, per host, and recovers when the window passes', async () => {
      const t = await tenant();
      const other = await tenant();
      await request(2).execute(t.user, t.workspaceId, t.hostId);
      await request(2).execute(t.user, t.workspaceId, t.hostId);
      await expect(request(2).execute(t.user, t.workspaceId, t.hostId)).rejects.toBeInstanceOf(TooManyRequestsError);
      await expect(request(2).execute(other.user, other.workspaceId, other.hostId)).resolves.toBeDefined();
      advance(PAIRING_POLICY.codeRequestWindowMs + 1);
      await expect(request(2).execute(t.user, t.workspaceId, t.hostId)).resolves.toBeDefined();
    });
  });

  describe('RedeemPairingCode', () => {
    it('creates one credential bound to the challenge host and marks the host PAIRED', async () => {
      const t = await tenant();
      const { code, challengeId } = await request().execute(t.user, t.workspaceId, t.hostId);
      const { token, credential } = await redeem().execute(code);

      expect(token).toMatch(/^aegis_agent_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
      const stored = persistence.store.machineCredentials.get(credential.id);
      expect(stored).toMatchObject({ workspaceId: t.workspaceId, hostId: t.hostId, scopes: ['events:ingest'], pairingChallengeId: challengeId });
      const secret = token.split('.')[1] ?? '';
      expect(stored?.tokenHash).toBe(secrets.hash(secret));
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(persistence.store.hosts.get(t.hostId)).toMatchObject({ connectionState: 'PAIRED', agentId: credential.id, lastSeenAt: null });
    });

    it('is single use', async () => {
      const t = await tenant();
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      await redeem().execute(code);
      expect(await reasonOf(redeem().execute(code))).toBe('CONSUMED');
      expect(persistence.store.machineCredentials.size).toBe(1);
    });

    it('refuses expired, unknown and malformed codes without writing anything', async () => {
      const t = await tenant();
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      const snapshot = [...persistence.store.pairingChallenges.values()];
      advance(PAIRING_POLICY.codeTtlMs);
      expect(await reasonOf(redeem().execute(code))).toBe('EXPIRED');
      expect(await reasonOf(redeem().execute(`aegis_pair_${'B'.repeat(43)}`))).toBe('UNKNOWN_CODE');
      expect(await reasonOf(redeem().execute('qualquer-coisa'))).toBe('MALFORMED');
      expect([...persistence.store.pairingChallenges.values()]).toEqual(snapshot);
      expect(persistence.store.machineCredentials.size).toBe(0);
      expect(persistence.store.hosts.get(t.hostId)?.connectionState).toBe('UNPAIRED');
    });

    it('a failure while creating the credential undoes the consumption', async () => {
      const t = await tenant();
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      const failing = failingAfter((repositories) => ({
        ...repositories,
        machineCredentials: { ...repositories.machineCredentials, insert: async () => Promise.reject(new Error('simulated failure')) },
      }));
      await expect(redeem(failing).execute(code)).rejects.toThrow('simulated failure');
      expect(persistence.store.machineCredentials.size).toBe(0);
      expect([...persistence.store.pairingChallenges.values()][0]?.consumedAt).toBeNull();
      expect(persistence.store.hosts.get(t.hostId)?.agentId).toBeNull();
      await expect(redeem().execute(code)).resolves.toBeDefined();
    });

    it('a failure after the credential was written leaves nothing behind', async () => {
      const t = await tenant();
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      const failing = failingAfter((repositories) => ({
        ...repositories,
        hosts: { ...repositories.hosts, lockInWorkspace: (w, h) => repositories.hosts.lockInWorkspace(w, h), updatePairing: async () => Promise.reject(new Error('simulated failure')) },
      }));
      await expect(redeem(failing).execute(code)).rejects.toThrow('simulated failure');
      expect(persistence.store.machineCredentials.size).toBe(0);
    });

    it('treats a lost race for the consumption as an already used code', async () => {
      const t = await tenant();
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      const racing = failingAfter((repositories) => ({
        ...repositories,
        pairingChallenges: {
          insert: (c) => repositories.pairingChallenges.insert(c),
          findByCodeHash: (h) => repositories.pairingChallenges.findByCodeHash(h),
          lockById: (i) => repositories.pairingChallenges.lockById(i),
          findOpenForHost: (w, h) => repositories.pairingChallenges.findOpenForHost(w, h),
          countCreatedSince: (w, h, s) => repositories.pairingChallenges.countCreatedSince(w, h, s),
          markRevoked: (c) => repositories.pairingChallenges.markRevoked(c),
          markConsumed: async () => false,
        },
      }));
      expect(await reasonOf(redeem(racing).execute(code))).toBe('CONSUMED');
      expect(persistence.store.machineCredentials.size).toBe(0);
    });
  });

  describe('AuthenticateMachine', () => {
    it('resolves host, workspace and scopes from the credential', async () => {
      const t = await paired();
      const context = await authenticate().execute(t.token);
      expect(context).toMatchObject({ credentialId: t.credential.id, workspaceId: t.workspaceId, hostId: t.hostId });
      expect(() => context.requireScope('events:ingest')).not.toThrow();
      expect(() => context.requireHost(t.workspaceId, t.hostId)).not.toThrow();
      expect(() => context.requireHost(t.workspaceId, randomUUID())).toThrow(NotFoundError);
      expect(() => context.requireHost(randomUUID(), t.hostId)).toThrow(NotFoundError);
    });

    it('classifies failures internally and keeps them all generic', async () => {
      const t = await paired();
      const [hex] = t.token.replace('aegis_agent_', '').split('.');
      expect(await authFailureOf(authenticate().execute(''))).toBe('MALFORMED');
      expect(await authFailureOf(authenticate().execute('aaa.bbb.ccc'))).toBe('MALFORMED');
      expect(await authFailureOf(authenticate().execute(formatMachineToken(randomUUID(), secrets.generate())))).toBe('UNKNOWN_CREDENTIAL');
      expect(await authFailureOf(authenticate().execute(`aegis_agent_${hex}.${secrets.generate()}`))).toBe('BAD_SECRET');
    });

    it('only reveals a revocation to the holder of the real secret', async () => {
      const t = await paired();
      await revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id);
      const [hex] = t.token.replace('aegis_agent_', '').split('.');
      expect(await authFailureOf(authenticate().execute(`aegis_agent_${hex}.${secrets.generate()}`))).toBe('BAD_SECRET');
      expect(await authFailureOf(authenticate().execute(t.token))).toBe('REVOKED');
    });

    it('records last use at most once per interval', async () => {
      const t = await paired();
      const lastUsed = () => persistence.store.machineCredentials.get(t.credential.id)?.lastUsedAt;
      expect(lastUsed()).toBeNull();
      await authenticate().execute(t.token);
      const first = now;
      expect(lastUsed()).toEqual(first);
      advance(CREDENTIAL_LAST_USED_RESOLUTION_MS - 1);
      await authenticate().execute(t.token);
      expect(lastUsed()).toEqual(first);
      advance(2);
      await authenticate().execute(t.token);
      expect(lastUsed()).toEqual(now);
    });
  });

  describe('RotateMachineCredential', () => {
    it('invalidates the old token immediately and the new one works', async () => {
      const t = await paired();
      const rotated = await rotate().execute(t.user, t.workspaceId, t.hostId, t.credential.id);
      expect(rotated.previousCredentialId).toBe(t.credential.id);
      expect(await authFailureOf(authenticate().execute(t.token))).toBe('REVOKED');
      await expect(authenticate().execute(rotated.token)).resolves.toMatchObject({ hostId: t.hostId, credentialId: rotated.credential.id });
      expect(persistence.store.hosts.get(t.hostId)).toMatchObject({ agentId: rotated.credential.id, connectionState: 'PAIRED' });
      expect(persistence.store.machineCredentials.get(rotated.credential.id)?.rotatedFromCredentialId).toBe(t.credential.id);
      expect(persistence.store.hosts.size).toBe(1);
    });

    it('is atomic: a failed insert leaves the old credential working', async () => {
      const t = await paired();
      const failing = failingAfter((repositories) => ({
        ...repositories,
        machineCredentials: {
          insert: async () => Promise.reject(new Error('simulated failure')),
          findForAuthentication: (i) => repositories.machineCredentials.findForAuthentication(i),
          lockInHost: (w, h, i) => repositories.machineCredentials.lockInHost(w, h, i),
          listForHost: (w, h, l) => repositories.machineCredentials.listForHost(w, h, l),
          markRevoked: (c) => repositories.machineCredentials.markRevoked(c),
          touchLastUsed: (i, u, o) => repositories.machineCredentials.touchLastUsed(i, u, o),
          existsForHost: (h) => repositories.machineCredentials.existsForHost(h),
        },
      }));
      await expect(rotate(failing).execute(t.user, t.workspaceId, t.hostId, t.credential.id)).rejects.toThrow('simulated failure');
      await expect(authenticate().execute(t.token)).resolves.toMatchObject({ credentialId: t.credential.id });
      expect(persistence.store.machineCredentials.size).toBe(1);
    });

    it('refuses a revoked credential and credentials of other hosts or workspaces', async () => {
      const a = await paired();
      const b = await paired();
      await expect(rotate().execute(a.user, a.workspaceId, a.hostId, b.credential.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(rotate().execute(a.user, b.workspaceId, b.hostId, b.credential.id)).rejects.toBeInstanceOf(NotFoundError);
      await revoke().execute(a.user, a.workspaceId, a.hostId, a.credential.id);
      await expect(rotate().execute(a.user, a.workspaceId, a.hostId, a.credential.id)).rejects.toBeInstanceOf(CredentialRevokedError);
    });
  });

  describe('RevokeMachineCredential', () => {
    it('keeps the record, ends authentication and unpairs the host', async () => {
      const t = await paired();
      await expect(revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id)).resolves.toEqual({ revoked: true });
      expect(persistence.store.machineCredentials.get(t.credential.id)?.revokedAt).toEqual(now);
      expect(await authFailureOf(authenticate().execute(t.token))).toBe('REVOKED');
      expect(persistence.store.hosts.get(t.hostId)).toMatchObject({ agentId: null, connectionState: 'UNPAIRED' });
    });

    it('is idempotent and keeps the first revocation time', async () => {
      const t = await paired();
      await revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id);
      const first = now;
      advance(1000);
      await expect(revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id)).resolves.toEqual({ revoked: false });
      expect(persistence.store.machineCredentials.get(t.credential.id)?.revokedAt).toEqual(first);
    });

    it('allows a new pairing afterwards and revoking the old credential again does not unpair it', async () => {
      const t = await paired();
      await revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id);
      const { code } = await request().execute(t.user, t.workspaceId, t.hostId);
      const second = await redeem().execute(code);
      await revoke().execute(t.user, t.workspaceId, t.hostId, t.credential.id);
      expect(persistence.store.hosts.get(t.hostId)).toMatchObject({ agentId: second.credential.id, connectionState: 'PAIRED' });
    });

    it('does not reveal or touch credentials outside the host', async () => {
      const a = await paired();
      const b = await paired();
      await expect(revoke().execute(a.user, a.workspaceId, a.hostId, b.credential.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(revoke().execute(a.user, b.workspaceId, b.hostId, b.credential.id)).rejects.toBeInstanceOf(NotFoundError);
      expect(persistence.store.machineCredentials.get(b.credential.id)?.revokedAt).toBeNull();
    });
  });

  describe('GetHostPairing', () => {
    it('reports a pending code by expiry only, and drops it once expired', async () => {
      const t = await tenant();
      const issued = await request().execute(t.user, t.workspaceId, t.hostId);
      await expect(pairingOf().execute(t.user, t.workspaceId, t.hostId)).resolves.toEqual({ pendingCodeExpiresAt: issued.expiresAt, credentials: [] });
      advance(PAIRING_POLICY.codeTtlMs);
      await expect(pairingOf().execute(t.user, t.workspaceId, t.hostId)).resolves.toEqual({ pendingCodeExpiresAt: null, credentials: [] });
    });

    it('is scoped to the workspace', async () => {
      const a = await paired();
      const b = await paired();
      await expect(pairingOf().execute(a.user, b.workspaceId, b.hostId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(pairingOf().execute(a.user, a.workspaceId, b.hostId)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
