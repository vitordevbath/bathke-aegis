import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * `page` / `pageSize` query parameters shared by every paginated list.
 * Query strings arrive as text, hence the coercion; non-numeric, zero,
 * negative or fractional values are rejected (400).
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'Página inválida.' })
    .int('Página inválida.')
    .min(1, 'A página deve ser maior ou igual a 1.')
    .default(1),
  pageSize: z.coerce
    .number({ invalid_type_error: 'Tamanho de página inválido.' })
    .int('Tamanho de página inválido.')
    .min(1, 'O tamanho da página deve ser maior ou igual a 1.')
    .max(MAX_PAGE_SIZE, `O tamanho da página deve ser no máximo ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.output<typeof PaginationQuerySchema>;

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** `ceil(total / pageSize)`; 0 when the list is empty. */
  readonly totalPages: number;
}

/** Envelope of every paginated list response. */
export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly pagination: PaginationMeta;
}
