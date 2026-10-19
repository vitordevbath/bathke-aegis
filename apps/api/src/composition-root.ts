import type { Env } from './shared/env.js';
import type { AppDependencies } from './presentation/http/app.js';
import type { PasswordHasher } from './application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from './application/ports/repositories.js';
import type { TokenService } from './application/ports/token-service.js';
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
import { createDatabase } from './infrastructure/db/client.js';
import { DrizzleUnitOfWork, createDrizzleRepositories } from './infrastructure/db/drizzle-repositories.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { JoseTokenService } from './infrastructure/security/jose-token-service.js';

export interface Adapters {
  readonly repositories: Repositories;
  readonly unitOfWork: UnitOfWork;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
}

/** Wires use cases to whichever adapters are given (production or test doubles). */
export function createUseCases(adapters: Adapters, authRateLimitMax: number): AppDependencies {
  const { repositories, unitOfWork, hasher, tokens } = adapters;
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
    deleteHost: new DeleteHost(access, repositories.hosts, repositories.detectionRules, repositories.incidents),
    createDetectionRule: new CreateDetectionRule(access, unitOfWork),
    listDetectionRules: new ListDetectionRules(access, repositories.detectionRules),
    getDetectionRule: new GetDetectionRule(access, repositories.detectionRules, repositories.hosts),
    updateDetectionRule: new UpdateDetectionRule(access, unitOfWork),
    deleteDetectionRule: new DeleteDetectionRule(access, repositories.detectionRules, repositories.incidents),
    createIncident: new CreateIncident(access, unitOfWork),
    listIncidents: new ListIncidents(access, repositories.incidents),
    getIncident: new GetIncident(access, repositories),
    updateIncident: new UpdateIncident(access, unitOfWork),
    deleteIncident: new DeleteIncident(access, repositories.incidents),
    authRateLimitMax,
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
  };
  return { dependencies: createUseCases(adapters, env.AUTH_RATE_LIMIT_MAX), close };
}
