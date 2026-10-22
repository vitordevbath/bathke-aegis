import { describe, expect, it } from 'vitest';
import {
  DETECTION_FIELDS,
  DETECTION_OPERATORS_BY_TYPE,
  EVENT_CATEGORIES,
  EVENT_DEFINITIONS,
  EVENT_FIELDS,
  EVENT_TYPES,
  EVENT_TYPES_BY_CATEGORY,
  EventIdConflictError,
  DomainError,
  summarizeEvent,
  validateEvent,
  type EventType,
} from '../src/index.js';

const NOW = new Date('2026-05-01T12:00:00.000Z');
const SOURCE_ID = '3f0c8a4e-6b1d-4c2a-9e5f-1a2b3c4d5e6f';

const process = { pid: 4242, parentPid: 1000, name: 'bash', executable: '/usr/bin/bash', parentName: 'nginx', user: 'www-data' };

/** One valid raw event per v1 type. */
const VALID: Record<EventType, Record<string, unknown>> = {
  PROCESS_STARTED: { category: 'PROCESS', type: 'PROCESS_STARTED', data: { process } },
  PROCESS_EXITED: { category: 'PROCESS', type: 'PROCESS_EXITED', data: { process: { pid: 4242, name: 'bash', executable: '/usr/bin/bash' } } },
  NETWORK_CONNECTION: {
    category: 'NETWORK',
    type: 'NETWORK_CONNECTION',
    data: { network: { protocol: 'TCP', localAddress: '10.0.0.5', localPort: 51234, remoteAddress: '203.0.113.10', remotePort: 443, pid: 4242, processName: 'curl' } },
  },
  NETWORK_LISTEN: { category: 'NETWORK', type: 'NETWORK_LISTEN', data: { network: { protocol: 'TCP', localAddress: '::', localPort: 8080 } } },
  SYSTEM_BOOT: { category: 'SYSTEM', type: 'SYSTEM_BOOT', data: { system: { eventType: 'BOOT' } } },
  SYSTEM_SERVICE_STATE_CHANGED: {
    category: 'SYSTEM',
    type: 'SYSTEM_SERVICE_STATE_CHANGED',
    data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'RUNNING' } },
  },
};

const raw = (type: EventType, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sourceEventId: SOURCE_ID,
  occurredAt: '2026-05-01T11:59:00Z',
  ...VALID[type],
  ...overrides,
});

const fieldsOf = (input: unknown, now: Date | undefined = NOW) => {
  const result = validateEvent(input, now);
  return result.ok ? [] : result.issues.map((issue) => issue.field);
};

describe('Event Contract v1 — registry', () => {
  it('assigns every type to exactly one category and lists them per category', () => {
    for (const type of EVENT_TYPES) expect(EVENT_CATEGORIES).toContain(EVENT_DEFINITIONS[type].category);
    expect(EVENT_TYPES_BY_CATEGORY).toEqual({
      PROCESS: ['PROCESS_STARTED', 'PROCESS_EXITED'],
      NETWORK: ['NETWORK_CONNECTION', 'NETWORK_LISTEN'],
      SYSTEM: ['SYSTEM_BOOT', 'SYSTEM_SERVICE_STATE_CHANGED'],
    });
  });

  it('declares a presence rule only for fields of the category', () => {
    for (const type of EVENT_TYPES) {
      const definition = EVENT_DEFINITIONS[type];
      const namespace = definition.category.toLowerCase();
      for (const key of Object.keys(definition.fields)) expect(EVENT_FIELDS.some((spec) => spec.id === `${namespace}.${key}`)).toBe(true);
    }
  });

  it('carries no command line, arguments, environment or content fields', () => {
    const ids = EVENT_FIELDS.map((spec) => spec.id.toLowerCase());
    for (const forbidden of ['commandline', 'cmdline', 'argv', 'args', 'env', 'environment', 'payload', 'content', 'password', 'token']) {
      expect(ids.some((id) => id.split('.')[1] === forbidden)).toBe(false);
    }
  });
});

describe('Event Contract v1 — validation', () => {
  it.each(EVENT_TYPES)('accepts a valid %s and normalizes it', (type) => {
    const result = validateEvent(raw(type), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({ schemaVersion: 1, sourceEventId: SOURCE_ID, occurredAt: '2026-05-01T11:59:00.000Z', type, category: EVENT_DEFINITIONS[type].category });
  });

  it('fills missing optional fields with null, in the catalog order, and lower-cases the source id', () => {
    const result = validateEvent(raw('PROCESS_EXITED', { sourceEventId: SOURCE_ID.toUpperCase() }), NOW);
    if (!result.ok) throw new Error('expected valid');
    expect(result.event.sourceEventId).toBe(SOURCE_ID);
    expect(JSON.stringify(result.event.data)).toBe(
      JSON.stringify({ process: { pid: 4242, parentPid: null, name: 'bash', executable: '/usr/bin/bash', parentName: null, user: null } }),
    );
  });

  it('normalizes offsets to UTC with milliseconds', () => {
    const result = validateEvent(raw('SYSTEM_BOOT', { occurredAt: '2026-05-01T08:30:00.123456-03:00' }), NOW);
    expect(result.ok && result.event.occurredAt).toBe('2026-05-01T11:30:00.123Z');
  });

  it('rejects unknown properties at every level instead of dropping them', () => {
    expect(fieldsOf({ ...raw('PROCESS_STARTED'), password: 'x' })).toEqual(['password']);
    expect(fieldsOf(raw('PROCESS_STARTED', { data: { process, extra: {} } }))).toEqual(['data.extra']);
    expect(fieldsOf(raw('PROCESS_STARTED', { data: { process: { ...process, commandLine: 'curl -H "Authorization: x"' } } }))).toEqual([
      'data.process.commandLine',
    ]);
    expect(fieldsOf(raw('PROCESS_STARTED', { data: { process: { ...process, environment: { HOME: '/root' } } } }))).toEqual(['data.process.environment']);
  });

  it.each([
    ['schemaVersion 2', { schemaVersion: 2 }, 'schemaVersion'],
    ['schemaVersion as text', { schemaVersion: '1' }, 'schemaVersion'],
    ['non-UUID source id', { sourceEventId: 'evento-1' }, 'sourceEventId'],
    ['timestamp without offset', { occurredAt: '2026-05-01T11:59:00' }, 'occurredAt'],
    ['impossible date', { occurredAt: '2026-02-30T10:00:00Z' }, 'occurredAt'],
    ['date only', { occurredAt: '2026-05-01' }, 'occurredAt'],
    ['far in the future', { occurredAt: '2026-05-01T12:06:00Z' }, 'occurredAt'],
    ['unknown category', { category: 'FILE' }, 'category'],
    ['type of another category', { category: 'NETWORK' }, 'type'],
  ])('rejects %s', (_case, overrides, field) => {
    expect(fieldsOf(raw('PROCESS_STARTED', overrides))).toEqual([field]);
  });

  it('accepts clock skew up to 5 minutes and old events from offline queues', () => {
    expect(fieldsOf(raw('SYSTEM_BOOT', { occurredAt: '2026-05-01T12:04:59Z' }))).toEqual([]);
    expect(fieldsOf(raw('SYSTEM_BOOT', { occurredAt: '2019-01-01T00:00:00Z' }))).toEqual([]);
    // Re-reading storage skips the clock check.
    expect(validateEvent(raw('SYSTEM_BOOT', { occurredAt: '2030-01-01T00:00:00Z' })).ok).toBe(true);
  });

  it('rejects an unknown type without guessing a definition', () => {
    expect(fieldsOf(raw('PROCESS_STARTED', { type: 'FILE_WRITTEN' }))).toEqual(['type']);
  });

  it.each([
    ['pid 0', { ...process, pid: 0 }, 'data.process.pid'],
    ['fractional pid', { ...process, pid: 1.5 }, 'data.process.pid'],
    ['pid as text', { ...process, pid: '4242' }, 'data.process.pid'],
    ['negative parentPid', { ...process, parentPid: -1 }, 'data.process.parentPid'],
    ['empty name', { ...process, name: '' }, 'data.process.name'],
    ['name over 255', { ...process, name: 'x'.repeat(256) }, 'data.process.name'],
    ['executable over 4096', { ...process, executable: `/${'x'.repeat(4096)}` }, 'data.process.executable'],
    ['control characters', { ...process, user: 'root\nadmin' }, 'data.process.user'],
    ['missing executable', { pid: 1, name: 'init' }, 'data.process.executable'],
  ])('rejects process %s', (_case, body, field) => {
    expect(fieldsOf(raw('PROCESS_STARTED', { data: { process: body } }))).toEqual([field]);
  });

  it('validates network metadata and per-type presence', () => {
    const network = (VALID.NETWORK_CONNECTION['data'] as { network: Record<string, unknown> }).network;
    const connection = (changes: Record<string, unknown>) => raw('NETWORK_CONNECTION', { data: { network: { ...network, ...changes } } });
    expect(fieldsOf(connection({ protocol: 'ICMP' }))).toEqual(['data.network.protocol']);
    expect(fieldsOf(connection({ remoteAddress: '999.1.1.1' }))).toEqual(['data.network.remoteAddress']);
    expect(fieldsOf(connection({ remoteAddress: 'exemplo.com' }))).toEqual(['data.network.remoteAddress']);
    expect(fieldsOf(connection({ remoteAddress: '2001:db8::1' }))).toEqual([]);
    expect(fieldsOf(connection({ remotePort: 70000 }))).toEqual(['data.network.remotePort']);
    expect(fieldsOf(connection({ remoteAddress: null }))).toEqual(['data.network.remoteAddress']);
    // A listening socket has no remote end: values are refused, never invented.
    expect(fieldsOf(raw('NETWORK_LISTEN', { data: { network: { protocol: 'UDP', localPort: 53, remoteAddress: '203.0.113.10' } } }))).toEqual([
      'data.network.remoteAddress',
    ]);
  });

  it('fixes system.eventType per type and keeps SYSTEM free of arbitrary JSON', () => {
    expect(fieldsOf(raw('SYSTEM_BOOT', { data: { system: { eventType: 'SERVICE_STATE_CHANGED' } } }))).toEqual(['data.system.eventType']);
    expect(fieldsOf(raw('SYSTEM_BOOT', { data: { system: { eventType: 'BOOT', serviceName: 'nginx' } } }))).toEqual(['data.system.serviceName']);
    expect(fieldsOf(raw('SYSTEM_SERVICE_STATE_CHANGED', { data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'running' } } }))).toEqual([
      'data.system.state',
    ]);
    expect(fieldsOf(raw('SYSTEM_SERVICE_STATE_CHANGED', { data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName: 'nginx', state: 'RUNNING', unit: {} } } }))).toEqual([
      'data.system.unit',
    ]);
  });

  it('rejects non-object input', () => {
    for (const input of [null, 'evento', [], 42]) expect(validateEvent(input, NOW).ok).toBe(false);
  });
});

describe('Event Contract v1 — summaries', () => {
  it.each<[EventType, string]>([
    ['PROCESS_STARTED', 'bash (pid 4242)'],
    ['NETWORK_CONNECTION', 'TCP 10.0.0.5:51234 → 203.0.113.10:443'],
    ['NETWORK_LISTEN', 'TCP [::]:8080 LISTEN'],
    ['SYSTEM_BOOT', 'BOOT'],
    ['SYSTEM_SERVICE_STATE_CHANGED', 'nginx → RUNNING'],
  ])('summarizes %s', (type, summary) => {
    const result = validateEvent(raw(type), NOW);
    if (!result.ok) throw new Error('expected valid');
    expect(summarizeEvent(result.event)).toBe(summary);
  });
});

describe('detection rule fields come from the event catalog (no drift)', () => {
  it('keeps exactly the fields existing rules already use, with the same types and bounds', () => {
    // Compared by id: stored conditions reference fields by id, so only the picker order may change.
    const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    const sorted = Object.fromEntries(EVENT_CATEGORIES.map((category) => [category, byId(DETECTION_FIELDS[category])]));
    const expected = {
      PROCESS: [
        { id: 'process.name', type: 'string' },
        { id: 'process.executable', type: 'string' },
        { id: 'process.parentName', type: 'string' },
        { id: 'process.user', type: 'string' },
      ],
      NETWORK: [
        { id: 'network.protocol', type: 'string' },
        { id: 'network.localPort', type: 'integer', min: 0, max: 65_535 },
        { id: 'network.remotePort', type: 'integer', min: 0, max: 65_535 },
        { id: 'network.remoteAddress', type: 'string' },
        { id: 'network.processName', type: 'string' },
      ],
      SYSTEM: [
        { id: 'system.eventType', type: 'string' },
        { id: 'system.serviceName', type: 'string' },
      ],
    };
    expect(sorted).toEqual(Object.fromEntries(Object.entries(expected).map(([category, list]) => [category, byId(list)])));
  });

  it('every rule field exists in the event catalog, in the namespace of its category, with operators for its type', () => {
    for (const category of EVENT_CATEGORIES) {
      for (const spec of DETECTION_FIELDS[category]) {
        const eventField = EVENT_FIELDS.find((candidate) => candidate.id === spec.id);
        expect(eventField?.detectable).toBe(true);
        expect(eventField?.namespace).toBe(category.toLowerCase());
        expect(DETECTION_OPERATORS_BY_TYPE[spec.type].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('EventIdConflictError', () => {
  it('is a domain error with its own code', () => {
    const error = new EventIdConflictError('events.0.sourceEventId');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('EVENT_ID_CONFLICT');
    expect(error.field).toBe('events.0.sourceEventId');
  });
});
