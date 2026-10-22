import { createHash, randomUUID } from 'node:crypto';
import {
  Entity,
  ValidationError,
  summarizeEvent,
  validateEvent,
  type EventBodyV1,
  type EventCategory,
  type EventType,
  type NormalizedEventV1,
} from '@aegis/domain';

/** Where an event was observed: always a host of a workspace (decided by the ingestion context, never by the payload). */
export interface EventOrigin {
  readonly workspaceId: string;
  readonly hostId: string;
}

export interface TelemetryEventSnapshot extends EventOrigin {
  readonly id: string;
  readonly sourceEventId: string;
  readonly schemaVersion: number;
  readonly category: EventCategory;
  readonly type: EventType;
  readonly occurredAt: Date;
  readonly ingestedAt: Date;
  readonly data: EventBodyV1['data'];
  readonly fingerprint: string;
}

/**
 * SHA-256 of the canonical event (envelope + data in catalog key order, UTC
 * timestamp, lower-case source id). Identical content always yields the same
 * fingerprint; any relevant change yields a different one.
 */
export function fingerprintOf(event: NormalizedEventV1): string {
  const canonical = JSON.stringify({
    schemaVersion: event.schemaVersion,
    sourceEventId: event.sourceEventId,
    occurredAt: event.occurredAt,
    category: event.category,
    type: event.type,
    data: event.data,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * An immutable technical fact observed on a host (Event Contract v1). Named
 * TelemetryEvent to avoid confusion with DOM events. It has no mutators: once
 * received it never changes, and it is never edited or deleted individually.
 */
export class TelemetryEvent extends Entity<string> {
  readonly #origin: EventOrigin;
  readonly #event: NormalizedEventV1;
  readonly #ingestedAt: Date;
  readonly #fingerprint: string;

  private constructor(id: string, origin: EventOrigin, event: NormalizedEventV1, ingestedAt: Date) {
    super(id);
    this.#origin = { workspaceId: origin.workspaceId, hostId: origin.hostId };
    this.#event = event;
    this.#ingestedAt = ingestedAt;
    this.#fingerprint = fingerprintOf(event);
  }

  /** Accepts an event already validated by `validateEvent` (the ingestion service does it with the clock check). */
  static receive(origin: EventOrigin, event: NormalizedEventV1, now: Date = new Date()): TelemetryEvent {
    return new TelemetryEvent(randomUUID(), origin, event, now);
  }

  /** Re-validates stored rows and their fingerprint: a corrupted or tampered row is refused, not shown. */
  static restore(snapshot: TelemetryEventSnapshot): TelemetryEvent {
    const result = validateEvent({
      schemaVersion: snapshot.schemaVersion,
      sourceEventId: snapshot.sourceEventId,
      occurredAt: snapshot.occurredAt.toISOString(),
      category: snapshot.category,
      type: snapshot.type,
      data: snapshot.data,
    });
    if (!result.ok) throw new ValidationError('Evento armazenado inválido.', result.issues);
    const event = new TelemetryEvent(snapshot.id, snapshot, result.event, snapshot.ingestedAt);
    if (event.fingerprint !== snapshot.fingerprint) throw new ValidationError('Evento armazenado não confere com sua impressão digital.');
    return event;
  }

  get workspaceId(): string {
    return this.#origin.workspaceId;
  }

  get hostId(): string {
    return this.#origin.hostId;
  }

  get sourceEventId(): string {
    return this.#event.sourceEventId;
  }

  get fingerprint(): string {
    return this.#fingerprint;
  }

  /** The normalized event exactly as validated (envelope + typed body). */
  get event(): NormalizedEventV1 {
    return this.#event;
  }

  get occurredAt(): Date {
    return new Date(this.#event.occurredAt);
  }

  get ingestedAt(): Date {
    return new Date(this.#ingestedAt);
  }

  get summary(): string {
    return summarizeEvent(this.#event);
  }

  toSnapshot(): TelemetryEventSnapshot {
    return {
      id: this.id,
      workspaceId: this.#origin.workspaceId,
      hostId: this.#origin.hostId,
      sourceEventId: this.#event.sourceEventId,
      schemaVersion: this.#event.schemaVersion,
      category: this.#event.category,
      type: this.#event.type,
      occurredAt: new Date(this.#event.occurredAt),
      ingestedAt: new Date(this.#ingestedAt),
      data: this.#event.data,
      fingerprint: this.#fingerprint,
    };
  }
}
