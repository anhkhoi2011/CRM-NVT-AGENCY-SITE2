'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Export = require('../marketing-export.cjs');

function fixture(state, { production = false } = {}) {
  const source = fs.readFileSync(require.resolve('../webhook-server.cjs'), 'utf8');
  const start = source.indexOf('function marketingPushAuthorized(');
  const end = source.indexOf('async function handleLeadsExportApi(');
  const body = source.slice(start, end);
  const context = {
    Buffer, URL, crypto, Intl, Date, Math,
    DEMO_MODE: !production,
    DEMO_MARKETING_API_KEY: 'test-key',
    CRM_PUSH_API_KEY: production ? 'push-key' : '',
    demoMarketingPushRequests: new Set(),
    demoState: state,
    marketingApiState: async () => ({ state }),
    readDbBody: async () => context.body,
    parseCrmTimestamp: Export.parseCrmTimestamp,
    normalizePhoneForApi: Export.normalizePhoneForApi,
    stamp: () => '2026-10-10 12:00',
    corsHeaders: () => ({}),
    sendJson: (response, status, data) => { response.status = status; response.data = data; },
    crmData: { write: async (...args) => { context.writeArgs = args; return { ok: true }; } }
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  return {
    async post(body, headers = { 'x-api-key': 'test-key' }) {
      context.body = body;
      const response = {};
      await context.handleLeadsPushApi({ method: 'POST', headers }, response, new URL('http://localhost:4173/api/leads/push'));
      return { ...response, writeArgs: context.writeArgs };
    }
  };
}

test('Sheet push updates only marketing fields, reports unmatched rows and is idempotent in demo', async () => {
  const customer = { id: 'c1', name: 'A', phone: '0901234567', saleId: 'sale-1', note: 'Note cua Sale', customFields: { customerLevel: 'L2' } };
  const state = { customers: [customer], audit: [] };
  const api = fixture(state);
  const first = await api.post({ request_id: 'scan-001', source: 'google-sheet', customers: [
    { phone: '+84901234567', quality_label: 'HIGH', audience_network_avoid: true, call_priority: 1, analysis_note: 'Nen goi som' },
    { phone: '0909999999', quality_label: 'LOW' },
    { phone: '0901234567', quality_label: 'DUPLICATE' }
  ] });
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(first.data.summary)), { received: 3, updated: 1, not_found: 1, invalid: 0, duplicate: 1 });
  assert.equal(state.customers[0].saleId, 'sale-1');
  assert.equal(state.customers[0].note, 'Note cua Sale');
  assert.equal(state.customers[0].customFields.marketing_quality_label, 'HIGH');
  assert.equal(state.customers[0].customFields.marketing_audience_network_avoid, true);
  assert.equal(state.customers[0].customFields.marketing_call_priority, 1);
  assert.equal(state.audit.length, 1);
  const replay = await api.post({ request_id: 'scan-001', customers: [{ phone: '0901234567', quality_label: 'CHANGED' }] });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(state.customers[0].customFields.marketing_quality_label, 'HIGH');
});

test('Sheet push requires its API key and validates analysis values', async () => {
  const api = fixture({ customers: [{ id: 'c1', phone: '0901234567', customFields: {} }], audit: [] });
  assert.equal((await api.post({ customers: [{ phone: '0901234567', call_priority: 9 }] }, {})).status, 401);
  const invalid = await api.post({ customers: [{ phone: '0901234567', call_priority: 9 }] });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.data.summary.invalid, 1);
});

test('Production push delegates to the transactional CRM writer with an audit event', async () => {
  const api = fixture({ customers: [{ id: 'c1', phone: '0901234567', customFields: {} }], audit: [] }, { production: true });
  const result = await api.post({ request_id: 'sql-scan-001', customers: [{ phone: '0901234567', quality_label: 'MEDIUM', call_priority: 3 }] }, { 'x-api-key': 'push-key' });
  assert.equal(result.status, 200);
  assert.equal(result.data.summary.updated, 1);
  assert.equal(result.writeArgs[0].id, 'MARKETING_PUSH_API');
  assert.equal(result.writeArgs[1], 'sql-scan-001');
  assert.ok(result.writeArgs[2].some(change => change.key === 'audit' && change.value.action === 'MARKETING_ANALYSIS_PUSH'));
  assert.ok(result.writeArgs[2].some(change => change.key === 'customers' && change.fields.includes('customFields.marketing_call_priority')));
});

test('Long marketing request IDs retain separate audit events for each customer',async()=>{
 const api=fixture({customers:[{id:'c1',phone:'0901234567',customFields:{}},{id:'c2',phone:'0901234568',customFields:{}}],audit:[]},{production:true});
 const result=await api.post({request_id:'r'.repeat(96),customers:[{phone:'0901234567',quality_label:'HIGH'},{phone:'0901234568',quality_label:'LOW'}]},{'x-api-key':'push-key'});
 const audits=result.writeArgs[2].filter(c=>c.key==='audit');assert.equal(audits.length,2);assert.notEqual(audits[0].id,audits[1].id);assert.ok(audits.every(c=>c.id.length<=96));
});
