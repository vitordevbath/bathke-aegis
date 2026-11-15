import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { MachineAuthenticationError } from '@aegis/domain';
import type { HostPairingResponse, HostResponse, LoginResponse, PairAgentResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { NodeMachineSecrets } from '../../src/infrastructure/security/node-machine-secrets.js';
import { AuthenticateMachine } from '../../src/application/use-cases/machine-identity/authenticate-machine.js';
import { RecordHeartbeat } from '../../src/application/use-cases/machine-identity/record-heartbeat.js';
import { RevokeMachineCredential } from '../../src/application/use-cases/machine-identity/revoke-machine-credential.js';
import { EventIngestionService } from '../../src/application/event-ingestion-service.js';
import { IngestEventsAsMachine } from '../../src/application/use-cases/events/ingest-events.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { Host } from '../../src/domain/host.js';
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

/** Raw `execute` returns DATETIME(3) as text in UTC. */
const toDate = (value: unknown): Date | null => (value === null || value === undefined ? null : value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`));
/** Overrides one method of a repository instance, keeping the others (and their `this`) intact. */
const withMethod = <T extends object>(target: T, overrides: Partial<T>): T => Object.assign(Object.create(target) as T, overrides);

const statusesOf = (responses: readonly LightMyRequestResponse[]) => responses.map((response) => response.statusCode).sort((a, b) => a - b);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise that can be released from outside: the test decides when a paused transaction continues. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let reached: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  return { opened, open, arrived, reached };
}

describe.skipIf(!TEST_DATABASE_URL)('heartbeat, revocation guarantee and code cancellation against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;
  let jwtSecret: string;
  const secrets = new NodeMachineSecrets();

  const envFor = (url: string, overrides: Record<string, string> = {}) =>
    loadEnv({
      DATABASE_URL: url,
      JWT_SECRET: jwtSecret,
      AUTH_RATE_LIMIT_MAX: '1000',
      INGEST_RATE_LIMIT_MAX: '1000',
      HEARTBEAT_RATE_LIMIT_MAX: '1000',
      PAIR_RATE_LIMIT_MAX: '1000',
      PAIR_INVALID_ATTEMPTS_MAX: '1000',
      PAIR_CODES_PER_HOST_PER_HOUR: '1000',
      ...overrides,
    });

  beforeAll(async () => {
    database = await createMigratedDatabase();
    jwtSecret = testJwtSecret();
    const production = createProductionDependencies(envFor(database.url));
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
    const host = Host.register({ workspaceId, displayName: 'servidor-fedora' });
    await repositories.hosts.insert(host);
    const pair = async () => (await redeemCode(app, (await requestPairingCode(app, session.token, workspaceId, host.id)).code)).json<PairAgentResponse>();
    const user = await repositories.users.findById(session.user.id);
    if (!user) throw new Error('user not found');
    return {
      user,
      workspaceId,
      base,
      headers,
      host,
      pair,
      heartbeat: (token: string) => app.inject({ method: 'POST', url: `${base}/hosts/${host.id}/heartbeat`, headers: bearer(token), payload: {} }),
      ingest: (token: string) => app.inject({ method: 'POST', url: `${base}/hosts/${host.id}/events/ingest`, headers: bearer(token), payload: { events: [boot()] } }),
      revoke: (credentialId: string) => app.inject({ method: 'DELETE', url: `${base}/hosts/${host.id}/credentials/${credentialId}`, headers }),
      view: async () => (await app.inject({ method: 'GET', url: `${base}/hosts/${host.id}`, headers })).json<HostResponse>(),
      pairing: async () => (await app.inject({ method: 'GET', url: `${base}/hosts/${host.id}/pairing`, headers })).json<HostPairingResponse>(),
    };
  }

  const hostRow = async (hostId: string) => {
    const [row] = await query<{ last_seen_at: unknown; connection_state: string; updated_at: unknown }>(sql`SELECT last_seen_at, connection_state, updated_at FROM hosts WHERE id = ${hostId}`);
    return row && { last_seen_at: toDate(row.last_seen_at), connection_state: row.connection_state, updated_at: toDate(row.updated_at) };
  };
  const revokedAtOf = async (credentialId: string) => toDate((await query<{ revoked_at: unknown }>(sql`SELECT revoked_at FROM machine_credentials WHERE id = ${credentialId}`))[0]?.revoked_at);
  const eventsOf = async (hostId: string) =>
    (await query<{ ingested_at: unknown }>(sql`SELECT ingested_at FROM events WHERE host_id = ${hostId}`)).map((row) => ({ ingested_at: toDate(row.ingested_at) ?? new Date(NaN) }));

  /** Runs the real MySQL transaction, with a hook after the given repository call. */
  const pausedAt = (point: 'insertMany' | 'updatePresence', paused: ReturnType<typeof gate>): UnitOfWork => {
    const real = new DrizzleUnitOfWork(connection.db);
    return {
      run: (work) =>
        real.run((tx) =>
          work(
            point === 'insertMany'
              ? { ...tx, events: withMethod(tx.events, { insertMany: async (events) => (await tx.events.insertMany(events), paused.reached(), paused.opened) }) }
              : { ...tx, hosts: withMethod(tx.hosts, { updatePresence: async (host) => (await tx.hosts.updatePresence(host), paused.reached(), paused.opened) }) },
          ),
        ),
    };
  };

  describe('heartbeat', () => {
    it('writes only last_seen_at, with the server clock, and the host reads as ONLINE', async () => {
      const t = await tenant();
      const { token } = await t.pair();
      const before = await hostRow(t.host.id);
      const response = await t.heartbeat(token);
      expect(response.statusCode).toBe(200);
      const after = await hostRow(t.host.id);
      expect(after?.last_seen_at?.toISOString()).toBe(response.json<{ lastSeenAt: string }>().lastSeenAt);
      expect(after?.updated_at).toEqual(before?.updated_at);
      expect(after?.connection_state).toBe('PAIRED');
      expect((await t.view()).connectionState).toBe('ONLINE');
      expect(await eventsOf(t.host.id)).toHaveLength(0);
    });

    it('a failure after the write rolls the heartbeat back', async () => {
      const t = await tenant();
      const { token } = await t.pair();
      const machine = await new AuthenticateMachine(repositories.machineCredentials, secrets).execute(token);
      const real = new DrizzleUnitOfWork(connection.db);
      const failing: UnitOfWork = {
        run: (work) =>
          real.run((tx) => work({ ...tx, hosts: withMethod(tx.hosts, { updatePresence: async (host) => (await tx.hosts.updatePresence(host), Promise.reject(new Error('simulated failure'))) }) })),
      };
      await expect(new RecordHeartbeat(failing).execute(machine, t.workspaceId, t.host.id)).rejects.toThrow('simulated failure');
      expect((await hostRow(t.host.id))?.last_seen_at).toBeNull();
    });
  });

  describe('revocation guarantee (ADR-045)', () => {
    it('a request authenticated before the revocation cannot commit after it: ingestion and heartbeat', async () => {
      const t = await tenant();
      const { token, credentialId } = await t.pair();
      const machine = await new AuthenticateMachine(repositories.machineCredentials, secrets).execute(token);
      expect((await t.revoke(credentialId)).statusCode).toBe(204);

      const unitOfWork = new DrizzleUnitOfWork(connection.db);
      const ingestFailure = await new IngestEventsAsMachine(new EventIngestionService(unitOfWork)).execute(machine, t.workspaceId, t.host.id, [boot()]).catch((error: unknown) => error);
      const heartbeatFailure = await new RecordHeartbeat(unitOfWork).execute(machine, t.workspaceId, t.host.id).catch((error: unknown) => error);
      for (const failure of [ingestFailure, heartbeatFailure]) {
        expect(failure).toBeInstanceOf(MachineAuthenticationError);
        expect((failure as MachineAuthenticationError).reason).toBe('REVOKED_IN_FLIGHT');
      }
      expect(await eventsOf(t.host.id)).toHaveLength(0);
      expect((await hostRow(t.host.id))?.last_seen_at).toBeNull();
    });

    it('a revocation waits for an ingestion already holding the host, and only then returns', async () => {
      const t = await tenant();
      const { token, credentialId } = await t.pair();
      const machine = await new AuthenticateMachine(repositories.machineCredentials, secrets).execute(token);
      const paused = gate();
      const ingestion = new IngestEventsAsMachine(new EventIngestionService(pausedAt('insertMany', paused))).execute(machine, t.workspaceId, t.host.id, [boot()]);
      await paused.arrived;

      let revokedReturned = false;
      const revocation = new RevokeMachineCredential(new WorkspaceAccess(repositories.memberships), new DrizzleUnitOfWork(connection.db))
        .execute(t.user, t.workspaceId, t.host.id, credentialId)
        .then((result) => ((revokedReturned = true), result));
      await sleep(300);
      expect(revokedReturned).toBe(false);

      paused.open();
      await expect(ingestion).resolves.toMatchObject({ inserted: 1 });
      await expect(revocation).resolves.toEqual({ revoked: true });
      const [stored] = await eventsOf(t.host.id);
      const revokedAt = await revokedAtOf(credentialId);
      expect(stored && revokedAt && stored.ingested_at.getTime() <= revokedAt.getTime()).toBe(true);
      expect((await t.ingest(token)).statusCode).toBe(401);
    });

    it('a revocation waits for a heartbeat already holding the host', async () => {
      const t = await tenant();
      const { token, credentialId } = await t.pair();
      const machine = await new AuthenticateMachine(repositories.machineCredentials, secrets).execute(token);
      const paused = gate();
      const heartbeat = new RecordHeartbeat(pausedAt('updatePresence', paused)).execute(machine, t.workspaceId, t.host.id);
      await paused.arrived;
      const revocation = t.revoke(credentialId);
      await sleep(300);
      paused.open();
      await heartbeat;
      expect((await revocation).statusCode).toBe(204);
      const lastSeen = (await hostRow(t.host.id))?.last_seen_at;
      const revokedAt = await revokedAtOf(credentialId);
      expect(lastSeen && revokedAt && lastSeen.getTime() <= revokedAt.getTime()).toBe(true);
      expect((await t.heartbeat(token)).statusCode).toBe(401);
    });

    it('under a burst, nothing is confirmed after the revocation: every stored fact predates revoked_at', async () => {
      const t = await tenant();
      const { token, credentialId } = await t.pair();
      const inFlight: Promise<LightMyRequestResponse>[] = [];
      for (let i = 0; i < 12; i += 1) inFlight.push(t.ingest(token), t.heartbeat(token));
      const revocation = t.revoke(credentialId);
      for (let i = 0; i < 6; i += 1) inFlight.push(t.ingest(token), t.heartbeat(token));
      expect((await revocation).statusCode).toBe(204);
      const settled = await Promise.all(inFlight);
      expect(settled.every((response) => [200, 401].includes(response.statusCode))).toBe(true);

      const revokedAt = await revokedAtOf(credentialId);
      if (!revokedAt) throw new Error('credential not revoked');
      for (const event of await eventsOf(t.host.id)) expect(event.ingested_at.getTime()).toBeLessThanOrEqual(revokedAt.getTime());
      const lastSeen = (await hostRow(t.host.id))?.last_seen_at;
      if (lastSeen) expect(lastSeen.getTime()).toBeLessThanOrEqual(revokedAt.getTime());

      // After the revocation returned, every new attempt is refused and changes nothing.
      const eventsAfter = (await eventsOf(t.host.id)).length;
      expect(statusesOf(await Promise.all([t.ingest(token), t.heartbeat(token), t.ingest(token)]))).toEqual([401, 401, 401]);
      expect(await eventsOf(t.host.id)).toHaveLength(eventsAfter);
      expect((await hostRow(t.host.id))?.last_seen_at).toEqual(lastSeen ?? null);
      expect((await t.view()).connectionState).toBe('UNPAIRED');
    });
  });

  describe('pairing code cancellation', () => {
    it('racing a redemption: the code is either used or cancelled, never both, and a credential is never revoked by it', async () => {
      for (let round = 0; round < 6; round += 1) {
        const t = await tenant();
        const { code } = await requestPairingCode(app, t.headers.authorization.slice(7), t.workspaceId, t.host.id);
        const challengeId = (await t.pairing()).pendingCode?.id ?? '';
        const [redeemed, cancelled] = await Promise.all([
          redeemCode(app, code),
          app.inject({ method: 'DELETE', url: `${t.base}/hosts/${t.host.id}/pairing-codes/${challengeId}`, headers: t.headers }),
        ]);
        expect(cancelled.statusCode).toBe(204);
        const [raw] = await query<{ consumed_at: unknown; revoked_at: unknown }>(sql`SELECT consumed_at, revoked_at FROM pairing_challenges WHERE id = ${challengeId}`);
        const row = raw && { consumed_at: toDate(raw.consumed_at), revoked_at: toDate(raw.revoked_at) };
        const credentials = (await query<{ revoked_at: unknown }>(sql`SELECT revoked_at FROM machine_credentials WHERE host_id = ${t.host.id}`)).map((c) => ({ revoked_at: toDate(c.revoked_at) }));
        if (redeemed.statusCode === 201) {
          expect(row).toMatchObject({ revoked_at: null });
          expect(row?.consumed_at).not.toBeNull();
          expect(credentials).toEqual([{ revoked_at: null }]);
        } else {
          expect(redeemed.statusCode).toBe(401);
          expect(row).toMatchObject({ consumed_at: null });
          expect(row?.revoked_at).not.toBeNull();
          expect(credentials).toHaveLength(0);
        }
      }
    });
  });

});
