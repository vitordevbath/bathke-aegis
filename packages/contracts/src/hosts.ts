import { z } from 'zod';
import { HOST_DESCRIPTION_MESSAGE, HOST_DISPLAY_NAME_MESSAGE, HOST_LIMITS } from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';
import { PaginationQuerySchema } from './pagination.js';

export const HOST_CONNECTION_STATES = ['UNPAIRED', 'ONLINE', 'OFFLINE'] as const;
export type HostConnectionState = (typeof HOST_CONNECTION_STATES)[number];

/**
 * Administrative fields — the only ones a user may set. Everything else
 * (`workspaceId`, `agentId`, `hostname`, OS facts, `connectionState`,
 * `lastSeenAt`, timestamps) is controlled by Aegis; sending it is a 400.
 */
const HostDetailsSchema = z
  .object({
    displayName: z
      .string({ required_error: 'Informe o nome do host.' })
      .trim()
      .min(HOST_LIMITS.displayNameMin, HOST_DISPLAY_NAME_MESSAGE)
      .max(HOST_LIMITS.displayNameMax, HOST_DISPLAY_NAME_MESSAGE),
    description: z
      .string()
      .trim()
      .max(HOST_LIMITS.descriptionMax, HOST_DESCRIPTION_MESSAGE)
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict(UNKNOWN_FIELD_MESSAGE);

/** Body of `POST /workspaces/:workspaceId/hosts`. */
export const CreateHostRequestSchema = HostDetailsSchema;
export type CreateHostRequest = z.input<typeof CreateHostRequestSchema>;

/** Body of `PUT /workspaces/:workspaceId/hosts/:hostId` (full replacement of the administrative fields). */
export const UpdateHostRequestSchema = HostDetailsSchema;
export type UpdateHostRequest = z.input<typeof UpdateHostRequestSchema>;

export type HostDetailsCommand = z.output<typeof HostDetailsSchema>;

/** Query of `GET /workspaces/:workspaceId/hosts`: pagination plus optional text search. */
export const HostListQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(HOST_LIMITS.displayNameMax, 'Busca muito longa.')
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type HostListQuery = z.output<typeof HostListQuerySchema>;

export interface HostResponse {
  readonly id: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly description: string | null;
  /** Collector-controlled; null until pairing exists. */
  readonly agentId: string | null;
  readonly hostname: string | null;
  readonly osName: string | null;
  readonly osVersion: string | null;
  readonly architecture: string | null;
  readonly connectionState: HostConnectionState;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
