import { z } from 'zod';
import {
  INVESTIGATION_CONCLUSION_MESSAGE,
  INVESTIGATION_DESCRIPTION_MESSAGE,
  INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE,
  INVESTIGATION_LIMITS,
  INVESTIGATION_STATUSES,
  INVESTIGATION_TITLE_MESSAGE,
  type InvestigationStatus,
  type IncidentOrigin,
  type IncidentStatus,
  type Severity,
} from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';
import { PaginationQuerySchema } from './pagination.js';

export { INVESTIGATION_STATUSES };
export type { InvestigationStatus };

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

const investigationFields = {
  title: z
    .string({ required_error: 'Informe o título da investigação.' })
    .trim()
    .min(INVESTIGATION_LIMITS.titleMin, INVESTIGATION_TITLE_MESSAGE)
    .max(INVESTIGATION_LIMITS.titleMax, INVESTIGATION_TITLE_MESSAGE),
  description: optionalText(INVESTIGATION_LIMITS.descriptionMax, INVESTIGATION_DESCRIPTION_MESSAGE),
  incidentIds: z
    .array(z.string().uuid('Incidente inválido.'), { required_error: INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE })
    .min(1, INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE)
    .max(INVESTIGATION_LIMITS.maxIncidents, `Selecione no máximo ${INVESTIGATION_LIMITS.maxIncidents} incidentes.`),
};

function noDuplicates(data: { incidentIds: string[] }, ctx: z.RefinementCtx): void {
  if (new Set(data.incidentIds).size !== data.incidentIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['incidentIds'], message: 'Há incidentes repetidos.' });
  }
}

/**
 * Body of `POST /workspaces/:workspaceId/investigations`. The server sets
 * `status = OPEN`, `conclusion = null` and `closedAt = null`; sending any of
 * them — or `id`, `workspaceId`, timestamps — is a 400.
 */
export const CreateInvestigationRequestSchema = z.object(investigationFields).strict(UNKNOWN_FIELD_MESSAGE).superRefine(noDuplicates);
export type CreateInvestigationRequest = z.input<typeof CreateInvestigationRequestSchema>;
export type CreateInvestigationCommand = z.output<typeof CreateInvestigationRequestSchema>;

/**
 * Body of `PUT …/investigations/:investigationId`: full replacement of the
 * editable fields (the conclusion may be a draft while not closed) plus an
 * optional target `status` (omitted = unchanged). Closing without a
 * conclusion is refused by the domain, not here, so the rule lives in one place.
 */
export const UpdateInvestigationRequestSchema = z
  .object({
    ...investigationFields,
    conclusion: optionalText(INVESTIGATION_LIMITS.conclusionMax, INVESTIGATION_CONCLUSION_MESSAGE),
    status: z.enum(INVESTIGATION_STATUSES, { errorMap: () => ({ message: 'Status inválido.' }) }).optional(),
  })
  .strict(UNKNOWN_FIELD_MESSAGE)
  .superRefine(noDuplicates);
export type UpdateInvestigationRequest = z.input<typeof UpdateInvestigationRequestSchema>;
export type UpdateInvestigationCommand = z.output<typeof UpdateInvestigationRequestSchema>;

/** Query of `GET /workspaces/:workspaceId/investigations`. `q` matches title, description and conclusion. */
export const InvestigationListQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(INVESTIGATION_LIMITS.titleMax, 'Busca muito longa.')
    .optional()
    .transform((value) => (value ? value : undefined)),
  status: z.enum(INVESTIGATION_STATUSES, { errorMap: () => ({ message: 'Status inválido.' }) }).optional(),
});
export type InvestigationListQuery = z.output<typeof InvestigationListQuerySchema>;

/** List item: an incident count instead of the incidents, no long texts. */
export interface InvestigationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly status: InvestigationStatus;
  readonly incidentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
}

/** An incident grouped by the investigation (same workspace only), without its own relations. */
export interface InvestigationIncident {
  readonly incidentId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly origin: IncidentOrigin;
}

/** Detail. `availableTransitions` comes from the domain lifecycle — the web only renders it. */
export interface InvestigationResponse extends InvestigationSummary {
  readonly description: string | null;
  readonly conclusion: string | null;
  readonly incidents: readonly InvestigationIncident[];
  readonly availableTransitions: readonly InvestigationStatus[];
}
