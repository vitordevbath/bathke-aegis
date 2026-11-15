import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HOST_PRESENCE_POLICY } from '@aegis/domain';
import type { HeartbeatResponse, HostPairingResponse, HostResponse } from '@aegis/contracts';
import { bearer, buildTestApp, pairHost, redeemCode, requestPairingCode, signedInUser } from '../support/test-app.js';
import type { InMemoryStore } from '../support/in-memory-persistence.js';
import { Membership } from '../../src/domain/membership.js';

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

async function tenant() {
  const { token, session } = await signedInUser(app);
  const workspaceId = session.workspaces[0]?.id ?? '';
  const base = `/workspaces/${workspaceId}`;
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, headers: bearer(token), payload });
  const host = async () => (await call('POST', '/hosts', { displayName: `host-${Math.random().toString(36).slice(2, 8)}` })).json<HostResponse>();
  const pair = (hostId: string) => pairHost(app, token, workspaceId, hostId);
  const hostView = async (hostId: string) => (await call('GET', `/hosts/${hostId}`)).json<HostResponse>();
  const pairing = async (hostId: string) => (await call('GET', `/hosts/${hostId}/pairing`)).json<HostPairingResponse>();
  return { token, userId: session.user.id, workspaceId, base, call, host, pair, hostView, pairing };
}

const heartbeat = (base: string, hostId: string, machineToken: string, payload: object | undefined = {}) =>
  app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/heartbeat`, headers: bearer(machineToken), payload });

const setLastSeen = (hostId: string, at: Date) => {
  const current = store.hosts.get(hostId);
  if (current) store.hosts.set(hostId, { ...current, lastSeenAt: at });
};

describe('POST …/hosts/:hostId/heartbeat', () => {
  it('records the server time as last contact and answers small and predictable', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    expect((await t.hostView(host.id)).connectionState).toBe('PAIRED');

    const before = Date.now();
    const response = await heartbeat(t.base, host.id, token);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<HeartbeatResponse>();
    expect(Object.keys(body).sort()).toEqual(['heartbeatIntervalSeconds', 'lastSeenAt']);
    expect(body.heartbeatIntervalSeconds).toBe(HOST_PRESENCE_POLICY.heartbeatIntervalMs / 1000);
    expect(new Date(body.lastSeenAt).getTime()).toBeGreaterThanOrEqual(before);

    const view = await t.hostView(host.id);
    expect(view).toMatchObject({ connectionState: 'ONLINE', lastSeenAt: body.lastSeenAt });
    // Not an administrative change, and nothing artificial was created.
    expect(view.updatedAt).not.toBe(body.lastSeenAt);
    expect([...store.events.values()].filter((event) => event.hostId === host.id)).toHaveLength(0);
  });

  it('uses only the server clock: a body is refused, including a client time or another host', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    for (const payload of [{ lastSeenAt: '2030-01-01T00:00:00Z' }, { hostId: randomUUID() }, { displayName: 'x' }]) {
      const response = await heartbeat(t.base, host.id, token, payload);
      expect(response.statusCode).toBe(400);
    }
    expect((await t.hostView(host.id)).lastSeenAt).toBeNull();
    expect((await heartbeat(t.base, host.id, token, undefined)).statusCode).toBe(200);
  });

  it('a credential only touches its own host: other hosts and workspaces answer like missing ones', async () => {
    const a = await tenant();
    const b = await tenant();
    const hostA = await a.host();
    const otherA = await a.host();
    const hostB = await b.host();
    const { token } = await a.pair(hostA.id);
    for (const [base, hostId] of [
      [a.base, otherA.id],
      [b.base, hostB.id],
      [b.base, hostA.id],
      [a.base, randomUUID()],
    ] as const) {
      const response = await heartbeat(base, hostId, token);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
    expect((await a.hostView(otherA.id)).lastSeenAt).toBeNull();
    expect((await b.hostView(hostB.id)).lastSeenAt).toBeNull();
    expect((await a.hostView(hostA.id)).lastSeenAt).toBeNull();
  });

  it('refuses user sessions, revoked and rotated-away credentials with the generic 401', async () => {
    const t = await tenant();
    const host = await t.host();
    const first = await t.pair(host.id);
    expect((await heartbeat(t.base, host.id, t.token)).json()).toEqual(UNAUTHENTICATED);
    expect((await app.inject({ method: 'POST', url: `${t.base}/hosts/${host.id}/heartbeat`, payload: {} })).statusCode).toBe(401);

    const rotated = (await t.call('POST', `/hosts/${host.id}/credentials/${first.credentialId}/rotate`)).json<{ token: string; credential: { id: string } }>();
    expect((await heartbeat(t.base, host.id, first.token)).statusCode).toBe(401);
    expect((await heartbeat(t.base, host.id, rotated.token)).statusCode).toBe(200);

    expect((await t.call('DELETE', `/hosts/${host.id}/credentials/${rotated.credential.id}`)).statusCode).toBe(204);
    const seenBeforeRevocation = (await t.hostView(host.id)).lastSeenAt;
    const refused = await heartbeat(t.base, host.id, rotated.token);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual(UNAUTHENTICATED);
    expect((await t.hostView(host.id))).toMatchObject({ connectionState: 'UNPAIRED', lastSeenAt: seenBeforeRevocation });
  });

  it('403 for a credential issued before host:heartbeat existed; rotating grants it explicitly', async () => {
    const t = await tenant();
    const host = await t.host();
    const legacy = await t.pair(host.id);
    // A BF 07 credential: stored with the scope set it was issued with.
    const stored = store.machineCredentials.get(legacy.credentialId);
    if (stored) store.machineCredentials.set(legacy.credentialId, { ...stored, scopes: ['events:ingest'] });
    expect((await t.pairing(host.id)).activeCredential?.scopes).toEqual(['events:ingest']);

    const refused = await heartbeat(t.base, host.id, legacy.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Esta credencial não permite esta ação.' } });
    expect((await t.hostView(host.id)).lastSeenAt).toBeNull();

    const rotated = (await t.call('POST', `/hosts/${host.id}/credentials/${legacy.credentialId}/rotate`)).json<{ token: string; credential: { scopes: string[] } }>();
    expect(rotated.credential.scopes).toEqual(['events:ingest', 'host:heartbeat']);
    expect((await heartbeat(t.base, host.id, rotated.token)).statusCode).toBe(200);
  });

  it('derives ONLINE / OFFLINE from the last heartbeat and never stores them', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    await heartbeat(t.base, host.id, token);
    expect((await t.hostView(host.id)).connectionState).toBe('ONLINE');

    setLastSeen(host.id, new Date(Date.now() - HOST_PRESENCE_POLICY.onlineWindowMs + 5_000));
    expect((await t.hostView(host.id)).connectionState).toBe('ONLINE');
    setLastSeen(host.id, new Date(Date.now() - HOST_PRESENCE_POLICY.onlineWindowMs - 1_000));
    const offline = await t.hostView(host.id);
    expect(offline.connectionState).toBe('OFFLINE');
    const listed = (await t.call('GET', '/hosts')).json<{ items: HostResponse[] }>().items.find((item) => item.id === host.id);
    expect(listed?.connectionState).toBe('OFFLINE');
    expect(store.hosts.get(host.id)?.connectionState).toBe('PAIRED');

    // A heartbeat brings it back; the last contact never moves backwards.
    await heartbeat(t.base, host.id, token);
    expect((await t.hostView(host.id)).connectionState).toBe('ONLINE');
  });

  it('applies its own per-IP limit', async () => {
    const limited = await buildTestApp({ heartbeatRateLimitMax: 2 });
    try {
      const { token, session } = await signedInUser(limited.app);
      const workspaceId = session.workspaces[0]?.id ?? '';
      const host = (await limited.app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts`, headers: bearer(token), payload: { displayName: 'servidor' } })).json<HostResponse>();
      const machine = await pairHost(limited.app, token, workspaceId, host.id);
      const send = () => limited.app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts/${host.id}/heartbeat`, headers: bearer(machine.token), payload: {} });
      expect([(await send()).statusCode, (await send()).statusCode, (await send()).statusCode]).toEqual([200, 200, 429]);
    } finally {
      await limited.app.close();
    }
  });

  it('never logs the credential or the Authorization header', async () => {
    const t = await tenant();
    const host = await t.host();
    const { token } = await t.pair(host.id);
    const secret = token.split('.')[1] ?? '';
    await heartbeat(t.base, host.id, token);
    const log = logLines.join('');
    expect(log).not.toContain(secret);
    expect(log.toLowerCase()).not.toContain('bearer ');
  });
});

describe('DELETE …/hosts/:hostId/pairing-codes/:challengeId', () => {
  it('cancels the pending code (OWNER), idempotently; the cancelled code no longer pairs', async () => {
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    const pending = (await t.pairing(host.id)).pendingCode;
    expect(pending).not.toBeNull();

    const url = `/hosts/${host.id}/pairing-codes/${pending?.id}`;
    expect((await t.call('DELETE', url)).statusCode).toBe(204);
    expect((await t.pairing(host.id)).pendingCode).toBeNull();
    expect((await t.call('DELETE', url)).statusCode).toBe(204);
    expect((await redeemCode(app, code)).statusCode).toBe(401);
    expect((await t.hostView(host.id)).connectionState).toBe('UNPAIRED');
    expect(logLines.join('')).toContain('pairing.code_cancelled');
    // A new code can be requested right away.
    expect((await t.call('POST', `/hosts/${host.id}/pairing-codes`)).statusCode).toBe(201);
  });

  it('a code already used stays used, and the credential it produced keeps working', async () => {
    const t = await tenant();
    const host = await t.host();
    const { code } = await requestPairingCode(app, t.token, t.workspaceId, host.id);
    const challengeId = (await t.pairing(host.id)).pendingCode?.id ?? '';
    const paired = (await redeemCode(app, code)).json<{ token: string; credentialId: string }>();

    expect((await t.call('DELETE', `/hosts/${host.id}/pairing-codes/${challengeId}`)).statusCode).toBe(204);
    const pairing = await t.pairing(host.id);
    expect(pairing.activeCredential?.id).toBe(paired.credentialId);
    expect(store.pairingChallenges.get(challengeId)).toMatchObject({ revokedAt: null });
    expect((await heartbeat(t.base, host.id, paired.token)).statusCode).toBe(200);
  });

  it('403 for members without permission; 404 for other tenants, other hosts, unknown and malformed ids', async () => {
    const a = await tenant();
    const b = await tenant();
    const host = await a.host();
    const otherHost = await a.host();
    await requestPairingCode(app, a.token, a.workspaceId, host.id);
    const challengeId = (await a.pairing(host.id)).pendingCode?.id ?? '';

    for (const [call, url] of [
      [b.call, `/hosts/${host.id}/pairing-codes/${challengeId}`],
      [a.call, `/hosts/${otherHost.id}/pairing-codes/${challengeId}`],
      [a.call, `/hosts/${host.id}/pairing-codes/${randomUUID()}`],
      [a.call, `/hosts/${host.id}/pairing-codes/nao-e-uuid`],
    ] as const) {
      const response = await call('DELETE', url);
      expect(response.statusCode, url).toBe(404);
    }
    const foreign = await app.inject({ method: 'DELETE', url: `${b.base}/hosts/${host.id}/pairing-codes/${challengeId}`, headers: bearer(b.token) });
    expect(foreign.json()).toEqual(NOT_FOUND);
    expect((await a.pairing(host.id)).pendingCode?.id).toBe(challengeId);

    // b becomes a VIEWER of a's workspace: a member, but not one who manages resources.
    store.memberships.set(`${b.userId}:${a.workspaceId}`, Membership.restore({ userId: b.userId, workspaceId: a.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot());
    const forbidden = await app.inject({ method: 'DELETE', url: `${a.base}/hosts/${host.id}/pairing-codes/${challengeId}`, headers: bearer(b.token) });
    expect(forbidden.statusCode).toBe(403);
    expect((await a.pairing(host.id)).pendingCode?.id).toBe(challengeId);
  });
});
