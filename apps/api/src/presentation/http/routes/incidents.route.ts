import type { FastifyPluginAsync } from 'fastify';
import {
  CreateIncidentRequestSchema,
  IncidentListQuerySchema,
  UpdateIncidentRequestSchema,
  type CreateIncidentCommand,
  type IncidentResponse,
  type IncidentSummary,
  type PaginatedResponse,
} from '@aegis/contracts';
import type { IncidentDetails } from '../../../domain/incident.js';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import type { CreateIncident } from '../../../application/use-cases/incidents/create-incident.js';
import type { ListIncidents } from '../../../application/use-cases/incidents/list-incidents.js';
import type { GetIncident } from '../../../application/use-cases/incidents/get-incident.js';
import type { UpdateIncident } from '../../../application/use-cases/incidents/update-incident.js';
import type { DeleteIncident } from '../../../application/use-cases/incidents/delete-incident.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toIncidentResponse, toIncidentSummary, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface IncidentsRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly createIncident: CreateIncident;
  readonly listIncidents: ListIncidents;
  readonly getIncident: GetIncident;
  readonly updateIncident: UpdateIncident;
  readonly deleteIncident: DeleteIncident;
}

const IncidentParamsSchema = resourceParamsSchema('incidentId');

const toDetails = (command: CreateIncidentCommand): IncidentDetails => ({
  title: command.title,
  description: command.description,
  severity: command.severity,
  hostIds: command.hostIds,
  detectionRuleIds: command.detectionRuleIds,
});

/** Manual incidents: nothing here creates incidents automatically or executes rules. */
export const incidentsRoute: FastifyPluginAsync<IncidentsRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.post('/workspaces/:workspaceId/incidents', async (request, reply) => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const command = CreateIncidentRequestSchema.parse(request.body);
    const body: IncidentResponse = toIncidentResponse(await options.createIncident.execute(currentUserOf(request), workspaceId, toDetails(command)));
    return reply.status(201).send(body);
  });

  app.get('/workspaces/:workspaceId/incidents', async (request): Promise<PaginatedResponse<IncidentSummary>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = IncidentListQuerySchema.parse(request.query);
    const page = await options.listIncidents.execute(currentUserOf(request), workspaceId, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.q,
      severity: query.severity,
      status: query.status,
      origin: query.origin,
    });
    return toPaginatedResponse(page, toIncidentSummary);
  });

  app.get('/workspaces/:workspaceId/incidents/:incidentId', async (request): Promise<IncidentResponse> => {
    const { workspaceId, incidentId } = paramsOf(IncidentParamsSchema, request);
    return toIncidentResponse(await options.getIncident.execute(currentUserOf(request), workspaceId, incidentId));
  });

  app.put('/workspaces/:workspaceId/incidents/:incidentId', async (request): Promise<IncidentResponse> => {
    const { workspaceId, incidentId } = paramsOf(IncidentParamsSchema, request);
    const command = UpdateIncidentRequestSchema.parse(request.body);
    const view = await options.updateIncident.execute(currentUserOf(request), workspaceId, incidentId, toDetails(command), command.status);
    return toIncidentResponse(view);
  });

  app.delete('/workspaces/:workspaceId/incidents/:incidentId', async (request, reply) => {
    const { workspaceId, incidentId } = paramsOf(IncidentParamsSchema, request);
    await options.deleteIncident.execute(currentUserOf(request), workspaceId, incidentId);
    return reply.status(204).send();
  });
};
