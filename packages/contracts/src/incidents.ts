import { z } from 'zod';
import {
  INCIDENT_DESCRIPTION_MESSAGE,
  INCIDENT_HOSTS_REQUIRED_MESSAGE,
  INCIDENT_LIMITS,
  INCIDENT_ORIGINS,
  INCIDENT_STATUSES,
  INCIDENT_TITLE_MESSAGE,
  SEVERITIES,
  type IncidentOrigin,
  type IncidentStatus,
  type Severity,
} from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';
import { PaginationQuerySchema } from './pagination.js';
import type { HostConnectionState } from './hosts.js';

export { INCIDENT_STATUSES, INCIDENT_ORIGINS };
export type { IncidentOrigin, IncidentStatus };
/** Incidents use the same severity scale as detection rules. */
export type IncidentSeverity = Severity;

const incidentFields = {
  title: z.string({ required_error: 'Informe o título do incidente.' }).trim().min(INCIDENT_LIMITS.titleMin, INCIDENT_TITLE_MESSAGE).max(INCIDENT_LIMITS.titleMax, INCIDENT_TITLE_MESSAGE),
  description: z
    .string()
    .trim()
    .max(INCIDENT_LIMITS.descriptionMax, INCIDENT_DESCRIPTION_MESSAGE)
    .nullish()
    .transform((value) => (value ? value : null)),
  severity: z.enum(SEVERITIES, { errorMap: () => ({ message: 'Selecione a severidade.' }) }),
  hostIds: z
    .array(z.string().uuid('Host inválido.'), { required_error: INCIDENT_HOSTS_REQUIRED_MESSAGE })
    .min(1, INCIDENT_HOSTS_REQUIRED_MESSAGE)
    .max(INCIDENT_LIMITS.maxHosts, `Selecione no máximo ${INCIDENT_LIMITS.maxHosts} hosts.`),
  detectionRuleIds: z
    .array(z.string().uuid('Regra inválida.'))
    .max(INCIDENT_LIMITS.maxDetectionRules, `Selecione no máximo ${INCIDENT_LIMITS.maxDetectionRules} regras.`)
    .default([]),
};

function noDuplicates(data: { hostIds: string[]; detectionRuleIds: string[] }, ctx: z.RefinementCtx): void {
  if (new Set(data.hostIds).size !== data.hostIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: 'Há hosts repetidos.' });
  }
  if (new Set(data.detectionRuleIds).size !== data.detectionRuleIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['detectionRuleIds'], message: 'Há regras repetidas.' });
  }
}

/**
 * Body of `POST /workspaces/:workspaceId/incidents`. The server sets
 * `status = OPEN`, `origin = MANUAL` and `resolvedAt = null`; sending any of
 * them — or `id`, `workspaceId`, timestamps — is a 400.
 */
export const CreateIncidentRequestSchema = z.object(incidentFields).strict(UNKNOWN_FIELD_MESSAGE).superRefine(noDuplicates);
export type CreateIncidentRequest = z.input<typeof CreateIncidentRequestSchema>;
export type CreateIncidentCommand = z.output<typeof CreateIncidentRequestSchema>;

/**
 * Body of `PUT …/incidents/:incidentId`: full replacement of the editable
 * fields plus an optional target `status` (omitted = unchanged), which must
 * follow the lifecycle. `origin`, `resolvedAt` and the rest stay server-owned.
 */
export const UpdateIncidentRequestSchema = z
  .object({ ...incidentFields, status: z.enum(INCIDENT_STATUSES, { errorMap: () => ({ message: 'Status inválido.' }) }).optional() })
  .strict(UNKNOWN_FIELD_MESSAGE)
  .superRefine(noDuplicates);
export type UpdateIncidentRequest = z.input<typeof UpdateIncidentRequestSchema>;
export type UpdateIncidentCommand = z.output<typeof UpdateIncidentRequestSchema>;

/** Query of `GET /workspaces/:workspaceId/incidents`. */
export const IncidentListQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(INCIDENT_LIMITS.titleMax, 'Busca muito longa.')
    .optional()
    .transform((value) => (value ? value : undefined)),
  severity: z.enum(SEVERITIES, { errorMap: () => ({ message: 'Severidade inválida.' }) }).optional(),
  status: z.enum(INCIDENT_STATUSES, { errorMap: () => ({ message: 'Status inválido.' }) }).optional(),
  origin: z.enum(INCIDENT_ORIGINS, { errorMap: () => ({ message: 'Origem inválida.' }) }).optional(),
});
export type IncidentListQuery = z.output<typeof IncidentListQuerySchema>;

/** List item: counts instead of relations, no description. */
export interface IncidentSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly origin: IncidentOrigin;
  readonly hostCount: number;
  readonly ruleCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
}

/** A host involved in the incident (same workspace only). */
export interface IncidentHost {
  readonly hostId: string;
  readonly displayName: string;
  readonly connectionState: HostConnectionState;
}

/** A detection rule related to the incident by hand (same workspace only). */
export interface IncidentDetectionRule {
  readonly ruleId: string;
  readonly name: string;
  readonly severity: Severity;
  readonly enabled: boolean;
}

/** Detail. `availableTransitions` comes from the domain lifecycle — the web only renders it. */
export interface IncidentResponse extends IncidentSummary {
  readonly description: string | null;
  readonly hosts: readonly IncidentHost[];
  readonly detectionRules: readonly IncidentDetectionRule[];
  readonly availableTransitions: readonly IncidentStatus[];
}
