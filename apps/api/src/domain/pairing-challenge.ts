import { randomUUID } from 'node:crypto';
import { Entity, PAIRING_POLICY, PairingRejectedError } from '@aegis/domain';

export type PairingChallengeStatus = 'PENDING' | 'EXPIRED' | 'CONSUMED' | 'REVOKED';

export interface PairingChallengeSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly hostId: string;
  readonly codeHash: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * A temporary authorization to connect one machine to one host. Only the hash
 * of the code is ever held; `consume` is the one way to use it and works once.
 */
export class PairingChallenge extends Entity<string> {
  readonly #workspaceId: string;
  readonly #hostId: string;
  readonly #codeHash: string;
  readonly #createdBy: string;
  readonly #createdAt: Date;
  readonly #expiresAt: Date;
  #consumedAt: Date | null;
  #revokedAt: Date | null;

  private constructor(snapshot: PairingChallengeSnapshot) {
    super(snapshot.id);
    this.#workspaceId = snapshot.workspaceId;
    this.#hostId = snapshot.hostId;
    this.#codeHash = snapshot.codeHash;
    this.#createdBy = snapshot.createdBy;
    this.#createdAt = snapshot.createdAt;
    this.#expiresAt = snapshot.expiresAt;
    this.#consumedAt = snapshot.consumedAt;
    this.#revokedAt = snapshot.revokedAt;
  }

  static issue(input: { workspaceId: string; hostId: string; codeHash: string; createdBy: string }, now: Date = new Date()): PairingChallenge {
    return new PairingChallenge({
      id: randomUUID(),
      ...input,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PAIRING_POLICY.codeTtlMs),
      consumedAt: null,
      revokedAt: null,
    });
  }

  static restore(snapshot: PairingChallengeSnapshot): PairingChallenge {
    return new PairingChallenge(snapshot);
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get hostId(): string {
    return this.#hostId;
  }

  get expiresAt(): Date {
    return this.#expiresAt;
  }

  statusAt(now: Date): PairingChallengeStatus {
    if (this.#consumedAt) return 'CONSUMED';
    if (this.#revokedAt) return 'REVOKED';
    return now.getTime() >= this.#expiresAt.getTime() ? 'EXPIRED' : 'PENDING';
  }

  /** Marks the single use of the code. Anything but a pending challenge is refused. */
  consume(now: Date = new Date()): void {
    const status = this.statusAt(now);
    if (status !== 'PENDING') {
      throw new PairingRejectedError(status, { challengeId: this.id, workspaceId: this.#workspaceId, hostId: this.#hostId });
    }
    this.#consumedAt = now;
  }

  /** Invalidates a code that was not used. A consumed or already revoked challenge keeps its history. */
  revoke(now: Date = new Date()): void {
    if (this.#consumedAt || this.#revokedAt) return;
    this.#revokedAt = now;
  }

  toSnapshot(): PairingChallengeSnapshot {
    return {
      id: this.id,
      workspaceId: this.#workspaceId,
      hostId: this.#hostId,
      codeHash: this.#codeHash,
      createdBy: this.#createdBy,
      createdAt: this.#createdAt,
      expiresAt: this.#expiresAt,
      consumedAt: this.#consumedAt,
      revokedAt: this.#revokedAt,
    };
  }
}
