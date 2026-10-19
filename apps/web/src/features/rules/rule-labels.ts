import type { DetectionEventCategory, DetectionOperator, DetectionScope } from '@aegis/contracts';
import type { DetectionCondition, DetectionMatchMode } from '@aegis/domain';

export const CATEGORY_LABELS: Record<DetectionEventCategory, string> = { PROCESS: 'Processo', NETWORK: 'Rede', SYSTEM: 'Sistema' };

export const SCOPE_LABELS: Record<DetectionScope, string> = { ALL_HOSTS: 'Todos os hosts', SELECTED_HOSTS: 'Hosts selecionados' };

export const MATCH_LABELS: Record<DetectionMatchMode, string> = { ALL: 'Todas as condições (E)', ANY: 'Qualquer condição (OU)' };
export const MATCH_CONNECTOR: Record<DetectionMatchMode, string> = { ALL: 'E', ANY: 'OU' };

export const OPERATOR_LABELS: Record<DetectionOperator, string> = {
  EQUALS: 'é igual a',
  NOT_EQUALS: 'é diferente de',
  CONTAINS: 'contém',
  STARTS_WITH: 'começa com',
  ENDS_WITH: 'termina com',
  IN: 'está em',
  GREATER_THAN: 'é maior que',
  LESS_THAN: 'é menor que',
};

/** Planned telemetry fields (no telemetry exists yet). */
export const FIELD_LABELS: Record<string, string> = {
  'process.name': 'Processo › Nome',
  'process.executable': 'Processo › Executável',
  'process.parentName': 'Processo › Processo pai',
  'process.user': 'Processo › Usuário',
  'network.protocol': 'Rede › Protocolo',
  'network.localPort': 'Rede › Porta local',
  'network.remotePort': 'Rede › Porta remota',
  'network.remoteAddress': 'Rede › Endereço remoto',
  'network.processName': 'Rede › Processo',
  'system.eventType': 'Sistema › Tipo de evento',
  'system.serviceName': 'Sistema › Serviço',
};

export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

export function describeCondition(condition: DetectionCondition): string {
  const value = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value);
  return `${fieldLabel(condition.field)} ${OPERATOR_LABELS[condition.operator]} ${value}`;
}
