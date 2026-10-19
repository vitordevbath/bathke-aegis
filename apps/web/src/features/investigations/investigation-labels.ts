import { INVESTIGATION_STATUS_LABELS, type InvestigationStatus } from '@aegis/domain';

export { INVESTIGATION_STATUS_LABELS as STATUS_LABELS };

/**
 * Button text for a transition the server reported as available. This is
 * wording only; which transitions exist comes from `availableTransitions`.
 */
export function transitionLabel(to: InvestigationStatus): string {
  if (to === 'IN_PROGRESS') return 'Iniciar investigação';
  if (to === 'OPEN') return 'Pausar investigação';
  return 'Encerrar';
}
