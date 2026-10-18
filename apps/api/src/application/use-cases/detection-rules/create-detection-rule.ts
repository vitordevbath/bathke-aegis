import { DetectionRule, type DetectionRuleDetails } from '../../../domain/detection-rule.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveTargets, type DetectionRuleView } from './detection-rule-view.js';

/** Creates a rule and its targets atomically; every target must belong to the route workspace. */
export class CreateDetectionRule {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, details: DetectionRuleDetails): Promise<DetectionRuleView> {
    await this.access.requireManager(user, workspaceId);
    const rule = DetectionRule.register(workspaceId, details);
    return this.unitOfWork.run(async ({ hosts, detectionRules }) => {
      const targets = await resolveTargets(hosts, rule);
      await detectionRules.insert(rule);
      return { rule, targets };
    });
  }
}
