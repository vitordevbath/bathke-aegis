import { randomUUID } from 'node:crypto';
import { Entity, normalizeHostDescription, normalizeHostDisplayName } from '@aegis/domain';

/**
 * `UNPAIRED` is the only state reachable today. `ONLINE`/`OFFLINE` are reserved
 * for the future Aegis Collector heartbeat and are never set by users.
 */
export type HostConnectionState = 'UNPAIRED' | 'ONLINE' | 'OFFLINE';

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
  readonly connectionState: HostConnectionState;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Facts reported by a Collector, never by the user. All null until pairing exists. */
interface CollectorFacts {
  readonly agentId: string | null;
  readonly hostname: string | null;
  readonly osName: string | null;
  readonly osVersion: string | null;
  readonly architecture: string | null;
  readonly connectionState: HostConnectionState;
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
 * `description`); the collector facts have no setters — they will change only
 * through a future pairing/heartbeat flow.
 */
export class Host extends Entity<string> {
  readonly #workspaceId: string;
  #displayName: string;
  #description: string | null;
  readonly #collector: CollectorFacts;
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

  get connectionState(): HostConnectionState {
    return this.#collector.connectionState;
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
