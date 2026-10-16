/** Thin fetch wrapper. All calls go through `/api`, which Nginx (or the Vite dev proxy) forwards to Aegis API. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new ApiError(response.status, `GET ${path} failed with ${response.status}`);
  return (await response.json()) as T;
}
