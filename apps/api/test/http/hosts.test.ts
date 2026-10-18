import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, HostResponse, PaginatedResponse } from '@aegis/contracts';
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

/** A signed-in user with their personal workspace and request helpers bound to their token. */
async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}/hosts`;
  return {
    workspaceId,
    base,
    create: (payload: object, url = base) => app.inject({ method: 'POST', url, headers: bearer(token), payload }),
    list: (query = '', url = base) => app.inject({ method: 'GET', url: `${url}${query}`, headers: bearer(token) }),
    get: (url: string) => app.inject({ method: 'GET', url, headers: bearer(token) }),
    put: (url: string, payload: object) => app.inject({ method: 'PUT', url, headers: bearer(token), payload }),
    del: (url: string) => app.inject({ method: 'DELETE', url, headers: bearer(token) }),
  };
}

const issueFields = (body: ApiErrorResponse) => body.error.issues?.map((issue) => issue.field) ?? [];

describe('hosts: authentication', () => {
  it.each([
    ['POST', ''],
    ['GET', ''],
    ['GET', `/${MISSING_ID}`],
    ['PUT', `/${MISSING_ID}`],
    ['DELETE', `/${MISSING_ID}`],
  ] as const)('%s /workspaces/:id/hosts%s requires a token', async (method, suffix) => {
    const { base } = await tenant();
    const response = await app.inject({ method, url: `${base}${suffix}`, payload: method === 'POST' || method === 'PUT' ? { displayName: 'X1' } : undefined });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /workspaces/:workspaceId/hosts', () => {
  it('201: creates an unpaired host with no telemetry in the route workspace', async () => {
    const a = await tenant();
    const response = await a.create({ displayName: '  Servidor principal ', description: 'Homologação' });

    expect(response.statusCode).toBe(201);
    const host = response.json<HostResponse>();
    expect(host).toMatchObject({
      workspaceId: a.workspaceId,
      displayName: 'Servidor principal',
      description: 'Homologação',
      agentId: null,
      hostname: null,
      osName: null,
      osVersion: null,
      architecture: null,
      connectionState: 'UNPAIRED',
      lastSeenAt: null,
    });
    expect(store.hosts.get(host.id)?.workspaceId).toBe(a.workspaceId);
  });

  it.each([
    ['missing display name', {}, ['displayName']],
    ['too short display name', { displayName: 'A' }, ['displayName']],
    ['too long display name', { displayName: 'x'.repeat(121) }, ['displayName']],
    ['too long description', { displayName: 'Servidor', description: 'x'.repeat(501) }, ['description']],
  ])('400: %s', async (_case, payload, fields) => {
    const a = await tenant();
    const response = await a.create(payload);
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(fields);
  });

  it('400: rejects system-controlled fields instead of mass-assigning them', async () => {
    const a = await tenant();
    const before = store.hosts.size;
    const response = await a.create({
      displayName: 'Servidor',
      workspaceId: MISSING_ID,
      agentId: MISSING_ID,
      hostname: 'spoofed',
      connectionState: 'ONLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
    });
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['workspaceId', 'agentId', 'hostname', 'connectionState', 'lastSeenAt']);
    expect(store.hosts.size).toBe(before);
  });
});

describe('GET /workspaces/:workspaceId/hosts (pagination and search)', () => {
  it('paginates 25 hosts as 10 + 10 + 5 with stable ordering and no overlap', async () => {
    const a = await tenant();
    for (let i = 1; i <= 25; i += 1) await a.create({ displayName: `Host ${String(i).padStart(2, '0')}` });

    const pages = await Promise.all([1, 2, 3].map(async (page) => (await a.list(`?page=${page}&pageSize=10`)).json<PaginatedResponse<HostResponse>>()));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    for (const page of pages) expect(page.pagination).toMatchObject({ pageSize: 10, total: 25, totalPages: 3 });

    const ids = pages.flatMap((page) => page.items.map((host) => host.id));
    expect(new Set(ids).size).toBe(25);
    const expected = [...ids].sort((x, y) => {
      const [hx, hy] = [store.hosts.get(x), store.hosts.get(y)];
      return (hy?.createdAt.getTime() ?? 0) - (hx?.createdAt.getTime() ?? 0) || (x < y ? 1 : -1);
    });
    expect(ids).toEqual(expected);

    // Same request twice → same page.
    const again = (await a.list('?page=2&pageSize=10')).json<PaginatedResponse<HostResponse>>();
    expect(again.items.map((host) => host.id)).toEqual(pages[1]?.items.map((host) => host.id));
  });

  it('uses page=1 and pageSize=20 by default, and answers an empty page past the end', async () => {
    const a = await tenant();
    await a.create({ displayName: 'Único host' });

    expect((await a.list()).json<PaginatedResponse<HostResponse>>().pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    const beyond = (await a.list('?page=5')).json<PaginatedResponse<HostResponse>>();
    expect(beyond.items).toEqual([]);
    expect(beyond.pagination.total).toBe(1);
  });

  it('reports totalPages 0 for an empty workspace', async () => {
    const a = await tenant();
    expect((await a.list()).json<PaginatedResponse<HostResponse>>()).toEqual({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });

  it.each([
    ['?page=0', 'page'],
    ['?page=-2', 'page'],
    ['?page=abc', 'page'],
    ['?pageSize=0', 'pageSize'],
    ['?pageSize=101', 'pageSize'],
    ['?pageSize=2.5', 'pageSize'],
  ])('400: %s', async (query, field) => {
    const a = await tenant();
    const response = await a.list(query);
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual([field]);
  });

  it('searches display name and description case-insensitively, treating wildcards literally', async () => {
    const a = await tenant();
    await a.create({ displayName: 'Servidor Web', description: 'nginx' });
    await a.create({ displayName: 'Banco', description: 'MySQL do servidor' });
    await a.create({ displayName: 'Estação 100%' });

    const names = async (q: string) =>
      (await a.list(`?q=${encodeURIComponent(q)}`)).json<PaginatedResponse<HostResponse>>().items.map((host) => host.displayName).sort();
    expect(await names('SERVIDOR')).toEqual(['Banco', 'Servidor Web']);
    expect(await names('100%')).toEqual(['Estação 100%']);
    expect(await names('%')).toEqual(['Estação 100%']);
    expect(await names('inexistente')).toEqual([]);
  });
});

describe('GET / PUT / DELETE /workspaces/:workspaceId/hosts/:hostId', () => {
  it('reads, updates the administrative fields and deletes a host', async () => {
    const a = await tenant();
    const host = (await a.create({ displayName: 'Servidor', description: 'Antiga' })).json<HostResponse>();
    const url = `${a.base}/${host.id}`;

    expect((await a.get(url)).json<HostResponse>()).toEqual(host);

    const updated = await a.put(url, { displayName: 'Servidor de banco' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<HostResponse>()).toMatchObject({ displayName: 'Servidor de banco', description: null, connectionState: 'UNPAIRED' });

    const deleted = await a.del(url);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
    expect((await a.get(url)).statusCode).toBe(404);
  });

  it('404 for a missing host on GET, PUT and DELETE', async () => {
    const a = await tenant();
    const url = `${a.base}/${MISSING_ID}`;
    for (const response of [await a.get(url), await a.put(url, { displayName: 'Servidor' }), await a.del(url)]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
  });

  it('404 (not 400) for malformed ids', async () => {
    const a = await tenant();
    expect((await a.get(`${a.base}/not-a-uuid`)).statusCode).toBe(404);
    expect((await a.list('', '/workspaces/not-a-uuid/hosts')).statusCode).toBe(404);
  });

  it('400 on PUT with a system-controlled field; nothing changes', async () => {
    const a = await tenant();
    const host = (await a.create({ displayName: 'Servidor' })).json<HostResponse>();
    const response = await a.put(`${a.base}/${host.id}`, { displayName: 'Servidor', connectionState: 'ONLINE', workspaceId: MISSING_ID });

    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['connectionState', 'workspaceId']);
    expect(store.hosts.get(host.id)).toMatchObject({ connectionState: 'UNPAIRED', workspaceId: a.workspaceId });
  });
});

describe('multi-tenant isolation (User A vs User B)', () => {
  it('A cannot see, list, create in, update or delete anything of workspace B — and learns nothing about it', async () => {
    const a = await tenant();
    const b = await tenant();
    const hostA = (await a.create({ displayName: 'Host A' })).json<HostResponse>();
    const hostB = (await b.create({ displayName: 'Host B', description: 'segredo de B' })).json<HostResponse>();
    const urlB = `${b.base}/${hostB.id}`;

    const attempts = [
      await a.get(urlB),
      await a.put(urlB, { displayName: 'Invadido' }),
      await a.del(urlB),
      await a.list('', b.base),
      await a.create({ displayName: 'Intruso' }, b.base),
      // B's host through A's own workspace id.
      await a.get(`${a.base}/${hostB.id}`),
      await a.put(`${a.base}/${hostB.id}`, { displayName: 'Invadido' }),
      await a.del(`${a.base}/${hostB.id}`),
    ];
    for (const response of attempts) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
      expect(response.body).not.toContain(hostB.id);
      expect(response.body).not.toContain(b.workspaceId);
      expect(response.body).not.toContain('Host B');
    }

    // Foreign resource answers exactly like a nonexistent one.
    expect((await a.get(urlB)).body).toBe((await a.get(`${b.base}/${MISSING_ID}`)).body);

    // B's data is intact and nothing was created in B by A.
    expect(store.hosts.get(hostB.id)).toMatchObject({ displayName: 'Host B', workspaceId: b.workspaceId });
    expect((await b.list()).json<PaginatedResponse<HostResponse>>().items.map((host) => host.id)).toEqual([hostB.id]);

    // A's own listing never includes B's host.
    expect((await a.list()).json<PaginatedResponse<HostResponse>>().items.map((host) => host.id)).toEqual([hostA.id]);
  });
});
