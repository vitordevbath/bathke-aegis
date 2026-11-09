import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { HostPairingResponse, HostResponse, MachineCredentialResponse, MeResponse, PairingCodeResponse, RotateCredentialResponse } from '@aegis/contracts';
import { AUTH_TOKEN_KEY } from '../src/lib/auth-storage';
import { FAKE_TOKEN, ME, mockApi, renderApp } from './render-app';

const WS = ME.workspaces[0]?.id ?? '';
const HOST_ID = '0b6c2f1e-0000-4000-8000-000000000001';
const CREDENTIAL_ID = '1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab';
const HOST_URL = `/api/workspaces/${WS}/hosts/${HOST_ID}`;
const PAIRING_URL = `${HOST_URL}/pairing`;
const CODES_URL = `${HOST_URL}/pairing-codes`;
const CREDENTIAL_URL = `${HOST_URL}/credentials/${CREDENTIAL_ID}`;

// Assembled at runtime: nothing sensitive-looking is committed as a literal.
const fakeCode = () => ['aegis', 'pair', 'c'.repeat(43)].join('_');
const fakeToken = () => `${['aegis', 'agent', 'f'.repeat(32)].join('_')}.${'s'.repeat(43)}`;

const host = (overrides: Partial<HostResponse> = {}): HostResponse => ({
  id: HOST_ID,
  workspaceId: WS,
  displayName: 'Servidor 1',
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

const credential = (overrides: Partial<MachineCredentialResponse> = {}): MachineCredentialResponse => ({
  id: CREDENTIAL_ID,
  tokenPrefix: 'aegis_agent_1a2b3c4d',
  scopes: ['events:ingest'],
  status: 'ACTIVE',
  createdAt: '2026-03-01T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  rotatedFromCredentialId: null,
  ...overrides,
});

const unpaired: HostPairingResponse = { pendingCode: null, activeCredential: null, credentials: [] };
const paired = (overrides: Partial<MachineCredentialResponse> = {}): HostPairingResponse => {
  const active = credential(overrides);
  return { pendingCode: null, activeCredential: active, credentials: [active] };
};

const ok = (body: unknown, status = 200) => ({ status, body });
const failure = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } });
const inFuture = (minutes = 10) => new Date(Date.now() + minutes * 60_000).toISOString();

const signedIn = (me: MeResponse = ME) => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, FAKE_TOKEN);
  return { 'GET /api/users/me': () => ok(me) };
};

const viewerMe: MeResponse = { ...ME, workspaces: ME.workspaces.map((workspace) => ({ ...workspace, role: 'VIEWER' })) };

/** The screen the panel lives on, with the pairing state served by `state()`. */
const api = (state: () => HostPairingResponse, extra: Parameters<typeof mockApi>[0] = {}, me: MeResponse = ME) =>
  mockApi({
    ...signedIn(me),
    [`GET ${HOST_URL}`]: () => ok(host()),
    [`GET ${PAIRING_URL}`]: () => ok(state()),
    ...extra,
  });

const panel = async () => within(await screen.findByRole('region', { name: 'Pareamento do Collector' }));
const confirmIn = async (dialogName: string, confirmLabel: string, user: ReturnType<typeof renderApp>['user']) => {
  const dialog = await screen.findByRole('alertdialog', { name: dialogName });
  await user.click(within(dialog).getByRole('button', { name: confirmLabel }));
};

const allBrowserStorage = () => JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]);

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('host pairing: not paired', () => {
  it('states the truth: not paired, nothing connected, one action', async () => {
    api(() => unpaired);
    renderApp(`/hosts/${HOST_ID}`);
    const region = await panel();
    expect(await region.findByText('Host ainda não pareado.')).toBeTruthy();
    expect(region.getByText(/ainda precisa ser conectado/)).toBeTruthy();
    expect(region.getByRole('button', { name: 'Parear Collector' })).toBeTruthy();
    expect(screen.queryByText(/online/i)).toBeNull();
  });

  it('reports a pending code by its expiry and offers to replace it, never showing a code', async () => {
    api(() => ({ ...unpaired, pendingCode: { expiresAt: inFuture() } }));
    renderApp(`/hosts/${HOST_ID}`);
    const region = await panel();
    expect(await region.findByText(/Há um código pendente/)).toBeTruthy();
    expect(region.getByText(/não pode ser exibido novamente/)).toBeTruthy();
    expect(region.getByRole('button', { name: 'Gerar novo código' })).toBeTruthy();
    expect(region.queryByRole('group')).toBeNull();
  });

  it('hides the action from members who cannot pair', async () => {
    api(() => unpaired, {}, viewerMe);
    renderApp(`/hosts/${HOST_ID}`);
    const region = await panel();
    expect(await region.findByText('Somente o proprietário do workspace pode parear este host.')).toBeTruthy();
    expect(region.queryByRole('button', { name: 'Parear Collector' })).toBeNull();
  });
});

describe('host pairing: generating a code', () => {
  const generated = (): PairingCodeResponse => ({ code: fakeCode(), expiresAt: inFuture() });

  it('shows the code once, with validity and warnings, without claiming a connection', async () => {
    let state = unpaired;
    api(() => state, {
      [`POST ${CODES_URL}`]: () => {
        const body = generated();
        state = { ...unpaired, pendingCode: { expiresAt: body.expiresAt } };
        return ok(body, 201);
      },
    });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));

    const secret = await screen.findByRole('group', { name: 'Código de pareamento' });
    expect(within(secret).getByText(fakeCode())).toBeTruthy();
    expect(within(secret).getByText(/Válido até/)).toBeTruthy();
    expect(within(secret).getByText(/exibido uma única vez e não poderá ser recuperado/)).toBeTruthy();
    expect(within(secret).getByText(/Não compartilhe este código/)).toBeTruthy();
    expect((await panel()).getByText('Host ainda não pareado.')).toBeTruthy();
    expect(screen.queryByText(/online|instalado|conectado com sucesso/i)).toBeNull();
    // The pending notice is about codes that can no longer be shown.
    expect(screen.queryByText(/Há um código pendente/)).toBeNull();
  });

  it('copies the code and confirms it', async () => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => ok(generated(), 201) });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    const secret = await screen.findByRole('group', { name: 'Código de pareamento' });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(within(secret).getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith(fakeCode());
    expect(await within(secret).findByText('Copiado.')).toBeTruthy();
  });

  it('says so when the clipboard is unavailable', async () => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => ok(generated(), 201) });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    const secret = await screen.findByRole('group', { name: 'Código de pareamento' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(within(secret).getByRole('button', { name: 'Copiar' }));
    expect(await within(secret).findByText(/copie manualmente/)).toBeTruthy();
  });

  it('never stores the code: gone from the screen, the cache and browser storage after leaving', async () => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => ok(generated(), 201), [`GET /api/workspaces/${WS}/hosts`]: () => ok({ items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }) });
    const { user, router, queryClient } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    await screen.findByText(fakeCode());
    expect(allBrowserStorage()).not.toContain(fakeCode());
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(fakeCode());

    await act(() => router.navigate('/hosts'));
    expect(await screen.findByText('Nenhum host cadastrado neste workspace.')).toBeTruthy();
    expect(screen.queryByText(fakeCode())).toBeNull();
    await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data))).not.toContain(fakeCode()));

    await act(() => router.navigate(`/hosts/${HOST_ID}`));
    expect(await (await panel()).findByText('Host ainda não pareado.')).toBeTruthy();
    expect(screen.queryByText(fakeCode())).toBeNull();
    expect(allBrowserStorage()).not.toContain(fakeCode());
  });

  it('removes the code from the screen when it expires', async () => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => ok({ code: fakeCode(), expiresAt: new Date(Date.now() + 1500).toISOString() }, 201) });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    await screen.findByText(fakeCode());
    await waitFor(() => expect(screen.queryByText(fakeCode())).toBeNull(), { timeout: 4000 });
    expect(await screen.findByText(/O código expirou e foi removido da tela/)).toBeTruthy();
  });

  it.each([
    [403, 'FORBIDDEN', 'Seu papel neste workspace não permite esta ação.'],
    [409, 'INVALID_STATE', 'Este host já possui uma credencial ativa.'],
    [429, 'RATE_LIMITED', 'Muitos códigos solicitados para este host.'],
  ])('shows the API message on %i', async (status, code, message) => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => failure(status, code, message) });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Código de pareamento' })).toBeNull();
  });

  it('shows a generic message on an unexpected failure', async () => {
    api(() => unpaired, { [`POST ${CODES_URL}`]: () => failure(500, 'INTERNAL_ERROR', 'detalhe interno') });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    expect(await screen.findByText('Não foi possível concluir a ação agora. Tente novamente.')).toBeTruthy();
    expect(screen.queryByText('detalhe interno')).toBeNull();
  });

  it('shows an error if the pairing state cannot be loaded, without inventing one', async () => {
    mockApi({ ...signedIn(), [`GET ${HOST_URL}`]: () => ok(host()), [`GET ${PAIRING_URL}`]: () => failure(500, 'INTERNAL_ERROR', 'erro') });
    renderApp(`/hosts/${HOST_ID}`);
    expect(await screen.findByText(/Não foi possível carregar o pareamento/)).toBeTruthy();
    expect(screen.queryByText('Host ainda não pareado.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Parear Collector' })).toBeNull();
  });
});

describe('host pairing: paired', () => {
  it('lists public metadata only and keeps pairing, connectivity and usage apart', async () => {
    api(() => paired({ lastUsedAt: '2026-03-02T10:00:00.000Z' }));
    renderApp(`/hosts/${HOST_ID}`);
    const region = await panel();
    expect(await region.findByText('aegis_agent_1a2b3c4d')).toBeTruthy();
    expect(region.getByText('Pareado')).toBeTruthy();
    expect(region.getByText('Ativa')).toBeTruthy();
    expect(region.getByText('Enviar eventos deste host')).toBeTruthy();
    expect(region.getByText('Última utilização da credencial')).toBeTruthy();
    expect(region.queryByText('Nunca utilizada')).toBeNull();
    expect(region.getByText(/não que o Collector esteja online/)).toBeTruthy();
    expect(region.getByText(/não é o último evento recebido/)).toBeTruthy();
    expect(region.queryByRole('group')).toBeNull();
    expect(region.queryByRole('button', { name: 'Parear Collector' })).toBeNull();
  });

  it('says when the credential was never used', async () => {
    api(() => paired());
    renderApp(`/hosts/${HOST_ID}`);
    expect(await (await panel()).findByText('Nunca utilizada')).toBeTruthy();
  });

  it('hides administrative actions from members who cannot manage', async () => {
    api(() => paired(), {}, viewerMe);
    renderApp(`/hosts/${HOST_ID}`);
    const region = await panel();
    expect(await region.findByText(/Somente o proprietário do workspace pode rotacionar ou revogar/)).toBeTruthy();
    expect(region.queryByRole('button', { name: 'Rotacionar credencial' })).toBeNull();
    expect(region.queryByRole('button', { name: 'Revogar credencial' })).toBeNull();
  });

  it('drops a code still on screen once a machine has paired', async () => {
    let state: HostPairingResponse = unpaired;
    api(() => state, { [`POST ${CODES_URL}`]: () => ok({ code: fakeCode(), expiresAt: inFuture() }, 201) });
    const { user, queryClient } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Parear Collector' }));
    await screen.findByText(fakeCode());
    state = paired();
    await act(() => queryClient.invalidateQueries());
    expect(await (await panel()).findByText('aegis_agent_1a2b3c4d')).toBeTruthy();
    expect(screen.queryByText(fakeCode())).toBeNull();
  });
});

describe('host pairing: rotation', () => {
  const rotated = (): RotateCredentialResponse => ({ token: fakeToken(), tokenType: 'Bearer', credential: credential({ id: '2a2b3c4d-5e6f-4a1b-8c2d-0123456789ab', tokenPrefix: 'aegis_agent_2a2b3c4d' }) });

  it('asks first and does nothing when cancelled', async () => {
    const fetchMock = api(() => paired());
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Rotacionar credencial' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Rotacionar esta credencial?' });
    expect(within(dialog).getByText(/deixará de funcionar imediatamente/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows the new credential once, reports the result and closes the confirmation', async () => {
    let state = paired();
    const next = rotated();
    api(() => state, {
      [`POST ${CREDENTIAL_URL}/rotate`]: () => {
        state = { pendingCode: null, activeCredential: next.credential, credentials: [next.credential] };
        return ok(next);
      },
    });
    const { user, router, queryClient } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Rotacionar credencial' }));
    await confirmIn('Rotacionar esta credencial?', 'Rotacionar', user);

    const secret = await screen.findByRole('group', { name: 'Nova credencial de máquina' });
    expect(within(secret).getByText(fakeToken())).toBeTruthy();
    expect(within(secret).getByText(/exibida uma única vez/)).toBeTruthy();
    expect(await screen.findByText(/A credencial anterior deixou de funcionar/)).toBeTruthy();
    expect(await (await panel()).findByText('aegis_agent_2a2b3c4d')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(allBrowserStorage()).not.toContain(fakeToken());

    await act(() => router.navigate('/perfil'));
    await waitFor(() => expect(screen.queryByText(fakeToken())).toBeNull());
    await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data))).not.toContain(fakeToken()));
  });

  it('keeps the confirmation open and shows the API message on failure', async () => {
    api(() => paired(), { [`POST ${CREDENTIAL_URL}/rotate`]: () => failure(409, 'INVALID_STATE', 'Esta credencial já foi revogada e não pode ser rotacionada.') });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Rotacionar credencial' }));
    await confirmIn('Rotacionar esta credencial?', 'Rotacionar', user);
    expect(await screen.findByText('Esta credencial já foi revogada e não pode ser rotacionada.')).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Rotacionar esta credencial?' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Nova credencial de máquina' })).toBeNull();
  });
});

describe('host pairing: revocation', () => {
  it('warns that the Collector stops sending events, then returns to not paired', async () => {
    let state = paired();
    const fetchMock = api(() => state, {
      [`DELETE ${CREDENTIAL_URL}`]: () => {
        state = { pendingCode: null, activeCredential: null, credentials: [credential({ status: 'REVOKED', revokedAt: '2026-03-03T10:00:00.000Z' })] };
        return { status: 204, body: null };
      },
    });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Revogar credencial' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Revogar esta credencial?' });
    expect(within(dialog).getByText(/deixará de conseguir enviar eventos/)).toBeTruthy();
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Revogar' }));

    expect(await screen.findByText(/Este Collector não consegue mais enviar eventos/)).toBeTruthy();
    expect(await (await panel()).findByText('Host ainda não pareado.')).toBeTruthy();
    expect((await panel()).getByRole('button', { name: 'Parear Collector' })).toBeTruthy();
  });

  it('shows the API message when the role is refused', async () => {
    api(() => paired(), { [`DELETE ${CREDENTIAL_URL}`]: () => failure(403, 'FORBIDDEN', 'Seu papel neste workspace não permite esta ação.') });
    const { user } = renderApp(`/hosts/${HOST_ID}`);
    await user.click(await (await panel()).findByRole('button', { name: 'Revogar credencial' }));
    await confirmIn('Revogar esta credencial?', 'Revogar', user);
    expect(await screen.findByText('Seu papel neste workspace não permite esta ação.')).toBeTruthy();
    expect((await panel()).getByText('aegis_agent_1a2b3c4d')).toBeTruthy();
  });
});

describe('connection state badge', () => {
  it('shows "Pareado" for a paired host, never "Online"', async () => {
    mockApi({ ...signedIn(), [`GET ${HOST_URL}`]: () => ok(host({ connectionState: 'PAIRED', agentId: CREDENTIAL_ID })), [`GET ${PAIRING_URL}`]: () => ok(paired()) });
    renderApp(`/hosts/${HOST_ID}`);
    await panel();
    expect((await screen.findAllByText('Pareado')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Online')).toBeNull();
  });
});
