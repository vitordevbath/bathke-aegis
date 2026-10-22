import { EventIdConflictError, NotFoundError, ValidationError, validateEvent, type FieldIssue } from '@aegis/domain';
import { TelemetryEvent, type EventOrigin } from '../domain/telemetry-event.js';
import type { UnitOfWork } from './ports/repositories.js';

export interface IngestionResult {
  readonly received: number;
  readonly inserted: number;
  readonly deduplicated: number;
}

/**
 * The transport-independent core of event ingestion. It knows nothing about
 * HTTP, JWT or users: callers authenticate the source and name the target
 * host (today the user-auth lab route; later the Collector credential route).
 *
 * Batch semantics (ADR-034):
 *  1. every event is validated first — any invalid event fails the whole
 *     batch (400) before any I/O;
 *  2. inside one transaction, with the host row locked so concurrent batches
 *     for the same host serialize, each event is compared by
 *     `sourceEventId` with what is stored and with earlier items of the batch:
 *     same fingerprint → deduplicated, different fingerprint → 409
 *     `EVENT_ID_CONFLICT` and the transaction is rolled back (nothing from the
 *     batch is stored);
 *  3. the remaining new events are inserted together.
 */
export class EventIngestionService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ingest(origin: EventOrigin, rawEvents: readonly unknown[]): Promise<IngestionResult> {
    const now = this.clock();
    const issues: FieldIssue[] = [];
    const received = rawEvents.map((raw, index) => {
      const result = validateEvent(raw, now);
      if (result.ok) return TelemetryEvent.receive(origin, result.event, now);
      for (const issue of result.issues) issues.push({ field: issue.field ? `events.${index}.${issue.field}` : `events.${index}`, message: issue.message });
      return null;
    });
    if (issues.length > 0) throw new ValidationError('Lote de eventos inválido; nenhum evento foi armazenado.', issues);
    const events = received.filter((event): event is TelemetryEvent => event !== null);

    return this.unitOfWork.run(async (repositories) => {
      const host = await repositories.hosts.lockInWorkspace(origin.workspaceId, origin.hostId);
      if (!host) throw new NotFoundError();

      const stored = await repositories.events.fingerprintsBySourceId(host.id, [...new Set(events.map((event) => event.sourceEventId))]);
      const seen = new Map(stored);
      const fresh: TelemetryEvent[] = [];
      events.forEach((event, index) => {
        const known = seen.get(event.sourceEventId);
        if (known === undefined) {
          seen.set(event.sourceEventId, event.fingerprint);
          fresh.push(event);
        } else if (known !== event.fingerprint) {
          throw new EventIdConflictError(`events.${index}.sourceEventId`);
        }
      });
      await repositories.events.insertMany(fresh);
      return { received: events.length, inserted: fresh.length, deduplicated: events.length - fresh.length };
    });
  }
}
