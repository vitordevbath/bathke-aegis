import { INCIDENT_ORIGIN_LABELS, INCIDENT_STATUS_LABELS, type IncidentStatus } from '@aegis/domain';

export { INCIDENT_ORIGIN_LABELS as ORIGIN_LABELS, INCIDENT_STATUS_LABELS as STATUS_LABELS };

/**
 * Button text for a transition the server reported as available. This is
 * wording only; which transitions exist comes from `availableTransitions`.
 */
export function transitionLabel(from: IncidentStatus, to: IncidentStatus): string {
  if (to === 'INVESTIGATING') return from === 'RESOLVED' ? 'Reabrir investigação' : 'Iniciar investigação';
  if (to === 'RESOLVED') return 'Resolver';
  if (to === 'CLOSED') return 'Encerrar';
  return INCIDENT_STATUS_LABELS[to];
}
