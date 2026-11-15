import type { FastifyPluginAsync } from 'fastify';
import { HeartbeatRequestSchema, type HeartbeatResponse } from '@aegis/contracts';
import type { AuthenticateMachine } from '../../../application/use-cases/machine-identity/authenticate-machine.js';
import type { RecordHeartbeat } from '../../../application/use-cases/machine-identity/record-heartbeat.js';
import { auditRevokedInFlight, authenticateMachine, machineAuthOf } from '../authenticate.js';
import { paramsOf, resourceParamsSchema } from '../route-params.js';

export interface HeartbeatRouteOptions {
  readonly authenticateMachine: AuthenticateMachine;
  readonly recordHeartbeat: RecordHeartbeat;
  /** Heartbeats per client IP per minute. */
  readonly rateLimitMax: number;
}

const HostParamsSchema = resourceParamsSchema('hostId');
/** The body is empty; a small cap keeps anything else from being read. */
const HEARTBEAT_BODY_LIMIT = 1024;

/**
 * A machine route, like event ingestion: its own plugin, so no user-session
 * hook applies, and only a machine credential with `host:heartbeat` is
 * accepted (ADR-043, ADR-044). The address must name the credential's own host;
 * any other answers like a missing one. Nothing here is logged per request
 * beyond Fastify's line: a heartbeat every 30 s is not an audit event.
 */
export const heartbeatRoute: FastifyPluginAsync<HeartbeatRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticateMachine(options.authenticateMachine));
  app.addHook('onError', auditRevokedInFlight);
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post(
    '/workspaces/:workspaceId/hosts/:hostId/heartbeat',
    { bodyLimit: HEARTBEAT_BODY_LIMIT, config: { rateLimit: { max: options.rateLimitMax, timeWindow: 60_000 } } },
    async (request): Promise<HeartbeatResponse> => {
      const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
      HeartbeatRequestSchema.parse(request.body ?? {});
      const { lastSeenAt, heartbeatIntervalMs } = await options.recordHeartbeat.execute(machineAuthOf(request), workspaceId, hostId);
      return { lastSeenAt: lastSeenAt.toISOString(), heartbeatIntervalSeconds: heartbeatIntervalMs / 1000 };
    },
  );
};
