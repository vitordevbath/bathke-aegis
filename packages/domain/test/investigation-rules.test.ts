import { describe, expect, it } from 'vitest';
import {
  INVESTIGATION_STATUSES,
  INVESTIGATION_TRANSITIONS,
  InvalidInvestigationTransitionError,
  InvalidStateError,
  InvestigationConclusionRequiredError,
  ValidationError,
  canTransitionInvestigation,
  closingConclusionProblem,
  type InvestigationStatus,
} from '../src/index.js';

describe('investigation lifecycle table', () => {
  it.each<[InvestigationStatus, InvestigationStatus]>([
    ['OPEN', 'IN_PROGRESS'],
    ['OPEN', 'CLOSED'],
    ['IN_PROGRESS', 'CLOSED'],
    ['IN_PROGRESS', 'OPEN'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransitionInvestigation(from, to)).toBe(true);
  });

  it.each<[InvestigationStatus, InvestigationStatus]>([
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'IN_PROGRESS'],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransitionInvestigation(from, to)).toBe(false);
  });

  it('makes CLOSED final and never lists a self-transition', () => {
    expect(INVESTIGATION_TRANSITIONS.CLOSED).toEqual([]);
    for (const status of INVESTIGATION_STATUSES) expect(INVESTIGATION_TRANSITIONS[status]).not.toContain(status);
  });

  it('reports an invalid transition as a state error on the status field', () => {
    const error = new InvalidInvestigationTransitionError('CLOSED', 'OPEN');
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.field).toBe('status');
    expect(error.message).toBe('Não é possível mudar o status de “Encerrada” para “Aberta”.');
  });
});

describe('closing conclusion', () => {
  it('requires a conclusion of at least 10 characters to close', () => {
    expect(closingConclusionProblem(null)).toBe('Adicione uma conclusão antes de encerrar a investigação.');
    expect(closingConclusionProblem('')).toBe('Adicione uma conclusão antes de encerrar a investigação.');
    expect(closingConclusionProblem('Curta')).toBe('A conclusão deve ter pelo menos 10 caracteres para encerrar a investigação.');
    expect(closingConclusionProblem('Falso positivo confirmado.')).toBeNull();
  });

  it('is a validation error on the conclusion field', () => {
    const error = new InvestigationConclusionRequiredError();
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.issues).toEqual([{ field: 'conclusion', message: 'Adicione uma conclusão antes de encerrar a investigação.' }]);
  });
});
