import type { FieldPath, UseFormSetError } from 'react-hook-form';
import {
  DetectionRuleRequestSchema,
  type ApiFieldIssue,
  type CreateDetectionRuleRequest,
  type DetectionEventCategory,
  type DetectionOperator,
  type DetectionRuleResponse,
  type DetectionScope,
  type DetectionSeverity,
} from '@aegis/contracts';
import { DETECTION_FIELDS, DETECTION_OPERATORS_BY_TYPE, detectionFieldSpec, type DetectionMatchMode } from '@aegis/domain';

/** Condition as edited: the value is always text (lists comma-separated), converted on submit. */
export interface ConditionFormValue {
  field: string;
  operator: DetectionOperator;
  value: string;
}

export interface RuleFormValues {
  name: string;
  description: string;
  severity: DetectionSeverity;
  enabled: boolean;
  eventCategory: DetectionEventCategory;
  scope: DetectionScope;
  hostIds: string[];
  match: DetectionMatchMode;
  conditions: ConditionFormValue[];
}

export function defaultCondition(category: DetectionEventCategory): ConditionFormValue {
  const spec = DETECTION_FIELDS[category][0];
  return { field: spec?.id ?? '', operator: 'EQUALS', value: '' };
}

export function operatorsFor(category: DetectionEventCategory, field: string): readonly DetectionOperator[] {
  const spec = detectionFieldSpec(category, field);
  return spec ? DETECTION_OPERATORS_BY_TYPE[spec.type] : [];
}

export const emptyRuleForm = (): RuleFormValues => ({
  name: '',
  description: '',
  severity: 'MEDIUM',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  hostIds: [],
  match: 'ALL',
  conditions: [defaultCondition('PROCESS')],
});

export function ruleToForm(rule: DetectionRuleResponse): RuleFormValues {
  return {
    name: rule.name,
    description: rule.description ?? '',
    severity: rule.severity,
    enabled: rule.enabled,
    eventCategory: rule.eventCategory,
    scope: rule.scope,
    hostIds: rule.targets.map((target) => target.hostId),
    match: rule.definition.match,
    conditions: rule.definition.conditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value),
    })),
  };
}

/** Text → typed value. Invalid input is passed through so the shared validator reports it. */
function toValue(category: DetectionEventCategory, condition: ConditionFormValue): unknown {
  const spec = detectionFieldSpec(category, condition.field);
  const parse = (text: string): unknown => {
    const trimmed = text.trim();
    if (spec?.type !== 'integer') return trimmed;
    return trimmed === '' || !/^-?\d+$/.test(trimmed) ? trimmed : Number(trimmed);
  };
  if (condition.operator === 'IN') {
    return condition.value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parse);
  }
  return parse(condition.value);
}

/** Builds the API body. Hosts are only sent for SELECTED_HOSTS. */
export function formToRequest(values: RuleFormValues): CreateDetectionRuleRequest {
  return {
    name: values.name,
    description: values.description,
    severity: values.severity,
    enabled: values.enabled,
    eventCategory: values.eventCategory,
    scope: values.scope,
    hostIds: values.scope === 'SELECTED_HOSTS' ? values.hostIds : [],
    definition: {
      version: 1,
      match: values.match,
      conditions: values.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: toValue(values.eventCategory, condition),
      })),
    },
  };
}

/** Client-side check with the exact schema the API uses. */
export function validateRuleForm(values: RuleFormValues): ApiFieldIssue[] {
  const result = DetectionRuleRequestSchema.safeParse(formToRequest(values));
  return result.success ? [] : result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

const FORM_FIELDS = new Set(['name', 'description', 'severity', 'eventCategory', 'scope', 'hostIds']);

/**
 * Routes API/schema issues to form fields: `definition.conditions.2.value`
 * → `conditions.2.value`, `hostIds.0` → `hostIds`. Returns messages that
 * have no field of their own (e.g. "add at least one condition").
 */
export function applyRuleIssues(issues: readonly ApiFieldIssue[], setError: UseFormSetError<RuleFormValues>): string[] {
  const general: string[] = [];
  for (const issue of issues) {
    const condition = /^definition\.conditions\.(\d+)\.(field|operator|value)$/.exec(issue.field);
    const top = issue.field.split('.')[0] ?? '';
    if (condition) {
      setError(`conditions.${Number(condition[1])}.${condition[2]}` as FieldPath<RuleFormValues>, { type: 'validate', message: issue.message });
    } else if (FORM_FIELDS.has(top)) {
      setError(top as FieldPath<RuleFormValues>, { type: 'validate', message: issue.message });
    } else {
      general.push(issue.message);
    }
  }
  return [...new Set(general)];
}
