import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateIncidentRequest,
  IncidentOrigin,
  IncidentResponse,
  IncidentSeverity,
  IncidentStatus,
  IncidentSummary,
  PaginatedResponse,
  UpdateIncidentRequest,
} from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';
import { hostKeys } from '../hosts/hosts-api';
import { ruleKeys } from '../rules/rules-api';
import { investigationKeys } from '../investigations/investigations-api';

export interface IncidentListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string | undefined;
  readonly severity?: IncidentSeverity | undefined;
  readonly status?: IncidentStatus | undefined;
  readonly origin?: IncidentOrigin | undefined;
}

export const incidentKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'incidents'] as const,
  list: (workspaceId: string, params: IncidentListParams) => [...incidentKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, incidentId: string) => [...incidentKeys.all(workspaceId), 'detail', incidentId] as const,
};

const incidentsPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/incidents`;
const incidentPath = (workspaceId: string, incidentId: string) => `${incidentsPath(workspaceId)}/${encodeURIComponent(incidentId)}`;

export function useIncidentList(workspaceId: string | undefined, params: IncidentListParams) {
  return useQuery({
    queryKey: incidentKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.q) search.set('q', params.q);
      if (params.severity) search.set('severity', params.severity);
      if (params.status) search.set('status', params.status);
      if (params.origin) search.set('origin', params.origin);
      return apiRequest<PaginatedResponse<IncidentSummary>>(`${incidentsPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useIncident(workspaceId: string | undefined, incidentId: string | undefined) {
  return useQuery({
    queryKey: incidentKeys.detail(workspaceId ?? '', incidentId ?? ''),
    queryFn: () => apiRequest<IncidentResponse>(incidentPath(workspaceId ?? '', incidentId ?? '')),
    enabled: Boolean(workspaceId && incidentId),
    retry: false,
  });
}

/**
 * Incidents reference hosts and rules (whose deletion they may block), and
 * investigations show each incident's title and status: refresh them all after writes.
 */
function useInvalidateIncidents(workspaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...incidentKeys.all(workspaceId), 'list'] }),
      queryClient.invalidateQueries({ queryKey: hostKeys.all(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: ruleKeys.all(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: investigationKeys.all(workspaceId) }),
    ]);
}

export function useCreateIncident(workspaceId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIncidents(workspaceId);
  return useMutation({
    mutationFn: (body: CreateIncidentRequest) => apiRequest<IncidentResponse>(incidentsPath(workspaceId), { method: 'POST', body }),
    onSuccess: (incident) => {
      queryClient.setQueryData(incidentKeys.detail(workspaceId, incident.id), incident);
      return invalidate();
    },
  });
}

/** Edits and lifecycle changes share PUT; the server decides whether a transition is allowed. */
export function useUpdateIncident(workspaceId: string, incidentId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIncidents(workspaceId);
  return useMutation({
    mutationFn: (body: UpdateIncidentRequest) => apiRequest<IncidentResponse>(incidentPath(workspaceId, incidentId), { method: 'PUT', body }),
    onSuccess: (incident) => {
      queryClient.setQueryData(incidentKeys.detail(workspaceId, incidentId), incident);
      return invalidate();
    },
  });
}

export function useDeleteIncident(workspaceId: string, incidentId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIncidents(workspaceId);
  return useMutation({
    mutationFn: () => apiRequest<void>(incidentPath(workspaceId, incidentId), { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: incidentKeys.detail(workspaceId, incidentId) });
      return invalidate();
    },
  });
}

/** PUT body that keeps the stored incident and asks for a new status — used by the lifecycle buttons. */
export function toStatusRequest(incident: IncidentResponse, status: IncidentStatus): UpdateIncidentRequest {
  return {
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    hostIds: incident.hosts.map((host) => host.hostId),
    detectionRuleIds: incident.detectionRules.map((rule) => rule.ruleId),
    status,
  };
}
