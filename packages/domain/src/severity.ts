/**
 * Severity scale shared by every security record (detection rules, incidents).
 * One definition, so a rule and the incident it relates to always speak the
 * same scale.
 */
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
