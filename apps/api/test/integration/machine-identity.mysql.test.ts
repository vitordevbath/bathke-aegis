import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { ConflictError, PAIRING_REJECTED_MESSAGE } from '@aegis/domain';
import type { HostPairingResponse, LoginResponse, PairAgentResponse, RotateCredentialResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { NodeMachineSecrets } from '../../src/infrastructure/security/node-machine-secrets.js';
import { RedeemPairingCode } from '../../src/application/use-cases/machine-identity/redeem-pairing-code.js';
import { RotateMachineCredential } from '../../src/application/use-cases/machine-identity/rotate-machine-credential.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { Host } from '../../src/domain/host.js';
import { MachineCredential } from '../../src/domain/machine-credential.js';
import { PairingChallenge } from '../../src/domain/pairing-challenge.js';
import { User } from '../../src/domain/user.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer, redeemCode, requestPairingCode } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const boot = () => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  category: 'SYSTEM',
  type: 'SYSTEM_BOOT',
  data: { system: { eventType: 'BOOT' } },
});

const statusesOf = (responses: readonly LightMyRequestResponse[]) => responses.map((response) => response.statusCode).sort((a, b) => a - b);

describe.skipIf(!TEST_DATABASE_URL)('machine identity against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;
  const secrets = new NodeMachineSecrets();

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({
      DATABASE_URL: database.url,
      JWT_SECRET: testJwtSecret(),
      AUTH_RATE_LIMIT_MAX: '1000',
      INGEST_RATE_LIMIT_MAX: '1000',
      PAIR_RATE_LIMIT_MAX: '1000',
      PAIR_INVALID_ATTEMPTS_MAX: '1000',
      PAIR_CODES_PER_HOST_PER_HOUR: '1000',
    });
    const production = createProductionDependencies(env);
    closeApp = production.close;
    app = await buildApp(production.dependencies);
    connection = createDatabase(database.url);
    repositories = createDrizzleRepositories(connection.db);
  });

  afterAll(async () => {
    await app?.close();
    await closeApp?.();
    await connection?.close();
    await database?.drop();
  });

  const query = async <T>(statement: ReturnType<typeof sql>): Promise<T[]> => {
    const [rows] = (await connection.db.execute(statement)) as unknown as [T[]];
    return rows;
  };

  async function tenant() {
    const registration = makeRegistration();
    await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    const session = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })).json<LoginResponse>();
    const workspaceId = session.workspaces[0]?.id ?? '';
    const base = `/workspaces/${workspaceId}`;
    const headers = bearer(session.token);
    const newHost = async () => {
      const host = Host.register({ workspaceId, displayName: 'servidor-web-01' });
      await repositories.hosts.insert(host);
      return host;
    };
    const host = await newHost();
    const code = (hostId = host.id) => requestPairingCode(app, session.token, workspaceId, hostId);
    const pair = async (hostId = host.id) => (await redeemCode(app, (await code(hostId)).code)).json<PairAgentResponse>();
    return {
      userId: session.user.id,
      workspaceId,
      base,
      headers,
      host,
      newHost,
      code,
      pair,
      ingest: (token: string, hostId = host.id) => app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/events/ingest`, headers: bearer(token), payload: { events: [boot()] } }),
      rotate: (credentialId: string, hostId = host.id) => app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/credentials/${credentialId}/rotate`, headers }),
      revoke: (credentialId: string, hostId = host.id) => app.inject({ method: 'DELETE', url: `${base}/hosts/${hostId}/credentials/${credentialId}`, headers }),
    };
  }

  const credentialsOf = (hostId: string) =>
    query<{ id: string; token_hash: string; revoked_at: Date | null; rotated_from_credential_id: string | null; pairing_challenge_id: string | null }>(
      sql`SELECT id, token_hash, revoked_at, rotated_from_credential_id, pairing_challenge_id FROM machine_credentials WHERE host_id = ${hostId} ORDER BY created_at, id`,
    );
  const challengesOf = (hostId: string) =>
    query<{ id: string; code_hash: string; consumed_at: Date | null; revoked_at: Date | null }>(sql`SELECT id, code_hash, consumed_at, revoked_at FROM pairing_challenges WHERE host_id = ${hostId}`);
  const hostRow = async (hostId: string) => (await query<{ agent_id: string | null; connection_state: string; last_seen_at: Date | null }>(sql`SELECT agent_id, connection_state, last_seen_at FROM hosts WHERE id = ${hostId}`))[0];

  /** Runs the real transaction against MySQL and fails at the chosen step. */
  const sabotaged = (sabotage: (real: Repositories) => Repositories): UnitOfWork => {
    const real = new DrizzleUnitOfWork(connection.db);
    return { run: (work) => real.run((tx) => work(sabotage(tx))) };
  };

  describe('schema', () => {
    const constraintsOf = (table: string) =>
      query<{ name: string; referenced: string; onDelete: string }>(sql`
        SELECT CONSTRAINT_NAME AS name, REFERENCED_TABLE_NAME AS referenced, DELETE_RULE AS onDelete FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ${table} ORDER BY CONSTRAINT_NAME`);
    const indexesOf = async (table: string) =>
      (
        await query<{ name: string; nonUnique: number }>(sql`
          SELECT DISTINCT INDEX_NAME AS name, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`)
      )
        .map((index) => `${index.name}:${Number(index.nonUnique)}`)
        .sort();

    it('applies 0009 and 0010 from zero with the expected keys', async () => {
      expect(await constraintsOf('pairing_challenges')).toEqual([
        { name: 'pairing_challenges_created_by_users_id_fk', referenced: 'users', onDelete: 'RESTRICT' },
        { name: 'pairing_challenges_host_fk', referenced: 'hosts', onDelete: 'CASCADE' },
        { name: 'pairing_challenges_workspace_id_workspaces_id_fk', referenced: 'workspaces', onDelete: 'CASCADE' },
      ]);
      expect(await constraintsOf('machine_credentials')).toEqual([
        { name: 'credentials_challenge_fk', referenced: 'pairing_challenges', onDelete: 'SET NULL' },
        { name: 'credentials_host_fk', referenced: 'hosts', onDelete: 'RESTRICT' },
        { name: 'credentials_rotated_from_fk', referenced: 'machine_credentials', onDelete: 'SET NULL' },
        { name: 'credentials_workspace_fk', referenced: 'workspaces', onDelete: 'CASCADE' },
      ]);
      expect(await indexesOf('pairing_challenges')).toEqual(
        expect.arrayContaining(['pairing_challenges_code_hash_unique:0', 'pairing_challenges_open_host_unique:0', 'pairing_challenges_host_created_idx:1']),
      );
      expect(await indexesOf('machine_credentials')).toEqual(
        expect.arrayContaining(['machine_credentials_active_host_unique:0', 'machine_credentials_challenge_unique:0', 'machine_credentials_rotated_from_unique:0', 'machine_credentials_host_created_idx:1']),
      );
      expect(await indexesOf('hosts')).toEqual(expect.arrayContaining(['hosts_id_workspace_unique:0']));
    });

    it('existing rows stay UNPAIRED and the enum accepts PAIRED', async () => {
      const t = await tenant();
      expect(await hostRow(t.host.id)).toMatchObject({ connection_state: 'UNPAIRED', agent_id: null });
      await t.pair();
      expect((await hostRow(t.host.id))?.connection_state).toBe('PAIRED');
    });

    it('the database refuses a second active credential for a host', async () => {
      const t = await tenant();
      await t.pair();
      const duplicate = MachineCredential.issue({ workspaceId: t.workspaceId, hostId: t.host.id, tokenHash: secrets.hash(secrets.generate()), scopes: ['events:ingest'] });
      await expect(repositories.machineCredentials.insert(duplicate)).rejects.toThrow();
      expect(await credentialsOf(t.host.id)).toHaveLength(1);
    });

    it('the database refuses two credentials from one challenge', async () => {
      const t = await tenant();
      const pairedCredential = await t.pair();
      const [row] = await credentialsOf(t.host.id);
      await t.revoke(pairedCredential.credentialId);
      const duplicate = MachineCredential.issue({ workspaceId: t.workspaceId, hostId: t.host.id, tokenHash: secrets.hash(secrets.generate()), scopes: ['events:ingest'], pairingChallengeId: row?.pairing_challenge_id ?? null });
      await expect(repositories.machineCredentials.insert(duplicate)).rejects.toThrow();
    });

    it('the database refuses a second open code for a host', async () => {
      const t = await tenant();
      await t.code();
      const duplicate = PairingChallenge.issue({ workspaceId: t.workspaceId, hostId: t.host.id, codeHash: secrets.hash(secrets.generate()), createdBy: t.userId });
      await expect(repositories.pairingChallenges.insert(duplicate)).rejects.toThrow();
      expect(await challengesOf(t.host.id)).toHaveLength(1);
    });

    it('composite FKs refuse a host paired with a credential or code of another workspace', async () => {
      const a = await tenant();
      const b = await tenant();
      const credential = MachineCredential.issue({ workspaceId: b.workspaceId, hostId: a.host.id, tokenHash: secrets.hash(secrets.generate()), scopes: ['events:ingest'] });
      await expect(repositories.machineCredentials.insert(credential)).rejects.toThrow();
      const challenge = PairingChallenge.issue({ workspaceId: b.workspaceId, hostId: a.host.id, codeHash: secrets.hash(secrets.generate()), createdBy: b.userId });
      await expect(repositories.pairingChallenges.insert(challenge)).rejects.toThrow();
    });
  });

  describe('single use under concurrency', () => {
    it('ten simultaneous requests with one code create exactly one credential', async () => {
      const t = await tenant();
      const { code } = await t.code();
      const responses = await Promise.all(Array.from({ length: 10 }, () => redeemCode(app, code)));

      expect(statusesOf(responses)).toEqual([201, ...Array.from({ length: 9 }, () => 401)]);
      for (const refused of responses.filter((response) => response.statusCode === 401)) expect(refused.json<{ error: { message: string } }>().error.message).toBe(PAIRING_REJECTED_MESSAGE);
      expect(await credentialsOf(t.host.id)).toHaveLength(1);
      const [challenge] = await challengesOf(t.host.id);
      expect(challenge?.consumed_at).not.toBeNull();
      const winner = responses.find((response) => response.statusCode === 201)?.json<PairAgentResponse>();
      expect((await hostRow(t.host.id))?.agent_id).toBe(winner?.credentialId);
    });

    it('repeated rounds stay deterministic and free of deadlocks', async () => {
      const t = await tenant();
      for (let round = 0; round < 5; round += 1) {
        const host = await t.newHost();
        const { code } = await t.code(host.id);
        const responses = await Promise.all(Array.from({ length: 6 }, () => redeemCode(app, code)));
        expect(statusesOf(responses)).toEqual([201, 401, 401, 401, 401, 401]);
        expect(await credentialsOf(host.id)).toHaveLength(1);
      }
    });

    it('a code request racing a redeem never leaves two active credentials or a broken state', async () => {
      const t = await tenant();
      const { code } = await t.code();
      const [redeemed, requested] = await Promise.all([redeemCode(app, code), app.inject({ method: 'POST', url: `${t.base}/hosts/${t.host.id}/pairing-codes`, headers: t.headers })]);
      expect([201, 401]).toContain(redeemed.statusCode);
      expect([201, 409]).toContain(requested.statusCode);
      expect((await credentialsOf(t.host.id)).length).toBeLessThanOrEqual(1);
      expect(await challengesOf(t.host.id).then((rows) => rows.filter((row) => !row.consumed_at && !row.revoked_at).length)).toBeLessThanOrEqual(1);
    });

    it('concurrent code requests leave one open code', async () => {
      const t = await tenant();
      const responses = await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: `${t.base}/hosts/${t.host.id}/pairing-codes`, headers: t.headers })));
      expect(statusesOf(responses)).toEqual([201, 201, 201, 201, 201]);
      const rows = await challengesOf(t.host.id);
      expect(rows).toHaveLength(5);
      expect(rows.filter((row) => !row.consumed_at && !row.revoked_at)).toHaveLength(1);
    });

    it('concurrent rotations: one wins, the others see a revoked credential', async () => {
      const t = await tenant();
      const { credentialId, token } = await t.pair();
      const responses = await Promise.all(Array.from({ length: 5 }, () => t.rotate(credentialId)));
      expect(statusesOf(responses)).toEqual([200, 409, 409, 409, 409]);
      const rows = await credentialsOf(t.host.id);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
      expect((await t.ingest(token)).statusCode).toBe(401);
    });
  });

  describe('code lifecycle', () => {
    it('stores only hashes', async () => {
      const t = await tenant();
      const { code } = await t.code();
      const { token } = (await redeemCode(app, code)).json<PairAgentResponse>();
      const [challenge] = await challengesOf(t.host.id);
      const [credential] = await credentialsOf(t.host.id);
      expect(challenge?.code_hash).toBe(secrets.hash(code));
      expect(credential?.token_hash).toBe(secrets.hash(token.split('.')[1] ?? ''));
      const dump = JSON.stringify([
        await query(sql`SELECT * FROM pairing_challenges WHERE host_id = ${t.host.id}`),
        await query(sql`SELECT * FROM machine_credentials WHERE host_id = ${t.host.id}`),
      ]);
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(token.split('.')[1]);
    });

    it('refuses a consumed code', async () => {
      const t = await tenant();
      const { code } = await t.code();
      expect((await redeemCode(app, code)).statusCode).toBe(201);
      expect((await redeemCode(app, code)).statusCode).toBe(401);
      expect(await credentialsOf(t.host.id)).toHaveLength(1);
    });

    it('refuses an expired code and creates nothing', async () => {
      const t = await tenant();
      const { code } = await t.code();
      await connection.db.execute(sql`UPDATE pairing_challenges SET expires_at = ${new Date(Date.now() - 1000)} WHERE host_id = ${t.host.id}`);
      expect((await redeemCode(app, code)).statusCode).toBe(401);
      expect(await credentialsOf(t.host.id)).toHaveLength(0);
      expect((await challengesOf(t.host.id))[0]?.consumed_at).toBeNull();
    });

    it('a new code revokes the previous one', async () => {
      const t = await tenant();
      const first = await t.code();
      const second = await t.code();
      expect((await redeemCode(app, first.code)).statusCode).toBe(401);
      expect((await redeemCode(app, second.code)).statusCode).toBe(201);
    });
  });

  describe('rollback', () => {
    it('a failure creating the credential leaves the code usable and nothing written', async () => {
      const t = await tenant();
      const { code } = await t.code();
      const failing = sabotaged((tx) => ({ ...tx, machineCredentials: new Proxy(tx.machineCredentials, { get: (target, key, receiver) => (key === 'insert' ? async () => Promise.reject(new Error('simulated failure')) : Reflect.get(target, key, receiver)) }) }));
      await expect(new RedeemPairingCode(failing, secrets).execute(code)).rejects.toThrow('simulated failure');
      expect(await credentialsOf(t.host.id)).toHaveLength(0);
      expect((await challengesOf(t.host.id))[0]?.consumed_at).toBeNull();
      expect((await hostRow(t.host.id))?.agent_id).toBeNull();
      expect((await redeemCode(app, code)).statusCode).toBe(201);
    });

    it('a failure after the credential row rolls that row back', async () => {
      const t = await tenant();
      const { code } = await t.code();
      const failing = sabotaged((tx) => ({ ...tx, hosts: new Proxy(tx.hosts, { get: (target, key, receiver) => (key === 'updatePairing' ? async () => Promise.reject(new Error('simulated failure')) : Reflect.get(target, key, receiver)) }) }));
      await expect(new RedeemPairingCode(failing, secrets).execute(code)).rejects.toThrow('simulated failure');
      expect(await credentialsOf(t.host.id)).toHaveLength(0);
      expect((await challengesOf(t.host.id))[0]?.consumed_at).toBeNull();
    });

    it('a failed rotation keeps the old credential working', async () => {
      const t = await tenant();
      const { credentialId, token } = await t.pair();
      const failing = sabotaged((tx) => ({ ...tx, machineCredentials: new Proxy(tx.machineCredentials, { get: (target, key, receiver) => (key === 'insert' ? async () => Promise.reject(new Error('simulated failure')) : Reflect.get(target, key, receiver)) }) }));
      const user = await repositories.users.findById(t.userId);
      if (!(user instanceof User)) throw new Error('user not found');
      await expect(new RotateMachineCredential(new WorkspaceAccess(repositories.memberships), failing, secrets).execute(user, t.workspaceId, t.host.id, credentialId)).rejects.toThrow('simulated failure');
      const rows = await credentialsOf(t.host.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_at).toBeNull();
      expect((await t.ingest(token)).statusCode).toBe(200);
    });
  });

  describe('credentials in use', () => {
    it('authenticates ingestion, writes events and records last use, without marking the host online', async () => {
      const t = await tenant();
      const { token } = await t.pair();
      expect((await t.ingest(token)).statusCode).toBe(200);
      expect(await query(sql`SELECT id FROM events WHERE host_id = ${t.host.id}`)).toHaveLength(1);
      const [row] = await query<{ last_used_at: Date | null }>(sql`SELECT last_used_at FROM machine_credentials WHERE host_id = ${t.host.id}`);
      expect(row?.last_used_at).not.toBeNull();
      expect(await hostRow(t.host.id)).toMatchObject({ connection_state: 'PAIRED', last_seen_at: null });
    });

    it('rejects a user JWT, other hosts and other workspaces', async () => {
      const a = await tenant();
      const b = await tenant();
      const otherHost = await a.newHost();
      const { token } = await a.pair();
      await b.pair();
      expect((await app.inject({ method: 'POST', url: `${a.base}/hosts/${a.host.id}/events/ingest`, headers: a.headers, payload: { events: [boot()] } })).statusCode).toBe(401);
      expect((await a.ingest(token, otherHost.id)).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `${b.base}/hosts/${b.host.id}/events/ingest`, headers: bearer(token), payload: { events: [boot()] } })).statusCode).toBe(404);
      expect(await query(sql`SELECT id FROM events WHERE host_id IN (${otherHost.id}, ${b.host.id})`)).toHaveLength(0);
    });

    it('concurrent batches with one credential serialize on the host, without duplicates or deadlocks', async () => {
      const t = await tenant();
      const { token } = await t.pair();
      const events = Array.from({ length: 20 }, boot);
      const send = () => app.inject({ method: 'POST', url: `${t.base}/hosts/${t.host.id}/events/ingest`, headers: bearer(token), payload: { events } });
      const responses = await Promise.all([send(), send(), send()]);
      expect(statusesOf(responses)).toEqual([200, 200, 200]);
      expect(await query(sql`SELECT id FROM events WHERE host_id = ${t.host.id}`)).toHaveLength(20);
    });

    it('rotation links both rows, swaps the host and cuts off the old token', async () => {
      const t = await tenant();
      const first = await t.pair();
      const rotated = (await t.rotate(first.credentialId)).json<RotateCredentialResponse>();
      const rows = await credentialsOf(t.host.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === first.credentialId)?.revoked_at).not.toBeNull();
      expect(rows.find((row) => row.id === rotated.credential.id)).toMatchObject({ revoked_at: null, rotated_from_credential_id: first.credentialId });
      expect((await hostRow(t.host.id))?.agent_id).toBe(rotated.credential.id);
      expect((await t.ingest(first.token)).statusCode).toBe(401);
      expect((await t.ingest(rotated.token)).statusCode).toBe(200);
    });

    it('revocation is logical, idempotent and effective, and the same host can pair again', async () => {
      const t = await tenant();
      const first = await t.pair();
      expect((await t.revoke(first.credentialId)).statusCode).toBe(204);
      const [revoked] = await credentialsOf(t.host.id);
      expect(revoked?.revoked_at).not.toBeNull();
      expect((await t.revoke(first.credentialId)).statusCode).toBe(204);
      expect((await credentialsOf(t.host.id))[0]?.revoked_at).toEqual(revoked?.revoked_at);
      expect((await t.ingest(first.token)).statusCode).toBe(401);
      expect(await hostRow(t.host.id)).toMatchObject({ connection_state: 'UNPAIRED', agent_id: null });

      const second = await t.pair();
      expect((await t.ingest(second.token)).statusCode).toBe(200);
      expect(await credentialsOf(t.host.id)).toHaveLength(2);
    });

    it('lists metadata for the host only, without hashes', async () => {
      const a = await tenant();
      const b = await tenant();
      await a.pair();
      const credentialB = await b.pair();
      const response = await app.inject({ method: 'GET', url: `${a.base}/hosts/${a.host.id}/pairing`, headers: a.headers });
      const pairing = response.json<HostPairingResponse>();
      expect(pairing.credentials).toHaveLength(1);
      expect(response.body).not.toContain(credentialB.credentialId);
      expect(response.body).not.toContain((await credentialsOf(a.host.id))[0]?.token_hash);
    });
  });

  describe('host and workspace protection', () => {
    it('a host with a credential, even a revoked one, cannot be deleted (RESTRICT → 409)', async () => {
      const t = await tenant();
      const { credentialId } = await t.pair();
      await t.revoke(credentialId);
      await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, t.host.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, t.host.id)).rejects.toThrow(/histórico das credenciais/);
      expect((await app.inject({ method: 'DELETE', url: `${t.base}/hosts/${t.host.id}`, headers: t.headers })).statusCode).toBe(409);
    });

    it('an unused code leaves together with its host', async () => {
      const t = await tenant();
      await t.code();
      expect((await app.inject({ method: 'DELETE', url: `${t.base}/hosts/${t.host.id}`, headers: t.headers })).statusCode).toBe(204);
      expect(await challengesOf(t.host.id)).toHaveLength(0);
    });

    it('deleting a workspace removes credentials, rotation chains, codes and events without violating RESTRICT', async () => {
      const t = await tenant();
      const first = await t.pair();
      const rotated = (await t.rotate(first.credentialId)).json<RotateCredentialResponse>();
      await t.ingest(rotated.token);
      const pendingHost = await t.newHost();
      await t.code(pendingHost.id);

      await connection.db.execute(sql`DELETE FROM workspaces WHERE id = ${t.workspaceId}`);
      expect(await query(sql`SELECT id FROM hosts WHERE workspace_id = ${t.workspaceId}`)).toHaveLength(0);
      expect(await query(sql`SELECT id FROM machine_credentials WHERE workspace_id = ${t.workspaceId}`)).toHaveLength(0);
      expect(await query(sql`SELECT id FROM pairing_challenges WHERE workspace_id = ${t.workspaceId}`)).toHaveLength(0);
    });
  });
});
