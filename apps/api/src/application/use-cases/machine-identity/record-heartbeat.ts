import { HOST_PRESENCE_POLICY, NotFoundError } from '@aegis/domain';
import type { MachineAuthContext } from '../../machine-auth-context.js';
import type { UnitOfWork } from '../../ports/repositories.js';

export interface RecordedHeartbeat {
  readonly lastSeenAt: Date;
  readonly heartbeatIntervalMs: number;
}

/**
 * A paired Collector reports that it is running. Only the host of the
 * credential can be touched, only `lastSeenAt` changes, and its value is the
 * server's clock read after the host lock, never a time sent by the client.
 * The credential is confirmed inside the transaction, like event ingestion,
 * so a heartbeat cannot commit after a revocation returned (ADR-045).
 */
export class RecordHeartbeat {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(machine: MachineAuthContext, workspaceId: string, hostId: string): Promise<RecordedHeartbeat> {
    machine.requireScope('host:heartbeat');
    machine.requireHost(workspaceId, hostId);

    return this.unitOfWork.run(async (repositories) => {
      const host = await repositories.hosts.lockInWorkspace(machine.workspaceId, machine.hostId);
      if (!host) throw new NotFoundError();
      await machine.confirmStillActive(repositories);

      const now = this.clock();
      host.recordHeartbeat(now);
      await repositories.hosts.updatePresence(host);
      return { lastSeenAt: host.lastSeenAt ?? now, heartbeatIntervalMs: HOST_PRESENCE_POLICY.heartbeatIntervalMs };
    });
  }
}
