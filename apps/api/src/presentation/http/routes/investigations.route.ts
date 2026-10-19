import type { FastifyPluginAsync } from 'fastify';
import {
  CreateInvestigationRequestSchema,
  InvestigationListQuerySchema,
  UpdateInvestigationRequestSchema,
  type InvestigationResponse,
  type InvestigationSummary,
  type PaginatedResponse,
} from '@aegis/contracts';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { CreateInvestigation } from '../../../application/use-cases/investigations/create-investigation.js';
import type { ListInvestigations } from '../../../application/use-cases/investigations/list-investigations.js';
import type { GetInvestigation } from '../../../application/use-cases/investigations/get-investigation.js';
import type { UpdateInvestigation } from '../../../application/use-cases/investigations/update-investigation.js';
import type { DeleteInvestigation } from '../../../application/use-cases/investigations/delete-investigation.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toInvestigationResponse, toInvestigationSummary, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface InvestigationsRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly createInvestigation: CreateInvestigation;
  readonly listInvestigations: ListInvestigations;
  readonly getInvestigation: GetInvestigation;
  readonly updateInvestigation: UpdateInvestigation;
  readonly deleteInvestigation: DeleteInvestigation;
}

const InvestigationParamsSchema = resourceParamsSchema('investigationId');

/** Human investigations grouping incidents. The conclusion is always written by a person. */
export const investigationsRoute: FastifyPluginAsync<InvestigationsRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.post('/workspaces/:workspaceId/investigations', async (request, reply) => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const { title, description, incidentIds } = CreateInvestigationRequestSchema.parse(request.body);
    const view = await options.createInvestigation.execute(currentUserOf(request), workspaceId, { title, description, incidentIds });
    const body: InvestigationResponse = toInvestigationResponse(view);
    return reply.status(201).send(body);
  });

  app.get('/workspaces/:workspaceId/investigations', async (request): Promise<PaginatedResponse<InvestigationSummary>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = InvestigationListQuerySchema.parse(request.query);
    const page = await options.listInvestigations.execute(currentUserOf(request), workspaceId, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
      status: query.status,
    });
    return toPaginatedResponse(page, toInvestigationSummary);
  });

  app.get('/workspaces/:workspaceId/investigations/:investigationId', async (request): Promise<InvestigationResponse> => {
    const { workspaceId, investigationId } = paramsOf(InvestigationParamsSchema, request);
    return toInvestigationResponse(await options.getInvestigation.execute(currentUserOf(request), workspaceId, investigationId));
  });

  app.put('/workspaces/:workspaceId/investigations/:investigationId', async (request): Promise<InvestigationResponse> => {
    const { workspaceId, investigationId } = paramsOf(InvestigationParamsSchema, request);
    const { status, ...details } = UpdateInvestigationRequestSchema.parse(request.body);
    const view = await options.updateInvestigation.execute(currentUserOf(request), workspaceId, investigationId, details, status);
    return toInvestigationResponse(view);
  });

  app.delete('/workspaces/:workspaceId/investigations/:investigationId', async (request, reply) => {
    const { workspaceId, investigationId } = paramsOf(InvestigationParamsSchema, request);
    await options.deleteInvestigation.execute(currentUserOf(request), workspaceId, investigationId);
    return reply.status(204).send();
  });
};
