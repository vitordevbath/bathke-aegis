import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

/**
 * ADR-051: the per-route limits of login, register, ingestion and heartbeat use the persistent
 * counters. Two API instances on one database stand for "another instance" and "after a restart".
 */
describe.skipIf(!TEST_DATABASE_URL)('persistent per-route limits against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  const instances: { app: FastifyInstance; close: () => Promise<void> }[] = [];
  let connection: { db: Database; close: () => Promise<void> };

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '2' });
    for (let i = 0; i < 2; i += 1) {
      const production = createProductionDependencies(env);
      instances.push({ app: await buildApp(production.dependencies), close: production.close });
    }
    connection = createDatabase(database.url);
  });

  afterAll(async () => {
    for (const instance of instances) {
      await instance.app.close();
      await instance.close();
    }
    await connection?.close();
    await database?.drop();
  });

  const login = (index: number) =>
    instances[index]!.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ninguem@example.test', password: 'Senha-Errada-123!' } });

  it('counts login attempts across instances and answers 429 with Retry-After on the other one', async () => {
    expect((await login(0)).statusCode).toBe(401);
    expect((await login(0)).statusCode).toBe(401);

    const limited = await login(1);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps each route in its own counter: register is not limited by failed logins', async () => {
    const register = await instances[1]!.app.inject({ method: 'POST', url: '/auth/register', payload: makeRegistration() });
    expect(register.statusCode).toBe(201);
  });

  it('stores only a keyed hash of the client address, under http: scopes', async () => {
    const [rows] = (await connection.db.execute(sql`SELECT scope, subject_hash AS subjectHash, hits FROM rate_limit_counters WHERE scope LIKE 'http:%'`)) as unknown as [
      { scope: string; subjectHash: string; hits: number }[],
    ];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row.scope)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.scope.length).toBeLessThanOrEqual(32);
      expect(row.subjectHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.subjectHash).not.toContain('127.0.0.1');
    }
    expect(rows.some((row) => row.hits === 3)).toBe(true);
  });
});
