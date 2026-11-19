import { useCanManage } from '../workspaces/WorkspaceContext';
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
function IncidentLifecycleActionsForm({ status, available, pending, onTransition }: IncidentLifecycleActionsProps) {
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

/** Viewers (e.g. AEGIS DEMO) see the status, not the transitions; the API refuses them anyway. */
export function IncidentLifecycleActions(props: IncidentLifecycleActionsProps) {
  if (!useCanManage()) return <p className="muted small">Somente leitura neste workspace.</p>;
  return <IncidentLifecycleActionsForm {...props} />;
}
