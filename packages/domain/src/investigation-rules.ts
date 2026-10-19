import { InvalidStateError, ValidationError } from './domain-error.js';

/**
 * Rules of an investigation, shared by the API entity, the request schemas
 * and the web forms. An investigation is a human case that groups one or more
 * incidents of the same workspace and ends with a written conclusion. It never
 * creates telemetry, runs rules or raises alerts.
 */

export const INVESTIGATION_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export const INVESTIGATION_STATUS_LABELS: Readonly<Record<InvestigationStatus, string>> = {
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em andamento',
  CLOSED: 'Encerrada',
};

/**
 * The lifecycle, as the single table every layer reads:
 *   OPEN → IN_PROGRESS → CLOSED (final)
 *   OPEN → CLOSED (concluded without a separate analysis phase)
 *   IN_PROGRESS → OPEN (analysis paused, case back in the queue)
 */
export const INVESTIGATION_TRANSITIONS: Readonly<Record<InvestigationStatus, readonly InvestigationStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionInvestigation(from: InvestigationStatus, to: InvestigationStatus): boolean {
  return INVESTIGATION_TRANSITIONS[from].includes(to);
}

export const INVESTIGATION_LIMITS = {
  titleMin: 2,
  titleMax: 160,
  descriptionMax: 5000,
  /** Required only to close: a draft conclusion may be shorter. */
  conclusionMinToClose: 10,
  conclusionMax: 10000,
  maxIncidents: 100,
} as const;

export const INVESTIGATION_TITLE_MESSAGE = `O título deve ter entre ${INVESTIGATION_LIMITS.titleMin} e ${INVESTIGATION_LIMITS.titleMax} caracteres.`;
export const INVESTIGATION_DESCRIPTION_MESSAGE = `A descrição deve ter no máximo ${INVESTIGATION_LIMITS.descriptionMax} caracteres.`;
export const INVESTIGATION_CONCLUSION_MESSAGE = `A conclusão deve ter no máximo ${INVESTIGATION_LIMITS.conclusionMax} caracteres.`;
export const INVESTIGATION_CONCLUSION_REQUIRED_MESSAGE = 'Adicione uma conclusão antes de encerrar a investigação.';
export const INVESTIGATION_CONCLUSION_TOO_SHORT_MESSAGE = `A conclusão deve ter pelo menos ${INVESTIGATION_LIMITS.conclusionMinToClose} caracteres para encerrar a investigação.`;
export const INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE = 'Selecione pelo menos um incidente relacionado.';
export const INVESTIGATION_CLOSED_MESSAGE = 'Esta investigação está encerrada e não pode mais ser alterada.';

/**
 * Why `conclusion` (already trimmed, or null) is not enough to close an
 * investigation, or null when it is. Shared so the web form and the entity
 * refuse exactly the same input.
 */
export function closingConclusionProblem(conclusion: string | null): string | null {
  if (!conclusion) return INVESTIGATION_CONCLUSION_REQUIRED_MESSAGE;
  if (conclusion.length < INVESTIGATION_LIMITS.conclusionMinToClose) return INVESTIGATION_CONCLUSION_TOO_SHORT_MESSAGE;
  return null;
}

/** A status change outside `INVESTIGATION_TRANSITIONS`. */
export class InvalidInvestigationTransitionError extends InvalidStateError {
  constructor(
    readonly from: InvestigationStatus,
    readonly to: InvestigationStatus,
  ) {
    super(`Não é possível mudar o status de “${INVESTIGATION_STATUS_LABELS[from]}” para “${INVESTIGATION_STATUS_LABELS[to]}”.`, 'status');
  }
}

/** Closing without a human conclusion (missing or too short), reported on the `conclusion` field. */
export class InvestigationConclusionRequiredError extends ValidationError {
  constructor(message: string = INVESTIGATION_CONCLUSION_REQUIRED_MESSAGE) {
    super(message, [{ field: 'conclusion', message }]);
  }
}
