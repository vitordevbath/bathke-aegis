import { randomUUID } from 'node:crypto';
import {
  DETECTION_EVENT_CATEGORIES,
  DETECTION_RULE_LIMITS,
  DETECTION_SCOPES,
  DETECTION_SEVERITIES,
  Entity,
  ValidationError,
  validateDetectionDefinition,
  type DetectionDefinitionV1,
  type DetectionEventCategory,
  type DetectionScope,
  type DetectionSeverity,
  type FieldIssue,
} from '@aegis/domain';

/** Everything a user may set on a rule (PUT replaces all of it). */
export interface DetectionRuleDetails {
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly severity: DetectionSeverity;
  readonly enabled: boolean;
  readonly eventCategory: DetectionEventCategory;
  readonly scope: DetectionScope;
  /** Must be empty for ALL_HOSTS and non-empty, without duplicates, for SELECTED_HOSTS. */
  readonly targetHostIds: readonly string[];
  /** Untrusted until validated against the category. */
  readonly definition: unknown;
}

export interface DetectionRuleSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly severity: DetectionSeverity;
  readonly enabled: boolean;
  readonly eventCategory: DetectionEventCategory;
  readonly scope: DetectionScope;
  readonly definition: DetectionDefinitionV1;
  readonly targetHostIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ValidDetails {
  readonly name: string;
  readonly description: string | null;
  readonly severity: DetectionSeverity;
  readonly enabled: boolean;
  readonly eventCategory: DetectionEventCategory;
  readonly scope: DetectionScope;
  readonly targetHostIds: readonly string[];
  readonly definition: DetectionDefinitionV1;
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Checks every invariant at once so callers get all field issues together. */
function validate(details: DetectionRuleDetails): ValidDetails {
  const issues: FieldIssue[] = [];
  const name = details.name.trim().replace(/\s+/g, ' ');
  if (name.length < DETECTION_RULE_LIMITS.nameMin || name.length > DETECTION_RULE_LIMITS.nameMax) {
    issues.push({ field: 'name', message: `O nome deve ter entre ${DETECTION_RULE_LIMITS.nameMin} e ${DETECTION_RULE_LIMITS.nameMax} caracteres.` });
  }
  const description = details.description?.trim() || null;
  if (description && description.length > DETECTION_RULE_LIMITS.descriptionMax) {
    issues.push({ field: 'description', message: `A descrição deve ter no máximo ${DETECTION_RULE_LIMITS.descriptionMax} caracteres.` });
  }
  if (!oneOf(DETECTION_SEVERITIES, details.severity)) issues.push({ field: 'severity', message: 'Severidade inválida.' });
  if (!oneOf(DETECTION_SCOPES, details.scope)) issues.push({ field: 'scope', message: 'Escopo inválido.' });

  if (details.scope === 'SELECTED_HOSTS' && details.targetHostIds.length === 0) {
    issues.push({ field: 'hostIds', message: 'Selecione pelo menos um host.' });
  }
  if (details.scope === 'ALL_HOSTS' && details.targetHostIds.length > 0) {
    issues.push({ field: 'hostIds', message: 'Uma regra para todos os hosts não deve listar hosts.' });
  }
  if (new Set(details.targetHostIds).size !== details.targetHostIds.length) {
    issues.push({ field: 'hostIds', message: 'Há hosts repetidos.' });
  }

  let definition: DetectionDefinitionV1 | undefined;
  if (!oneOf(DETECTION_EVENT_CATEGORIES, details.eventCategory)) {
    issues.push({ field: 'eventCategory', message: 'Categoria inválida.' });
  } else {
    const result = validateDetectionDefinition(details.eventCategory, details.definition);
    if (result.ok) definition = result.definition;
    else issues.push(...result.issues);
  }

  if (issues.length > 0 || !definition) throw new ValidationError('Regra de detecção inválida.', issues);
  return { ...details, name, description, definition, targetHostIds: [...details.targetHostIds] };
}

/**
 * Declarative detection rule owned by a workspace. This is configuration
 * only: nothing evaluates rules yet (no event ingestion exists). `enabled`
 * means "ready to be used once the detection engine runs".
 */
export class DetectionRule extends Entity<string> {
  readonly #workspaceId: string;
  #details: ValidDetails;
  readonly #createdAt: Date;
  #updatedAt: Date;

  private constructor(id: string, workspaceId: string, details: ValidDetails, createdAt: Date, updatedAt: Date) {
    super(id);
    this.#workspaceId = workspaceId;
    this.#details = details;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
  }

  static register(workspaceId: string, details: DetectionRuleDetails, now: Date = new Date()): DetectionRule {
    return new DetectionRule(randomUUID(), workspaceId, validate(details), now, now);
  }

  /** Rehydrates and re-validates — a definition that no longer passes the schema is refused. */
  static restore(snapshot: DetectionRuleSnapshot): DetectionRule {
    const { id, workspaceId, createdAt, updatedAt, ...details } = snapshot;
    return new DetectionRule(id, workspaceId, validate(details), createdAt, updatedAt);
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get name(): string {
    return this.#details.name;
  }

  get enabled(): boolean {
    return this.#details.enabled;
  }

  get scope(): DetectionScope {
    return this.#details.scope;
  }

  get targetHostIds(): readonly string[] {
    return this.#details.targetHostIds;
  }

  get definition(): DetectionDefinitionV1 {
    return this.#details.definition;
  }

  /** Full replacement of the user-editable fields. Disabling keeps the definition intact. */
  update(details: DetectionRuleDetails, now: Date = new Date()): void {
    this.#details = validate(details);
    this.#updatedAt = now;
  }

  toSnapshot(): DetectionRuleSnapshot {
    return { id: this.id, workspaceId: this.#workspaceId, ...this.#details, createdAt: this.#createdAt, updatedAt: this.#updatedAt };
  }
}
