import { MachineScopeError, NotFoundError, type MachineScope } from '@aegis/domain';

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
}
