import { describe, expect, it } from 'vitest';
import { HOST_CONNECTION_STATES, HOST_PRESENCE_POLICY, MACHINE_SCOPES, DEFAULT_MACHINE_SCOPES, hostConnectionStateOf } from '../src/index.js';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('host presence policy', () => {
  it('heartbeats every 30 s and stays ONLINE for three intervals', () => {
    expect(HOST_PRESENCE_POLICY).toEqual({ heartbeatIntervalMs: 30_000, onlineWindowMs: 90_000 });
    expect(HOST_PRESENCE_POLICY.onlineWindowMs).toBe(3 * HOST_PRESENCE_POLICY.heartbeatIntervalMs);
    expect(HOST_CONNECTION_STATES).toEqual(['UNPAIRED', 'PAIRED', 'ONLINE', 'OFFLINE']);
  });

  it('separates pairing from connectivity', () => {
    expect(hostConnectionStateOf({ paired: false, lastSeenAt: null }, NOW)).toBe('UNPAIRED');
    // A revoked host keeps its history, but without an active credential it is not ONLINE.
    expect(hostConnectionStateOf({ paired: false, lastSeenAt: ago(1_000) }, NOW)).toBe('UNPAIRED');
    expect(hostConnectionStateOf({ paired: true, lastSeenAt: null }, NOW)).toBe('PAIRED');
  });

  it('is ONLINE strictly inside the window and OFFLINE from its end', () => {
    expect(hostConnectionStateOf({ paired: true, lastSeenAt: NOW }, NOW)).toBe('ONLINE');
    expect(hostConnectionStateOf({ paired: true, lastSeenAt: ago(HOST_PRESENCE_POLICY.onlineWindowMs - 1) }, NOW)).toBe('ONLINE');
    expect(hostConnectionStateOf({ paired: true, lastSeenAt: ago(HOST_PRESENCE_POLICY.onlineWindowMs) }, NOW)).toBe('OFFLINE');
    expect(hostConnectionStateOf({ paired: true, lastSeenAt: ago(86_400_000) }, NOW)).toBe('OFFLINE');
  });

  it('heartbeat is an explicit scope granted with new credentials', () => {
    expect(MACHINE_SCOPES).toContain('host:heartbeat');
    expect(DEFAULT_MACHINE_SCOPES).toEqual(['events:ingest', 'host:heartbeat']);
  });
});
