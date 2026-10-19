import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { IncidentRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * Physical delete (ADR-027): incidents hold no immutable evidence yet. The
 * relations go with it (ON DELETE CASCADE); hosts and rules are untouched.
 */
export class DeleteIncident {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly incidents: IncidentRepository,
  ) {}

  async execute(user: User, workspaceId: string, incidentId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    if (!(await this.incidents.deleteInWorkspace(workspaceId, incidentId))) throw new NotFoundError();
  }
}
