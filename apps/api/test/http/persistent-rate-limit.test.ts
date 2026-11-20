import { describe, expect, it } from 'vitest';
import { routeScope } from '../../src/presentation/http/persistent-rate-limit.js';
import { buildTestApp } from '../support/test-app.js';

describe('per-route limits on the persistent counters (ADR-051)', () => {
  it('derives a short, stable and distinct scope per route', () => {
    const login = routeScope({ method: 'POST', url: '/auth/login' });
    const register = routeScope({ method: 'POST', url: '/auth/register' });
    const heartbeat = routeScope({ method: 'POST', url: '/workspaces/:workspaceId/hosts/:hostId/heartbeat' });
    expect(login).toBe(routeScope({ method: 'POST', url: '/auth/login' }));
    expect(new Set([login, register, heartbeat]).size).toBe(3);
    for (const scope of [login, register, heartbeat]) {
      expect(scope.startsWith('http:')).toBe(true);
      expect(scope.length).toBeLessThanOrEqual(32);
    }
  });

  it('writes the login limit into the shared store, so another instance with the same store sees it', async () => {
    const { app, rateLimits } = await buildTestApp({ authRateLimitMax: 2 });
    const attempt = () => app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ninguem@example.test', password: 'Senha-Errada-123!' } });
    await attempt();
    await attempt();

    const scope = routeScope({ method: 'POST', url: '/auth/login' });
    const count = await rateLimits.peek(scope, '127.0.0.1', new Date());
    expect(count?.hits).toBe(2);
    expect((await attempt()).statusCode).toBe(429);
  });
});
