import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { HostResponse, IncidentSummary, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { formatRelative } from '../src/lib/relative-time';
import { collectorState } from '../src/pages/DashboardPage';
import { FAKE_TOKEN, ME, mockApi, renderApp } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const signedIn = () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ({ status: 200, body: ME }) };
};

const host = (n: number, connectionState: HostResponse['connectionState'], lastSeenAt: string | null = null): HostResponse => ({
  id: id(100 + n),
  workspaceId: WS,
  displayName: `host-0${n}`,
  description: null,
  agentId: null,
  hostname: null,
  osName: null,
  osVersion: null,
  architecture: null,
  connectionState,
  lastSeenAt,
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
});

const incident = (n: number, severity: IncidentSummary['severity'], status: IncidentSummary['status'] = 'OPEN'): IncidentSummary => ({
  id: id(n),
  workspaceId: WS,
  title: `Incidente ${n}`,
  severity,
  status,
  origin: 'MANUAL',
  hostCount: 1,
  ruleCount: 0,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: `2026-05-0${n}T10:00:00.000Z`,
  resolvedAt: null,
});

const page = <T,>(items: T[], meta: Partial<PaginatedResponse<T>['pagination']> = {}) => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 100, total: items.length, totalPages: items.length ? 1 : 0, ...meta } },
});

describe('dashboard', () => {
  it('lists active incidents most severe first, from OPEN and INVESTIGATING', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/incidents`]: (_body, url) =>
        url.searchParams.get('status') === 'OPEN' ? page([incident(1, 'LOW'), incident(2, 'HIGH')]) : page([incident(3, 'CRITICAL', 'INVESTIGATING')]),
    });
    renderApp('/dashboard');

    const panel = (await screen.findByRole('heading', { name: 'Precisa de atenção' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(panel).getAllByRole('link').length).toBeGreaterThan(3));
    const rows = within(panel)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/incidentes/'));
    expect(rows.map((row) => row.querySelector('.mini-row__title')?.textContent)).toEqual(['Incidente 3', 'Incidente 2', 'Incidente 1']);
    const card = screen.getByText('Incidentes ativos').closest('.metric') as HTMLElement;
    expect(within(card).getByText('1 crítico')).toBeTruthy();
  });

  it('reports the Collector from real host communication, not a fixed label', async () => {
    mockApi({
      ...signedIn(),
      [`GET /api/workspaces/${WS}/hosts`]: () => page([host(1, 'ONLINE', new Date().toISOString()), host(2, 'UNPAIRED')]),
    });
    renderApp('/dashboard');

    const status = (await screen.findByRole('heading', { name: 'Status da plataforma' })).closest('section') as HTMLElement;
    const collector = within(status).getByText('Collector').closest('li') as HTMLElement;
    await waitFor(() => expect(collector.textContent).toContain('Online'));
    const card = screen.getByText('Hosts online').closest('.metric') as HTMLElement;
    expect(within(card).getByText('1/2')).toBeTruthy();
  });

  it('derives the Collector state from host connection states', () => {
    expect(collectorState(undefined)).toBe('checking');
    expect(collectorState([])).toBe('not-configured');
    expect(collectorState([host(1, 'UNPAIRED')])).toBe('not-configured');
    expect(collectorState([host(1, 'OFFLINE'), host(2, 'UNPAIRED')])).toBe('offline');
    expect(collectorState([host(1, 'PAIRED')])).toBe('offline');
    expect(collectorState([host(1, 'OFFLINE'), host(2, 'ONLINE')])).toBe('online');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');

  it('reads recent instants as elapsed time and old ones as a date', () => {
    expect(formatRelative('2026-11-19T11:59:30.000Z', now)).toBe('agora');
    expect(formatRelative('2026-11-19T12:00:05.000Z', now)).toBe('agora');
    expect(formatRelative('2026-11-19T11:57:00.000Z', now)).toBe('há 3 minutos');
    expect(formatRelative('2026-11-19T10:00:00.000Z', now)).toBe('há 2 horas');
    expect(formatRelative('2026-11-15T12:00:00.000Z', now)).toBe('há 4 dias');
    expect(formatRelative('2026-10-01T12:00:00.000Z', now)).toContain('2026');
    expect(formatRelative('não é data', now)).toBe('—');
  });
});

describe('account button', () => {
  it('shows up to two initials and links to the profile instead of a navigation item', async () => {
    const { initialsOf } = await import('../src/components/AppShell');
    expect(initialsOf('Ana Teste')).toBe('AT');
    expect(initialsOf('  vitor custódio bathke ')).toBe('VB');
    expect(initialsOf('Ana')).toBe('A');
    expect(initialsOf(undefined)).toBe('?');

    mockApi(signedIn());
    renderApp('/dashboard');
    const account = await screen.findByRole('link', { name: `Perfil de ${ME.user.name}` });
    expect(account.getAttribute('href')).toBe('/perfil');
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).queryByRole('link', { name: 'Perfil' })).toBeNull();
  });
});
