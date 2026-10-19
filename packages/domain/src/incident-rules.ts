import { InvalidStateError } from './domain-error.js';

/**
 * Rules of a security incident, shared by the API entity, the request schemas
 * and the web forms. An incident is a case that deserves human follow-up; in
 * this stage it is always registered manually (there is no detection or
 * correlation engine yet).
 */

export const INCIDENT_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * `DETECTION_ENGINE` is reserved for the future correlation engine. Nothing
 * creates such incidents today, and clients can never choose the origin.
 */
export const INCIDENT_ORIGINS = ['MANUAL', 'DETECTION_ENGINE'] as const;
export type IncidentOrigin = (typeof INCIDENT_ORIGINS)[number];

export const INCIDENT_STATUS_LABELS: Readonly<Record<IncidentStatus, string>> = {
  OPEN: 'Aberto',
  INVESTIGATING: 'Em investigação',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};

export const INCIDENT_ORIGIN_LABELS: Readonly<Record<IncidentOrigin, string>> = {
  MANUAL: 'Manual',
  DETECTION_ENGINE: 'Motor de detecção',
};

/**
 * The lifecycle, as the single table every layer reads:
 *   OPEN → INVESTIGATING → RESOLVED → CLOSED (final)
 *   OPEN → RESOLVED (solved without a separate investigation)
 *   RESOLVED → INVESTIGATING (reopened before being closed)
 */
export const INCIDENT_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  OPEN: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: ['INVESTIGATING', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** RESOLVED and CLOSED carry a resolution time; OPEN and INVESTIGATING never do. */
export function incidentStatusHasResolution(status: IncidentStatus): boolean {
  return status === 'RESOLVED' || status === 'CLOSED';
}

export const INCIDENT_LIMITS = {
  titleMin: 2,
  titleMax: 160,
  descriptionMax: 5000,
  maxHosts: 100,
  maxDetectionRules: 100,
} as const;

export const INCIDENT_TITLE_MESSAGE = `O título deve ter entre ${INCIDENT_LIMITS.titleMin} e ${INCIDENT_LIMITS.titleMax} caracteres.`;
export const INCIDENT_DESCRIPTION_MESSAGE = `A descrição deve ter no máximo ${INCIDENT_LIMITS.descriptionMax} caracteres.`;
export const INCIDENT_HOSTS_REQUIRED_MESSAGE = 'Selecione pelo menos um host envolvido.';
export const INCIDENT_CLOSED_MESSAGE = 'Este incidente está encerrado e não pode mais ser alterado.';

/** A status change outside `INCIDENT_TRANSITIONS`. */
export class InvalidIncidentTransitionError extends InvalidStateError {
  constructor(
    readonly from: IncidentStatus,
    readonly to: IncidentStatus,
  ) {
    super(`Não é possível mudar o status de “${INCIDENT_STATUS_LABELS[from]}” para “${INCIDENT_STATUS_LABELS[to]}”.`, 'status');
  }
}
