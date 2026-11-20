#!/usr/bin/env node
// Self-signed certificate for the HTTPS entry point (compose.tls.yaml, ADR-055): a lab or a first
// boot before Let's Encrypt. Writes fullchain.pem and privkey.pem (mode 600) into AEGIS_TLS_DIR
// (default ./certs, ignored by Git) and creates the ACME webroot. Never prints the key.
//
//   npm run tls:self-signed                    → localhost, 127.0.0.1, ::1
//   npm run tls:self-signed -- aegis.exemplo.com.br  → adds that name
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = resolve(ROOT, process.env.AEGIS_TLS_DIR ?? 'certs');
const extra = process.argv.slice(2).filter((name) => /^[a-z0-9.:-]+$/i.test(name));
const days = Number(process.env.AEGIS_TLS_DAYS ?? 30);

const names = ['localhost', ...extra];
const san = [...new Set(names)].map((name) => (isIP(name) ? `IP:${name}` : `DNS:${name}`));
san.push('IP:127.0.0.1', 'IP:::1');

if (spawnSync('openssl', ['version'], { stdio: 'ignore' }).status !== 0) {
  console.error('openssl não encontrado. Instale o OpenSSL ou gere o par em outra máquina (veja docs/HOSPEDAGEM.md).');
  process.exit(1);
}

mkdirSync(join(dir, 'acme'), { recursive: true });
const cert = join(dir, 'fullchain.pem');
const key = join(dir, 'privkey.pem');
if (existsSync(cert) && !process.env.AEGIS_TLS_FORCE) {
  console.log(`Já existe um certificado em ${cert}. Use AEGIS_TLS_FORCE=1 para gerar outro.`);
  process.exit(0);
}

const result = spawnSync(
  'openssl',
  ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-sha256', '-days', String(days),
    '-subj', `/CN=${names.at(-1)}`, '-addext', `subjectAltName=${san.join(',')}`, '-keyout', key, '-out', cert],
  { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
);
if (result.status !== 0) {
  console.error(`openssl falhou: ${result.stderr.trim().split('\n').at(-1)}`);
  process.exit(1);
}
chmodSync(key, 0o600);
console.log(`Certificado autoassinado (${days} dias) para ${san.join(', ')} em ${dir}. A chave não foi exibida.`);
