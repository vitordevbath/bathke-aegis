import { createHash } from 'node:crypto';
import type { User } from '../../domain/user.js';
import type { AuthenticateMachine } from '../use-cases/machine-identity/authenticate-machine.js';
import type { GetHostPairing } from '../use-cases/machine-identity/get-host-pairing.js';
import type { RecordHeartbeat } from '../use-cases/machine-identity/record-heartbeat.js';
import type { RedeemPairingCode } from '../use-cases/machine-identity/redeem-pairing-code.js';
import type { RequestPairingCode } from '../use-cases/machine-identity/request-pairing-code.js';
import type { RevokeMachineCredential } from '../use-cases/machine-identity/revoke-machine-credential.js';
import type { IngestEventsAsMachine } from '../use-cases/events/ingest-events.js';
import type { ListEvents } from '../use-cases/events/list-events.js';
import { DEMO_HOSTS, type DemoHostKey, type DemoHostSpec } from './demo-catalog.js';
import type { DemoWorkspace } from './demo-provisioner.js';

const MINUTE_MS = 60_000;
/** One simulated service change per slot, rotating through the simulated hosts (≈10 events per hour). */
export const DEMO_EVENT_SLOT_MS = 6 * MINUTE_MS;
/** The lab VM is on for 20 minutes and off for 10, so the demo also shows a host going Offline. */
const LAB_CYCLE_MS = 30 * MINUTE_MS;
const LAB_OFF_MS = 10 * MINUTE_MS;
/** Events are immutable (ADR-024): past this many in the demo, the simulator keeps heartbeats and stops adding events. */
export const DEMO_EVENT_CAP = 20_000;
const STATE_CYCLE = ['STOPPED', 'RUNNING', 'RUNNING', 'FAILED', 'RUNNING'] as const;
/** Namespace of the simulator's deterministic event ids (UUID v5). */
const NAMESPACE = 'f2c5a0d1-6c0e-4a8e-9a3b-6a1f0e2d4c77';

/** RFC 4122 v5 (SHA-1, name-based): the same name always yields the same id, so replays are deduplicated. */
export function uuidV5(name: string, namespace: string = NAMESPACE): string {
  const bytes = createHash('sha1')
    .update(Buffer.concat([Buffer.from(namespace.replace(/-/g, ''), 'hex'), Buffer.from(name, 'utf8')]))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether a simulated host is "powered on" at `now`. */
export function isSimulatedOnline(key: DemoHostKey, now: Date): boolean {
  if (key !== 'lab') return true;
  return now.getTime() % LAB_CYCLE_MS < LAB_CYCLE_MS - LAB_OFF_MS;
}

interface DemoEnvelope {
  readonly schemaVersion: 1;
  readonly sourceEventId: string;
  readonly occurredAt: string;
  readonly category: 'SYSTEM';
  readonly type: 'SYSTEM_BOOT' | 'SYSTEM_SERVICE_STATE_CHANGED';
  readonly data: { readonly system: Record<string, string> };
}

/**
 * Events due for one host at `now`, all with deterministic ids: two API instances, or a restart, produce
 * the same ids and the Event Store keeps one copy (idempotent ingestion, ADR-026).
 * - a boot at the start of each power-on period (daily for the servers, every cycle for the lab VM);
 * - the service change of the current slot, when this host owns the slot.
 */
export function dueEvents(spec: DemoHostSpec, hostIndex: number, simulatedCount: number, hostId: string, now: Date): DemoEnvelope[] {
  const events: DemoEnvelope[] = [];
  const time = now.getTime();
  const bootAt = spec.key === 'lab' ? time - (time % LAB_CYCLE_MS) : time - (time % (24 * 60 * MINUTE_MS));
  events.push({
    schemaVersion: 1,
    sourceEventId: uuidV5(`${hostId}:boot:${bootAt}`),
    occurredAt: new Date(bootAt).toISOString(),
    category: 'SYSTEM',
    type: 'SYSTEM_BOOT',
    data: { system: { eventType: 'BOOT' } },
  });

  const slot = Math.floor(time / DEMO_EVENT_SLOT_MS);
  if (slot % simulatedCount === hostIndex && spec.services.length > 0) {
    events.push({
      schemaVersion: 1,
      sourceEventId: uuidV5(`${hostId}:service:${slot}`),
      occurredAt: new Date(slot * DEMO_EVENT_SLOT_MS).toISOString(),
      category: 'SYSTEM',
      type: 'SYSTEM_SERVICE_STATE_CHANGED',
      data: {
        system: {
          eventType: 'SERVICE_STATE_CHANGED',
          serviceName: spec.services[Math.floor(slot / simulatedCount) % spec.services.length] ?? 'sshd',
          state: STATE_CYCLE[slot % STATE_CYCLE.length] ?? 'RUNNING',
        },
      },
    });
  }
  return events;
}

export interface DemoSimulatorUseCases {
  readonly getHostPairing: GetHostPairing;
  readonly revokeMachineCredential: RevokeMachineCredential;
  readonly requestPairingCode: RequestPairingCode;
  readonly redeemPairingCode: RedeemPairingCode;
  readonly authenticateMachine: AuthenticateMachine;
  readonly recordHeartbeat: RecordHeartbeat;
  readonly ingestEvents: IngestEventsAsMachine;
  readonly listEvents: ListEvents;
}

interface SimulatedHost {
  readonly spec: DemoHostSpec;
  readonly index: number;
  readonly hostId: string;
  readonly token: string;
}

/**
 * Drives the simulated demo hosts exactly like a Collector would (ADR-052): each one is paired with a
 * pairing code the operator requests, holds its own machine credential in memory, and calls the same
 * heartbeat and ingestion use cases as `POST …/heartbeat` and `POST …/events/ingest`. Nothing is written
 * around those paths. A previous credential (from an earlier process, whose secret is gone) is revoked
 * by the operator first, which leaves the usual audit trail in the credential history.
 */
export class DemoSimulator {
  private hosts: SimulatedHost[] = [];
  private eventsCapped = false;
  private lastCapCheckSlot = -1;

  constructor(
    private readonly demo: DemoWorkspace,
    private readonly useCases: DemoSimulatorUseCases,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Pairs every simulated host present in the demo. Returns how many are being simulated. */
  async start(): Promise<number> {
    const simulated = DEMO_HOSTS.filter((spec) => spec.simulated);
    this.hosts = [];
    for (const [index, spec] of simulated.entries()) {
      const hostId = this.demo.hostIds.get(spec.key);
      if (!hostId) continue;
      this.hosts.push({ spec, index, hostId, token: await this.pair(hostId) });
    }
    return this.hosts.length;
  }

  /** One heartbeat per powered-on host, plus the events due now. Errors of one host do not stop the others. */
  async tick(): Promise<{ heartbeats: number; inserted: number; failures: number }> {
    const now = this.clock();
    const operator: User = this.demo.operator;
    const workspaceId = this.demo.workspaceId;
    await this.checkCap(operator, workspaceId, now);
    let heartbeats = 0;
    let inserted = 0;
    let failures = 0;
    for (const host of this.hosts) {
      if (!isSimulatedOnline(host.spec.key, now)) continue;
      try {
        const machine = await this.useCases.authenticateMachine.execute(host.token);
        await this.useCases.recordHeartbeat.execute(machine, workspaceId, host.hostId);
        heartbeats += 1;
        if (!this.eventsCapped) {
          const events = dueEvents(host.spec, host.index, this.hosts.length, host.hostId, now);
          inserted += (await this.useCases.ingestEvents.execute(machine, workspaceId, host.hostId, events)).inserted;
        }
      } catch {
        failures += 1;
      }
    }
    return { heartbeats, inserted, failures };
  }

  private async pair(hostId: string): Promise<string> {
    const operator = this.demo.operator;
    const workspaceId = this.demo.workspaceId;
    const pairing = await this.useCases.getHostPairing.execute(operator, workspaceId, hostId);
    for (const credential of pairing.credentials.filter((item) => item.isActive)) {
      await this.useCases.revokeMachineCredential.execute(operator, workspaceId, hostId, credential.id);
    }
    const { code } = await this.useCases.requestPairingCode.execute(operator, workspaceId, hostId);
    return (await this.useCases.redeemPairingCode.execute(code)).token;
  }

  /** Re-checks the event volume once per slot. */
  private async checkCap(operator: User, workspaceId: string, now: Date): Promise<void> {
    const slot = Math.floor(now.getTime() / DEMO_EVENT_SLOT_MS);
    if (slot === this.lastCapCheckSlot) return;
    this.lastCapCheckSlot = slot;
    const page = await this.useCases.listEvents.execute(operator, workspaceId, { page: 1, pageSize: 1 });
    this.eventsCapped = page.total >= DEMO_EVENT_CAP;
  }
}
