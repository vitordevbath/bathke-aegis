import { HOST_PRESENCE_POLICY } from '@aegis/domain';
import type { FastifyBaseLogger } from 'fastify';
import { DemoProvisioner, type DemoWorkspace } from './application/demo/demo-provisioner.js';
import { DemoSimulator } from './application/demo/demo-simulator.js';
import type { Adapters } from './composition-root.js';
import type { AppDependencies } from './presentation/http/app.js';

export function demoProvisioner(dependencies: AppDependencies, adapters: Adapters): DemoProvisioner {
  return new DemoProvisioner(adapters.repositories, adapters.unitOfWork, adapters.hasher, dependencies);
}

/**
 * Provisions AEGIS DEMO and starts its simulator (ADR-052). Never takes the API down: a failure is
 * logged and the API keeps serving the personal workspaces. Returns a stop function.
 */
export async function startDemo(dependencies: AppDependencies, adapters: Adapters, log: FastifyBaseLogger): Promise<() => void> {
  let demo: DemoWorkspace;
  let simulator: DemoSimulator;
  try {
    demo = await demoProvisioner(dependencies, adapters).ensure();
    simulator = new DemoSimulator(demo, dependencies);
    const simulated = await simulator.start();
    log.info({ created: demo.created, viewersAdded: demo.viewersAdded, simulated }, 'AEGIS DEMO ready');
  } catch (error) {
    log.warn({ err: { type: error instanceof Error ? error.name : typeof error } }, 'AEGIS DEMO unavailable');
    return () => undefined;
  }

  const run = () =>
    simulator.tick().then(
      (result) => result.failures > 0 && log.warn({ failures: result.failures }, 'AEGIS DEMO simulator: some hosts failed this cycle'),
      (error: unknown) => log.warn({ err: { type: error instanceof Error ? error.name : typeof error } }, 'AEGIS DEMO simulator cycle failed'),
    );
  void run();
  const timer = setInterval(() => void run(), HOST_PRESENCE_POLICY.heartbeatIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
