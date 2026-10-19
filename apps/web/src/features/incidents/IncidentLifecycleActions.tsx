import type { IncidentStatus } from '@aegis/contracts';
import { transitionLabel } from './incident-labels';

interface IncidentLifecycleActionsProps {
  readonly status: IncidentStatus;
  /** As reported by the API (computed by the domain lifecycle). */
  readonly available: readonly IncidentStatus[];
  readonly pending: boolean;
  readonly onTransition: (status: IncidentStatus) => void;
}

/** Status buttons for the transitions the server allows from the current status. Renders nothing once CLOSED. */
export function IncidentLifecycleActions({ status, available, pending, onTransition }: IncidentLifecycleActionsProps) {
  if (available.length === 0) return null;
  return (
    <div className="lifecycle" role="group" aria-label="Alterar status">
      {available.map((target) => (
        <button
          key={target}
          type="button"
          className={target === 'CLOSED' ? 'button' : 'button button--primary'}
          disabled={pending}
          onClick={() => onTransition(target)}
        >
          {transitionLabel(status, target)}
        </button>
      ))}
    </div>
  );
}
