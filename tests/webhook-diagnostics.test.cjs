"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {diagnose} = require('../tools/diagnose-webhook.cjs');
const record = {id:'WHE-1',receivedAt:'2026-10-11 14:00',slug:'DS-TEST',status:'NEW',customer:{name:'PRIVATE-NAME',phone:'PRIVATE-PHONE',email:'PRIVATE-EMAIL'},raw:{secret:'PRIVATE-RAW'}};
function files(inbox, pending = []) {
  return {
    readFile: async file => JSON.stringify(file.endsWith('inbox.json') ? inbox : pending.find(r => file.endsWith(r.id + '.json'))),
    readdir: async () => pending.map(r => r.id + '.json')
  };
}
test('Webhook diagnostics uses SELECT only, distinguishes missing/hidden customers and excludes payloads and secrets', async () => {
  const queries = [], data = [record, {...record,id:'WHE-2'}, {...record,id:'WHE-3',status:'INVALID',customer:{}}];
  const query = async (sql, params = []) => {
    queries.push(sql);
    assert.match(sql.trim(), /^SELECT /);
    if (sql.includes('SELECT id,created_at,payload_json')) return data.map(r=>({id:r.id,created_at:r.receivedAt,payload_json:JSON.stringify(r)}));
    if (sql.includes('SELECT c.id,d.deleted')) return params[0] === 'CUS-WHE-1' ? [{id:params[0],deleted:1}] : [];
    return [];
  };
  const report = await diagnose({date:'2026-10-11',env:{HOME:'/hosting',WEBHOOK_TOKEN:'PRIVATE-TOKEN',DB_PASSWORD:'PRIVATE-PASS'},files:files(data,[record]),query});
  assert.equal(report.storage.pendingTotal,1);
  assert.equal(report.storage.unconfirmedOnDate,3);
  assert.equal(report.sql.eventsOnDate[0].customerExists,true);
  assert.equal(report.sql.eventsOnDate[0].hiddenByDeletedDocument,true);
  assert.equal(report.sql.eventsOnDate[1].customerExists,false);
  assert.equal(report.sql.eventsOnDate[2].customerId,null);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE-/);
  assert.equal(report.readOnly,true);
});
test('Empty or inaccessible journal does not prevent SQL diagnosis', async () => {
  const report = await diagnose({date:'2026-10-11',env:{HOME:'/hosting'},files:{readFile:async()=>{throw Object.assign(Error('no file'),{code:'ENOENT'})},readdir:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'})}},query:async()=>[]});
  assert.equal(report.storage.pendingTotal,0);
  assert.equal(report.storage.inboxTotal,0);
  assert.deepEqual(report.errors.map(e=>e.code),['ENOENT','EACCES']);
  assert.deepEqual(report.sql.eventsOnDate,[]);
});
