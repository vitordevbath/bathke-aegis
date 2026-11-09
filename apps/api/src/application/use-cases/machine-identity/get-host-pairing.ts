import { CREDENTIAL_HISTORY_LIMIT, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { MachineCredential } from '../../../domain/machine-credential.js';
import type { HostRepository, MachineCredentialRepository, PairingChallengeRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export interface HostPairingView {
  readonly pendingCodeExpiresAt: Date | null;
  readonly credentials: readonly MachineCredential[];
}

/** What any workspace member may see about a host's pairing: metadata, never a code, token or hash. */
export class GetHostPairing {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
    private readonly challenges: PairingChallengeRepository,
    private readonly credentials: MachineCredentialRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<HostPairingView> {
    await this.access.requireMember(user, workspaceId);
    if (!(await this.hosts.findInWorkspace(workspaceId, hostId))) throw new NotFoundError();

    const [open, credentials] = await Promise.all([
      this.challenges.findOpenForHost(workspaceId, hostId),
      this.credentials.listForHost(workspaceId, hostId, CREDENTIAL_HISTORY_LIMIT),
    ]);
    return { pendingCodeExpiresAt: open?.statusAt(this.clock()) === 'PENDING' ? open.expiresAt : null, credentials };
  }
}
