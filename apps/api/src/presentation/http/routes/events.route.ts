import type { FastifyPluginAsync } from 'fastify';
import {
  EventListQuerySchema,
  IngestEventsRequestSchema,
  type EventResponse,
  type EventSummary,
  type IngestEventsResponse,
  type PaginatedResponse,
} from '@aegis/contracts';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { AuthenticateMachine } from '../../../application/use-cases/machine-identity/authenticate-machine.js';
import type { IngestEventsAsMachine } from '../../../application/use-cases/events/ingest-events.js';
import type { ListEvents } from '../../../application/use-cases/events/list-events.js';
import type { GetEvent } from '../../../application/use-cases/events/get-event.js';
import { authenticate, authenticateMachine, currentUserOf, machineAuthOf } from '../authenticate.js';
import { toEventResponse, toEventSummary, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface EventsRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly listEvents: ListEvents;
  readonly getEvent: GetEvent;
}

export interface EventIngestionRouteOptions {
  readonly authenticateMachine: AuthenticateMachine;
  readonly ingestEvents: IngestEventsAsMachine;
  /** Ingestion batches per client IP per minute. */
  readonly ingestRateLimitMax: number;
}

/** 100 events at the contract's maximum field sizes fit well under 1 MiB; larger bodies are refused (413). */
export const INGEST_BODY_LIMIT = 1024 * 1024;

const HostParamsSchema = resourceParamsSchema('hostId');
const EventParamsSchema = resourceParamsSchema('eventId');

/**
 * The one route a machine may call with its credential. It is a plugin of its
 * own so the user-session hook of the routes below cannot apply to it: a user
 * JWT is refused here (ADR-042). The rate limit runs before authentication,
 * so bad credentials also spend the budget.
 */
export const eventIngestionRoute: FastifyPluginAsync<EventIngestionRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticateMachine(options.authenticateMachine));

  app.post(
    '/workspaces/:workspaceId/hosts/:hostId/events/ingest',
    { bodyLimit: INGEST_BODY_LIMIT, config: { rateLimit: { max: options.ingestRateLimitMax, timeWindow: 60_000 } } },
    async (request): Promise<IngestEventsResponse> => {
      const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
      const { events } = IngestEventsRequestSchema.parse(request.body);
      const started = performance.now();
      const result = await options.ingestEvents.execute(machineAuthOf(request), workspaceId, hostId, events);
      // Counts and timing only: never payloads, addresses, process data or source ids.
      request.log.info({ ...result, durationMs: Math.round(performance.now() - started) }, 'events ingested');
      return result;
    },
  );
};

/** Telemetry is append-only: people can list and read it. There is no create form, update or delete route. */
export const eventsRoute: FastifyPluginAsync<EventsRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.get('/workspaces/:workspaceId/events', async (request): Promise<PaginatedResponse<EventSummary>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = EventListQuerySchema.parse(request.query);
    const page = await options.listEvents.execute(currentUserOf(request), workspaceId, {
      page: query.page,
      pageSize: query.pageSize,
      hostId: query.hostId,
      category: query.category,
      eventType: query.eventType,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    return toPaginatedResponse(page, toEventSummary);
  });

  app.get('/workspaces/:workspaceId/events/:eventId', async (request): Promise<EventResponse> => {
    const { workspaceId, eventId } = paramsOf(EventParamsSchema, request);
    return toEventResponse(await options.getEvent.execute(currentUserOf(request), workspaceId, eventId));
  });
};
