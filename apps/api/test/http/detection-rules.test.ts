import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, DetectionRuleResponse, DetectionRuleSummary, HostResponse, PaginatedResponse } from '@aegis/contracts';
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
const UNKNOWN_HOSTS = [{ field: 'hostIds', message: 'Um ou mais hosts não existem neste workspace.' }];

const rule = (overrides: Record<string, unknown> = {}) => ({
  name: 'Shell iniciado por servidor web',
  description: 'nginx gerando shell interativo',
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  hostIds: [],
  definition: {
    version: 1,
    match: 'ALL',
    conditions: [
      { field: 'process.parentName', operator: 'EQUALS', value: 'nginx' },
      { field: 'process.name', operator: 'IN', value: ['bash', 'sh'] },
    ],
  },
  ...overrides,
});

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const rules = `/workspaces/${workspaceId}/detection-rules`;
  const hostsUrl = `/workspaces/${workspaceId}/hosts`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: bearer(token), payload });
  return {
    workspaceId,
    rules,
    hostsUrl,
    call,
    host: async (displayName: string) => (await call('POST', hostsUrl, { displayName })).json<HostResponse>(),
    create: (payload: object = rule(), url = rules) => call('POST', url, payload),
    list: (query = '', url = rules) => call('GET', `${url}${query}`),
  };
}

const issueFields = (body: ApiErrorResponse) => body.error.issues?.map((issue) => issue.field) ?? [];

describe('detection rules: authentication', () => {
  it.each([
    ['POST', ''],
    ['GET', ''],
    ['GET', `/${MISSING_ID}`],
    ['PUT', `/${MISSING_ID}`],
    ['DELETE', `/${MISSING_ID}`],
  ] as const)('%s requires a token', async (method, suffix) => {
    const { rules } = await tenant();
    expect((await app.inject({ method, url: `${rules}${suffix}`, payload: ['POST', 'PUT'].includes(method) ? rule() : undefined })).statusCode).toBe(401);
  });
});

describe('CRUD', () => {
  it('creates (201), reads, updates (incl. disable) and deletes (204) a rule', async () => {
    const a = await tenant();
    const created = await a.create();
    expect(created.statusCode).toBe(201);
    const body = created.json<DetectionRuleResponse>();
    expect(body).toMatchObject({
      workspaceId: a.workspaceId,
      name: 'Shell iniciado por servidor web',
      severity: 'HIGH',
      enabled: true,
      eventCategory: 'PROCESS',
      scope: 'ALL_HOSTS',
      targetCount: 0,
      conditionCount: 2,
      targets: [],
      definition: rule().definition,
    });

    const url = `${a.rules}/${body.id}`;
    expect((await a.call('GET', url)).json()).toEqual(body);

    const disabled = await a.call('PUT', url, rule({ enabled: false, severity: 'CRITICAL' }));
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<DetectionRuleResponse>()).toMatchObject({ enabled: false, severity: 'CRITICAL', definition: rule().definition });

    const deleted = await a.call('DELETE', url);
    expect(deleted.statusCode).toBe(204);
    expect((await a.call('GET', url)).statusCode).toBe(404);
  });

  it('defaults enabled to true when omitted', async () => {
    const a = await tenant();
    const { enabled: _omit, ...withoutEnabled } = rule();
    expect((await a.create(withoutEnabled)).json<DetectionRuleResponse>().enabled).toBe(true);
  });

  it('404 for a missing rule on GET, PUT and DELETE', async () => {
    const a = await tenant();
    const url = `${a.rules}/${MISSING_ID}`;
    for (const response of [await a.call('GET', url), await a.call('PUT', url, rule()), await a.call('DELETE', url)]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
  });

  it.each([
    ['a field of another category', { eventCategory: 'NETWORK' }, ['definition.conditions.0.field', 'definition.conditions.1.field']],
    ['an unknown operator', { definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'MATCHES', value: '.*' }] } }, ['definition.conditions.0.operator']],
    ['no conditions', { definition: { version: 1, match: 'ALL', conditions: [] } }, ['definition.conditions']],
    ['an unsupported version', { definition: { ...rule().definition, version: 2 } }, ['definition.version']],
    ['code smuggled as a property', { definition: { ...rule().definition, script: 'process.exit()' } }, ['definition.script']],
    ['a free-text definition', { definition: "SELECT * FROM users; --" }, ['definition']],
    ['an invalid severity', { severity: 'URGENT' }, ['severity']],
    ['a short name', { name: 'A' }, ['name']],
  ])('400 for %s', async (_case, overrides, fields) => {
    const a = await tenant();
    const response = await a.create(rule(overrides));
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(fields);
    expect([...store.detectionRules.values()].filter((stored) => stored.workspaceId === a.workspaceId)).toHaveLength(0);
  });

  it('400 for server-controlled fields (no mass assignment)', async () => {
    const a = await tenant();
    const response = await a.create(rule({ workspaceId: MISSING_ID, id: MISSING_ID, createdAt: '2020-01-01T00:00:00Z' }));
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['workspaceId', 'id', 'createdAt']);
  });
});

describe('list: pagination, search and filters', () => {
  it('paginates 25 rules as 10 + 10 + 5 without overlap', async () => {
    const a = await tenant();
    for (let i = 1; i <= 25; i += 1) await a.create(rule({ name: `Regra ${String(i).padStart(2, '0')}` }));
    const pages = await Promise.all([1, 2, 3].map(async (page) => (await a.list(`?page=${page}&pageSize=10`)).json<PaginatedResponse<DetectionRuleSummary>>()));

    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    for (const page of pages) expect(page.pagination).toMatchObject({ pageSize: 10, total: 25, totalPages: 3 });
    expect(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size).toBe(25);
    expect(Object.keys(pages[0]?.items[0] ?? {})).not.toContain('definition');
  });

  it('filters by severity, category and enabled, and searches name/description', async () => {
    const a = await tenant();
    await a.create(rule({ name: 'SSH exposto', severity: 'LOW', eventCategory: 'NETWORK', definition: { version: 1, match: 'ANY', conditions: [{ field: 'network.localPort', operator: 'EQUALS', value: 22 }] } }));
    await a.create(rule({ name: 'Shell web', enabled: false }));
    await a.create(rule({ name: 'Serviço parado', severity: 'MEDIUM', eventCategory: 'SYSTEM', description: 'monitorar ssh', definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.serviceName', operator: 'EQUALS', value: 'sshd' }] } }));

    const names = async (query: string) =>
      (await a.list(query)).json<PaginatedResponse<DetectionRuleSummary>>().items.map((item) => item.name).sort();
    expect(await names('?severity=LOW')).toEqual(['SSH exposto']);
    expect(await names('?eventCategory=SYSTEM')).toEqual(['Serviço parado']);
    expect(await names('?enabled=false')).toEqual(['Shell web']);
    expect(await names('?q=ssh')).toEqual(['SSH exposto', 'Serviço parado']);
    expect(await names('?q=ssh&severity=MEDIUM')).toEqual(['Serviço parado']);
  });

  it.each(['?page=0', '?pageSize=101', '?severity=URGENT', '?enabled=yes', '?eventCategory=FILE'])('400 for %s', async (query) => {
    const a = await tenant();
    expect((await a.list(query)).statusCode).toBe(400);
  });
});

describe('targets (Rule ↔ Host)', () => {
  it('SELECTED_HOSTS with one and with several hosts returns the targets', async () => {
    const a = await tenant();
    const [web, db] = [await a.host('Web'), await a.host('Banco')];

    const one = (await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [web.id] }))).json<DetectionRuleResponse>();
    expect(one.targets).toEqual([{ hostId: web.id, displayName: 'Web', connectionState: 'UNPAIRED' }]);

    const several = (await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [web.id, db.id] }))).json<DetectionRuleResponse>();
    expect(several.targetCount).toBe(2);
    expect(several.targets.map((target) => target.displayName)).toEqual(['Banco', 'Web']);
  });

  it.each([
    ['SELECTED_HOSTS without hosts', { scope: 'SELECTED_HOSTS', hostIds: [] }],
    ['ALL_HOSTS with hosts', { scope: 'ALL_HOSTS', hostIds: [MISSING_ID] }],
    ['duplicated hosts', { scope: 'SELECTED_HOSTS', hostIds: [MISSING_ID, MISSING_ID] }],
  ])('400 for %s', async (_case, overrides) => {
    const a = await tenant();
    const response = await a.create(rule(overrides));
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['hostIds']);
  });

  it('400 with the same message for a missing host and a host of another workspace', async () => {
    const a = await tenant();
    const b = await tenant();
    const foreign = await b.host('Host de B');

    const missing = await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [MISSING_ID] }));
    const external = await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [foreign.id] }));
    expect(missing.json<ApiErrorResponse>().error.issues).toEqual(UNKNOWN_HOSTS);
    expect(external.body).toBe(missing.body);
    expect(external.body).not.toContain('Host de B');
  });

  it('switches ALL → SELECTED → ALL, and a failed switch changes nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const host = await a.host('Servidor');
    const foreign = await b.host('Host de B');
    const created = (await a.create()).json<DetectionRuleResponse>();
    const url = `${a.rules}/${created.id}`;

    const selected = (await a.call('PUT', url, rule({ scope: 'SELECTED_HOSTS', hostIds: [host.id] }))).json<DetectionRuleResponse>();
    expect(selected).toMatchObject({ scope: 'SELECTED_HOSTS', targetCount: 1 });

    const failed = await a.call('PUT', url, rule({ name: 'Não deve salvar', scope: 'SELECTED_HOSTS', hostIds: [host.id, foreign.id] }));
    expect(failed.statusCode).toBe(400);
    expect((await a.call('GET', url)).json<DetectionRuleResponse>()).toMatchObject({ name: created.name, scope: 'SELECTED_HOSTS', targetCount: 1 });

    const all = (await a.call('PUT', url, rule({ scope: 'ALL_HOSTS', hostIds: [] }))).json<DetectionRuleResponse>();
    expect(all).toMatchObject({ scope: 'ALL_HOSTS', targetCount: 0, targets: [] });
    expect(store.detectionRules.get(created.id)?.targetHostIds).toEqual([]);
  });

  it('409 when deleting a targeted host; deleting the rule frees it (targets cascade)', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const created = (await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [host.id] }))).json<DetectionRuleResponse>();

    const blocked = await a.call('DELETE', `${a.hostsUrl}/${host.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<ApiErrorResponse>().error.message).toBe('Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.');

    expect((await a.call('DELETE', `${a.rules}/${created.id}`)).statusCode).toBe(204);
    expect((await a.call('DELETE', `${a.hostsUrl}/${host.id}`)).statusCode).toBe(204);
  });
});

describe('multi-tenant isolation (A vs B)', () => {
  it('A cannot list, read, update, delete B rules, nor target B hosts — and learns nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const hostA = await a.host('Host A');
    const hostB = await b.host('Host B');
    const ruleA = (await a.create(rule({ name: 'Regra A' }))).json<DetectionRuleResponse>();
    const ruleB = (await b.create(rule({ name: 'Regra B', scope: 'SELECTED_HOSTS', hostIds: [hostB.id] }))).json<DetectionRuleResponse>();
    const urlB = `${b.rules}/${ruleB.id}`;

    const denied = [
      await a.list('', b.rules),
      await a.call('GET', urlB),
      await a.call('PUT', urlB, rule()),
      await a.call('DELETE', urlB),
      await a.create(rule(), b.rules),
      await a.call('GET', `${a.rules}/${ruleB.id}`),
      await a.call('PUT', `${a.rules}/${ruleB.id}`, rule()),
      await a.call('DELETE', `${a.rules}/${ruleB.id}`),
    ];
    for (const response of denied) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
      expect(response.body).not.toContain(ruleB.id);
      expect(response.body).not.toContain('Regra B');
    }

    // Creating, or changing A's rule, to target B's host is refused like a missing host.
    expect((await a.create(rule({ scope: 'SELECTED_HOSTS', hostIds: [hostB.id] }))).json<ApiErrorResponse>().error.issues).toEqual(UNKNOWN_HOSTS);
    const retarget = await a.call('PUT', `${a.rules}/${ruleA.id}`, rule({ scope: 'SELECTED_HOSTS', hostIds: [hostA.id, hostB.id] }));
    expect(retarget.statusCode).toBe(400);
    expect(store.detectionRules.get(ruleA.id)).toMatchObject({ scope: 'ALL_HOSTS', targetHostIds: [] });

    // B is intact.
    expect((await b.call('GET', urlB)).json<DetectionRuleResponse>()).toMatchObject({ name: 'Regra B', targetCount: 1 });
    expect((await a.list()).json<PaginatedResponse<DetectionRuleSummary>>().items.map((item) => item.id)).toEqual([ruleA.id]);
  });
});
