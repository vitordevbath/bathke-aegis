import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { IncidentResponse, IncidentTimelineResponse, InvestigationResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { MIGRATIONS_FOLDER } from '../../src/infrastructure/db/migrations.js';
import { loadEnv } from '../../src/shared/env.js';
import { testJwtSecret } from '../support/fixtures.js';
import { bearer, signedInUser } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const CONCLUSION = 'Reinício planejado pela equipe de infraestrutura, confirmado no registro de mudanças.';

/** ADR-054 against MySQL: migration 0013 (table, FKs, backfill), ordering and delete behavior. */
describe.skipIf(!TEST_DATABASE_URL)('incident activity log against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let production: ReturnType<typeof createProductionDependencies>;
  let connection: { db: Database; close: () => Promise<void> };
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    production = createProductionDependencies(loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000' }));
    connection = createDatabase(database.url);
    app = await buildApp(production.dependencies);
  });

  afterAll(async () => {
    await app?.close();
    await production?.close();
    await connection?.close();
    await database?.drop();
  });

  const rows = async (query: ReturnType<typeof sql>) => ((await connection.db.execute(query)) as unknown as [Record<string, unknown>[]])[0];

  async function scenario() {
    const { token, session } = await signedInUser(app);
    const base = `/workspaces/${session.workspaces[0]?.id}`;
    const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
    const host = (await call('POST', `${base}/hosts`, { displayName: 'srv-web-01' })).json<{ id: string }>();
    const incident = (await call('POST', `${base}/incidents`, { title: 'Reinício', severity: 'LOW', hostIds: [host.id], detectionRuleIds: [] })).json<IncidentResponse>();
    return { base, call, incident };
  }

  it('orders entries of one change logically, keeps the title after an investigation is deleted and cascades with the incident', async () => {
    const { base, call, incident } = await scenario();
    const update = await call('PUT', `${base}/incidents/${incident.id}`, {
      title: 'Reinício do web',
      severity: 'HIGH',
      hostIds: incident.hosts.map((item) => item.hostId),
      detectionRuleIds: [],
      status: 'INVESTIGATING',
    });
    expect(update.statusCode).toBe(200);
    const investigation = (await call('POST', `${base}/investigations`, { title: 'Reinícios', incidentIds: [incident.id] })).json<InvestigationResponse>();
    expect((await call('DELETE', `${base}/investigations/${investigation.id}`)).statusCode).toBe(204);

    const timeline = (await call('GET', `${base}/incidents/${incident.id}/timeline`)).json<IncidentTimelineResponse>();
    expect(timeline.activities.map((entry) => entry.kind)).toEqual([
      'OPENED',
      'STATUS_CHANGED',
      'SEVERITY_CHANGED',
      'DETAILS_UPDATED',
      'INVESTIGATION_LINKED',
      'INVESTIGATION_UNLINKED',
    ]);
    expect(timeline.activities.slice(-2).map((entry) => entry.investigation)).toEqual([
      { id: null, title: 'Reinícios' },
      { id: null, title: 'Reinícios' },
    ]);

    expect((await call('DELETE', `${base}/incidents/${incident.id}`)).statusCode).toBe(204);
    expect(await rows(sql`SELECT id FROM incident_activities WHERE incident_id = ${incident.id}`)).toEqual([]);
  });

  it('backfills the opening, the links and the closing of rows that predate the log', async () => {
    const { base, call, incident } = await scenario();
    const created = (await call('POST', `${base}/investigations`, { title: 'Caso antigo', incidentIds: [incident.id] })).json<InvestigationResponse>();
    const url = `${base}/investigations/${created.id}`;
    const body = { title: 'Caso antigo', description: null, conclusion: CONCLUSION, incidentIds: [incident.id] };
    await call('PUT', url, { ...body, status: 'IN_PROGRESS' });
    expect((await call('PUT', url, { ...body, status: 'CLOSED' })).statusCode).toBe(200);

    // Simulate a database from before migration 0013, then run its backfill statements.
    await connection.db.execute(sql`DELETE FROM incident_activities`);
    const migration = readFileSync(`${MIGRATIONS_FOLDER}/0013_incident_activities.sql`, 'utf8');
    const backfill = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('INSERT'));
    expect(backfill).toHaveLength(3);
    for (const statement of backfill) await connection.db.execute(sql.raw(statement));

    const timeline = (await call('GET', `${base}/incidents/${incident.id}/timeline`)).json<IncidentTimelineResponse>();
    expect(timeline.activities.map((entry) => [entry.kind, entry.actor.kind, entry.investigation?.title ?? null])).toEqual([
      ['OPENED', 'HISTORY_BACKFILL', null],
      ['INVESTIGATION_LINKED', 'HISTORY_BACKFILL', 'Caso antigo'],
      ['INVESTIGATION_CLOSED', 'HISTORY_BACKFILL', 'Caso antigo'],
    ]);
    expect(timeline.activities[0]?.createdAt).toBe(timeline.incident.createdAt);
  });
});
