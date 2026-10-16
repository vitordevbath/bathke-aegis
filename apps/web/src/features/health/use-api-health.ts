import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@aegis/contracts';
import { apiGet } from '../../lib/api-client';

export function useApiHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/health'),
    refetchInterval: 15_000,
  });
}
