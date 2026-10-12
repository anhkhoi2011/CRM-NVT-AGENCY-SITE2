'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const blacklist = require('../blacklist.cjs');
const crmData = require('../crm-data.cjs');
test.after(async () => {
  const { pool, authPool, telegramPool } = require('../db.js');
  await Promise.all([pool.end(), authPool.end(), telegramPool.end()]);
});
const admin = { id: 'admin', role: 'ADMIN' };

test('Blacklist validates IPv4 and canonicalizes IPv6 and mapped IPv4', () => {
  for (const value of ['abc', '999.1.2.3', '203.0.113.1/24', '203.0.113.1, 203.0.113.2']) assert.equal(blacklist.normalizeIp(value), '');
  assert.equal(blacklist.normalizeIp(' 203.0.113.1 '), '203.0.113.1');
  assert.equal(blacklist.normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(blacklist.normalizeIp('::ffff:203.0.113.1'), '203.0.113.1');
  assert.equal(blacklist.normalizeIp('::ffff:cb00:7101'), '203.0.113.1');
  const rule = blacklist.makeRule(admin, { ip: '2001:db8::1', reason: 'spam' });
  assert.equal(blacklist.ruleFor([rule], '2001:DB8:0:0:0:0:0:1').id, rule.id);
  assert.equal(blacklist.ruleFor([rule], ''), null);
  assert.equal(blacklist.ruleFor([{ ...rule, active: false }], rule.ip), null);
  assert.throws(() => blacklist.makeRule(admin, { ip: 'not-an-ip' }), { status: 400 });
});

test('Only Admin can read or manage Blacklist; generic state writes cannot bypass approval', () => {
  const data = Object.fromEntries([...crmData.LISTS, ...crmData.OBJECTS].map(key => [key, new Map()]));
  const row = blacklist.makeRule(admin, { ip: '203.0.113.1' });
  for (const role of ['SALE','LEADER','MANAGER','MARKETING','ACCOUNTING','HRM','UNASSIGNED']) {
    const user = { id: role, role };
    for (const key of ['blacklistIps','blacklistEntries']) {
      assert.equal(crmData.readable(user, key, row, data), false);
      assert.throws(() => crmData.authorize(user, key, null, row, data), { status: 403 });
    }
    assert.throws(() => blacklist.makeRule(user, { ip: row.ip }), { status: 403 });
  }
  assert.equal(crmData.readable(admin, 'blacklistEntries', row, data), true);
  assert.throws(() => crmData.authorize(admin, 'blacklistEntries', row, { ...row, status: 'ACCEPTED' }, data), { status: 403 });
});
