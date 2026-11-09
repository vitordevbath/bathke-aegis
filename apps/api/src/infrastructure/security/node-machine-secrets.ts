import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MACHINE_SECRET_BYTES } from '@aegis/domain';
import type { MachineSecrets } from '../../application/ports/machine-secrets.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * SHA-256 is the right tool here and would be the wrong one for passwords: the
 * input already has 256 bits of entropy, so there is nothing for a slow KDF to
 * protect, and every machine request must stay cheap.
 */
export class NodeMachineSecrets implements MachineSecrets {
  generate(): string {
    return randomBytes(MACHINE_SECRET_BYTES).toString('base64url');
  }

  hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  matches(secret: string, expectedHash: string): boolean {
    if (!SHA256_HEX.test(expectedHash)) return false;
    return timingSafeEqual(Buffer.from(this.hash(secret), 'hex'), Buffer.from(expectedHash, 'hex'));
  }
}
