import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { DetectionRuleRepository, HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import type { DetectionRuleView } from './detection-rule-view.js';

export class GetDetectionRule {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly detectionRules: DetectionRuleRepository,
    private readonly hosts: HostRepository,
  ) {}

  /** Missing rule and rule of another workspace are the same 404. */
  async execute(user: User, workspaceId: string, ruleId: string): Promise<DetectionRuleView> {
    await this.access.requireMember(user, workspaceId);
    const rule = await this.detectionRules.findInWorkspace(workspaceId, ruleId);
    if (!rule) throw new NotFoundError();
    const targets = rule.targetHostIds.length > 0 ? await this.hosts.findManyInWorkspace(workspaceId, rule.targetHostIds) : [];
    return { rule, targets };
  }
}
