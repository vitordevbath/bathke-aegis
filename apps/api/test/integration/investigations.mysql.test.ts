import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ConflictError } from '@aegis/domain';
import type { InvestigationResponse, InvestigationSummary, LoginResponse, PaginatedResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { createDatabase, type Database } from '../../src/infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { Host } from '../../src/domain/host.js';
import { Incident } from '../../src/domain/incident.js';
import { Investigation, type InvestigationDetails } from '../../src/domain/investigation.js';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const CONCLUSION = 'Falso positivo: atualização legítima do servidor.';

describe.skipIf(!TEST_DATABASE_URL)('investigations against MySQL (integration)', () => {
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

  const relationRows = async (investigationId: string) => {
    const [rows] = (await connection.db.execute(
      sql`SELECT incident_id FROM investigation_incidents WHERE investigation_id = ${investigationId} ORDER BY incident_id`,
    )) as unknown as [{ incident_id: string }[]];
    return rows.map((row) => row.incident_id);
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
      incident: async (title: string) => {
        const host = Host.register({ workspaceId, displayName: `host-${title}` });
        await repositories.hosts.insert(host);
        const incident = Incident.open(workspaceId, { title, severity: 'HIGH', hostIds: [host.id], detectionRuleIds: [] });
        await unitOfWork.run((repos) => repos.incidents.insert(incident));
        return incident;
      },
    };
  }

  const details = (incidentIds: string[], overrides: Partial<InvestigationDetails> = {}): InvestigationDetails => ({
    title: 'Atividade incomum nos servidores web',
    description: 'Linha 1\nLinha 2',
    incidentIds,
    ...overrides,
  });

  it('creates both tables from zero with the expected keys and foreign keys', async () => {
    const [rows] = (await connection.db.execute(sql`
      SELECT TABLE_NAME AS tableName, REFERENCED_TABLE_NAME AS referenced, DELETE_RULE AS onDelete
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('investigations', 'investigation_incidents')
      ORDER BY TABLE_NAME, REFERENCED_TABLE_NAME`)) as unknown as [{ tableName: string; referenced: string; onDelete: string }[]];
    expect(rows).toEqual([
      { tableName: 'investigation_incidents', referenced: 'incidents', onDelete: 'RESTRICT' },
      { tableName: 'investigation_incidents', referenced: 'investigations', onDelete: 'CASCADE' },
      { tableName: 'investigations', referenced: 'workspaces', onDelete: 'CASCADE' },
    ]);
  });

  it('round-trips an investigation with its incidents and enforces the workspace FK and the composite PK', async () => {
    const t = await tenant();
    const [i1, i2] = [await t.incident('Web 01'), await t.incident('Web 02')];
    const investigation = Investigation.open(t.workspaceId, details([i1.id, i2.id]));
    await unitOfWork.run((repos) => repos.investigations.insert(investigation));

    // Relations are sets: SQL returns them in id order.
    const loaded = await repositories.investigations.findInWorkspace(t.workspaceId, investigation.id);
    expect(loaded?.toSnapshot()).toEqual({ ...investigation.toSnapshot(), incidentIds: [i1.id, i2.id].sort() });
    expect(await relationRows(investigation.id)).toEqual([i1.id, i2.id].sort());
    await expect(repositories.investigations.insert(Investigation.open(MISSING_ID, details([i1.id])))).rejects.toThrow();
    await expect(
      connection.db.execute(sql`INSERT INTO investigation_incidents (investigation_id, incident_id, created_at) VALUES (${investigation.id}, ${i1.id}, NOW(3))`),
    ).rejects.toThrow();
  });

  it('rolls back the investigation row when a relation insert fails inside the transaction', async () => {
    const t = await tenant();
    const incident = await t.incident('Caso');
    // Bypasses the use case on purpose: the incident FK fails after the investigation row was inserted.
    const investigation = Investigation.open(t.workspaceId, details([incident.id, MISSING_ID]));
    await expect(unitOfWork.run((repos) => repos.investigations.insert(investigation))).rejects.toThrow();
    expect(await repositories.investigations.findInWorkspace(t.workspaceId, investigation.id)).toBeNull();
    expect(await relationRows(investigation.id)).toEqual([]);
  });

  it('persists the lifecycle, conclusion and closedAt (ms precision) and replaces relations', async () => {
    const t = await tenant();
    const [i1, i2] = [await t.incident('I1'), await t.incident('I2')];
    const investigation = Investigation.open(t.workspaceId, details([i1.id]));
    await unitOfWork.run((repos) => repos.investigations.insert(investigation));

    investigation.revise(details([i2.id], { conclusion: 'Rascunho' }));
    investigation.transitionTo('IN_PROGRESS');
    await unitOfWork.run((repos) => repos.investigations.update(investigation));
    expect((await repositories.investigations.findInWorkspace(t.workspaceId, investigation.id))?.toSnapshot()).toMatchObject({
      status: 'IN_PROGRESS',
      conclusion: 'Rascunho',
      closedAt: null,
      incidentIds: [i2.id],
    });
    expect(await relationRows(investigation.id)).toEqual([i2.id]);

    const closedAt = new Date('2026-06-01T12:34:56.789Z');
    investigation.revise(details([i1.id, i2.id], { conclusion: CONCLUSION }));
    investigation.transitionTo('CLOSED', closedAt);
    await unitOfWork.run((repos) => repos.investigations.update(investigation));
    const closed = await repositories.investigations.findInWorkspace(t.workspaceId, investigation.id);
    expect(closed?.toSnapshot()).toMatchObject({ status: 'CLOSED', conclusion: CONCLUSION, closedAt, createdAt: investigation.toSnapshot().createdAt });
  });

  it('cascades relations on investigation delete and restricts deleting a grouped incident (409)', async () => {
    const t = await tenant();
    const incident = await t.incident('Agrupado');
    const investigation = Investigation.open(t.workspaceId, details([incident.id]));
    await unitOfWork.run((repos) => repos.investigations.insert(investigation));

    expect(await repositories.investigations.isIncidentInvestigated(incident.id)).toBe(true);
    // Repository level: the FK RESTRICT itself answers, translated to a conflict.
    await expect(repositories.incidents.deleteInWorkspace(t.workspaceId, incident.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(repositories.incidents.deleteInWorkspace(t.workspaceId, incident.id)).rejects.toThrow(/faz parte de investigações/);

    expect(await repositories.investigations.deleteInWorkspace(t.workspaceId, investigation.id)).toBe(true);
    expect(await relationRows(investigation.id)).toEqual([]);
    expect(await repositories.investigations.isIncidentInvestigated(incident.id)).toBe(false);
    expect(await repositories.incidents.deleteInWorkspace(t.workspaceId, incident.id)).toBe(true);
  });

  it('paginates, searches literally and filters in SQL with a stable order', async () => {
    const t = await tenant();
    const incident = await t.incident('Comum');
    const base = new Date('2026-05-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 25; i += 1) {
      const investigation = Investigation.open(t.workspaceId, details([incident.id], { title: `Investigação ${i}` }), new Date(base + Math.floor(i / 4) * 1000));
      if (i % 5 === 0) investigation.transitionTo('IN_PROGRESS', new Date(base + 60_000));
      if (i === 24) {
        investigation.revise(details([incident.id], { title: 'Investigação 24', description: 'Origem 100%_externa', conclusion: 'Credencial reutilizada.' }));
        investigation.transitionTo('CLOSED', new Date(base + 120_000));
      }
      await unitOfWork.run((repos) => repos.investigations.insert(investigation));
    }
    const pages = await Promise.all([1, 2, 3].map((page) => repositories.investigations.listInWorkspace(t.workspaceId, { page, pageSize: 10 })));
    expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
    const listed = pages.flatMap((page) => page.items.map((item) => item.toSnapshot()));
    const sorted = [...listed].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1));
    expect(listed.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
    expect(new Set(listed.map((item) => item.id)).size).toBe(25);
    expect(listed.every((item) => item.incidentIds.length === 1)).toBe(true);

    const total = async (filter: object) => (await repositories.investigations.listInWorkspace(t.workspaceId, { page: 1, pageSize: 50, ...filter })).total;
    expect(await total({ status: 'IN_PROGRESS' })).toBe(5);
    expect(await total({ status: 'CLOSED' })).toBe(1);
    expect(await total({ status: 'OPEN' })).toBe(19);
    expect(await total({ search: 'investigação 1' })).toBe(11);
    expect(await total({ search: 'credencial' })).toBe(1);
    expect(await total({ search: '100%_' })).toBe(1);
    expect(await total({ search: '%' })).toBe(1);
    expect(await total({ search: '_' })).toBe(1);
  });

  it('keeps investigations workspace-isolated over HTTP; a failed update changes nothing; lifecycle and protection hold', async () => {
    const a = await tenant();
    const b = await tenant();
    const incidentA = await a.incident('Incidente A');
    const incidentB = await b.incident('Incidente B');
    const payload = { title: 'Atividade incomum', incidentIds: [incidentA.id] };
    const created = await app.inject({ method: 'POST', url: `${a.base}/investigations`, headers: a.headers, payload });
    expect(created.statusCode).toBe(201);
    const investigationA = created.json<InvestigationResponse>();
    const url = `${a.base}/investigations/${investigationA.id}`;

    const statuses = await Promise.all([
      app.inject({ method: 'GET', url, headers: b.headers }),
      app.inject({ method: 'PUT', url: `${b.base}/investigations/${investigationA.id}`, headers: b.headers, payload: { ...payload, incidentIds: [incidentB.id] } }),
      app.inject({ method: 'DELETE', url, headers: b.headers }),
      app.inject({ method: 'GET', url: `${a.base}/investigations`, headers: b.headers }),
      app.inject({ method: 'POST', url: `${b.base}/investigations`, headers: b.headers, payload }),
    ]);
    expect(statuses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 400]);

    const crossed = await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, incidentIds: [incidentA.id, incidentB.id], conclusion: CONCLUSION, status: 'CLOSED' } });
    expect(crossed.statusCode).toBe(400);
    expect(await relationRows(investigationA.id)).toEqual([incidentA.id]);
    expect((await app.inject({ method: 'GET', url, headers: a.headers })).json<InvestigationResponse>()).toEqual(investigationA);

    const noConclusion = await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, status: 'CLOSED' } });
    expect(noConclusion.statusCode).toBe(400);
    const closed = await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, conclusion: CONCLUSION, status: 'CLOSED' } });
    expect(closed.json<InvestigationResponse>()).toMatchObject({ status: 'CLOSED', availableTransitions: [] });
    expect((await app.inject({ method: 'PUT', url, headers: a.headers, payload: { ...payload, conclusion: CONCLUSION } })).statusCode).toBe(409);

    const listA = (await app.inject({ method: 'GET', url: `${a.base}/investigations`, headers: a.headers })).json<PaginatedResponse<InvestigationSummary>>();
    expect(listA.items).toEqual([expect.objectContaining({ id: investigationA.id, incidentCount: 1, status: 'CLOSED', closedAt: expect.any(String) })]);
    expect((await app.inject({ method: 'DELETE', url: `${a.base}/incidents/${incidentA.id}`, headers: a.headers })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `${a.base}/incidents/${incidentA.id}`, headers: b.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url, headers: a.headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `${a.base}/incidents/${incidentA.id}`, headers: a.headers })).statusCode).toBe(204);
  });
});
