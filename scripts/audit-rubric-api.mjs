#!/usr/bin/env node
// Auditoria ao vivo dos itens de back-end da rubrica da faculdade contra a stack em execução.
// Usa uma conta descartável `rubrica.<data>@example.test`, nunca imprime token nem senha e apaga os
// recursos que cria (a conta fica: não há exclusão de usuário).
//   npm run audit:rubrica                                    (padrão: http://localhost:8080/api, via Nginx)
//   AEGIS_BASE=http://localhost:8090/api npm run audit:rubrica
//   Sem Node no host: docker compose exec -T -e AEGIS_BASE=http://127.0.0.1:3000 api node --input-type=module - < scripts/audit-rubric-api.mjs
import { randomBytes } from 'node:crypto';

const BASE = process.env.AEGIS_BASE ?? 'http://localhost:8080/api';
const results = [];
const check = (item, ok, detail) => results.push({ item, ok: Boolean(ok), detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Uma chamada HTTP; em 429 (limite por IP das rotas de autenticação) espera a janela e tenta de novo. */
async function call(method, path, body, token) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429) {
      await sleep(61_000);
      continue;
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }
  return { status: 429, json: null };
}

/** CPF válido e obviamente sintético (base 900000000 + aleatório, dígitos mod 11). */
function syntheticCpf() {
  const base = Array.from(String(900_000_000 + (randomBytes(3).readUIntBE(0, 3) % 90_000_000)), Number);
  const digit = (digits) => {
    const remainder = (digits.reduce((sum, value, index) => sum + value * (digits.length + 1 - index), 0) * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const first = digit(base);
  return [...base, first, digit([...base, first])].join('');
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = `rubrica.${stamp}@example.test`;
const password = `Rubrica!${randomBytes(6).toString('hex')}A1`;
const cpf = syntheticCpf();
const register = (body) => call('POST', '/auth/register', body);
const valid = { name: 'Conta de Auditoria da Rubrica', email, cpf, password, passwordConfirmation: password };

// ── Cadastro de usuário ────────────────────────────────────────────────────────
const { name: _n, ...withoutName } = valid;
check('Cadastro: campos obrigatórios', (await register(withoutName)).status === 400, 'sem nome → 400');
check('Cadastro: validação de CPF', (await register({ ...valid, cpf: '12345678900' })).status === 400, 'CPF com dígito errado → 400');
check('Cadastro: nível de senha', (await register({ ...valid, password: 'fraca', passwordConfirmation: 'fraca' })).status === 400, 'senha fraca → 400');
check('Cadastro: validação de email', (await register({ ...valid, email: 'nao-e-email' })).status === 400, 'email inválido → 400');
const created = await register(valid);
check('Cadastro: conta válida criada', created.status === 201, `HTTP ${created.status}`);

// ── Autenticação ───────────────────────────────────────────────────────────────
const login = await call('POST', '/auth/login', { email, password });
const token = login.json?.token ?? '';
check('Login: email e senha válidos', login.status === 200, `HTTP ${login.status}`);
check('Login: retorna JWT', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token), 'três segmentos base64url (não exibido)');
check('Login: senha errada recusada', (await call('POST', '/auth/login', { email, password: `${password}x` })).status === 401, '401');
check('Login: só usuário existente', (await call('POST', '/auth/login', { email: `inexistente.${stamp}@example.test`, password })).status === 401, '401');
check('Login: validação de email (regex)', (await call('POST', '/auth/login', { email: 'sem-arroba', password })).status === 400, '400');

// ── Edição de usuário ──────────────────────────────────────────────────────────
const me = await call('GET', '/users/me', undefined, token);
check('Edição: rota autenticada', (await call('PUT', '/users/me', { name: 'X Y', cpf })).status === 401, 'sem token → 401');
check('Edição: só o próprio usuário', me.status === 200 && me.json?.user?.email === email && (await call('GET', `/users/${me.json?.user?.id}`, undefined, token)).status === 404, 'só existe /users/me; /users/:id → 404');
check('Edição: campos obrigatórios', (await call('PUT', '/users/me', { cpf }, token)).status === 400, 'sem nome → 400');
check('Edição: validação de CPF', (await call('PUT', '/users/me', { name: 'Conta Editada', cpf: '11111111111' }, token)).status === 400, 'CPF inválido → 400');
check('Edição: nível de senha', (await call('PUT', '/users/me', { name: 'Conta Editada', cpf, currentPassword: password, password: 'fraca', passwordConfirmation: 'fraca' }, token)).status === 400, 'senha fraca → 400');
const emailChange = await call('PUT', '/users/me', { name: 'Conta Editada', cpf, email: `outro.${stamp}@example.test` }, token);
const after = await call('GET', '/users/me', undefined, token);
check('Edição: email não pode ser alterado', emailChange.status === 400 && after.json?.user?.email === email, 'campo email → 400 e email intacto');
check('Edição: edição válida funciona', (await call('PUT', '/users/me', { name: 'Conta Editada', cpf }, token)).status === 200, '200');

// ── 4 CRUDs ────────────────────────────────────────────────────────────────────
const ws = me.json?.workspaces?.find((workspace) => workspace.kind === 'personal')?.id ?? '';
const base = `/workspaces/${ws}`;
const missing = '00000000-0000-4000-8000-000000000000';
const rule = { name: 'Regra da auditoria', severity: 'LOW', enabled: false, eventCategory: 'SYSTEM', scope: 'ALL_HOSTS', hostIds: [], definition: { version: 1, match: 'ALL', conditions: [{ field: 'system.eventType', operator: 'EQUALS', value: 'BOOT' }] } };

const crud = async (label, path, createBody, updateBody) => {
  const made = await call('POST', `${base}/${path}`, createBody(), token);
  const id = made.json?.id;
  const list = await call('GET', `${base}/${path}?page=1&pageSize=1`, undefined, token);
  const paged = list.status === 200 && Array.isArray(list.json?.items) && list.json?.pagination?.pageSize === 1 && typeof list.json?.pagination?.total === 'number';
  const read = await call('GET', `${base}/${path}/${id}`, undefined, token);
  const updated = await call('PUT', `${base}/${path}/${id}`, updateBody(made.json), token);
  const noAuth = await call('GET', `${base}/${path}`);
  const editMissing = await call('PUT', `${base}/${path}/${missing}`, updateBody(made.json), token);
  const deleteMissing = await call('DELETE', `${base}/${path}/${missing}`, undefined, token);
  check(`CRUD ${label}: criar, ler, listar, editar`, made.status === 201 && read.status === 200 && updated.status === 200, `POST ${made.status} · GET ${read.status} · PUT ${updated.status}`);
  check(`CRUD ${label}: paginação`, paged, 'items + pagination');
  check(`CRUD ${label}: rotas autenticadas`, noAuth.status === 401, 'sem token → 401');
  check(`CRUD ${label}: não edita/deleta inexistente`, editMissing.status === 404 && deleteMissing.status === 404, `PUT ${editMissing.status} · DELETE ${deleteMissing.status}`);
  return { id, json: made.json };
};

const host = await crud('Hosts', 'hosts', () => ({ displayName: `auditoria-${stamp}` }), () => ({ displayName: `auditoria-${stamp}-b` }));
const ruleMade = await crud('Regras', 'detection-rules', () => rule, () => ({ ...rule, name: 'Regra da auditoria editada' }));
const incidentBody = () => ({ title: 'Incidente da auditoria', severity: 'LOW', hostIds: [host.id], detectionRuleIds: [ruleMade.id] });
const incident = await crud('Incidentes', 'incidents', incidentBody, () => ({ ...incidentBody(), title: 'Incidente da auditoria editado' }));
const investigationBody = () => ({ title: 'Investigação da auditoria', incidentIds: [incident.id] });
const investigation = await crud('Investigações', 'investigations', investigationBody, () => ({ ...investigationBody(), description: null, conclusion: null }));

check('CRUDs: relacionamento entre recursos', incident.json?.hosts?.[0]?.hostId === host.id && incident.json?.detectionRules?.[0]?.ruleId === ruleMade.id && investigation.json?.incidents?.[0]?.incidentId === incident.id, 'incidente ↔ host/regra, investigação ↔ incidente');
const blocked = await call('DELETE', `${base}/incidents/${incident.id}`, undefined, token);
check('CRUDs: integridade do relacionamento', blocked.status === 409, 'excluir incidente agrupado → 409');

// Limpeza dos recursos criados (a conta de auditoria fica: não há exclusão de usuário).
for (const [path, id] of [['investigations', investigation.id], ['incidents', incident.id], ['detection-rules', ruleMade.id], ['hosts', host.id]]) {
  await call('DELETE', `${base}/${path}/${id}`, undefined, token);
}

const failed = results.filter((result) => !result.ok);
for (const result of results) console.log(`${result.ok ? 'OK  ' : 'FALTA'} ${result.item} — ${result.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} verificações de back-end OK. Conta de auditoria: ${email}`);
process.exitCode = failed.length === 0 ? 0 : 1;
