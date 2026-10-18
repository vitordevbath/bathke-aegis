import { ValidationError } from '@aegis/domain';
import type { DetectionRule } from '../../../domain/detection-rule.js';
import type { Host } from '../../../domain/host.js';
import type { HostRepository } from '../../ports/repositories.js';

/** A rule with the hosts it targets (same workspace only). */
export interface DetectionRuleView {
  readonly rule: DetectionRule;
  readonly targets: readonly Host[];
}

export const UNKNOWN_HOSTS_MESSAGE = 'Um ou mais hosts não existem neste workspace.';

/**
 * Loads the rule's target hosts and fails if any is missing from the rule's
 * workspace. Missing and foreign hosts get the same message (no enumeration).
 */
export async function resolveTargets(hosts: HostRepository, rule: DetectionRule): Promise<Host[]> {
  if (rule.targetHostIds.length === 0) return [];
  const found = await hosts.findManyInWorkspace(rule.workspaceId, rule.targetHostIds);
  if (found.length !== rule.targetHostIds.length) throw ValidationError.forField('hostIds', UNKNOWN_HOSTS_MESSAGE);
  return found;
}
