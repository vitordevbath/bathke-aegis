import { describe, expect, it } from 'vitest';
import {
  DETECTION_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TRANSITIONS,
  InvalidIncidentTransitionError,
  InvalidStateError,
  SEVERITIES,
  canTransitionIncident,
  incidentStatusHasResolution,
  type IncidentStatus,
} from '../src/index.js';

describe('incident lifecycle table', () => {
  it.each<[IncidentStatus, IncidentStatus]>([
    ['OPEN', 'INVESTIGATING'],
    ['OPEN', 'RESOLVED'],
    ['INVESTIGATING', 'RESOLVED'],
    ['RESOLVED', 'INVESTIGATING'],
    ['RESOLVED', 'CLOSED'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransitionIncident(from, to)).toBe(true);
  });

  it.each<[IncidentStatus, IncidentStatus]>([
    ['OPEN', 'CLOSED'],
    ['INVESTIGATING', 'OPEN'],
    ['INVESTIGATING', 'CLOSED'],
    ['RESOLVED', 'OPEN'],
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'INVESTIGATING'],
    ['CLOSED', 'RESOLVED'],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransitionIncident(from, to)).toBe(false);
  });

  it('makes CLOSED final and never lists a self-transition', () => {
    expect(INCIDENT_TRANSITIONS.CLOSED).toEqual([]);
    for (const status of INCIDENT_STATUSES) expect(INCIDENT_TRANSITIONS[status]).not.toContain(status);
  });

  it('ties the resolution time to RESOLVED and CLOSED only', () => {
    expect(INCIDENT_STATUSES.filter(incidentStatusHasResolution)).toEqual(['RESOLVED', 'CLOSED']);
  });

  it('reports an invalid transition as a state error on the status field', () => {
    const error = new InvalidIncidentTransitionError('CLOSED', 'OPEN');
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.code).toBe('INVALID_STATE');
    expect(error.field).toBe('status');
    expect(error.message).toBe('Não é possível mudar o status de “Encerrado” para “Aberto”.');
  });
});

describe('shared severity scale', () => {
  it('is the same list for detection rules and incidents', () => {
    expect(DETECTION_SEVERITIES).toBe(SEVERITIES);
    expect(SEVERITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});
