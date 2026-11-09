import { CREDENTIAL_LAST_USED_RESOLUTION_MS, MachineAuthenticationError, parseMachineToken } from '@aegis/domain';
import { MachineAuthContext } from '../../machine-auth-context.js';
import type { MachineSecrets } from '../../ports/machine-secrets.js';
import type { MachineCredentialRepository } from '../../ports/repositories.js';

/** Compared when no credential matches, so an unknown id costs the same work as a wrong secret. */
const UNMATCHABLE_HASH = '0'.repeat(64);

/**
 * Turns a raw token into a machine identity, independently of user sessions.
 * Workspace and host come from the credential row, whose foreign keys
 * guarantee both still exist. The secret is checked before the revocation
 * state, so only a holder of the real secret can tell the difference.
 */
export class AuthenticateMachine {
  constructor(
    private readonly credentials: MachineCredentialRepository,
    private readonly secrets: MachineSecrets,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(rawToken: string): Promise<MachineAuthContext> {
    const parsed = parseMachineToken(rawToken);
    if (!parsed) throw new MachineAuthenticationError('MALFORMED');

    const credential = await this.credentials.findForAuthentication(parsed.credentialId);
    if (!credential) {
      this.secrets.matches(parsed.secret, UNMATCHABLE_HASH);
      throw new MachineAuthenticationError('UNKNOWN_CREDENTIAL');
    }
    if (!this.secrets.matches(parsed.secret, credential.tokenHash)) throw new MachineAuthenticationError('BAD_SECRET', credential.id);
    if (!credential.isActive) throw new MachineAuthenticationError('REVOKED', credential.id);

    const now = this.clock();
    const olderThan = new Date(now.getTime() - CREDENTIAL_LAST_USED_RESOLUTION_MS);
    if (!credential.lastUsedAt || credential.lastUsedAt < olderThan) await this.credentials.touchLastUsed(credential.id, now, olderThan);

    return new MachineAuthContext(credential.id, credential.workspaceId, credential.hostId, credential.scopes);
  }
}
