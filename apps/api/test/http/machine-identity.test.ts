import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatMachineToken } from '@aegis/domain';
import type { ApiErrorResponse, HostPairingResponse, HostResponse, IngestEventsResponse, PairAgentResponse, PairingCodeResponse, RotateCredentialResponse } from '@aegis/contracts';
import { MachineAuthContext } from '../../src/application/machine-auth-context.js';
import type { AuthenticateMachine } from '../../src/application/use-cases/machine-identity/authenticate-machine.js';
import { AttemptWindow } from '../../src/presentation/http/attempt-window.js';
import { Membership } from '../../src/domain/membership.js';
import { bearer, buildTestApp, pairHost, redeemCode, requestPairingCode, signedInUser } from '../support/test-app.js';
import type { InMemoryStore } from '../support/in-memory-persistence.js';

const logLines: string[] = [];
let app: FastifyInstance;
let store: InMemoryStore;

beforeAll(async () => {
  const built = await buildTestApp({ logLines });
  app = built.app;
  store = built.persistence.store;
});
afterAll(() => app.close());

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } };
const UNAUTHENTICATED = { error: { code: 'AUTHENTICATION_ERROR', message: 'Não autenticado.' } };
const CODE_REJECTED = { error: { code: 'AUTHENTICATION_ERROR', message: 'Código de pareamento inválido ou expirado.' } };

const boot = () => ({
  schemaVersion: 1,
  sourceEventId: randomUUID(),
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  category: 'SYSTEM',
  type: 'SYSTEM_BOOT',
  data: { system: { eventType: 'BOOT' } },
});

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, headers: bearer(token), payload });
  const host = async () => (await call('POST', '/hosts', { displayName: `host-${Math.random().toString(36).slice(2, 8)}` })).json<HostResponse>();
  const pair = (hostId: string) => pairHost(app, token, workspaceId, hostId);
  return { token, workspaceId, base, call, host, pair };
}

const ingest = (base: string, hostId: string, headers: Record<string, string>, events: unknown[] = [boot()]) =>
  app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/events/ingest`, headers, payload: { events } });

const pairingOf = async (t: Awaited<ReturnType<typeof tenant>>, hostId: string) => (await t.call('GET', `/hosts/${hostId}/pairing`)).json<HostPairingResponse>();
const expireChallenges = () => {
  for (const [id, challenge] of store.pairingChallenges) store.pairingChallenges.set(id, { ...challenge, expiresAt: new Date(Date.now() - 1000) });
};

describe('pairing codes (administration)', () => {
  it('requires a user session on every administrative route', async () => {
    const t = await tenant();
    const host = await t.host();
    const credentialId = randomUUID();
    for (const [method, url] of [
      ['POST', `/hosts/${host.id}/pairing-codes`],
      ['GET', `/hosts/${host.id}/pairing`],
      ['POST', `/hosts/${host.id}/credentials/${credentialId}/rotate`],
      ['DELETE', `/hosts/${host.id}/credentials/${credentialId}`],
    ] as const) {
      const response = await app.inject({ method, url: `${t.base}${url}` });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(UNAUTHENTICATED);
    }
  });

  it('gives the OWNER a high-entropy code with an expiry, once, without pairing the host', async () => {
    const t = await tenant();
    const host = await t.host();
    const response = await t.call('POST', `/hosts/${host.id}/pairing-codes`);
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<PairingCodeResponse>();
    expect(Object.keys(body).sort()).toEqual(['code', 'expiresAt']);
    expect(body.code).toMatch(/^aegis_pair_[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    expect((await t.call('GET', `/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ connectionState: 'UNPAIRED', agentId: null, lastSeenAt: null });
    const pairing = await pairingOf(t, host.id);
    expect(pairing).toEqual({ pendingCode: { expiresAt: body.expiresAt }, activeCredential: null, credentials: [] });
    expect(JSON.stringify(pairing)).not.toContain(body.code);
  });

  it('403 for members without permission; 404 for other tenants, unknown and malformed ids', async () => {
    const owner = await tenant();
    const member = await tenant();
    const outsider = await tenant();
    const host = await owner.host();
    const credential = await owner.pair(host.id);
    const memberUser = [...store.users.values()].at(-2);
    store.memberships.set(`${memberUser?.id}:${owner.workspaceId}`, Membership.restore({ userId: memberUser?.id ?? '', workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot());
    const asMember = (method: 'POST' | 'DELETE', url: string) => app.inject({ method, url: `${owner.base}${url}`, headers: bearer(member.token) });

    expect((await asMember('POST', `/hosts/${host.id}/pairing-codes`)).statusCode).toBe(403);
    expect((await asMember('POST', `/hosts/${host.id}/credentials/${credential.credentialId}/rotate`)).statusCode).toBe(403);
    expect((await asMember('DELETE', `/hosts/${host.id}/credentials/${credential.credentialId}`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${owner.base}/hosts/${host.id}/pairing`, headers: bearer(member.token) })).statusCode).toBe(200);

    for (const response of [
      await app.inject({ method: 'POST', url: `${owner.base}/hosts/${host.id}/pairing-codes`, headers: bearer(outsider.token) }),
      await app.inject({ method: 'GET', url: `${owner.base}/hosts/${host.id}/pairing`, headers: bearer(outsider.token) }),
      await app.inject({ method: 'DELETE', url: `${owner.base}/hosts/${host.id}/credentials/${credential.credentialId}`, headers: bearer(outsider.token) }),
      await outsider.call('POST', `/hosts/${host.id}/pairing-codes`),
      await outsider.call('POST', `/hosts/${randomUUID()}/pairing-codes`),
      await outsider.call('POST', '/hosts/nao-e-uuid/pairing-codes'),
      await owner.call('DELETE', `/hosts/${host.id}/credentials/${randomUUID()}`),
      await owner.call('POST', `/hosts/${host.id}/credentials/nao-e-uuid/rotate`),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
  });

  it('409 for a host that already has an active credential', async () => {
    const t = await tenant();
    const host = await t.host();
    await t.pair(host.id);
    const response = await t.call('POST', `/hosts/${host.id}/pairing-codes`);
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error.code).toBe('INVALID_STATE');
  });

  it('limits the codes requested per host (429), with a temporary window', async () => {
    const limited = await buildTestApp({ pairing: { codesPerHostPerHour: 2 } });
    try {
      const { token, session } = await signedInUser(limited.app);
      const url = `/workspaces/${session.workspaces[0]?.id}/hosts`;
      const host = (await limited.app.inject({ method: 'POST', url, headers: bearer(token), payload: { displayName: 'servidor' } })).json<HostResponse>();
      const request = () => limited.app.inject({ method: 'POST', url: `${url}/${host.id}/pairing-codes`, headers: bearer(token) });
      expect([(await request()).statusCode, (await request()).statusCode, (await request()).statusCode]).toEqual([201, 201, 429]);
    } finally {
      await limited.app.close();
    }
  });
});

describe('POST /agent/pair', () => {
  it('needs no user session and answers with the credential once, resolving the target on the server', async () => {
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    const response = await redeemCode(app, code);
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<PairAgentResponse>();
    expect(body).toMatchObject({ tokenType: 'Bearer', workspaceId: t.workspaceId, hostId: host.id, scopes: ['events:ingest'] });
    expect(body.token).toMatch(/^aegis_agent_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    expect(body.token.split('.')).toHaveLength(2);
    expect((await t.call('GET', `/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ connectionState: 'PAIRED', agentId: body.credentialId, lastSeenAt: null });
  });

  it('rejects client-chosen targets instead of ignoring them', async () => {
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    for (const extra of [{ hostId: randomUUID() }, { workspaceId: randomUUID() }, { scopes: ['admin'] }]) {
      expect((await app.inject({ method: 'POST', url: '/agent/pair', payload: { code, ...extra } })).statusCode).toBe(400);
    }
    expect((await redeemCode(app, code)).statusCode).toBe(201);
  });

  it('every refused code gets the same answer: consumed, expired, revoked, unknown, malformed', async () => {
    const t = await tenant();
    const [consumedHost, expiredHost, revokedHost] = [await t.host(), await t.host(), await t.host()];

    const consumed = await requestPairingCode(app, t.token, t.workspaceId, consumedHost.id);
    await redeemCode(app, consumed.code);

    const revoked = await requestPairingCode(app, t.token, t.workspaceId, revokedHost.id);
    await requestPairingCode(app, t.token, t.workspaceId, revokedHost.id);

    const expired = await requestPairingCode(app, t.token, t.workspaceId, expiredHost.id);
    expireChallenges();

    const credentialsBefore = store.machineCredentials.size;
    for (const code of [consumed.code, expired.code, revoked.code, `aegis_pair_${'Z'.repeat(43)}`, 'isto-nao-e-um-codigo', formatMachineToken(randomUUID(), 'A'.repeat(43))]) {
      const response = await redeemCode(app, code);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(CODE_REJECTED);
    }
    expect(store.machineCredentials.size).toBe(credentialsBefore);
  });

  it('400 for a body that is not just a code', async () => {
    for (const payload of [{}, { code: 1 }, { code: 'x'.repeat(129) }]) {
      expect((await app.inject({ method: 'POST', url: '/agent/pair', payload })).statusCode).toBe(400);
    }
  });

  it('applies its own per-IP limit, separate from login and ingestion', async () => {
    const limited = await buildTestApp({ authRateLimitMax: 1000, ingestRateLimitMax: 1000, pairing: { pairRateLimitMax: 2 } });
    try {
      const send = () => redeemCode(limited.app, `aegis_pair_${'Z'.repeat(43)}`);
      expect([(await send()).statusCode, (await send()).statusCode, (await send()).statusCode]).toEqual([401, 401, 429]);
      expect((await signedInUser(limited.app)).token).toBeTruthy();
    } finally {
      await limited.app.close();
    }
  });

  it('pauses an address after too many refused codes, even for a valid code, without touching the host', async () => {
    const limited = await buildTestApp({ pairing: { invalidAttemptsMax: 2 } });
    try {
      const { token, session } = await signedInUser(limited.app);
      const workspaceId = session.workspaces[0]?.id ?? '';
      const host = (await limited.app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts`, headers: bearer(token), payload: { displayName: 'servidor' } })).json<HostResponse>();
      const { code } = await requestPairingCode(limited.app, token, workspaceId, host.id);
      const wrong = () => redeemCode(limited.app, `aegis_pair_${'Z'.repeat(43)}`);
      expect([(await wrong()).statusCode, (await wrong()).statusCode, (await wrong()).statusCode]).toEqual([401, 401, 429]);
      expect((await redeemCode(limited.app, code)).statusCode).toBe(429);
      expect([...limited.persistence.store.pairingChallenges.values()].some((challenge) => challenge.consumedAt === null && challenge.revokedAt === null)).toBe(true);
    } finally {
      await limited.app.close();
    }
  });

  it('a successful pairing does not count as a refused attempt', async () => {
    const limited = await buildTestApp({ pairing: { invalidAttemptsMax: 1 } });
    try {
      const { token, session } = await signedInUser(limited.app);
      const workspaceId = session.workspaces[0]?.id ?? '';
      for (const displayName of ['um', 'dois', 'tres']) {
        const host = (await limited.app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts`, headers: bearer(token), payload: { displayName: `servidor-${displayName}` } })).json<HostResponse>();
        await expect(pairHost(limited.app, token, workspaceId, host.id)).resolves.toBeDefined();
      }
    } finally {
      await limited.app.close();
    }
  });
});

describe('AttemptWindow', () => {
  it('counts per key, expires by itself and never blocks for good', () => {
    let now = 0;
    const window = new AttemptWindow(2, 1000, 100, () => now);
    expect(window.isExhausted('a')).toBe(false);
    expect([window.record('a'), window.record('a')]).toEqual([1, 2]);
    expect(window.isExhausted('a')).toBe(true);
    expect(window.isExhausted('b')).toBe(false);
    now = 1000;
    expect(window.isExhausted('a')).toBe(false);
    expect(window.record('a')).toBe(1);
  });

  it('bounds memory by evicting the oldest key', () => {
    const window = new AttemptWindow(1, 1000, 2, () => 0);
    window.record('a');
    window.record('b');
    window.record('c');
    expect(window.isExhausted('a')).toBe(false);
    expect(window.isExhausted('b')).toBe(true);
    expect(window.isExhausted('c')).toBe(true);
  });
});

describe('machine authentication on ingestion', () => {
  it('accepts the paired machine and keeps the batch contract', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    const response = await ingest(t.base, host.id, bearer(token));
    expect(response.statusCode).toBe(200);
    expect(response.json<IngestEventsResponse>()).toEqual({ received: 1, inserted: 1, deduplicated: 0 });
    expect((await pairingOf(t, host.id)).activeCredential?.lastUsedAt).not.toBeNull();
    expect((await t.call('GET', `/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ connectionState: 'PAIRED', lastSeenAt: null });
  });

  it('a user JWT is not a machine credential, even for the OWNER', async () => {
    const t = await tenant();
    const host = await t.host();
    await t.pair(host.id);
    const before = store.events.size;
    const response = await ingest(t.base, host.id, bearer(t.token));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual(UNAUTHENTICATED);
    expect(store.events.size).toBe(before);
  });

  it('a machine token is not a user session on any route', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token, credentialId } = await t.pair(host.id);
    const headers = bearer(token);
    for (const [method, url] of [
      ['GET', '/users/me'],
      ['GET', `${t.base}/hosts`],
      ['GET', `${t.base}/hosts/${host.id}`],
      ['PUT', `${t.base}/hosts/${host.id}`],
      ['DELETE', `${t.base}/hosts/${host.id}`],
      ['GET', `${t.base}/events`],
      ['GET', `${t.base}/detection-rules`],
      ['POST', `${t.base}/detection-rules`],
      ['GET', `${t.base}/incidents`],
      ['POST', `${t.base}/incidents`],
      ['GET', `${t.base}/investigations`],
      ['POST', `${t.base}/investigations`],
      ['GET', `${t.base}/hosts/${host.id}/pairing`],
      ['POST', `${t.base}/hosts/${host.id}/pairing-codes`],
      ['POST', `${t.base}/hosts/${host.id}/credentials/${credentialId}/rotate`],
      ['DELETE', `${t.base}/hosts/${host.id}/credentials/${credentialId}`],
    ] as const) {
      const response = await app.inject({ method, url, headers, payload: method === 'POST' || method === 'PUT' ? {} : undefined });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toEqual(UNAUTHENTICATED);
    }
    expect((await pairingOf(t, host.id)).activeCredential?.id).toBe(credentialId);
  });

  it('cannot log in with a machine token', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'maquina@aegis.test', password: token } });
    expect(response.statusCode).toBe(401);
  });

  it('every invalid credential gets the same 401: missing, malformed, unknown, wrong secret, revoked', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token, credentialId } = await t.pair(host.id);
    const revokedHost = await t.host();
    const revoked = await t.pair(revokedHost.id);
    await t.call('DELETE', `/hosts/${revokedHost.id}/credentials/${revoked.credentialId}`);
    const hex = credentialId.replaceAll('-', '');
    const wrongSecret = token.endsWith('A') ? 'B' : 'A';

    const attempts: [string, string, Record<string, string>][] = [
      ['missing', host.id, {}],
      ['not bearer', host.id, { authorization: `Basic ${token}` }],
      ['malformed', host.id, bearer('nao-e-uma-credencial')],
      ['pairing-shaped', host.id, bearer(`aegis_pair_${'A'.repeat(43)}`)],
      ['oversized', host.id, bearer(`aegis_agent_${hex}.${'A'.repeat(4096)}`)],
      ['unknown id', host.id, bearer(formatMachineToken(randomUUID(), 'A'.repeat(43)))],
      ['wrong secret', host.id, bearer(`${token.slice(0, -1)}${wrongSecret}`)],
      ['revoked', revokedHost.id, bearer(revoked.token)],
    ];
    const before = store.events.size;
    for (const [name, hostId, headers] of attempts) {
      const response = await ingest(t.base, hostId, headers);
      expect(response.statusCode, name).toBe(401);
      expect(response.json(), name).toEqual(UNAUTHENTICATED);
    }
    expect(store.events.size).toBe(before);
  });

  it('a credential only works for its own host and workspace; the answer equals a missing host', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, otherHostA, hostB] = [await a.host(), await a.host(), await b.host()];
    const { token } = await a.pair(hostA.id);
    await b.pair(hostB.id);
    const headers = bearer(token);
    const before = store.events.size;
    for (const response of [
      await ingest(a.base, otherHostA.id, headers),
      await ingest(b.base, hostB.id, headers),
      await ingest(a.base, hostB.id, headers),
      await ingest(b.base, hostA.id, headers),
      await ingest(a.base, randomUUID(), headers),
      await ingest(`/workspaces/${randomUUID()}`, hostA.id, headers),
      await ingest(a.base, 'nao-e-uuid', headers),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
    expect(store.events.size).toBe(before);
  });

  it('403 when the credential lacks the scope', async () => {
    const workspaceId = randomUUID();
    const hostId = randomUUID();
    const scoped = await buildTestApp({
      overrides: { authenticateMachine: { execute: async () => new MachineAuthContext(randomUUID(), workspaceId, hostId, []) } as unknown as AuthenticateMachine },
    });
    try {
      const response = await scoped.app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts/${hostId}/events/ingest`, headers: bearer('qualquer'), payload: { events: [boot()] } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Esta credencial não permite esta ação.' } });
    } finally {
      await scoped.app.close();
    }
  });
});

describe('rotation and revocation', () => {
  it('rotation returns the new secret once, cuts the old one off and keeps events and rules', async () => {
    const t = await tenant();
    const host = await t.host();
    const first = await t.pair(host.id);
    await ingest(t.base, host.id, bearer(first.token));
    const eventsBefore = store.events.size;

    const response = await t.call('POST', `/hosts/${host.id}/credentials/${first.credentialId}/rotate`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const rotated = response.json<RotateCredentialResponse>();
    expect(rotated.token).toMatch(/^aegis_agent_/);
    expect(rotated.credential).toMatchObject({ status: 'ACTIVE', rotatedFromCredentialId: first.credentialId, scopes: ['events:ingest'], lastUsedAt: null, revokedAt: null });

    expect((await ingest(t.base, host.id, bearer(first.token))).statusCode).toBe(401);
    expect((await ingest(t.base, host.id, bearer(rotated.token))).statusCode).toBe(200);
    expect(store.events.size).toBe(eventsBefore + 1);
    expect((await t.call('GET', `/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ agentId: rotated.credential.id, connectionState: 'PAIRED' });
  });

  it('409 rotating a revoked credential', async () => {
    const t = await tenant();
    const host = await t.host();
    const { credentialId } = await t.pair(host.id);
    await t.call('DELETE', `/hosts/${host.id}/credentials/${credentialId}`);
    const response = await t.call('POST', `/hosts/${host.id}/credentials/${credentialId}/rotate`);
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error.code).toBe('INVALID_STATE');
  });

  it('revocation is idempotent (204), keeps the record, ends ingestion and allows a new pairing', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token, credentialId } = await t.pair(host.id);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await t.call('DELETE', `/hosts/${host.id}/credentials/${credentialId}`)).statusCode).toBe(204);
    }
    expect((await ingest(t.base, host.id, bearer(token))).statusCode).toBe(401);

    const pairing = await pairingOf(t, host.id);
    expect(pairing.activeCredential).toBeNull();
    expect(pairing.credentials).toEqual([expect.objectContaining({ id: credentialId, status: 'REVOKED' })]);
    expect((await t.call('GET', `/hosts/${host.id}`)).json<HostResponse>()).toMatchObject({ connectionState: 'UNPAIRED', agentId: null });

    const second = await t.pair(host.id);
    expect(second.credentialId).not.toBe(credentialId);
    expect((await ingest(t.base, host.id, bearer(second.token))).statusCode).toBe(200);
  });

  it('never confirms credentials of other hosts or workspaces', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, otherHostA, hostB] = [await a.host(), await a.host(), await b.host()];
    await a.pair(hostA.id);
    const credentialB = await b.pair(hostB.id);
    for (const response of [
      await a.call('DELETE', `/hosts/${hostA.id}/credentials/${credentialB.credentialId}`),
      await a.call('DELETE', `/hosts/${otherHostA.id}/credentials/${credentialB.credentialId}`),
      await a.call('DELETE', `/hosts/${hostB.id}/credentials/${credentialB.credentialId}`),
      await a.call('POST', `/hosts/${hostA.id}/credentials/${credentialB.credentialId}/rotate`),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
    expect((await ingest(b.base, hostB.id, bearer(credentialB.token))).statusCode).toBe(200);
  });

  it('a host with credential history cannot be deleted (409); an unused code does not block it', async () => {
    const t = await tenant();
    const [paired, withCode] = [await t.host(), await t.host()];
    const { credentialId } = await t.pair(paired.id);
    await t.call('DELETE', `/hosts/${paired.id}/credentials/${credentialId}`);
    const refused = await t.call('DELETE', `/hosts/${paired.id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ApiErrorResponse>().error.message).toMatch(/histórico das credenciais/);

    await requestPairingCode(app, t.token, t.workspaceId, withCode.id);
    expect((await t.call('DELETE', `/hosts/${withCode.id}`)).statusCode).toBe(204);
    expect([...store.pairingChallenges.values()].some((challenge) => challenge.hostId === withCode.id)).toBe(false);
  });
});

describe('secrets never leave their one response', () => {
  it('administrative reads expose metadata only', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token, credentialId } = await t.pair(host.id);
    const secret = token.split('.')[1] ?? '';
    const stored = store.machineCredentials.get(credentialId);
    const pairing = await pairingOf(t, host.id);
    const serialized = JSON.stringify([pairing, (await t.call('GET', `/hosts/${host.id}`)).json()]);

    expect(Object.keys(pairing.activeCredential ?? {}).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'revokedAt', 'rotatedFromCredentialId', 'scopes', 'status', 'tokenPrefix']);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(stored?.tokenHash ?? 'missing');
  });

  it('nothing sensitive reaches the logs during the whole lifecycle', async () => {
    logLines.length = 0;
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    const { token, credentialId } = (await redeemCode(app, code)).json<PairAgentResponse>();
    await ingest(t.base, host.id, bearer(token));
    await ingest(t.base, host.id, bearer(`${token.slice(0, -2)}xx`));
    await ingest(t.base, host.id, bearer(t.token));
    await redeemCode(app, code);
    await redeemCode(app, `aegis_pair_${'Q'.repeat(43)}`);
    const rotated = (await t.call('POST', `/hosts/${host.id}/credentials/${credentialId}/rotate`)).json<RotateCredentialResponse>();
    await t.call('DELETE', `/hosts/${host.id}/credentials/${rotated.credential.id}`);

    const hashes = [...store.machineCredentials.values(), ...store.pairingChallenges.values()].map((row) => ('tokenHash' in row ? row.tokenHash : row.codeHash));
    const output = logLines.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of [code, token, token.split('.')[1] ?? '', rotated.token, rotated.token.split('.')[1] ?? '', t.token, ...hashes, 'Q'.repeat(43)]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toMatch(/authorization/i);

    const audits = logLines.flatMap((line) => {
      const { audit, reason } = JSON.parse(line) as { audit?: string; reason?: string };
      return audit ? [reason ? `${audit}:${reason}` : audit] : [];
    });
    expect(audits).toEqual([
      'pairing.code_requested',
      'pairing.completed',
      'machine_auth.failed:BAD_SECRET',
      'machine_auth.failed:MALFORMED',
      'pairing.rejected:CONSUMED',
      'pairing.rejected:UNKNOWN_CODE',
      'credential.rotated',
      'credential.revoked',
    ]);
  });

  it('records an expired pairing attempt with internal ids only', async () => {
    logLines.length = 0;
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    expireChallenges();
    await redeemCode(app, code);
    const line = logLines.map((raw) => JSON.parse(raw) as Record<string, unknown>).find((entry) => entry['audit'] === 'pairing.rejected');
    expect(line).toMatchObject({ reason: 'EXPIRED', hostId: host.id, workspaceId: t.workspaceId, invalidAttemptsInWindow: expect.any(Number) });
    expect(typeof line?.['time']).toBe('number');
  });
});
