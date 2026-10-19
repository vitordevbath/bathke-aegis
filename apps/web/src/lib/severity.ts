import type { Severity } from '@aegis/domain';

/** One scale for rules and incidents (`@aegis/domain` SEVERITIES). */
export const SEVERITY_LABELS: Record<Severity, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' };
export const SEVERITY_LEVEL: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
