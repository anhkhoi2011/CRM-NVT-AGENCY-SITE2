'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');

test('Demo HTTP intake quarantines blocked IPs and Admin approval releases exactly once', { timeout: 20000 }, async t => {
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
  const storage = await fs.mkdtemp(path.join(root, 'tmp', 'blacklist-http-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['tools/demo-server.cjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, DB_HOST: '', DB_USER: '', DB_NAME: '', WEBHOOK_TOKEN: '', HOST: '127.0.0.1', PORT: String(port), DEMO_STATE_FILE: '',
      WEBHOOK_DATA_DIR: storage, WEBHOOK_INBOX_FILE: path.join(storage, 'inbox.json'), SUPPORT_UPLOAD_DIR: path.join(storage, 'support') }, stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await fs.rm(storage, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let tries = 0; tries < 80; tries++) {
    try { if ((await fetch(base + '/api/health/live')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'demo server starts');
  async function call(url, token = '', method = 'GET', body, extra = {}) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const admin = (await call('/api/auth/login', '', 'POST', { identifier: 'ADMIN-DEMO', password: 'AdminDemo2026!' })).data.token;
  const sale = (await call('/api/auth/login', '', 'POST', { identifier: 'SALE-DEMO', password: 'SaleDemo2026!' })).data.token;
  assert.ok(admin); assert.ok(sale);
  const before = (await call('/api/state', admin)).data.state;
  const rule = await call('/api/admin/blacklist/ips', admin, 'POST', { ip: '203.0.113.10', reason: 'Spam demo test' });
  assert.equal(rule.status, 200);
  assert.equal((await call('/api/admin/blacklist/ips', sale, 'POST', { ip: '203.0.113.20' })).status, 403);
  assert.equal((await call('/api/admin/blacklist/ips', '', 'POST', { ip: '203.0.113.20' })).status, 401);
  const webhook = '/api/data-sources/webhook/ds-1789180581447-IIM6U3AAD1R/';
  const payload = { name: 'Quarantined demo', phone: '0891234501', visitorIp: '203.0.113.10' };
  const received = await call(webhook, '', 'POST', payload);
  assert.equal(received.status, 200);
  assert.equal(received.data.status, 'BLACKLISTED');
  assert.equal(received.data.customerId, null);
  await call(webhook, '', 'POST', payload);
  const blocked = (await call('/api/state', admin)).data.state;
  assert.equal(blocked.customers.length, before.customers.length);
  assert.equal(blocked.notifications.length, before.notifications.length);
  assert.equal(blocked.dataOffers.length, before.dataOffers.length);
  assert.equal(blocked.blacklistEntries.length, 1);
  const entry = blocked.blacklistEntries[0];
  assert.equal(entry.status, 'PENDING');
  assert.equal((await call('/api/data-sources/inbox', admin)).data.items.length, 0);
  assert.equal((await call('/api/state', sale)).data.state.blacklistEntries.length, 0);
  const approve = '/api/admin/blacklist/entries/' + entry.id + '/accept';
  assert.equal((await call(approve, sale, 'POST', {})).status, 403);
  assert.equal((await call('/api/state', admin, 'POST', { requestId: 'bypass-test', changes: [{ key: 'blacklistEntries', id: entry.id, value: { ...entry, status: 'ACCEPTED' } }] })).status, 403);
  const accepted = await Promise.all([call(approve, admin, 'POST', {}), call(approve, admin, 'POST', {})]);
  assert.ok(accepted.every(result => result.status === 200));
  assert.equal(accepted[0].data.customerId, accepted[1].data.customerId);
  const released = (await call('/api/state', admin)).data.state;
  assert.equal(released.customers.length, before.customers.length + 1);
  assert.equal(released.blacklistEntries[0].status, 'ACCEPTED');
  assert.equal(released.blacklistIps.length, 1);
  assert.ok(released.notifications.length > before.notifications.length);
  const next = await call(webhook, '', 'POST', { ...payload, name: 'Still blocked', phone: '0891234502' });
  assert.equal(next.data.status, 'BLACKLISTED');
  const missingIp = await call(webhook, '', 'POST', { name: 'Provider IP is not visitor IP', phone: '0891234503' }, { 'X-Forwarded-For': '203.0.113.10' });
  assert.equal(missingIp.data.status, 'NEW');
  assert.ok(missingIp.data.customerId);
  assert.equal((await call('/api/admin/blacklist/ips/' + rule.data.rule.id, admin, 'DELETE')).status, 200);
  const unblocked = (await call('/api/state', admin)).data.state;
  assert.equal(unblocked.blacklistIps.length, 0);
  assert.equal(unblocked.blacklistEntries.filter(row => row.status === 'PENDING').length, 1);
  const normal = await call(webhook, '', 'POST', { ...payload, name: 'Unblocked', phone: '0891234504' });
  assert.equal(normal.data.status, 'NEW');
});
