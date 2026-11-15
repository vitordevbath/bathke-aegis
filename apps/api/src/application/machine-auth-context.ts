import { MachineAuthenticationError, MachineScopeError, NotFoundError, type MachineScope } from '@aegis/domain';
import type { Repositories } from './ports/repositories.js';

/**
 * Who is calling when a machine calls: one credential of one host. It has no
 * user, role or membership, and it is carried apart from the human session
 * (`request.currentUser`), so neither can stand in for the other.
 */
export class MachineAuthContext {
  constructor(
    readonly credentialId: string,
    readonly workspaceId: string,
    readonly hostId: string,
    private readonly scopes: readonly MachineScope[],
  ) {}

  /** Each protected operation states the scope it needs; nothing is implied by being authenticated. */
  requireScope(scope: MachineScope): void {
    if (!this.scopes.includes(scope)) throw new MachineScopeError(scope);
  }

  /** The identity is the authority: an address naming any other host answers like a missing one. */
  requireHost(workspaceId: string, hostId: string): void {
    if (this.workspaceId !== workspaceId || this.hostId !== hostId) throw new NotFoundError();
  }

  /**
   * Authentication happened before the work's transaction began. Called inside
   * that transaction, after the host row is locked, this re-reads the
   * credential with a locking read: a revocation that committed in the
   * meantime is seen, and one that has not committed yet must wait for the
   * host lock this transaction holds. So once a revocation returns, no write
   * made with this credential can still commit (ADR-045).
   */
  async confirmStillActive(repositories: Repositories): Promise<void> {
    const credential = await repositories.machineCredentials.lockForUse(this.credentialId);
    if (!credential || !credential.isActive || credential.hostId !== this.hostId) {
      throw new MachineAuthenticationError('REVOKED_IN_FLIGHT', this.credentialId);
    }
  }
}
