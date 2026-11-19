import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { HostResponse, IncidentResponse, MeResponse, PaginatedResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { workspaceStorage } from '../src/lib/workspace-storage';
import { FAKE_TOKEN, ME, mockApi, renderApp } from './render-app';

const PERSONAL = ME.workspaces[0]!;
const DEMO = { id: '0b6c2f1e-0000-4000-8000-0000000000de', name: 'AEGIS DEMO', kind: 'demo', role: 'VIEWER' } as const;
const WITH_DEMO: MeResponse = { ...ME, workspaces: [PERSONAL, DEMO] };
const id = (n: number) => `0b6c2f1e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const host: HostResponse = {
  id: id(101),
  workspaceId: DEMO.id,
  displayName: 'srv-web-01',
  description: 'Host simulado do AEGIS DEMO.',
  agentId: null,
  hostname: null,
  osName: null,
  osVersion: null,
  architecture: null,
  connectionState: 'ONLINE',
  lastSeenAt: new Date().toISOString(),
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
};

const incident: IncidentResponse = {
  id: id(7),
  workspaceId: DEMO.id,
  title: 'Boot inesperado em srv-db-01',
  description: null,
  severity: 'CRITICAL',
  status: 'OPEN',
  origin: 'MANUAL',
  hostCount: 1,
  ruleCount: 0,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  resolvedAt: null,
  hosts: [{ hostId: host.id, displayName: host.displayName, connectionState: 'ONLINE' }],
  detectionRules: [],
  availableTransitions: ['INVESTIGATING', 'RESOLVED'],
};

const page = <T,>(items: T[]): { status: number; body: PaginatedResponse<T> } => ({
  status: 200,
  body: { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 } },
});

function signedInTo(workspaceId: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  workspaceStorage.set(workspaceId);
  return { 'GET /api/users/me': () => ({ status: 200, body: WITH_DEMO }) };
}

describe('AEGIS DEMO in the panel (viewer)', () => {
  it('opens the personal workspace by default, not the demo', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
    mockApi({ 'GET /api/users/me': () => ({ status: 200, body: WITH_DEMO }) });
    renderApp('/hosts');

    expect(await screen.findByText(PERSONAL.name, { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText('Você está no AEGIS DEMO.')).toBeNull();
    expect(await screen.findByRole('link', { name: 'Adicionar host' })).toBeTruthy();
  });

  it('shows the demo banner and hides create, edit and delete for a viewer', async () => {
    mockApi({ ...signedInTo(DEMO.id), [`GET /api/workspaces/${DEMO.id}/hosts`]: () => page([host]) });
    renderApp('/hosts');

    expect(await screen.findByText('srv-web-01')).toBeTruthy();
    expect(screen.getByText('Você está no AEGIS DEMO.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar ao meu workspace' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Adicionar host' })).toBeNull();
  });

  it('shows the incident status without transitions, edit or delete', async () => {
    mockApi({ ...signedInTo(DEMO.id), [`GET /api/workspaces/${DEMO.id}/incidents/${incident.id}`]: () => ({ status: 200, body: incident }) });
    renderApp(`/incidentes/${incident.id}`);

    expect(await screen.findByRole('heading', { name: incident.title })).toBeTruthy();
    expect(screen.getByText('Somente leitura neste workspace.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Iniciar investigação|Resolver/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('explains instead of showing a form when a viewer opens a create screen by URL', async () => {
    mockApi(signedInTo(DEMO.id));
    renderApp('/hosts/novo');

    expect(await screen.findByText('Este workspace é somente leitura.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Voltar ao painel' }).getAttribute('href')).toBe('/dashboard');
  });

  it('keeps every action for the owner of the personal workspace', async () => {
    mockApi({ ...signedInTo(PERSONAL.id), [`GET /api/workspaces/${PERSONAL.id}/incidents/${incident.id}`]: () => ({ status: 200, body: { ...incident, workspaceId: PERSONAL.id } }) });
    renderApp(`/incidentes/${incident.id}`);

    expect(await screen.findByRole('button', { name: 'Resolver' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Editar' })).toBeTruthy();
    expect(screen.queryByText('Você está no AEGIS DEMO.')).toBeNull();
  });
});
