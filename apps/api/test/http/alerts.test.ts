import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AlertResponse, HostResponse, IncidentResponse, PaginatedResponse } from '@aegis/contracts';
import { CORRELATION_WINDOW_MS } from '@aegis/domain';
import { EventIngestionService } from '../../src/application/event-ingestion-service.js';
import { bearer, buildTestApp, pairHost, signedInUser } from '../support/test-app.js';
import type { createInMemoryPersistence } from '../support/in-memory-persistence.js';

let app: FastifyInstance;
let persistence: ReturnType<typeof createInMemoryPersistence>;

beforeAll(async () => {
  const built = await buildTestApp();
  app = built.app;
  persistence = built.persistence;
});
afterAll(() => app.close());

const service = (serviceName: string, occurredAt = new Date().toISOString()) => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt,
  category: 'SYSTEM',
  type: 'SYSTEM_SERVICE_STATE_CHANGED',
  data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName, state: 'STOPPED' } },
});
const boot = () => ({ schemaVersion: 1, sourceEventId: randomUUID(), occurredAt: new Date().toISOString(), category: 'SYSTEM', type: 'SYSTEM_BOOT', data: { system: { eventType: 'BOOT' } } });

const sshdRule = (overrides: Record<string, unknown> = {}) => ({
  name: 'sshd mudou de estado',
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'SYSTEM',
  scope: 'ALL_HOSTS',
  hostIds: [],
  definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.serviceName', operator: 'EQUALS', value: 'sshd' }] },
  ...overrides,
});

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
  const tokens = new Map<string, string>();
  const host = async (displayName = `host-${Math.random().toString(36).slice(2, 8)}`) => (await call('POST', `${base}/hosts`, { displayName })).json<HostResponse>();
  const ingest = async (hostId: string, events: unknown[]) => {
    const machine = tokens.get(hostId) ?? (await pairHost(app, token, workspaceId, hostId)).token;
    tokens.set(hostId, machine);
    const response = await app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/events/ingest`, headers: bearer(machine), payload: { events } });
    expect(response.statusCode).toBe(200);
    return response.json<Record<string, number>>();
  };
  const rule = async (overrides: Record<string, unknown> = {}) => (await call('POST', `${base}/detection-rules`, sshdRule(overrides))).json<{ id: string }>();
  const alerts = async (query = '') => (await call('GET', `${base}/alerts${query}`)).json<PaginatedResponse<AlertResponse>>();
  return { workspaceId, base, call, host, ingest, rule, alerts };
}

describe('detection engine through ingestion (ADR-053)', () => {
  it('raises an alert and opens a DETECTION_ENGINE incident for a matching event, without changing the ingest response', async () => {
    const a = await tenant();
    const host = await a.host('srv-web-01');
    await a.rule();

    expect(await a.ingest(host.id, [service('sshd'), service('cron')])).toEqual({ received: 2, inserted: 2, deduplicated: 0 });
    const { items } = await a.alerts();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ severity: 'HIGH', rule: { name: 'sshd mudou de estado' }, host: { id: host.id, displayName: 'srv-web-01' }, event: { type: 'SYSTEM_SERVICE_STATE_CHANGED' } });
    expect(items[0]?.event.summary).toContain('sshd');

    const incident = (await a.call('GET', `${a.base}/incidents/${items[0]?.incident?.id}`)).json<IncidentResponse>();
    expect(incident).toMatchObject({ origin: 'DETECTION_ENGINE', status: 'OPEN', severity: 'HIGH', title: 'sshd mudou de estado em srv-web-01' });
    expect(incident.hosts.map((item) => item.hostId)).toEqual([host.id]);
  });

  it('correlates matches of the same rule on the same host into one open incident', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.rule();
    await a.ingest(host.id, [service('sshd'), service('sshd')]);
    await a.ingest(host.id, [service('sshd')]);

    const { items } = await a.alerts();
    expect(items).toHaveLength(3);
    expect(new Set(items.map((alert) => alert.incident?.id)).size).toBe(1);
    const incidentId = items[0]?.incident?.id ?? '';
    expect((await a.alerts(`?incidentId=${incidentId}`)).pagination.total).toBe(3);
  });

  it('opens a new incident once the previous one is resolved', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.rule();
    await a.ingest(host.id, [service('sshd')]);
    const first = (await a.alerts()).items[0]?.incident?.id ?? '';
    const incident = (await a.call('GET', `${a.base}/incidents/${first}`)).json<IncidentResponse>();
    const resolve = await a.call('PUT', `${a.base}/incidents/${first}`, {
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      hostIds: incident.hosts.map((item) => item.hostId),
      detectionRuleIds: incident.detectionRules.map((item) => item.ruleId),
      status: 'RESOLVED',
    });
    expect(resolve.statusCode).toBe(200);

    await a.ingest(host.id, [service('sshd')]);
    const incidents = new Set((await a.alerts()).items.map((alert) => alert.incident?.id));
    expect(incidents.size).toBe(2);
  });

  it('separates hosts: the same rule on two hosts opens two incidents', async () => {
    const a = await tenant();
    const [web, db] = [await a.host(), await a.host()];
    await a.rule();
    await a.ingest(web.id, [service('sshd')]);
    await a.ingest(db.id, [service('sshd')]);
    expect(new Set((await a.alerts()).items.map((alert) => alert.incident?.id)).size).toBe(2);
  });

  it('ignores disabled rules, other categories, non-matching events and hosts outside the scope', async () => {
    const a = await tenant();
    const [target, other] = [await a.host(), await a.host()];
    await a.rule({ enabled: false });
    await a.rule({ name: 'Só no alvo', scope: 'SELECTED_HOSTS', hostIds: [target.id] });
    await a.ingest(other.id, [service('sshd'), boot()]);
    expect((await a.alerts()).pagination.total).toBe(0);
    await a.ingest(target.id, [service('nginx'), boot(), service('sshd')]);
    const { items } = await a.alerts();
    expect(items.map((alert) => [alert.rule.name, alert.host.id])).toEqual([['Só no alvo', target.id]]);
  });

  it('raises nothing new when the same batch is replayed', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.rule();
    const batch = [service('sshd')];
    await a.ingest(host.id, batch);
    expect(await a.ingest(host.id, batch)).toEqual({ received: 1, inserted: 0, deduplicated: 1 });
    expect((await a.alerts()).pagination.total).toBe(1);
  });
});

describe('alerts API', () => {
  it('lets members read and hides alerts of other workspaces (404, like a missing alert)', async () => {
    const a = await tenant();
    const b = await tenant();
    const host = await a.host();
    await a.rule();
    await a.ingest(host.id, [service('sshd')]);
    const alertId = (await a.alerts()).items[0]?.id ?? '';

    expect((await a.call('GET', `${a.base}/alerts/${alertId}`)).json<AlertResponse>().id).toBe(alertId);
    expect((await b.call('GET', `${b.base}/alerts/${alertId}`)).statusCode).toBe(404);
    expect((await b.call('GET', `${a.base}/alerts`)).statusCode).toBe(404);
    expect((await a.call('GET', `${a.base}/alerts/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('has no write routes: alerts only come from the engine', async () => {
    const a = await tenant();
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      expect((await a.call(method, `${a.base}/alerts`, {})).statusCode).toBe(404);
    }
  });

  it('validates filters', async () => {
    const a = await tenant();
    expect((await a.call('GET', `${a.base}/alerts?severity=URGENT`)).statusCode).toBe(400);
    expect((await a.call('GET', `${a.base}/alerts?ruleId=not-a-uuid`)).statusCode).toBe(400);
  });

  it('keeps alerts when their incident is deleted, and then refuses to delete the rule (409)', async () => {
    const a = await tenant();
    const host = await a.host();
    const rule = await a.rule();
    await a.ingest(host.id, [service('sshd')]);
    const incidentId = (await a.alerts()).items[0]?.incident?.id ?? '';
    expect((await a.call('DELETE', `${a.base}/incidents/${incidentId}`)).statusCode).toBe(204);

    const after = (await a.alerts()).items;
    expect(after).toHaveLength(1);
    expect(after[0]?.incident).toBeNull();
    const refused = await a.call('DELETE', `${a.base}/detection-rules/${rule.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toContain('alertas');
  });
});

describe('correlation window', () => {
  it('opens a new incident when the last alert of the rule on that host is older than the window', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.rule();
    const start = new Date();
    let now = start;
    const ingestion = new EventIngestionService(persistence.unitOfWork, () => now);
    const origin = { workspaceId: a.workspaceId, hostId: host.id };

    await ingestion.ingest(origin, [service('sshd', start.toISOString())]);
    now = new Date(start.getTime() + CORRELATION_WINDOW_MS - 60_000);
    await ingestion.ingest(origin, [service('sshd', now.toISOString())]);
    now = new Date(now.getTime() + CORRELATION_WINDOW_MS + 60_000);
    await ingestion.ingest(origin, [service('sshd', now.toISOString())]);

    const incidents = (await a.alerts()).items.map((alert) => alert.incident?.id);
    expect(incidents).toHaveLength(3);
    expect(new Set(incidents).size).toBe(2);
  });
});
