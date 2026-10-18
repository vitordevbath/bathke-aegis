import type { FastifyPluginAsync } from 'fastify';
import {
  CreateHostRequestSchema,
  HostListQuerySchema,
  UpdateHostRequestSchema,
  type HostResponse,
  type PaginatedResponse,
} from '@aegis/contracts';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { CreateHost } from '../../../application/use-cases/hosts/create-host.js';
import type { ListHosts } from '../../../application/use-cases/hosts/list-hosts.js';
import type { GetHost } from '../../../application/use-cases/hosts/get-host.js';
import type { UpdateHost } from '../../../application/use-cases/hosts/update-host.js';
import type { DeleteHost } from '../../../application/use-cases/hosts/delete-host.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toHostResponse, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface HostsRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly createHost: CreateHost;
  readonly listHosts: ListHosts;
  readonly getHost: GetHost;
  readonly updateHost: UpdateHost;
  readonly deleteHost: DeleteHost;
}

const HostParamsSchema = resourceParamsSchema('hostId');

/**
 * Hosts are always addressed through their workspace. Every route is
 * authenticated, and membership is checked by the use cases before any
 * lookup, so other tenants' hosts answer 404.
 */
export const hostsRoute: FastifyPluginAsync<HostsRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.post('/workspaces/:workspaceId/hosts', async (request, reply) => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const command = CreateHostRequestSchema.parse(request.body);
    const host = await options.createHost.execute(currentUserOf(request), workspaceId, command);
    const body: HostResponse = toHostResponse(host);
    return reply.status(201).send(body);
  });

  app.get('/workspaces/:workspaceId/hosts', async (request): Promise<PaginatedResponse<HostResponse>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = HostListQuerySchema.parse(request.query);
    const page = await options.listHosts.execute(currentUserOf(request), workspaceId, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
    });
    return toPaginatedResponse(page, toHostResponse);
  });

  app.get('/workspaces/:workspaceId/hosts/:hostId', async (request): Promise<HostResponse> => {
    const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
    return toHostResponse(await options.getHost.execute(currentUserOf(request), workspaceId, hostId));
  });

  app.put('/workspaces/:workspaceId/hosts/:hostId', async (request): Promise<HostResponse> => {
    const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
    const command = UpdateHostRequestSchema.parse(request.body);
    return toHostResponse(await options.updateHost.execute(currentUserOf(request), workspaceId, hostId, command));
  });

  app.delete('/workspaces/:workspaceId/hosts/:hostId', async (request, reply) => {
    const { workspaceId, hostId } = paramsOf(HostParamsSchema, request);
    await options.deleteHost.execute(currentUserOf(request), workspaceId, hostId);
    return reply.status(204).send();
  });
};
