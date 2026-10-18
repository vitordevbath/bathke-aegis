export const HOSTS_PAGE_SIZE = 10;

/** Reads `?page=&q=` defensively: anything invalid falls back to page 1 / no search. */
export function readListParams(search: URLSearchParams): { page: number; q: string } {
  const page = Number(search.get('page'));
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: (search.get('q') ?? '').trim().slice(0, 120),
  };
}
