import type { DetectionCondition, DetectionDefinitionV1, DetectionScalar } from './detection-rule-schema.js';
import type { NormalizedEventV1 } from './event-contract.js';

/**
 * Evaluation of Detection Rule schema v1 against one validated event (ADR-053). Pure: no I/O, no
 * clock. The definition was validated against the rule's category when the rule was saved, so every
 * field id here is a detectable field of that category (`namespace.key`).
 *
 * Semantics, chosen to be predictable rather than clever:
 * - a field the event does not carry (absent or null) never satisfies a condition, not even NOT_EQUALS;
 * - string comparisons are exact and case-sensitive (Linux names and paths are);
 * - IN matches when the value equals any item; GREATER_THAN/LESS_THAN only apply to numbers;
 * - ALL needs every condition, ANY needs at least one.
 */
export function eventFieldValue(event: NormalizedEventV1, fieldId: string): DetectionScalar | undefined {
  const [namespace, key] = fieldId.split('.', 2);
  if (!namespace || !key) return undefined;
  const group = (event.data as unknown as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>)[namespace];
  const value = group?.[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function conditionHolds(condition: DetectionCondition, actual: DetectionScalar | undefined): boolean {
  if (actual === undefined) return false;
  const expected = condition.value;
  switch (condition.operator) {
    case 'EQUALS':
      return actual === expected;
    case 'NOT_EQUALS':
      return actual !== expected;
    case 'IN':
      return Array.isArray(expected) && expected.includes(actual);
    case 'CONTAINS':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'STARTS_WITH':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'ENDS_WITH':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'GREATER_THAN':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'LESS_THAN':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    default:
      return false;
  }
}

/** Whether `event` satisfies the rule definition. The caller checks category, scope and `enabled`. */
export function matchesDetection(definition: DetectionDefinitionV1, event: NormalizedEventV1): boolean {
  const results = definition.conditions.map((condition) => conditionHolds(condition, eventFieldValue(event, condition.field)));
  return definition.match === 'ALL' ? results.length > 0 && results.every(Boolean) : results.some(Boolean);
}

/** Alerts of the same rule on the same host within this window join the same open incident (ADR-053). */
export const CORRELATION_WINDOW_MS = 30 * 60_000;
