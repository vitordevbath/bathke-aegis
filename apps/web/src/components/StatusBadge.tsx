import type { ComponentState } from '../types/system-status';

const LABELS: Record<ComponentState, string> = {
  online: 'Online',
  offline: 'Offline',
  checking: 'Checking',
  'not-configured': 'Not configured',
};

export function StatusBadge({ state }: { state: ComponentState }) {
  return <span className={`status status--${state}`}>{LABELS[state]}</span>;
}
