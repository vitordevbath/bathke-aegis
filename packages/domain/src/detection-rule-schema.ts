import type { FieldIssue } from './domain-error.js';
import { SEVERITIES, type Severity } from './severity.js';

/**
 * Detection rule schema v1 — a declarative, structured, non-executable
 * description of "what to look for". It is data only: there is no expression
 * language, no regex, no code, no SQL. Fields come from an allowlist that
 * mirrors the PLANNED telemetry contract (no telemetry exists yet), and every
 * operator is restricted to the field's value type.
 */

/** The shared severity scale (also used by incidents). */
export const DETECTION_SEVERITIES = SEVERITIES;
export type DetectionSeverity = Severity;

export const DETECTION_EVENT_CATEGORIES = ['PROCESS', 'NETWORK', 'SYSTEM'] as const;
export type DetectionEventCategory = (typeof DETECTION_EVENT_CATEGORIES)[number];

export const DETECTION_SCOPES = ['ALL_HOSTS', 'SELECTED_HOSTS'] as const;
export type DetectionScope = (typeof DETECTION_SCOPES)[number];

export const DETECTION_MATCH_MODES = ['ALL', 'ANY'] as const;
export type DetectionMatchMode = (typeof DETECTION_MATCH_MODES)[number];

export const DETECTION_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'IN',
  'GREATER_THAN',
  'LESS_THAN',
] as const;
export type DetectionOperator = (typeof DETECTION_OPERATORS)[number];

export type DetectionFieldType = 'string' | 'integer';

export interface DetectionFieldSpec {
  readonly id: string;
  readonly type: DetectionFieldType;
  /** Inclusive bounds for integer fields. */
  readonly min?: number;
  readonly max?: number;
}

const PORT = { type: 'integer', min: 0, max: 65_535 } as const;

/** Allowlist per category — the planned event fields a condition may reference. */
export const DETECTION_FIELDS: Readonly<Record<DetectionEventCategory, readonly DetectionFieldSpec[]>> = {
  PROCESS: [
    { id: 'process.name', type: 'string' },
    { id: 'process.executable', type: 'string' },
    { id: 'process.parentName', type: 'string' },
    { id: 'process.user', type: 'string' },
  ],
  NETWORK: [
    { id: 'network.protocol', type: 'string' },
    { id: 'network.localPort', ...PORT },
    { id: 'network.remotePort', ...PORT },
    { id: 'network.remoteAddress', type: 'string' },
    { id: 'network.processName', type: 'string' },
  ],
  SYSTEM: [
    { id: 'system.eventType', type: 'string' },
    { id: 'system.serviceName', type: 'string' },
  ],
};

export const DETECTION_OPERATORS_BY_TYPE: Readonly<Record<DetectionFieldType, readonly DetectionOperator[]>> = {
  string: ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'IN'],
  integer: ['EQUALS', 'NOT_EQUALS', 'IN', 'GREATER_THAN', 'LESS_THAN'],
};

export const DETECTION_LIMITS = {
  maxConditions: 10,
  maxListValues: 20,
  maxStringValue: 256,
} as const;

export type DetectionScalar = string | number;
export type DetectionValue = DetectionScalar | readonly DetectionScalar[];

export interface DetectionCondition {
  readonly field: string;
  readonly operator: DetectionOperator;
  readonly value: DetectionValue;
}

export interface DetectionDefinitionV1 {
  readonly version: 1;
  readonly match: DetectionMatchMode;
  readonly conditions: readonly DetectionCondition[];
}

export type DefinitionValidation =
  | { readonly ok: true; readonly definition: DetectionDefinitionV1 }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

export function detectionFieldSpec(category: DetectionEventCategory, field: string): DetectionFieldSpec | undefined {
  return DETECTION_FIELDS[category].find((spec) => spec.id === field);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Validates one scalar against the field type; returns the normalized value or an error message. */
function scalarFor(spec: DetectionFieldSpec, raw: unknown): { value: DetectionScalar } | { error: string } {
  if (spec.type === 'integer') {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return { error: 'Informe um número inteiro.' };
    if ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max)) {
      return { error: `Informe um número entre ${spec.min} e ${spec.max}.` };
    }
    return { value: raw };
  }
  if (typeof raw !== 'string') return { error: 'Informe um texto.' };
  const value = raw.trim();
  if (value.length === 0) return { error: 'Informe um valor.' };
  if (value.length > DETECTION_LIMITS.maxStringValue) return { error: `No máximo ${DETECTION_LIMITS.maxStringValue} caracteres.` };
  return { value };
}

/**
 * The single validator for rule definitions, used by the API schemas, the web
 * forms and the entity (also when restoring from the database). Accepts
 * untrusted input and either returns a normalized definition or field issues
 * addressed as `definition.conditions.<i>.<prop>`.
 */
export function validateDetectionDefinition(category: DetectionEventCategory, raw: unknown): DefinitionValidation {
  const issues: FieldIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field: `definition${field}`, message });

  if (!isRecord(raw)) return { ok: false, issues: [{ field: 'definition', message: 'Definição inválida.' }] };
  for (const key of Object.keys(raw)) {
    if (!['version', 'match', 'conditions'].includes(key)) add(`.${key}`, 'Propriedade não permitida.');
  }
  if (raw['version'] !== 1) add('.version', 'Versão de definição não suportada.');
  if (!includes(DETECTION_MATCH_MODES, raw['match'])) add('.match', 'Modo de combinação inválido.');

  const conditionsRaw = raw['conditions'];
  const conditions: DetectionCondition[] = [];
  if (!Array.isArray(conditionsRaw) || conditionsRaw.length === 0) {
    add('.conditions', 'Adicione pelo menos uma condição.');
  } else if (conditionsRaw.length > DETECTION_LIMITS.maxConditions) {
    add('.conditions', `Use no máximo ${DETECTION_LIMITS.maxConditions} condições.`);
  } else {
    conditionsRaw.forEach((condition: unknown, index) => {
      const at = `.conditions.${index}`;
      if (!isRecord(condition)) return add(at, 'Condição inválida.');
      for (const key of Object.keys(condition)) {
        if (!['field', 'operator', 'value'].includes(key)) add(`${at}.${key}`, 'Propriedade não permitida.');
      }

      const spec = typeof condition['field'] === 'string' ? detectionFieldSpec(category, condition['field']) : undefined;
      if (!spec) return add(`${at}.field`, 'Campo não disponível para esta categoria.');
      const operator = condition['operator'];
      if (!includes(DETECTION_OPERATORS, operator)) return add(`${at}.operator`, 'Operador inválido.');
      if (!DETECTION_OPERATORS_BY_TYPE[spec.type].includes(operator)) return add(`${at}.operator`, 'Operador não suportado para este campo.');

      const rawValue = condition['value'];
      if (operator === 'IN') {
        if (!Array.isArray(rawValue) || rawValue.length === 0) return add(`${at}.value`, 'Informe pelo menos um valor.');
        if (rawValue.length > DETECTION_LIMITS.maxListValues) return add(`${at}.value`, `No máximo ${DETECTION_LIMITS.maxListValues} valores.`);
        const values: DetectionScalar[] = [];
        for (const item of rawValue) {
          const result = scalarFor(spec, item);
          if ('error' in result) return add(`${at}.value`, result.error);
          values.push(result.value);
        }
        if (new Set(values).size !== values.length) return add(`${at}.value`, 'Valores repetidos.');
        conditions.push({ field: spec.id, operator, value: values });
        return undefined;
      }
      const result = scalarFor(spec, rawValue);
      if ('error' in result) return add(`${at}.value`, result.error);
      conditions.push({ field: spec.id, operator, value: result.value });
      return undefined;
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, definition: { version: 1, match: raw['match'] as DetectionMatchMode, conditions } };
}

/** Limits and rules for the administrative fields of a rule. */
export const DETECTION_RULE_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  descriptionMax: 1000,
} as const;
