import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { HostResponse, LoginResponse, PaginatedResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { Host } from '../../src/domain/host.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!TEST_DATABASE_URL)('hosts against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000' });
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

  async function tenant() {
    const registration = makeRegistration();
    await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    const session = (
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })
    ).json<LoginResponse>();
    const workspaceId = session.workspaces[0]?.id ?? '';
    return { workspaceId, base: `/workspaces/${workspaceId}/hosts`, headers: bearer(session.token) };
  }

  it('enforces the workspace foreign key', async () => {
    await expect(repositories.hosts.insert(Host.register({ workspaceId: MISSING_ID, displayName: 'Órfão' }))).rejects.toThrow();
  });

  it('allows many unpaired hosts (NULL agent_id) but a paired agent_id only once', async () => {
    const { workspaceId } = await tenant();
    const first = Host.register({ workspaceId, displayName: 'Um' });
    const second = Host.register({ workspaceId, displayName: 'Dois' });
    await repositories.hosts.insert(first);
    await repositories.hosts.insert(second);

    await connection.db.execute(sql`UPDATE hosts SET agent_id = ${MISSING_ID} WHERE id = ${first.id}`);
    await expect(connection.db.execute(sql`UPDATE hosts SET agent_id = ${MISSING_ID} WHERE id = ${second.id}`)).rejects.toThrow();
  });

  it('paginates in SQL with a stable createdAt DESC, id DESC order and escapes LIKE wildcards', async () => {
    const { workspaceId } = await tenant();
    const base = new Date('2026-03-01T12:00:00.000Z');
    // Some hosts share the same timestamp to exercise the id tie-breaker.
    for (let i = 0; i < 25; i += 1) {
      await repositories.hosts.insert(Host.register({ workspaceId, displayName: `Host ${i}` }, new Date(base.getTime() + Math.floor(i / 3) * 1000)));
    }
    await repositories.hosts.insert(Host.register({ workspaceId, displayName: 'Estação 100%' }, base));

    const pages = await Promise.all([1, 2, 3].map((page) => repositories.hosts.listInWorkspace(workspaceId, { page, pageSize: 10 })));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 6]);
    expect(pages.every((page) => page.total === 26)).toBe(true);

    const listed = pages.flatMap((page) => page.items.map((host) => host.toSnapshot()));
    const sorted = [...listed].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1));
    expect(listed.map((host) => host.id)).toEqual(sorted.map((host) => host.id));

    const wildcard = await repositories.hosts.listInWorkspace(workspaceId, { page: 1, pageSize: 10, search: '%' });
    expect(wildcard.items.map((host) => host.displayName)).toEqual(['Estação 100%']);
    const underscore = await repositories.hosts.listInWorkspace(workspaceId, { page: 1, pageSize: 10, search: '_' });
    expect(underscore.total).toBe(0);
  });

  it('updates administrative columns only, never collector columns', async () => {
    const { workspaceId } = await tenant();
    const host = Host.register({ workspaceId, displayName: 'Servidor' });
    await repositories.hosts.insert(host);
    await connection.db.execute(sql`UPDATE hosts SET hostname = 'srv-real', os_name = 'Fedora' WHERE id = ${host.id}`);

    const loaded = await repositories.hosts.findInWorkspace(workspaceId, host.id);
    loaded?.updateDetails({ displayName: 'Servidor renomeado', description: 'Nova' });
    if (loaded) await repositories.hosts.update(loaded);

    expect((await repositories.hosts.findInWorkspace(workspaceId, host.id))?.toSnapshot()).toMatchObject({
      displayName: 'Servidor renomeado',
      description: 'Nova',
      hostname: 'srv-real',
      osName: 'Fedora',
      connectionState: 'UNPAIRED',
    });
  });

  it('isolates workspaces over HTTP with the production wiring', async () => {
    const a = await tenant();
    const b = await tenant();
    const hostB = (await app.inject({ method: 'POST', url: b.base, headers: b.headers, payload: { displayName: 'Host B' } })).json<HostResponse>();
    const urlB = `${b.base}/${hostB.id}`;

    const statuses = await Promise.all([
      app.inject({ method: 'GET', url: urlB, headers: a.headers }),
      app.inject({ method: 'PUT', url: urlB, headers: a.headers, payload: { displayName: 'Invadido' } }),
      app.inject({ method: 'DELETE', url: urlB, headers: a.headers }),
      app.inject({ method: 'GET', url: b.base, headers: a.headers }),
      app.inject({ method: 'POST', url: b.base, headers: a.headers, payload: { displayName: 'Intruso' } }),
      app.inject({ method: 'DELETE', url: `${a.base}/${hostB.id}`, headers: a.headers }),
    ]);
    expect(statuses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404, 404]);

    const listB = (await app.inject({ method: 'GET', url: b.base, headers: b.headers })).json<PaginatedResponse<HostResponse>>();
    expect(listB.items).toEqual([expect.objectContaining({ id: hostB.id, displayName: 'Host B' })]);

    expect((await app.inject({ method: 'DELETE', url: urlB, headers: b.headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: urlB, headers: b.headers })).statusCode).toBe(404);
  });
});
