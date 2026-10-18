import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AuthenticationError } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { ResolveAuthenticatedUser } from '../../application/use-cases/resolve-authenticated-user.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate`; null on public routes. */
    currentUser: User | null;
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

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
