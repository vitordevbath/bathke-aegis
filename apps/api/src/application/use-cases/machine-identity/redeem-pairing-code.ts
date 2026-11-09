import { DEFAULT_MACHINE_SCOPES, PairingRejectedError, formatMachineToken, isPairingCodeFormat } from '@aegis/domain';
import { MachineCredential } from '../../../domain/machine-credential.js';
import type { MachineSecrets } from '../../ports/machine-secrets.js';
import type { UnitOfWork } from '../../ports/repositories.js';

export interface RedeemedPairing {
  /** The only moment the plain token exists outside the machine that redeemed it. */
  readonly token: string;
  readonly credential: MachineCredential;
  readonly challengeId: string;
}

/**
 * A machine trades a pairing code for its own credential. Workspace and host
 * come only from the stored challenge. Everything happens in one transaction:
 * any failure leaves the code unused and no credential behind.
 *
 * Concurrency: the host row is locked first (same order as event ingestion),
 * so a second request for the same code waits and then finds it consumed. The
 * conditional UPDATE and the unique `pairing_challenge_id` hold the same
 * guarantee in the database even if this order were ever broken.
 */
export class RedeemPairingCode {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly secrets: MachineSecrets,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(code: string): Promise<RedeemedPairing> {
    if (!isPairingCodeFormat(code)) throw new PairingRejectedError('MALFORMED');
    const codeHash = this.secrets.hash(code);
    const now = this.clock();
    const secret = this.secrets.generate();

    return this.unitOfWork.run(async (repositories) => {
      const found = await repositories.pairingChallenges.findByCodeHash(codeHash);
      if (!found) throw new PairingRejectedError('UNKNOWN_CODE');
      const audit = { challengeId: found.id, workspaceId: found.workspaceId, hostId: found.hostId };

      const host = await repositories.hosts.lockInWorkspace(found.workspaceId, found.hostId);
      if (!host) throw new PairingRejectedError('HOST_UNAVAILABLE', audit);

      // The first read may predate the lock: only this one decides.
      const challenge = await repositories.pairingChallenges.lockById(found.id);
      if (!challenge) throw new PairingRejectedError('UNKNOWN_CODE', audit);
      challenge.consume(now);
      if (host.isPaired) throw new PairingRejectedError('HOST_ALREADY_PAIRED', audit);
      if (!(await repositories.pairingChallenges.markConsumed(challenge))) throw new PairingRejectedError('CONSUMED', audit);

      const credential = MachineCredential.issue(
        {
          workspaceId: challenge.workspaceId,
          hostId: challenge.hostId,
          tokenHash: this.secrets.hash(secret),
          scopes: DEFAULT_MACHINE_SCOPES,
          pairingChallengeId: challenge.id,
        },
        now,
      );
      await repositories.machineCredentials.insert(credential);
      host.markPaired(credential.id, now);
      await repositories.hosts.updatePairing(host);

      return { token: formatMachineToken(credential.id, secret), credential, challengeId: challenge.id };
    });
  }
}
