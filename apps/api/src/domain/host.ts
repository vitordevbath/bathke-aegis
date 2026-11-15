import { randomUUID } from 'node:crypto';
import { Entity, InvalidStateError, hostConnectionStateOf, normalizeHostDescription, normalizeHostDisplayName, type HostConnectionState } from '@aegis/domain';

export type { HostConnectionState };

/**
 * Stored pairing state: `UNPAIRED` or `PAIRED` (an active credential exists).
 * The column still accepts the ONLINE/OFFLINE values of earlier migrations,
 * but connectivity is never stored: `connectionStateAt` derives it from
 * `lastSeenAt` (ADR-043).
 */
export type HostPairingState = HostConnectionState;

export interface HostSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly agentId: string | null;
  readonly hostname: string | null;
  readonly osName: string | null;
  readonly osVersion: string | null;
  readonly architecture: string | null;
  readonly connectionState: HostPairingState;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Facts about the host's Collector, never set by the user. `agentId` is the active credential's public id. */
interface CollectorFacts {
  readonly agentId: string | null;
  readonly hostname: string | null;
  readonly osName: string | null;
  readonly osVersion: string | null;
  readonly architecture: string | null;
  readonly connectionState: HostPairingState;
  readonly lastSeenAt: Date | null;
}

const UNPAIRED: CollectorFacts = {
  agentId: null,
  hostname: null,
  osName: null,
  osVersion: null,
  architecture: null,
  connectionState: 'UNPAIRED',
  lastSeenAt: null,
};

/**
 * A machine registered in a workspace, which may later be paired with an Aegis
 * Collector. Users manage only the administrative fields (`displayName`,
 * `description`); the collector facts have no setters — they change only
 * through the pairing flow (`markPaired`/`markUnpaired`) and the heartbeat
 * (`recordHeartbeat`).
 */
export class Host extends Entity<string> {
  readonly #workspaceId: string;
  #displayName: string;
  #description: string | null;
  #collector: CollectorFacts;
  readonly #createdAt: Date;
  #updatedAt: Date;

  private constructor(
    id: string,
    workspaceId: string,
    displayName: string,
    description: string | null,
    collector: CollectorFacts,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id);
    this.#workspaceId = workspaceId;
    this.#displayName = displayName;
    this.#description = description;
    this.#collector = collector;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
  }

  /** Registers a host manually: unpaired, no telemetry, in exactly one workspace. */
  static register(input: { workspaceId: string; displayName: string; description?: string | null }, now: Date = new Date()): Host {
    return new Host(
      randomUUID(),
      input.workspaceId,
      normalizeHostDisplayName(input.displayName),
      normalizeHostDescription(input.description),
      UNPAIRED,
      now,
      now,
    );
  }

  static restore(snapshot: HostSnapshot): Host {
    const { id, workspaceId, displayName, description, createdAt, updatedAt, ...collector } = snapshot;
    return new Host(
      id,
      workspaceId,
      normalizeHostDisplayName(displayName),
      normalizeHostDescription(description),
      collector,
      createdAt,
      updatedAt,
    );
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get displayName(): string {
    return this.#displayName;
  }

  get description(): string | null {
    return this.#description;
  }

  /** Connectivity at `now`, derived from the active credential and the last heartbeat. */
  connectionStateAt(now: Date): HostConnectionState {
    return hostConnectionStateOf({ paired: this.isPaired, lastSeenAt: this.#collector.lastSeenAt }, now);
  }

  get lastSeenAt(): Date | null {
    return this.#collector.lastSeenAt;
  }

  get agentId(): string | null {
    return this.#collector.agentId;
  }

  get isPaired(): boolean {
    return this.#collector.agentId !== null;
  }

  get createdAt(): Date {
    return this.#createdAt;
  }

  get updatedAt(): Date {
    return this.#updatedAt;
  }

  /** Replaces the administrative fields (PUT semantics: a missing description clears it). */
  updateDetails(input: { displayName: string; description?: string | null }, now: Date = new Date()): void {
    this.#displayName = normalizeHostDisplayName(input.displayName);
    this.#description = normalizeHostDescription(input.description);
    this.#updatedAt = now;
  }

  /** Binds the host to its active credential. Earlier heartbeats stay as history. */
  markPaired(credentialId: string, now: Date = new Date()): void {
    this.#collector = { ...this.#collector, agentId: credentialId, connectionState: 'PAIRED' };
    this.#updatedAt = now;
  }

  /**
   * The paired Collector reported in, at the server's time. Never moves
   * backwards, and is not an administrative change (`updatedAt` is untouched).
   */
  recordHeartbeat(now: Date): void {
    if (!this.isPaired) throw new InvalidStateError('Este host não está pareado.');
    const last = this.#collector.lastSeenAt;
    if (last && last.getTime() >= now.getTime()) return;
    this.#collector = { ...this.#collector, lastSeenAt: now };
  }

  /** The host no longer has an active credential. Facts the Collector already reported stay as history. */
  markUnpaired(now: Date = new Date()): void {
    this.#collector = { ...this.#collector, agentId: null, connectionState: 'UNPAIRED' };
    this.#updatedAt = now;
  }

  toSnapshot(): HostSnapshot {
    return {
      id: this.id,
      workspaceId: this.#workspaceId,
      displayName: this.#displayName,
      description: this.#description,
      ...this.#collector,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    };
  }
}
