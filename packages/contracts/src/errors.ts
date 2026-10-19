export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export interface ApiFieldIssue {
  readonly field: string;
  readonly message: string;
}

/** Body of every non-2xx response from Aegis API. Never contains stack traces or internals. */
export interface ApiErrorResponse {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly issues?: readonly ApiFieldIssue[];
  };
}
