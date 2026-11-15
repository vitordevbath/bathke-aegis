import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { trustOnlyNginx } from '../../src/presentation/http/trust-proxy.js';

/**
 * Rate limits are keyed by `request.ip`. Behind Nginx (`$proxy_add_x_forwarded_for`)
 * the last X-Forwarded-For entry is the address Nginx saw; anything before it was
 * written by the client and must not be trusted.
 */
describe('trusted proxy', () => {
  it('uses the address Nginx appended, never one the client wrote', async () => {
    const app = Fastify({ trustProxy: trustOnlyNginx });
    app.get('/ip', async (request) => ({ ip: request.ip }));
    try {
      const spoofed = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '172.20.0.5', headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.23' } });
      expect(spoofed.json()).toEqual({ ip: '198.51.100.23' });
      const direct = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '172.20.0.5' });
      expect(direct.json()).toEqual({ ip: '172.20.0.5' });
    } finally {
      await app.close();
    }
  });
});
