import { describe, expect, it } from 'vitest';
import { InvalidInvestigationTransitionError, InvalidStateError, InvestigationConclusionRequiredError, ValidationError, type InvestigationStatus } from '@aegis/domain';
import { Investigation, type InvestigationDetails, type InvestigationSnapshot } from '../../src/domain/investigation.js';

const WORKSPACE = '0b6c2f1e-0000-4000-8000-0000000000aa';
const INCIDENT_1 = '0b6c2f1e-0000-4000-8000-000000000201';
const INCIDENT_2 = '0b6c2f1e-0000-4000-8000-000000000202';
const CONCLUSION = 'Falso positivo: atualização legítima do servidor.';

const T0 = new Date('2026-05-01T10:00:00.000Z');
const T1 = new Date('2026-05-01T11:00:00.000Z');
const T2 = new Date('2026-05-01T12:00:00.000Z');
const T3 = new Date('2026-05-01T13:00:00.000Z');

const details = (overrides: Partial<InvestigationDetails> = {}): InvestigationDetails => ({
  title: 'Atividade incomum nos servidores web',
  description: 'Agrupa incidentes relacionados à mesma sequência de análise.',
  incidentIds: [INCIDENT_1],
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

/** An investigation with a conclusion drafted, walked through `path` one hour apart from T1. */
function walked(path: InvestigationStatus[]): Investigation {
  const investigation = Investigation.open(WORKSPACE, details(), T0);
  investigation.revise(details({ conclusion: CONCLUSION }), T0);
  path.forEach((status, index) => investigation.transitionTo(status, new Date(T1.getTime() + index * 3_600_000)));
  return investigation;
}

describe('Investigation', () => {
  it('opens a case: OPEN, no conclusion, not closed, normalized fields', () => {
    const investigation = Investigation.open(WORKSPACE, details({ title: '  Atividade   incomum ', description: '   ', incidentIds: [INCIDENT_2, INCIDENT_1] }), T0);
    expect(investigation.toSnapshot()).toEqual({
      id: investigation.id,
      workspaceId: WORKSPACE,
      title: 'Atividade incomum',
      description: null,
      conclusion: null,
      status: 'OPEN',
      incidentIds: [INCIDENT_2, INCIDENT_1],
      createdAt: T0,
      updatedAt: T0,
      closedAt: null,
    } satisfies InvestigationSnapshot);
    expect(investigation.availableTransitions).toEqual(['IN_PROGRESS', 'CLOSED']);
  });

  it('never takes a conclusion on open, even if one is smuggled in', () => {
    const smuggled = { ...details(), conclusion: CONCLUSION } as InvestigationDetails;
    expect(Investigation.open(WORKSPACE, smuggled).conclusion).toBeNull();
  });

  it.each([
    ['title too short', details({ title: 'x' }), 'title'],
    ['title too long', details({ title: 'x'.repeat(161) }), 'title'],
    ['description too long', details({ description: 'x'.repeat(5001) }), 'description'],
    ['no incident', details({ incidentIds: [] }), 'incidentIds'],
    ['duplicate incident', details({ incidentIds: [INCIDENT_1, INCIDENT_1] }), 'incidentIds'],
  ])('rejects %s', (_case, input, field) => {
    expect(fieldsOf(() => Investigation.open(WORKSPACE, input))).toEqual([field]);
  });

  it('reports every invalid field at once', () => {
    expect(fieldsOf(() => Investigation.open(WORKSPACE, details({ title: '', incidentIds: [] })))).toEqual(['title', 'incidentIds']);
  });

  describe('lifecycle', () => {
    it.each<[InvestigationStatus[], InvestigationStatus]>([
      [['IN_PROGRESS'], 'IN_PROGRESS'],
      [['CLOSED'], 'CLOSED'],
      [['IN_PROGRESS', 'CLOSED'], 'CLOSED'],
      [['IN_PROGRESS', 'OPEN'], 'OPEN'],
      [['IN_PROGRESS', 'OPEN', 'IN_PROGRESS', 'CLOSED'], 'CLOSED'],
    ])('walks %j to %s', (path, expected) => {
      expect(walked(path).status).toBe(expected);
    });

    it.each<InvestigationStatus>(['OPEN', 'IN_PROGRESS'])('refuses CLOSED → %s and stays unchanged', (target) => {
      const investigation = walked(['CLOSED']);
      const before = investigation.toSnapshot();
      expect(() => investigation.transitionTo(target, T3)).toThrow(InvalidInvestigationTransitionError);
      expect(investigation.toSnapshot()).toEqual(before);
      expect(investigation.availableTransitions).toEqual([]);
    });

    it('treats the current status as a no-op (no timestamp change)', () => {
      const investigation = walked(['IN_PROGRESS']);
      const before = investigation.toSnapshot();
      investigation.transitionTo('IN_PROGRESS', T3);
      expect(investigation.toSnapshot()).toEqual(before);
    });

    it.each([
      ['missing', null, 'Adicione uma conclusão antes de encerrar a investigação.'],
      ['blank', '   ', 'Adicione uma conclusão antes de encerrar a investigação.'],
      ['too short', 'Curta', 'A conclusão deve ter pelo menos 10 caracteres para encerrar a investigação.'],
    ])('refuses to close with a %s conclusion, on the conclusion field', (_case, conclusion, message) => {
      const investigation = Investigation.open(WORKSPACE, details(), T0);
      investigation.revise(details({ conclusion }), T0);
      const before = investigation.toSnapshot();
      let caught: unknown;
      try {
        investigation.transitionTo('CLOSED', T1);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvestigationConclusionRequiredError);
      expect((caught as ValidationError).issues).toEqual([{ field: 'conclusion', message }]);
      expect(investigation.toSnapshot()).toEqual(before);
    });

    it('stamps closedAt only on CLOSED and never clears it', () => {
      const investigation = walked(['IN_PROGRESS', 'OPEN']);
      expect(investigation.closedAt).toBeNull();
      investigation.transitionTo('CLOSED', T3);
      expect(investigation.toSnapshot()).toMatchObject({ status: 'CLOSED', closedAt: T3, updatedAt: T3, createdAt: T0, conclusion: CONCLUSION });
      expect(() => investigation.transitionTo('OPEN')).toThrow(InvalidStateError);
      expect(investigation.closedAt).toEqual(T3);
    });
  });

  describe('revise', () => {
    it('replaces title, description, conclusion and incidents without touching status or createdAt', () => {
      const investigation = walked(['IN_PROGRESS']);
      investigation.revise(details({ title: 'Novo título', description: null, conclusion: '  Rascunho  ', incidentIds: [INCIDENT_2] }), T2);
      expect(investigation.toSnapshot()).toMatchObject({
        title: 'Novo título',
        description: null,
        conclusion: 'Rascunho',
        incidentIds: [INCIDENT_2],
        status: 'IN_PROGRESS',
        createdAt: T0,
        updatedAt: T2,
      });
    });

    it('accepts a short draft conclusion while not closed, and clears a blank one', () => {
      const investigation = Investigation.open(WORKSPACE, details());
      investigation.revise(details({ conclusion: 'Rascunho' }));
      expect(investigation.conclusion).toBe('Rascunho');
      investigation.revise(details({ conclusion: '' }));
      expect(investigation.conclusion).toBeNull();
      expect(fieldsOf(() => investigation.revise(details({ conclusion: 'x'.repeat(10001) })))).toEqual(['conclusion']);
    });

    it('validates like open() and leaves the investigation untouched on failure', () => {
      const investigation = Investigation.open(WORKSPACE, details(), T0);
      expect(fieldsOf(() => investigation.revise(details({ incidentIds: [] }), T1))).toEqual(['incidentIds']);
      expect(investigation.toSnapshot()).toMatchObject({ incidentIds: [INCIDENT_1], updatedAt: T0 });
    });

    it('is refused once the investigation is CLOSED (read-only)', () => {
      const investigation = walked(['CLOSED']);
      const before = investigation.toSnapshot();
      expect(() => investigation.revise(details({ title: 'Outro', conclusion: CONCLUSION }))).toThrow(InvalidStateError);
      expect(investigation.toSnapshot()).toEqual(before);
    });
  });

  describe('restore', () => {
    it('round-trips open and closed snapshots', () => {
      for (const snapshot of [walked(['IN_PROGRESS']).toSnapshot(), walked(['CLOSED']).toSnapshot()]) {
        expect(Investigation.restore(snapshot).toSnapshot()).toEqual(snapshot);
      }
    });

    it.each<[string, Partial<InvestigationSnapshot>]>([
      ['CLOSED without closedAt', { status: 'CLOSED', closedAt: null }],
      ['CLOSED without conclusion', { status: 'CLOSED', closedAt: T1, conclusion: null }],
      ['OPEN with closedAt', { status: 'OPEN', closedAt: T1 }],
      ['unknown status', { status: 'ARCHIVED' as never }],
      ['no incident', { incidentIds: [] }],
    ])('refuses an inconsistent row: %s', (_case, overrides) => {
      const snapshot = { ...walked([]).toSnapshot(), ...overrides };
      expect(() => Investigation.restore(snapshot)).toThrow(ValidationError);
    });
  });
});
