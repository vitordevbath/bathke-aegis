import type { FastifyPluginAsync } from 'fastify';
import { PairingRejectedError } from '@aegis/domain';
import { PairAgentRequestSchema, type PairAgentResponse } from '@aegis/contracts';
import type { RedeemPairingCode } from '../../../application/use-cases/machine-identity/redeem-pairing-code.js';
import type { PairingThrottle } from '../../../application/pairing-throttle.js';

export interface AgentRouteOptions {
  readonly redeemPairingCode: RedeemPairingCode;
  /** Persistent per-IP limits: requests per minute and refused codes per window (ADR-046). */
  readonly pairingThrottle: PairingThrottle;
}

/** The body is one short code. */
const PAIR_BODY_LIMIT = 1024;

/**
 * Exposed without a user session, so it has its own limits: requests per IP,
 * and refused codes per IP in a window that expires by itself. Both counters
 * live in MySQL, keyed by an HMAC of the address, so a restart or a second
 * instance does not reset them. `request.ip` is the address Nginx appended to
 * X-Forwarded-For (the API trusts exactly one proxy hop); a value a client
 * puts in that header is never used. Every refused code gets the same answer;
 * the audit line has the reason and internal ids, never the code or the response.
 */
export const agentRoute: FastifyPluginAsync<AgentRouteOptions> = async (app, options) => {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post('/agent/pair', { bodyLimit: PAIR_BODY_LIMIT }, async (request, reply) => {
    try {
      await options.pairingThrottle.admit(request.ip);
    } catch (error) {
      request.log.warn({ audit: 'pairing.throttled' }, 'pairing throttled for this address');
      throw error;
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
        const invalidAttemptsInWindow = await options.pairingThrottle.recordRejection(request.ip);
        request.log.warn({ audit: 'pairing.rejected', reason: error.reason, ...error.audit, invalidAttemptsInWindow }, 'pairing rejected');
      }
      throw error;
    }
  });
};
