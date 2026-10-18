import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { HostResponse, MeResponse, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { ACTIVE_WORKSPACE_KEY } from '../src/lib/workspace-storage';
import { pageWindow } from '../src/components/Pagination';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp, requestBody } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const HOSTS = `/api/workspaces/${WS}/hosts`;

const host = (n: number, overrides: Partial<HostResponse> = {}): HostResponse => ({
  id: `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`,
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
  ...overrides,
});

const page = (items: HostResponse[], meta: Partial<PaginatedResponse<HostResponse>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});

const signedIn = (me: MeResponse = ME) => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: me }) };
};

describe('hosts list', () => {
  it('shows a truthful empty state with a call to action', async () => {
    mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([]) });
    renderApp('/hosts');

    expect(await screen.findByText('Nenhum host cadastrado neste workspace.')).toBeTruthy();
    expect(screen.getByText(/O Collector será pareado em uma etapa futura/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Adicionar host' }).length).toBeGreaterThan(0);
  });

  it('lists only real data: unpaired state, no telemetry, never "Online"', async () => {
    mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([host(1, { description: 'Homologação' }), host(2)]) });
    renderApp('/hosts');

    const list = await screen.findByRole('list', { name: 'Hosts' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByText('Homologação')).toBeTruthy();
    expect(within(list).getAllByText('Não pareado')).toHaveLength(2);
    expect(within(list).getAllByText('Nenhuma telemetria recebida')).toHaveLength(2);
    expect(screen.queryByText(/online|offline/i)).toBeNull();
    expect(screen.getByText('2 hosts cadastrados')).toBeTruthy();
  });

  it('keeps page and search in the URL and sends them to the API', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${HOSTS}`]: (_body, url) => {
        const current = Number(url.searchParams.get('page'));
        return page([host(current)], { page: current, total: 25, totalPages: 3 });
      },
    });
    const { user, router } = renderApp('/hosts');

    await screen.findByText('Servidor 1');
    expect(screen.getByRole('button', { name: 'Página 1' }).getAttribute('aria-current')).toBe('page');
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Servidor 2')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');
    expect(calledUrls(fetchMock, 'GET', HOSTS).at(-1)).toBe(`${HOSTS}?page=2&pageSize=10`);

    await user.type(screen.getByRole('searchbox', { name: 'Buscar hosts' }), 'banco');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(router.state.location.search).toBe('?q=banco'));
    expect(calledUrls(fetchMock, 'GET', HOSTS).at(-1)).toBe(`${HOSTS}?page=1&pageSize=10&q=banco`);
  });

  it('falls back to page 1 for an invalid page in the URL', async () => {
    const fetchMock = mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([host(1)]) });
    renderApp('/hosts?page=abc');

    await screen.findByText('Servidor 1');
    expect(calledUrls(fetchMock, 'GET', HOSTS)[0]).toBe(`${HOSTS}?page=1&pageSize=10`);
  });
});

describe('Pagination window', () => {
  it('never renders hundreds of buttons', () => {
    expect(pageWindow(250, 500)).toEqual([1, 'gap', 249, 250, 251, 'gap', 500]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('create host (separate screen)', () => {
  it('validates the name, posts only administrative fields and opens the new host', async () => {
    const created = host(7, { displayName: 'Servidor principal' });
    const fetchMock = mockApi({
      ...signedIn(),
      [`POST ${HOSTS}`]: () => ({ status: 201, body: created }),
      [`GET ${HOSTS}/${created.id}`]: () => ({ status: 200, body: created }),
    });
    const { user, router } = renderApp('/hosts/novo');

    await screen.findByRole('heading', { name: 'Adicionar host' });
    expect(screen.queryByLabelText(/hostname/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adicionar host' }));
    expect(await screen.findByText('O nome do host deve ter entre 2 e 120 caracteres.')).toBeTruthy();
    expect(calledUrls(fetchMock, 'POST', HOSTS)).toHaveLength(0);

    await user.type(screen.getByLabelText('Nome do host'), '  Servidor principal ');
    await user.click(screen.getByRole('button', { name: 'Adicionar host' }));

    expect(await screen.findByText('Host adicionado.')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/hosts/${created.id}`);
    expect(requestBody(fetchMock, 'POST', HOSTS)).toEqual({ displayName: 'Servidor principal', description: null });
  });
});

describe('host detail', () => {
  it('shows collector facts as read-only "not reported" values', async () => {
    const target = host(3);
    mockApi({ ...signedIn(), [`GET ${HOSTS}/${target.id}`]: () => ({ status: 200, body: target }) });
    renderApp(`/hosts/${target.id}`);

    expect(await screen.findByRole('heading', { name: 'Servidor 3' })).toBeTruthy();
    expect(screen.getAllByText('Ainda não informado')).toHaveLength(2);
    expect(screen.getByText('Ainda não informada')).toBeTruthy();
    expect(screen.getByText('Nunca')).toBeTruthy();
    expect(screen.getAllByText('Não pareado').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('asks for confirmation before deleting, and cancel keeps the host', async () => {
    const target = host(4);
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${HOSTS}/${target.id}`]: () => ({ status: 200, body: target }),
      [`DELETE ${HOSTS}/${target.id}`]: () => ({ status: 204, body: null }),
      [`GET ${HOSTS}`]: () => page([]),
    });
    const { user, router } = renderApp(`/hosts/${target.id}`);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Excluir este host?' });
    expect(within(dialog).getByText(/O cadastro será removido deste workspace/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calledUrls(fetchMock, 'DELETE', HOSTS)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Excluir host' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/hosts'));
    expect(calledUrls(fetchMock, 'DELETE', HOSTS)).toEqual([`${HOSTS}/${target.id}`]);
  });
});

describe('edit host (separate screen)', () => {
  it('pre-fills the administrative fields and never sends technical ones', async () => {
    const target = host(5, { description: 'Antiga' });
    const updated = { ...target, displayName: 'Servidor de banco', description: 'Antiga' };
    const fetchMock = mockApi({
      ...signedIn(),
      [`GET ${HOSTS}/${target.id}`]: () => ({ status: 200, body: target }),
      [`PUT ${HOSTS}/${target.id}`]: () => ({ status: 200, body: updated }),
    });
    const { user, router } = renderApp(`/hosts/${target.id}/editar`);

    const name = (await screen.findByLabelText('Nome do host')) as HTMLInputElement;
    expect(name.value).toBe('Servidor 5');
    expect((screen.getByLabelText('Descrição') as HTMLTextAreaElement).value).toBe('Antiga');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    await user.clear(name);
    await user.type(name, 'Servidor de banco');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Host atualizado.')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/hosts/${target.id}`);
    expect(requestBody(fetchMock, 'PUT', `${HOSTS}/${target.id}`)).toEqual({ displayName: 'Servidor de banco', description: 'Antiga' });
  });

  it('shows a friendly 404 for a host that is missing or belongs to another workspace', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${HOSTS}/0b6c2f1e-0000-4000-8000-999999999999`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }),
    });
    renderApp('/hosts/0b6c2f1e-0000-4000-8000-999999999999/editar');

    expect(await screen.findByRole('heading', { name: 'Host não encontrado' })).toBeTruthy();
    expect(screen.queryByLabelText('Nome do host')).toBeNull();
  });
});

describe('active workspace', () => {
  const second = { id: '0b6c2f1e-0000-4000-8000-0000000000bb', name: 'Workspace Laboratório', kind: 'lab' as const, role: 'OWNER' as const };

  it('ignores a remembered workspace the user no longer belongs to', async () => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, 'not-mine');
    const fetchMock = mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([]) });
    renderApp('/hosts');

    await screen.findByText('Nenhum host cadastrado neste workspace.');
    expect(calledUrls(fetchMock, 'GET', '/api/workspaces/')[0]).toContain(WS);
    expect(screen.getAllByText('Workspace de Ana Teste').length).toBeGreaterThan(0);
  });

  it('switches workspace with the selector and scopes requests to it', async () => {
    const fetchMock = mockApi({
      ...signedIn({ ...ME, workspaces: [...ME.workspaces, second] }),
      [`GET ${HOSTS}`]: () => page([host(1)]),
      [`GET /api/workspaces/${second.id}/hosts`]: () => page([host(9, { workspaceId: second.id, displayName: 'Host do laboratório' })]),
    });
    const { user } = renderApp('/hosts');

    await screen.findByText('Servidor 1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace' }), second.id);

    expect(await screen.findByText('Host do laboratório')).toBeTruthy();
    expect(screen.queryByText('Servidor 1')).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBe(second.id);
    expect(calledUrls(fetchMock, 'GET', `/api/workspaces/${second.id}/hosts`).length).toBeGreaterThan(0);
  });
});

describe('dashboard', () => {
  it('shows the real number of registered hosts from pagination.total', async () => {
    const fetchMock = mockApi({ ...signedIn(), [`GET ${HOSTS}`]: () => page([host(1)], { pageSize: 1, total: 3, totalPages: 3 }) });
    renderApp('/dashboard');

    const card = (await screen.findByText('Hosts cadastrados')).closest('.metric') as HTMLElement;
    await waitFor(() => expect(within(card).getByText('3')).toBeTruthy());
    expect(calledUrls(fetchMock, 'GET', HOSTS)).toEqual([`${HOSTS}?page=1&pageSize=1`]);
  });
});
