import type { HostConnectionState } from '@aegis/contracts';

export const CONNECTION_STATE_LABELS: Record<HostConnectionState, string> = {
  UNPAIRED: 'Não pareado',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
