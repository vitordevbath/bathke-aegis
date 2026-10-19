import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { InvestigationRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * Physical delete (ADR-031), also for CLOSED investigations: there is no
 * audit log or immutable evidence yet. The incident relations go with it
 * (ON DELETE CASCADE); the incidents themselves are untouched.
 */
export class DeleteInvestigation {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly investigations: InvestigationRepository,
  ) {}

  async execute(user: User, workspaceId: string, investigationId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    if (!(await this.investigations.deleteInWorkspace(workspaceId, investigationId))) throw new NotFoundError();
  }
}
