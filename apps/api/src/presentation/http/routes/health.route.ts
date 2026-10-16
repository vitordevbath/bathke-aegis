import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@aegis/contracts';

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'aegis-api',
  }));
};
