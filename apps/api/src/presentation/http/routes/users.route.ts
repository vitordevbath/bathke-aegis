import type { FastifyPluginAsync } from 'fastify';
import { UpdateCurrentUserRequestSchema, type MeResponse } from '@aegis/contracts';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { GetCurrentUser } from '../../../application/use-cases/get-current-user.js';
import type { UpdateCurrentUser } from '../../../application/use-cases/update-current-user.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toMeResponse } from '../mappers.js';

export interface UsersRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly getCurrentUser: GetCurrentUser;
  readonly updateCurrentUser: UpdateCurrentUser;
}

/**
 * Self-service user routes. There is intentionally no `/users/:id`: the
 * target is always the user resolved from the bearer token.
 */
export const usersRoute: FastifyPluginAsync<UsersRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/users/me', async (request): Promise<MeResponse> => {
    return toMeResponse(await options.getCurrentUser.execute(currentUserOf(request)));
  });

  app.put('/users/me', async (request): Promise<MeResponse> => {
    const command = UpdateCurrentUserRequestSchema.parse(request.body);
    return toMeResponse(await options.updateCurrentUser.execute(currentUserOf(request), command));
  });
};
