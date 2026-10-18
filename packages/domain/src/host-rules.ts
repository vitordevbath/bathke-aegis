import { ValidationError } from './domain-error.js';

/** Limits for the user-editable Host fields, shared by the API entity and the web/API schemas. */
export const HOST_LIMITS = {
  displayNameMin: 2,
  displayNameMax: 120,
  descriptionMax: 500,
} as const;

export const HOST_DISPLAY_NAME_MESSAGE = `O nome do host deve ter entre ${HOST_LIMITS.displayNameMin} e ${HOST_LIMITS.displayNameMax} caracteres.`;
export const HOST_DESCRIPTION_MESSAGE = `A descrição deve ter no máximo ${HOST_LIMITS.descriptionMax} caracteres.`;

/** Trims and collapses whitespace; throws if outside the allowed length. */
export function normalizeHostDisplayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < HOST_LIMITS.displayNameMin || name.length > HOST_LIMITS.displayNameMax) {
    throw ValidationError.forField('displayName', HOST_DISPLAY_NAME_MESSAGE);
  }
  return name;
}

/** Trims; empty becomes null (no description). Throws if too long. */
export function normalizeHostDescription(raw: string | null | undefined): string | null {
  const description = raw?.trim() ?? '';
  if (description.length > HOST_LIMITS.descriptionMax) throw ValidationError.forField('description', HOST_DESCRIPTION_MESSAGE);
  return description.length > 0 ? description : null;
}
