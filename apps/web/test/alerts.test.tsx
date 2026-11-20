import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AlertResponse, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, calledUrls, mockApi, renderApp } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const ALERTS = `/api/workspaces/${WS}/alerts`;
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const signedIn = () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: ME }) };
};

const alert = (n: number, overrides: Partial<AlertResponse> = {}): AlertResponse => ({
  id: id(n),
  workspaceId: WS,
  severity: 'HIGH',
  occurredAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  rule: { id: id(200), name: 'sshd mudou de estado' },
  host: { id: id(100), displayName: 'srv-web-01' },
  event: { id: id(300 + n), type: 'SYSTEM_SERVICE_STATE_CHANGED', summary: 'sshd → STOPPED' },
  incident: { id: id(400), title: 'sshd mudou de estado em srv-web-01' },
  ...overrides,
});

const page = <T,>(items: T[]): { status: number; body: PaginatedResponse<T> } => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 } },
});

describe('alerts (read-only, ADR-053)', () => {
  it('lists alerts with rule, host, event summary, severity and incident, and offers no way to create one', async () => {
    mockApi({ ...signedIn(), [`GET ${ALERTS}`]: () => page([alert(1), alert(2, { severity: 'CRITICAL', incident: null })]) });
    renderApp('/alertas');

    const rows = await screen.findAllByRole('link', { name: /sshd mudou de estado/ });
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([`/alertas/${id(1)}`, `/alertas/${id(2)}`]);
    expect(within(rows[0]!).getByText(/srv-web-01 · sshd → STOPPED/)).toBeTruthy();
    expect(within(rows[1]!).getByText('Sem incidente')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Novo|Criar/ })).toBeNull();
  });

  it('filters by severity through the URL and the API query', async () => {
    const fetchMock = mockApi({ ...signedIn(), [`GET ${ALERTS}`]: () => page([]) });
    const { user, router } = renderApp('/alertas');
    await user.selectOptions(await screen.findByLabelText('Severidade'), 'CRITICAL');
    await waitFor(() => expect(router.state.location.search).toBe('?severity=CRITICAL'));
    await waitFor(() => expect(calledUrls(fetchMock, 'GET', ALERTS)).toContain(`${ALERTS}?page=1&pageSize=20&severity=CRITICAL`));
    expect(await screen.findByText('Nenhum alerta encontrado.')).toBeTruthy();
  });

  it('shows an alert with links to its rule, host, event and incident', async () => {
    mockApi({ ...signedIn(), [`GET ${ALERTS}/${id(1)}`]: () => ({ status: 200, body: alert(1) }) });
    renderApp(`/alertas/${id(1)}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'sshd mudou de estado' })).toBeTruthy();
    const related = screen.getByRole('heading', { name: 'Relacionado' }).closest('section') as HTMLElement;
    expect(within(related).getByRole('link', { name: 'srv-web-01' }).getAttribute('href')).toBe(`/hosts/${id(100)}`);
    expect(within(related).getByRole('link', { name: 'sshd mudou de estado em srv-web-01' }).getAttribute('href')).toBe(`/incidentes/${id(400)}`);
    expect(screen.getByRole('link', { name: 'Mudança de estado de serviço' }).getAttribute('href')).toBe(`/eventos/${id(301)}`);
  });

  it('reports the detection engine as online on the dashboard when a rule is enabled', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/detection-rules`]: (_body, url) =>
        url.searchParams.get('enabled') === 'true' ? { status: 200, body: { items: [], pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 } } } : { status: 200, body: { items: [], pagination: { page: 1, pageSize: 1, total: 3, totalPages: 3 } } },
      [`GET ${ALERTS}`]: () => page([alert(1)]),
    });
    renderApp('/dashboard');

    const status = (await screen.findByRole('heading', { name: 'Status da plataforma' })).closest('section') as HTMLElement;
    await waitFor(() => expect((within(status).getByText('Motor de detecção').closest('li') as HTMLElement).textContent).toContain('Online'));
    expect(within(status).getByText(/2 de 3 regras habilitadas/)).toBeTruthy();
    const card = screen.getByText('Alertas', { selector: '.metric__label' }).closest('.metric') as HTMLElement;
    await waitFor(() => expect(card.textContent).toContain('1'));
  });
});
