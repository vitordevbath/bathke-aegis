import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * Logical and final: the row stays for audit, the token stops authenticating
 * and a new credential requires a new pairing. Revoking twice changes nothing
 * and reports `revoked: false`, so the call can be retried safely.
 */
export class RevokeMachineCredential {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, hostId: string, credentialId: string): Promise<{ revoked: boolean }> {
    await this.access.requireManager(user, workspaceId);
    const now = this.clock();

    return this.unitOfWork.run(async (repositories) => {
      const host = await repositories.hosts.lockInWorkspace(workspaceId, hostId);
      if (!host) throw new NotFoundError();
      const credential = await repositories.machineCredentials.lockInHost(workspaceId, hostId, credentialId);
      if (!credential) throw new NotFoundError();

      if (!credential.revoke(now)) return { revoked: false };
      await repositories.machineCredentials.markRevoked(credential);
      if (host.agentId === credential.id) {
        host.markUnpaired(now);
        await repositories.hosts.updatePairing(host);
      }
      return { revoked: true };
    });
  }
}
