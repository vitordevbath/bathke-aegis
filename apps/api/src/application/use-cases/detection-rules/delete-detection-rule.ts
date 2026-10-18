import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { DetectionRuleRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/** Deletes the rule; its targets go with it (ON DELETE CASCADE). Hosts are untouched. */
export class DeleteDetectionRule {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly detectionRules: DetectionRuleRepository,
  ) {}

  async execute(user: User, workspaceId: string, ruleId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    if (!(await this.detectionRules.deleteInWorkspace(workspaceId, ruleId))) throw new NotFoundError();
  }
}
