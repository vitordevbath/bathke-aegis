import { Host } from '../../../domain/host.js';
import type { User } from '../../../domain/user.js';
import type { HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export interface HostDetailsInput {
  readonly displayName: string;
  readonly description?: string | null | undefined;
}

/** Registers a host in a workspace. The workspace comes from the route, never from the body. */
export class CreateHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
  ) {}

  async execute(user: User, workspaceId: string, input: HostDetailsInput): Promise<Host> {
    await this.access.requireManager(user, workspaceId);
    const host = Host.register({ workspaceId, displayName: input.displayName, description: input.description ?? null });
    await this.hosts.insert(host);
    return host;
  }
}
