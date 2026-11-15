#!/usr/bin/env node
// End-to-end test of the operational MVP with the REAL Rust Collector binary
// against the REAL Compose stack, started as an isolated project (own name,
// volume, networks and host port) and always torn down. Flow:
//   register → login → host → pairing code → `aegis-collector pair` →
//   `run --once` (heartbeat + SYSTEM_BOOT through the local queue) → host ONLINE →
//   event visible in /events → no duplicate boot → revoke → Collector refused (exit 3) →
//   heartbeat and ingestion with the revoked credential refused → nothing stored after.
// Then a layout check of the web screens in a real headless Chromium.
//
// Never reads the developer's .env and never prints credentials: test values live
// in a temporary directory (mode 700) that is deleted on exit. They are NOT production secrets.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLayout, findChrome, judge } from './lib/browser-layout.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = process.env.AEGIS_E2E_PROJECT ?? 'aegis-collector-e2e';
const PORT = process.env.AEGIS_E2E_HTTP_PORT ?? '18081';
const BASE = `http://127.0.0.1:${PORT}`;
const COLLECTOR = process.env.AEGIS_COLLECTOR_BIN ?? join(ROOT, 'native/aegis-collector/target/release/aegis-collector');
const REQUIRE_BROWSER = process.env.AEGIS_REQUIRE_BROWSER === '1';

const work = mkdtempSync(join(tmpdir(), 'aegis-e2e-'));
const envFile = join(work, 'test.env');
writeFileSync(
  envFile,
  [
    `MYSQL_PASSWORD=${randomBytes(18).toString('base64url')}`,
    `MYSQL_ROOT_PASSWORD=${randomBytes(18).toString('base64url')}`,
    `JWT_SECRET=${randomBytes(48).toString('base64url')}`,
    `AEGIS_HTTP_PORT=${PORT}`,
  ].join('\n') + '\n',
  { mode: 0o600 },
);
const collectorEnv = { ...process.env, XDG_CONFIG_HOME: join(work, 'config'), XDG_STATE_HOME: join(work, 'state') };

let failures = 0;
const secrets = [];
class CheckFailure extends Error {}
const fail = (message) => {
  throw new CheckFailure(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { input, env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', input, env, stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0 && !allowFailure) fail(`${command} ${args.slice(0, 6).join(' ')} … exited ${result.status}${result.stderr ? `\n${redact(result.stderr).trim().split('\n').slice(-15).join('\n')}` : ''}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
const compose = (args, options) => run('docker', ['compose', '-p', PROJECT, '--env-file', envFile, ...args], options);
const collector = (args, options = {}) => run(COLLECTOR, args, { env: collectorEnv, allowFailure: true, ...options });
/** Anything shown on failure goes through this first. */
const redact = (text) => secrets.reduce((acc, secret) => acc.split(secret).join('<redacted>'), text);

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function poll(description, probe, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe().catch((error) => ({ ok: false, detail: error.message }));
    if (last.ok) return last;
    await sleep(1000);
  }
  fail(`timeout waiting for ${description}${last?.detail ? ` (last: ${last.detail})` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`[FAIL] ${name} — ${redact(error.message)}`);
    if (!(error instanceof CheckFailure)) console.log(redact(String(error.stack)));
    throw error;
  }
}

const syntheticCpf = () => {
  const base = Array.from(String(900_000_000 + (randomBytes(3).readUIntBE(0, 3) % 90_000_000)), Number);
  const digit = (digits) => {
    const remainder = (digits.reduce((total, value, index) => total + value * (digits.length + 1 - index), 0) * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const first = digit(base);
  return [...base, first, digit([...base, first])].join('');
};

function cleanup() {
  // -v only ever targets this isolated test project.
  compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
  rmSync(work, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

const started = Date.now();
const state = {};
try {
  await check('collector binary', async () => {
    if (!existsSync(COLLECTOR)) fail(`not found at ${COLLECTOR} (build it with cargo build --release in native/aegis-collector, or set AEGIS_COLLECTOR_BIN)`);
    return collector(['--version']).stdout.trim();
  });

  await check('isolated stack starts', async () => {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    compose(['up', '-d', '--build']);
    await poll('/api/health', async () => ({ ok: (await api('GET', '/health')).status === 200 }));
    return `project ${PROJECT} on port ${PORT}`;
  });

  await check('1. authentication', async () => {
    const password = `E2e-${randomBytes(9).toString('base64url')}-7a`;
    secrets.push(password);
    const account = { name: 'Pessoa E2E', email: `e2e.${randomBytes(4).toString('hex')}@example.test`, cpf: syntheticCpf(), password, passwordConfirmation: password };
    if ((await api('POST', '/auth/register', { body: account })).status !== 201) fail('register');
    const login = await api('POST', '/auth/login', { body: { email: account.email, password } });
    if (login.status !== 200) fail(`login ${login.status}`);
    state.token = login.json.token;
    secrets.push(state.token);
    state.workspaceId = login.json.workspaces[0].id;
    state.base = `/workspaces/${state.workspaceId}`;
    return 'register 201, login 200 (JWT)';
  });

  await check('2. host creation', async () => {
    const host = await api('POST', `${state.base}/hosts`, { token: state.token, body: { displayName: 'collector-e2e' } });
    if (host.status !== 201 || host.json.connectionState !== 'UNPAIRED') fail(`host ${host.status} ${host.json?.connectionState}`);
    state.hostId = host.json.id;
    return 'host UNPAIRED';
  });

  await check('3. pairing code', async () => {
    const code = await api('POST', `${state.base}/hosts/${state.hostId}/pairing-codes`, { token: state.token });
    if (code.status !== 201) fail(`code ${code.status}`);
    state.code = code.json.code;
    secrets.push(state.code);
    return 'code issued once (not printed)';
  });

  await check('4. pairing with the real Collector', async () => {
    // The operator pastes the code; here it arrives on standard input, never as an argument.
    const paired = collector(['pair', '--server', BASE], { input: `${state.code}\n` });
    if (paired.status !== 0) fail(`pair exited ${paired.status}: ${redact(paired.stderr)}`);
    const configFile = join(collectorEnv.XDG_CONFIG_HOME, 'aegis-collector/config.json');
    const mode = statSync(configFile).mode & 0o777;
    if (mode !== 0o600) fail(`config mode ${mode.toString(8)}`);
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    state.machineToken = config.token;
    secrets.push(state.machineToken);
    if (config.hostId !== state.hostId || config.workspaceId !== state.workspaceId) fail('pairing bound to another host');
    const pairing = await api('GET', `${state.base}/hosts/${state.hostId}/pairing`, { token: state.token });
    if (!pairing.json.activeCredential?.scopes.includes('host:heartbeat')) fail('credential without host:heartbeat');
    const status = collector(['status']).stdout;
    for (const output of [paired.stdout, paired.stderr, status]) if (secrets.some((secret) => output.includes(secret))) fail('a secret was printed');
    return `config 0600, credential ${pairing.json.activeCredential.tokenPrefix} with ${pairing.json.activeCredential.scopes.join(', ')}`;
  });

  await check('5. heartbeat and 6. SYSTEM_BOOT through the queue (run --once)', async () => {
    const before = Date.now();
    const cycle = collector(['run', '--once']);
    state.logs = cycle.stderr;
    if (cycle.status !== 0) fail(`run exited ${cycle.status}: ${redact(cycle.stderr)}`);
    const host = (await api('GET', `${state.base}/hosts/${state.hostId}`, { token: state.token })).json;
    if (host.connectionState !== 'ONLINE' || !host.lastSeenAt || Date.parse(host.lastSeenAt) < before - 1000) fail(`host ${host.connectionState} lastSeenAt ${host.lastSeenAt}`);
    state.lastSeenAt = host.lastSeenAt;
    return `host ONLINE, lastSeenAt ${host.lastSeenAt} (server clock)`;
  });

  await check('7. ingestion and 8. query in /events', async () => {
    const events = await api('GET', `${state.base}/events?hostId=${state.hostId}&category=SYSTEM`, { token: state.token });
    const boots = events.json.items.filter((item) => item.type === 'SYSTEM_BOOT');
    if (boots.length !== 1) fail(`expected 1 SYSTEM_BOOT, got ${boots.length}`);
    const detail = await api('GET', `${state.base}/events/${boots[0].id}`, { token: state.token });
    if (detail.json.category !== 'SYSTEM' || detail.json.data?.system?.eventType !== 'BOOT') fail('boot payload');
    state.events = events.json.pagination.total;
    // A second cycle must not report the same boot again.
    if (collector(['run', '--once']).status !== 0) fail('second run');
    const again = await api('GET', `${state.base}/events?hostId=${state.hostId}&eventType=SYSTEM_BOOT`, { token: state.token });
    if (again.json.pagination.total !== 1) fail(`boot duplicated: ${again.json.pagination.total}`);
    state.events = (await api('GET', `${state.base}/events?hostId=${state.hostId}`, { token: state.token })).json.pagination.total;
    return `SYSTEM_BOOT stored once (occurredAt ${boots[0].occurredAt}); ${state.events} event(s) for the host`;
  });

  await check('9. revocation', async () => {
    const pairing = await api('GET', `${state.base}/hosts/${state.hostId}/pairing`, { token: state.token });
    const revoked = await api('DELETE', `${state.base}/hosts/${state.hostId}/credentials/${pairing.json.activeCredential.id}`, { token: state.token });
    if (revoked.status !== 204) fail(`revoke ${revoked.status}`);
    state.lastSeenAt = (await api('GET', `${state.base}/hosts/${state.hostId}`, { token: state.token })).json.lastSeenAt;
    return '204';
  });

  await check('10. heartbeat and 11. ingestion after revocation are refused', async () => {
    const cycle = collector(['run', '--once']);
    if (cycle.status !== 3) fail(`Collector should stop with exit 3, got ${cycle.status}`);
    if (!cycle.stderr.includes('recusou a credencial')) fail('Collector did not explain the refusal');
    const auth = { token: state.machineToken };
    const heartbeat = await api('POST', `${state.base}/hosts/${state.hostId}/heartbeat`, { ...auth, body: {} });
    const ingest = await api('POST', `${state.base}/hosts/${state.hostId}/events/ingest`, {
      ...auth,
      body: { events: [{ schemaVersion: 1, sourceEventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), category: 'SYSTEM', type: 'SYSTEM_BOOT', data: { system: { eventType: 'BOOT' } } }] },
    });
    if (heartbeat.status !== 401 || ingest.status !== 401) fail(`heartbeat ${heartbeat.status}, ingest ${ingest.status}`);
    state.logs += cycle.stderr;
    return 'Collector exit 3; heartbeat 401; ingest 401';
  });

  await check('12. nothing was recorded after the revocation', async () => {
    const host = (await api('GET', `${state.base}/hosts/${state.hostId}`, { token: state.token })).json;
    const total = (await api('GET', `${state.base}/events?hostId=${state.hostId}`, { token: state.token })).json.pagination.total;
    if (host.connectionState !== 'UNPAIRED' || host.lastSeenAt !== state.lastSeenAt || total !== state.events) fail(`state ${host.connectionState}, lastSeenAt ${host.lastSeenAt}, events ${total}`);
    if (secrets.some((secret) => state.logs.includes(secret))) fail('a secret reached the Collector log');
    return `host UNPAIRED, lastSeenAt unchanged, ${total} event(s); no secret in the Collector output`;
  });

  await check('web layout (real browser)', async () => {
    const chrome = findChrome();
    if (!chrome) {
      if (REQUIRE_BROWSER) fail('no Chrome/Chromium found (set AEGIS_CHROME)');
      return 'skipped: no Chrome/Chromium on this machine';
    }
    const results = await checkLayout({
      chrome,
      base: BASE,
      token: state.token,
      workspaceId: state.workspaceId,
      paths: [`/hosts/${state.hostId}`, '/hosts', '/eventos'],
      widths: [320, 360, 390, 768, 1280],
      waitForText: { [`/hosts/${state.hostId}`]: 'Pareamento do Collector', '/hosts': 'collector-e2e', '/eventos': 'collector-e2e' },
    });
    const verdicts = judge(results);
    const failed = verdicts.filter((verdict) => !verdict.ok);
    if (failed.length > 0) fail(failed.map((verdict) => verdict.line).join('\n'));
    return `${verdicts.length} page/width combinations: no horizontal overflow, navigation visible, no console errors or CSP violations`;
  });
} catch {
  for (const service of ['api', 'nginx']) {
    const logs = compose(['logs', '--no-color', '--tail', '20', service], { allowFailure: true }).stdout;
    if (logs) console.log(`--- last log lines: ${service}\n${redact(logs)}`);
  }
} finally {
  cleanup();
  const leftovers = run('docker', ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]).stdout.trim();
  if (leftovers) {
    failures += 1;
    console.log('[FAIL] cleanup — test project containers left behind');
  } else {
    console.log('[PASS] cleanup — test project and temporary files removed');
  }
  console.log(`${failures === 0 ? 'Collector E2E passed' : 'Collector E2E FAILED'} in ${Math.round((Date.now() - started) / 1000)} s`);
  process.exitCode = failures === 0 ? 0 : 1;
}
