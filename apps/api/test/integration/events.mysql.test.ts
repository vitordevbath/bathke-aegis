import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ConflictError } from '@aegis/domain';
import type { EventResponse, EventSummary, LoginResponse, PaginatedResponse } from '@aegis/contracts';
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

const recent = () => new Date(Date.now() - 60_000).toISOString();
const processStarted = (sourceEventId = randomUUID(), user = 'www-data') => ({
  schemaVersion: 1,
  sourceEventId,
  occurredAt: recent(),
  category: 'PROCESS',
  type: 'PROCESS_STARTED',
  data: { process: { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user } },
});

describe.skipIf(!TEST_DATABASE_URL)('events against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000', INGEST_RATE_LIMIT_MAX: '1000' });
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

  const rows = async (hostId: string) => {
    const [result] = (await connection.db.execute(
      sql`SELECT source_event_id AS sourceEventId, fingerprint, JSON_EXTRACT(payload, '$.process.user') AS user FROM events WHERE host_id = ${hostId}`,
    )) as unknown as [{ sourceEventId: string; fingerprint: string; user: string }[]];
    return result;
  };

  async function tenant() {
    const registration = makeRegistration();
    await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    const session = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })).json<LoginResponse>();
    const workspaceId = session.workspaces[0]?.id ?? '';
    const headers = bearer(session.token);
    const base = `/workspaces/${workspaceId}`;
    const host = Host.register({ workspaceId, displayName: 'servidor-web-01' });
    await repositories.hosts.insert(host);
    return {
      workspaceId,
      headers,
      base,
      host,
      ingest: (events: unknown[], hostId = host.id) => app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/events/ingest`, headers, payload: { events } }),
    };
  }

  it('creates the events table with its keys from zero', async () => {
    const [constraints] = (await connection.db.execute(sql`
      SELECT REFERENCED_TABLE_NAME AS referenced, DELETE_RULE AS onDelete FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'events' ORDER BY REFERENCED_TABLE_NAME`)) as unknown as [{ referenced: string; onDelete: string }[]];
    expect(constraints).toEqual([
      { referenced: 'hosts', onDelete: 'RESTRICT' },
      { referenced: 'workspaces', onDelete: 'CASCADE' },
    ]);
    const [indexes] = (await connection.db.execute(sql`
      SELECT DISTINCT INDEX_NAME AS name, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' ORDER BY INDEX_NAME`)) as unknown as [{ name: string; nonUnique: number }[]];
    expect(indexes.map((index) => `${index.name}:${Number(index.nonUnique)}`).sort()).toEqual([
      'PRIMARY:0',
      'events_host_source_unique:0',
      'events_workspace_category_occurred_idx:1',
      'events_workspace_host_occurred_idx:1',
      'events_workspace_occurred_idx:1',
    ]);
  });

  it('is idempotent: a replayed event stays one row; a conflicting reuse is a 409 and leaves the row untouched', async () => {
    const t = await tenant();
    const event = processStarted();
    expect((await t.ingest([event])).json()).toEqual({ received: 1, inserted: 1, deduplicated: 0 });
    expect((await t.ingest([event])).json()).toEqual({ received: 1, inserted: 0, deduplicated: 1 });
    const [original] = await rows(t.host.id);
    expect(await rows(t.host.id)).toHaveLength(1);

    const conflict = await t.ingest([processStarted(), processStarted(event.sourceEventId, 'root')]);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe('EVENT_ID_CONFLICT');
    expect(await rows(t.host.id)).toEqual([original]);
    expect(original?.user).toBe('www-data');
  });

  it('stores only the validated payload and reads it back with the host name (no N+1)', async () => {
    const t = await tenant();
    const event = processStarted();
    await t.ingest([event]);
    const [stored] = (await connection.db.execute(sql`SELECT payload FROM events WHERE host_id = ${t.host.id}`)) as unknown as [{ payload: unknown }[]];
    expect(stored[0]?.payload).toEqual(event.data);

    const list = (await app.inject({ method: 'GET', url: `${t.base}/events`, headers: t.headers })).json<PaginatedResponse<EventSummary>>();
    expect(list.items).toEqual([expect.objectContaining({ hostDisplayName: 'servidor-web-01', summary: 'bash (pid 4242)', type: 'PROCESS_STARTED' })]);
    const detail = (await app.inject({ method: 'GET', url: `${t.base}/events/${list.items[0]?.id}`, headers: t.headers })).json<EventResponse>();
    expect(detail).toMatchObject({ sourceEventId: event.sourceEventId, data: event.data });
  });

  it('serializes concurrent batches for the same host (host row lock): no duplicate, no deadlock', async () => {
    const t = await tenant();
    const batch = Array.from({ length: 20 }, () => processStarted());
    const results = await Promise.all([t.ingest(batch), t.ingest(batch), t.ingest(batch)]);
    expect(results.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    const inserted = results.map((response) => response.json<{ inserted: number }>().inserted).sort((a, b) => b - a);
    expect(inserted).toEqual([20, 0, 0]);
    expect(await rows(t.host.id)).toHaveLength(20);
  });

  it('rolls back an invalid batch completely', async () => {
    const t = await tenant();
    const response = await t.ingest([processStarted(), { ...processStarted(), data: { process: { pid: 1, name: 'x', executable: '/x', argv: ['--token', 'x'] } } }]);
    expect(response.statusCode).toBe(400);
    expect(await rows(t.host.id)).toEqual([]);
  });

  it('protects a host with telemetry at the database level too (RESTRICT → 409)', async () => {
    const t = await tenant();
    await t.ingest([processStarted()]);
    await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, t.host.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, t.host.id)).rejects.toThrow(/telemetria armazenada/);
    expect((await app.inject({ method: 'DELETE', url: `${t.base}/hosts/${t.host.id}`, headers: t.headers })).statusCode).toBe(409);
  });

  it('keeps hosts and events workspace-isolated', async () => {
    const a = await tenant();
    const b = await tenant();
    await b.ingest([processStarted()]);
    const eventB = (await app.inject({ method: 'GET', url: `${b.base}/events`, headers: b.headers })).json<PaginatedResponse<EventSummary>>().items[0];
    const statuses = await Promise.all([
      a.ingest([processStarted()], b.host.id),
      app.inject({ method: 'GET', url: `${a.base}/events/${eventB?.id}`, headers: a.headers }),
      app.inject({ method: 'GET', url: `${b.base}/events`, headers: a.headers }),
      app.inject({ method: 'DELETE', url: `${a.base}/hosts/${b.host.id}`, headers: a.headers }),
    ]);
    expect(statuses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
    expect(await rows(b.host.id)).toHaveLength(1);
  });
});
