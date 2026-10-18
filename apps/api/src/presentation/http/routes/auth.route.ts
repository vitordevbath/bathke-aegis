import type { FastifyPluginAsync } from 'fastify';
import { LoginRequestSchema, RegisterRequestSchema, type LoginResponse, type RegisterResponse } from '@aegis/contracts';
import type { RegisterUser } from '../../../application/use-cases/register-user.js';
import type { AuthenticateUser } from '../../../application/use-cases/authenticate-user.js';
import { toMeResponse } from '../mappers.js';

export interface AuthRouteOptions {
  readonly registerUser: RegisterUser;
  readonly authenticateUser: AuthenticateUser;
  /** Requests per client IP per minute, per route. */
  readonly rateLimitMax: number;
}

export const authRoute: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  const config = { rateLimit: { max: options.rateLimitMax, timeWindow: 60_000 } };

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post('/auth/register', { config }, async (request, reply) => {
    const command = RegisterRequestSchema.parse(request.body);
    const account = await options.registerUser.execute(command);
    const body: RegisterResponse = toMeResponse(account);
    return reply.status(201).send(body);
  });

  app.post('/auth/login', { config }, async (request): Promise<LoginResponse> => {
    const credentials = LoginRequestSchema.parse(request.body);
    const session = await options.authenticateUser.execute(credentials);
    return { token: session.token, tokenType: 'Bearer', expiresIn: session.expiresIn, ...toMeResponse(session) };
  });
};
