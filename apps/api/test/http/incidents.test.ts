import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, DetectionRuleResponse, HostResponse, IncidentResponse, IncidentSummary, PaginatedResponse } from '@aegis/contracts';
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
const UNKNOWN_HOSTS = { field: 'hostIds', message: 'Um ou mais hosts não existem neste workspace.' };
const UNKNOWN_RULES = { field: 'detectionRuleIds', message: 'Uma ou mais regras não existem neste workspace.' };

const ruleBody = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  severity: 'HIGH',
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
  ...overrides,
});

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const incidents = `${base}/incidents`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
  const host = async (displayName: string) => (await call('POST', `${base}/hosts`, { displayName })).json<HostResponse>();
  const rule = async (name: string, overrides: Record<string, unknown> = {}) =>
    (await call('POST', `${base}/detection-rules`, ruleBody(name, overrides))).json<DetectionRuleResponse>();
  return {
    workspaceId,
    base,
    incidents,
    call,
    host,
    rule,
    create: (payload: object, url = incidents) => call('POST', url, payload),
    list: (query = '', url = incidents) => call('GET', `${url}${query}`),
    /** An incident on a fresh host, returned as created. */
    incident: async (overrides: Record<string, unknown> = {}) => {
      const target = await host(`host-${Math.random().toString(36).slice(2, 8)}`);
      return (await call('POST', incidents, { title: 'Shell inesperado', severity: 'HIGH', hostIds: [target.id], ...overrides })).json<IncidentResponse>();
    },
  };
}

/** PUT body that keeps the stored values, optionally changing some. */
const keep = (incident: IncidentResponse, changes: Record<string, unknown> = {}) => ({
  title: incident.title,
  description: incident.description,
  severity: incident.severity,
  hostIds: incident.hosts.map((host) => host.hostId),
  detectionRuleIds: incident.detectionRules.map((rule) => rule.ruleId),
  ...changes,
});

const issuesOf = (body: ApiErrorResponse) => body.error.issues ?? [];

describe('incidents: authentication', () => {
  it.each([
    ['POST', ''],
    ['GET', ''],
    ['GET', `/${MISSING_ID}`],
    ['PUT', `/${MISSING_ID}`],
    ['DELETE', `/${MISSING_ID}`],
  ] as const)('%s requires a token', async (method, suffix) => {
    const { incidents } = await tenant();
    const payload = ['POST', 'PUT'].includes(method) ? { title: 'X1', severity: 'LOW', hostIds: [MISSING_ID] } : undefined;
    expect((await app.inject({ method, url: `${incidents}${suffix}`, payload })).statusCode).toBe(401);
  });
});

describe('incidents: CRUD', () => {
  it('creates (201) a manual OPEN incident, reads, updates and deletes (204) it', async () => {
    const a = await tenant();
    const [web1, web2] = [await a.host('servidor-web-01'), await a.host('servidor-web-02')];
    const [shell, admin] = [await a.rule('Shell iniciado por servidor web'), await a.rule('Processo administrativo inesperado', { enabled: false })];

    const created = await a.create({
      title: 'Execução de shell inesperada em servidor web',
      description: 'Comportamento identificado manualmente durante análise.',
      severity: 'HIGH',
      hostIds: [web1.id, web2.id],
      detectionRuleIds: [shell.id, admin.id],
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<IncidentResponse>();
    expect(body).toMatchObject({
      workspaceId: a.workspaceId,
      title: 'Execução de shell inesperada em servidor web',
      severity: 'HIGH',
      status: 'OPEN',
      origin: 'MANUAL',
      resolvedAt: null,
      hostCount: 2,
      ruleCount: 2,
      availableTransitions: ['INVESTIGATING', 'RESOLVED'],
    });
    expect(body.hosts).toEqual([
      { hostId: web1.id, displayName: 'servidor-web-01', connectionState: 'UNPAIRED' },
      { hostId: web2.id, displayName: 'servidor-web-02', connectionState: 'UNPAIRED' },
    ]);
    // A disabled rule can still be related by hand.
    expect(body.detectionRules).toEqual([
      { ruleId: admin.id, name: 'Processo administrativo inesperado', severity: 'HIGH', enabled: false },
      { ruleId: shell.id, name: 'Shell iniciado por servidor web', severity: 'HIGH', enabled: true },
    ]);

    const url = `${a.incidents}/${body.id}`;
    expect((await a.call('GET', url)).json<IncidentResponse>()).toEqual(body);

    const updated = await a.call('PUT', url, keep(body, { title: 'Shell em web-01', description: '', severity: 'CRITICAL', hostIds: [web1.id], detectionRuleIds: [] }));
    expect(updated.statusCode).toBe(200);
    expect(updated.json<IncidentResponse>()).toMatchObject({
      title: 'Shell em web-01',
      description: null,
      severity: 'CRITICAL',
      status: 'OPEN',
      origin: 'MANUAL',
      hostCount: 1,
      ruleCount: 0,
      createdAt: body.createdAt,
      detectionRules: [],
    });

    const deleted = await a.call('DELETE', url);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
    expect((await a.call('GET', url)).json()).toEqual(NOT_FOUND);
    // Hosts and rules survive; the relations went with the incident.
    expect((await a.call('GET', `${a.base}/hosts/${web2.id}`)).statusCode).toBe(200);
    expect((await a.call('DELETE', `${a.base}/detection-rules/${admin.id}`)).statusCode).toBe(204);
  });

  it('404 for a missing or malformed incident on GET, PUT and DELETE', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const payload = { title: 'Título', severity: 'LOW', hostIds: [host.id] };
    for (const id of [MISSING_ID, 'nao-e-uuid']) {
      expect((await a.call('GET', `${a.incidents}/${id}`)).json()).toEqual(NOT_FOUND);
      expect((await a.call('PUT', `${a.incidents}/${id}`, payload)).json()).toEqual(NOT_FOUND);
      expect((await a.call('DELETE', `${a.incidents}/${id}`)).json()).toEqual(NOT_FOUND);
    }
  });

  it('400 for server-owned fields: the client cannot choose origin, status, resolvedAt, ids or timestamps', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const base = { title: 'Título', severity: 'LOW', hostIds: [host.id] };
    const smuggled = { origin: 'DETECTION_ENGINE', status: 'CLOSED', resolvedAt: '2026-01-01T00:00:00Z', id: MISSING_ID, workspaceId: MISSING_ID, createdAt: 'x' };
    const response = await a.create({ ...base, ...smuggled });
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field).sort()).toEqual(Object.keys(smuggled).sort());

    const incident = await a.incident();
    const put = await a.call('PUT', `${a.incidents}/${incident.id}`, keep(incident, { origin: 'DETECTION_ENGINE', workspaceId: MISSING_ID }));
    expect(put.statusCode).toBe(400);
    expect((await a.call('GET', `${a.incidents}/${incident.id}`)).json<IncidentResponse>().origin).toBe('MANUAL');
    expect(store.incidents.size).toBeGreaterThan(0);
    expect([...store.incidents.values()].every((item) => item.origin === 'MANUAL')).toBe(true);
  });

  it('400 for invalid fields', async () => {
    const a = await tenant();
    const response = await a.create({ title: 'x', description: 'y'.repeat(5001), severity: 'URGENT', hostIds: [] });
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['title', 'description', 'severity', 'hostIds']);
  });
});

describe('incidents: lifecycle', () => {
  it('walks OPEN → INVESTIGATING → RESOLVED → INVESTIGATING → RESOLVED → CLOSED with resolvedAt set, cleared and preserved', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const url = `${a.incidents}/${incident.id}`;
    const move = async (status: string) => (await a.call('PUT', url, keep(incident, { status }))).json<IncidentResponse>();

    expect(await move('INVESTIGATING')).toMatchObject({ status: 'INVESTIGATING', resolvedAt: null, availableTransitions: ['RESOLVED'] });
    const resolved = await move('RESOLVED');
    expect(resolved).toMatchObject({ status: 'RESOLVED', availableTransitions: ['INVESTIGATING', 'CLOSED'] });
    expect(resolved.resolvedAt).toEqual(expect.any(String));
    expect(await move('INVESTIGATING')).toMatchObject({ status: 'INVESTIGATING', resolvedAt: null });
    const resolvedAgain = await move('RESOLVED');
    const closed = await move('CLOSED');
    expect(closed).toMatchObject({ status: 'CLOSED', resolvedAt: resolvedAgain.resolvedAt, availableTransitions: [] });
  });

  it('allows OPEN → RESOLVED directly and keeps the status when it is omitted', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const url = `${a.incidents}/${incident.id}`;
    expect((await a.call('PUT', url, keep(incident, { status: 'RESOLVED' }))).json<IncidentResponse>().status).toBe('RESOLVED');
    expect((await a.call('PUT', url, keep(incident, { title: 'Só o título' }))).json<IncidentResponse>()).toMatchObject({ status: 'RESOLVED', title: 'Só o título' });
  });

  it.each([
    [[], 'CLOSED'],
    [['INVESTIGATING'], 'OPEN'],
    [['RESOLVED', 'CLOSED'], 'OPEN'],
  ])('after %j, → %s is a 409 INVALID_STATE, changing nothing', async (path, target) => {
    const a = await tenant();
    const incident = await a.incident();
    const url = `${a.incidents}/${incident.id}`;
    for (const status of path) await a.call('PUT', url, keep(incident, { status }));
    const before = (await a.call('GET', url)).json<IncidentResponse>();

    const response = await a.call('PUT', url, keep(incident, { title: 'Mudança junto', status: target }));
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error.code).toBe('INVALID_STATE');
    expect((await a.call('GET', url)).json<IncidentResponse>()).toEqual(before);
  });

  it('names the refused transition on the status field', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const response = await a.call('PUT', `${a.incidents}/${incident.id}`, keep(incident, { status: 'CLOSED' }));
    const message = 'Não é possível mudar o status de “Aberto” para “Encerrado”.';
    expect(response.json<ApiErrorResponse>()).toEqual({ error: { code: 'INVALID_STATE', message, issues: [{ field: 'status', message }] } });
  });

  it('a CLOSED incident cannot be edited (409) but can be deleted', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const url = `${a.incidents}/${incident.id}`;
    await a.call('PUT', url, keep(incident, { status: 'RESOLVED' }));
    await a.call('PUT', url, keep(incident, { status: 'CLOSED' }));
    const edit = await a.call('PUT', url, keep(incident, { title: 'Reescrito' }));
    expect(edit.statusCode).toBe(409);
    expect(edit.json<ApiErrorResponse>().error).toEqual({ code: 'INVALID_STATE', message: 'Este incidente está encerrado e não pode mais ser alterado.' });
    expect((await a.call('DELETE', url)).statusCode).toBe(204);
  });
});

describe('incidents: list, pagination, search and filters', () => {
  it('paginates 25 incidents as 10 + 10 + 5 without overlap, newest first, summaries without relations', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    for (let i = 0; i < 25; i += 1) await a.create({ title: `Incidente ${i}`, severity: 'LOW', hostIds: [host.id] });

    const pages = await Promise.all([1, 2, 3].map(async (page) => (await a.list(`?page=${page}&pageSize=10`)).json<PaginatedResponse<IncidentSummary>>()));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    expect(pages[0]?.pagination).toEqual({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(25);
    const listed = pages.flatMap((page) => page.items);
    const sorted = [...listed].sort((x, y) => y.createdAt.localeCompare(x.createdAt) || (x.id < y.id ? 1 : -1));
    expect(ids).toEqual(sorted.map((item) => item.id));
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      ['createdAt', 'hostCount', 'id', 'origin', 'resolvedAt', 'ruleCount', 'severity', 'status', 'title', 'updatedAt', 'workspaceId'].sort(),
    );
    expect((await a.list('?pageSize=101')).statusCode).toBe(400);
  });

  it('searches title/description literally and filters by severity, status and origin', async () => {
    const a = await tenant();
    const shell = await a.incident({ title: 'Shell em web', severity: 'CRITICAL' });
    await a.incident({ title: 'Varredura de portas', description: 'Origem 100%_externa', severity: 'LOW' });
    const scan = (await a.list('?q=varredura')).json<PaginatedResponse<IncidentSummary>>().items[0];
    await a.call('PUT', `${a.incidents}/${shell.id}`, keep(shell, { status: 'INVESTIGATING' }));

    const total = async (query: string) => (await a.list(query)).json<PaginatedResponse<IncidentSummary>>().pagination.total;
    expect(await total('?q=SHELL')).toBe(1);
    expect(await total('?q=100%25_')).toBe(1);
    expect(await total('?q=%25')).toBe(1);
    expect(await total('?severity=CRITICAL')).toBe(1);
    expect(await total('?status=INVESTIGATING')).toBe(1);
    expect(await total('?status=OPEN&severity=LOW')).toBe(1);
    expect(await total('?origin=MANUAL')).toBe(2);
    expect(await total('?origin=DETECTION_ENGINE')).toBe(0);

    // The reserved origin is seeded straight into storage (no code path creates it) to prove the filter.
    const seeded = store.incidents.get(scan?.id ?? '');
    if (seeded) store.incidents.set(seeded.id, { ...seeded, origin: 'DETECTION_ENGINE' });
    expect(await total('?origin=DETECTION_ENGINE')).toBe(1);

    for (const query of ['?status=DONE', '?severity=URGENT', '?origin=AI', '?page=0']) expect((await a.list(query)).statusCode).toBe(400);
  });
});

describe('incidents: relations (Incident ↔ Host, Incident ↔ DetectionRule)', () => {
  it('accepts 1 or several hosts and 0, 1 or several rules', async () => {
    const a = await tenant();
    const [h1, h2] = [await a.host('H1'), await a.host('H2')];
    const [r1, r2] = [await a.rule('R1'), await a.rule('R2')];
    const counts = async (hostIds: string[], detectionRuleIds?: string[]) => {
      const body = (await a.create({ title: 'Relações', severity: 'MEDIUM', hostIds, detectionRuleIds })).json<IncidentResponse>();
      return [body.hostCount, body.ruleCount];
    };
    expect(await counts([h1.id])).toEqual([1, 0]);
    expect(await counts([h1.id, h2.id], [])).toEqual([2, 0]);
    expect(await counts([h1.id], [r1.id])).toEqual([1, 1]);
    expect(await counts([h2.id], [r1.id, r2.id])).toEqual([1, 2]);
  });

  it('400 for duplicate hosts or rules', async () => {
    const a = await tenant();
    const [host, rule] = [await a.host('Host'), await a.rule('Regra')];
    const response = await a.create({ title: 'Duplicados', severity: 'LOW', hostIds: [host.id, host.id], detectionRuleIds: [rule.id, rule.id] });
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['hostIds', 'detectionRuleIds']);
  });

  it('400 with the same messages for missing and foreign hosts/rules, and nothing is written', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, hostB, ruleB] = [await a.host('Host A'), await b.host('Host B'), await b.rule('Regra B')];
    const before = store.incidents.size;

    const foreign = await a.create({ title: 'Cruzado', severity: 'LOW', hostIds: [hostA.id, hostB.id], detectionRuleIds: [ruleB.id] });
    const missing = await a.create({ title: 'Cruzado', severity: 'LOW', hostIds: [hostA.id, MISSING_ID], detectionRuleIds: [MISSING_ID] });
    expect(foreign.statusCode).toBe(400);
    expect(issuesOf(foreign.json<ApiErrorResponse>())).toEqual([UNKNOWN_HOSTS, UNKNOWN_RULES]);
    expect(missing.json()).toEqual(foreign.json());
    expect(store.incidents.size).toBe(before);
  });

  it('an update with a foreign host or rule fails atomically: title, status and relations stay intact', async () => {
    const a = await tenant();
    const b = await tenant();
    const ruleA = await a.rule('Regra A');
    const incident = await a.incident({ detectionRuleIds: [ruleA.id] });
    const [hostB, ruleB] = [await b.host('Host B'), await b.rule('Regra B')];
    const url = `${a.incidents}/${incident.id}`;

    for (const changes of [{ hostIds: [hostB.id] }, { detectionRuleIds: [ruleA.id, ruleB.id] }]) {
      const response = await a.call('PUT', url, keep(incident, { title: 'Alterado', status: 'RESOLVED', ...changes }));
      expect(response.statusCode).toBe(400);
    }
    expect((await a.call('GET', url)).json<IncidentResponse>()).toEqual(incident);
  });
});

describe('incidents: delete protection of hosts and rules', () => {
  it('409 for a host involved in an incident or a related rule; 204 once unlinked', async () => {
    const a = await tenant();
    const [involved, spare, rule] = [await a.host('Envolvido'), await a.host('Reserva'), await a.rule('Relacionada')];
    const incident = (await a.create({ title: 'Caso', severity: 'HIGH', hostIds: [involved.id], detectionRuleIds: [rule.id] })).json<IncidentResponse>();

    const hostDelete = await a.call('DELETE', `${a.base}/hosts/${involved.id}`);
    expect(hostDelete.statusCode).toBe(409);
    expect(hostDelete.json<ApiErrorResponse>().error.message).toBe('Este host está envolvido em incidentes. Remova-o desses incidentes antes de excluí-lo.');
    const ruleDelete = await a.call('DELETE', `${a.base}/detection-rules/${rule.id}`);
    expect(ruleDelete.statusCode).toBe(409);
    expect(ruleDelete.json<ApiErrorResponse>().error.message).toBe('Esta regra está relacionada a incidentes. Remova-a desses incidentes antes de excluí-la.');
    expect((await a.call('GET', `${a.incidents}/${incident.id}`)).json<IncidentResponse>().hostCount).toBe(1);

    await a.call('PUT', `${a.incidents}/${incident.id}`, keep(incident, { hostIds: [spare.id], detectionRuleIds: [] }));
    expect((await a.call('DELETE', `${a.base}/hosts/${involved.id}`)).statusCode).toBe(204);
    expect((await a.call('DELETE', `${a.base}/detection-rules/${rule.id}`)).statusCode).toBe(204);
  });

  it('a host both targeted by a rule and involved in an incident needs both links removed', async () => {
    const a = await tenant();
    const host = await a.host('Duplo vínculo');
    const spare = await a.host('Reserva');
    const rule = await a.rule('Alvo', { scope: 'SELECTED_HOSTS', hostIds: [host.id] });
    const incident = (await a.create({ title: 'Caso', severity: 'LOW', hostIds: [host.id] })).json<IncidentResponse>();
    const deleteHost = () => a.call('DELETE', `${a.base}/hosts/${host.id}`);

    expect((await deleteHost()).json<ApiErrorResponse>().error.message).toMatch(/alvo de regras/);
    await a.call('PUT', `${a.base}/detection-rules/${rule.id}`, ruleBody('Alvo', { scope: 'ALL_HOSTS' }));
    expect((await deleteHost()).json<ApiErrorResponse>().error.message).toMatch(/envolvido em incidentes/);
    await a.call('PUT', `${a.incidents}/${incident.id}`, keep(incident, { hostIds: [spare.id] }));
    expect((await deleteHost()).statusCode).toBe(204);
  });

  it('deleting an incident frees its hosts and rules (relations cascade)', async () => {
    const a = await tenant();
    const rule = await a.rule('Relacionada');
    const incident = await a.incident({ detectionRuleIds: [rule.id] });
    expect((await a.call('DELETE', `${a.incidents}/${incident.id}`)).statusCode).toBe(204);
    expect((await a.call('DELETE', `${a.base}/hosts/${incident.hosts[0]?.hostId}`)).statusCode).toBe(204);
    expect((await a.call('DELETE', `${a.base}/detection-rules/${rule.id}`)).statusCode).toBe(204);
  });
});

describe('incidents: multi-tenant isolation (A vs B)', () => {
  it('A cannot list, read, update or delete B incidents, nor relate B hosts/rules — and learns nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, ruleA] = [await a.host('Host A'), await a.rule('Regra A')];
    const [hostB, ruleB] = [await b.host('Host B'), await b.rule('Regra B')];
    const incidentA = (await a.create({ title: 'Incidente A', severity: 'LOW', hostIds: [hostA.id], detectionRuleIds: [ruleA.id] })).json<IncidentResponse>();
    const incidentB = (await b.create({ title: 'Incidente B', severity: 'HIGH', hostIds: [hostB.id], detectionRuleIds: [ruleB.id] })).json<IncidentResponse>();
    const payload = { title: 'Invasão', severity: 'LOW', hostIds: [hostA.id] };

    // B's workspace in the URL, A's token.
    for (const response of [
      await a.list('', b.incidents),
      await a.call('GET', `${b.incidents}/${incidentB.id}`),
      await a.call('PUT', `${b.incidents}/${incidentB.id}`, payload),
      await a.call('DELETE', `${b.incidents}/${incidentB.id}`),
      await a.create(payload, b.incidents),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
      expect(response.body).not.toContain('Incidente B');
    }
    // A's workspace in the URL, B's incident id: indistinguishable from a missing one.
    expect((await a.call('GET', `${a.incidents}/${incidentB.id}`)).json()).toEqual(NOT_FOUND);
    expect((await a.call('PUT', `${a.incidents}/${incidentB.id}`, payload)).json()).toEqual(NOT_FOUND);
    expect((await a.call('DELETE', `${a.incidents}/${incidentB.id}`)).json()).toEqual(NOT_FOUND);

    // Relating B's host or rule from A: same 400 as a missing id.
    expect(issuesOf((await a.create({ ...payload, hostIds: [hostB.id] })).json<ApiErrorResponse>())).toEqual([UNKNOWN_HOSTS]);
    expect(issuesOf((await a.create({ ...payload, detectionRuleIds: [ruleB.id] })).json<ApiErrorResponse>())).toEqual([UNKNOWN_RULES]);
    expect(issuesOf((await a.call('PUT', `${a.incidents}/${incidentA.id}`, keep(incidentA, { hostIds: [hostB.id] }))).json<ApiErrorResponse>())).toEqual([UNKNOWN_HOSTS]);
    expect(issuesOf((await a.call('PUT', `${a.incidents}/${incidentA.id}`, keep(incidentA, { detectionRuleIds: [ruleB.id] }))).json<ApiErrorResponse>())).toEqual([UNKNOWN_RULES]);

    // B's data is untouched, and A sees only their own incident.
    expect((await b.call('GET', `${b.incidents}/${incidentB.id}`)).json<IncidentResponse>()).toEqual(incidentB);
    expect((await a.list()).json<PaginatedResponse<IncidentSummary>>().items.map((item) => item.id)).toEqual([incidentA.id]);
    expect((await a.call('GET', `${a.incidents}/${incidentA.id}`)).json<IncidentResponse>()).toEqual(incidentA);
  });
});
