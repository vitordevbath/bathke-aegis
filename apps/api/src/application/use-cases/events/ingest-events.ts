import type { MachineAuthContext } from '../../machine-auth-context.js';
import type { EventIngestionService, IngestionResult } from '../../event-ingestion-service.js';

/**
 * Event ingestion on behalf of a paired machine. The credential decides which
 * host the events belong to; the address must agree with it. Credentials and
 * persistence stay apart: the service below only ever sees an origin.
 */
export class IngestEventsAsMachine {
  constructor(private readonly ingestion: EventIngestionService) {}

  async execute(machine: MachineAuthContext, workspaceId: string, hostId: string, events: readonly unknown[]): Promise<IngestionResult> {
    machine.requireScope('events:ingest');
    machine.requireHost(workspaceId, hostId);
    return this.ingestion.ingest({ workspaceId: machine.workspaceId, hostId: machine.hostId }, events);
  }
}
