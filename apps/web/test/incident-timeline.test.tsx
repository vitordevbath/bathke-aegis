import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AlertResponse, EventSummary, IncidentActivityResponse, IncidentResponse, IncidentTimelineResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { buildTimelineRows, CONTEXT_RUN_MIN, describeActivity } from '../src/features/incidents/timeline/timeline-model';
import { buildIncidentGraph, GRAPH_MAX_ALERTS, lineageOf } from '../src/features/incidents/timeline/graph-model';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 13, minute, 0)).toISOString();
// Same formatter as the graph, so the expectation holds in any time zone.
const hms = (iso: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

const incident = (overrides: Partial<IncidentResponse> = {}): IncidentResponse => ({
  id: id(1),
  workspaceId: WS,
  title: 'sshd mudou de estado em srv-web-01',
  description: null,
  severity: 'HIGH',
  status: 'OPEN',
  origin: 'DETECTION_ENGINE',
  hostCount: 1,
  ruleCount: 1,
  createdAt: at(10),
  updatedAt: at(10),
  resolvedAt: null,
  hosts: [{ hostId: id(101), displayName: 'srv-web-01', connectionState: 'ONLINE' }],
  detectionRules: [{ ruleId: id(201), name: 'sshd mudou de estado', severity: 'HIGH', enabled: true }],
  availableTransitions: ['INVESTIGATING', 'RESOLVED'],
  ...overrides,
});

const alert = (n: number, minute: number, severity: AlertResponse['severity'] = 'HIGH'): AlertResponse => ({
  id: id(300 + n),
  workspaceId: WS,
  severity,
  occurredAt: at(minute),
  createdAt: at(minute),
  rule: { id: id(201), name: 'sshd mudou de estado' },
  host: { id: id(101), displayName: 'srv-web-01' },
  event: { id: id(400 + n), type: 'SYSTEM_SERVICE_STATE_CHANGED', summary: `sshd parou (${n})` },
  incident: { id: id(1), title: 'sshd mudou de estado em srv-web-01' },
});

const event = (n: number, minute: number): EventSummary => ({
  id: id(500 + n),
  workspaceId: WS,
  hostId: id(101),
  hostDisplayName: 'srv-web-01',
  category: 'SYSTEM',
  type: 'SYSTEM_SERVICE_STATE_CHANGED',
  occurredAt: at(minute),
  ingestedAt: at(minute),
  summary: `cron mudou (${n})`,
});

const activity = (n: number, minute: number, overrides: Partial<IncidentActivityResponse> = {}): IncidentActivityResponse => ({
  id: id(600 + n),
  kind: 'OPENED',
  actor: { kind: 'DETECTION_ENGINE', name: null },
  createdAt: at(minute),
  from: null,
  to: null,
  fields: null,
  investigation: null,
  ...overrides,
});

const timeline = (overrides: Partial<IncidentTimelineResponse> = {}): IncidentTimelineResponse => ({
  incident: incident(),
  activities: [
    activity(1, 10),
    activity(2, 20, { kind: 'STATUS_CHANGED', actor: { kind: 'USER', name: 'Ana Teste' }, from: 'OPEN', to: 'INVESTIGATING' }),
    activity(3, 25, { kind: 'INVESTIGATION_LINKED', actor: { kind: 'USER', name: 'Ana Teste' }, investigation: { id: id(700), title: 'Reinícios do web' } }),
  ],
  alerts: [alert(1, 10), alert(2, 12, 'CRITICAL')],
  alertsTruncated: false,
  context: [event(1, 1), event(2, 2), event(3, 3), event(4, 4), event(5, 11)],
  contextTruncated: false,
  contextWindow: { from: at(0), to: at(30) },
  investigations: [{ investigationId: id(700), title: 'Reinícios do web', status: 'IN_PROGRESS' }],
  ...overrides,
});

describe('timeline model', () => {
  it('merges history, alerts and nearby events in order, folding long runs of context', () => {
    const rows = buildTimelineRows(timeline(), 'all');
    const shape = rows.filter((row) => row.type !== 'day').map((row) => (row.type === 'context-run' ? `run:${row.events.length}` : row.entry.id.split(':')[0]));
    // Window start, 4 folded events, alert + opening at :10, the lone event at :11, alert at :12, then history.
    expect(shape).toEqual(['boundary', `run:${CONTEXT_RUN_MIN}`, 'alert', 'activity', 'event', 'alert', 'activity', 'activity']);
  });

  it('shows only the chosen kind, without folding when context is asked for', () => {
    expect(buildTimelineRows(timeline(), 'alerts').filter((row) => row.type === 'entry')).toHaveLength(2);
    const context = buildTimelineRows(timeline(), 'context');
    expect(context.some((row) => row.type === 'context-run')).toBe(false);
    expect(context.filter((row) => row.type === 'entry' && row.entry.kind === 'context')).toHaveLength(5);
  });

  it('closes the window only for a resolved incident', () => {
    const resolved = timeline({ incident: incident({ status: 'RESOLVED', resolvedAt: at(30) }) });
    expect(buildTimelineRows(resolved, 'all').at(-1)).toMatchObject({ type: 'entry', entry: { kind: 'boundary', boundary: 'window-end' } });
    expect(buildTimelineRows(timeline(), 'all').some((row) => row.type === 'entry' && row.entry.id === 'boundary:end')).toBe(false);
  });

  it('describes each kind of history entry in plain words', () => {
    const user = { kind: 'USER', name: 'Ana Teste' } as const;
    expect(describeActivity(activity(1, 0))).toBe('Incidente aberto pelo motor');
    expect(describeActivity(activity(1, 0, { kind: 'SEVERITY_CHANGED', actor: user, from: 'MEDIUM', to: 'CRITICAL' }))).toBe('Severidade: Média → Crítica');
    expect(describeActivity(activity(1, 0, { kind: 'DETAILS_UPDATED', actor: user, fields: ['title', 'hostIds', 'description'] }))).toBe(
      'Editou título, hosts envolvidos e descrição',
    );
    expect(describeActivity(activity(1, 0, { kind: 'INVESTIGATION_CLOSED', actor: user, investigation: { id: null, title: 'Caso' } }))).toBe(
      'Investigação “Caso” concluída',
    );
  });
});

describe('relation graph model', () => {
  it('lays the causal chain out in columns and links each alert to its event, rule and incident', () => {
    const graph = buildIncidentGraph(timeline());
    expect(graph.columns.map((column) => column.title)).toEqual(['Hosts', 'Eventos', 'Regras', 'Alertas', 'Incidente', 'Investigações']);
    expect(graph.edges.map((edge) => edge.id)).toEqual(
      expect.arrayContaining([
        `host:${id(101)}->event:${id(401)}`,
        `event:${id(401)}->alert:${id(301)}`,
        `rule:${id(201)}->alert:${id(301)}`,
        `alert:${id(301)}->incident:${id(1)}`,
        `incident:${id(1)}->investigation:${id(700)}`,
      ]),
    );
    expect(graph.edges.every((edge) => !edge.declared)).toBe(true);
  });

  it('draws hand-recorded relations of a manual incident as declared edges', () => {
    const graph = buildIncidentGraph(timeline({ incident: incident({ origin: 'MANUAL' }), alerts: [], investigations: [] }));
    expect(graph.columns.map((column) => column.kind)).toEqual(['host', 'rule', 'incident']);
    expect(graph.edges.map((edge) => [edge.id, edge.declared])).toEqual([
      [`host:${id(101)}->incident:${id(1)}`, true],
      [`rule:${id(201)}->incident:${id(1)}`, true],
    ]);
  });

  it('folds alerts beyond the cap into one node that links to the full list', () => {
    const alerts = Array.from({ length: GRAPH_MAX_ALERTS + 3 }, (_, n) => alert(n, n));
    const graph = buildIncidentGraph(timeline({ alerts }));
    expect(graph.nodes.filter((node) => node.kind === 'alert')).toHaveLength(GRAPH_MAX_ALERTS);
    expect(graph.nodes.find((node) => node.kind === 'more-alerts')).toMatchObject({ label: '+3 alertas', href: `/alertas?incidentId=${id(1)}` });
  });

  it('lights one causal chain: what led to a node and what it led to, not its siblings', () => {
    const graph = buildIncidentGraph(timeline());
    const { nodes } = lineageOf(graph, `alert:${id(301)}`);
    expect([...nodes].sort()).toEqual(
      [`alert:${id(301)}`, `event:${id(401)}`, `host:${id(101)}`, `rule:${id(201)}`, `incident:${id(1)}`, `investigation:${id(700)}`].sort(),
    );
    expect(nodes.has(`alert:${id(302)}`)).toBe(false);
  });
});

describe('incident reconstruction on the incident page', () => {
  const INCIDENT = `/api/workspaces/${WS}/incidents/${id(1)}`;
  const setup = (data = timeline()) => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
    return mockApi({
      'GET /api/users/me': () => ({ status: 200, body: ME }),
      [`GET ${INCIDENT}`]: () => ({ status: 200, body: data.incident }),
      [`GET ${INCIDENT}/timeline`]: () => ({ status: 200, body: data }),
      [`GET /api/workspaces/${WS}/alerts/${id(301)}`]: () => ({ status: 200, body: alert(1, 10) }),
    });
  };

  it('shows the timeline with filters, folded context and links', async () => {
    setup();
    const { user } = renderApp(`/incidentes/${id(1)}`);
    const section = await screen.findByRole('region', { name: 'Reconstrução' });
    await within(section).findByText('Incidente aberto pelo motor');
    expect(within(section).getByText('Status: Aberto → Em investigação')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Entrou na investigação “Reinícios do web”' }).getAttribute('href')).toBe(`/investigacoes/${id(700)}`);
    expect(within(section).getByRole('link', { name: 'sshd parou (2)' }).getAttribute('href')).toBe(`/alertas/${id(302)}`);

    await user.click(within(section).getByRole('button', { name: /4 eventos dos hosts envolvidos/ }));
    expect(within(section).getByRole('link', { name: 'cron mudou (1)' })).toBeTruthy();

    await user.click(within(section).getByRole('button', { name: /Histórico/ }));
    expect(within(section).queryByText('sshd parou (1)')).toBeNull();
    expect(within(section).getByRole('button', { name: /Histórico/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to the relation graph with the keyboard, lights a chain and opens a record with Enter', async () => {
    const fetchMock = setup();
    const { user } = renderApp(`/incidentes/${id(1)}`);
    const section = await screen.findByRole('region', { name: 'Reconstrução' });
    const tab = within(section).getByRole('tab', { name: 'Linha do tempo' });
    tab.focus();
    await user.keyboard('{ArrowRight}');
    const graphTab = within(section).getByRole('tab', { name: 'Relações' });
    expect(graphTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(graphTab);

    const alertNode = within(section).getByRole('link', { name: `Alerta · ${hms(at(10))}: sshd parou (1), severidade alta` });
    fireEvent.focus(alertNode);
    expect(alertNode.getAttribute('class')).toContain('is-lit');
    expect(within(section).getByRole('link', { name: `Alerta · ${hms(at(12))}: sshd parou (2), severidade crítica` }).getAttribute('class')).toContain('is-dim');

    fireEvent.keyDown(alertNode, { key: 'Enter' });
    await waitFor(() => expect(calledUrls(fetchMock, 'GET', `/api/workspaces/${WS}/alerts/${id(301)}`)).toHaveLength(1));
  });
});
