import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * An OWNER withdraws a pairing code that should no longer be usable. Safe to
 * repeat: a code already cancelled, expired-and-cancelled or consumed is left
 * as it is and reported with `cancelled: false`. Cancelling never touches a
 * credential, including one this code already produced.
 *
 * Concurrency with `RedeemPairingCode`: both lock the host first and then the
 * challenge row, so one of them sees the other's committed result — the code
 * is either consumed (and the cancellation changes nothing) or revoked (and
 * the redemption is refused). The conditional UPDATE holds the same guarantee
 * in the database.
 */
export class CancelPairingCode {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, hostId: string, challengeId: string): Promise<{ cancelled: boolean }> {
    await this.access.requireManager(user, workspaceId);

    return this.unitOfWork.run(async (repositories) => {
      const host = await repositories.hosts.lockInWorkspace(workspaceId, hostId);
      if (!host) throw new NotFoundError();
      const challenge = await repositories.pairingChallenges.lockInHost(workspaceId, hostId, challengeId);
      if (!challenge) throw new NotFoundError();

      const now = this.clock();
      const status = challenge.statusAt(now);
      if (status === 'CONSUMED' || status === 'REVOKED') return { cancelled: false };
      challenge.revoke(now);
      return { cancelled: await repositories.pairingChallenges.markRevoked(challenge) };
    });
  }
}
