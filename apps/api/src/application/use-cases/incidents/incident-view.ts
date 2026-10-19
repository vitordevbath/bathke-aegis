import { ValidationError, type FieldIssue } from '@aegis/domain';
import type { DetectionRule } from '../../../domain/detection-rule.js';
import type { Host } from '../../../domain/host.js';
import type { Incident } from '../../../domain/incident.js';
import type { Repositories } from '../../ports/repositories.js';
import { UNKNOWN_HOSTS_MESSAGE } from '../detection-rules/detection-rule-view.js';

/** An incident with its involved hosts and related rules (same workspace only). */
export interface IncidentView {
  readonly incident: Incident;
  readonly hosts: readonly Host[];
  readonly detectionRules: readonly DetectionRule[];
}

export const UNKNOWN_RULES_MESSAGE = 'Uma ou mais regras não existem neste workspace.';

type RelationRepositories = Pick<Repositories, 'hosts' | 'detectionRules'>;

/**
 * Loads the incident's hosts and rules from the incident's own workspace and
 * fails if any is missing. Missing and foreign ids get the same message (no
 * enumeration). Called inside the transaction that writes the relations.
 */
export async function resolveRelations({ hosts, detectionRules }: RelationRepositories, incident: Incident): Promise<IncidentView> {
  const [foundHosts, foundRules] = await Promise.all([
    hosts.findManyInWorkspace(incident.workspaceId, incident.hostIds),
    detectionRules.findManyInWorkspace(incident.workspaceId, incident.detectionRuleIds),
  ]);
  const issues: FieldIssue[] = [];
  if (foundHosts.length !== incident.hostIds.length) issues.push({ field: 'hostIds', message: UNKNOWN_HOSTS_MESSAGE });
  if (foundRules.length !== incident.detectionRuleIds.length) issues.push({ field: 'detectionRuleIds', message: UNKNOWN_RULES_MESSAGE });
  if (issues.length > 0) throw new ValidationError('Incidente inválido.', issues);
  return { incident, hosts: foundHosts, detectionRules: foundRules };
}
