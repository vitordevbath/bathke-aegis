import { HostAlreadyPairedError, NotFoundError, PAIRING_CODE_LIMIT_MESSAGE, PAIRING_POLICY, TooManyRequestsError, formatPairingCode } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import { PairingChallenge } from '../../../domain/pairing-challenge.js';
import type { MachineSecrets } from '../../ports/machine-secrets.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export interface IssuedPairingCode {
  /** The only moment the plain code exists outside the requester's hands. */
  readonly code: string;
  readonly challengeId: string;
  readonly expiresAt: Date;
}

/**
 * An OWNER authorizes one machine to connect to one host. Requesting a code
 * replaces any earlier open code for the host and does not touch the host's
 * state: nothing is connected yet.
 */
export class RequestPairingCode {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
    private readonly secrets: MachineSecrets,
    private readonly codesPerHostPerHour: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<IssuedPairingCode> {
    await this.access.requireManager(user, workspaceId);
    const now = this.clock();
    const code = formatPairingCode(this.secrets.generate());
    const challenge = PairingChallenge.issue({ workspaceId, hostId, codeHash: this.secrets.hash(code), createdBy: user.id }, now);

    await this.unitOfWork.run(async (repositories) => {
      // The host lock serializes requests for the same host.
      const host = await repositories.hosts.lockInWorkspace(workspaceId, hostId);
      if (!host) throw new NotFoundError();
      if (host.isPaired) throw new HostAlreadyPairedError();

      const since = new Date(now.getTime() - PAIRING_POLICY.codeRequestWindowMs);
      if ((await repositories.pairingChallenges.countCreatedSince(workspaceId, hostId, since)) >= this.codesPerHostPerHour) {
        throw new TooManyRequestsError(PAIRING_CODE_LIMIT_MESSAGE);
      }

      const previous = await repositories.pairingChallenges.findOpenForHost(workspaceId, hostId);
      if (previous) {
        previous.revoke(now);
        await repositories.pairingChallenges.markRevoked(previous);
      }
      await repositories.pairingChallenges.insert(challenge);
    });

    return { code, challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }
}
