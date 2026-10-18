import { z } from 'zod';
import {
  DETECTION_EVENT_CATEGORIES,
  DETECTION_RULE_LIMITS,
  DETECTION_SCOPES,
  DETECTION_SEVERITIES,
  validateDetectionDefinition,
  type DetectionCondition,
  type DetectionDefinitionV1,
  type DetectionEventCategory,
  type DetectionOperator,
  type DetectionScope,
  type DetectionSeverity,
} from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';
import { PaginationQuerySchema } from './pagination.js';
import type { HostConnectionState } from './hosts.js';

export type { DetectionCondition, DetectionDefinitionV1, DetectionEventCategory, DetectionOperator, DetectionScope, DetectionSeverity };

const NAME_MESSAGE = `O nome deve ter entre ${DETECTION_RULE_LIMITS.nameMin} e ${DETECTION_RULE_LIMITS.nameMax} caracteres.`;

/**
 * Body of `POST` and `PUT` on detection rules. The `definition` is validated
 * by the shared domain validator (allowlisted fields per category, typed
 * operators, versioned structure) — never interpreted as code.
 * `workspaceId`, `id` and timestamps are not accepted (400).
 */
export const DetectionRuleRequestSchema = z
  .object({
    name: z.string({ required_error: 'Informe o nome da regra.' }).trim().min(DETECTION_RULE_LIMITS.nameMin, NAME_MESSAGE).max(DETECTION_RULE_LIMITS.nameMax, NAME_MESSAGE),
    description: z
      .string()
      .trim()
      .max(DETECTION_RULE_LIMITS.descriptionMax, `A descrição deve ter no máximo ${DETECTION_RULE_LIMITS.descriptionMax} caracteres.`)
      .nullish()
      .transform((value) => (value ? value : null)),
    severity: z.enum(DETECTION_SEVERITIES, { errorMap: () => ({ message: 'Selecione a severidade.' }) }),
    enabled: z.boolean({ invalid_type_error: 'Valor inválido.' }).default(true),
    eventCategory: z.enum(DETECTION_EVENT_CATEGORIES, { errorMap: () => ({ message: 'Selecione a categoria.' }) }),
    scope: z.enum(DETECTION_SCOPES, { errorMap: () => ({ message: 'Selecione o escopo.' }) }),
    hostIds: z.array(z.string().uuid('Host inválido.')).max(500).default([]),
    definition: z.unknown(),
  })
  .strict(UNKNOWN_FIELD_MESSAGE)
  .superRefine((data, ctx) => {
    if (data.scope === 'SELECTED_HOSTS' && data.hostIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: 'Selecione pelo menos um host.' });
    }
    if (data.scope === 'ALL_HOSTS' && data.hostIds.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: 'Uma regra para todos os hosts não deve listar hosts.' });
    }
    if (new Set(data.hostIds).size !== data.hostIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: 'Há hosts repetidos.' });
    }
    const result = validateDetectionDefinition(data.eventCategory, data.definition);
    if (!result.ok) {
      for (const issue of result.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.field.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)), message: issue.message });
      }
    }
  })
  .transform((data) => {
    const result = validateDetectionDefinition(data.eventCategory, data.definition);
    // superRefine already rejected invalid definitions; this narrows the type and keeps normalization.
    return { ...data, definition: (result.ok ? result.definition : data.definition) as DetectionDefinitionV1 };
  });

export const CreateDetectionRuleRequestSchema = DetectionRuleRequestSchema;
export const UpdateDetectionRuleRequestSchema = DetectionRuleRequestSchema;
export type CreateDetectionRuleRequest = z.input<typeof DetectionRuleRequestSchema>;
export type UpdateDetectionRuleRequest = z.input<typeof DetectionRuleRequestSchema>;
export type DetectionRuleCommand = z.output<typeof DetectionRuleRequestSchema>;

/** Query of `GET /workspaces/:workspaceId/detection-rules`. */
export const DetectionRuleListQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(DETECTION_RULE_LIMITS.nameMax, 'Busca muito longa.')
    .optional()
    .transform((value) => (value ? value : undefined)),
  severity: z.enum(DETECTION_SEVERITIES, { errorMap: () => ({ message: 'Severidade inválida.' }) }).optional(),
  eventCategory: z.enum(DETECTION_EVENT_CATEGORIES, { errorMap: () => ({ message: 'Categoria inválida.' }) }).optional(),
  enabled: z
    .enum(['true', 'false'], { errorMap: () => ({ message: 'Use true ou false.' }) })
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type DetectionRuleListQuery = z.output<typeof DetectionRuleListQuerySchema>;

/** List item. */
export interface DetectionRuleSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly severity: DetectionSeverity;
  readonly enabled: boolean;
  readonly eventCategory: DetectionEventCategory;
  readonly scope: DetectionScope;
  /** 0 for ALL_HOSTS. */
  readonly targetCount: number;
  readonly conditionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A targeted host as shown with the rule (same workspace only). */
export interface DetectionRuleTarget {
  readonly hostId: string;
  readonly displayName: string;
  readonly connectionState: HostConnectionState;
}

/** Detail. */
export interface DetectionRuleResponse extends DetectionRuleSummary {
  readonly definition: DetectionDefinitionV1;
  readonly targets: readonly DetectionRuleTarget[];
}
