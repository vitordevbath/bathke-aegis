import { z } from 'zod';
import { SEVERITIES, type EventType, type Severity } from '@aegis/domain';
import { PaginationQuerySchema } from './pagination.js';

/** Query of `GET /workspaces/:workspaceId/alerts` (newest first). Alerts are read-only (ADR-053). */
export const AlertListQuerySchema = PaginationQuerySchema.extend({
  severity: z.enum(SEVERITIES, { errorMap: () => ({ message: 'Severidade inválida.' }) }).optional(),
  ruleId: z.string().uuid('Regra inválida.').optional(),
  hostId: z.string().uuid('Host inválido.').optional(),
  incidentId: z.string().uuid('Incidente inválido.').optional(),
});
export type AlertListQuery = z.output<typeof AlertListQuerySchema>;

/** One alert: which rule matched which event on which host, and the incident it was correlated into. */
export interface AlertResponse {
  readonly id: string;
  readonly workspaceId: string;
  readonly severity: Severity;
  /** When the matched event happened (source clock). */
  readonly occurredAt: string;
  /** When the engine raised the alert (server clock). */
  readonly createdAt: string;
  readonly rule: { readonly id: string; readonly name: string };
  readonly host: { readonly id: string; readonly displayName: string };
  readonly event: { readonly id: string; readonly type: EventType; readonly summary: string };
  /** Null when the incident was deleted afterwards. */
  readonly incident: { readonly id: string; readonly title: string } | null;
}
