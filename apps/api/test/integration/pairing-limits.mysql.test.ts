import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import type { HostPairingResponse, LoginResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { DrizzleRateLimitStore, rateLimitSubjectKey } from '../../src/infrastructure/db/drizzle-rate-limit-store.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { Host } from '../../src/domain/host.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer, requestPairingCode } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const statusesOf = (responses: readonly LightMyRequestResponse[]) => responses.map((response) => response.statusCode).sort((a, b) => a - b);

describe.skipIf(!TEST_DATABASE_URL)('persistent pairing limits against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;
  let jwtSecret: string;

  const envFor = (url: string, overrides: Record<string, string> = {}) =>
    loadEnv({
      DATABASE_URL: url,
      JWT_SECRET: jwtSecret,
      AUTH_RATE_LIMIT_MAX: '1000',
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
    const headers = bearer(session.token);
    const host = Host.register({ workspaceId, displayName: 'servidor-fedora' });
    await repositories.hosts.insert(host);
    return {
      workspaceId,
      headers,
      host,
      pairing: async () => (await app.inject({ method: 'GET', url: `/workspaces/${workspaceId}/hosts/${host.id}/pairing`, headers })).json<HostPairingResponse>(),
    };
  }

  describe('schema', () => {
    it('applies 0011 from zero: counters keyed by scope and hashed subject, with an expiry index', async () => {
      const columns = await query<{ name: string; type: string }>(sql`
        SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rate_limit_counters' ORDER BY ORDINAL_POSITION`);
      expect(columns).toEqual([
        { name: 'scope', type: 'varchar(32)' },
        { name: 'subject_hash', type: 'char(64)' },
        { name: 'hits', type: 'int unsigned' },
        { name: 'window_expires_at', type: 'datetime(3)' },
      ]);
      const indexes = await query<{ name: string; seq: number; column: string }>(sql`
        SELECT INDEX_NAME AS name, SEQ_IN_INDEX AS seq, COLUMN_NAME AS \`column\` FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rate_limit_counters' ORDER BY INDEX_NAME, SEQ_IN_INDEX`);
      expect(indexes.map((index) => `${index.name}:${index.column}`)).toEqual(['PRIMARY:scope', 'PRIMARY:subject_hash', 'rate_limit_counters_expiry_idx:window_expires_at']);
    });
  });

  describe('rate limit counters (ADR-046)', () => {
    const store = () => new DrizzleRateLimitStore(connection.db, rateLimitSubjectKey(jwtSecret));

    it('counts atomically under concurrency', async () => {
      const subject = `198.51.100.${Math.floor(Math.random() * 250)}`;
      const scope = `t_${randomUUID().slice(0, 8)}`;
      const now = new Date();
      const counts = await Promise.all(Array.from({ length: 40 }, () => store().hit(scope, subject, 60_000, now)));
      expect(counts.map((count) => count.hits).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      expect(new Set(counts.map((count) => count.resetAt.getTime())).size).toBe(1);
    });

    it('starts a new window when the old one ends, peeks without counting and purges only expired rows', async () => {
      const scope = `t_${randomUUID().slice(0, 8)}`;
      const t0 = new Date('2026-11-15T10:00:00.000Z');
      const at = (ms: number) => new Date(t0.getTime() + ms);
      expect((await store().hit(scope, 'a', 60_000, t0)).hits).toBe(1);
      expect((await store().hit(scope, 'a', 60_000, at(59_999))).hits).toBe(2);
      expect(await store().peek(scope, 'a', at(59_999))).toMatchObject({ hits: 2 });
      expect(await store().peek(scope, 'a', at(60_000))).toBeNull();
      expect(await store().hit(scope, 'a', 60_000, at(60_000))).toEqual({ hits: 1, resetAt: at(120_000) });
      await store().hit(scope, 'b', 1_000, t0);

      const removed = await store().purgeExpired(at(60_001), 1000);
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(await store().peek(scope, 'a', at(60_001))).toMatchObject({ hits: 1 });
      expect(await query(sql`SELECT 1 FROM rate_limit_counters WHERE scope = ${scope}`)).toHaveLength(1);
    });

    it('never stores the address: only a keyed hash, different from a plain SHA-256', async () => {
      const scope = `t_${randomUUID().slice(0, 8)}`;
      const address = '203.0.113.77';
      await store().hit(scope, address, 60_000, new Date());
      const rows = await query<{ subject_hash: string }>(sql`SELECT subject_hash FROM rate_limit_counters WHERE scope = ${scope}`);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(address);
      expect(rows[0]?.subject_hash).not.toBe(createHash('sha256').update(`${scope}\n${address}`).digest('hex'));
      expect(rows[0]?.subject_hash).not.toBe(createHash('sha256').update(address).digest('hex'));
    });

    it('limits survive an API restart and are shared by two instances', async () => {
      const limited = { PAIR_RATE_LIMIT_MAX: '2', PAIR_INVALID_ATTEMPTS_MAX: '1000' };
      const first = createProductionDependencies(envFor(database.url, limited));
      const firstApp = await buildApp(first.dependencies);
      const wrong = (target: FastifyInstance) => target.inject({ method: 'POST', url: '/agent/pair', payload: { code: `aegis_pair_${'Q'.repeat(43)}` }, remoteAddress: '192.0.2.44' });
      expect(statusesOf([await wrong(firstApp), await wrong(firstApp)])).toEqual([401, 401]);
      await firstApp.close();
      await first.close();

      // "Restarted" API: a new process state, the same database.
      const second = createProductionDependencies(envFor(database.url, limited));
      const secondApp = await buildApp(second.dependencies);
      try {
        const refused = await wrong(secondApp);
        expect(refused.statusCode).toBe(429);
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        // Another address is not affected.
        expect((await secondApp.inject({ method: 'POST', url: '/agent/pair', payload: { code: `aegis_pair_${'Q'.repeat(43)}` }, remoteAddress: '192.0.2.45' })).statusCode).toBe(401);
      } finally {
        await secondApp.close();
        await second.close();
      }
    });

    it('refused codes pause an address across instances, and a valid code is refused while paused', async () => {
      const limited = { PAIR_RATE_LIMIT_MAX: '1000', PAIR_INVALID_ATTEMPTS_MAX: '2' };
      const a = createProductionDependencies(envFor(database.url, limited));
      const b = createProductionDependencies(envFor(database.url, limited));
      const appA = await buildApp(a.dependencies);
      const appB = await buildApp(b.dependencies);
      try {
        const t = await tenant();
        const { code } = await requestPairingCode(app, t.headers.authorization.slice(7), t.workspaceId, t.host.id);
        const from = (target: FastifyInstance, value: string) => target.inject({ method: 'POST', url: '/agent/pair', payload: { code: value }, remoteAddress: '192.0.2.99' });
        expect((await from(appA, `aegis_pair_${'W'.repeat(43)}`)).statusCode).toBe(401);
        expect((await from(appB, `aegis_pair_${'W'.repeat(43)}`)).statusCode).toBe(401);
        expect((await from(appA, code)).statusCode).toBe(429);
        expect((await t.pairing()).activeCredential).toBeNull();
      } finally {
        await appA.close();
        await appB.close();
        await a.close();
        await b.close();
      }
    });
  });
});
