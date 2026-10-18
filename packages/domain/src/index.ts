export { Entity } from './entity.js';
export {
  DomainError,
  ValidationError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type FieldIssue,
} from './domain-error.js';
export { Email } from './email.js';
export { Cpf } from './cpf.js';
export { PasswordPolicy, type PasswordRule, type PasswordRuleId } from './password-policy.js';
export {
  HOST_LIMITS,
  HOST_DISPLAY_NAME_MESSAGE,
  HOST_DESCRIPTION_MESSAGE,
  normalizeHostDisplayName,
  normalizeHostDescription,
} from './host-rules.js';
export {
  DETECTION_SEVERITIES,
  DETECTION_EVENT_CATEGORIES,
  DETECTION_SCOPES,
  DETECTION_MATCH_MODES,
  DETECTION_OPERATORS,
  DETECTION_FIELDS,
  DETECTION_OPERATORS_BY_TYPE,
  DETECTION_LIMITS,
  DETECTION_RULE_LIMITS,
  detectionFieldSpec,
  validateDetectionDefinition,
  type DetectionSeverity,
  type DetectionEventCategory,
  type DetectionScope,
  type DetectionMatchMode,
  type DetectionOperator,
  type DetectionFieldType,
  type DetectionFieldSpec,
  type DetectionScalar,
  type DetectionValue,
  type DetectionCondition,
  type DetectionDefinitionV1,
  type DefinitionValidation,
} from './detection-rule-schema.js';
