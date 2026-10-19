import type { IncidentStatus } from '@aegis/contracts';
import { STATUS_LABELS } from './incident-labels';

/** Text plus a distinct mark per status (ring, half, filled, square): never color alone. */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={`status status--incident-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}
