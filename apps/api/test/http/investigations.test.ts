import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, HostResponse, IncidentResponse, InvestigationResponse, InvestigationSummary, PaginatedResponse } from '@aegis/contracts';
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
const UNKNOWN_INCIDENTS = { field: 'incidentIds', message: 'Um ou mais incidentes não existem neste workspace.' };
const CONCLUSION_REQUIRED = 'Adicione uma conclusão antes de encerrar a investigação.';
const CONCLUSION = 'Falso positivo: atualização legítima do servidor.';

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const investigations = `${base}/investigations`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
  /** An incident on a fresh host, returned as created. */
  const incident = async (title = 'Shell inesperado', overrides: Record<string, unknown> = {}) => {
    const host = (await call('POST', `${base}/hosts`, { displayName: `host-${Math.random().toString(36).slice(2, 8)}` })).json<HostResponse>();
    return (await call('POST', `${base}/incidents`, { title, severity: 'HIGH', hostIds: [host.id], ...overrides })).json<IncidentResponse>();
  };
  return {
    workspaceId,
    base,
    investigations,
    call,
    incident,
    create: (payload: object, url = investigations) => call('POST', url, payload),
    list: (query = '', url = investigations) => call('GET', `${url}${query}`),
    /** An investigation over a fresh incident, returned as created. */
    investigation: async (overrides: Record<string, unknown> = {}) => {
      const grouped = await incident();
      return (await call('POST', investigations, { title: 'Atividade incomum', incidentIds: [grouped.id], ...overrides })).json<InvestigationResponse>();
    },
  };
}

/** PUT body that keeps the stored values, optionally changing some. */
const keep = (investigation: InvestigationResponse, changes: Record<string, unknown> = {}) => ({
  title: investigation.title,
  description: investigation.description,
  conclusion: investigation.conclusion,
  incidentIds: investigation.incidents.map((incident) => incident.incidentId),
  ...changes,
});

const issuesOf = (body: ApiErrorResponse) => body.error.issues ?? [];

describe('investigations: authentication', () => {
  it.each([
    ['POST', ''],
    ['GET', ''],
    ['GET', `/${MISSING_ID}`],
    ['PUT', `/${MISSING_ID}`],
    ['DELETE', `/${MISSING_ID}`],
  ] as const)('%s requires a token', async (method, suffix) => {
    const { investigations } = await tenant();
    const payload = ['POST', 'PUT'].includes(method) ? { title: 'X1', incidentIds: [MISSING_ID] } : undefined;
    expect((await app.inject({ method, url: `${investigations}${suffix}`, payload })).statusCode).toBe(401);
  });
});

describe('investigations: CRUD', () => {
  it('creates (201) an OPEN investigation, reads, updates and deletes (204) it', async () => {
    const a = await tenant();
    const web1 = await a.incident('Shell inesperado no servidor-web-01');
    const web2 = await a.incident('Shell inesperado no servidor-web-02', { severity: 'CRITICAL' });

    const created = await a.create({
      title: 'Atividade incomum nos servidores web',
      description: 'Agrupa incidentes relacionados à mesma sequência de análise.',
      incidentIds: [web1.id, web2.id],
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<InvestigationResponse>();
    expect(body).toMatchObject({
      workspaceId: a.workspaceId,
      title: 'Atividade incomum nos servidores web',
      description: 'Agrupa incidentes relacionados à mesma sequência de análise.',
      status: 'OPEN',
      conclusion: null,
      closedAt: null,
      incidentCount: 2,
      availableTransitions: ['IN_PROGRESS', 'CLOSED'],
    });
    // Newest first; each incident is a summary, without its own relations.
    expect(body.incidents).toEqual([
      { incidentId: web2.id, title: 'Shell inesperado no servidor-web-02', severity: 'CRITICAL', status: 'OPEN', origin: 'MANUAL' },
      { incidentId: web1.id, title: 'Shell inesperado no servidor-web-01', severity: 'HIGH', status: 'OPEN', origin: 'MANUAL' },
    ]);

    const url = `${a.investigations}/${body.id}`;
    expect((await a.call('GET', url)).json<InvestigationResponse>()).toEqual(body);

    const updated = await a.call('PUT', url, keep(body, { title: 'Shell no web-01', description: '', conclusion: 'Rascunho', incidentIds: [web1.id] }));
    expect(updated.statusCode).toBe(200);
    expect(updated.json<InvestigationResponse>()).toMatchObject({
      title: 'Shell no web-01',
      description: null,
      conclusion: 'Rascunho',
      status: 'OPEN',
      incidentCount: 1,
      createdAt: body.createdAt,
    });

    const deleted = await a.call('DELETE', url);
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
    expect((await a.call('GET', url)).json()).toEqual(NOT_FOUND);
    // Incidents survive; the relations went with the investigation, so they can be deleted now.
    expect((await a.call('DELETE', `${a.base}/incidents/${web2.id}`)).statusCode).toBe(204);
    expect((await a.call('DELETE', `${a.base}/incidents/${web1.id}`)).statusCode).toBe(204);
  });

  it('404 for a missing or malformed investigation on GET, PUT and DELETE', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const payload = { title: 'Título', incidentIds: [incident.id] };
    for (const id of [MISSING_ID, 'nao-e-uuid']) {
      expect((await a.call('GET', `${a.investigations}/${id}`)).json()).toEqual(NOT_FOUND);
      expect((await a.call('PUT', `${a.investigations}/${id}`, payload)).json()).toEqual(NOT_FOUND);
      expect((await a.call('DELETE', `${a.investigations}/${id}`)).json()).toEqual(NOT_FOUND);
    }
  });

  it('400 for server-owned fields: the client cannot choose status, conclusion, closedAt, ids or timestamps', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const base = { title: 'Título', incidentIds: [incident.id] };
    const smuggled = { status: 'CLOSED', conclusion: CONCLUSION, closedAt: '2026-01-01T00:00:00Z', id: MISSING_ID, workspaceId: MISSING_ID, createdAt: 'x', updatedAt: 'x' };
    const response = await a.create({ ...base, ...smuggled });
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field).sort()).toEqual(Object.keys(smuggled).sort());

    const investigation = await a.investigation();
    const put = await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { closedAt: '2026-01-01T00:00:00Z', workspaceId: MISSING_ID }));
    expect(put.statusCode).toBe(400);
    expect((await a.call('GET', `${a.investigations}/${investigation.id}`)).json<InvestigationResponse>()).toEqual(investigation);
    expect([...store.investigations.values()].every((item) => item.status !== 'CLOSED' || item.conclusion)).toBe(true);
  });

  it('400 for invalid fields', async () => {
    const a = await tenant();
    const response = await a.create({ title: 'x', description: 'y'.repeat(5001), incidentIds: [] });
    expect(response.statusCode).toBe(400);
    expect(issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['title', 'description', 'incidentIds']);
    const investigation = await a.investigation();
    const put = await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { conclusion: 'z'.repeat(10001), status: 'DONE' }));
    expect(issuesOf(put.json<ApiErrorResponse>()).map((issue) => issue.field)).toEqual(['conclusion', 'status']);
  });

  it('stores HTML as inert plain text', async () => {
    const a = await tenant();
    const markup = '<img src=x onerror=alert(1)> <script>alert(1)</script>';
    const investigation = await a.investigation({ description: markup });
    const updated = (await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { conclusion: markup }))).json<InvestigationResponse>();
    expect([updated.description, updated.conclusion]).toEqual([markup, markup]);
  });
});

describe('investigations: lifecycle and conclusion', () => {
  it('walks OPEN → IN_PROGRESS → OPEN → IN_PROGRESS → CLOSED, stamping closedAt only on close', async () => {
    const a = await tenant();
    const investigation = await a.investigation();
    const url = `${a.investigations}/${investigation.id}`;
    const move = async (status: string, changes: Record<string, unknown> = {}) =>
      (await a.call('PUT', url, keep(investigation, { status, ...changes }))).json<InvestigationResponse>();

    expect(await move('IN_PROGRESS')).toMatchObject({ status: 'IN_PROGRESS', closedAt: null, availableTransitions: ['OPEN', 'CLOSED'] });
    expect(await move('OPEN')).toMatchObject({ status: 'OPEN', closedAt: null, availableTransitions: ['IN_PROGRESS', 'CLOSED'] });
    await move('IN_PROGRESS');
    const closed = await move('CLOSED', { conclusion: CONCLUSION });
    expect(closed).toMatchObject({ status: 'CLOSED', conclusion: CONCLUSION, availableTransitions: [] });
    expect(closed.closedAt).toEqual(expect.any(String));
    expect(Date.parse(closed.closedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(investigation.createdAt));
    expect((await a.list('?status=CLOSED')).json<PaginatedResponse<InvestigationSummary>>().items[0]?.closedAt).toBe(closed.closedAt);
  });

  it('allows OPEN → CLOSED directly and keeps the status when it is omitted', async () => {
    const a = await tenant();
    const investigation = await a.investigation();
    const url = `${a.investigations}/${investigation.id}`;
    expect((await a.call('PUT', url, keep(investigation, { conclusion: 'Rascunho curto' }))).json<InvestigationResponse>()).toMatchObject({
      status: 'OPEN',
      conclusion: 'Rascunho curto',
    });
    expect((await a.call('PUT', url, keep(investigation, { conclusion: CONCLUSION, status: 'CLOSED' }))).json<InvestigationResponse>().status).toBe('CLOSED');
  });

  it.each([
    ['missing', undefined, CONCLUSION_REQUIRED],
    ['blank', '   ', CONCLUSION_REQUIRED],
    ['too short', 'Curta', 'A conclusão deve ter pelo menos 10 caracteres para encerrar a investigação.'],
  ])('400 on the conclusion field when closing with a %s conclusion, changing nothing', async (_case, conclusion, message) => {
    const a = await tenant();
    const investigation = await a.investigation();
    const url = `${a.investigations}/${investigation.id}`;
    await a.call('PUT', url, keep(investigation, { status: 'IN_PROGRESS' }));
    const before = (await a.call('GET', url)).json<InvestigationResponse>();

    const response = await a.call('PUT', url, keep(investigation, { title: 'Mudança junto', conclusion, status: 'CLOSED' }));
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>()).toEqual({ error: { code: 'VALIDATION_ERROR', message, issues: [{ field: 'conclusion', message }] } });
    expect((await a.call('GET', url)).json<InvestigationResponse>()).toEqual(before);
  });

  it('a stored draft does not count: the PUT body is a full replacement', async () => {
    const a = await tenant();
    const investigation = await a.investigation();
    const url = `${a.investigations}/${investigation.id}`;
    await a.call('PUT', url, keep(investigation, { conclusion: CONCLUSION }));
    expect((await a.call('PUT', url, keep(investigation, { conclusion: null, status: 'CLOSED' }))).statusCode).toBe(400);
  });

  it('a CLOSED investigation is final and read-only (409) but can be deleted', async () => {
    const a = await tenant();
    const extra = await a.incident('Outro incidente');
    const investigation = await a.investigation();
    const url = `${a.investigations}/${investigation.id}`;
    const closed = (await a.call('PUT', url, keep(investigation, { conclusion: CONCLUSION, status: 'CLOSED' }))).json<InvestigationResponse>();

    for (const changes of [
      { title: 'Reescrito' },
      { description: 'Nova descrição' },
      { conclusion: 'Outra conclusão definitiva' },
      { incidentIds: [extra.id] },
      { status: 'OPEN' },
      { status: 'IN_PROGRESS' },
      {},
    ]) {
      const edit = await a.call('PUT', url, keep(closed, changes));
      expect(edit.statusCode).toBe(409);
      expect(edit.json<ApiErrorResponse>().error).toEqual({ code: 'INVALID_STATE', message: 'Esta investigação está encerrada e não pode mais ser alterada.' });
    }
    expect((await a.call('GET', url)).json<InvestigationResponse>()).toEqual(closed);
    expect((await a.call('DELETE', url)).statusCode).toBe(204);
  });
});

describe('investigations: list, pagination, search and filters', () => {
  it('paginates 25 investigations as 10 + 10 + 5 without overlap, newest first, summaries without relations', async () => {
    const a = await tenant();
    const incident = await a.incident();
    for (let i = 0; i < 25; i += 1) await a.create({ title: `Investigação ${i}`, incidentIds: [incident.id] });

    const pages = await Promise.all([1, 2, 3].map(async (page) => (await a.list(`?page=${page}&pageSize=10`)).json<PaginatedResponse<InvestigationSummary>>()));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    expect(pages[0]?.pagination).toEqual({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    const listed = pages.flatMap((page) => page.items);
    const ids = listed.map((item) => item.id);
    expect(new Set(ids).size).toBe(25);
    const sorted = [...listed].sort((x, y) => y.createdAt.localeCompare(x.createdAt) || (x.id < y.id ? 1 : -1));
    expect(ids).toEqual(sorted.map((item) => item.id));
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(['closedAt', 'createdAt', 'id', 'incidentCount', 'status', 'title', 'updatedAt', 'workspaceId'].sort());
    expect(listed.every((item) => item.incidentCount === 1)).toBe(true);
    expect((await a.list('?pageSize=101')).statusCode).toBe(400);
  });

  it('searches title, description and conclusion literally and filters by status', async () => {
    const a = await tenant();
    const web = await a.investigation({ title: 'Atividade nos servidores web' });
    await a.investigation({ title: 'Varredura de portas', description: 'Origem 100%_externa' });
    const lateral = await a.investigation({ title: 'Movimento lateral' });
    await a.call('PUT', `${a.investigations}/${web.id}`, keep(web, { status: 'IN_PROGRESS' }));
    await a.call('PUT', `${a.investigations}/${lateral.id}`, keep(lateral, { conclusion: 'Credencial de serviço reutilizada.', status: 'CLOSED' }));

    const total = async (query: string) => (await a.list(query)).json<PaginatedResponse<InvestigationSummary>>().pagination.total;
    expect(await total('?q=WEB')).toBe(1);
    expect(await total('?q=externa')).toBe(1);
    expect(await total('?q=credencial')).toBe(1);
    expect(await total('?q=100%25_')).toBe(1);
    expect(await total('?q=%25')).toBe(1);
    expect(await total('?q=_')).toBe(1);
    expect(await total('?status=OPEN')).toBe(1);
    expect(await total('?status=IN_PROGRESS')).toBe(1);
    expect(await total('?status=CLOSED&q=lateral')).toBe(1);
    expect(await total('?status=OPEN&q=lateral')).toBe(0);

    for (const query of ['?status=INVESTIGATING', '?status=closed', '?page=0']) expect((await a.list(query)).statusCode).toBe(400);
  });
});

describe('investigations: relations (Investigation ↔ Incident)', () => {
  it('accepts 1 or several incidents, and one incident may be in several investigations (N:N)', async () => {
    const a = await tenant();
    const [i1, i2, i3] = [await a.incident('I1'), await a.incident('I2'), await a.incident('I3')];
    const count = async (incidentIds: string[]) => (await a.create({ title: 'Relações', incidentIds })).json<InvestigationResponse>().incidentCount;
    expect(await count([i1.id])).toBe(1);
    expect(await count([i1.id, i2.id, i3.id])).toBe(3);
    expect(await count([i1.id, i3.id])).toBe(2);
  });

  it('accepts incidents in any status, closed ones included', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const incidentUrl = `${a.base}/incidents/${incident.id}`;
    const incidentBody = { title: incident.title, severity: incident.severity, hostIds: incident.hosts.map((host) => host.hostId) };
    await a.call('PUT', incidentUrl, { ...incidentBody, status: 'RESOLVED' });
    await a.call('PUT', incidentUrl, { ...incidentBody, status: 'CLOSED' });
    const created = await a.create({ title: 'Revisão de caso encerrado', incidentIds: [incident.id] });
    expect(created.json<InvestigationResponse>().incidents[0]?.status).toBe('CLOSED');
  });

  it('400 for an empty list, duplicates or malformed ids — on create and update', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const fields = async (response: Awaited<ReturnType<typeof a.create>>) => {
      expect(response.statusCode).toBe(400);
      return issuesOf(response.json<ApiErrorResponse>()).map((issue) => issue.field);
    };
    expect(await fields(await a.create({ title: 'Vazia', incidentIds: [] }))).toEqual(['incidentIds']);
    expect(await fields(await a.create({ title: 'Sem lista' }))).toEqual(['incidentIds']);
    expect(await fields(await a.create({ title: 'Duplicados', incidentIds: [incident.id, incident.id] }))).toEqual(['incidentIds']);
    expect(await fields(await a.create({ title: 'Malformado', incidentIds: ['nope'] }))).toEqual(['incidentIds.0']);

    const investigation = await a.investigation();
    expect(await fields(await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { incidentIds: [] })))).toEqual(['incidentIds']);
    expect((await a.call('GET', `${a.investigations}/${investigation.id}`)).json<InvestigationResponse>().incidentCount).toBe(1);
  });

  it('400 with the same message for missing and foreign incidents, and nothing is written', async () => {
    const a = await tenant();
    const b = await tenant();
    const [incidentA, incidentB] = [await a.incident('Incidente A'), await b.incident('Incidente B')];
    const before = store.investigations.size;

    const foreign = await a.create({ title: 'Cruzada', incidentIds: [incidentA.id, incidentB.id] });
    const missing = await a.create({ title: 'Cruzada', incidentIds: [incidentA.id, MISSING_ID] });
    expect(foreign.statusCode).toBe(400);
    expect(issuesOf(foreign.json<ApiErrorResponse>())).toEqual([UNKNOWN_INCIDENTS]);
    expect(missing.json()).toEqual(foreign.json());
    expect(foreign.body).not.toContain('Incidente B');
    expect(store.investigations.size).toBe(before);
  });

  it('an update with a foreign incident fails atomically: title, status, conclusion and relations stay intact', async () => {
    const a = await tenant();
    const b = await tenant();
    const investigation = await a.investigation();
    const incidentB = await b.incident();
    const url = `${a.investigations}/${investigation.id}`;

    const response = await a.call('PUT', url, keep(investigation, { title: 'Alterada', conclusion: CONCLUSION, status: 'CLOSED', incidentIds: [incidentB.id] }));
    expect(response.statusCode).toBe(400);
    expect((await a.call('GET', url)).json<InvestigationResponse>()).toEqual(investigation);
  });
});

describe('investigations: delete protection of incidents', () => {
  it('409 for an incident grouped by an investigation (even a closed one); 204 once unlinked', async () => {
    const a = await tenant();
    const [grouped, spare] = [await a.incident('Agrupado'), await a.incident('Reserva')];
    const investigation = (await a.create({ title: 'Caso', incidentIds: [grouped.id] })).json<InvestigationResponse>();
    const deleteGrouped = () => a.call('DELETE', `${a.base}/incidents/${grouped.id}`);

    const refused = await deleteGrouped();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ApiErrorResponse>().error).toEqual({
      code: 'CONFLICT',
      message: 'Este incidente faz parte de investigações. Remova-o dessas investigações antes de excluí-lo.',
    });
    expect((await a.call('GET', `${a.base}/incidents/${grouped.id}`)).statusCode).toBe(200);

    await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { incidentIds: [spare.id] }));
    expect((await deleteGrouped()).statusCode).toBe(204);

    const closed = (await a.call('PUT', `${a.investigations}/${investigation.id}`, keep(investigation, { incidentIds: [spare.id], conclusion: CONCLUSION, status: 'CLOSED' }))).json<InvestigationResponse>();
    expect(closed.status).toBe('CLOSED');
    expect((await a.call('DELETE', `${a.base}/incidents/${spare.id}`)).statusCode).toBe(409);
  });

  it('an incident in two investigations needs both links removed', async () => {
    const a = await tenant();
    const incident = await a.incident();
    const first = (await a.create({ title: 'Primeira', incidentIds: [incident.id] })).json<InvestigationResponse>();
    const second = (await a.create({ title: 'Segunda', incidentIds: [incident.id] })).json<InvestigationResponse>();
    const deleteIncident = () => a.call('DELETE', `${a.base}/incidents/${incident.id}`);

    expect((await a.call('DELETE', `${a.investigations}/${first.id}`)).statusCode).toBe(204);
    expect((await deleteIncident()).statusCode).toBe(409);
    expect((await a.call('DELETE', `${a.investigations}/${second.id}`)).statusCode).toBe(204);
    expect((await deleteIncident()).statusCode).toBe(204);
  });

  it('a foreign incident is still a 404 on delete, never the 409 that would confirm it exists', async () => {
    const a = await tenant();
    const b = await tenant();
    const investigationB = await b.investigation();
    const incidentB = investigationB.incidents[0]?.incidentId ?? '';
    const response = await a.call('DELETE', `${a.base}/incidents/${incidentB}`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND);
  });
});

describe('investigations: multi-tenant isolation (A vs B)', () => {
  it('A cannot list, read, update or delete B investigations, nor group B incidents — and learns nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const incidentA = await a.incident('Incidente A');
    const incidentB = await b.incident('Incidente B');
    const investigationA = (await a.create({ title: 'Investigação A', incidentIds: [incidentA.id] })).json<InvestigationResponse>();
    const investigationB = (await b.create({ title: 'Investigação B', incidentIds: [incidentB.id] })).json<InvestigationResponse>();
    const payload = { title: 'Invasão', incidentIds: [incidentA.id] };

    // B's workspace in the URL, A's token.
    for (const response of [
      await a.list('', b.investigations),
      await a.call('GET', `${b.investigations}/${investigationB.id}`),
      await a.call('PUT', `${b.investigations}/${investigationB.id}`, payload),
      await a.call('DELETE', `${b.investigations}/${investigationB.id}`),
      await a.create(payload, b.investigations),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
      expect(response.body).not.toContain('Investigação B');
    }
    // A's workspace in the URL, B's investigation id: indistinguishable from a missing one.
    expect((await a.call('GET', `${a.investigations}/${investigationB.id}`)).json()).toEqual(NOT_FOUND);
    expect((await a.call('PUT', `${a.investigations}/${investigationB.id}`, payload)).json()).toEqual(NOT_FOUND);
    expect((await a.call('DELETE', `${a.investigations}/${investigationB.id}`)).json()).toEqual(NOT_FOUND);

    // Grouping B's incident from A: same 400 as a missing id.
    expect(issuesOf((await a.create({ ...payload, incidentIds: [incidentB.id] })).json<ApiErrorResponse>())).toEqual([UNKNOWN_INCIDENTS]);
    const put = await a.call('PUT', `${a.investigations}/${investigationA.id}`, keep(investigationA, { incidentIds: [incidentA.id, incidentB.id] }));
    expect(issuesOf(put.json<ApiErrorResponse>())).toEqual([UNKNOWN_INCIDENTS]);

    // B's data is untouched, and A sees only their own investigation.
    expect((await b.call('GET', `${b.investigations}/${investigationB.id}`)).json<InvestigationResponse>()).toEqual(investigationB);
    expect((await a.list()).json<PaginatedResponse<InvestigationSummary>>().items.map((item) => item.id)).toEqual([investigationA.id]);
    expect((await a.call('GET', `${a.investigations}/${investigationA.id}`)).json<InvestigationResponse>()).toEqual(investigationA);
  });
});
