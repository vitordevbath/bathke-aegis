import type { DetectionRule } from '../../../domain/detection-rule.js';
import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { DetectionRuleListFilter, DetectionRuleRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class ListDetectionRules {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly detectionRules: DetectionRuleRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: DetectionRuleListFilter): Promise<Page<DetectionRule>> {
    await this.access.requireMember(user, workspaceId);
    return this.detectionRules.listInWorkspace(workspaceId, filter);
  }
}
