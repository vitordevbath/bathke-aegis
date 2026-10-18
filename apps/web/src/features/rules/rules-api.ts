import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDetectionRuleRequest,
  DetectionEventCategory,
  DetectionRuleResponse,
  DetectionRuleSummary,
  DetectionSeverity,
  PaginatedResponse,
} from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';
import { hostKeys } from '../hosts/hosts-api';

export interface RuleListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string | undefined;
  readonly severity?: DetectionSeverity | undefined;
  readonly eventCategory?: DetectionEventCategory | undefined;
  readonly enabled?: boolean | undefined;
}

export const ruleKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'detection-rules'] as const,
  list: (workspaceId: string, params: RuleListParams) => [...ruleKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, ruleId: string) => [...ruleKeys.all(workspaceId), 'detail', ruleId] as const,
};

const rulesPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/detection-rules`;
const rulePath = (workspaceId: string, ruleId: string) => `${rulesPath(workspaceId)}/${encodeURIComponent(ruleId)}`;

export function useRuleList(workspaceId: string | undefined, params: RuleListParams) {
  return useQuery({
    queryKey: ruleKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.q) search.set('q', params.q);
      if (params.severity) search.set('severity', params.severity);
      if (params.eventCategory) search.set('eventCategory', params.eventCategory);
      if (params.enabled !== undefined) search.set('enabled', String(params.enabled));
      return apiRequest<PaginatedResponse<DetectionRuleSummary>>(`${rulesPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useRule(workspaceId: string | undefined, ruleId: string | undefined) {
  return useQuery({
    queryKey: ruleKeys.detail(workspaceId ?? '', ruleId ?? ''),
    queryFn: () => apiRequest<DetectionRuleResponse>(rulePath(workspaceId ?? '', ruleId ?? '')),
    enabled: Boolean(workspaceId && ruleId),
    retry: false,
  });
}

/** Rules reference hosts: refresh both caches after writes (host deletion may now be blocked or allowed). */
function useInvalidateRules(workspaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...ruleKeys.all(workspaceId), 'list'] }),
      queryClient.invalidateQueries({ queryKey: hostKeys.all(workspaceId) }),
    ]);
}

export function useCreateRule(workspaceId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRules(workspaceId);
  return useMutation({
    mutationFn: (body: CreateDetectionRuleRequest) => apiRequest<DetectionRuleResponse>(rulesPath(workspaceId), { method: 'POST', body }),
    onSuccess: (rule) => {
      queryClient.setQueryData(ruleKeys.detail(workspaceId, rule.id), rule);
      return invalidate();
    },
  });
}

export function useUpdateRule(workspaceId: string, ruleId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRules(workspaceId);
  return useMutation({
    mutationFn: (body: CreateDetectionRuleRequest) => apiRequest<DetectionRuleResponse>(rulePath(workspaceId, ruleId), { method: 'PUT', body }),
    onSuccess: (rule) => {
      queryClient.setQueryData(ruleKeys.detail(workspaceId, ruleId), rule);
      return invalidate();
    },
  });
}

export function useDeleteRule(workspaceId: string, ruleId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRules(workspaceId);
  return useMutation({
    mutationFn: () => apiRequest<void>(rulePath(workspaceId, ruleId), { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ruleKeys.detail(workspaceId, ruleId) });
      return invalidate();
    },
  });
}

/** Request body that reproduces a stored rule — used to toggle `enabled` through PUT. */
export function toRequest(rule: DetectionRuleResponse, overrides: Partial<CreateDetectionRuleRequest> = {}): CreateDetectionRuleRequest {
  return {
    name: rule.name,
    description: rule.description,
    severity: rule.severity,
    enabled: rule.enabled,
    eventCategory: rule.eventCategory,
    scope: rule.scope,
    hostIds: rule.targets.map((target) => target.hostId),
    definition: rule.definition,
    ...overrides,
  };
}
