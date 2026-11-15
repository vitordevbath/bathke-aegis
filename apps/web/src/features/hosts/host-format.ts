import type { HostConnectionState } from '@aegis/contracts';

/** Pairing (an active credential) and communication (a recent heartbeat) are worded apart. */
export const CONNECTION_STATE_LABELS: Record<HostConnectionState, string> = {
  UNPAIRED: 'Não pareado',
  PAIRED: 'Pareado, sem comunicação',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
};

/** What each state means, for the detail screen. Seconds come from the shared presence policy. */
export const CONNECTION_STATE_HINTS: Record<HostConnectionState, string> = {
  UNPAIRED: 'Nenhuma credencial de máquina ativa: nenhum Collector pode se comunicar com este host.',
  PAIRED: 'Há uma credencial ativa, mas o Collector ainda não enviou nenhum heartbeat.',
  ONLINE: 'O Collector enviou um heartbeat recentemente.',
  OFFLINE: 'O Collector já se comunicou, mas está sem enviar heartbeat além do limite.',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
