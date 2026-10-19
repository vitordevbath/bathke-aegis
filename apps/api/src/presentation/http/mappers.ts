import type {
  DetectionRuleResponse,
  DetectionRuleSummary,
  HostResponse,
  IncidentResponse,
  IncidentSummary,
  InvestigationResponse,
  InvestigationSummary,
  MeResponse,
  PaginatedResponse,
  UserResponse,
  WorkspaceSummary,
} from '@aegis/contracts';
import type { User } from '../../domain/user.js';
import type { AccountView } from '../../application/account-view.js';
import type { WorkspaceMembership } from '../../application/ports/repositories.js';
import type { Page } from '../../application/pagination.js';
import type { Host } from '../../domain/host.js';
import type { DetectionRule } from '../../domain/detection-rule.js';
import type { DetectionRuleView } from '../../application/use-cases/detection-rules/detection-rule-view.js';
import type { Incident } from '../../domain/incident.js';
import type { IncidentView } from '../../application/use-cases/incidents/incident-view.js';
import type { Investigation } from '../../domain/investigation.js';
import type { InvestigationView } from '../../application/use-cases/investigations/investigation-view.js';

/** Explicit allowlist of public user fields — the password hash can never slip through. */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    cpf: user.cpf,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toWorkspaceSummary({ workspace, membership }: WorkspaceMembership): WorkspaceSummary {
  return { id: workspace.id, name: workspace.name, kind: workspace.kind, role: membership.role };
}

export function toMeResponse(account: AccountView): MeResponse {
  return { user: toUserResponse(account.user), workspaces: account.workspaces.map(toWorkspaceSummary) };
}

export function toHostResponse(host: Host): HostResponse {
  const snapshot = host.toSnapshot();
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    displayName: snapshot.displayName,
    description: snapshot.description,
    agentId: snapshot.agentId,
    hostname: snapshot.hostname,
    osName: snapshot.osName,
    osVersion: snapshot.osVersion,
    architecture: snapshot.architecture,
    connectionState: snapshot.connectionState,
    lastSeenAt: snapshot.lastSeenAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

/** The one place the generic pagination envelope is built. */
export function toPaginatedResponse<T, R>(page: Page<T>, map: (item: T) => R): PaginatedResponse<R> {
  return {
    items: page.items.map(map),
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: Math.ceil(page.total / page.pageSize),
    },
  };
}

export function toDetectionRuleSummary(rule: DetectionRule): DetectionRuleSummary {
  const snapshot = rule.toSnapshot();
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    name: snapshot.name,
    description: snapshot.description,
    severity: snapshot.severity,
    enabled: snapshot.enabled,
    eventCategory: snapshot.eventCategory,
    scope: snapshot.scope,
    targetCount: snapshot.targetHostIds.length,
    conditionCount: snapshot.definition.conditions.length,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export function toDetectionRuleResponse({ rule, targets }: DetectionRuleView): DetectionRuleResponse {
  return {
    ...toDetectionRuleSummary(rule),
    definition: rule.definition,
    targets: targets.map((host) => ({ hostId: host.id, displayName: host.displayName, connectionState: host.connectionState })),
  };
}

export function toIncidentSummary(incident: Incident): IncidentSummary {
  const snapshot = incident.toSnapshot();
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    title: snapshot.title,
    severity: snapshot.severity,
    status: snapshot.status,
    origin: snapshot.origin,
    hostCount: snapshot.hostIds.length,
    ruleCount: snapshot.detectionRuleIds.length,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    resolvedAt: snapshot.resolvedAt?.toISOString() ?? null,
  };
}

export function toIncidentResponse({ incident, hosts, detectionRules }: IncidentView): IncidentResponse {
  return {
    ...toIncidentSummary(incident),
    description: incident.toSnapshot().description,
    hosts: hosts.map((host) => ({ hostId: host.id, displayName: host.displayName, connectionState: host.connectionState })),
    detectionRules: detectionRules.map((rule) => {
      const { id, name, severity, enabled } = rule.toSnapshot();
      return { ruleId: id, name, severity, enabled };
    }),
    availableTransitions: [...incident.availableTransitions],
  };
}

export function toInvestigationSummary(investigation: Investigation): InvestigationSummary {
  const snapshot = investigation.toSnapshot();
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    title: snapshot.title,
    status: snapshot.status,
    incidentCount: snapshot.incidentIds.length,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    closedAt: snapshot.closedAt?.toISOString() ?? null,
  };
}

export function toInvestigationResponse({ investigation, incidents }: InvestigationView): InvestigationResponse {
  const { description, conclusion } = investigation.toSnapshot();
  return {
    ...toInvestigationSummary(investigation),
    description,
    conclusion,
    incidents: incidents.map((incident) => {
      const { id, title, severity, status, origin } = incident.toSnapshot();
      return { incidentId: id, title, severity, status, origin };
    }),
    availableTransitions: [...investigation.availableTransitions],
  };
}
