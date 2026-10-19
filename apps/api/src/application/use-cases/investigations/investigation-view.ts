import { ValidationError } from '@aegis/domain';
import type { Incident } from '../../../domain/incident.js';
import type { Investigation } from '../../../domain/investigation.js';
import type { IncidentRepository } from '../../ports/repositories.js';

/** An investigation with its grouped incidents (same workspace only). */
export interface InvestigationView {
  readonly investigation: Investigation;
  readonly incidents: readonly Incident[];
}

export const UNKNOWN_INCIDENTS_MESSAGE = 'Um ou mais incidentes não existem neste workspace.';

/**
 * Loads the investigation's incidents from the investigation's own workspace
 * and fails if any is missing. Missing and foreign ids get the same message
 * (no enumeration). Called inside the transaction that writes the relations.
 */
export async function resolveIncidents(incidents: IncidentRepository, investigation: Investigation): Promise<InvestigationView> {
  const found = await incidents.findManyInWorkspace(investigation.workspaceId, investigation.incidentIds);
  if (found.length !== investigation.incidentIds.length) {
    throw new ValidationError('Investigação inválida.', [{ field: 'incidentIds', message: UNKNOWN_INCIDENTS_MESSAGE }]);
  }
  return { investigation, incidents: found };
}
