import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { RegisterUser } from '../../application/use-cases/register-user.js';
import type { AuthenticateUser } from '../../application/use-cases/authenticate-user.js';
import type { ResolveAuthenticatedUser } from '../../application/use-cases/resolve-authenticated-user.js';
import type { GetCurrentUser } from '../../application/use-cases/get-current-user.js';
import type { UpdateCurrentUser } from '../../application/use-cases/update-current-user.js';
import type { CreateHost } from '../../application/use-cases/hosts/create-host.js';
import type { ListHosts } from '../../application/use-cases/hosts/list-hosts.js';
import type { GetHost } from '../../application/use-cases/hosts/get-host.js';
import type { UpdateHost } from '../../application/use-cases/hosts/update-host.js';
import type { DeleteHost } from '../../application/use-cases/hosts/delete-host.js';
import type { CreateDetectionRule } from '../../application/use-cases/detection-rules/create-detection-rule.js';
import type { ListDetectionRules } from '../../application/use-cases/detection-rules/list-detection-rules.js';
import type { GetDetectionRule } from '../../application/use-cases/detection-rules/get-detection-rule.js';
import type { UpdateDetectionRule } from '../../application/use-cases/detection-rules/update-detection-rule.js';
import type { DeleteDetectionRule } from '../../application/use-cases/detection-rules/delete-detection-rule.js';
import type { CreateIncident } from '../../application/use-cases/incidents/create-incident.js';
import type { ListIncidents } from '../../application/use-cases/incidents/list-incidents.js';
import type { GetIncident } from '../../application/use-cases/incidents/get-incident.js';
import type { UpdateIncident } from '../../application/use-cases/incidents/update-incident.js';
import type { DeleteIncident } from '../../application/use-cases/incidents/delete-incident.js';
import type { CreateInvestigation } from '../../application/use-cases/investigations/create-investigation.js';
import type { ListInvestigations } from '../../application/use-cases/investigations/list-investigations.js';
import type { GetInvestigation } from '../../application/use-cases/investigations/get-investigation.js';
import type { UpdateInvestigation } from '../../application/use-cases/investigations/update-investigation.js';
import type { DeleteInvestigation } from '../../application/use-cases/investigations/delete-investigation.js';
import type { IngestEventsAsUser } from '../../application/use-cases/events/ingest-events.js';
import type { ListEvents } from '../../application/use-cases/events/list-events.js';
import type { GetEvent } from '../../application/use-cases/events/get-event.js';
import { errorHandler } from './error-handler.js';
import { healthRoute } from './routes/health.route.js';
import { authRoute } from './routes/auth.route.js';
import { usersRoute } from './routes/users.route.js';
import { hostsRoute } from './routes/hosts.route.js';
import { detectionRulesRoute } from './routes/detection-rules.route.js';
import { incidentsRoute } from './routes/incidents.route.js';
import { investigationsRoute } from './routes/investigations.route.js';
import { eventsRoute } from './routes/events.route.js';

/** Use cases the HTTP layer delegates to. Assembled by the composition root (or by tests). */
export interface AppDependencies {
  readonly registerUser: RegisterUser;
  readonly authenticateUser: AuthenticateUser;
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly getCurrentUser: GetCurrentUser;
  readonly updateCurrentUser: UpdateCurrentUser;
  readonly createHost: CreateHost;
  readonly listHosts: ListHosts;
  readonly getHost: GetHost;
  readonly updateHost: UpdateHost;
  readonly deleteHost: DeleteHost;
  readonly createDetectionRule: CreateDetectionRule;
  readonly listDetectionRules: ListDetectionRules;
  readonly getDetectionRule: GetDetectionRule;
  readonly updateDetectionRule: UpdateDetectionRule;
  readonly deleteDetectionRule: DeleteDetectionRule;
  readonly createIncident: CreateIncident;
  readonly listIncidents: ListIncidents;
  readonly getIncident: GetIncident;
  readonly updateIncident: UpdateIncident;
  readonly deleteIncident: DeleteIncident;
  readonly createInvestigation: CreateInvestigation;
  readonly listInvestigations: ListInvestigations;
  readonly getInvestigation: GetInvestigation;
  readonly updateInvestigation: UpdateInvestigation;
  readonly deleteInvestigation: DeleteInvestigation;
  readonly ingestEvents: IngestEventsAsUser;
  readonly listEvents: ListEvents;
  readonly getEvent: GetEvent;
  /** Requests per client IP per minute on each auth route. */
  readonly authRateLimitMax: number;
  /** Event ingestion batches per client IP per minute (user-auth lab route). */
  readonly ingestRateLimitMax: number;
}

/** Builds the HTTP application without binding a port, so tests can use `inject`. */
export async function buildApp(dependencies: AppDependencies, options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }));
  app.decorateRequest('currentUser', null);

  // In-memory, per-route limits only (opt-in via route config). Enough for a single API instance.
  await app.register(rateLimit, { global: false });

  await app.register(healthRoute);
  await app.register(authRoute, {
    registerUser: dependencies.registerUser,
    authenticateUser: dependencies.authenticateUser,
    rateLimitMax: dependencies.authRateLimitMax,
  });
  await app.register(usersRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    getCurrentUser: dependencies.getCurrentUser,
    updateCurrentUser: dependencies.updateCurrentUser,
  });
  await app.register(hostsRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    createHost: dependencies.createHost,
    listHosts: dependencies.listHosts,
    getHost: dependencies.getHost,
    updateHost: dependencies.updateHost,
    deleteHost: dependencies.deleteHost,
  });
  await app.register(detectionRulesRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    createDetectionRule: dependencies.createDetectionRule,
    listDetectionRules: dependencies.listDetectionRules,
    getDetectionRule: dependencies.getDetectionRule,
    updateDetectionRule: dependencies.updateDetectionRule,
    deleteDetectionRule: dependencies.deleteDetectionRule,
  });
  await app.register(incidentsRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    createIncident: dependencies.createIncident,
    listIncidents: dependencies.listIncidents,
    getIncident: dependencies.getIncident,
    updateIncident: dependencies.updateIncident,
    deleteIncident: dependencies.deleteIncident,
  });
  await app.register(investigationsRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    createInvestigation: dependencies.createInvestigation,
    listInvestigations: dependencies.listInvestigations,
    getInvestigation: dependencies.getInvestigation,
    updateInvestigation: dependencies.updateInvestigation,
    deleteInvestigation: dependencies.deleteInvestigation,
  });
  await app.register(eventsRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    ingestEvents: dependencies.ingestEvents,
    listEvents: dependencies.listEvents,
    getEvent: dependencies.getEvent,
    ingestRateLimitMax: dependencies.ingestRateLimitMax,
  });

  return app;
}
