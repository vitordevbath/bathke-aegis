import { AuthenticationError, ForbiddenError, InvalidStateError, ValidationError } from './domain-error.js';

/**
 * Rules of machine identity (ADR-037–042), independent of HTTP, JWT and
 * storage. A machine credential belongs to exactly one host and can do only
 * what its scopes name; pairing codes are the temporary, single-use
 * authorization that produces one.
 */

/** Closed list of what a machine may do. A new capability is a new entry here, used by the operation that needs it. */
export const MACHINE_SCOPES = ['events:ingest'] as const;
export type MachineScope = (typeof MACHINE_SCOPES)[number];

/** Scopes granted when a host is paired: the minimum a Collector needs today. */
export const DEFAULT_MACHINE_SCOPES: readonly MachineScope[] = ['events:ingest'];

export const MACHINE_SCOPE_LABELS: Readonly<Record<MachineScope, string>> = {
  'events:ingest': 'Enviar eventos deste host',
};

export function isMachineScope(value: unknown): value is MachineScope {
  return typeof value === 'string' && (MACHINE_SCOPES as readonly string[]).includes(value);
}

/** Validates a stored or requested scope set: non-empty, known values only, no repeats. Fails closed. */
export function parseMachineScopes(raw: unknown): MachineScope[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isMachineScope) || new Set(raw).size !== raw.length) {
    throw ValidationError.forField('scopes', 'Conjunto de escopos inválido.');
  }
  return [...raw];
}

export const PAIRING_POLICY = {
  /** How long a pairing code stays valid. */
  codeTtlMs: 10 * 60_000,
  /** Window of the per-host limit on requested codes. */
  codeRequestWindowMs: 60 * 60_000,
} as const;

/** `lastUsedAt` is written at most once per interval, so authenticating stays cheap. */
export const CREDENTIAL_LAST_USED_RESOLUTION_MS = 60_000;

/** Revoked credentials shown next to the active one; the rows themselves are kept. */
export const CREDENTIAL_HISTORY_LIMIT = 20;

/** 256 bits from a CSPRNG; base64url without padding is exactly 43 characters. */
export const MACHINE_SECRET_BYTES = 32;
const SECRET = '[A-Za-z0-9_-]{43}';

export const PAIRING_CODE_PREFIX = 'aegis_pair_';
const PAIRING_CODE_PATTERN = new RegExp(`^${PAIRING_CODE_PREFIX}${SECRET}$`);

export const MACHINE_TOKEN_PREFIX = 'aegis_agent_';
const MACHINE_TOKEN_PATTERN = new RegExp(`^${MACHINE_TOKEN_PREFIX}([0-9a-f]{32})\\.(${SECRET})$`);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function formatPairingCode(secret: string): string {
  return `${PAIRING_CODE_PREFIX}${secret}`;
}

export function isPairingCodeFormat(value: string): boolean {
  return PAIRING_CODE_PATTERN.test(value);
}

/** The public id travels with the secret so a credential is found without scanning hashes. */
export function formatMachineToken(credentialId: string, secret: string): string {
  if (!UUID_PATTERN.test(credentialId)) throw ValidationError.forField('credentialId', 'Identificador de credencial inválido.');
  return `${MACHINE_TOKEN_PREFIX}${credentialId.replaceAll('-', '')}.${secret}`;
}

export interface ParsedMachineToken {
  readonly credentialId: string;
  readonly secret: string;
}

/** Splits a token into its public id and secret, or null when it is not a machine token at all. */
export function parseMachineToken(raw: string): ParsedMachineToken | null {
  const match = MACHINE_TOKEN_PATTERN.exec(raw);
  const [, hex, secret] = match ?? [];
  if (!hex || !secret) return null;
  const credentialId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { credentialId, secret };
}

/** Non-secret label for administrators: derived from the public id, so it reveals nothing about the secret. */
export function machineTokenPrefixOf(credentialId: string): string {
  return `${MACHINE_TOKEN_PREFIX}${credentialId.replaceAll('-', '').slice(0, 8)}`;
}

export const PAIRING_REJECTED_MESSAGE = 'Código de pareamento inválido ou expirado.';
export const MACHINE_SCOPE_MISSING_MESSAGE = 'Esta credencial não permite esta ação.';
export const HOST_ALREADY_PAIRED_MESSAGE = 'Este host já possui uma credencial ativa. Rotacione ou revogue essa credencial antes de gerar um novo código.';
export const CREDENTIAL_REVOKED_MESSAGE = 'Esta credencial já foi revogada e não pode ser rotacionada. Pareie o host novamente.';
export const PAIRING_CODE_LIMIT_MESSAGE = 'Muitos códigos solicitados para este host. Aguarde e tente novamente.';

export type PairingRejectionReason = 'MALFORMED' | 'UNKNOWN_CODE' | 'EXPIRED' | 'CONSUMED' | 'REVOKED' | 'HOST_UNAVAILABLE' | 'HOST_ALREADY_PAIRED';

/** Internal identifiers for the audit log; never part of a response. */
export interface PairingRejectionAudit {
  readonly challengeId?: string;
  readonly workspaceId?: string;
  readonly hostId?: string;
}

/**
 * A pairing code was refused. Callers always see the same message; `reason`
 * and `audit` exist only for the audit log.
 */
export class PairingRejectedError extends AuthenticationError {
  constructor(
    readonly reason: PairingRejectionReason,
    readonly audit: PairingRejectionAudit = {},
  ) {
    super(PAIRING_REJECTED_MESSAGE);
  }
}

export type MachineAuthFailureReason = 'MALFORMED' | 'UNKNOWN_CREDENTIAL' | 'BAD_SECRET' | 'REVOKED';

/**
 * A machine token was refused, with the same generic message as any other 401.
 * `credentialId` is set only when the token matched a stored credential.
 */
export class MachineAuthenticationError extends AuthenticationError {
  constructor(
    readonly reason: MachineAuthFailureReason,
    readonly credentialId?: string,
  ) {
    super();
  }
}

/** The credential is genuine, but its scopes do not cover the operation. */
export class MachineScopeError extends ForbiddenError {
  constructor(readonly scope: MachineScope) {
    super(MACHINE_SCOPE_MISSING_MESSAGE);
  }
}

export class HostAlreadyPairedError extends InvalidStateError {
  constructor() {
    super(HOST_ALREADY_PAIRED_MESSAGE);
  }
}

export class CredentialRevokedError extends InvalidStateError {
  constructor() {
    super(CREDENTIAL_REVOKED_MESSAGE);
  }
}
