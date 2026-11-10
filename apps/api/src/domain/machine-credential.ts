import { randomUUID } from 'node:crypto';
import { CredentialRevokedError, Entity, machineTokenPrefixOf, parseMachineScopes, type MachineScope } from '@aegis/domain';

export interface MachineCredentialSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly hostId: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly scopes: readonly MachineScope[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly pairingChallengeId: string | null;
  readonly rotatedFromCredentialId: string | null;
}

interface IssueInput {
  readonly workspaceId: string;
  readonly hostId: string;
  readonly tokenHash: string;
  readonly scopes: readonly MachineScope[];
  readonly pairingChallengeId?: string | null;
  readonly rotatedFromCredentialId?: string | null;
}

/**
 * The identity of one Collector instance: bound to exactly one host and, through
 * it, one workspace, for as long as it lives. Only the hash of the secret is
 * held. Revocation is logical and final, so the record survives for audit.
 */
export class MachineCredential extends Entity<string> {
  readonly #snapshot: Omit<MachineCredentialSnapshot, 'id' | 'revokedAt' | 'scopes'>;
  readonly #scopes: readonly MachineScope[];
  #revokedAt: Date | null;

  private constructor(snapshot: MachineCredentialSnapshot) {
    super(snapshot.id);
    const { id: _id, revokedAt, scopes, ...rest } = snapshot;
    this.#snapshot = rest;
    // A stored set that no longer validates is refused, never interpreted.
    this.#scopes = parseMachineScopes(scopes);
    this.#revokedAt = revokedAt;
  }

  static issue(input: IssueInput, now: Date = new Date()): MachineCredential {
    const id = randomUUID();
    return new MachineCredential({
      id,
      workspaceId: input.workspaceId,
      hostId: input.hostId,
      tokenHash: input.tokenHash,
      tokenPrefix: machineTokenPrefixOf(id),
      scopes: input.scopes,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      pairingChallengeId: input.pairingChallengeId ?? null,
      rotatedFromCredentialId: input.rotatedFromCredentialId ?? null,
    });
  }

  static restore(snapshot: MachineCredentialSnapshot): MachineCredential {
    return new MachineCredential(snapshot);
  }

  get workspaceId(): string {
    return this.#snapshot.workspaceId;
  }

  get hostId(): string {
    return this.#snapshot.hostId;
  }

  get tokenHash(): string {
    return this.#snapshot.tokenHash;
  }

  get scopes(): readonly MachineScope[] {
    return this.#scopes;
  }

  get lastUsedAt(): Date | null {
    return this.#snapshot.lastUsedAt;
  }

  get isActive(): boolean {
    return this.#revokedAt === null;
  }

  /** Immediate and final. Returns false when the credential was already revoked, so repeating it changes nothing. */
  revoke(now: Date = new Date()): boolean {
    if (this.#revokedAt) return false;
    this.#revokedAt = now;
    return true;
  }

  /** Replaces this credential: it is revoked and the successor inherits host, workspace and scopes. */
  rotate(tokenHash: string, now: Date = new Date()): MachineCredential {
    if (!this.revoke(now)) throw new CredentialRevokedError();
    return MachineCredential.issue(
      { workspaceId: this.workspaceId, hostId: this.hostId, tokenHash, scopes: this.#scopes, rotatedFromCredentialId: this.id },
      now,
    );
  }

  toSnapshot(): MachineCredentialSnapshot {
    return { id: this.id, ...this.#snapshot, scopes: this.#scopes, revokedAt: this.#revokedAt };
  }
}
