'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../runtime-storage.cjs');

test('Runtime storage keeps a writable configured directory', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'crm-storage-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const configured = path.join(root, 'configured'), fallback = path.join(root, 'fallback');
  const result = storage.resolveWritableDirectory({ configured, fallback, label: 'test' });
  assert.equal(result.path, configured);
  assert.equal(result.fallback, false);
  assert.equal(fs.existsSync(configured), true);
});

test('Runtime storage falls back when an old cPanel home is not writable', () => {
  const calls = [], fakeFs = {
    constants: { W_OK: 2 },
    mkdirSync(value) { calls.push(['mkdir', value]); if (value.includes('old-user')) throw Object.assign(Error('denied'), { code: 'EACCES' }); },
    accessSync(value) { calls.push(['access', value]); }
  };
  const result = storage.resolveWritableDirectory({
    configured: '/home/old-user/webhook-data', fallback: '/home/current-user/webhook-data',
    label: 'WEBHOOK_DATA_DIR', fsImpl: fakeFs, logger: () => {}
  });
  assert.equal(result.path, path.resolve('/home/current-user/webhook-data'));
  assert.equal(result.fallback, true);
  assert.ok(calls.some(call => call[1].includes('current-user')));
});

test('Explicit inbox file also falls back when its old parent cannot be written', () => {
  const fakeFs = {
    constants: { W_OK: 2 },
    mkdirSync(value) { if (value.includes('old-user')) throw Object.assign(Error('denied'), { code: 'EACCES' }); },
    accessSync() {}
  };
  const result = storage.resolveWritableFile({
    configured: '/home/old-user/inbox.json', fallback: '/home/current-user/webhook-data/inbox.json',
    label: 'WEBHOOK_INBOX_FILE', fsImpl: fakeFs, logger: () => {}
  });
  assert.equal(result.path, path.resolve('/home/current-user/webhook-data/inbox.json'));
  assert.equal(result.fallback, true);
});
