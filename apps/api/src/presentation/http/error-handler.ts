import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AuthenticationError, ConflictError, ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE, type ApiErrorCode, type ApiErrorResponse, type ApiFieldIssue } from '@aegis/contracts';

const INTERNAL_ERROR_MESSAGE = 'Erro interno. Tente novamente mais tarde.';

function send(reply: FastifyReply, status: number, code: ApiErrorCode, message: string, issues?: readonly ApiFieldIssue[]) {
  const body: ApiErrorResponse = { error: issues && issues.length > 0 ? { code, message, issues } : { code, message } };
  return reply.status(status).send(body);
}

function zodIssues(error: ZodError): ApiFieldIssue[] {
  return error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ field: key, message: UNKNOWN_FIELD_MESSAGE }))
      : [{ field: issue.path.join('.') || 'body', message: issue.message }],
  );
}

/**
 * Single mapping from errors to HTTP. Domain errors carry user-safe messages;
 * anything unexpected becomes a generic 500. Responses never include stack
 * traces, SQL or driver messages.
 */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) return send(reply, 400, 'VALIDATION_ERROR', 'Dados inválidos.', zodIssues(error));
  if (error instanceof ValidationError) return send(reply, 400, 'VALIDATION_ERROR', error.message, error.issues);
  if (error instanceof AuthenticationError) {
    return send(reply.header('WWW-Authenticate', 'Bearer'), 401, 'AUTHENTICATION_ERROR', error.message);
  }
  if (error instanceof ConflictError) {
    return send(reply, 409, 'CONFLICT', error.message, error.field ? [{ field: error.field, message: error.message }] : undefined);
  }
  if (error instanceof InvalidStateError) {
    // Well-formed request that the resource's current state refuses (e.g. CLOSED → OPEN).
    return send(reply, 409, 'INVALID_STATE', error.message, error.field ? [{ field: error.field, message: error.message }] : undefined);
  }
  if (error instanceof ForbiddenError) return send(reply, 403, 'FORBIDDEN', error.message);
  if (error instanceof NotFoundError) return send(reply, 404, 'NOT_FOUND', error.message);

  const status = 'statusCode' in error ? error.statusCode : undefined;
  if (status === 429) return send(reply, 429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um minuto e tente novamente.');
  if (status !== undefined && status >= 400 && status < 500) {
    // Framework-level client errors: malformed JSON, unsupported media type, body too large…
    return send(reply, status, 'BAD_REQUEST', 'Requisição inválida.');
  }

  // Driver errors may embed query parameters (hashes, CPF) in `message`: log type and frames only.
  request.log.error(
    { err: { type: error.name, code: (error as { code?: unknown }).code, stack: error.stack?.split('\n').slice(1).join('\n') } },
    'unhandled error',
  );
  return send(reply, 500, 'INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE);
}
