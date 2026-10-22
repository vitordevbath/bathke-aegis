import type { EventCategory, EventType, ServiceState, SystemEventKind } from '@aegis/contracts';

export const CATEGORY_LABELS: Record<EventCategory, string> = { PROCESS: 'Processo', NETWORK: 'Rede', SYSTEM: 'Sistema' };

export const TYPE_LABELS: Record<EventType, string> = {
  PROCESS_STARTED: 'Processo iniciado',
  PROCESS_EXITED: 'Processo encerrado',
  NETWORK_CONNECTION: 'Conexão de rede',
  NETWORK_LISTEN: 'Porta em escuta',
  SYSTEM_BOOT: 'Inicialização do sistema',
  SYSTEM_SERVICE_STATE_CHANGED: 'Mudança de estado de serviço',
};

export const SYSTEM_KIND_LABELS: Record<SystemEventKind, string> = { BOOT: 'Inicialização', SERVICE_STATE_CHANGED: 'Mudança de estado de serviço' };

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  STARTING: 'Iniciando',
  RUNNING: 'Em execução',
  STOPPING: 'Parando',
  STOPPED: 'Parado',
  FAILED: 'Falhou',
};

/** Events are technical facts: seconds matter, so the time keeps them. */
const instant = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
export const formatInstant = (iso: string) => instant.format(new Date(iso));
