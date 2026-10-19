import type { FieldPath, UseFormSetError } from 'react-hook-form';
import { CreateIncidentRequestSchema, type ApiFieldIssue, type CreateIncidentRequest, type IncidentResponse, type IncidentSeverity } from '@aegis/contracts';

/** The editable fields. Status is not here: it changes only through the lifecycle actions. */
export interface IncidentFormValues {
  title: string;
  description: string;
  severity: IncidentSeverity;
  hostIds: string[];
  detectionRuleIds: string[];
}

export const emptyIncidentForm = (): IncidentFormValues => ({ title: '', description: '', severity: 'MEDIUM', hostIds: [], detectionRuleIds: [] });

export function incidentToForm(incident: IncidentResponse): IncidentFormValues {
  return {
    title: incident.title,
    description: incident.description ?? '',
    severity: incident.severity,
    hostIds: incident.hosts.map((host) => host.hostId),
    detectionRuleIds: incident.detectionRules.map((rule) => rule.ruleId),
  };
}

export const formToRequest = (values: IncidentFormValues): CreateIncidentRequest => ({ ...values });

/** Client-side check with the exact schema the API uses. */
export function validateIncidentForm(values: IncidentFormValues): ApiFieldIssue[] {
  const result = CreateIncidentRequestSchema.safeParse(formToRequest(values));
  return result.success ? [] : result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

const FORM_FIELDS = new Set<string>(['title', 'description', 'severity', 'hostIds', 'detectionRuleIds']);

/** Routes issues to form fields (`hostIds.0` → `hostIds`); returns messages without a field of their own. */
export function applyIncidentIssues(issues: readonly ApiFieldIssue[], setError: UseFormSetError<IncidentFormValues>): string[] {
  const general: string[] = [];
  for (const issue of issues) {
    const top = issue.field.split('.')[0] ?? '';
    if (FORM_FIELDS.has(top)) setError(top as FieldPath<IncidentFormValues>, { type: 'validate', message: issue.message });
    else general.push(issue.message);
  }
  return [...new Set(general)];
}
