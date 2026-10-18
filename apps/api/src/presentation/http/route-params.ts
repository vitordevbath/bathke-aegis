import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '@aegis/domain';

export const WorkspaceParamsSchema = z.object({ workspaceId: z.string().uuid() });

/** Workspace-scoped resource: `/workspaces/:workspaceId/<resource>/:<idParam>`. */
export const resourceParamsSchema = <K extends string>(idParam: K) =>
  WorkspaceParamsSchema.extend({ [idParam]: z.string().uuid() } as Record<K, z.ZodString>);

/** Malformed ids are indistinguishable from unknown ones: 404, not 400. */
export function paramsOf<T extends z.ZodTypeAny>(schema: T, request: FastifyRequest): z.output<T> {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data;
}
