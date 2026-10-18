/** A page of a list, as requested by the caller (already validated). */
export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** One page of results plus the total count of the filtered list. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}

export function mapPage<T, R>(page: Page<T>, map: (item: T) => R): Page<R> {
  return { ...page, items: page.items.map(map) };
}
