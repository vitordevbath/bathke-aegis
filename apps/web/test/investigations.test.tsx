import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { IncidentSummary, InvestigationResponse, InvestigationSummary, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp, requestBody } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const INVESTIGATIONS = `/api/workspaces/${WS}/investigations`;
const INCIDENTS = `/api/workspaces/${WS}/incidents`;
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONCLUSION = 'Falso positivo: atualização legítima do servidor.';

const signedIn = () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: ME }) };
};

const incidentSummary = (n: number, overrides: Partial<IncidentSummary> = {}): IncidentSummary => ({
  id: id(100 + n),
  workspaceId: WS,
  title: `Shell inesperado no servidor-web-0${n}`,
  severity: 'HIGH',
  status: 'OPEN',
  origin: 'MANUAL',
  hostCount: 1,
  ruleCount: 0,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  resolvedAt: null,
  ...overrides,
});

const investigation = (n: number, overrides: Partial<InvestigationResponse> = {}): InvestigationResponse => ({
  id: id(n),
  workspaceId: WS,
  title: `Atividade incomum ${n}`,
  description: 'Linha 1\nLinha 2 <b>sem HTML</b>',
  conclusion: null,
  status: 'OPEN',
  incidentCount: 1,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  closedAt: null,
  incidents: [{ incidentId: id(101), title: 'Shell inesperado no servidor-web-01', severity: 'HIGH', status: 'OPEN', origin: 'MANUAL' }],
  availableTransitions: ['IN_PROGRESS', 'CLOSED'],
  ...overrides,
});

const page = <T,>(items: T[], meta: Partial<PaginatedResponse<T>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});
const summary = ({ description: _d, conclusion: _c, incidents: _i, availableTransitions: _a, ...rest }: InvestigationResponse): InvestigationSummary => rest;

/** The incident selector loads the workspace's incidents. */
const formData = (incidents: IncidentSummary[] = [incidentSummary(1), incidentSummary(2, { severity: 'CRITICAL', status: 'CLOSED' })]) => ({
  [`GET ${INCIDENTS}`]: () => page(incidents),
});

describe('investigations list', () => {
  it('shows an honest empty state without promising automation', async () => {
    mockApi({ ...signedIn(), [`GET ${INVESTIGATIONS}`]: () => page([]) });
    renderApp('/investigacoes');

    expect(await screen.findByText('Nenhuma investigação aberta.')).toBeTruthy();
    expect(screen.getByText('Investigações agrupam incidentes relacionados para análise e conclusão humana.')).toBeTruthy();
    expect(screen.queryByText(/\bIA\b|automátic/i)).toBeNull();
  });

  it('lists title, status as text, incident count, creation and closing dates', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${INVESTIGATIONS}`]: () =>
        page([
          summary(investigation(1, { status: 'IN_PROGRESS', incidentCount: 2 })),
          summary(investigation(2, { status: 'CLOSED', closedAt: '2026-06-02T10:00:00.000Z' })),
        ]),
    });
    renderApp('/investigacoes');

    const list = await screen.findByRole('list', { name: 'Investigações' });
    const [first, second] = within(list).getAllByRole('link');
    expect(first?.getAttribute('href')).toBe(`/investigacoes/${id(1)}`);
    expect(first?.textContent).toContain('Atividade incomum 1');
    expect(first?.textContent).toContain('Em andamento');
    expect(first?.textContent).toContain('2 incidentes · Criada em');
    expect(first?.textContent).not.toContain('Encerrada em');
    expect(second?.textContent).toContain('Encerrada');
    expect(second?.textContent).toContain('1 incidente · Criada em');
    expect(second?.textContent).toContain('Encerrada em');
    expect(screen.getByText('2 investigações registradas')).toBeTruthy();
  });

  it('puts search, status filter and page in the URL and sends them to the API', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${INVESTIGATIONS}`]: (_body, url) => page([summary(investigation(1))], { page: Number(url.searchParams.get('page')), total: 25, totalPages: 3 }),
    });
    const { router, user } = renderApp('/investigacoes');
    await screen.findByRole('list', { name: 'Investigações' });

    await user.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await user.type(screen.getByLabelText('Buscar investigações'), 'web');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(await screen.findByRole('button', { name: 'Página 2' }));

    await waitFor(() => expect(router.state.location.search).toBe('?q=web&status=IN_PROGRESS&page=2'));
    await waitFor(() => expect(calledUrls(fetchMock, 'GET', INVESTIGATIONS)).toContain(`${INVESTIGATIONS}?page=2&pageSize=10&q=web&status=IN_PROGRESS`));
    expect(screen.getByText('25 investigações encontradas')).toBeTruthy();
  });
});

describe('create investigation (separate screen)', () => {
  it('requires at least one incident before calling the API', async () => {
    const fetchMock = mockApi({ ...signedIn(), ...formData() });
    const { user } = renderApp('/investigacoes/nova');

    await user.type(await screen.findByLabelText('Título'), 'Atividade incomum nos servidores web');
    await screen.findByText('Shell inesperado no servidor-web-01');
    await user.click(screen.getByRole('button', { name: 'Abrir investigação' }));

    expect(await screen.findByText('Selecione pelo menos um incidente relacionado.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'POST', INVESTIGATIONS)).toEqual([]);
  });

  it('lists the workspace incidents with severity and status, posts title and incidents, then opens the detail', async () => {
    const created = investigation(7, { title: 'Atividade incomum nos servidores web', description: null, incidentCount: 2 });
    const fetchMock = mockApi({
      ...signedIn(),
      ...formData(),
      [`POST ${INVESTIGATIONS}`]: () => ({ status: 201, body: created }),
      [`GET ${INVESTIGATIONS}/${id(7)}`]: () => ({ status: 200, body: created }),
    });
    const { router, user } = renderApp('/investigacoes/nova');

    expect(await screen.findByText(/começa com status “Aberta” e sem conclusão/)).toBeTruthy();
    expect(screen.queryByLabelText(/Conclusão/)).toBeNull();
    await user.type(screen.getByLabelText('Título'), 'Atividade incomum nos servidores web');
    // A closed incident can be grouped too: no business rule forbids it.
    const closedIncident = await screen.findByRole('checkbox', { name: /servidor-web-02.*Crítica.*Encerrado/ });
    await user.click(screen.getByRole('checkbox', { name: /servidor-web-01.*Alta.*Aberto/ }));
    await user.click(closedIncident);
    await user.click(screen.getByRole('button', { name: 'Abrir investigação' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/investigacoes/${id(7)}`));
    expect(requestBody(fetchMock, 'POST', INVESTIGATIONS)).toEqual({
      title: 'Atividade incomum nos servidores web',
      description: '',
      incidentIds: [id(101), id(102)],
    });
    expect(await screen.findByText('Investigação aberta.')).toBeTruthy();
  });

  it('shows API relation errors on the incidents field', async () => {
    mockApi({
      ...signedIn(),
      ...formData(),
      [`POST ${INVESTIGATIONS}`]: () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Investigação inválida.', issues: [{ field: 'incidentIds', message: 'Um ou mais incidentes não existem neste workspace.' }] } },
      }),
    });
    const { user } = renderApp('/investigacoes/nova');

    await user.type(await screen.findByLabelText('Título'), 'Caso cruzado');
    await user.click(await screen.findByRole('checkbox', { name: /servidor-web-01/ }));
    await user.click(screen.getByRole('button', { name: 'Abrir investigação' }));
    expect(await screen.findByText('Um ou mais incidentes não existem neste workspace.')).toBeTruthy();
  });

  it('explains what to do when the workspace has no incidents', async () => {
    mockApi({ ...signedIn(), ...formData([]) });
    renderApp('/investigacoes/nova');
    expect(await screen.findByText(/para abrir uma investigação/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Registre um incidente' }).getAttribute('href')).toBe('/incidentes/novo');
  });
});

describe('investigation detail, lifecycle and conclusion', () => {
  const URL = `${INVESTIGATIONS}/${id(1)}`;

  it('shows description as plain text, related incidents, an undefined conclusion and record facts', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 200, body: investigation(1) }) });
    renderApp(`/investigacoes/${id(1)}`);

    expect(await screen.findByRole('heading', { name: 'Atividade incomum 1' })).toBeTruthy();
    expect(screen.getByText(/<b>sem HTML<\/b>/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Shell inesperado no servidor-web-01' }).getAttribute('href')).toBe(`/incidentes/${id(101)}`);
    expect(screen.getByRole('heading', { name: 'Conclusão preliminar' })).toBeTruthy();
    expect(screen.getByText('Ainda não definida.')).toBeTruthy();
    expect(screen.getByText('Criada em')).toBeTruthy();
    expect(screen.queryByText('Encerrada em')).toBeNull();
  });

  it('offers only the transitions reported by the API and sends them through PUT', async () => {
    const inProgress = investigation(1, { status: 'IN_PROGRESS', availableTransitions: ['OPEN', 'CLOSED'], updatedAt: '2026-06-01T11:00:00.000Z' });
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1) }),
      [`PUT ${URL}`]: () => ({ status: 200, body: inProgress }),
    });
    const { user } = renderApp(`/investigacoes/${id(1)}`);

    const actions = await screen.findByRole('group', { name: 'Alterar status' });
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Iniciar investigação', 'Encerrar']);
    await user.click(within(actions).getByRole('button', { name: 'Iniciar investigação' }));

    await waitFor(() =>
      expect(requestBody(fetchMock, 'PUT', URL)).toEqual({
        title: 'Atividade incomum 1',
        description: 'Linha 1\nLinha 2 <b>sem HTML</b>',
        conclusion: null,
        incidentIds: [id(101)],
        status: 'IN_PROGRESS',
      }),
    );
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Alterar status' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Pausar investigação',
        'Encerrar',
      ]),
    );
  });

  it('blocks closing without a conclusion in the browser, then closes with the typed conclusion', async () => {
    const closed = investigation(1, { status: 'CLOSED', conclusion: CONCLUSION, closedAt: '2026-06-03T09:30:00.000Z', availableTransitions: [], updatedAt: '2026-06-03T09:30:00.000Z' });
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1, { status: 'IN_PROGRESS', availableTransitions: ['OPEN', 'CLOSED'] }) }),
      [`PUT ${URL}`]: () => ({ status: 200, body: closed }),
    });
    const { user } = renderApp(`/investigacoes/${id(1)}`);

    await user.click(await screen.findByRole('button', { name: 'Encerrar' }));
    const panel = screen.getByRole('form', { name: 'Encerrar investigação' });
    await user.click(within(panel).getByRole('button', { name: 'Encerrar investigação' }));
    expect(await within(panel).findByText('Adicione uma conclusão antes de encerrar a investigação.')).toBeTruthy();
    await user.type(within(panel).getByLabelText('Conclusão'), 'Curta');
    await user.click(within(panel).getByRole('button', { name: 'Encerrar investigação' }));
    expect(await within(panel).findByText('A conclusão deve ter pelo menos 10 caracteres para encerrar a investigação.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'PUT', URL)).toEqual([]);

    await user.clear(within(panel).getByLabelText('Conclusão'));
    await user.type(within(panel).getByLabelText('Conclusão'), `  ${CONCLUSION} `);
    await user.click(within(panel).getByRole('button', { name: 'Encerrar investigação' }));

    await waitFor(() => expect(requestBody(fetchMock, 'PUT', URL)).toMatchObject({ conclusion: CONCLUSION, status: 'CLOSED' }));
    expect(await screen.findByText(/Encerrada é definitivo/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Conclusão' })).toBeTruthy();
    expect(screen.getByText(CONCLUSION)).toBeTruthy();
    expect(screen.getByText('Encerrada em')).toBeTruthy();
  });

  it('pre-fills the closing panel with the stored draft and shows the server message if it still refuses', async () => {
    const message = 'Adicione uma conclusão antes de encerrar a investigação.';
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1, { conclusion: CONCLUSION }) }),
      [`PUT ${URL}`]: () => ({ status: 400, body: { error: { code: 'VALIDATION_ERROR', message, issues: [{ field: 'conclusion', message }] } } }),
    });
    const { user } = renderApp(`/investigacoes/${id(1)}`);

    await user.click(await screen.findByRole('button', { name: 'Encerrar' }));
    expect((screen.getByLabelText('Conclusão') as HTMLTextAreaElement).value).toBe(CONCLUSION);
    await user.click(screen.getByRole('button', { name: 'Encerrar investigação' }));
    await waitFor(() => expect(calledUrls(fetchMock, 'PUT', URL)).toEqual([URL]));
    expect((await screen.findByText(message, { selector: '.notice' })).getAttribute('role')).toBe('alert');
  });

  it('a CLOSED investigation has no status buttons and no edit action, but can be deleted', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({
        status: 200,
        body: investigation(1, { status: 'CLOSED', conclusion: CONCLUSION, closedAt: '2026-06-03T09:30:00.000Z', availableTransitions: [] }),
      }),
    });
    renderApp(`/investigacoes/${id(1)}`);

    expect(await screen.findByText(/Encerrada é definitivo/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Alterar status' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeTruthy();
  });

  it('deletes only after confirmation and returns to /investigacoes', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1) }),
      [`DELETE ${URL}`]: () => ({ status: 204, body: null }),
      [`GET ${INVESTIGATIONS}`]: () => page([]),
    });
    const { router, user } = renderApp(`/investigacoes/${id(1)}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir esta investigação?' });
    expect(dialog.textContent).toContain('removido definitivamente');
    expect(calledUrls(fetchMock, 'DELETE', URL)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Excluir investigação' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/investigacoes'));
    expect(calledUrls(fetchMock, 'DELETE', URL)).toEqual([URL]);
  });

  it('shows a friendly 404', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/investigacoes/${id(1)}`);
    expect(await screen.findByText('Investigação não encontrada')).toBeTruthy();
  });
});

describe('edit investigation (separate screen)', () => {
  const URL = `${INVESTIGATIONS}/${id(1)}`;

  it('pre-fills the form, saves a draft conclusion and incidents through PUT without touching the status', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      ...formData(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1, { status: 'IN_PROGRESS', availableTransitions: ['OPEN', 'CLOSED'] }) }),
      [`PUT ${URL}`]: () => ({ status: 200, body: investigation(1, { title: 'Título revisado', conclusion: 'Rascunho' }) }),
    });
    const { router, user } = renderApp(`/investigacoes/${id(1)}/editar`);

    const title = await screen.findByLabelText('Título');
    expect((title as HTMLInputElement).value).toBe('Atividade incomum 1');
    expect(((await screen.findByRole('checkbox', { name: /servidor-web-01/ })) as HTMLInputElement).checked).toBe(true);
    await user.clear(title);
    await user.type(title, 'Título revisado');
    await user.click(screen.getByRole('checkbox', { name: /servidor-web-02/ }));
    await user.type(screen.getByLabelText('Conclusão preliminar'), 'Rascunho');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/investigacoes/${id(1)}`));
    const body = requestBody(fetchMock, 'PUT', URL) as Record<string, unknown>;
    expect(body).toEqual({ title: 'Título revisado', description: 'Linha 1\nLinha 2 <b>sem HTML</b>', conclusion: 'Rascunho', incidentIds: [id(101), id(102)] });
    expect(await screen.findByText('Investigação atualizada.')).toBeTruthy();
  });

  it('never saves an empty incident list', async () => {
    const fetchMock = mockApi({ ...signedIn(), ...formData(), [`GET ${URL}`]: () => ({ status: 200, body: investigation(1) }) });
    const { user } = renderApp(`/investigacoes/${id(1)}/editar`);

    await user.click(await screen.findByRole('checkbox', { name: /servidor-web-01/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Selecione pelo menos um incidente relacionado.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'PUT', URL)).toEqual([]);
  });

  it('does not offer the form for a CLOSED investigation', async () => {
    mockApi({
      ...signedIn(),
      ...formData(),
      [`GET ${URL}`]: () => ({ status: 200, body: investigation(1, { status: 'CLOSED', conclusion: CONCLUSION, closedAt: '2026-06-03T09:30:00.000Z', availableTransitions: [] }) }),
    });
    renderApp(`/investigacoes/${id(1)}/editar`);
    expect(await screen.findByText('Esta investigação está encerrada e não pode mais ser alterada.')).toBeTruthy();
    expect(screen.queryByLabelText('Título')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar para a investigação' }).getAttribute('href')).toBe(`/investigacoes/${id(1)}`);
  });

  it('shows the 404 state for an unknown investigation', async () => {
    mockApi({ ...signedIn(), [`GET ${URL}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/investigacoes/${id(1)}/editar`);
    expect(await screen.findByText('Investigação não encontrada')).toBeTruthy();
  });
});

describe('investigations elsewhere in the app', () => {
  it('navigation lists Investigações after Incidentes and the dashboard shows the real total', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/hosts`]: () => page([], { total: 0 }),
      [`GET /api/workspaces/${WS}/detection-rules`]: () => page([], { total: 0 }),
      [`GET ${INCIDENTS}`]: () => page([], { total: 0 }),
      [`GET ${INVESTIGATIONS}`]: () => page([summary(investigation(1))], { total: 4, pageSize: 1, totalPages: 4 }),
    });
    renderApp('/dashboard');

    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Painel', 'Hosts', 'Regras', 'Incidentes', 'Investigações', 'Perfil']);
    expect(within(nav).getByRole('link', { name: 'Investigações' }).getAttribute('href')).toBe('/investigacoes');
    const card = screen.getByText('Investigações', { selector: '.metric__label' }).closest('.metric');
    await waitFor(() => expect(card?.textContent).toContain('4'));
  });

  it('explains the 409 when deleting an incident grouped by an investigation', async () => {
    const INCIDENT_URL = `${INCIDENTS}/${id(101)}`;
    const message = 'Este incidente faz parte de investigações. Remova-o dessas investigações antes de excluí-lo.';
    mockApi({
      ...signedIn(),
      [`GET ${INCIDENT_URL}`]: () => ({
        status: 200,
        body: { ...incidentSummary(1), description: null, hosts: [], detectionRules: [], availableTransitions: ['INVESTIGATING', 'RESOLVED'] },
      }),
      [`DELETE ${INCIDENT_URL}`]: () => ({ status: 409, body: { error: { code: 'CONFLICT', message } } }),
    });
    const { user } = renderApp(`/incidentes/${id(101)}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Excluir incidente' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });
});
