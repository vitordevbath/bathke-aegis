import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { DetectionRuleSummary, HostResponse, IncidentResponse, IncidentSummary, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp, requestBody } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const INCIDENTS = `/api/workspaces/${WS}/incidents`;
const HOSTS = `/api/workspaces/${WS}/hosts`;
const RULES = `/api/workspaces/${WS}/detection-rules`;
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const signedIn = () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: ME }) };
};

const host = (n: number): HostResponse => ({
  id: id(100 + n),
  workspaceId: WS,
  displayName: `servidor-web-0${n}`,
  description: null,
  agentId: null,
  hostname: null,
  osName: null,
  osVersion: null,
  architecture: null,
  connectionState: 'UNPAIRED',
  lastSeenAt: null,
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
});

const ruleSummary = (n: number, overrides: Partial<DetectionRuleSummary> = {}): DetectionRuleSummary => ({
  id: id(200 + n),
  workspaceId: WS,
  name: `Regra ${n}`,
  description: null,
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  targetCount: 0,
  conditionCount: 1,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

const incident = (n: number, overrides: Partial<IncidentResponse> = {}): IncidentResponse => ({
  id: id(n),
  workspaceId: WS,
  title: `Shell inesperado ${n}`,
  description: 'Linha 1\nLinha 2 <b>sem HTML</b>',
  severity: 'HIGH',
  status: 'OPEN',
  origin: 'MANUAL',
  hostCount: 1,
  ruleCount: 1,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  resolvedAt: null,
  hosts: [{ hostId: id(101), displayName: 'servidor-web-01', connectionState: 'UNPAIRED' }],
  detectionRules: [{ ruleId: id(201), name: 'Regra 1', severity: 'HIGH', enabled: false }],
  availableTransitions: ['INVESTIGATING', 'RESOLVED'],
  ...overrides,
});

const page = <T,>(items: T[], meta: Partial<PaginatedResponse<T>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});
const summary = ({ description: _d, hosts: _h, detectionRules: _r, availableTransitions: _a, ...rest }: IncidentResponse): IncidentSummary => rest;

/** The selectors on the form load the workspace's hosts and rules. */
const formData = (hosts: HostResponse[] = [host(1), host(2)], rules: DetectionRuleSummary[] = [ruleSummary(1), ruleSummary(2, { enabled: false })]) => ({
  [`GET ${HOSTS}`]: () => page(hosts),
  [`GET ${RULES}`]: () => page(rules),
});

describe('incidents list', () => {
  it('shows an honest empty state and the manual-registration notice', async () => {
    mockApi({ ...signedIn(), [`GET ${INCIDENTS}`]: () => page([]) });
    renderApp('/incidentes');

    expect(await screen.findByText('Nenhum incidente registrado.')).toBeTruthy();
    expect(screen.getByText(/enquanto o mecanismo automático de correlação ainda não está ativo/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('registrados manualmente');
    expect(screen.queryByText(/ameaça/i)).toBeNull();
  });

  it('lists title, severity and status as text, origin, host and rule counts', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${INCIDENTS}`]: () =>
        page([
          summary(incident(1, { severity: 'CRITICAL', status: 'INVESTIGATING', hostCount: 2, ruleCount: 0 })),
          summary(incident(2, { severity: 'LOW', status: 'CLOSED', resolvedAt: '2026-05-02T10:00:00.000Z' })),
        ]),
    });
    renderApp('/incidentes');

    const list = await screen.findByRole('list', { name: 'Incidentes' });
    const [first, second] = within(list).getAllByRole('link');
    expect(first?.getAttribute('href')).toBe(`/incidentes/${id(1)}`);
    expect(first?.textContent).toContain('Shell inesperado 1');
    expect(first?.textContent).toContain('Crítica');
    expect(first?.textContent).toContain('Em investigação');
    expect(first?.textContent).toContain('Manual · 2 hosts · 0 regras');
    expect(second?.textContent).toContain('Encerrado');
    expect(second?.textContent).toContain('1 host · 1 regra');
    expect(screen.getByText('2 incidentes registrados')).toBeTruthy();
  });

  it('puts search, filters and page in the URL and sends them to the API', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${INCIDENTS}`]: (_body, url) =>
        page([summary(incident(1))], { page: Number(url.searchParams.get('page')), total: 25, totalPages: 3 }),
    });
    const { router, user } = renderApp('/incidentes');
    await screen.findByRole('list', { name: 'Incidentes' });

    await user.selectOptions(screen.getByLabelText('Status'), 'RESOLVED');
    await user.selectOptions(screen.getByLabelText('Severidade'), 'HIGH');
    await user.selectOptions(screen.getByLabelText('Origem'), 'MANUAL');
    await user.type(screen.getByLabelText('Buscar incidentes'), 'shell');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(await screen.findByRole('button', { name: 'Página 2' }));

    await waitFor(() => expect(router.state.location.search).toBe('?q=shell&severity=HIGH&status=RESOLVED&origin=MANUAL&page=2'));
    await waitFor(() =>
      expect(calledUrls(fetchMock, 'GET', INCIDENTS)).toContain(`${INCIDENTS}?page=2&pageSize=10&q=shell&severity=HIGH&status=RESOLVED&origin=MANUAL`),
    );
  });
});

describe('create incident (separate screen)', () => {
  it('requires at least one host before calling the API', async () => {
    const fetchMock = mockApi({ ...signedIn(), ...formData() });
    const { user } = renderApp('/incidentes/novo');

    await user.type(await screen.findByLabelText('Título'), 'Shell inesperado no servidor web');
    await screen.findByText('servidor-web-01');
    await user.click(screen.getByRole('button', { name: 'Registrar incidente' }));

    expect(await screen.findByText('Selecione pelo menos um host envolvido.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'POST', INCIDENTS)).toEqual([]);
  });

  it('posts title, severity and hosts with rules optional, then opens the detail', async () => {
    const created = incident(7, { title: 'Shell inesperado no servidor web', detectionRules: [], ruleCount: 0, hostCount: 2 });
    const fetchMock = mockApi({
      ...signedIn(),
      ...formData(),
      [`POST ${INCIDENTS}`]: () => ({ status: 201, body: created }),
      [`GET ${INCIDENTS}/${id(7)}`]: () => ({ status: 200, body: created }),
    });
    const { router, user } = renderApp('/incidentes/novo');

    expect(await screen.findByText(/começa com status “Aberto” e origem “Manual”/)).toBeTruthy();
    expect(screen.queryByLabelText('Status')).toBeNull();
    await user.type(screen.getByLabelText('Título'), 'Shell inesperado no servidor web');
    await user.selectOptions(screen.getByLabelText('Severidade'), 'HIGH');
    await user.click(await screen.findByRole('checkbox', { name: /servidor-web-01/ }));
    await user.click(screen.getByRole('checkbox', { name: /servidor-web-02/ }));
    // The rules list (with a disabled rule) is shown, but choosing one is optional.
    expect(await screen.findByRole('checkbox', { name: /Regra 2.*Desabilitada/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Registrar incidente' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/incidentes/${id(7)}`));
    expect(requestBody(fetchMock, 'POST', INCIDENTS)).toEqual({
      title: 'Shell inesperado no servidor web',
      description: '',
      severity: 'HIGH',
      hostIds: [id(101), id(102)],
      detectionRuleIds: [],
    });
    expect(await screen.findByText('Incidente registrado.')).toBeTruthy();
  });

  it('relates selected rules and shows API relation errors on the right field', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      ...formData(),
      [`POST ${INCIDENTS}`]: () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Incidente inválido.', issues: [{ field: 'detectionRuleIds', message: 'Uma ou mais regras não existem neste workspace.' }] } },
      }),
    });
    const { user } = renderApp('/incidentes/novo');

    await user.type(await screen.findByLabelText('Título'), 'Caso com regra');
    await user.click(await screen.findByRole('checkbox', { name: /servidor-web-01/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Regra 1/ }));
    await user.click(screen.getByRole('button', { name: 'Registrar incidente' }));

    expect(await screen.findByText('Uma ou mais regras não existem neste workspace.')).toBeTruthy();
    expect((requestBody(fetchMock, 'POST', INCIDENTS) as { detectionRuleIds: string[] }).detectionRuleIds).toEqual([id(201)]);
  });

  it('explains what to do when the workspace has no hosts', async () => {
    mockApi({ ...signedIn(), ...formData([], []) });
    renderApp('/incidentes/novo');
    expect(await screen.findByText(/para registrar um incidente/)).toBeTruthy();
    expect(await screen.findByText(/Relacionar regras é opcional/)).toBeTruthy();
  });
});

describe('incident detail and lifecycle', () => {
  const URL = `${INCIDENTS}/${id(1)}`;

  it('shows description as plain text, hosts, related rules and record facts', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 200, body: incident(1) }) });
    renderApp(`/incidentes/${id(1)}`);

    expect(await screen.findByRole('heading', { name: 'Shell inesperado 1' })).toBeTruthy();
    expect(screen.getByText(/<b>sem HTML<\/b>/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'servidor-web-01' }).getAttribute('href')).toBe(`/hosts/${id(101)}`);
    expect(screen.getByRole('link', { name: 'Regra 1' }).getAttribute('href')).toBe(`/regras/${id(201)}`);
    expect(screen.getAllByText('Manual').length).toBeGreaterThan(0);
    expect(screen.queryByText('Resolvido em')).toBeNull();
  });

  it('offers only the transitions reported by the API and sends them through PUT', async () => {
    const investigating = incident(1, { status: 'INVESTIGATING', availableTransitions: ['RESOLVED'] });
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: incident(1) }),
      [`PUT ${URL}`]: () => ({ status: 200, body: investigating }),
    });
    const { user } = renderApp(`/incidentes/${id(1)}`);

    const actions = await screen.findByRole('group', { name: 'Alterar status' });
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Iniciar investigação', 'Resolver']);
    await user.click(within(actions).getByRole('button', { name: 'Iniciar investigação' }));

    await waitFor(() =>
      expect(requestBody(fetchMock, 'PUT', URL)).toEqual({
        title: 'Shell inesperado 1',
        description: 'Linha 1\nLinha 2 <b>sem HTML</b>',
        severity: 'HIGH',
        hostIds: [id(101)],
        detectionRuleIds: [id(201)],
        status: 'INVESTIGATING',
      }),
    );
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Alterar status' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Resolver']));
  });

  it('labels reopen and close for a resolved incident and shows when it was resolved', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({
        status: 200,
        body: incident(1, { status: 'RESOLVED', resolvedAt: '2026-05-03T09:30:00.000Z', availableTransitions: ['INVESTIGATING', 'CLOSED'] }),
      }),
    });
    renderApp(`/incidentes/${id(1)}`);

    const actions = await screen.findByRole('group', { name: 'Alterar status' });
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Reabrir investigação', 'Encerrar']);
    expect(screen.getByText('Resolvido em')).toBeTruthy();
  });

  it('shows the server message when a transition is refused (409)', async () => {
    const message = 'Não é possível mudar o status de “Aberto” para “Em investigação”.';
    mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: incident(1) }),
      [`PUT ${URL}`]: () => ({ status: 409, body: { error: { code: 'INVALID_STATE', message, issues: [{ field: 'status', message }] } } }),
    });
    const { user } = renderApp(`/incidentes/${id(1)}`);
    await user.click(await screen.findByRole('button', { name: 'Iniciar investigação' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('a CLOSED incident has no status buttons and no edit action, but can be deleted', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: incident(1, { status: 'CLOSED', resolvedAt: '2026-05-03T09:30:00.000Z', availableTransitions: [] }) }),
    });
    renderApp(`/incidentes/${id(1)}`);

    expect(await screen.findByText(/Encerrado é definitivo/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Alterar status' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy();
  });

  it('deletes only after confirmation and returns to /incidentes', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: incident(1) }),
      [`DELETE ${URL}`]: () => ({ status: 204, body: null }),
      [`GET ${INCIDENTS}`]: () => page([]),
    });
    const { router, user } = renderApp(`/incidentes/${id(1)}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir este incidente?' });
    expect(dialog.textContent).toContain('removido definitivamente');
    expect(calledUrls(fetchMock, 'DELETE', URL)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Excluir incidente' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/incidentes'));
    expect(calledUrls(fetchMock, 'DELETE', URL)).toEqual([URL]);
  });

  it('shows a friendly 404', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/incidentes/${id(1)}`);
    expect(await screen.findByText('Incidente não encontrado')).toBeTruthy();
  });
});

describe('edit incident (separate screen)', () => {
  const URL = `${INCIDENTS}/${id(1)}`;

  it('pre-fills the form and saves through PUT without touching the status', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      ...formData(),
      [`GET ${URL}`]: () => ({ status: 200, body: incident(1, { status: 'INVESTIGATING' }) }),
      [`PUT ${URL}`]: () => ({ status: 200, body: incident(1, { title: 'Título revisado' }) }),
    });
    const { router, user } = renderApp(`/incidentes/${id(1)}/editar`);

    const title = await screen.findByLabelText('Título');
    expect((title as HTMLInputElement).value).toBe('Shell inesperado 1');
    expect(((await screen.findByRole('checkbox', { name: /servidor-web-01/ })) as HTMLInputElement).checked).toBe(true);
    expect(((await screen.findByRole('checkbox', { name: /Regra 1/ })) as HTMLInputElement).checked).toBe(true);
    await user.clear(title);
    await user.type(title, 'Título revisado');
    await user.click(screen.getByRole('checkbox', { name: /servidor-web-02/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/incidentes/${id(1)}`));
    const body = requestBody(fetchMock, 'PUT', URL) as Record<string, unknown>;
    expect(body).toMatchObject({ title: 'Título revisado', hostIds: [id(101), id(102)], detectionRuleIds: [id(201)] });
    expect(body).not.toHaveProperty('status');
  });

  it('does not offer the form for a CLOSED incident', async () => {
    mockApi({ ...signedIn(), ...formData(), [`GET ${URL}`]: () => ({ status: 200, body: incident(1, { status: 'CLOSED', availableTransitions: [] }) }) });
    renderApp(`/incidentes/${id(1)}/editar`);
    expect(await screen.findByText('Este incidente está encerrado e não pode mais ser alterado.')).toBeTruthy();
    expect(screen.queryByLabelText('Título')).toBeNull();
  });

  it('shows the 404 state for an unknown incident', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/incidentes/${id(1)}/editar`);
    expect(await screen.findByText('Incidente não encontrado')).toBeTruthy();
  });
});

describe('incidents elsewhere in the app', () => {
  it('navigation lists Incidentes and the dashboard shows the real total', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${HOSTS}`]: () => page([], { total: 0 }),
      [`GET ${RULES}`]: () => page([], { total: 0 }),
      [`GET ${INCIDENTS}`]: () => page([summary(incident(1))], { total: 3, pageSize: 1, totalPages: 3 }),
    });
    renderApp('/dashboard');

    expect((await screen.findByRole('link', { name: 'Incidentes' })).getAttribute('href')).toBe('/incidentes');
    const card = (await screen.findByText('Incidentes registrados')).closest('.metric');
    await waitFor(() => expect(card?.textContent).toContain('3'));
  });

  it('explains the 409 when deleting a rule related to an incident', async () => {
    const RULE_URL = `${RULES}/${id(201)}`;
    const message = 'Esta regra está relacionada a incidentes. Remova-a desses incidentes antes de excluí-la.';
    mockApi({
      ...signedIn(),
      [`GET ${RULE_URL}`]: () => ({
        status: 200,
        body: { ...ruleSummary(1), definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] }, targets: [] },
      }),
      [`DELETE ${RULE_URL}`]: () => ({ status: 409, body: { error: { code: 'CONFLICT', message } } }),
    });
    const { user } = renderApp(`/regras/${id(201)}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Excluir regra' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });
});
