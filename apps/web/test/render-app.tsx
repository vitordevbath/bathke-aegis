import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { MeResponse } from '@aegis/contracts';
import { routes } from '../src/app/router';

type Handler = (body: unknown, url: URL) => { status: number; body: unknown };

/**
 * Stubs `fetch` with handlers keyed by `"METHOD /api/path"` — exact match first,
 * then the same path without its query string. Unhandled calls answer 404.
 * Returns the mock so tests can inspect requests.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://aegis.test');
    const method = init.method ?? 'GET';
    const key = `${method} ${String(input)}`;
    const handler =
      handlers[key] ??
      handlers[`${method} ${url.pathname}`] ??
      (key === 'GET /api/health' ? () => ({ status: 200, body: { status: 'ok', service: 'aegis-api' } }) : undefined);
    const result = handler
      ? handler(typeof init.body === 'string' ? JSON.parse(init.body) : undefined, url)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } } };
    if (result.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Mounts the real route tree in a memory router at `path`. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

/** Request body of the first call matching `method path`. */
export function requestBody(fetchMock: ReturnType<typeof mockApi>, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => String(input) === path && (init?.method ?? 'GET') === method);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

/** URLs of all calls with that method whose path starts with `prefix`. */
export function calledUrls(fetchMock: ReturnType<typeof mockApi>, method: string, prefix: string): string[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).startsWith(prefix) && (init?.method ?? 'GET') === method)
    .map(([input]) => String(input));
}

export const ME: MeResponse = {
  user: {
    id: '0b6c2f1e-0000-4000-8000-000000000001',
    name: 'Ana Teste',
    email: 'ana.teste@example.test',
    cpf: '12345678909',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  workspaces: [{ id: '0b6c2f1e-0000-4000-8000-000000000002', name: 'Workspace de Ana Teste', kind: 'personal', role: 'OWNER' }],
};

/** Not a real JWT: three base64url segments are all the client checks. */
export const FAKE_TOKEN = 'header.payload.signature';
