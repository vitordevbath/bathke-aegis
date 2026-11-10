import type { FastifyPluginAsync } from 'fastify';
import { PairingRejectedError, TooManyRequestsError } from '@aegis/domain';
import { PairAgentRequestSchema, type PairAgentResponse } from '@aegis/contracts';
import type { RedeemPairingCode } from '../../../application/use-cases/machine-identity/redeem-pairing-code.js';
import { AttemptWindow } from '../attempt-window.js';

export interface AgentRouteOptions {
  readonly redeemPairingCode: RedeemPairingCode;
  /** Requests per client IP per minute. */
  readonly rateLimitMax: number;
  /** Refused codes per client IP per window before that IP is paused. */
  readonly invalidAttemptsMax: number;
  readonly invalidAttemptsWindowMs: number;
}

/** The body is one short code. */
const PAIR_BODY_LIMIT = 1024;
const TOO_MANY_INVALID_MESSAGE = 'Muitas tentativas inválidas. Aguarde e tente novamente.';

/**
 * Exposed without a user session, so it has its own limits: requests per IP,
 * and refused codes per IP in a window that expires by itself. Every refused
 * code gets the same answer; the audit line has the reason and internal ids,
 * never the code or the response.
 */
export const agentRoute: FastifyPluginAsync<AgentRouteOptions> = async (app, options) => {
  const invalidAttempts = new AttemptWindow(options.invalidAttemptsMax, options.invalidAttemptsWindowMs);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post(
    '/agent/pair',
    { bodyLimit: PAIR_BODY_LIMIT, config: { rateLimit: { max: options.rateLimitMax, timeWindow: 60_000 } } },
    async (request, reply) => {
      if (invalidAttempts.isExhausted(request.ip)) {
        request.log.warn({ audit: 'pairing.paused' }, 'pairing paused for this address');
        throw new TooManyRequestsError(TOO_MANY_INVALID_MESSAGE);
      }
      const { code } = PairAgentRequestSchema.parse(request.body);
      try {
        const { token, credential, challengeId } = await options.redeemPairingCode.execute(code);
        request.log.info({ audit: 'pairing.completed', challengeId, credentialId: credential.id, workspaceId: credential.workspaceId, hostId: credential.hostId }, 'host paired');
        const body: PairAgentResponse = {
          token,
          tokenType: 'Bearer',
          credentialId: credential.id,
          workspaceId: credential.workspaceId,
          hostId: credential.hostId,
          scopes: [...credential.scopes],
        };
        return await reply.status(201).send(body);
      } catch (error) {
        if (error instanceof PairingRejectedError) {
          const invalidAttemptsInWindow = invalidAttempts.record(request.ip);
          request.log.warn({ audit: 'pairing.rejected', reason: error.reason, ...error.audit, invalidAttemptsInWindow }, 'pairing rejected');
        }
        throw error;
      }
    },
  );
};
