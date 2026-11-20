import { describe, expect, it } from 'vitest';
import { eventFieldValue, matchesDetection, type DetectionDefinitionV1, type NormalizedEventV1 } from '../src/index.js';

const base = { schemaVersion: 1 as const, sourceEventId: '0b6c2f1e-0000-4000-8000-000000000001', occurredAt: '2026-05-01T10:00:00.000Z' };
const service = (serviceName: string, state = 'RUNNING') =>
  ({ ...base, category: 'SYSTEM', type: 'SYSTEM_SERVICE_STATE_CHANGED', data: { system: { eventType: 'SERVICE_STATE_CHANGED', serviceName, state } } }) as unknown as NormalizedEventV1;
const boot = { ...base, category: 'SYSTEM', type: 'SYSTEM_BOOT', data: { system: { eventType: 'BOOT', serviceName: null, state: null } } } as unknown as NormalizedEventV1;
const process = (name: string, executable: string, pid = 4242) =>
  ({
    ...base,
    category: 'PROCESS',
    type: 'PROCESS_STARTED',
    data: { process: { pid, parentPid: 1, name, executable, parentName: 'nginx', user: 'www-data' } },
  }) as unknown as NormalizedEventV1;
const rule = (match: 'ALL' | 'ANY', conditions: DetectionDefinitionV1['conditions']): DetectionDefinitionV1 => ({ version: 1, match, conditions });

describe('detection engine', () => {
  it('reads detectable fields by namespace and key, and absent or null as undefined', () => {
    expect(eventFieldValue(service('sshd'), 'system.serviceName')).toBe('sshd');
    expect(eventFieldValue(boot, 'system.serviceName')).toBeUndefined();
    expect(eventFieldValue(process('bash', '/usr/bin/bash'), 'process.pid')).toBe(4242);
    expect(eventFieldValue(boot, 'malformed')).toBeUndefined();
  });

  it('applies ALL and ANY', () => {
    const conditions = [
      { field: 'system.eventType', operator: 'EQUALS', value: 'SERVICE_STATE_CHANGED' },
      { field: 'system.serviceName', operator: 'IN', value: ['sshd', 'nginx'] },
    ] as const;
    expect(matchesDetection(rule('ALL', conditions), service('nginx'))).toBe(true);
    expect(matchesDetection(rule('ALL', conditions), service('cron'))).toBe(false);
    expect(matchesDetection(rule('ANY', conditions), service('cron'))).toBe(true);
    expect(matchesDetection(rule('ANY', conditions), boot)).toBe(false);
  });

  it('never matches on a field the event does not carry, not even NOT_EQUALS', () => {
    expect(matchesDetection(rule('ALL', [{ field: 'system.serviceName', operator: 'NOT_EQUALS', value: 'sshd' }]), boot)).toBe(false);
    expect(matchesDetection(rule('ALL', [{ field: 'system.serviceName', operator: 'NOT_EQUALS', value: 'sshd' }]), service('cron'))).toBe(true);
  });

  it('compares strings exactly and numbers numerically', () => {
    const shell = process('bash', '/usr/bin/bash', 31337);
    expect(matchesDetection(rule('ALL', [{ field: 'process.executable', operator: 'STARTS_WITH', value: '/usr/bin/' }]), shell)).toBe(true);
    expect(matchesDetection(rule('ALL', [{ field: 'process.executable', operator: 'ENDS_WITH', value: 'bash' }]), shell)).toBe(true);
    expect(matchesDetection(rule('ALL', [{ field: 'process.executable', operator: 'CONTAINS', value: 'BIN' }]), shell)).toBe(false);
    expect(matchesDetection(rule('ALL', [{ field: 'process.pid', operator: 'GREATER_THAN', value: 30000 }]), shell)).toBe(true);
    expect(matchesDetection(rule('ALL', [{ field: 'process.pid', operator: 'LESS_THAN', value: 30000 }]), shell)).toBe(false);
    expect(matchesDetection(rule('ALL', [{ field: 'process.name', operator: 'GREATER_THAN', value: 1 }]), shell)).toBe(false);
  });

  it('does not match an empty ALL definition', () => {
    expect(matchesDetection(rule('ALL', []), service('sshd'))).toBe(false);
  });
});
