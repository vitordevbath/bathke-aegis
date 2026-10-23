import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, EventResponse, EventSummary, HostResponse, IngestEventsResponse, PaginatedResponse } from '@aegis/contracts';
import { bearer, buildTestApp, signedInUser } from '../support/test-app.js';
import type { InMemoryStore } from '../support/in-memory-persistence.js';

let app: FastifyInstance;
let store: InMemoryStore;

beforeAll(async () => {
  const built = await buildTestApp();
  app = built.app;
  store = built.persistence.store;
});
afterAll(() => app.close());

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } };

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Raw events as a source would send them. */
const processStarted = (overrides: Record<string, unknown> = {}, process: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: minutesAgo(10),
  category: 'PROCESS',
  type: 'PROCESS_STARTED',
  data: { process: { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user: 'www-data', ...process } },
  ...overrides,
});
const networkConnection = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: minutesAgo(9),
  category: 'NETWORK',
  type: 'NETWORK_CONNECTION',
  data: { network: { protocol: 'TCP', localAddress: '10.0.0.5', localPort: 51234, remoteAddress: '203.0.113.10', remotePort: 443, pid: 4242, processName: 'curl' } },
  ...overrides,
});
const serviceChanged = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: minutesAgo(8),
  category: 'SYSTEM',
  type: 'SYSTEM_SERVICE_STATE_CHANGED',
  data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'RUNNING' } },
  ...overrides,
});

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
  const host = async (displayName = `host-${Math.random().toString(36).slice(2, 8)}`) => (await call('POST', `${base}/hosts`, { displayName })).json<HostResponse>();
  return {
    workspaceId,
    base,
    events: `${base}/events`,
    call,
    host,
    ingest: (hostId: string, events: unknown, url = `${base}/hosts/${hostId}/events/ingest`) => call('POST', url, { events }),
    list: (query = '', url = `${base}/events`) => call('GET', `${url}${query}`),
  };
}

const issuesOf = (body: ApiErrorResponse) => body.error.issues ?? [];

describe('events: authentication and immutability', () => {
  it.each([
    ['POST', (hostId: string) => `/hosts/${hostId}/events/ingest`],
    ['GET', () => '/events'],
    ['GET', () => `/events/${MISSING_ID}`],
  ] as const)('%s requires a token', async (method, path) => {
    const a = await tenant();
    const response = await app.inject({ method, url: `${a.base}${path(MISSING_ID)}`, payload: method === 'POST' ? { events: [processStarted()] } : undefined });
    expect(response.statusCode).toBe(401);
  });

  it('has no create, update or delete route for individual events', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.ingest(host.id, [processStarted()]);
    const [stored] = (await a.list()).json<PaginatedResponse<EventSummary>>().items;
    for (const [method, url] of [
      ['PUT', `${a.events}/${stored?.id}`],
      ['DELETE', `${a.events}/${stored?.id}`],
      ['POST', a.events],
    ] as const) {
      expect((await a.call(method, url, method === 'DELETE' ? undefined : processStarted())).statusCode).toBe(404);
    }
    expect((await a.call('GET', `${a.events}/${stored?.id}`)).statusCode).toBe(200);
  });
});

describe('events: ingestion', () => {
  it('stores one event and returns counts only (200)', async () => {
    const a = await tenant();
    const host = await a.host();
    const response = await a.ingest(host.id, [processStarted()]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: 1, inserted: 1, deduplicated: 0 } satisfies IngestEventsResponse);
  });

  it('stores a batch of every category and serves the normalized event, never the raw request', async () => {
    const a = await tenant();
    const host = await a.host('servidor-web-01');
    const exited = processStarted({ type: 'PROCESS_EXITED', occurredAt: minutesAgo(7) }, { parentPid: undefined, parentName: undefined, user: undefined });
    const listen = networkConnection({ type: 'NETWORK_LISTEN', occurredAt: minutesAgo(6), data: { network: { protocol: 'UDP', localPort: 53 } } });
    const boot = serviceChanged({ type: 'SYSTEM_BOOT', occurredAt: minutesAgo(30), data: { system: { eventType: 'BOOT' } } });
    const batch = [processStarted(), exited, networkConnection(), listen, serviceChanged(), boot];
    expect((await a.ingest(host.id, batch)).json()).toEqual({ received: 6, inserted: 6, deduplicated: 0 });

    const list = (await a.list()).json<PaginatedResponse<EventSummary>>();
    expect(list.items.map((item) => item.type)).toEqual([
      'NETWORK_LISTEN',
      'PROCESS_EXITED',
      'SYSTEM_SERVICE_STATE_CHANGED',
      'NETWORK_CONNECTION',
      'PROCESS_STARTED',
      'SYSTEM_BOOT',
    ]);
    expect(Object.keys(list.items[0] ?? {}).sort()).toEqual(['category', 'hostDisplayName', 'hostId', 'id', 'ingestedAt', 'occurredAt', 'summary', 'type', 'workspaceId']);
    expect(list.items.find((item) => item.type === 'NETWORK_CONNECTION')?.summary).toBe('TCP 10.0.0.5:51234 → 203.0.113.10:443');
    expect(list.items.every((item) => item.hostDisplayName === 'servidor-web-01')).toBe(true);

    const exitedItem = list.items.find((item) => item.type === 'PROCESS_EXITED');
    const detail = (await a.call('GET', `${a.events}/${exitedItem?.id}`)).json<EventResponse>();
    expect(detail).toMatchObject({
      hostId: host.id,
      hostDisplayName: 'servidor-web-01',
      schemaVersion: 1,
      sourceEventId: exited.sourceEventId,
      category: 'PROCESS',
      type: 'PROCESS_EXITED',
      data: { process: { pid: 4242, parentPid: null, name: 'bash', executable: '/usr/bin/bash', parentName: null, user: null } },
    });
    expect(detail).not.toHaveProperty('fingerprint');
  });

  it('rejects the whole batch (400) when one event is invalid, storing nothing', async () => {
    const a = await tenant();
    const host = await a.host();
    const before = store.events.size;
    const response = await a.ingest(host.id, [
      processStarted(),
      processStarted({}, { commandLine: 'curl -H "Authorization: Bearer x"' }),
      networkConnection({ schemaVersion: 2 }),
      { ...serviceChanged(), password: 'segredo' },
    ]);
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual([
      'events.1.data.process.commandLine',
      'events.2.schemaVersion',
      'events.3.password',
    ]);
    expect(store.events.size).toBe(before);
  });

  it.each([
    ['empty batch', []],
    ['101 events', Array.from({ length: 101 }, () => processStarted())],
    ['not a list', processStarted()],
  ])('400 for %s', async (_case, events) => {
    const a = await tenant();
    const host = await a.host();
    const response = await a.ingest(host.id, events);
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['events']);
  });

  it('accepts 100 events in one batch and refuses bodies over 1 MiB (413)', async () => {
    const a = await tenant();
    const host = await a.host();
    expect((await a.ingest(host.id, Array.from({ length: 100 }, () => processStarted()))).json<IngestEventsResponse>().inserted).toBe(100);
    const huge = await app.inject({
      method: 'POST',
      url: `${a.base}/hosts/${host.id}/events/ingest`,
      headers: { ...bearer((await signedInUser(app)).token), 'content-type': 'application/json' },
      payload: JSON.stringify({ events: [processStarted()], padding: 'x'.repeat(1024 * 1024) }),
    });
    expect(huge.statusCode).toBe(413);
  });

  it('refuses events dated beyond the 5-minute clock skew but keeps old ones from offline queues', async () => {
    const a = await tenant();
    const host = await a.host();
    const future = await a.ingest(host.id, [processStarted({ occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() })]);
    expect(issuesOf(future.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['events.0.occurredAt']);
    expect((await a.ingest(host.id, [processStarted({ occurredAt: '2025-01-01T00:00:00Z' })])).statusCode).toBe(200);
  });

  it('never runs rules, raises alerts, creates incidents or marks the host online', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.call('POST', `${a.base}/detection-rules`, {
      name: 'Shell iniciado por servidor web',
      severity: 'HIGH',
      eventCategory: 'PROCESS',
      scope: 'ALL_HOSTS',
      definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
    });
    const incidentsBefore = store.incidents.size;
    await a.ingest(host.id, [processStarted()]);
    expect(store.incidents.size).toBe(incidentsBefore);
    expect((await a.call('GET', `${a.base}/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ connectionState: 'UNPAIRED', lastSeenAt: null });
    expect((await a.call('GET', `${a.base}/alerts`)).statusCode).toBe(404);
  });
});

describe('events: idempotency', () => {
  it('deduplicates an identical replay and stores only the new events of a mixed batch', async () => {
    const a = await tenant();
    const host = await a.host();
    const first = [processStarted(), networkConnection(), serviceChanged()];
    expect((await a.ingest(host.id, first)).json()).toEqual({ received: 3, inserted: 3, deduplicated: 0 });
    expect((await a.ingest(host.id, first)).json()).toEqual({ received: 3, inserted: 0, deduplicated: 3 });
    expect((await a.ingest(host.id, [...first, processStarted(), processStarted()])).json()).toEqual({ received: 5, inserted: 2, deduplicated: 3 });
    expect((await a.list()).json<PaginatedResponse<EventSummary>>().pagination.total).toBe(5);
  });

  it('treats a replay with a different timestamp representation of the same instant as identical', async () => {
    const a = await tenant();
    const host = await a.host();
    const event = processStarted({ occurredAt: '2026-01-10T12:00:00.000Z' });
    await a.ingest(host.id, [event]);
    const sameInstant = { ...event, occurredAt: '2026-01-10T09:00:00-03:00', sourceEventId: event.sourceEventId.toUpperCase() };
    expect((await a.ingest(host.id, [sameInstant])).json()).toEqual({ received: 1, inserted: 0, deduplicated: 1 });
  });

  it('409 EVENT_ID_CONFLICT for a reused sourceEventId with different content; the stored event and the rest of the batch are untouched', async () => {
    const a = await tenant();
    const host = await a.host();
    const original = processStarted();
    await a.ingest(host.id, [original]);
    const fresh = networkConnection();
    const response = await a.ingest(host.id, [fresh, processStarted({ sourceEventId: original.sourceEventId }, { user: 'root' })]);
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error).toMatchObject({ code: 'EVENT_ID_CONFLICT', issues: [{ field: 'events.1.sourceEventId' }] });

    const list = (await a.list()).json<PaginatedResponse<EventSummary>>();
    expect(list.pagination.total).toBe(1);
    const stored = (await a.call('GET', `${a.events}/${list.items[0]?.id}`)).json<EventResponse>();
    expect(stored.data).toEqual({ process: { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user: 'www-data' } });
  });

  it('inside one batch: identical duplicates are deduplicated, conflicting ones are a 409', async () => {
    const a = await tenant();
    const host = await a.host();
    const event = processStarted();
    expect((await a.ingest(host.id, [event, event])).json()).toEqual({ received: 2, inserted: 1, deduplicated: 1 });
    const other = processStarted();
    const conflict = await a.ingest(host.id, [other, processStarted({ sourceEventId: other.sourceEventId }, { pid: 1 })]);
    expect(conflict.statusCode).toBe(409);
    expect((await a.list()).json<PaginatedResponse<EventSummary>>().pagination.total).toBe(1);
  });

  it('the same sourceEventId on different hosts is two distinct events', async () => {
    const a = await tenant();
    const [h1, h2] = [await a.host(), await a.host()];
    const event = processStarted();
    await a.ingest(h1.id, [event]);
    expect((await a.ingest(h2.id, [event])).json()).toEqual({ received: 1, inserted: 1, deduplicated: 0 });
  });
});

describe('events: list, filters and detail', () => {
  it('paginates 25 events as 10 + 10 + 5, newest occurrence first', async () => {
    const a = await tenant();
    const host = await a.host();
    await a.ingest(host.id, Array.from({ length: 25 }, (_, i) => processStarted({ occurredAt: minutesAgo(100 - Math.floor(i / 3)) })));
    const pages = await Promise.all([1, 2, 3].map(async (page) => (await a.list(`?page=${page}&pageSize=10`)).json<PaginatedResponse<EventSummary>>()));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    expect(pages[0]?.pagination).toEqual({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    const listed = pages.flatMap((page) => page.items);
    const sorted = [...listed].sort((x, y) => y.occurredAt.localeCompare(x.occurredAt) || (x.id < y.id ? 1 : -1));
    expect(listed.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
    expect(new Set(listed.map((item) => item.id)).size).toBe(25);
  });

  it('filters by host, category, type and an inclusive time range', async () => {
    const a = await tenant();
    const [web, db] = [await a.host('web'), await a.host('db')];
    await a.ingest(web.id, [processStarted({ occurredAt: '2026-01-10T10:00:00Z' }), networkConnection({ occurredAt: '2026-01-10T11:00:00Z' })]);
    await a.ingest(db.id, [serviceChanged({ occurredAt: '2026-01-10T12:00:00Z' }), networkConnection({ type: 'NETWORK_LISTEN', occurredAt: '2026-01-10T13:00:00Z', data: { network: { protocol: 'TCP', localPort: 3306 } } })]);
    const total = async (query: string) => (await a.list(query)).json<PaginatedResponse<EventSummary>>().pagination.total;

    expect(await total(`?hostId=${db.id}`)).toBe(2);
    expect(await total('?category=NETWORK')).toBe(2);
    expect(await total('?eventType=NETWORK_LISTEN')).toBe(1);
    expect(await total(`?hostId=${web.id}&category=NETWORK`)).toBe(1);
    expect(await total('?from=2026-01-10T11:00:00Z&to=2026-01-10T12:00:00Z')).toBe(2);
    expect(await total('?from=2026-01-10T09:30:00-03:00')).toBe(1);
    expect(await total(`?hostId=${MISSING_ID}`)).toBe(0);
    for (const query of ['?category=FILE', '?eventType=ALERT', '?from=ontem', '?from=2026-01-11T00:00:00Z&to=2026-01-10T00:00:00Z', '?category=PROCESS&eventType=NETWORK_LISTEN', '?hostId=abc']) {
      expect((await a.list(query)).statusCode).toBe(400);
    }
  });

  it('404 for a missing or malformed event', async () => {
    const a = await tenant();
    for (const id of [MISSING_ID, 'nao-e-uuid']) expect((await a.call('GET', `${a.events}/${id}`)).json()).toEqual(NOT_FOUND);
  });
});

describe('events: host protection', () => {
  it('a host with events cannot be deleted (409); a host without events still can', async () => {
    const a = await tenant();
    const [withEvents, empty] = [await a.host(), await a.host()];
    await a.ingest(withEvents.id, [processStarted()]);
    const refused = await a.call('DELETE', `${a.base}/hosts/${withEvents.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ApiErrorResponse>().error.message).toBe('Este host tem telemetria armazenada e não pode ser excluído; os eventos são históricos e imutáveis.');
    expect((await a.call('DELETE', `${a.base}/hosts/${empty.id}`)).statusCode).toBe(204);
  });
});

describe('events: multi-tenant isolation (A vs B)', () => {
  it('A cannot ingest into B hosts, list B events or read them — and learns nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, hostB] = [await a.host('host-a'), await b.host('host-b')];
    await a.ingest(hostA.id, [processStarted()]);
    await b.ingest(hostB.id, [processStarted({}, { name: 'segredo-de-b' })]);
    const eventB = (await b.list()).json<PaginatedResponse<EventSummary>>().items[0];
    const eventsBefore = store.events.size;

    for (const response of [
      // B's workspace in the URL, A's token.
      await a.ingest(hostB.id, [processStarted()], `${b.base}/hosts/${hostB.id}/events/ingest`),
      await a.list('', b.events),
      await a.call('GET', `${b.events}/${eventB?.id}`),
      // A's workspace in the URL, B's ids: same as missing.
      await a.ingest(hostB.id, [processStarted()]),
      await a.ingest(MISSING_ID, [processStarted()]),
      await a.call('GET', `${a.events}/${eventB?.id}`),
      await a.call('DELETE', `${a.base}/hosts/${hostB.id}`),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
      expect(response.body).not.toContain('segredo-de-b');
    }
    expect(store.events.size).toBe(eventsBefore);
    expect((await a.list(`?hostId=${hostB.id}`)).json<PaginatedResponse<EventSummary>>().pagination.total).toBe(0);
    expect((await a.list()).json<PaginatedResponse<EventSummary>>().items.map((item) => item.hostId)).toEqual([hostA.id]);
  });
});
