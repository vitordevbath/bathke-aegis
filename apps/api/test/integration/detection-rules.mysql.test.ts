import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ConflictError } from '@aegis/domain';
import type { DetectionRuleResponse, HostResponse, LoginResponse, PaginatedResponse, DetectionRuleSummary } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { DetectionRule, type DetectionRuleDetails } from '../../src/domain/detection-rule.js';
import { Host } from '../../src/domain/host.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const details = (overrides: Partial<DetectionRuleDetails> = {}): DetectionRuleDetails => ({
  name: 'Porta SSH',
  severity: 'MEDIUM',
  enabled: true,
  eventCategory: 'NETWORK',
  scope: 'ALL_HOSTS',
  targetHostIds: [],
  definition: { version: 1, match: 'ANY', conditions: [{ field: 'network.localPort', operator: 'IN', value: [22, 2222] }] },
  ...overrides,
});

describe.skipIf(!TEST_DATABASE_URL)('detection rules against MySQL (integration)', () => {
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

  const targetRows = async (ruleId: string) => {
    const [rows] = (await connection.db.execute(sql`SELECT host_id FROM detection_rule_targets WHERE detection_rule_id = ${ruleId}`)) as unknown as [
      { host_id: string }[],
    ];
    return rows.map((row) => row.host_id);
  };

  async function tenant() {
    const registration = makeRegistration();
    await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    const session = (
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })
    ).json<LoginResponse>();
    const workspaceId = session.workspaces[0]?.id ?? '';
    const headers = bearer(session.token);
    return {
      workspaceId,
      headers,
      rules: `/workspaces/${workspaceId}/detection-rules`,
      host: async (displayName: string) => {
        const host = Host.register({ workspaceId, displayName });
        await repositories.hosts.insert(host);
        return host;
      },
    };
  }

  it('round-trips the JSON definition and targets, and enforces the workspace FK', async () => {
    const t = await tenant();
    const host = await t.host('Servidor');
    const rule = DetectionRule.register(t.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: [host.id] }));
    await new DrizzleUnitOfWork(connection.db).run((repos) => repos.detectionRules.insert(rule));

    const loaded = await repositories.detectionRules.findInWorkspace(t.workspaceId, rule.id);
    expect(loaded?.toSnapshot()).toEqual(rule.toSnapshot());
    expect(await targetRows(rule.id)).toEqual([host.id]);

    await expect(repositories.detectionRules.insert(DetectionRule.register(MISSING_ID, details()))).rejects.toThrow();
  });

  it('rolls back the rule row when a target insert fails inside the transaction', async () => {
    const t = await tenant();
    // Bypasses the use case on purpose: the host FK fails after the rule row was inserted.
    const rule = DetectionRule.register(t.workspaceId, details({ name: 'Órfã', scope: 'SELECTED_HOSTS', targetHostIds: [MISSING_ID] }));
    await expect(new DrizzleUnitOfWork(connection.db).run((repos) => repos.detectionRules.insert(rule))).rejects.toThrow();
    expect(await repositories.detectionRules.findInWorkspace(t.workspaceId, rule.id)).toBeNull();
  });

  it('cascades targets on rule delete and restricts deleting a targeted host (409)', async () => {
    const t = await tenant();
    const host = await t.host('Alvo');
    const rule = DetectionRule.register(t.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: [host.id] }));
    await new DrizzleUnitOfWork(connection.db).run((repos) => repos.detectionRules.insert(rule));

    expect(await repositories.detectionRules.isHostTargeted(host.id)).toBe(true);
    await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, host.id)).rejects.toBeInstanceOf(ConflictError);

    expect(await repositories.detectionRules.deleteInWorkspace(t.workspaceId, rule.id)).toBe(true);
    expect(await targetRows(rule.id)).toEqual([]);
    expect(await repositories.hosts.deleteInWorkspace(t.workspaceId, host.id)).toBe(true);
  });

  it('paginates and filters in SQL with a stable order', async () => {
    const t = await tenant();
    const base = new Date('2026-05-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 25; i += 1) {
      const rule = DetectionRule.register(t.workspaceId, details({ name: `Regra ${i}`, enabled: i % 5 !== 0, severity: i % 2 ? 'HIGH' : 'LOW' }), new Date(base + Math.floor(i / 4) * 1000));
      await repositories.detectionRules.insert(rule);
    }
    const pages = await Promise.all([1, 2, 3].map((page) => repositories.detectionRules.listInWorkspace(t.workspaceId, { page, pageSize: 10 })));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    const listed = pages.flatMap((page) => page.items.map((item) => item.toSnapshot()));
    const sorted = [...listed].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1));
    expect(listed.map((item) => item.id)).toEqual(sorted.map((item) => item.id));

    expect((await repositories.detectionRules.listInWorkspace(t.workspaceId, { page: 1, pageSize: 50, enabled: false })).total).toBe(5);
    expect((await repositories.detectionRules.listInWorkspace(t.workspaceId, { page: 1, pageSize: 50, severity: 'HIGH' })).total).toBe(12);
    expect((await repositories.detectionRules.listInWorkspace(t.workspaceId, { page: 1, pageSize: 50, search: 'regra 1' })).total).toBe(11);
  });

  it('keeps rules and targets workspace-isolated over HTTP; a failed update leaves targets intact', async () => {
    const a = await tenant();
    const b = await tenant();
    const hostA = await a.host('Host A');
    const hostB = await b.host('Host B');
    const payload = {
      name: 'Shell web',
      severity: 'HIGH',
      eventCategory: 'PROCESS',
      scope: 'SELECTED_HOSTS',
      hostIds: [hostA.id],
      definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
    };
    const ruleA = (await app.inject({ method: 'POST', url: a.rules, headers: a.headers, payload })).json<DetectionRuleResponse>();

    const statuses = await Promise.all([
      app.inject({ method: 'GET', url: `${a.rules}/${ruleA.id}`, headers: b.headers }),
      app.inject({ method: 'PUT', url: `${b.rules}/${ruleA.id}`, headers: b.headers, payload: { ...payload, hostIds: [hostB.id] } }),
      app.inject({ method: 'DELETE', url: `${a.rules}/${ruleA.id}`, headers: b.headers }),
      app.inject({ method: 'GET', url: a.rules, headers: b.headers }),
    ]);
    expect(statuses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);

    const retarget = await app.inject({ method: 'PUT', url: `${a.rules}/${ruleA.id}`, headers: a.headers, payload: { ...payload, hostIds: [hostA.id, hostB.id] } });
    expect(retarget.statusCode).toBe(400);
    expect(await targetRows(ruleA.id)).toEqual([hostA.id]);

    const listA = (await app.inject({ method: 'GET', url: a.rules, headers: a.headers })).json<PaginatedResponse<DetectionRuleSummary>>();
    expect(listA.items).toEqual([expect.objectContaining({ id: ruleA.id, targetCount: 1 })]);
    const hostDelete = await app.inject({ method: 'DELETE', url: `/workspaces/${a.workspaceId}/hosts/${hostA.id}`, headers: a.headers });
    expect(hostDelete.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/workspaces/${a.workspaceId}/hosts/${hostA.id}`, headers: a.headers })).json<HostResponse>().id).toBe(hostA.id);
  });
});
