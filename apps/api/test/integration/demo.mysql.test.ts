import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LoginResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { demoProvisioner } from '../../src/demo-runtime.js';
import { DemoSimulator } from '../../src/application/demo/demo-simulator.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

/** ADR-052 against MySQL: the INSERT … SELECT that grants demo access and the full simulated cycle. */
describe.skipIf(!TEST_DATABASE_URL)('AEGIS DEMO against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let production: ReturnType<typeof createProductionDependencies>;
  let app: FastifyInstance;

  const register = async () => {
    const registration = makeRegistration();
    expect((await app.inject({ method: 'POST', url: '/auth/register', payload: registration })).statusCode).toBe(201);
    return registration.email;
  };
  const workspacesOf = async (email: string) =>
    (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: TEST_PASSWORD } })).json<LoginResponse>().workspaces;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    production = createProductionDependencies(loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000' }));
    app = await buildApp(production.dependencies);
  });

  afterAll(async () => {
    await app?.close();
    await production?.close();
    await database?.drop();
  });

  it('grants VIEWER to existing accounts once, and to new accounts in the registration transaction', async () => {
    const earlier = await register();
    const provisioner = demoProvisioner(production.dependencies, production.adapters);
    const demo = await provisioner.ensure();
    expect(demo.created).toBe(true);
    expect(demo.viewersAdded).toBe(1);
    expect((await provisioner.ensure()).viewersAdded).toBe(0);

    expect((await workspacesOf(earlier)).map((workspace) => [workspace.kind, workspace.role])).toEqual([
      ['personal', 'OWNER'],
      ['demo', 'VIEWER'],
    ]);
    const later = await register();
    expect((await workspacesOf(later)).find((workspace) => workspace.kind === 'demo')?.id).toBe(demo.workspaceId);
  });

  it('runs a simulated cycle through the real heartbeat and ingestion paths, without duplicates', async () => {
    const demo = await demoProvisioner(production.dependencies, production.adapters).ensure();
    const now = new Date();
    const simulator = new DemoSimulator(demo, production.dependencies, () => now);
    await simulator.start();
    const first = await simulator.tick();
    expect(first.failures).toBe(0);
    expect(first.heartbeats).toBeGreaterThanOrEqual(2);
    expect(first.inserted).toBeGreaterThan(0);
    expect((await simulator.tick()).inserted).toBe(0);
  });
});
