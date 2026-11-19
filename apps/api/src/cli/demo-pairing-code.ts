/**
 * Operator command (ADR-052): issues a pairing code for the real `aegis-server` host of AEGIS DEMO, so
 * the machine that runs this Aegis instance can be paired with the Aegis Collector. The demo has no
 * human OWNER; whoever can run commands on the server acts as its operator.
 *
 *   npm run demo:pairing-code -w @aegis/api                                   (development)
 *   docker compose exec api node apps/api/dist/cli/demo-pairing-code.js      (Compose stack)
 *
 * The code is printed once, to this terminal only: it is never logged, and it expires in 10 minutes.
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
  const issued = await dependencies.requestPairingCode.execute(demo.operator, demo.workspaceId, hostId);
  process.stdout.write(
    [
      'Código de pareamento do host aegis-server (AEGIS DEMO), válido até ' + issued.expiresAt.toISOString() + ':',
      '',
      `  ${issued.code}`,
      '',
      'Nesta mesma máquina, execute:',
      '  aegis-collector pair --server http://localhost:8080',
      'e cole o código quando pedido. Depois: aegis-collector run',
      '',
    ].join('\n'),
  );
} catch (error) {
  // Already paired (409): the operator unpairs the Collector on the server (`aegis-collector unpair`) or keeps it.
  process.stderr.write(`Não foi possível gerar o código: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`);
  exitCode = 1;
} finally {
  await close();
}
process.exit(exitCode);
