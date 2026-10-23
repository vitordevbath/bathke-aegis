import type { User } from '../../../domain/user.js';
import type { EventIngestionService, IngestionResult } from '../../event-ingestion-service.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * USER-AUTH INGESTION (ADR-035): a temporary lab/development adapter. A
 * workspace manager sends a batch for one of the workspace's hosts. This is
 * not the Collector protocol; the planned Collector credential route will
 * call the same `EventIngestionService`.
 */
export class IngestEventsAsUser {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly ingestion: EventIngestionService,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string, events: readonly unknown[]): Promise<IngestionResult> {
    await this.access.requireManager(user, workspaceId);
    return this.ingestion.ingest({ workspaceId, hostId }, events);
  }
}
