import type { FieldPath, UseFormSetError } from 'react-hook-form';
import {
  CreateInvestigationRequestSchema,
  UpdateInvestigationRequestSchema,
  type ApiFieldIssue,
  type InvestigationResponse,
  type UpdateInvestigationRequest,
} from '@aegis/contracts';

/** The editable fields. Status is not here: it changes only through the lifecycle actions. */
export interface InvestigationFormValues {
  title: string;
  description: string;
  /** Draft conclusion; only on the edit screen (a new investigation never has one). */
  conclusion: string;
  incidentIds: string[];
}

export const emptyInvestigationForm = (): InvestigationFormValues => ({ title: '', description: '', conclusion: '', incidentIds: [] });

export function investigationToForm(investigation: InvestigationResponse): InvestigationFormValues {
  return {
    title: investigation.title,
    description: investigation.description ?? '',
    conclusion: investigation.conclusion ?? '',
    incidentIds: investigation.incidents.map((incident) => incident.incidentId),
  };
}

/** Create sends no conclusion (the server would refuse it); edit sends the draft. */
export function formToRequest(values: InvestigationFormValues, withConclusion: boolean): Omit<UpdateInvestigationRequest, 'status'> {
  const { conclusion, ...rest } = values;
  return withConclusion ? { ...rest, conclusion } : rest;
}

/** Client-side check with the exact schema the API uses. */
export function validateInvestigationForm(values: InvestigationFormValues, withConclusion: boolean): ApiFieldIssue[] {
  const schema = withConclusion ? UpdateInvestigationRequestSchema : CreateInvestigationRequestSchema;
  const result = schema.safeParse(formToRequest(values, withConclusion));
  return result.success ? [] : result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

const FORM_FIELDS = new Set<string>(['title', 'description', 'conclusion', 'incidentIds']);

/** Routes issues to form fields (`incidentIds.0` → `incidentIds`); returns messages without a field of their own. */
export function applyInvestigationIssues(issues: readonly ApiFieldIssue[], setError: UseFormSetError<InvestigationFormValues>): string[] {
  const general: string[] = [];
  for (const issue of issues) {
    const top = issue.field.split('.')[0] ?? '';
    if (FORM_FIELDS.has(top)) setError(top as FieldPath<InvestigationFormValues>, { type: 'validate', message: issue.message });
    else general.push(issue.message);
  }
  return [...new Set(general)];
}
