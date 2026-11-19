import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AlertResponse, PaginatedResponse } from '@aegis/contracts';
import type { Severity } from '@aegis/domain';
import { apiRequest } from '../../lib/api-client';

export interface AlertListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly severity?: Severity | undefined;
  readonly ruleId?: string | undefined;
  readonly hostId?: string | undefined;
  readonly incidentId?: string | undefined;
}

export const alertKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'alerts'] as const,
  list: (workspaceId: string, params: AlertListParams) => [...alertKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, alertId: string) => [...alertKeys.all(workspaceId), 'detail', alertId] as const,
};

const alertsPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/alerts`;

/** Read-only: alerts come from the detection engine only (ADR-053). */
export function useAlertList(workspaceId: string | undefined, params: AlertListParams, options: { readonly refetchInterval?: number } = {}) {
  return useQuery({
    ...options,
    queryKey: alertKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.severity) search.set('severity', params.severity);
      if (params.ruleId) search.set('ruleId', params.ruleId);
      if (params.hostId) search.set('hostId', params.hostId);
      if (params.incidentId) search.set('incidentId', params.incidentId);
      return apiRequest<PaginatedResponse<AlertResponse>>(`${alertsPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useAlert(workspaceId: string | undefined, alertId: string | undefined) {
  return useQuery({
    queryKey: alertKeys.detail(workspaceId ?? '', alertId ?? ''),
    queryFn: () => apiRequest<AlertResponse>(`${alertsPath(workspaceId ?? '')}/${encodeURIComponent(alertId ?? '')}`),
    enabled: Boolean(workspaceId && alertId),
    retry: false,
  });
}
