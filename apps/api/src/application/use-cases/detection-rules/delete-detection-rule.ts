import { ConflictError, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { AlertRepository, DetectionRuleRepository, IncidentRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export const RULE_IN_INCIDENT_MESSAGE = 'Esta regra está relacionada a incidentes. Remova-a desses incidentes antes de excluí-la.';
export const RULE_HAS_ALERTS_MESSAGE = 'Esta regra já gerou alertas, que são registros permanentes. Desabilite-a em vez de excluí-la.';

/**
 * Deletes the rule; its targets go with it (ON DELETE CASCADE). Hosts are
 * untouched. A rule related to an incident cannot be deleted (409), so an
 * incident never silently loses context. The rule is looked up in the
 * workspace first: a foreign rule is a 404, never a 409. A rule that already
 * raised alerts cannot be deleted either (409): alerts are permanent (ADR-053).
 */
export class DeleteDetectionRule {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly detectionRules: DetectionRuleRepository,
    private readonly incidents: IncidentRepository,
    private readonly alerts: AlertRepository,
  ) {}

  async execute(user: User, workspaceId: string, ruleId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    const rule = await this.detectionRules.findInWorkspace(workspaceId, ruleId);
    if (!rule) throw new NotFoundError();
    if (await this.incidents.isRuleRelated(rule.id)) throw new ConflictError(RULE_IN_INCIDENT_MESSAGE);
    if (await this.alerts.existsForRule(rule.id)) throw new ConflictError(RULE_HAS_ALERTS_MESSAGE);
    if (!(await this.detectionRules.deleteInWorkspace(workspaceId, ruleId))) throw new NotFoundError();
  }
}
