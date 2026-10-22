#!/usr/bin/env node
// Automated infrastructure test: builds and starts the real Compose stack as an
// isolated project (own name, volume, networks and host port), checks what the
// architecture promises through the public entry point and `docker inspect`,
// and always tears it down. Never reads the developer's .env and never prints
// configuration or credentials: the generated test values live in a temporary
// env file (mode 600) that is deleted on exit. They are NOT production secrets.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = process.env.AEGIS_INFRA_PROJECT ?? 'aegis-infra-test';
const PORT = process.env.AEGIS_INFRA_HTTP_PORT ?? '18080';
const BASE = `http://127.0.0.1:${PORT}`;
const MIGRATIONS = JSON.parse(readFileSync(join(ROOT, 'apps/api/drizzle/meta/_journal.json'), 'utf8')).entries.length;
const SERVICES = ['nginx', 'web', 'api', 'mysql', 'migrate'];
/** Which Compose networks each service must join — and nothing else. */
const EXPECTED_NETWORKS = {
  nginx: ['aegis_application', 'aegis_edge'],
  web: ['aegis_application'],
  api: ['aegis_application', 'aegis_data'],
  mysql: ['aegis_data'],
  migrate: ['aegis_data'],
};
const INTERNAL_NETWORKS = { aegis_edge: false, aegis_application: true, aegis_data: true };

const secretDir = mkdtempSync(join(tmpdir(), 'aegis-infra-'));
const envFile = join(secretDir, 'test.env');
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

let failures = 0;
const pass = (name, detail = '') => console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
class CheckFailure extends Error {}
const fail = (message) => {
  throw new CheckFailure(message);
};

/** Runs a command; output is captured (never echoed) unless `inherit` is set. */
function run(command, args, { inherit = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: inherit ? ['ignore', 'inherit', 'inherit'] : 'pipe' });
  if (result.status !== 0 && !allowFailure) {
    fail(`${command} ${args.slice(0, 6).join(' ')} … exited ${result.status}${result.stderr ? `\n${result.stderr.trim().split('\n').slice(-15).join('\n')}` : ''}`);
  }
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}
// --env-file replaces the default `.env`, so the developer's file is never loaded.
const compose = (args, options) => run('docker', ['compose', '-p', PROJECT, '--env-file', envFile, ...args], options);
const inspect = (id) => JSON.parse(run('docker', ['inspect', id]).stdout)[0];
const containerOf = (service) => compose(['ps', '-a', '-q', service]).stdout.split('\n')[0] || fail(`no container for ${service}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(description, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe().catch((error) => ({ ok: false, detail: error.message }));
    if (last.ok) return last;
    await sleep(1000);
  }
  fail(`timeout waiting for ${description}${last?.detail ? ` (last: ${last.detail})` : ''}`);
}

/** Runs SQL inside the mysql container; the root password is read there from its own environment. */
function sql(query) {
  const script = `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "$1" "$MYSQL_DATABASE"`;
  return compose(['exec', '-T', 'mysql', 'sh', '-c', script, 'sh', query]).stdout;
}

const http = async (path) => {
  const response = await fetch(BASE + path, { redirect: 'manual' });
  return { status: response.status, headers: response.headers, text: await response.text() };
};

async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    failures += 1;
    console.log(`[FAIL] ${name} — ${error.message}`);
    if (!(error instanceof CheckFailure)) console.log(error.stack);
    throw error;
  }
}

function showLogs() {
  for (const service of ['migrate', 'api', 'nginx', 'mysql']) {
    const logs = compose(['logs', '--no-color', '--tail', '25', service], { allowFailure: true }).stdout;
    if (logs) console.log(`--- last log lines: ${service}\n${logs}`);
  }
}

function cleanup() {
  // -v only ever targets this isolated test project; --rmi local drops its untagged web image.
  compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
  rmSync(secretDir, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

const started = Date.now();
try {
  // A leftover from an interrupted run would make "empty database" meaningless.
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });

  await check('compose config', async () => {
    compose(['config', '--quiet']);
    return 'valid (not printed)';
  });

  await check('images build', async () => {
    compose(['build'], { inherit: process.env.CI === 'true' });
    return 'web and api images built from the Dockerfiles';
  });

  await check('database volume starts empty', async () => {
    const volume = `${PROJECT}_mysql_data`;
    if (run('docker', ['volume', 'inspect', volume], { allowFailure: true }).status === 0) fail(`${volume} already exists`);
    return `${volume} does not exist before startup`;
  });

  await check('stack starts', async () => {
    // `up` itself waits for depends_on conditions: mysql healthy → migrate completed → api.
    compose(['up', '-d']);
    const missing = SERVICES.filter((service) => !compose(['ps', '-a', '-q', service]).stdout);
    if (missing.length > 0) fail(`missing services: ${missing.join(', ')}`);
    return SERVICES.join(', ');
  });

  await check('mysql healthy', async () => {
    const id = containerOf('mysql');
    await poll('mysql health', async () => {
      const status = inspect(id).State.Health?.Status;
      return { ok: status === 'healthy', detail: status };
    });
    return 'healthcheck reports healthy';
  });

  await check('migrations', async () => {
    const state = inspect(containerOf('migrate')).State;
    if (state.Status !== 'exited' || state.ExitCode !== 0) fail(`migrate is ${state.Status} with exit code ${state.ExitCode}`);
    const applied = Number(sql('SELECT COUNT(*) FROM __drizzle_migrations'));
    if (applied !== MIGRATIONS) fail(`${applied} migrations recorded, journal has ${MIGRATIONS}`);
    const tables = sql('SHOW TABLES').split('\n');
    for (const table of ['users', 'workspaces', 'hosts', 'detection_rules', 'incidents', 'investigations', 'investigation_incidents', 'events']) {
      if (!tables.includes(table)) fail(`table ${table} missing`);
    }
    return `migrate exited 0; ${applied}/${MIGRATIONS} migrations (0000 → ${String(MIGRATIONS - 1).padStart(4, '0')}) on an empty database`;
  });

  await check('api and web running', async () => {
    for (const service of ['api', 'web', 'nginx']) {
      const state = inspect(containerOf(service)).State;
      if (state.Status !== 'running') fail(`${service} is ${state.Status}`);
    }
    return 'nginx, web, api running; migrate one-shot';
  });

  await check('/api/health via nginx', async () => {
    const response = await poll('/api/health', async () => {
      const result = await http('/api/health');
      return { ok: result.status === 200, detail: `HTTP ${result.status}`, ...result };
    });
    const body = JSON.parse(response.text);
    if (body.status !== 'ok' || body.service !== 'aegis-api') fail(`unexpected body ${response.text}`);
    return `200 ${response.text}`;
  });

  await check('/ via nginx serves Aegis Web', async () => {
    const response = await http('/');
    if (response.status !== 200) fail(`HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/html')) fail(`content-type ${response.headers.get('content-type')}`);
    if (!response.text.includes('<title>AEGIS</title>') || !response.text.includes('<div id="root">')) fail('index.html of Aegis Web not served');
    const script = response.text.match(/src="(\/assets\/[^"]+\.js)"/)?.[1] ?? fail('no built script referenced');
    const asset = await http(script);
    if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('javascript')) fail(`asset ${script} → HTTP ${asset.status}`);
    return `200 text/html with the built SPA (${script})`;
  });

  await check('reverse proxy routing', async () => {
    // /api/* reaches the API with the prefix stripped: an unknown API path gets the API's own JSON 404.
    const apiMiss = await http('/api/rota-inexistente');
    if (apiMiss.status !== 404 || JSON.parse(apiMiss.text).error?.code !== 'NOT_FOUND') fail(`/api/rota-inexistente → ${apiMiss.status} ${apiMiss.text.slice(0, 80)}`);
    // Without the prefix, the same path is a web route: SPA fallback, never the API.
    for (const path of ['/health', '/investigacoes', '/rota-inexistente']) {
      const response = await http(path);
      if (response.status !== 200 || !response.text.includes('<div id="root">')) fail(`${path} → ${response.status}, expected the SPA`);
    }
    return '/api/* → api (prefix stripped), /* → web (SPA fallback)';
  });

  await check('security headers and CSP', async () => {
    const config = readFileSync(join(ROOT, 'infra/nginx/nginx.conf'), 'utf8');
    const promisedCsp = config.match(/Content-Security-Policy "([^"]+)"/)?.[1] ?? fail('CSP not found in nginx.conf');
    const expected = {
      'content-security-policy': promisedCsp,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    };
    for (const path of ['/', '/api/health']) {
      const { headers } = await http(path);
      for (const [name, value] of Object.entries(expected)) {
        if (headers.get(name) !== value) fail(`${path}: ${name} is ${JSON.stringify(headers.get(name))}`);
      }
      if (headers.get('server') !== 'nginx') fail(`${path}: server header ${JSON.stringify(headers.get('server'))} (server_tokens off expected)`);
    }
    for (const directive of ["script-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
      if (!promisedCsp.includes(directive)) fail(`CSP lacks ${directive}`);
    }
    return 'CSP, nosniff, X-Frame-Options, Referrer-Policy on web and API; no nginx version';
  });

  await check('published ports', async () => {
    const published = Object.fromEntries(
      SERVICES.map((service) => {
        const container = inspect(containerOf(service));
        const bindings = Object.entries(container.HostConfig.PortBindings ?? {}).flatMap(([port, hosts]) => (hosts ?? []).map((host) => `${host.HostPort}->${port}`));
        return [service, bindings];
      }),
    );
    if (published.nginx.join(',') !== `${PORT}->80/tcp`) fail(`nginx publishes ${JSON.stringify(published.nginx)}`);
    for (const service of ['web', 'api', 'mysql', 'migrate']) {
      if (published[service].length > 0) fail(`${service} publishes ${published[service].join(', ')}`);
    }
    return `only nginx (${PORT}->80); web, api, mysql (3306) and migrate publish nothing`;
  });

  await check('networks', async () => {
    const networks = Object.fromEntries(
      SERVICES.map((service) => {
        const attached = Object.keys(inspect(containerOf(service)).NetworkSettings.Networks).map((name) => {
          const network = inspect(name);
          return { key: network.Labels?.['com.docker.compose.network'], internal: network.Internal };
        });
        return [service, attached];
      }),
    );
    for (const [service, expected] of Object.entries(EXPECTED_NETWORKS)) {
      const actual = networks[service].map((network) => network.key).sort();
      if (actual.join(',') !== expected.join(',')) fail(`${service} joins ${actual.join(', ')}, expected ${expected.join(', ')}`);
      for (const network of networks[service]) {
        if (network.internal !== INTERNAL_NETWORKS[network.key]) fail(`${network.key} internal=${network.internal}`);
      }
    }
    return 'edge: nginx · application (internal): nginx, web, api · data (internal): api, mysql, migrate';
  });

  await check('network isolation', async () => {
    const resolves = (service, host) => compose(['exec', '-T', service, 'getent', 'hosts', host], { allowFailure: true }).status === 0;
    if (!resolves('nginx', 'api') || !resolves('nginx', 'web')) fail('nginx cannot resolve web/api');
    if (!resolves('api', 'mysql')) fail('api cannot resolve mysql');
    if (resolves('nginx', 'mysql')) fail('nginx can resolve mysql');
    if (resolves('web', 'mysql')) fail('web can resolve mysql');
    // aegis_application/aegis_data are internal: the API has no route to the internet.
    const egress = compose(
      ['exec', '-T', 'api', 'node', '-e', "require('net').connect({host:'1.1.1.1',port:443,timeout:3000}).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"],
      { allowFailure: true },
    );
    if (egress.status === 0) fail('api reached the internet (1.1.1.1:443)');
    return 'nginx → web/api; api → mysql; nginx and web cannot reach mysql; api has no internet egress';
  });

  await check('mysql volume', async () => {
    const mount = inspect(containerOf('mysql')).Mounts.find((item) => item.Destination === '/var/lib/mysql');
    if (!mount) fail('no mount at /var/lib/mysql');
    if (mount.Type !== 'volume' || mount.Name !== `${PROJECT}_mysql_data`) fail(`/var/lib/mysql is ${mount.Type} ${mount.Name ?? ''}`);
    const tmpfs = inspect(containerOf('mysql')).HostConfig.Tmpfs ?? {};
    if (Object.keys(tmpfs).length > 0) fail(`tmpfs mounts: ${Object.keys(tmpfs).join(', ')}`);
    return `named volume ${mount.Name} at /var/lib/mysql, no tmpfs`;
  });

  await check('persistence across down/up', async () => {
    const marker = randomBytes(6).toString('hex');
    sql(`INSERT INTO workspaces (id, name, kind, created_at, updated_at) VALUES ('00000000-0000-4000-8000-${marker}', 'infra-${marker}', 'lab', NOW(3), NOW(3))`);
    // Plain `down` (no -v), as a developer would run it, then a fresh `up`.
    compose(['down']);
    compose(['up', '-d']);
    await poll('mysql health after restart', async () => ({ ok: inspect(containerOf('mysql')).State.Health?.Status === 'healthy' }));
    const kept = sql(`SELECT COUNT(*) FROM workspaces WHERE name = 'infra-${marker}'`);
    const applied = Number(sql('SELECT COUNT(*) FROM __drizzle_migrations'));
    if (kept !== '1' || applied !== MIGRATIONS) fail(`after restart: marker rows ${kept}, migrations ${applied}`);
    const migrate = inspect(containerOf('migrate')).State;
    if (migrate.ExitCode !== 0) fail(`migrate rerun exited ${migrate.ExitCode}`);
    await poll('/api/health after restart', async () => ({ ok: (await http('/api/health')).status === 200 }));
    return 'data and schema survive `docker compose down`; migrate rerun is idempotent; API back up';
  });
} catch {
  showLogs();
} finally {
  cleanup();
  const leftovers = run('docker', ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]).stdout;
  const volume = run('docker', ['volume', 'inspect', `${PROJECT}_mysql_data`], { allowFailure: true }).status === 0;
  if (leftovers || volume) {
    failures += 1;
    console.log('[FAIL] cleanup — containers or volume left behind');
  } else {
    console.log('[PASS] cleanup — test project containers, networks and volume removed');
  }
  console.log(`${failures === 0 ? 'Infra test passed' : 'Infra test FAILED'} in ${Math.round((Date.now() - started) / 1000)} s`);
  process.exitCode = failures === 0 ? 0 : 1;
}
