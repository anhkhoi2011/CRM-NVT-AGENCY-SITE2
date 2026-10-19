'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pnl = require('../pnl-management.cjs');

test('PnL staff lookup uses the CRM users schema without manager_id', () => {
  const source = fs.readFileSync(require.resolve('../pnl-management.cjs'), 'utf8');
  assert.match(source, /SELECT id, name, role, team_id, leader_id, telegram_chat_id, active FROM users/);
  assert.doesNotMatch(source, /SELECT id, name, role, team_id, leader_id, manager_id, telegram_chat_id/);
});

test('PnL derives a manager through the existing leader_id hierarchy', () => {
  const staff = new Map([
    ['manager', { id: 'manager', role: 'MANAGER', leader_id: null }],
    ['leader', { id: 'leader', role: 'LEADER', leader_id: 'manager' }],
    ['sale', { id: 'sale', role: 'SALE', leader_id: 'leader' }]
  ]);
  assert.equal(pnl.managerIdFor(staff.get('leader'), staff), 'manager');
  assert.equal(pnl.managerIdFor(staff.get('sale'), staff), 'manager');
  assert.equal(pnl.visibleByHierarchy({ id: 'manager', role: 'MANAGER' }, { created_by: 'sale', assigned_to: null }, staff), true);
});
