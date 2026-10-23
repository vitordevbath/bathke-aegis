import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { EventListFilter, EventRepository, StoredEvent } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class ListEvents {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly events: EventRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: EventListFilter): Promise<Page<StoredEvent>> {
    await this.access.requireMember(user, workspaceId);
    return this.events.listInWorkspace(workspaceId, filter);
  }
}
