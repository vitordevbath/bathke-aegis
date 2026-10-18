import type { HostConnectionState } from '@aegis/contracts';
import { CONNECTION_STATE_LABELS } from './host-format';

/** Shows the real connection state. With no Collector yet, every host is "Não pareado" — never "Offline". */
export function HostStatusBadge({ state }: { state: HostConnectionState }) {
  return <span className={`status status--host-${state.toLowerCase()}`}>{CONNECTION_STATE_LABELS[state]}</span>;
}
