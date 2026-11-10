import type { Env } from './shared/env.js';
import type { AppDependencies } from './presentation/http/app.js';
import type { PasswordHasher } from './application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from './application/ports/repositories.js';
import type { TokenService } from './application/ports/token-service.js';
import type { MachineSecrets } from './application/ports/machine-secrets.js';
import { RegisterUser } from './application/use-cases/register-user.js';
import { AuthenticateUser } from './application/use-cases/authenticate-user.js';
import { ResolveAuthenticatedUser } from './application/use-cases/resolve-authenticated-user.js';
import { GetCurrentUser } from './application/use-cases/get-current-user.js';
import { UpdateCurrentUser } from './application/use-cases/update-current-user.js';
import { WorkspaceAccess } from './application/workspace-access.js';
import { CreateHost } from './application/use-cases/hosts/create-host.js';
import { ListHosts } from './application/use-cases/hosts/list-hosts.js';
import { GetHost } from './application/use-cases/hosts/get-host.js';
import { UpdateHost } from './application/use-cases/hosts/update-host.js';
import { DeleteHost } from './application/use-cases/hosts/delete-host.js';
import { CreateDetectionRule } from './application/use-cases/detection-rules/create-detection-rule.js';
import { ListDetectionRules } from './application/use-cases/detection-rules/list-detection-rules.js';
import { GetDetectionRule } from './application/use-cases/detection-rules/get-detection-rule.js';
import { UpdateDetectionRule } from './application/use-cases/detection-rules/update-detection-rule.js';
import { DeleteDetectionRule } from './application/use-cases/detection-rules/delete-detection-rule.js';
import { CreateIncident } from './application/use-cases/incidents/create-incident.js';
import { ListIncidents } from './application/use-cases/incidents/list-incidents.js';
import { GetIncident } from './application/use-cases/incidents/get-incident.js';
import { UpdateIncident } from './application/use-cases/incidents/update-incident.js';
import { DeleteIncident } from './application/use-cases/incidents/delete-incident.js';
import { CreateInvestigation } from './application/use-cases/investigations/create-investigation.js';
import { ListInvestigations } from './application/use-cases/investigations/list-investigations.js';
import { GetInvestigation } from './application/use-cases/investigations/get-investigation.js';
import { UpdateInvestigation } from './application/use-cases/investigations/update-investigation.js';
import { DeleteInvestigation } from './application/use-cases/investigations/delete-investigation.js';
import { EventIngestionService } from './application/event-ingestion-service.js';
import { IngestEventsAsMachine } from './application/use-cases/events/ingest-events.js';
import { ListEvents } from './application/use-cases/events/list-events.js';
import { GetEvent } from './application/use-cases/events/get-event.js';
import { RequestPairingCode } from './application/use-cases/machine-identity/request-pairing-code.js';
import { RedeemPairingCode } from './application/use-cases/machine-identity/redeem-pairing-code.js';
import { AuthenticateMachine } from './application/use-cases/machine-identity/authenticate-machine.js';
import { RotateMachineCredential } from './application/use-cases/machine-identity/rotate-machine-credential.js';
import { RevokeMachineCredential } from './application/use-cases/machine-identity/revoke-machine-credential.js';
import { GetHostPairing } from './application/use-cases/machine-identity/get-host-pairing.js';
import { createDatabase } from './infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from './infrastructure/db/drizzle-repositories.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { JoseTokenService } from './infrastructure/security/jose-token-service.js';
import { NodeMachineSecrets } from './infrastructure/security/node-machine-secrets.js';

export interface Adapters {
  readonly repositories: Repositories;
  readonly unitOfWork: UnitOfWork;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly secrets: MachineSecrets;
}

/** Abuse limits of the machine pairing flow (ADR-038). All are per time window; none is permanent. */
export interface PairingLimits {
  /** Requests per client IP per minute on `POST /agent/pair`. */
  readonly pairRateLimitMax: number;
  /** Refused codes per client IP per window before that IP is paused. */
  readonly invalidAttemptsMax: number;
  readonly invalidAttemptsWindowMs: number;
  /** Codes an OWNER may request for one host per hour. */
  readonly codesPerHostPerHour: number;
}

export const DEFAULT_PAIRING_LIMITS: PairingLimits = {
  pairRateLimitMax: 10,
  invalidAttemptsMax: 20,
  invalidAttemptsWindowMs: 15 * 60_000,
  codesPerHostPerHour: 10,
};

/** Wires use cases to whichever adapters are given (production or test doubles). */
export function createUseCases(adapters: Adapters, authRateLimitMax: number, ingestRateLimitMax = 60, pairing: PairingLimits = DEFAULT_PAIRING_LIMITS): AppDependencies {
  const { repositories, unitOfWork, hasher, tokens, secrets } = adapters;
  const access = new WorkspaceAccess(repositories.memberships);
  return {
    registerUser: new RegisterUser(repositories, unitOfWork, hasher),
    authenticateUser: new AuthenticateUser(repositories, hasher, tokens),
    resolveAuthenticatedUser: new ResolveAuthenticatedUser(tokens, repositories.users),
    getCurrentUser: new GetCurrentUser(repositories.memberships),
    updateCurrentUser: new UpdateCurrentUser(repositories, hasher),
    createHost: new CreateHost(access, repositories.hosts),
    listHosts: new ListHosts(access, repositories.hosts),
    getHost: new GetHost(access, repositories.hosts),
    updateHost: new UpdateHost(access, repositories.hosts),
    deleteHost: new DeleteHost(access, repositories.hosts, repositories.detectionRules, repositories.incidents, repositories.events, repositories.machineCredentials),
    createDetectionRule: new CreateDetectionRule(access, unitOfWork),
    listDetectionRules: new ListDetectionRules(access, repositories.detectionRules),
    getDetectionRule: new GetDetectionRule(access, repositories.detectionRules, repositories.hosts),
    updateDetectionRule: new UpdateDetectionRule(access, unitOfWork),
    deleteDetectionRule: new DeleteDetectionRule(access, repositories.detectionRules, repositories.incidents),
    createIncident: new CreateIncident(access, unitOfWork),
    listIncidents: new ListIncidents(access, repositories.incidents),
    getIncident: new GetIncident(access, repositories),
    updateIncident: new UpdateIncident(access, unitOfWork),
    deleteIncident: new DeleteIncident(access, repositories.incidents, repositories.investigations),
    createInvestigation: new CreateInvestigation(access, unitOfWork),
    listInvestigations: new ListInvestigations(access, repositories.investigations),
    getInvestigation: new GetInvestigation(access, repositories),
    updateInvestigation: new UpdateInvestigation(access, unitOfWork),
    deleteInvestigation: new DeleteInvestigation(access, repositories.investigations),
    ingestEvents: new IngestEventsAsMachine(new EventIngestionService(unitOfWork)),
    listEvents: new ListEvents(access, repositories.events),
    getEvent: new GetEvent(access, repositories.events),
    requestPairingCode: new RequestPairingCode(access, unitOfWork, secrets, pairing.codesPerHostPerHour),
    redeemPairingCode: new RedeemPairingCode(unitOfWork, secrets),
    authenticateMachine: new AuthenticateMachine(repositories.machineCredentials, secrets),
    rotateMachineCredential: new RotateMachineCredential(access, unitOfWork, secrets),
    revokeMachineCredential: new RevokeMachineCredential(access, unitOfWork),
    getHostPairing: new GetHostPairing(access, repositories.hosts, repositories.pairingChallenges, repositories.machineCredentials),
    authRateLimitMax,
    ingestRateLimitMax,
    pairRateLimitMax: pairing.pairRateLimitMax,
    pairInvalidAttemptsMax: pairing.invalidAttemptsMax,
    pairInvalidAttemptsWindowMs: pairing.invalidAttemptsWindowMs,
  };
}

/** Production wiring: MySQL via Drizzle, Argon2id, HS256 JWT. */
export function createProductionDependencies(env: Env): { dependencies: AppDependencies; close: () => Promise<void> } {
  const { db, close } = createDatabase(env.DATABASE_URL);
  const adapters: Adapters = {
    repositories: createDrizzleRepositories(db),
    unitOfWork: new DrizzleUnitOfWork(db),
    hasher: new Argon2PasswordHasher(),
    tokens: new JoseTokenService({ secret: env.JWT_SECRET, ttlSeconds: env.JWT_TTL_SECONDS }),
    secrets: new NodeMachineSecrets(),
  };
  const pairing: PairingLimits = {
    pairRateLimitMax: env.PAIR_RATE_LIMIT_MAX,
    invalidAttemptsMax: env.PAIR_INVALID_ATTEMPTS_MAX,
    invalidAttemptsWindowMs: env.PAIR_INVALID_ATTEMPTS_WINDOW_SECONDS * 1000,
    codesPerHostPerHour: env.PAIR_CODES_PER_HOST_PER_HOUR,
  };
  return { dependencies: createUseCases(adapters, env.AUTH_RATE_LIMIT_MAX, env.INGEST_RATE_LIMIT_MAX, pairing), close };
}
