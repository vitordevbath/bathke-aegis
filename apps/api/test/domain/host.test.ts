import { describe, expect, it } from 'vitest';
import { InvalidStateError, ValidationError } from '@aegis/domain';
import { Host } from '../../src/domain/host.js';

const WORKSPACE = '0b6c2f1e-0000-4000-8000-0000000000aa';

describe('Host', () => {
  it('registers unpaired, without telemetry, in the given workspace', () => {
    const now = new Date('2026-02-01T10:00:00Z');
    const host = Host.register({ workspaceId: WORKSPACE, displayName: '  Servidor   principal ', description: ' Homologação ' }, now);

    expect(host.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(host.toSnapshot()).toEqual({
      id: host.id,
      workspaceId: WORKSPACE,
      displayName: 'Servidor principal',
      description: 'Homologação',
      agentId: null,
      hostname: null,
      osName: null,
      osVersion: null,
      architecture: null,
      connectionState: 'UNPAIRED',
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(host.isPaired).toBe(false);
  });

  it('stores an empty description as null', () => {
    expect(Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor', description: '   ' }).description).toBeNull();
    expect(Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor' }).description).toBeNull();
  });

  it.each(['', '   ', 'A', 'x'.repeat(121)])('cannot be born with display name %j', (displayName) => {
    expect(() => Host.register({ workspaceId: WORKSPACE, displayName })).toThrow(ValidationError);
  });

  it('rejects a description above 500 characters', () => {
    expect(() => Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor', description: 'x'.repeat(501) })).toThrow(ValidationError);
  });

  it('updates only the administrative fields', () => {
    const host = Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor', description: 'Antiga' });
    const later = new Date(host.updatedAt.getTime() + 1000);
    host.updateDetails({ displayName: 'Servidor de banco' }, later);

    expect(host.displayName).toBe('Servidor de banco');
    expect(host.description).toBeNull();
    expect(host.updatedAt).toEqual(later);
    expect(host.connectionStateAt(later)).toBe('UNPAIRED');
    expect(host.workspaceId).toBe(WORKSPACE);
  });

  it('exposes no setters for workspace or collector-controlled fields', () => {
    for (const field of ['workspaceId', 'lastSeenAt', 'isPaired', 'displayName', 'description']) {
      expect(Object.getOwnPropertyDescriptor(Host.prototype, field)?.set).toBeUndefined();
    }
    // Only the identity is a public own property; everything else is runtime-private.
    expect(Object.keys(Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor' }))).toEqual(['id']);
  });

  it('round-trips persisted collector facts untouched', () => {
    const snapshot = {
      ...Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor' }).toSnapshot(),
      agentId: 'agent-1',
      hostname: 'srv-01',
      connectionState: 'OFFLINE' as const,
    };
    const restored = Host.restore(snapshot);
    expect(restored.toSnapshot()).toEqual(snapshot);
    expect(restored.isPaired).toBe(true);
  });
});

describe('Host heartbeat', () => {
  const paired = () => {
    const host = Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor' }, new Date('2026-11-15T10:00:00.000Z'));
    host.markPaired('c1', new Date('2026-11-15T10:00:01.000Z'));
    return host;
  };

  it('records the last contact without touching updatedAt, and derives ONLINE/OFFLINE from it', () => {
    const host = paired();
    const updatedAt = host.updatedAt;
    const seen = new Date('2026-11-15T10:05:00.000Z');
    expect(host.connectionStateAt(seen)).toBe('PAIRED');
    host.recordHeartbeat(seen);
    expect(host.lastSeenAt).toEqual(seen);
    expect(host.updatedAt).toEqual(updatedAt);
    expect(host.toSnapshot().connectionState).toBe('PAIRED');
    expect(host.connectionStateAt(new Date(seen.getTime() + 89_999))).toBe('ONLINE');
    expect(host.connectionStateAt(new Date(seen.getTime() + 90_000))).toBe('OFFLINE');
  });

  it('never moves the last contact backwards', () => {
    const host = paired();
    const later = new Date('2026-11-15T10:05:00.000Z');
    host.recordHeartbeat(later);
    host.recordHeartbeat(new Date('2026-11-15T10:04:00.000Z'));
    expect(host.lastSeenAt).toEqual(later);
  });

  it('refuses a heartbeat for a host without an active credential', () => {
    const host = Host.register({ workspaceId: WORKSPACE, displayName: 'Servidor' });
    expect(() => host.recordHeartbeat(new Date())).toThrow(InvalidStateError);
    const unpaired = paired();
    unpaired.markUnpaired();
    expect(() => unpaired.recordHeartbeat(new Date())).toThrow(InvalidStateError);
  });
});
