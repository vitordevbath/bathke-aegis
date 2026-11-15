import { z } from 'zod';
import type { MachineScope } from '@aegis/domain';
import { UNKNOWN_FIELD_MESSAGE } from './fields.js';

export { MACHINE_SCOPE_LABELS, MACHINE_SCOPES, type MachineScope } from '@aegis/domain';

/**
 * Body of `POST /agent/pair`. Only the code: workspace and host come from the
 * challenge stored on the server, never from the client. The length cap keeps
 * oversized input away from the hash; the code's format is checked by the use
 * case so a wrong value gets the same answer as an unknown one.
 */
export const PairAgentRequestSchema = z.object({ code: z.string().min(1).max(128) }).strict(UNKNOWN_FIELD_MESSAGE);
export type PairAgentRequest = z.input<typeof PairAgentRequestSchema>;

/** Returned once, to the machine that redeemed the code. `token` cannot be retrieved again. */
export interface PairAgentResponse {
  readonly token: string;
  readonly tokenType: 'Bearer';
  readonly credentialId: string;
  readonly workspaceId: string;
  readonly hostId: string;
  readonly scopes: readonly MachineScope[];
}

/** Returned once, to the OWNER who requested it. `code` cannot be retrieved again. */
export interface PairingCodeResponse {
  readonly code: string;
  readonly expiresAt: string;
}

export const MACHINE_CREDENTIAL_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type MachineCredentialStatus = (typeof MACHINE_CREDENTIAL_STATUSES)[number];

/** Administrative view of a credential: public metadata only, never the token, secret or hash. */
export interface MachineCredentialResponse {
  readonly id: string;
  readonly tokenPrefix: string;
  readonly scopes: readonly MachineScope[];
  readonly status: MachineCredentialStatus;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly rotatedFromCredentialId: string | null;
}

/**
 * `GET /workspaces/:workspaceId/hosts/:hostId/pairing`. A pending code is
 * reported by its internal id (to cancel it) and expiry, never by its value.
 */
export interface HostPairingResponse {
  readonly pendingCode: { readonly id: string; readonly expiresAt: string } | null;
  readonly activeCredential: MachineCredentialResponse | null;
  /** Most recent first, bounded; includes the active credential. */
  readonly credentials: readonly MachineCredentialResponse[];
}

/** Returned once by a rotation. `token` cannot be retrieved again. */
export interface RotateCredentialResponse {
  readonly token: string;
  readonly tokenType: 'Bearer';
  readonly credential: MachineCredentialResponse;
}

/**
 * Body of `POST /workspaces/:workspaceId/hosts/:hostId/heartbeat`: nothing.
 * The server's clock is the only time source and the credential names the
 * host, so the client has nothing to choose. Any property is refused.
 */
export const HeartbeatRequestSchema = z.object({}).strict(UNKNOWN_FIELD_MESSAGE);

/** Small and fixed. `heartbeatIntervalSeconds` tells the Collector when to call again. */
export interface HeartbeatResponse {
  readonly lastSeenAt: string;
  readonly heartbeatIntervalSeconds: number;
}
