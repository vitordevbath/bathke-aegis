import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AlertResponse, HostResponse, IncidentResponse, IncidentTimelineResponse, InvestigationResponse, PaginatedResponse } from '@aegis/contracts';
import { INCIDENT_TIMELINE_LIMITS } from '@aegis/domain';
import { bearer, buildTestApp, pairHost, signedInUser } from '../support/test-app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = (await buildTestApp()).app;
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

const CONCLUSION = 'Reinício planejado pela equipe de infraestrutura, confirmado no registro de mudanças.';

async function tenant() {
  const { token, session, registration } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });
  const host = async (displayName = `host-${Math.random().toString(36).slice(2, 8)}`) => (await call('POST', `${base}/hosts`, { displayName })).json<HostResponse>();
  const tokens = new Map<string, string>();
  const ingest = async (hostId: string, events: unknown[]) => {
    const machine = tokens.get(hostId) ?? (await pairHost(app, token, workspaceId, hostId)).token;
    tokens.set(hostId, machine);
    const response = await app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/events/ingest`, headers: bearer(machine), payload: { events } });
    expect(response.statusCode).toBe(200);
  };
  const sshdRule = async () =>
    (
      await call('POST', `${base}/detection-rules`, {
        name: 'sshd mudou de estado',
        severity: 'HIGH',
        enabled: true,
        eventCategory: 'SYSTEM',
        scope: 'ALL_HOSTS',
        hostIds: [],
        definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.serviceName', operator: 'EQUALS', value: 'sshd' }] },
      })
    ).json<{ id: string }>();
  const incident = async (hostIds: string[], title = 'Acesso estranho') =>
    (await call('POST', `${base}/incidents`, { title, severity: 'MEDIUM', hostIds, detectionRuleIds: [] })).json<IncidentResponse>();
  const timeline = async (incidentId: string) => {
    const response = await call('GET', `${base}/incidents/${incidentId}/timeline`);
    expect(response.statusCode).toBe(200);
    return response.json<IncidentTimelineResponse>();
  };
  const keep = (current: IncidentResponse, changes: Record<string, unknown> = {}) => ({
    title: current.title,
    description: current.description,
    severity: current.severity,
    hostIds: current.hosts.map((item) => item.hostId),
    detectionRuleIds: current.detectionRules.map((item) => item.ruleId),
    ...changes,
  });
  return { name: registration.name, workspaceId, base, call, host, ingest, sshdRule, incident, timeline, keep };
}

describe('incident timeline (ADR-054)', () => {
  it('reconstructs an engine incident: opening by the engine, its alerts and the other events of the host', async () => {
    const a = await tenant();
    const host = await a.host('srv-web-01');
    await a.sshdRule();
    await a.ingest(host.id, [service('cron'), service('sshd')]);
    const [alert] = (await a.call('GET', `${a.base}/alerts`)).json<PaginatedResponse<AlertResponse>>().items;

    const timeline = await a.timeline(alert?.incident?.id ?? '');
    expect(timeline.incident).toMatchObject({ origin: 'DETECTION_ENGINE', title: 'sshd mudou de estado em srv-web-01' });
    expect(timeline.activities).toEqual([expect.objectContaining({ kind: 'OPENED', actor: { kind: 'DETECTION_ENGINE', name: null } })]);
    expect(timeline.alerts.map((item) => item.id)).toEqual([alert?.id]);
    // The matched event appears once, through its alert; the other one is context.
    expect(timeline.context.map((event) => event.summary)).toEqual([expect.stringContaining('cron')]);
    expect(timeline).toMatchObject({ alertsTruncated: false, contextTruncated: false, investigations: [] });
  });

  it('records who opened and what each edit changed, and nothing for an untouched save', async () => {
    const a = await tenant();
    const host = await a.host();
    const created = await a.incident([host.id]);
    const url = `${a.base}/incidents/${created.id}`;

    const edited = (await a.call('PUT', url, a.keep(created, { title: 'Acesso estranho no web', severity: 'CRITICAL', status: 'INVESTIGATING' }))).json<IncidentResponse>();
    expect((await a.call('PUT', url, a.keep(edited))).statusCode).toBe(200);

    const { activities } = await a.timeline(created.id);
    expect(activities.map((entry) => [entry.kind, entry.from, entry.to, entry.fields])).toEqual([
      ['OPENED', null, null, null],
      ['STATUS_CHANGED', 'OPEN', 'INVESTIGATING', null],
      ['SEVERITY_CHANGED', 'MEDIUM', 'CRITICAL', null],
      ['DETAILS_UPDATED', null, null, ['title']],
    ]);
    expect(activities.every((entry) => entry.actor.kind === 'USER' && entry.actor.name === a.name)).toBe(true);
  });

  it('follows investigations: linked, closed, unlinked and deleted, keeping the title it had', async () => {
    const a = await tenant();
    const host = await a.host();
    const [first, second] = [await a.incident([host.id], 'Primeiro'), await a.incident([host.id], 'Segundo')];
    const created = (await a.call('POST', `${a.base}/investigations`, { title: 'Reinícios do web', incidentIds: [first.id, second.id] })).json<InvestigationResponse>();
    const url = `${a.base}/investigations/${created.id}`;
    const body = { title: 'Reinícios do web', description: null, conclusion: CONCLUSION, incidentIds: [first.id] };
    expect((await a.call('PUT', url, { ...body, status: 'IN_PROGRESS' })).statusCode).toBe(200);
    expect((await a.call('PUT', url, { ...body, status: 'CLOSED' })).statusCode).toBe(200);

    const linked = await a.timeline(first.id);
    expect(linked.activities.map((entry) => entry.kind)).toEqual(['OPENED', 'INVESTIGATION_LINKED', 'INVESTIGATION_CLOSED']);
    expect(linked.activities[1]?.investigation).toEqual({ id: created.id, title: 'Reinícios do web' });
    expect(linked.investigations).toEqual([{ investigationId: created.id, title: 'Reinícios do web', status: 'CLOSED' }]);
    expect((await a.timeline(second.id)).activities.map((entry) => entry.kind)).toEqual(['OPENED', 'INVESTIGATION_LINKED', 'INVESTIGATION_UNLINKED']);

    expect((await a.call('DELETE', url)).statusCode).toBe(204);
    const after = await a.timeline(first.id);
    expect(after.investigations).toEqual([]);
    expect(after.activities.at(-1)).toMatchObject({ kind: 'INVESTIGATION_UNLINKED', investigation: { id: null, title: 'Reinícios do web' } });
    expect(after.activities.filter((entry) => entry.investigation).every((entry) => entry.investigation?.id === null)).toBe(true);
  });

  it('limits context to the involved hosts and the incident window, and flags a cut list', async () => {
    const a = await tenant();
    const [involved, other] = [await a.host(), await a.host()];
    const old = new Date(Date.now() - INCIDENT_TIMELINE_LIMITS.contextPaddingMs - 60_000).toISOString();
    await a.ingest(involved.id, [service('antigo', old), ...Array.from({ length: 60 }, () => service('nginx'))]);
    await a.ingest(involved.id, Array.from({ length: 60 }, () => service('postgres')));
    await a.ingest(other.id, [service('outro-host')]);
    const created = await a.incident([involved.id]);

    const timeline = await a.timeline(created.id);
    expect(timeline.context).toHaveLength(INCIDENT_TIMELINE_LIMITS.contextEvents);
    expect(timeline.contextTruncated).toBe(true);
    expect(timeline.context.every((event) => event.hostId === involved.id && !event.summary.includes('antigo'))).toBe(true);
    const times = timeline.context.map((event) => event.occurredAt);
    expect([...times].sort()).toEqual(times);
  });

  it('is readable by any member and invisible to other workspaces (404)', async () => {
    const [a, b] = [await tenant(), await tenant()];
    const created = await a.incident([(await a.host()).id]);
    expect((await b.call('GET', `${a.base}/incidents/${created.id}/timeline`)).statusCode).toBe(404);
    expect((await b.call('GET', `${b.base}/incidents/${created.id}/timeline`)).statusCode).toBe(404);
    expect((await a.call('GET', `${a.base}/incidents/${randomUUID()}/timeline`)).statusCode).toBe(404);
  });
});
