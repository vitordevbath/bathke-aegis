import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../../lib/api-client';

/**
 * Applies API field issues to the form. Returns a user-facing message for the
 * form as a whole, or null when every issue landed on a known field.
 * Internal details (status codes, driver errors) are never shown.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  fallback: string,
): string | null {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === 'RATE_LIMITED') return error.message;

  const known = error.issues.filter((issue) => (fields as readonly string[]).includes(issue.field));
  for (const issue of known) setError(issue.field as Path<T>, { type: 'server', message: issue.message });

  if (known.length > 0 && known.length === error.issues.length) return null;
  if (error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN') return error.message;
  return fallback;
}
