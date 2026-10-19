import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ConflictError } from '@aegis/domain';
import type { DetectionRuleResponse, IncidentResponse, IncidentSummary, LoginResponse, PaginatedResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { DetectionRule } from '../../src/domain/detection-rule.js';
import { Host } from '../../src/domain/host.js';
import { Incident, type IncidentDetails } from '../../src/domain/incident.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!TEST_DATABASE_URL)('incidents against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let closeApp: () => Promise<void>;
  let connection: { db: Database; close: () => Promise<void> };
  let repositories: Repositories;
  let unitOfWork: DrizzleUnitOfWork;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000' });
    const production = createProductionDependencies(env);
    closeApp = production.close;
    app = await buildApp(production.dependencies);
    connection = createDatabase(database.url);
    repositories = createDrizzleRepositories(connection.db);
    unitOfWork = new DrizzleUnitOfWork(connection.db);
  });

  afterAll(async () => {
    await app?.close();
    await closeApp?.();
    await connection?.close();
    await database?.drop();
  });

  const relationRows = async (incidentId: string) => {
    const [hostRows] = (await connection.db.execute(sql`SELECT host_id FROM incident_hosts WHERE incident_id = ${incidentId} ORDER BY host_id`)) as unknown as [
      { host_id: string }[],
    ];
    const [ruleRows] = (await connection.db.execute(
      sql`SELECT detection_rule_id FROM incident_detection_rules WHERE incident_id = ${incidentId} ORDER BY detection_rule_id`,
    )) as unknown as [{ detection_rule_id: string }[]];
    return { hosts: hostRows.map((row) => row.host_id), rules: ruleRows.map((row) => row.detection_rule_id) };
  };

  async function tenant() {
    const registration = makeRegistration();
    await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    const session = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })).json<LoginResponse>();
    const workspaceId = session.workspaces[0]?.id ?? '';
    return {
      workspaceId,
      headers: bearer(session.token),
      base: `/workspaces/${workspaceId}`,
      host: async (displayName: string) => {
        const host = Host.register({ workspaceId, displayName });
        await repositories.hosts.insert(host);
        return host;
      },
      rule: async (name: string) => {
        const rule = DetectionRule.register(workspaceId, {
          name,
          severity: 'HIGH',
          enabled: true,
          eventCategory: 'PROCESS',
          scope: 'ALL_HOSTS',
          targetHostIds: [],
          definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
        });
        await unitOfWork.run((repos) => repos.detectionRules.insert(rule));
        return rule;
      },
    };
  }

  const details = (hostIds: string[], detectionRuleIds: string[] = [], overrides: Partial<IncidentDetails> = {}): IncidentDetails => ({
    title: 'Shell inesperado no servidor web',
    description: 'Linha 1\nLinha 2',
    severity: 'HIGH',
    hostIds,
    detectionRuleIds,
    ...overrides,
  });

  it('round-trips an incident with both relations and enforces the workspace FK', async () => {
    const t = await tenant();
    const [h1, h2, rule] = [await t.host('Web 01'), await t.host('Web 02'), await t.rule('Shell web')];
    const incident = Incident.open(t.workspaceId, details([h1.id, h2.id], [rule.id]));
    await unitOfWork.run((repos) => repos.incidents.insert(incident));

    // Relations are sets: SQL returns them in id order.
    const loaded = await repositories.incidents.findInWorkspace(t.workspaceId, incident.id);
    expect(loaded?.toSnapshot()).toEqual({ ...incident.toSnapshot(), hostIds: [h1.id, h2.id].sort() });
    expect(await relationRows(incident.id)).toEqual({ hosts: [h1.id, h2.id].sort(), rules: [rule.id] });
    await expect(repositories.incidents.insert(Incident.open(MISSING_ID, details([h1.id])))).rejects.toThrow();
  });

  it('rolls back the incident row when a relation insert fails inside the transaction', async () => {
    const t = await tenant();
    const host = await t.host('Servidor');
    // Bypasses the use case on purpose: the rule FK fails after the incident row and its hosts were inserted.
    const incident = Incident.open(t.workspaceId, details([host.id], [MISSING_ID]));
    await expect(unitOfWork.run((repos) => repos.incidents.insert(incident))).rejects.toThrow();
    expect(await repositories.incidents.findInWorkspace(t.workspaceId, incident.id)).toBeNull();
    expect(await relationRows(incident.id)).toEqual({ hosts: [], rules: [] });
  });

  it('persists status and resolvedAt (ms precision), replaces relations, never rewrites origin', async () => {
    const t = await tenant();
    const [h1, h2, rule] = [await t.host('H1'), await t.host('H2'), await t.rule('Relacionada')];
    const incident = Incident.open(t.workspaceId, details([h1.id], [rule.id]));
    await unitOfWork.run((repos) => repos.incidents.insert(incident));

    const resolvedAt = new Date('2026-06-01T12:34:56.789Z');
    incident.revise(details([h2.id], []));
    incident.transitionTo('RESOLVED', resolvedAt);
    await unitOfWork.run((repos) => repos.incidents.update(incident));

    const loaded = await repositories.incidents.findInWorkspace(t.workspaceId, incident.id);
    expect(loaded?.toSnapshot()).toMatchObject({ status: 'RESOLVED', origin: 'MANUAL', resolvedAt, hostIds: [h2.id], detectionRuleIds: [] });
    expect(await relationRows(incident.id)).toEqual({ hosts: [h2.id], rules: [] });

    loaded?.transitionTo('INVESTIGATING');
    if (loaded) await unitOfWork.run((repos) => repos.incidents.update(loaded));
    expect((await repositories.incidents.findInWorkspace(t.workspaceId, incident.id))?.resolvedAt).toBeNull();
  });

  it('cascades relations on incident delete and restricts deleting a related host or rule (409)', async () => {
    const t = await tenant();
    const [host, rule] = [await t.host('Envolvido'), await t.rule('Relacionada')];
    const incident = Incident.open(t.workspaceId, details([host.id], [rule.id]));
    await unitOfWork.run((repos) => repos.incidents.insert(incident));

    expect(await repositories.incidents.isHostInvolved(host.id)).toBe(true);
    expect(await repositories.incidents.isRuleRelated(rule.id)).toBe(true);
    // Repository level: the FK RESTRICT itself answers, translated to a conflict.
    await expect(repositories.hosts.deleteInWorkspace(t.workspaceId, host.id)).rejects.toThrow(/envolvido em incidentes/);
    await expect(repositories.detectionRules.deleteInWorkspace(t.workspaceId, rule.id)).rejects.toBeInstanceOf(ConflictError);

    expect(await repositories.incidents.deleteInWorkspace(t.workspaceId, incident.id)).toBe(true);
    expect(await relationRows(incident.id)).toEqual({ hosts: [], rules: [] });
    expect(await repositories.hosts.deleteInWorkspace(t.workspaceId, host.id)).toBe(true);
    expect(await repositories.detectionRules.deleteInWorkspace(t.workspaceId, rule.id)).toBe(true);
  });

  it('paginates and filters in SQL with a stable order', async () => {
    const t = await tenant();
    const host = await t.host('Servidor');
    const base = new Date('2026-05-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 25; i += 1) {
      const incident = Incident.open(t.workspaceId, details([host.id], [], { title: `Incidente ${i}`, severity: i % 2 ? 'HIGH' : 'LOW' }), new Date(base + Math.floor(i / 4) * 1000));
      if (i % 5 === 0) incident.transitionTo('INVESTIGATING', new Date(base + 60_000));
      await unitOfWork.run((repos) => repos.incidents.insert(incident));
    }
    const pages = await Promise.all([1, 2, 3].map((page) => repositories.incidents.listInWorkspace(t.workspaceId, { page, pageSize: 10 })));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    const listed = pages.flatMap((page) => page.items.map((item) => item.toSnapshot()));
    const sorted = [...listed].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1));
    expect(listed.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
    expect(listed.every((item) => item.hostIds.length === 1)).toBe(true);

    const total = async (filter: object) => (await repositories.incidents.listInWorkspace(t.workspaceId, { page: 1, pageSize: 50, ...filter })).total;
    expect(await total({ status: 'INVESTIGATING' })).toBe(5);
    expect(await total({ severity: 'HIGH' })).toBe(12);
    expect(await total({ status: 'OPEN', severity: 'LOW' })).toBe(10);
    expect(await total({ search: 'incidente 1' })).toBe(11);
    expect(await total({ origin: 'DETECTION_ENGINE' })).toBe(0);
  });

  it('keeps incidents and their relations workspace-isolated over HTTP; a failed update changes nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, ruleA] = [await a.host('Host A'), await a.rule('Regra A')];
    const [hostB, ruleB] = [await b.host('Host B'), await b.rule('Regra B')];
    const payload = { title: 'Shell web', severity: 'HIGH', hostIds: [hostA.id], detectionRuleIds: [ruleA.id] };
    const created = await app.inject({ method: 'POST', url: `${a.base}/incidents`, headers: a.headers, payload });
    expect(created.statusCode).toBe(201);
    const incidentA = created.json<IncidentResponse>();
    const url = `${a.base}/incidents/${incidentA.id}`;

    const statuses = await Promise.all([
      app.inject({ method: 'GET', url, headers: b.headers }),
      app.inject({ method: 'PUT', url: `${b.base}/incidents/${incidentA.id}`, headers: b.headers, payload: { ...payload, hostIds: [hostB.id] } }),
      app.inject({ method: 'DELETE', url, headers: b.headers }),
      app.inject({ method: 'GET', url: `${a.base}/incidents`, headers: b.headers }),
    ]);
    expect(statuses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);

    for (const changes of [{ hostIds: [hostA.id, hostB.id] }, { detectionRuleIds: [ruleB.id] }]) {
      const response = await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, ...changes, status: 'RESOLVED' } });
      expect(response.statusCode).toBe(400);
    }
    expect(await relationRows(incidentA.id)).toEqual({ hosts: [hostA.id], rules: [ruleA.id] });
    expect((await app.inject({ method: 'GET', url, headers: a.headers })).json<IncidentResponse>()).toEqual(incidentA);

    const invalid = await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, status: 'CLOSED' } });
    expect(invalid.statusCode).toBe(409);

    const listA = (await app.inject({ method: 'GET', url: `${a.base}/incidents`, headers: a.headers })).json<PaginatedResponse<IncidentSummary>>();
    expect(listA.items).toEqual([expect.objectContaining({ id: incidentA.id, hostCount: 1, ruleCount: 1, status: 'OPEN' })]);
    const ruleDelete = await app.inject({ method: 'DELETE', url: `${a.base}/detection-rules/${ruleA.id}`, headers: a.headers });
    expect(ruleDelete.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `${a.base}/detection-rules/${ruleA.id}`, headers: a.headers })).json<DetectionRuleResponse>().id).toBe(ruleA.id);
  });
});
