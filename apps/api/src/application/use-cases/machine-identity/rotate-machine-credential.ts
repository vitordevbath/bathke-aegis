import { NotFoundError, formatMachineToken } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { MachineCredential } from '../../../domain/machine-credential.js';
import type { MachineSecrets } from '../../ports/machine-secrets.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export interface RotatedCredential {
  /** The only moment the plain token exists outside the requester's hands. */
  readonly token: string;
  readonly credential: MachineCredential;
  readonly previousCredentialId: string;
}

/**
 * Replaces a credential atomically: when this commits, the old token no longer
 * authenticates and the new one does. There is no transition period. Events,
 * rules and the host's identity are untouched.
 */
export class RotateMachineCredential {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
    private readonly secrets: MachineSecrets,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, hostId: string, credentialId: string): Promise<RotatedCredential> {
    await this.access.requireManager(user, workspaceId);
    const now = this.clock();
    const secret = this.secrets.generate();

    return this.unitOfWork.run(async (repositories) => {
      const host = await repositories.hosts.lockInWorkspace(workspaceId, hostId);
      if (!host) throw new NotFoundError();
      const current = await repositories.machineCredentials.lockInHost(workspaceId, hostId, credentialId);
      if (!current) throw new NotFoundError();

      const successor = current.rotate(this.secrets.hash(secret), now);
      // Revoked first: the unique index allows one active credential per host at every step.
      await repositories.machineCredentials.markRevoked(current);
      await repositories.machineCredentials.insert(successor);
      host.markPaired(successor.id, now);
      await repositories.hosts.updatePairing(host);

      return { token: formatMachineToken(successor.id, secret), credential: successor, previousCredentialId: current.id };
    });
  }
}
