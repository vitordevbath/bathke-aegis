import { DomainError, type FieldIssue } from './domain-error.js';

/**
 * Aegis Event Contract v1 — the normalized, OS-independent shape of a
 * telemetry fact observed on an authorized host. Events are metadata only:
 * no command lines, arguments, environment, file contents, network payloads,
 * credentials or keystrokes exist anywhere in this contract.
 *
 * Every event type is described by an entry in `EVENT_DEFINITIONS`; the
 * validator, the fingerprint and the ingestion pipeline are generic over that
 * registry, so a new type is added by declaring its definition (and its
 * TypeScript shape) without touching the pipeline.
 */

export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_CATEGORIES = ['PROCESS', 'NETWORK', 'SYSTEM'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_TYPES = [
  'PROCESS_STARTED',
  'PROCESS_EXITED',
  'NETWORK_CONNECTION',
  'NETWORK_LISTEN',
  'SYSTEM_BOOT',
  'SYSTEM_SERVICE_STATE_CHANGED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const NETWORK_PROTOCOLS = ['TCP', 'UDP'] as const;
export type NetworkProtocol = (typeof NETWORK_PROTOCOLS)[number];

/** Value of `system.eventType`: fixed by the event type, kept as a detectable field. */
export const SYSTEM_EVENT_KINDS = ['BOOT', 'SERVICE_STATE_CHANGED'] as const;
export type SystemEventKind = (typeof SYSTEM_EVENT_KINDS)[number];

/** Portable service states (systemd units, Windows services, launchd jobs). */
export const SERVICE_STATES = ['STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export interface ProcessData {
  readonly pid: number;
  readonly parentPid: number | null;
  readonly name: string;
  readonly executable: string;
  readonly parentName: string | null;
  readonly user: string | null;
}

export interface NetworkData {
  readonly protocol: NetworkProtocol;
  readonly localAddress: string | null;
  readonly localPort: number | null;
  readonly remoteAddress: string | null;
  readonly remotePort: number | null;
  readonly pid: number | null;
  readonly processName: string | null;
}

export interface SystemData {
  readonly eventType: SystemEventKind;
  readonly serviceName: string | null;
  readonly state: ServiceState | null;
}

export interface ProcessStartedEventV1 {
  readonly category: 'PROCESS';
  readonly type: 'PROCESS_STARTED';
  readonly data: { readonly process: ProcessData };
}
export interface ProcessExitedEventV1 {
  readonly category: 'PROCESS';
  readonly type: 'PROCESS_EXITED';
  readonly data: { readonly process: ProcessData };
}
export interface NetworkConnectionEventV1 {
  readonly category: 'NETWORK';
  readonly type: 'NETWORK_CONNECTION';
  readonly data: { readonly network: NetworkData };
}
export interface NetworkListenEventV1 {
  readonly category: 'NETWORK';
  readonly type: 'NETWORK_LISTEN';
  readonly data: { readonly network: NetworkData };
}
export interface SystemBootEventV1 {
  readonly category: 'SYSTEM';
  readonly type: 'SYSTEM_BOOT';
  readonly data: { readonly system: SystemData };
}
export interface SystemServiceStateChangedEventV1 {
  readonly category: 'SYSTEM';
  readonly type: 'SYSTEM_SERVICE_STATE_CHANGED';
  readonly data: { readonly system: SystemData };
}

/** Discriminated by `type` (and `category`): the typed body of every v1 event. */
export type EventBodyV1 =
  | ProcessStartedEventV1
  | ProcessExitedEventV1
  | NetworkConnectionEventV1
  | NetworkListenEventV1
  | SystemBootEventV1
  | SystemServiceStateChangedEventV1;

/** A validated event as sent by a source: envelope + typed body. Server fields (id, host, workspace, ingestedAt) are not here. */
export type NormalizedEventV1 = {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  /** UUID chosen by the source, lower-case; identifies the same fact across retries. */
  readonly sourceEventId: string;
  /** UTC, ISO 8601 with milliseconds. */
  readonly occurredAt: string;
} & EventBodyV1;

// ── Field catalog: the single list of event fields, also used by detection rules ──

export type EventNamespace = 'process' | 'network' | 'system';

export const EVENT_CATEGORY_NAMESPACE: Readonly<Record<EventCategory, EventNamespace>> = {
  PROCESS: 'process',
  NETWORK: 'network',
  SYSTEM: 'system',
};

export type EventFieldValue =
  | { readonly kind: 'string'; readonly maxLength: number }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'ip' };

export interface EventFieldSpec {
  /** Dotted path, e.g. `process.name` — the id detection rules reference. */
  readonly id: string;
  readonly namespace: EventNamespace;
  readonly key: string;
  readonly value: EventFieldValue;
  /** Whether detection rule conditions may reference the field. */
  readonly detectable: boolean;
}

const PID = { kind: 'integer', min: 1, max: 4_294_967_295 } as const;
const PORT = { kind: 'integer', min: 0, max: 65_535 } as const;
const NAME = { kind: 'string', maxLength: 255 } as const;

const field = (namespace: EventNamespace, key: string, value: EventFieldValue, detectable: boolean): EventFieldSpec => ({
  id: `${namespace}.${key}`,
  namespace,
  key,
  value,
  detectable,
});

/** Order matters: it is the canonical key order of stored payloads (and of the fingerprint). */
export const EVENT_FIELDS: readonly EventFieldSpec[] = [
  field('process', 'pid', PID, false),
  field('process', 'parentPid', { kind: 'integer', min: 0, max: PID.max }, false),
  field('process', 'name', NAME, true),
  field('process', 'executable', { kind: 'string', maxLength: 4096 }, true),
  field('process', 'parentName', NAME, true),
  field('process', 'user', { kind: 'string', maxLength: 256 }, true),
  field('network', 'protocol', { kind: 'enum', values: NETWORK_PROTOCOLS }, true),
  field('network', 'localAddress', { kind: 'ip' }, false),
  field('network', 'localPort', PORT, true),
  field('network', 'remoteAddress', { kind: 'ip' }, true),
  field('network', 'remotePort', PORT, true),
  field('network', 'pid', PID, false),
  field('network', 'processName', NAME, true),
  field('system', 'eventType', { kind: 'enum', values: SYSTEM_EVENT_KINDS }, true),
  field('system', 'serviceName', { kind: 'string', maxLength: 256 }, true),
  field('system', 'state', { kind: 'enum', values: SERVICE_STATES }, false),
];

export const eventFieldsOf = (namespace: EventNamespace): readonly EventFieldSpec[] => EVENT_FIELDS.filter((spec) => spec.namespace === namespace);

// ── Event type registry ──

/** `required`: non-null value; `optional`: value or null/absent; `absent`: must be null/absent; `{ equals }`: fixed value. */
export type FieldPresence = 'required' | 'optional' | 'absent' | { readonly equals: string };

export interface EventTypeDefinition {
  readonly type: EventType;
  readonly category: EventCategory;
  /** Presence rule for every field of the category's namespace. */
  readonly fields: Readonly<Record<string, FieldPresence>>;
  /** Short, language-neutral technical line for lists (never the full payload). */
  readonly summarize: (get: (key: string) => string | number | null) => string;
}

const processFields = { pid: 'required', parentPid: 'optional', name: 'required', executable: 'required', parentName: 'optional', user: 'optional' } as const;
const endpoint = (address: string | number | null, port: string | number | null) => `${address ?? '*'}:${port ?? '*'}`;
const processSummary = (get: (key: string) => string | number | null) => `${get('name')} (pid ${get('pid')})`;

export const EVENT_DEFINITIONS: Readonly<Record<EventType, EventTypeDefinition>> = {
  PROCESS_STARTED: { type: 'PROCESS_STARTED', category: 'PROCESS', fields: processFields, summarize: processSummary },
  PROCESS_EXITED: { type: 'PROCESS_EXITED', category: 'PROCESS', fields: processFields, summarize: processSummary },
  NETWORK_CONNECTION: {
    type: 'NETWORK_CONNECTION',
    category: 'NETWORK',
    fields: {
      protocol: 'required',
      localAddress: 'optional',
      localPort: 'optional',
      remoteAddress: 'required',
      remotePort: 'required',
      pid: 'optional',
      processName: 'optional',
    },
    summarize: (get) => `${get('protocol')} ${endpoint(get('localAddress'), get('localPort'))} → ${endpoint(get('remoteAddress'), get('remotePort'))}`,
  },
  NETWORK_LISTEN: {
    type: 'NETWORK_LISTEN',
    category: 'NETWORK',
    fields: { protocol: 'required', localAddress: 'optional', localPort: 'required', remoteAddress: 'absent', remotePort: 'absent', pid: 'optional', processName: 'optional' },
    summarize: (get) => `${get('protocol')} ${endpoint(get('localAddress'), get('localPort'))} LISTEN`,
  },
  SYSTEM_BOOT: {
    type: 'SYSTEM_BOOT',
    category: 'SYSTEM',
    fields: { eventType: { equals: 'BOOT' }, serviceName: 'absent', state: 'absent' },
    summarize: () => 'BOOT',
  },
  SYSTEM_SERVICE_STATE_CHANGED: {
    type: 'SYSTEM_SERVICE_STATE_CHANGED',
    category: 'SYSTEM',
    fields: { eventType: { equals: 'SERVICE_STATE_CHANGED' }, serviceName: 'required', state: 'required' },
    summarize: (get) => `${get('serviceName')} → ${get('state')}`,
  },
};

export const EVENT_TYPES_BY_CATEGORY: Readonly<Record<EventCategory, readonly EventType[]>> = {
  PROCESS: EVENT_TYPES.filter((type) => EVENT_DEFINITIONS[type].category === 'PROCESS'),
  NETWORK: EVENT_TYPES.filter((type) => EVENT_DEFINITIONS[type].category === 'NETWORK'),
  SYSTEM: EVENT_TYPES.filter((type) => EVENT_DEFINITIONS[type].category === 'SYSTEM'),
};

export const EVENT_LIMITS = {
  maxBatch: 100,
  /** Accepted clock skew for `occurredAt` in the future. */
  maxFutureSkewMs: 5 * 60_000,
} as const;

/** A source reused a `sourceEventId` for different content on the same host. Events are immutable. */
export class EventIdConflictError extends DomainError {
  override readonly code = 'EVENT_ID_CONFLICT';

  constructor(
    readonly field: string,
    message = 'Este sourceEventId já foi recebido com conteúdo diferente; eventos são imutáveis.',
  ) {
    super(message);
  }
}

// ── Validation ──

export type EventValidation = { readonly ok: true; readonly event: NormalizedEventV1 } | { readonly ok: false; readonly issues: readonly FieldIssue[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

function isIpv6(value: string): boolean {
  if (!value.includes(':') || value.length > 45) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

/** RFC 3339 with an explicit offset; rejects impossible dates (e.g. Feb 30). Returns the UTC instant or null. */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = RFC3339.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const local = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 0, h ?? 0, mi ?? 0, s ?? 0));
  if (local.getUTCMonth() !== (mo ?? 0) - 1 || local.getUTCDate() !== d || local.getUTCHours() !== h || local.getUTCMinutes() !== mi) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function checkValue(spec: EventFieldSpec, value: unknown): string | null {
  switch (spec.value.kind) {
    case 'string':
      if (typeof value !== 'string' || value.length === 0) return 'Informe um texto.';
      if (value.length > spec.value.maxLength) return `No máximo ${spec.value.maxLength} caracteres.`;
      if (CONTROL.test(value)) return 'Caracteres de controle não são permitidos.';
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Informe um número inteiro.';
      return value < spec.value.min || value > spec.value.max ? `Informe um número entre ${spec.value.min} e ${spec.value.max}.` : null;
    case 'enum':
      return oneOf(spec.value.values, value) ? null : `Valor inválido; use ${spec.value.values.join(', ')}.`;
    case 'ip':
      return typeof value === 'string' && (IPV4.test(value) || isIpv6(value)) ? null : 'Endereço IP inválido.';
  }
}

/**
 * The single validator of incoming events. Strict: unknown properties at any
 * level are rejected, never dropped silently. Returns the normalized event
 * (canonical key order, nulls for missing optional fields, UTC timestamp,
 * lower-case source id) or field issues addressed relative to the event.
 * `now` enables the future clock-skew check (omitted when re-reading storage).
 */
export function validateEvent(raw: unknown, now?: Date): EventValidation {
  const issues: FieldIssue[] = [];
  const add = (fieldPath: string, message: string) => issues.push({ field: fieldPath, message });
  if (!isRecord(raw)) return { ok: false, issues: [{ field: '', message: 'Evento inválido.' }] };

  for (const key of Object.keys(raw)) {
    if (!['schemaVersion', 'sourceEventId', 'occurredAt', 'category', 'type', 'data'].includes(key)) add(key, 'Propriedade não permitida.');
  }
  if (raw['schemaVersion'] !== EVENT_SCHEMA_VERSION) add('schemaVersion', `Versão de esquema não suportada; use ${EVENT_SCHEMA_VERSION}.`);
  const sourceEventId = raw['sourceEventId'];
  if (typeof sourceEventId !== 'string' || !UUID.test(sourceEventId)) add('sourceEventId', 'Informe um UUID.');
  const occurredAt = parseTimestamp(raw['occurredAt']);
  if (!occurredAt) add('occurredAt', 'Informe data e hora RFC 3339 com fuso (ex.: 2026-05-01T10:00:00Z).');
  else if (now && occurredAt.getTime() > now.getTime() + EVENT_LIMITS.maxFutureSkewMs) add('occurredAt', 'Data no futuro além da tolerância de 5 minutos.');

  const type = raw['type'];
  const category = raw['category'];
  if (!oneOf(EVENT_CATEGORIES, category)) add('category', 'Categoria inválida.');
  if (!oneOf(EVENT_TYPES, type)) {
    add('type', 'Tipo de evento inválido.');
    return { ok: false, issues };
  }
  const definition = EVENT_DEFINITIONS[type];
  if (oneOf(EVENT_CATEGORIES, category) && category !== definition.category) add('type', `O tipo ${type} pertence à categoria ${definition.category}.`);

  const namespace = EVENT_CATEGORY_NAMESPACE[definition.category];
  const data = raw['data'];
  const fields: Record<string, string | number | null> = {};
  if (!isRecord(data)) {
    add('data', 'Dados do evento inválidos.');
  } else {
    for (const key of Object.keys(data)) if (key !== namespace) add(`data.${key}`, 'Propriedade não permitida.');
    const body = data[namespace];
    if (!isRecord(body)) {
      add(`data.${namespace}`, 'Dados do evento inválidos.');
    } else {
      const specs = eventFieldsOf(namespace);
      for (const key of Object.keys(body)) {
        if (!specs.some((spec) => spec.key === key)) add(`data.${namespace}.${key}`, 'Propriedade não permitida.');
      }
      for (const spec of specs) {
        const presence = definition.fields[spec.key] ?? 'absent';
        const value = body[spec.key] ?? null;
        const at = `data.${spec.id}`;
        if (presence === 'absent') {
          if (value !== null) add(at, 'Campo não se aplica a este tipo de evento.');
          fields[spec.key] = null;
          continue;
        }
        if (value === null) {
          if (presence !== 'optional') add(at, 'Campo obrigatório.');
          fields[spec.key] = null;
          continue;
        }
        const problem = checkValue(spec, value);
        if (problem) add(at, problem);
        else if (typeof presence === 'object' && value !== presence.equals) add(at, `Para ${type}, use ${presence.equals}.`);
        fields[spec.key] = typeof value === 'string' || typeof value === 'number' ? value : null;
      }
    }
  }

  if (issues.length > 0 || !occurredAt || typeof sourceEventId !== 'string') return { ok: false, issues };
  // The one bridge from the generic, registry-driven checks above to the typed
  // union: every field was validated against its definition, so the object has
  // exactly the shape of its `type` (covered by tests for every v1 type).
  const normalized = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    sourceEventId: sourceEventId.toLowerCase(),
    occurredAt: occurredAt.toISOString(),
    category: definition.category,
    type,
    data: { [namespace]: fields },
  };
  return { ok: true, event: normalized as unknown as NormalizedEventV1 };
}

/** Language-neutral one-line summary of a validated event (from its definition). */
export function summarizeEvent(event: EventBodyV1): string {
  const body: object = Object.values(event.data)[0] ?? {};
  const get = (key: string): string | number | null => {
    const value: unknown = (body as Record<string, unknown>)[key];
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  };
  return EVENT_DEFINITIONS[event.type].summarize(get);
}
