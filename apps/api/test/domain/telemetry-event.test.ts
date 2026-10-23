import { describe, expect, it } from 'vitest';
import { ValidationError, validateEvent, type NormalizedEventV1 } from '@aegis/domain';
import { TelemetryEvent, fingerprintOf } from '../../src/domain/telemetry-event.js';

const ORIGIN = { workspaceId: '0b6c2f1e-0000-4000-8000-0000000000aa', hostId: '0b6c2f1e-0000-4000-8000-000000000001' };
const NOW = new Date('2026-05-01T12:00:00.000Z');

function event(overrides: Record<string, unknown> = {}, process: Record<string, unknown> = {}): NormalizedEventV1 {
  const result = validateEvent(
    {
      schemaVersion: 1,
      sourceEventId: '3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f',
      occurredAt: '2026-05-01T11:59:00Z',
      category: 'PROCESS',
      type: 'PROCESS_STARTED',
      data: { process: { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user: 'www-data', ...process } },
      ...overrides,
    },
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.event;
}

describe('TelemetryEvent', () => {
  it('receives a validated event for a host, with server id and ingestion time', () => {
    const received = TelemetryEvent.receive(ORIGIN, event(), NOW);
    expect(received.toSnapshot()).toMatchObject({
      ...ORIGIN,
      sourceEventId: '3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f',
      schemaVersion: 1,
      category: 'PROCESS',
      type: 'PROCESS_STARTED',
      occurredAt: new Date('2026-05-01T11:59:00.000Z'),
      ingestedAt: NOW,
    });
    expect(received.id).not.toBe(received.sourceEventId);
    expect(received.summary).toBe('bash (pid 4242)');
  });

  it('is immutable: no mutators, and returned dates are copies', () => {
    const received = TelemetryEvent.receive(ORIGIN, event(), NOW);
    const methods = Object.getOwnPropertyNames(TelemetryEvent.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['event', 'fingerprint', 'hostId', 'ingestedAt', 'occurredAt', 'sourceEventId', 'summary', 'toSnapshot', 'workspaceId'].sort());
    for (const name of methods.filter((candidate) => candidate !== 'toSnapshot')) {
      expect(Object.getOwnPropertyDescriptor(TelemetryEvent.prototype, name)?.set).toBeUndefined();
    }
    received.occurredAt.setFullYear(1999);
    received.ingestedAt.setFullYear(1999);
    expect(received.toSnapshot()).toMatchObject({ occurredAt: new Date('2026-05-01T11:59:00.000Z'), ingestedAt: NOW });
  });

  describe('fingerprint', () => {
    it('is deterministic for the same content, whatever the host, id or ingestion time', () => {
      expect(fingerprintOf(event())).toBe(fingerprintOf(event()));
      expect(fingerprintOf(event())).toMatch(/^[0-9a-f]{64}$/);
      const a = TelemetryEvent.receive(ORIGIN, event(), NOW);
      const b = TelemetryEvent.receive({ ...ORIGIN, hostId: '0b6c2f1e-0000-4000-8000-000000000002' }, event(), new Date());
      expect(a.fingerprint).toBe(b.fingerprint);
    });

    it('ignores representation differences that normalization removes', () => {
      const offset = event({ occurredAt: '2026-05-01T08:59:00-03:00', sourceEventId: '3F0C8A4E-6B1D-4C2A-9E5F-1A2B3C4D5E6F' });
      expect(fingerprintOf(offset)).toBe(fingerprintOf(event()));
    });

    it.each([
      ['occurredAt', event({ occurredAt: '2026-05-01T11:59:01Z' })],
      ['type', event({ type: 'PROCESS_EXITED' })],
      ['a data field', event({}, { user: 'root' })],
      ['a null vs value', event({}, { parentName: null })],
      ['sourceEventId', event({ sourceEventId: '3f0c8a4e-6b1d-4c2a-9e5f-000000000000' })],
    ])('changes when %s changes', (_case, changed) => {
      expect(fingerprintOf(changed)).not.toBe(fingerprintOf(event()));
    });
  });

  describe('restore', () => {
    it('round-trips a snapshot, even if storage reorders JSON keys', () => {
      const snapshot = TelemetryEvent.receive(ORIGIN, event(), NOW).toSnapshot();
      if (!('process' in snapshot.data)) throw new Error('expected a process event');
      const reordered = { process: Object.fromEntries(Object.entries(snapshot.data.process).reverse()) };
      const restored = TelemetryEvent.restore({ ...snapshot, data: reordered as never });
      expect(restored.toSnapshot()).toEqual(snapshot);
    });

    it('refuses rows that are invalid or do not match their fingerprint', () => {
      const snapshot = TelemetryEvent.receive(ORIGIN, event(), NOW).toSnapshot();
      expect(() => TelemetryEvent.restore({ ...snapshot, fingerprint: 'f'.repeat(64) })).toThrow(ValidationError);
      expect(() => TelemetryEvent.restore({ ...snapshot, data: { process: { pid: 'x' } } as never })).toThrow(ValidationError);
      expect(() => TelemetryEvent.restore({ ...snapshot, type: 'NETWORK_LISTEN' })).toThrow(ValidationError);
    });
  });
});
