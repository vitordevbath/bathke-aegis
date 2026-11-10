import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AuthenticationError, MachineAuthenticationError } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { ResolveAuthenticatedUser } from '../../application/use-cases/resolve-authenticated-user.js';
import type { AuthenticateMachine } from '../../application/use-cases/machine-identity/authenticate-machine.js';
import type { MachineAuthContext } from '../../application/machine-auth-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate`; null on public routes. */
    currentUser: User | null;
    /** Set by `authenticateMachine`; null on every route a machine cannot call. */
    machineAuth: MachineAuthContext | null;
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MACHINE_BEARER = /^Bearer (\S{1,256})$/;

/**
 * preHandler for protected routes: requires `Authorization: Bearer <jwt>`,
 * verifies signature/expiry/claims and loads the user it refers to. Any
 * failure is a 401 with the same generic message.
 */
export function authenticate(resolve: ResolveAuthenticatedUser): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new AuthenticationError();
    request.currentUser = await resolve.execute(token);
  };
}

/** The authenticated user of a protected route. */
export function currentUserOf(request: FastifyRequest): User {
  if (!request.currentUser) throw new AuthenticationError();
  return request.currentUser;
}

/**
 * preHandler for machine routes: requires `Authorization: Bearer <machine
 * token>`. A user JWT is not a machine token and is refused like any other bad
 * credential. The audit line carries the reason and, when known, the public
 * credential id: never the header or any part of the secret.
 */
export function authenticateMachine(authenticate: AuthenticateMachine): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = MACHINE_BEARER.exec(request.headers.authorization ?? '')?.[1];
    try {
      request.machineAuth = await authenticate.execute(token ?? '');
    } catch (error) {
      if (error instanceof MachineAuthenticationError) {
        request.log.warn({ audit: 'machine_auth.failed', reason: error.reason, credentialId: error.credentialId }, 'machine authentication failed');
      }
      throw error;
    }
  };
}

/** The authenticated machine of a machine route. */
export function machineAuthOf(request: FastifyRequest): MachineAuthContext {
  if (!request.machineAuth) throw new AuthenticationError();
  return request.machineAuth;
}
