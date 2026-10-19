import { describe, expect, it } from 'vitest';
import { InvalidIncidentTransitionError, InvalidStateError, ValidationError, type IncidentStatus } from '@aegis/domain';
import { Incident, type IncidentDetails, type IncidentSnapshot } from '../../src/domain/incident.js';

const WORKSPACE = '0b6c2f1e-0000-4000-8000-0000000000aa';
const HOST_1 = '0b6c2f1e-0000-4000-8000-000000000001';
const HOST_2 = '0b6c2f1e-0000-4000-8000-000000000002';
const RULE_1 = '0b6c2f1e-0000-4000-8000-000000000101';

const T0 = new Date('2026-05-01T10:00:00.000Z');
const T1 = new Date('2026-05-01T11:00:00.000Z');
const T2 = new Date('2026-05-01T12:00:00.000Z');
const T3 = new Date('2026-05-01T13:00:00.000Z');

const details = (overrides: Partial<IncidentDetails> = {}): IncidentDetails => ({
  title: 'Shell inesperado no servidor web',
  description: 'Comportamento identificado manualmente durante análise.',
  severity: 'HIGH',
  hostIds: [HOST_1],
  detectionRuleIds: [],
  ...overrides,
});

const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).issues.map((issue) => issue.field);
  }
};

/** An incident walked through `path` one hour apart, starting at T1. */
function walked(path: IncidentStatus[]): Incident {
  const incident = Incident.open(WORKSPACE, details(), T0);
  path.forEach((status, index) => incident.transitionTo(status, new Date(T1.getTime() + index * 3_600_000)));
  return incident;
}

describe('Incident', () => {
  it('opens a manual incident: OPEN, MANUAL, unresolved, normalized fields', () => {
    const incident = Incident.open(WORKSPACE, details({ title: '  Shell   web ', description: '   ', detectionRuleIds: [RULE_1] }), T0);
    expect(incident.toSnapshot()).toEqual({
      id: incident.id,
      workspaceId: WORKSPACE,
      title: 'Shell web',
      description: null,
      severity: 'HIGH',
      status: 'OPEN',
      origin: 'MANUAL',
      hostIds: [HOST_1],
      detectionRuleIds: [RULE_1],
      createdAt: T0,
      updatedAt: T0,
      resolvedAt: null,
    } satisfies IncidentSnapshot);
    expect(incident.availableTransitions).toEqual(['INVESTIGATING', 'RESOLVED']);
  });

  it('keeps line breaks in the plain-text description', () => {
    expect(Incident.open(WORKSPACE, details({ description: 'linha 1\nlinha 2' })).toSnapshot().description).toBe('linha 1\nlinha 2');
  });

  it('accepts several hosts and zero or several rules', () => {
    const incident = Incident.open(WORKSPACE, details({ hostIds: [HOST_1, HOST_2], detectionRuleIds: [] }));
    expect(incident.hostIds).toEqual([HOST_1, HOST_2]);
    expect(incident.detectionRuleIds).toEqual([]);
  });

  it.each([
    ['title too short', details({ title: 'x' }), 'title'],
    ['title too long', details({ title: 'x'.repeat(161) }), 'title'],
    ['description too long', details({ description: 'x'.repeat(5001) }), 'description'],
    ['unknown severity', details({ severity: 'URGENT' as never }), 'severity'],
    ['no host', details({ hostIds: [] }), 'hostIds'],
    ['duplicate host', details({ hostIds: [HOST_1, HOST_1] }), 'hostIds'],
    ['duplicate rule', details({ detectionRuleIds: [RULE_1, RULE_1] }), 'detectionRuleIds'],
  ])('rejects %s', (_case, input, field) => {
    expect(fieldsOf(() => Incident.open(WORKSPACE, input))).toEqual([field]);
  });

  it('reports every invalid field at once', () => {
    expect(fieldsOf(() => Incident.open(WORKSPACE, details({ title: '', hostIds: [], severity: 'X' as never })))).toEqual(['title', 'severity', 'hostIds']);
  });

  describe('lifecycle', () => {
    it.each<[IncidentStatus[], IncidentStatus]>([
      [['INVESTIGATING'], 'INVESTIGATING'],
      [['RESOLVED'], 'RESOLVED'],
      [['INVESTIGATING', 'RESOLVED'], 'RESOLVED'],
      [['RESOLVED', 'INVESTIGATING'], 'INVESTIGATING'],
      [['RESOLVED', 'CLOSED'], 'CLOSED'],
      [['INVESTIGATING', 'RESOLVED', 'INVESTIGATING', 'RESOLVED', 'CLOSED'], 'CLOSED'],
    ])('walks %j to %s', (path, expected) => {
      expect(walked(path).status).toBe(expected);
    });

    it.each<[IncidentStatus[], IncidentStatus]>([
      [[], 'CLOSED'],
      [['INVESTIGATING'], 'OPEN'],
      [['INVESTIGATING'], 'CLOSED'],
      [['RESOLVED'], 'OPEN'],
      [['RESOLVED', 'CLOSED'], 'OPEN'],
      [['RESOLVED', 'CLOSED'], 'INVESTIGATING'],
      [['RESOLVED', 'CLOSED'], 'RESOLVED'],
    ])('after %j refuses → %s and stays unchanged', (path, target) => {
      const incident = walked(path);
      const before = incident.toSnapshot();
      expect(() => incident.transitionTo(target, T3)).toThrow(InvalidIncidentTransitionError);
      expect(incident.toSnapshot()).toEqual(before);
    });

    it('treats the current status as a no-op (no timestamp change)', () => {
      const incident = walked(['INVESTIGATING']);
      const before = incident.toSnapshot();
      incident.transitionTo('INVESTIGATING', T3);
      expect(incident.toSnapshot()).toEqual(before);
    });

    it('sets resolvedAt on RESOLVED, clears it on reopen and preserves it on CLOSED', () => {
      const incident = Incident.open(WORKSPACE, details(), T0);
      incident.transitionTo('RESOLVED', T1);
      expect(incident.resolvedAt).toEqual(T1);

      incident.transitionTo('INVESTIGATING', T2);
      expect(incident.resolvedAt).toBeNull();

      incident.transitionTo('RESOLVED', T3);
      const closedAt = new Date(T3.getTime() + 1000);
      incident.transitionTo('CLOSED', closedAt);
      expect(incident.toSnapshot()).toMatchObject({ status: 'CLOSED', resolvedAt: T3, updatedAt: closedAt, createdAt: T0 });
      expect(incident.availableTransitions).toEqual([]);
    });

    it('never stamps resolvedAt while investigating', () => {
      expect(walked(['INVESTIGATING']).resolvedAt).toBeNull();
    });
  });

  describe('revise', () => {
    it('replaces the editable fields without touching status, origin or createdAt', () => {
      const incident = walked(['INVESTIGATING']);
      incident.revise(details({ title: 'Novo título', severity: 'CRITICAL', hostIds: [HOST_2], detectionRuleIds: [RULE_1] }), T3);
      expect(incident.toSnapshot()).toMatchObject({
        title: 'Novo título',
        severity: 'CRITICAL',
        hostIds: [HOST_2],
        detectionRuleIds: [RULE_1],
        status: 'INVESTIGATING',
        origin: 'MANUAL',
        createdAt: T0,
        updatedAt: T3,
      });
    });

    it('validates like open() and leaves the incident untouched on failure', () => {
      const incident = Incident.open(WORKSPACE, details(), T0);
      expect(fieldsOf(() => incident.revise(details({ hostIds: [] }), T1))).toEqual(['hostIds']);
      expect(incident.toSnapshot()).toMatchObject({ hostIds: [HOST_1], updatedAt: T0 });
    });

    it('is refused once the incident is CLOSED (read-only)', () => {
      const incident = walked(['RESOLVED', 'CLOSED']);
      expect(() => incident.revise(details({ title: 'Outro' }))).toThrow(InvalidStateError);
      expect(incident.title).toBe('Shell inesperado no servidor web');
    });
  });

  describe('restore', () => {
    it('round-trips a snapshot, including DETECTION_ENGINE origin reserved for the future', () => {
      const snapshot = { ...walked(['RESOLVED']).toSnapshot(), origin: 'DETECTION_ENGINE' as const };
      expect(Incident.restore(snapshot).toSnapshot()).toEqual(snapshot);
    });

    it.each<[string, Partial<IncidentSnapshot>]>([
      ['RESOLVED without resolvedAt', { status: 'RESOLVED', resolvedAt: null }],
      ['CLOSED without resolvedAt', { status: 'CLOSED', resolvedAt: null }],
      ['OPEN with resolvedAt', { status: 'OPEN', resolvedAt: T1 }],
      ['unknown status', { status: 'ARCHIVED' as never }],
      ['unknown origin', { origin: 'IMPORT' as never }],
      ['no host', { hostIds: [] }],
    ])('refuses an inconsistent row: %s', (_case, overrides) => {
      const snapshot = { ...Incident.open(WORKSPACE, details(), T0).toSnapshot(), ...overrides };
      expect(() => Incident.restore(snapshot)).toThrow(ValidationError);
    });
  });
});
