import type { FastifyPluginAsync } from 'fastify';
import { AlertListQuerySchema, type AlertResponse, type PaginatedResponse } from '@aegis/contracts';
import type { GetAlert, ListAlerts } from '../../../application/use-cases/alerts/list-alerts.js';
import type { ResolveAuthenticatedUser } from '../../../application/use-cases/resolve-authenticated-user.js';
import { authenticate, currentUserOf } from '../authenticate.js';
import { toAlertResponse, toPaginatedResponse } from '../mappers.js';
import { WorkspaceParamsSchema, paramsOf, resourceParamsSchema } from '../route-params.js';

export interface AlertsRouteOptions {
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly listAlerts: ListAlerts;
  readonly getAlert: GetAlert;
}

const AlertParamsSchema = resourceParamsSchema('alertId');

/** Alerts are produced by the detection engine only: list and read, no create, update or delete route (ADR-053). */
export const alertsRoute: FastifyPluginAsync<AlertsRouteOptions> = async (app, options) => {
  app.addHook('preHandler', authenticate(options.resolveAuthenticatedUser));

  app.get('/workspaces/:workspaceId/alerts', async (request): Promise<PaginatedResponse<AlertResponse>> => {
    const { workspaceId } = paramsOf(WorkspaceParamsSchema, request);
    const query = AlertListQuerySchema.parse(request.query);
    const page = await options.listAlerts.execute(currentUserOf(request), workspaceId, query);
    return toPaginatedResponse(page, toAlertResponse);
  });

  app.get('/workspaces/:workspaceId/alerts/:alertId', async (request): Promise<AlertResponse> => {
    const { workspaceId, alertId } = paramsOf(AlertParamsSchema, request);
    return toAlertResponse(await options.getAlert.execute(currentUserOf(request), workspaceId, alertId));
  });
};
