// HTTPS entry point checks (ADR-055), shared by `npm run test:infra` (real Compose stack) and any
// local harness. Certificates are verified for real: the self-signed certificate is passed as the
// trusted CA, never by turning verification off.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:tls';

const fail = (message) => {
  throw new Error(message);
};

function https({ host, port, ca, path = '/' }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ host, port, path, ca, method: 'GET', rejectUnauthorized: true }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Resolves the negotiated protocol, or rejects when the handshake fails. */
function handshake({ host, port, ca, minVersion, maxVersion }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, ca, minVersion, maxVersion, rejectUnauthorized: true }, () => {
      const protocol = socket.getProtocol();
      socket.end();
      resolve(protocol);
    });
    socket.on('error', (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

/**
 * @param {{ httpBase: string, host: string, httpsPort: number, certFile: string, cspSource: string }} options
 * `cspSource` is the snippet that promises the CSP; the HTTPS answer must carry exactly that value.
 * Returns one line per verified property; throws on the first broken promise.
 */
export async function checkTls({ httpBase, host, httpsPort, certFile, cspSource }) {
  const ca = readFileSync(certFile);
  const lines = [];

  const redirect = await fetch(`${httpBase}/investigacoes?x=1`, { redirect: 'manual' });
  const expected = `https://${host}:${httpsPort}/investigacoes?x=1`;
  if (redirect.status !== 301 || redirect.headers.get('location') !== expected) {
    fail(`HTTP should answer 301 → ${expected}, got ${redirect.status} → ${redirect.headers.get('location')}`);
  }
  lines.push(`HTTP 301 → ${expected}`);

  const challenge = await fetch(`${httpBase}/.well-known/acme-challenge/aegis-probe`, { redirect: 'manual' });
  if (challenge.status === 301) fail('ACME challenge path is redirected; Let’s Encrypt HTTP-01 would fail');
  lines.push(`ACME webroot answered on HTTP (${challenge.status}), not redirected`);

  const promisedCsp = readFileSync(cspSource, 'utf8').match(/Content-Security-Policy "([^"]+)"/)?.[1] ?? fail('CSP not found in the snippet');
  for (const path of ['/', '/api/health']) {
    const response = await https({ host, port: httpsPort, ca, path });
    if (response.status !== 200) fail(`HTTPS ${path} → ${response.status}`);
    if (response.headers['strict-transport-security'] !== 'max-age=31536000') fail(`HTTPS ${path}: HSTS ${JSON.stringify(response.headers['strict-transport-security'])}`);
    if (response.headers['content-security-policy'] !== promisedCsp) fail(`HTTPS ${path}: CSP differs from the shared snippet`);
    for (const [name, value] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'no-referrer']]) {
      if (response.headers[name] !== value) fail(`HTTPS ${path}: ${name} is ${JSON.stringify(response.headers[name])}`);
    }
    if (path === '/' && !response.text.includes('<div id="root">')) fail('HTTPS / does not serve the SPA');
    if (path === '/api/health' && JSON.parse(response.text).status !== 'ok') fail('HTTPS /api/health is not ok');
  }
  lines.push('HTTPS serves the SPA and the API with HSTS, the same CSP and the security headers');

  const best = await handshake({ host, port: httpsPort, ca });
  if (best !== 'TLSv1.3') fail(`default handshake negotiated ${best}`);
  const tls12 = await handshake({ host, port: httpsPort, ca, maxVersion: 'TLSv1.2' });
  if (tls12 !== 'TLSv1.2') fail(`TLS 1.2 client negotiated ${tls12}`);
  // Node's own OpenSSL also refuses TLS 1.1, so a failed Node handshake proves nothing about the
  // server. openssl s_client with the security level lowered offers TLS 1.1 for real; the server
  // must answer with the "protocol version" alert.
  const s_client = spawnSync('openssl', ['s_client', '-connect', `${host}:${httpsPort}`, '-tls1_1', '-cipher', 'DEFAULT:@SECLEVEL=0'], {
    input: '',
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (s_client.error) fail(`openssl s_client unavailable: ${s_client.error.message}`);
  const output = `${s_client.stdout}${s_client.stderr}`;
  if (/Protocol\s*:\s*TLSv1(\.1)?\b/.test(output) && !/Cipher is \(NONE\)/.test(output)) fail('the server negotiated TLS 1.1');
  if (!/alert protocol version/.test(output)) fail('TLS 1.1 offer was not refused with a protocol version alert');
  lines.push('TLS 1.3 by default, TLS 1.2 accepted, TLS 1.1 refused by the server (alert 70)');

  const untrusted = await handshake({ host, port: httpsPort, ca: undefined }).then(
    () => 'accepted',
    (error) => error.code,
  );
  if (untrusted === 'accepted') fail('handshake without the CA succeeded: verification is not happening');
  lines.push(`certificate verified against its CA (without it: ${untrusted})`);
  return lines;
}
