import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { EventRepository, StoredEvent } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class GetEvent {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly events: EventRepository,
  ) {}

  /** Missing event and event of another workspace are the same 404. */
  async execute(user: User, workspaceId: string, eventId: string): Promise<StoredEvent> {
    await this.access.requireMember(user, workspaceId);
    const stored = await this.events.findInWorkspace(workspaceId, eventId);
    if (!stored) throw new NotFoundError();
    return stored;
  }
}
