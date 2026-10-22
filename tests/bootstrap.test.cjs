'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pool, authPool, telegramPool } = require('../db.js');

const ROOT = path.resolve(__dirname, '..');

test.after(async () => { await Promise.all([pool.end(), authPool.end(), telegramPool.end()]); });

test('bootstrap builder allowlists UI settings and removes session secrets', () => {
  const crmData = require('../crm-data.cjs');
  const payload = crmData.buildBootstrap({
    id: 'u1', accountId: 'SALE1', name: 'Sale', email: 'sale@example.test', phone: '0900000000',
    role: 'SALE', teamId: 'T1', leaderId: 'lead', telegramChatId: 'private-chat', telegramUsername: 'private-user',
    password_hash: 'private-password'
  }, { settings: { fontFamily: 'aptos', customAccent: '#123456', navigationFontSize: 12, contentFontSize: 14, dataBotToken: 'private-token' }, version: 42 });

  assert.deepEqual(payload.user, { id: 'u1', accountId: 'SALE1', name: 'Sale', email: 'sale@example.test', phone: '0900000000', role: 'SALE', teamId: 'T1', leaderId: 'lead', active: true, createdAt: '' });
  assert.deepEqual(payload.settings, { fontFamily: 'aptos', customAccent: '#123456', navigationFontSize: 12, contentFontSize: 14 });
  assert.equal(Object.hasOwn(payload.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(payload.user, 'telegramChatId'), false);
  assert.equal(Object.hasOwn(payload.user, 'telegramUsername'), false);
  assert.equal(Object.hasOwn(payload.settings, 'dataBotToken'), false);
  assert.deepEqual(payload.navigation, ['dashboard','customers','accept','care','pnl','orders','revenue','team','attendance','notifications','profile','feedback','processes']);
  assert.equal(payload.version, '42');
  assert.equal(payload.stats, null);
});

test('bootstrap reader has no full snapshot dependency', () => {
  const source = fs.readFileSync(path.join(ROOT, 'crm-data.cjs'), 'utf8');
  const start = source.indexOf('async function readBootstrap');
  const end = source.indexOf('function coreRow', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /\b(?:read|sharedData|snapshot|allData)\s*\(/);

  const server = fs.readFileSync(path.join(ROOT, 'webhook-server.cjs'), 'utf8');
  const authStart = server.indexOf('const user=await authUser(request);');
  const bootstrapStart = server.indexOf("if(pathname==='/api/bootstrap')", authStart);
  assert.ok(authStart >= 0 && bootstrapStart > authStart);
  assert.match(server.slice(bootstrapStart, bootstrapStart + 260), /crmData\.readBootstrap\(user\)/);
});

test('Demo bootstrap is authenticated, minimal, role-scoped and measurable', { timeout: 20000 }, async t => {
  await fsPromises.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const storage = await fsPromises.mkdtemp(path.join(ROOT, 'tmp', 'bootstrap-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['tools/demo-server.cjs'], {
    cwd: ROOT, windowsHide: true,
    env: { ...process.env, DB_HOST: '', DB_USER: '', DB_NAME: '', WEBHOOK_TOKEN: '', HOST: '127.0.0.1', PORT: String(port), DEMO_STATE_FILE: '', WEBHOOK_DATA_DIR: storage, WEBHOOK_INBOX_FILE: path.join(storage, 'inbox.json'), SUPPORT_UPLOAD_DIR: path.join(storage, 'support') },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    await fsPromises.rm(storage, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health/live')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'demo server starts');

  async function call(url, token = '', method = 'GET') {
    const response = await fetch(base + url, { method, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: response.status, data, bytes: Buffer.byteLength(text), text };
  }

  assert.equal((await call('/api/bootstrap')).status, 401);
  const adminLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'ADMIN-DEMO', password: 'AdminDemo2026!' }) });
  const adminToken = (await adminLogin.json()).token;
  const saleLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'SALE-DEMO', password: 'SaleDemo2026!' }) });
  const saleToken = (await saleLogin.json()).token;
  assert.ok(adminToken); assert.ok(saleToken);

  const admin = await call('/api/bootstrap', adminToken);
  assert.equal(admin.status, 200);
  assert.ok(admin.bytes > 0 && admin.bytes < 100000, `bootstrap response should remain small (${admin.bytes} bytes)`);
  assert.deepEqual(Object.keys(admin.data).sort(), ['navigation','settings','stats','storage','user','version'].sort());
  assert.equal(admin.data.user.role, 'ADMIN');
  assert.ok(admin.data.navigation.includes('settings'));
  assert.equal(Object.hasOwn(admin.data, 'state'), false);
  assert.equal(Object.hasOwn(admin.data, 'customers'), false);
  assert.equal(Object.hasOwn(admin.data, 'orders'), false);
  assert.equal(Object.hasOwn(admin.data, 'members'), false);
  assert.equal(Object.hasOwn(admin.data.settings, 'dataBotToken'), false);
  assert.equal(Object.hasOwn(admin.data.user, 'password_hash'), false);

  const sale = await call('/api/bootstrap', saleToken);
  assert.equal(sale.status, 200);
  assert.equal(sale.data.user.role, 'SALE');
  assert.equal(sale.data.navigation.includes('settings'), false);
  assert.equal(sale.data.navigation.includes('accept'), true);

  assert.equal((await call('/api/bootstrap', adminToken, 'POST')).status, 405);
});
