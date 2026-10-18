import type { ComponentState } from '../types/system-status';

const LABELS: Record<ComponentState, string> = {
  online: 'Online',
  offline: 'Offline',
  checking: 'Verificando',
  'not-configured': 'Não configurado',
};

export function StatusBadge({ state }: { state: ComponentState }) {
  return <span className={`status status--${state}`}>{LABELS[state]}</span>;
}
