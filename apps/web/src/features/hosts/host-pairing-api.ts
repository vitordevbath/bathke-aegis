import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostPairingResponse, PairingCodeResponse, RotateCredentialResponse } from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';
import { hostKeys } from './hosts-api';

const pairingPath = (workspaceId: string, hostId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/hosts/${encodeURIComponent(hostId)}`;
const credentialPath = (workspaceId: string, hostId: string, credentialId: string) => `${pairingPath(workspaceId, hostId)}/credentials/${encodeURIComponent(credentialId)}`;

export const hostPairingKey = (workspaceId: string, hostId: string) => [...hostKeys.all(workspaceId), 'pairing', hostId] as const;

export function useHostPairing(workspaceId: string, hostId: string) {
  return useQuery({
    queryKey: hostPairingKey(workspaceId, hostId),
    queryFn: () => apiRequest<HostPairingResponse>(`${pairingPath(workspaceId, hostId)}/pairing`),
    retry: false,
  });
}

/**
 * `gcTime: 0` on the mutations that return a secret: TanStack Query would
 * otherwise keep the response in its global cache for minutes after the screen
 * is gone. The value lives only in the state of the panel that shows it.
 */
const SECRET_RESPONSE = { gcTime: 0 } as const;

export function useRequestPairingCode(workspaceId: string, hostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...SECRET_RESPONSE,
    mutationFn: () => apiRequest<PairingCodeResponse>(`${pairingPath(workspaceId, hostId)}/pairing-codes`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostPairingKey(workspaceId, hostId) }),
  });
}

export function useRotateCredential(workspaceId: string, hostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...SECRET_RESPONSE,
    mutationFn: (credentialId: string) => apiRequest<RotateCredentialResponse>(`${credentialPath(workspaceId, hostId, credentialId)}/rotate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostKeys.all(workspaceId) }),
  });
}

export function useRevokeCredential(workspaceId: string, hostId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) => apiRequest<void>(credentialPath(workspaceId, hostId, credentialId), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hostKeys.all(workspaceId) }),
  });
}
