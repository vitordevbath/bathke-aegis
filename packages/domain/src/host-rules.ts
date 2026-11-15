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

/**
 * What the platform can say about a host's Collector, from the most to the
 * least certain. Pairing (an active credential), connectivity (a recent
 * heartbeat) and telemetry (events) are separate facts:
 *
 *  - `UNPAIRED`: no active machine credential;
 *  - `PAIRED`: an active credential, but no heartbeat was ever received;
 *  - `ONLINE`: the last heartbeat is within `HOST_PRESENCE_POLICY.onlineWindowMs`;
 *  - `OFFLINE`: paired, heard from before, silent for longer than that.
 */
export const HOST_CONNECTION_STATES = ['UNPAIRED', 'PAIRED', 'ONLINE', 'OFFLINE'] as const;
export type HostConnectionState = (typeof HOST_CONNECTION_STATES)[number];

/**
 * Heartbeat timing (ADR-043). The Collector sends one every
 * `heartbeatIntervalMs` (the API tells it so in each heartbeat response); a
 * host stays `ONLINE` for three intervals, so one or two lost heartbeats do
 * not flap the state. The single definition used by the API, which derives
 * the state, and by the web, which only refreshes and explains it.
 */
export const HOST_PRESENCE_POLICY = {
  heartbeatIntervalMs: 30_000,
  onlineWindowMs: 90_000,
} as const;

/**
 * Derives the connection state from facts the server owns: whether an active
 * credential exists and when the server's own clock last recorded a
 * heartbeat. Nothing is persisted as ONLINE/OFFLINE, so the state can never
 * outlive the heartbeat that justified it.
 */
export function hostConnectionStateOf(input: { readonly paired: boolean; readonly lastSeenAt: Date | null }, now: Date): HostConnectionState {
  if (!input.paired) return 'UNPAIRED';
  if (!input.lastSeenAt) return 'PAIRED';
  return now.getTime() - input.lastSeenAt.getTime() < HOST_PRESENCE_POLICY.onlineWindowMs ? 'ONLINE' : 'OFFLINE';
}
