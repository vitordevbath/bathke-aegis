import type { ApiErrorCode, ApiErrorResponse, ApiFieldIssue } from '@aegis/contracts';
import { authStorage } from './auth-storage';

/**
 * Single HTTP entry point. All calls go through `/api`, which Nginx (or the
 * Vite dev proxy) forwards to Aegis API. Attaches the bearer token, parses the
 * API error envelope, and reports 401s on authenticated calls so the session
 * can be dropped in one place.
 */

export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly issues: readonly ApiFieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registers the session-expiry callback; returns an unsubscribe function. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Send the stored bearer token (default true). */
  readonly auth?: boolean;
}

export async function apiRequest<T>(path: string, { method = 'GET', body, auth = true }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? authStorage.getToken() : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    // Only a rejected token ends the session; a failed login (no token sent) must not redirect.
    if (response.status === 401 && token) unauthorizedHandler?.();
    throw new ApiError(
      response.status,
      payload?.error.code ?? 'UNKNOWN',
      payload?.error.message ?? 'Erro inesperado.',
      payload?.error.issues ?? [],
    );
  }

  // 204 No Content (e.g. DELETE) has no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Public GET (no token), e.g. `/health`. */
export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { auth: false });
}
