import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { HostPairingResponse, PairingCodeResponse, RotateCredentialResponse } from '@aegis/contracts';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { RequestPairingCode } from '../../../application/use-cases/machine-identity/request-pairing-code.js';
import type { GetHostPairing } from '../../../application/use-cases/machine-identity/get-host-pairing.js';
import type { RotateMachineCredential } from '../../../application/use-cases/machine-identity/rotate-machine-credential.js';
import type { RevokeMachineCredential } from '../../../application/use-cases/machine-identity/revoke-machine-credential.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toHostPairingResponse, toMachineCredentialResponse } from '../mappers.js';
import { paramsOf, resourceParamsSchema } from '../route-params.js';

export interface HostPairingRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly requestPairingCode: RequestPairingCode;
  readonly getHostPairing: GetHostPairing;
  readonly rotateMachineCredential: RotateMachineCredential;
  readonly revokeMachineCredential: RevokeMachineCredential;
}

const HostParamsSchema = resourceParamsSchema('hostId');
const CredentialParamsSchema = HostParamsSchema.extend({ credentialId: z.string().uuid() });

/**
 * Administration of machine identities: user session only, through the same
 * workspace checks as every other resource. A machine token is never accepted
 * here. Audit lines hold internal ids; codes and tokens exist only in the one
 * response that delivers them, which is marked as not cacheable.
 */
export const hostPairingRoute: FastifyPluginAsync<HostPairingRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post('/workspaces/:workspaceId/hosts/:hostId/pairing-codes', async (request, reply) => {
    const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
    const user = currentUserOf(request);
    const { code, challengeId, expiresAt } = await options.requestPairingCode.execute(user, workspaceId, hostId);
    request.log.info({ audit: 'pairing.code_requested', challengeId, workspaceId, hostId, userId: user.id }, 'pairing code requested');
    const body: PairingCodeResponse = { code, expiresAt: expiresAt.toISOString() };
    return reply.status(201).send(body);
  });

  app.get('/workspaces/:workspaceId/hosts/:hostId/pairing', async (request): Promise<HostPairingResponse> => {
    const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
    return toHostPairingResponse(await options.getHostPairing.execute(currentUserOf(request), workspaceId, hostId));
  });

  app.post('/workspaces/:workspaceId/hosts/:hostId/credentials/:credentialId/rotate', async (request): Promise<RotateCredentialResponse> => {
    const { workspaceId, hostId, credentialId } = paramsOf(CredentialParamsSchema, request);
    const user = currentUserOf(request);
    const { token, credential, previousCredentialId } = await options.rotateMachineCredential.execute(user, workspaceId, hostId, credentialId);
    request.log.info({ audit: 'credential.rotated', credentialId: credential.id, previousCredentialId, workspaceId, hostId, userId: user.id }, 'machine credential rotated');
    return { token, tokenType: 'Bearer', credential: toMachineCredentialResponse(credential) };
  });

  app.delete('/workspaces/:workspaceId/hosts/:hostId/credentials/:credentialId', async (request, reply) => {
    const { workspaceId, hostId, credentialId } = paramsOf(CredentialParamsSchema, request);
    const user = currentUserOf(request);
    const { revoked } = await options.revokeMachineCredential.execute(user, workspaceId, hostId, credentialId);
    if (revoked) request.log.info({ audit: 'credential.revoked', credentialId, workspaceId, hostId, userId: user.id }, 'machine credential revoked');
    return reply.status(204).send();
  });
};
