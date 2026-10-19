import type { InvestigationStatus } from '@aegis/contracts';
import { STATUS_LABELS } from './investigation-labels';

/** Text plus a distinct mark per status (ring, half, square): never color alone. */
export function InvestigationStatusBadge({ status }: { status: InvestigationStatus }) {
  return <span className={`status status--investigation-${status.toLowerCase().replace('_', '-')}`}>{STATUS_LABELS[status]}</span>;
}
