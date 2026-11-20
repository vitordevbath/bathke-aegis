/**
 * Operator command (ADR-052): revokes the credential of the real `aegis-server` host of AEGIS DEMO, so the
 * machine that runs this instance stops reporting to the demo at once. The demo has no human OWNER to do
 * it from the panel. The Collector is then refused (exit 3); `aegis-collector unpair` cleans its config.
 *
 *   npm run demo:revoke-server -w @aegis/api                                  (development)
 *   docker compose exec api node apps/api/dist/cli/demo-revoke-server.js     (Compose stack)
 */
import { loadEnv } from '../shared/env.js';
import { createProductionDependencies } from '../composition-root.js';
import { demoProvisioner } from '../demo-runtime.js';

const env = loadEnv();
const { dependencies, adapters, close } = createProductionDependencies(env);
let exitCode = 0;
try {
  const demo = await demoProvisioner(dependencies, adapters).ensure();
  const hostId = demo.hostIds.get('server');
  if (!hostId) throw new Error('O host aegis-server não existe mais no AEGIS DEMO.');
  const pairing = await dependencies.getHostPairing.execute(demo.operator, demo.workspaceId, hostId);
  const active = pairing.credentials.filter((credential) => credential.isActive);
  for (const credential of active) {
    await dependencies.revokeMachineCredential.execute(demo.operator, demo.workspaceId, hostId, credential.id);
  }
  process.stdout.write(
    active.length > 0
      ? 'Credencial do host aegis-server revogada: a máquina parou de enviar dados ao AEGIS DEMO.\n'
      : 'O host aegis-server não tinha credencial ativa: nada a revogar.\n',
  );
} catch (error) {
  process.stderr.write(`Não foi possível revogar: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
