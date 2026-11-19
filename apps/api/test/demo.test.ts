import { describe, expect, it } from 'vitest';
import type { LoginResponse } from '@aegis/contracts';
import { DemoProvisioner } from '../src/application/demo/demo-provisioner.js';
import { DEMO_EVENT_SLOT_MS, DemoSimulator, dueEvents, isSimulatedOnline, uuidV5 } from '../src/application/demo/demo-simulator.js';
import { DEMO_HOSTS, DEMO_OPERATOR } from '../src/application/demo/demo-catalog.js';
import { bearer, buildTestApp, login, registerUser, signedInUser } from './support/test-app.js';
import { makeRegistration } from './support/fixtures.js';

/** A moment when every simulated host, including the lab VM, is powered on. */
const ON = new Date('2026-11-19T12:05:00.000Z');
/** A moment inside the lab VM's 10 minutes off. */
const LAB_OFF = new Date('2026-11-19T12:25:00.000Z');

async function demoSetup() {
  const built = await buildTestApp();
  const provisioner = new DemoProvisioner(built.persistence.repositories, built.persistence.unitOfWork, built.hasher, built.dependencies);
  return { ...built, provisioner };
}

describe('AEGIS DEMO provisioning (ADR-052)', () => {
  it('creates the demo once, through the regular use cases, and reuses it afterwards', async () => {
    const { provisioner, persistence } = await demoSetup();
    const first = await provisioner.ensure();
    expect(first.created).toBe(true);
    expect([...first.hostIds.keys()].sort()).toEqual(['db', 'lab', 'server', 'web']);

    const second = await provisioner.ensure();
    expect(second.created).toBe(false);
    expect(second.workspaceId).toBe(first.workspaceId);
    const demos = [...persistence.store.workspaces.values()].filter((workspace) => workspace.kind === 'demo');
    expect(demos).toHaveLength(1);
    expect([...persistence.store.hosts.values()].filter((host) => host.workspaceId === first.workspaceId)).toHaveLength(DEMO_HOSTS.length);
  });

  it('seeds incidents in several states and an investigation in progress', async () => {
    const { provisioner, dependencies } = await demoSetup();
    const demo = await provisioner.ensure();
    const incidents = await dependencies.listIncidents.execute(demo.operator, demo.workspaceId, { page: 1, pageSize: 10 });
    expect(incidents.items.map((item) => item.status).sort()).toEqual(['INVESTIGATING', 'OPEN', 'RESOLVED']);
    const investigations = await dependencies.listInvestigations.execute(demo.operator, demo.workspaceId, { page: 1, pageSize: 10 });
    expect(investigations.items.map((item) => item.status)).toEqual(['IN_PROGRESS']);
  });

  it('gives read-only access to accounts created before and after the demo', async () => {
    const { app, provisioner } = await demoSetup();
    const before = await signedInUser(app);
    const demo = await provisioner.ensure();
    expect(demo.viewersAdded).toBe(1);

    const again = (await login(app, before.registration.email)).json<LoginResponse>();
    expect(again.workspaces.map((workspace) => [workspace.kind, workspace.role])).toEqual([
      ['personal', 'OWNER'],
      ['demo', 'VIEWER'],
    ]);

    const registration = makeRegistration();
    const created = await registerUser(app, registration);
    expect(created.statusCode).toBe(201);
    const after = (await login(app, registration.email)).json<LoginResponse>();
    expect(after.workspaces.find((workspace) => workspace.kind === 'demo')?.role).toBe('VIEWER');
  });

  it('lets a viewer read the demo but refuses every write with 403', async () => {
    const { app, provisioner } = await demoSetup();
    const demo = await provisioner.ensure();
    const { token } = await signedInUser(app);
    const base = `/workspaces/${demo.workspaceId}`;
    const hostId = demo.hostIds.get('web') ?? '';

    expect((await app.inject({ method: 'GET', url: `${base}/hosts`, headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${base}/incidents`, headers: bearer(token) })).statusCode).toBe(200);
    const writes = [
      app.inject({ method: 'POST', url: `${base}/hosts`, headers: bearer(token), payload: { displayName: 'intruso' } }),
      app.inject({ method: 'PUT', url: `${base}/hosts/${hostId}`, headers: bearer(token), payload: { displayName: 'renomeado' } }),
      app.inject({ method: 'DELETE', url: `${base}/hosts/${hostId}`, headers: bearer(token) }),
      app.inject({ method: 'POST', url: `${base}/hosts/${hostId}/pairing-codes`, headers: bearer(token) }),
    ];
    expect((await Promise.all(writes)).map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
  });

  it('keeps the operator account unusable for sign-in', async () => {
    const { app, provisioner } = await demoSetup();
    await provisioner.ensure();
    const attempt = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: DEMO_OPERATOR.email, password: 'Qualquer-Senha-123!' } });
    expect(attempt.statusCode).toBe(401);
  });
});

describe('AEGIS DEMO simulator', () => {
  it('pairs the simulated hosts like a Collector, sends heartbeats and ingests events idempotently', async () => {
    const { provisioner, dependencies } = await demoSetup();
    const demo = await provisioner.ensure();
    let now = ON;
    const simulator = new DemoSimulator(demo, dependencies, () => now);
    expect(await simulator.start()).toBe(3);

    const first = await simulator.tick();
    expect(first).toMatchObject({ heartbeats: 3, failures: 0 });
    expect(first.inserted).toBeGreaterThanOrEqual(3); // one boot per host, plus the slot's service change
    expect((await simulator.tick()).inserted).toBe(0); // same moment: same ids, nothing duplicated

    const hosts = await dependencies.listHosts.execute(demo.operator, demo.workspaceId, { page: 1, pageSize: 10 });
    const states = Object.fromEntries(hosts.items.map((host) => [host.displayName, host.connectionStateAt(now)]));
    expect(states).toMatchObject({ 'srv-web-01': 'ONLINE', 'srv-db-01': 'ONLINE', 'lab-vm-ubuntu': 'ONLINE', 'aegis-server': 'UNPAIRED' });

    now = LAB_OFF;
    expect((await simulator.tick()).heartbeats).toBe(2);
  });

  it('revokes the credential of a previous run before pairing again, leaving the audit trail', async () => {
    const { provisioner, dependencies } = await demoSetup();
    const demo = await provisioner.ensure();
    await new DemoSimulator(demo, dependencies, () => ON).start();
    await new DemoSimulator(demo, dependencies, () => ON).start();
    const web = demo.hostIds.get('web') ?? '';
    const pairing = await dependencies.getHostPairing.execute(demo.operator, demo.workspaceId, web);
    expect(pairing.credentials.map((credential) => credential.isActive).sort()).toEqual([false, true]);
  });
});

describe('simulated events', () => {
  const web = DEMO_HOSTS[0]!;
  const lab = DEMO_HOSTS[2]!;

  it('derives the same ids for the same moment and different ids for another slot', () => {
    const a = dueEvents(web, 0, 3, 'host-1', ON).map((event) => event.sourceEventId);
    const b = dueEvents(web, 0, 3, 'host-1', ON).map((event) => event.sourceEventId);
    expect(a).toEqual(b);
    const later = dueEvents(web, 0, 3, 'host-1', new Date(ON.getTime() + 3 * DEMO_EVENT_SLOT_MS)).map((event) => event.sourceEventId);
    expect(later[1]).toBeDefined();
    expect(later[1]).not.toBe(a[1]);
  });

  it('only uses fields of Event Contract v1 and never reports from the future', () => {
    for (const event of [...dueEvents(web, 0, 1, 'h', ON), ...dueEvents(lab, 0, 1, 'h', ON)]) {
      expect(Date.parse(event.occurredAt)).toBeLessThanOrEqual(ON.getTime());
      expect(Object.keys(event.data.system).every((key) => ['eventType', 'serviceName', 'state'].includes(key))).toBe(true);
    }
  });

  it('switches the lab VM off for 10 minutes of every 30, and keeps the servers on', () => {
    expect(isSimulatedOnline('lab', ON)).toBe(true);
    expect(isSimulatedOnline('lab', LAB_OFF)).toBe(false);
    expect(isSimulatedOnline('web', LAB_OFF)).toBe(true);
  });

  it('produces RFC 4122 version 5 ids', () => {
    expect(uuidV5('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Known vector: uuid v5 of "www.example.com" in the DNS namespace.
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
});
