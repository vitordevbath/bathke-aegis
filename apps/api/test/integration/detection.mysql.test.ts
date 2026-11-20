import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AlertResponse, PaginatedResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { testJwtSecret } from '../support/fixtures.js';
import { bearer, pairHost, signedInUser } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const sshd = () => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  category: 'SYSTEM',
  type: 'SYSTEM_SERVICE_STATE_CHANGED',
  data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'sshd', state: 'FAILED' } },
});

/** ADR-053 against MySQL: migration 0012, the transactional engine, correlation and FK behavior. */
describe.skipIf(!TEST_DATABASE_URL)('detection engine against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let production: ReturnType<typeof createProductionDependencies>;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    production = createProductionDependencies(
      loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000', PAIR_RATE_LIMIT_MAX: '1000', PAIR_CODES_PER_HOST_PER_HOUR: '1000' }),
    );
    app = await buildApp(production.dependencies);
  });

  afterAll(async () => {
    await app?.close();
    await production?.close();
    await database?.drop();
  });

  it('stores events, alerts and the correlated incident together, and keeps alerts when the incident is deleted', async () => {
    const { token, session } = await signedInUser(app);
    const base = `/workspaces/${session.workspaces[0]?.id}`;
    const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
    const host = (await call('POST', `${base}/hosts`, { displayName: 'srv-db-01' })).json<{ id: string }>();
    const rule = (
      await call('POST', `${base}/detection-rules`, {
        name: 'sshd falhou',
        severity: 'CRITICAL',
        enabled: true,
        eventCategory: 'SYSTEM',
        scope: 'SELECTED_HOSTS',
        hostIds: [host.id],
        definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.serviceName', operator: 'EQUALS', value: 'sshd' }] },
      })
    ).json<{ id: string }>();
    const { token: machine } = await pairHost(app, token, session.workspaces[0]?.id ?? '', host.id);
    const ingest = (events: unknown[]) => app.inject({ method: 'POST', url: `${base}/hosts/${host.id}/events/ingest`, headers: bearer(machine), payload: { events } });

    // Concurrent batches of one host serialize on the host lock: still a single incident.
    const responses = await Promise.all([ingest([sshd()]), ingest([sshd(), sshd()]), ingest([sshd()])]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    const alerts = (await call('GET', `${base}/alerts`)).json<PaginatedResponse<AlertResponse>>();
    expect(alerts.pagination.total).toBe(4);
    expect(new Set(alerts.items.map((alert) => alert.incident?.id)).size).toBe(1);
    expect(alerts.items.every((alert) => alert.severity === 'CRITICAL')).toBe(true);

    const incidentId = alerts.items[0]?.incident?.id ?? '';
    expect((await call('DELETE', `${base}/incidents/${incidentId}`)).statusCode).toBe(204);
    const kept = (await call('GET', `${base}/alerts`)).json<PaginatedResponse<AlertResponse>>();
    expect(kept.pagination.total).toBe(4);
    expect(kept.items.every((alert) => alert.incident === null)).toBe(true);
    expect((await call('DELETE', `${base}/detection-rules/${rule.id}`)).statusCode).toBe(409);
  });
});
