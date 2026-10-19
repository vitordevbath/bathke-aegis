import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateInvestigationRequest,
  InvestigationResponse,
  InvestigationStatus,
  InvestigationSummary,
  PaginatedResponse,
  UpdateInvestigationRequest,
} from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';

export interface InvestigationListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string | undefined;
  readonly status?: InvestigationStatus | undefined;
}

export const investigationKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'investigations'] as const,
  list: (workspaceId: string, params: InvestigationListParams) => [...investigationKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, investigationId: string) => [...investigationKeys.all(workspaceId), 'detail', investigationId] as const,
};

const investigationsPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/investigations`;
const investigationPath = (workspaceId: string, investigationId: string) => `${investigationsPath(workspaceId)}/${encodeURIComponent(investigationId)}`;

export function useInvestigationList(workspaceId: string | undefined, params: InvestigationListParams) {
  return useQuery({
    queryKey: investigationKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.q) search.set('q', params.q);
      if (params.status) search.set('status', params.status);
      return apiRequest<PaginatedResponse<InvestigationSummary>>(`${investigationsPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useInvestigation(workspaceId: string | undefined, investigationId: string | undefined) {
  return useQuery({
    queryKey: investigationKeys.detail(workspaceId ?? '', investigationId ?? ''),
    queryFn: () => apiRequest<InvestigationResponse>(investigationPath(workspaceId ?? '', investigationId ?? '')),
    enabled: Boolean(workspaceId && investigationId),
    retry: false,
  });
}

/** Lists are summaries; a write only needs to refresh them (the detail is set from the response). */
function useInvalidateInvestigationLists(workspaceId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [...investigationKeys.all(workspaceId), 'list'] });
}

export function useCreateInvestigation(workspaceId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvestigationLists(workspaceId);
  return useMutation({
    mutationFn: (body: CreateInvestigationRequest) => apiRequest<InvestigationResponse>(investigationsPath(workspaceId), { method: 'POST', body }),
    onSuccess: (investigation) => {
      queryClient.setQueryData(investigationKeys.detail(workspaceId, investigation.id), investigation);
      return invalidate();
    },
  });
}

/** Edits, the conclusion and lifecycle changes share PUT; the server decides whether a transition is allowed. */
export function useUpdateInvestigation(workspaceId: string, investigationId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvestigationLists(workspaceId);
  return useMutation({
    mutationFn: (body: UpdateInvestigationRequest) =>
      apiRequest<InvestigationResponse>(investigationPath(workspaceId, investigationId), { method: 'PUT', body }),
    onSuccess: (investigation) => {
      queryClient.setQueryData(investigationKeys.detail(workspaceId, investigationId), investigation);
      return invalidate();
    },
  });
}

export function useDeleteInvestigation(workspaceId: string, investigationId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvestigationLists(workspaceId);
  return useMutation({
    mutationFn: () => apiRequest<void>(investigationPath(workspaceId, investigationId), { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: investigationKeys.detail(workspaceId, investigationId) });
      return invalidate();
    },
  });
}

/**
 * PUT body that keeps the stored investigation and asks for a new status —
 * used by the lifecycle buttons. Closing passes the conclusion typed there.
 */
export function toStatusRequest(investigation: InvestigationResponse, status: InvestigationStatus, conclusion = investigation.conclusion): UpdateInvestigationRequest {
  return {
    title: investigation.title,
    description: investigation.description,
    conclusion,
    incidentIds: investigation.incidents.map((incident) => incident.incidentId),
    status,
  };
}
