import { NotFoundError } from '@aegis/domain';
import type { DetectionRuleDetails } from '../../../domain/detection-rule.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveTargets, type DetectionRuleView } from './detection-rule-view.js';

/**
 * Replaces every editable field, including scope and targets, in one
 * transaction: switching to ALL_HOSTS removes the explicit targets; switching
 * to SELECTED_HOSTS validates the new hosts. Any failure leaves the rule as it was.
 */
export class UpdateDetectionRule {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, ruleId: string, details: DetectionRuleDetails): Promise<DetectionRuleView> {
    await this.access.requireManager(user, workspaceId);
    return this.unitOfWork.run(async ({ hosts, detectionRules }) => {
      const rule = await detectionRules.findInWorkspace(workspaceId, ruleId);
      if (!rule) throw new NotFoundError();
      rule.update(details);
      const targets = await resolveTargets(hosts, rule);
      await detectionRules.update(rule);
      return { rule, targets };
    });
  }
}
