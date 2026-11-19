import { describe, expect, it } from 'vitest';
import { diffIncident, diffInvestigationLinks, type IncidentActivityState } from '../src/index.js';

const base: IncidentActivityState = {
  title: 'Boot inesperado',
  description: null,
  severity: 'HIGH',
  status: 'OPEN',
  hostIds: ['h1', 'h2'],
  detectionRuleIds: ['r1'],
};

describe('diffIncident', () => {
  it('reports nothing when nothing changed, even with relations reordered', () => {
    expect(diffIncident(base, { ...base, hostIds: ['h2', 'h1'] })).toEqual([]);
  });

  it('reports status, severity and details in that order', () => {
    const after: IncidentActivityState = { ...base, status: 'INVESTIGATING', severity: 'CRITICAL', title: 'Boot fora da janela', detectionRuleIds: [] };
    expect(diffIncident(base, after)).toEqual([
      { kind: 'STATUS_CHANGED', from: 'OPEN', to: 'INVESTIGATING' },
      { kind: 'SEVERITY_CHANGED', from: 'HIGH', to: 'CRITICAL' },
      { kind: 'DETAILS_UPDATED', fields: ['title', 'detectionRuleIds'] },
    ]);
  });

  it('treats a changed set of hosts and a new description as detail changes', () => {
    expect(diffIncident(base, { ...base, description: 'Notas', hostIds: ['h1', 'h3'] })).toEqual([
      { kind: 'DETAILS_UPDATED', fields: ['description', 'hostIds'] },
    ]);
  });
});

describe('diffInvestigationLinks', () => {
  it('separates added and removed incidents, keeping their order', () => {
    expect(diffInvestigationLinks(['a', 'b', 'c'], ['c', 'd', 'a', 'e'])).toEqual({ linked: ['d', 'e'], unlinked: ['b'] });
  });

  it('returns empty lists when the set is the same', () => {
    expect(diffInvestigationLinks(['a', 'b'], ['b', 'a'])).toEqual({ linked: [], unlinked: [] });
  });
});
