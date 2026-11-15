import type { HostConnectionState } from '@aegis/contracts';
import { CONNECTION_STATE_LABELS } from './host-format';

/** Shows the connection state the API derived from the active credential and the last heartbeat. */
export function HostStatusBadge({ state }: { state: HostConnectionState }) {
  return <span className={`status status--host-${state.toLowerCase()}`}>{CONNECTION_STATE_LABELS[state]}</span>;
}
