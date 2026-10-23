import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { EventResponse, EventSummary, HostResponse, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const EVENTS = `/api/workspaces/${WS}/events`;
const HOSTS = `/api/workspaces/${WS}/hosts`;
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

const base = (n: number) => ({
  id: id(n),
  workspaceId: WS,
  hostId: id(101),
  hostDisplayName: 'servidor-web-01',
  occurredAt: '2026-05-01T10:00:05.000Z',
  ingestedAt: '2026-05-01T10:00:07.000Z',
  schemaVersion: 1,
  sourceEventId: '3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f',
});

const processEvent = (n: number): EventResponse => ({
  ...base(n),
  summary: 'bash (pid 4242)',
  category: 'PROCESS',
  type: 'PROCESS_STARTED',
  data: { process: { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user: null } },
});
const networkEvent = (n: number): EventResponse => ({
  ...base(n),
  summary: 'TCP *:8080 LISTEN',
  category: 'NETWORK',
  type: 'NETWORK_LISTEN',
  data: { network: { protocol: 'TCP', localAddress: null, localPort: 8080, remoteAddress: null, remotePort: null, pid: 77, processName: 'nginx' } },
});
const systemEvent = (n: number): EventResponse => ({
  ...base(n),
  summary: 'nginx → FAILED',
  category: 'SYSTEM',
  type: 'SYSTEM_SERVICE_STATE_CHANGED',
  data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'FAILED' } },
});

const summary = ({ schemaVersion: _v, sourceEventId: _s, data: _d, ...rest }: EventResponse): EventSummary => rest;
const page = <T,>(items: T[], meta: Partial<PaginatedResponse<T>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});
const hostsList = { [`GET ${HOSTS}`]: () => page([host(1), host(2)]) };

describe('events list (read-only)', () => {
  it('shows an honest empty state and offers no way to create events', async () => {
    mockApi({ ...signedIn(), ...hostsList, [`GET ${EVENTS}`]: () => page([]) });
    renderApp('/eventos');

    expect(await screen.findByText('Nenhum evento recebido.')).toBeTruthy();
    expect(screen.getByText(/Eventos aparecerão aqui quando telemetria for enviada ao Aegis/)).toBeTruthy();
    expect(screen.getByText(/Nenhum Collector está pareado ainda/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Novo/ })).toBeNull();
    expect(screen.queryByText(/ativo|online/i)).toBeNull();
  });

  it('lists time, type, summary, host and category of each event', async () => {
    mockApi({ ...signedIn(), ...hostsList, [`GET ${EVENTS}`]: () => page([summary(processEvent(1)), summary(networkEvent(2))]) });
    renderApp('/eventos');

    const list = await screen.findByRole('list', { name: 'Eventos' });
    const [first, second] = within(list).getAllByRole('link');
    expect(first?.getAttribute('href')).toBe(`/eventos/${id(1)}`);
    expect(first?.textContent).toContain('Processo iniciado');
    expect(first?.textContent).toContain('bash (pid 4242)');
    expect(first?.textContent).toContain('servidor-web-01');
    expect(first?.textContent).toContain('Processo');
    expect(first?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-05-01T10:00:05.000Z');
    expect(second?.textContent).toContain('Porta em escuta');
    expect(screen.getByText('2 eventos armazenados')).toBeTruthy();
  });

  it('puts host, category, type, range and page in the URL and sends them to the API', async () => {
    const fetchMock = mockApi({
      ...signedIn(),
      ...hostsList,
      [`GET ${EVENTS}`]: (_body, url) => page([summary(processEvent(1))], { page: Number(url.searchParams.get('page')), total: 45, totalPages: 3 }),
    });
    const { router, user } = renderApp('/eventos');
    await screen.findByRole('list', { name: 'Eventos' });

    await user.selectOptions(await screen.findByLabelText('Host'), id(102));
    await user.selectOptions(screen.getByLabelText('Categoria'), 'NETWORK');
    // Only the types of the chosen category are offered.
    expect(within(screen.getByLabelText('Tipo')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Todos os tipos', 'Conexão de rede', 'Porta em escuta']);
    await user.selectOptions(screen.getByLabelText('Tipo'), 'NETWORK_LISTEN');
    await user.type(screen.getByLabelText('De'), '2026-05-01T10:00');
    await user.click(await screen.findByRole('button', { name: 'Página 2' }));

    await waitFor(() => expect(router.state.location.search).toBe(`?hostId=${id(102)}&category=NETWORK&eventType=NETWORK_LISTEN&from=2026-05-01T10%3A00&page=2`));
    const from = new Date('2026-05-01T10:00').toISOString();
    await waitFor(() =>
      expect(calledUrls(fetchMock, 'GET', EVENTS)).toContain(
        `${EVENTS}?page=2&pageSize=20&hostId=${id(102)}&category=NETWORK&eventType=NETWORK_LISTEN&from=${encodeURIComponent(from)}`,
      ),
    );
  });

  it('flags an inverted range instead of showing stale results', async () => {
    mockApi({ ...signedIn(), ...hostsList, [`GET ${EVENTS}`]: () => page([summary(processEvent(1))]) });
    renderApp('/eventos?from=2026-05-02T10%3A00&to=2026-05-01T10%3A00');
    expect((await screen.findByRole('alert')).textContent).toBe('A data final deve ser posterior à inicial.');
    expect(screen.queryByRole('list', { name: 'Eventos' })).toBeNull();
  });
});

describe('event detail (read-only)', () => {
  const detail = (event: EventResponse) => ({ ...signedIn(), [`GET ${EVENTS}/${event.id}`]: () => ({ status: 200, body: event }) });
  const facts = () => {
    const section = screen.getByRole('region', { name: 'Dados técnicos' });
    return Object.fromEntries(within(section).getAllByRole('term').map((term) => [term.textContent, term.nextElementSibling?.textContent]));
  };

  it('shows the record and the PROCESS fields, saying "Não informado" for missing ones', async () => {
    mockApi(detail(processEvent(1)));
    renderApp(`/eventos/${id(1)}`);

    expect(await screen.findByRole('heading', { name: 'Processo iniciado' })).toBeTruthy();
    const record = screen.getByRole('region', { name: 'Registro' });
    expect(within(record).getByRole('link', { name: 'servidor-web-01' }).getAttribute('href')).toBe(`/hosts/${id(101)}`);
    expect(record.textContent).toContain('3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f');
    expect(record.textContent).toContain('PROCESS_STARTED');
    expect(facts()).toEqual({
      PID: '4242',
      'Parent PID': '1000',
      Nome: 'bash',
      Executável: '/usr/bin/bash',
      'Processo pai': 'nginx',
      Usuário: 'Não informado',
    });
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('shows NETWORK fields without inventing a remote end for a listening socket', async () => {
    mockApi(detail(networkEvent(2)));
    renderApp(`/eventos/${id(2)}`);
    await screen.findByRole('heading', { name: 'Porta em escuta' });
    expect(facts()).toEqual({
      Protocolo: 'TCP',
      'Endereço/porta local': '*:8080',
      'Endereço/porta remota': 'Não informado',
      PID: '77',
      Processo: 'nginx',
    });
  });

  it('shows SYSTEM fields with readable states and the normalized event as read-only text', async () => {
    mockApi(detail(systemEvent(3)));
    const { user } = renderApp(`/eventos/${id(3)}`);
    await screen.findByRole('heading', { name: 'Mudança de estado de serviço' });
    expect(facts()).toEqual({ Tipo: 'Mudança de estado de serviço', Serviço: 'nginx', Estado: 'Falhou' });

    await user.click(screen.getByText('Ver evento normalizado'));
    const json = JSON.parse(screen.getByText(/"schemaVersion"/).textContent ?? '{}') as Record<string, unknown>;
    expect(json).toEqual({
      schemaVersion: 1,
      sourceEventId: '3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f',
      occurredAt: '2026-05-01T10:00:05.000Z',
      category: 'SYSTEM',
      type: 'SYSTEM_SERVICE_STATE_CHANGED',
      data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'FAILED' } },
    });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a friendly 404', async () => {
    mockApi({ ...signedIn(), [`GET ${EVENTS}/${id(9)}`]: () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } } }) });
    renderApp(`/eventos/${id(9)}`);
    expect(await screen.findByText('Evento não encontrado')).toBeTruthy();
  });

  it('has no create or edit screen', async () => {
    mockApi({ ...signedIn() });
    renderApp('/eventos/novo');
    // "novo" is not a UUID: the API answers 404 and the page says so; there is no form.
    expect(await screen.findByText('Evento não encontrado')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('events elsewhere in the app', () => {
  it('navigation shows Eventos after Hosts and the dashboard shows the real stored total', async () => {
    mockApi({
      ...signedIn(),
      [`GET ${HOSTS}`]: () => page([], { total: 0 }),
      [`GET /api/workspaces/${WS}/detection-rules`]: () => page([], { total: 0 }),
      [`GET /api/workspaces/${WS}/incidents`]: () => page([], { total: 0 }),
      [`GET /api/workspaces/${WS}/investigations`]: () => page([], { total: 0 }),
      [`GET ${EVENTS}`]: () => page([summary(processEvent(1))], { total: 1234, pageSize: 1, totalPages: 1234 }),
    });
    renderApp('/dashboard');

    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Painel', 'Hosts', 'Eventos', 'Regras', 'Incidentes', 'Investigações', 'Perfil']);
    const card = screen.getByText('Eventos armazenados').closest('.metric');
    await waitFor(() => expect(card?.textContent).toContain('1234'));
    expect(screen.queryByText(/por minuto/i)).toBeNull();
  });
});
