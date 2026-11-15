import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HOST_PRESENCE_POLICY, type HostDetailsCommand, type HostResponse, type PaginatedResponse } from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';

export interface HostListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string | undefined;
}

/** Workspace id is part of every key: switching workspace never shows another tenant's cache. */
export const hostKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'hosts'] as const,
  list: (workspaceId: string, params: HostListParams) => [...hostKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, hostId: string) => [...hostKeys.all(workspaceId), 'detail', hostId] as const,
};

const hostsPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/hosts`;
const hostPath = (workspaceId: string, hostId: string) => `${hostsPath(workspaceId)}/${encodeURIComponent(hostId)}`;

export function useHostList(workspaceId: string | undefined, params: HostListParams) {
  return useQuery({
    queryKey: hostKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.q) search.set('q', params.q);
      return apiRequest<PaginatedResponse<HostResponse>>(`${hostsPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

/**
 * Connection state is derived by the API from the last heartbeat, so the
 * detail screen refreshes it twice per heartbeat interval: ONLINE/OFFLINE
 * changes without a manual reload, and only while the screen is open.
 */
export const HOST_REFRESH_MS = HOST_PRESENCE_POLICY.heartbeatIntervalMs / 2;

export function useHost(workspaceId: string | undefined, hostId: string | undefined) {
  return useQuery({
    queryKey: hostKeys.detail(workspaceId ?? '', hostId ?? ''),
    queryFn: () => apiRequest<HostResponse>(hostPath(workspaceId ?? '', hostId ?? '')),
    enabled: Boolean(workspaceId && hostId),
    retry: false,
    refetchInterval: HOST_REFRESH_MS,
  });
}

export function useCreateHost(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (details: HostDetailsCommand) => apiRequest<HostResponse>(hostsPath(workspaceId), { method: 'POST', body: details }),
    onSuccess: (host) => {
      queryClient.setQueryData(hostKeys.detail(workspaceId, host.id), host);
      return queryClient.invalidateQueries({ queryKey: [...hostKeys.all(workspaceId), 'list'] });
    },
  });
}

export function useUpdateHost(workspaceId: string, hostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (details: HostDetailsCommand) => apiRequest<HostResponse>(hostPath(workspaceId, hostId), { method: 'PUT', body: details }),
    onSuccess: (host) => {
      queryClient.setQueryData(hostKeys.detail(workspaceId, hostId), host);
      return queryClient.invalidateQueries({ queryKey: [...hostKeys.all(workspaceId), 'list'] });
    },
  });
}

export function useDeleteHost(workspaceId: string, hostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>(hostPath(workspaceId, hostId), { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: hostKeys.detail(workspaceId, hostId) });
      return queryClient.invalidateQueries({ queryKey: [...hostKeys.all(workspaceId), 'list'] });
    },
  });
}
