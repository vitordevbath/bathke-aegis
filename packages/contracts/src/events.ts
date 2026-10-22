import { z } from 'zod';
import {
  EVENT_CATEGORIES,
  EVENT_DEFINITIONS,
  EVENT_LIMITS,
  EVENT_TYPES,
  type EventBodyV1,
  type EventCategory,
  type EventType,
} from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';
import { PaginationQuerySchema } from './pagination.js';

export { EVENT_CATEGORIES, EVENT_TYPES };
export type { EventCategory, EventType };
export type {
  EventBodyV1,
  NormalizedEventV1,
  ProcessData,
  NetworkData,
  SystemData,
  NetworkProtocol,
  ServiceState,
  SystemEventKind,
} from '@aegis/domain';

/**
 * Body of `POST /workspaces/:workspaceId/hosts/:hostId/events/ingest`: a batch
 * of 1–100 events. Only the envelope is checked here; each event is validated
 * by the ingestion service with the domain Event Contract v1, so the same
 * rules apply whatever transport delivers the batch.
 */
export const IngestEventsRequestSchema = z
  .object({
    events: z
      .array(z.unknown(), { required_error: 'Envie a lista de eventos.', invalid_type_error: 'Envie a lista de eventos.' })
      .min(1, 'Envie pelo menos um evento.')
      .max(EVENT_LIMITS.maxBatch, `Envie no máximo ${EVENT_LIMITS.maxBatch} eventos por lote.`),
  })
  .strict(UNKNOWN_FIELD_MESSAGE);
export type IngestEventsRequest = z.input<typeof IngestEventsRequestSchema>;

/** Outcome of a batch: identical replays are not stored twice. */
export interface IngestEventsResponse {
  readonly received: number;
  readonly inserted: number;
  readonly deduplicated: number;
}

const timestamp = (message: string) => z.string().datetime({ offset: true, message }).optional();

/** Query of `GET /workspaces/:workspaceId/events` (timeline, newest first). */
export const EventListQuerySchema = PaginationQuerySchema.extend({
  hostId: z.string().uuid('Host inválido.').optional(),
  category: z.enum(EVENT_CATEGORIES, { errorMap: () => ({ message: 'Categoria inválida.' }) }).optional(),
  eventType: z.enum(EVENT_TYPES, { errorMap: () => ({ message: 'Tipo de evento inválido.' }) }).optional(),
  from: timestamp('Data inicial inválida.'),
  to: timestamp('Data final inválida.'),
}).superRefine((query, ctx) => {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'A data final deve ser posterior à inicial.' });
  }
  if (query.category && query.eventType && EVENT_DEFINITIONS[query.eventType].category !== query.category) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['eventType'], message: 'O tipo não pertence à categoria escolhida.' });
  }
});
export type EventListQuery = z.output<typeof EventListQuerySchema>;

/** List item: no payload, only a short technical summary. */
export interface EventSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly hostId: string;
  readonly hostDisplayName: string;
  readonly category: EventCategory;
  readonly type: EventType;
  readonly occurredAt: string;
  readonly ingestedAt: string;
  readonly summary: string;
}

/** Detail: the stored, validated event (never the raw request), typed by `type`. */
export type EventResponse = Omit<EventSummary, 'category' | 'type'> & {
  readonly schemaVersion: number;
  readonly sourceEventId: string;
} & EventBodyV1;
