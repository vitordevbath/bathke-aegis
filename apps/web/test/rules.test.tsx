import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { DetectionRuleResponse, DetectionRuleSummary, HostResponse, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp, requestBody } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const RULES = `/api/workspaces/${WS}/detection-rules`;
const HOSTS = `/api/workspaces/${WS}/hosts`;
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const signedIn = () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: ME }) };
};

const host = (n: number): HostResponse => ({
  id: id(100 + n),
  workspaceId: WS,
  displayName: `Servidor ${n}`,
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

const rule = (n: number, overrides: Partial<DetectionRuleResponse> = {}): DetectionRuleResponse => ({
  id: id(n),
  workspaceId: WS,
  name: `Regra ${n}`,
  description: null,
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  targetCount: 0,
  conditionCount: 1,
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
  definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
  targets: [],
  ...overrides,
});

const page = <T,>(items: T[], meta: Partial<PaginatedResponse<T>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});
const summary = ({ definition: _d, targets: _t, ...rest }: DetectionRuleResponse): DetectionRuleSummary => rest;

describe('rules list', () => {
  it('shows an honest empty state and the engine notice', async () => {
    mockApi({ ...signedIn(), [`GET ${RULES}`]: () => page([]) });
    renderApp('/regras');

    expect(await screen.findByText('Nenhuma regra de detecção configurada.')).toBeTruthy();
    expect(screen.getByText(/quando o motor de detecção estiver ativo/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Motor de detecção ainda não conectado');
  });

  it('lists severity (text, not just color), status, category and scope', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${RULES}`]: () =>
        page([
          summary(rule(1, { severity: 'CRITICAL' })),
          summary(rule(2, { enabled: false, severity: 'LOW', scope: 'SELECTED_HOSTS', targetCount: 2, eventCategory: 'NETWORK' })),
        ]),
    });
    renderApp('/regras');

    const list = await screen.findByRole('list', { name: 'Regras' });
    expect(within(list).getByText('Crítica')).toBeTruthy();
    expect(within(list).getByText('Baixa')).toBeTruthy();
    expect(within(list).getByText('Habilitada')).toBeTruthy();
    expect(within(list).getByText('Desabilitada')).toBeTruthy();
    expect(within(list).getByText(/Rede · 1 condição · 2 hosts/)).toBeTruthy();
    expect(within(list).getByText(/Processo · 1 condição · Todos os hosts/)).toBeTruthy();
  });

  it('puts filters and page in the URL and sends them to the API', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${RULES}`]: (_body, url) => page([summary(rule(Number(url.searchParams.get('page'))))], { page: Number(url.searchParams.get('page')), total: 25, totalPages: 3 }),
    });
    const { user, router } = renderApp('/regras');

    await screen.findByText('Regra 1');
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Regra 2')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');

    await user.selectOptions(screen.getByLabelText('Severidade'), 'CRITICAL');
    await waitFor(() => expect(router.state.location.search).toBe('?severity=CRITICAL'));
    await user.selectOptions(screen.getByLabelText('Status'), 'false');
    await waitFor(() => expect(calledUrls(fetchMock, 'GET', RULES).at(-1)).toBe(`${RULES}?page=1&pageSize=10&severity=CRITICAL&enabled=false`));
  });
});

describe('create rule (separate screen) with the condition builder', () => {
  it('builds structured conditions, validates them with the shared schema and posts ALL_HOSTS with no hosts', async () => {
    const created = rule(9, { name: 'Shell iniciado por servidor web' });
    const fetchMock = mockApi({
      ...signedIn(),
      [`POST ${RULES}`]: () => ({ status: 201, body: created }),
      [`GET ${RULES}/${created.id}`]: () => ({ status: 200, body: created }),
    });
    const { user, router } = renderApp('/regras/nova');

    await screen.findByRole('heading', { name: 'Nova regra de detecção' });
    expect(screen.queryByRole('group', { name: 'Hosts alvo' })).toBeNull();
    await user.type(screen.getByLabelText('Nome'), 'Shell iniciado por servidor web');
    await user.selectOptions(screen.getByLabelText('Severidade'), 'HIGH');

    // Empty value → error on that row, from the same validator the API uses.
    await user.click(screen.getByRole('button', { name: 'Criar regra' }));
    expect(await screen.findByText('Informe um valor.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'POST', RULES)).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Campo da condição 1'), 'process.parentName');
    await user.type(screen.getByLabelText('Valor da condição 1'), 'nginx');
    await user.click(screen.getByRole('button', { name: 'Adicionar condição' }));
    await user.selectOptions(screen.getByLabelText('Operador da condição 2'), 'IN');
    await user.type(screen.getByLabelText('Valor da condição 2'), 'bash, sh');
    expect(screen.getByText('E')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Criar regra' }));
    expect(await screen.findByText('Regra criada.')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/regras/${created.id}`);
    expect(requestBody(fetchMock, 'POST', RULES)).toEqual({
      name: 'Shell iniciado por servidor web',
      description: '',
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
    });
  });

  it('offers only fields of the chosen category and numeric operators for ports', async () => {
    mockApi(signedIn());
    const { user } = renderApp('/regras/nova');

    await screen.findByRole('heading', { name: 'Nova regra de detecção' });
    await user.selectOptions(screen.getByLabelText('Categoria de evento'), 'NETWORK');
    const field = screen.getByLabelText('Campo da condição 1');
    expect(within(field).queryByText('Processo › Nome')).toBeNull();
    await user.selectOptions(field, 'network.localPort');
    const operators = within(screen.getByLabelText('Operador da condição 1')).getAllByRole('option').map((option) => option.textContent);
    expect(operators).toEqual(['é igual a', 'é diferente de', 'está em', 'é maior que', 'é menor que']);
  });

  it('SELECTED_HOSTS shows the real hosts and requires at least one', async () => {
    const created = rule(10, { scope: 'SELECTED_HOSTS' });
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${HOSTS}`]: () => page([host(1), host(2)]),
      [`POST ${RULES}`]: () => ({ status: 201, body: created }),
      [`GET ${RULES}/${created.id}`]: () => ({ status: 200, body: created }),
    });
    const { user } = renderApp('/regras/nova');

    await screen.findByRole('heading', { name: 'Nova regra de detecção' });
    await user.type(screen.getByLabelText('Nome'), 'Regra por host');
    await user.type(screen.getByLabelText('Valor da condição 1'), 'bash');
    await user.click(screen.getByLabelText('Hosts selecionados'));

    const group = await screen.findByRole('group', { name: 'Hosts alvo' });
    expect(within(group).getAllByText('Não pareado')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Criar regra' }));
    expect(await screen.findByText('Selecione pelo menos um host.')).toBeTruthy();

    await user.click(within(group).getByLabelText(/Servidor 2/));
    await user.click(screen.getByRole('button', { name: 'Criar regra' }));
    await screen.findByText('Regra criada.');
    expect(requestBody(fetchMock, 'POST', RULES)).toMatchObject({ scope: 'SELECTED_HOSTS', hostIds: [host(2).id] });
  });

  it('explains what to do when the workspace has no hosts', async () => {
    mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([]) });
    const { user } = renderApp('/regras/nova');

    await user.click(await screen.findByLabelText('Hosts selecionados'));
    expect(await screen.findByText(/Nenhum host neste workspace/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastre um host' })).toBeTruthy();
  });

  it('maps API issues back to the right condition row', async () => {
    mockApi({
      ...signedIn(),
      [`POST ${RULES}`]: () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', issues: [{ field: 'definition.conditions.0.value', message: 'Valor recusado pelo servidor.' }] } },
      }),
    });
    const { user } = renderApp('/regras/nova');

    await user.type(await screen.findByLabelText('Nome'), 'Regra');
    await user.type(screen.getByLabelText('Valor da condição 1'), 'bash');
    await user.click(screen.getByRole('button', { name: 'Criar regra' }));
    expect(await screen.findByText('Valor recusado pelo servidor.')).toBeTruthy();
    expect(screen.getByLabelText('Valor da condição 1').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('rule detail', () => {
  const target = rule(20, {
    scope: 'SELECTED_HOSTS',
    targetCount: 1,
    targets: [{ hostId: host(1).id, displayName: 'Servidor 1', connectionState: 'UNPAIRED' }],
    definition: { version: 1, match: 'ANY', conditions: [{ field: 'process.name', operator: 'IN', value: ['bash', 'sh'] }, { field: 'process.user', operator: 'EQUALS', value: 'www-data' }] },
  });

  it('shows conditions in words, targets, version and a read-only definition', async () => {
    mockApi({ ...signedIn(), [`GET ${RULES}/${target.id}`]: () => ({ status: 200, body: target }) });
    renderApp(`/regras/${target.id}`);

    expect(await screen.findByRole('heading', { name: 'Regra 20' })).toBeTruthy();
    expect(screen.getByText('Processo › Nome está em bash, sh')).toBeTruthy();
    expect(screen.getByText('OU')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Servidor 1' })).toBeTruthy();
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('Visualizar definição')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('toggles enabled through PUT keeping the definition and targets', async () => {
    const disabled = { ...target, enabled: false };
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${RULES}/${target.id}`]: () => ({ status: 200, body: target }),
      [`PUT ${RULES}/${target.id}`]: () => ({ status: 200, body: disabled }),
    });
    const { user } = renderApp(`/regras/${target.id}`);

    await user.click(await screen.findByRole('button', { name: 'Desabilitar' }));
    expect(await screen.findByRole('button', { name: 'Habilitar' })).toBeTruthy();
    expect(requestBody(fetchMock, 'PUT', `${RULES}/${target.id}`)).toEqual({
      name: 'Regra 20',
      description: null,
      severity: 'HIGH',
      enabled: false,
      eventCategory: 'PROCESS',
      scope: 'SELECTED_HOSTS',
      hostIds: [host(1).id],
      definition: target.definition,
    });
  });

  it('deletes only after confirmation and returns to /regras', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${RULES}/${target.id}`]: () => ({ status: 200, body: target }),
      [`DELETE ${RULES}/${target.id}`]: () => ({ status: 204, body: null }),
      [`GET ${RULES}`]: () => page([]),
    });
    const { user, router } = renderApp(`/regras/${target.id}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir esta regra?' });
    expect(within(dialog).getByText(/Os hosts continuam cadastrados/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Excluir regra' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/regras'));
    expect(calledUrls(fetchMock, 'DELETE', RULES)).toEqual([`${RULES}/${target.id}`]);
  });

  it('shows a friendly 404', async () => {
    mockApi({ ...signedIn(), [`GET ${RULES}/${id(404)}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/regras/${id(404)}`);
    expect(await screen.findByRole('heading', { name: 'Regra não encontrada' })).toBeTruthy();
  });
});

describe('edit rule (separate screen)', () => {
  it('pre-fills the builder from the stored definition and saves through PUT', async () => {
    const stored = rule(30, {
      eventCategory: 'NETWORK',
      definition: { version: 1, match: 'ALL', conditions: [{ field: 'network.localPort', operator: 'IN', value: [22, 2222] }] },
    });
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${RULES}/${stored.id}`]: () => ({ status: 200, body: stored }),
      [`PUT ${RULES}/${stored.id}`]: () => ({ status: 200, body: stored }),
    });
    const { user, router } = renderApp(`/regras/${stored.id}/editar`);

    expect(((await screen.findByLabelText('Valor da condição 1')) as HTMLInputElement).value).toBe('22, 2222');
    expect((screen.getByLabelText('Campo da condição 1') as HTMLSelectElement).value).toBe('network.localPort');
    await user.clear(screen.getByLabelText('Valor da condição 1'));
    await user.type(screen.getByLabelText('Valor da condição 1'), '22, 2200');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Regra atualizada.')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/regras/${stored.id}`);
    expect(requestBody(fetchMock, 'PUT', `${RULES}/${stored.id}`)).toMatchObject({
      definition: { conditions: [{ field: 'network.localPort', operator: 'IN', value: [22, 2200] }] },
    });
  });

  it('shows the 404 state instead of the form for an unknown rule', async () => {
    mockApi({ ...signedIn(), [`GET ${RULES}/${id(405)}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/regras/${id(405)}/editar`);
    expect(await screen.findByRole('heading', { name: 'Regra não encontrada' })).toBeTruthy();
    expect(screen.queryByLabelText('Nome')).toBeNull();
  });
});

describe('host protected by a rule', () => {
  it('explains the 409 when deleting a targeted host', async () => {
    const h = host(1);
    mockApi({
      ...signedIn(),
      [`GET ${HOSTS}/${h.id}`]: () => ({ status: 200, body: h }),
      [`DELETE ${HOSTS}/${h.id}`]: () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.' } },
      }),
    });
    const { user } = renderApp(`/hosts/${h.id}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Excluir host' }));
    expect(await screen.findByText('Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.')).toBeTruthy();
  });
});
