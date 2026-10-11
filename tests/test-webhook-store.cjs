"use strict";
// Test chạy theo thư mục gốc dự án: fs đọc file và require module từ gốc.
const ROOT=require('node:path').resolve(__dirname,'..');process.chdir(ROOT);
require=require('node:module').createRequire(ROOT+'/');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture(failCustomer = false, websites = [{ id: 'WEB-TEST', name: 'Hoang Phuc Academy', domain: 'www.hoangphucacademy.vn', sourceUrl: 'https://www.hoangphucacademy.vn/', campaignId: 'ACADEMY', webhookSlug: 'DS-TEST' }], offers = []) {
  const events = new Map(), customers = new Map(), documents = new Map(offers.map(row => [`${row.collection || 'dataOffers'}:${row.id}`, row])), notices = [], calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql, values) { return this.execute(sql, values); },
    async execute(sql, values = []) {
      if (sql.includes('FROM crm_write_lock')) return [[{id:1}]];
      if (sql.startsWith('INSERT INTO webhook_events')) { if (!events.has(values[1])) events.set(values[1], values[0]); }
      if (sql.includes("FROM crm_documents WHERE collection='websites'")) return [websites.map(item => ({ id: item.id, body: JSON.stringify(item) }))];
      if (sql.includes("FROM crm_documents WHERE collection='dataOffers'")) return [[...documents.values()].filter(row => row.collection === 'dataOffers' && !row.deleted).map(row => ({ id: row.id, body: JSON.stringify(row.body) }))];
      if (sql.startsWith('SELECT id, name, phone, email, sale_id, leader_id, team_id, status FROM customers')) return [[...customers.values()].map(values => ({ id: values[0], name: values[1], phone: values[2], email: values[3], sale_id: values[11] || null, leader_id: values[12] || null, team_id: values[13] || null, status: values[7] }))];
      if (sql.startsWith('SELECT id, body FROM crm_documents')) return [[...documents.values()].map(row => ({ id: row.id, body: JSON.stringify(row.body) }))];
      if (sql.startsWith('SELECT id')) return [events.has(values[0]) ? [{ id: events.get(values[0]) }] : []];
      if (sql.startsWith('INSERT INTO customers')) {
        if (failCustomer) throw new Error('Database unavailable');
        if (!customers.has(values[0])) customers.set(values[0], values);
      }
      if (sql.startsWith('INSERT INTO crm_documents')) documents.set(`${values[0]}:${values[1]}`, { collection: values[0], id: values[1], body: JSON.parse(values[2]), deleted: values[3] || 0 });
      if (sql.startsWith('UPDATE webhook_events')) return [{}];
      return [{}];
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./webhook-store.cjs'), 'utf8'), {
    module, URL, require: name => name === './db.js' ? { dbConfigured: true, pool: { async query() {}, async getConnection() { return connection; } } } : name === './crm-data.cjs' ? {queueTelegramNotice:async (c, key, notice) => { notices.push({ key, ...notice }); },prepare:async()=>{},distributeAutomatic:async c=>{assert.equal(c,connection);calls.push('assign');}} : name === './crm-defaults.json' ? { websites: [] } : require(name)
  });
  return { ...module.exports, customers, events, documents, notices, calls };
}
const record = { id: 'WHE-1', dedupeKey: 'abc', status: 'NEW', slug: 'DS-TEST', receivedAt: '2026-09-14 12:00', customer: { name: 'Test', phone: '0912345678', email: 'test@example.com', ipAddress: '203.0.113.14' } };
test('Lưu khách trước commit và giữ ID khi landing gửi lại', async () => {
  const f = fixture();
  const first = await f.persistWebhook(record);
  const retry = await f.persistWebhook({ ...record, id: 'WHE-2' });
  assert.equal(first.customerId, retry.customerId);
  assert.equal(f.customers.size, 1);
  assert.deepEqual(f.calls, ['begin', 'assign', 'commit', 'release', 'begin', 'commit', 'release']);
});
test('Lỗi ghi khách phải rollback, không báo thành công', async () => {
  const f = fixture(true);
  await assert.rejects(f.persistWebhook(record), /Database unavailable/);
  assert.deepEqual(f.calls, ['begin', 'rollback', 'release']);
});
test('Payload không hợp lệ vẫn có sự kiện gốc, không tạo khách giả', async () => {
  const f = fixture();
  const result = await f.persistWebhook({ ...record, status: 'INVALID' });
  assert.equal(result.customerId, null);
  assert.equal(f.events.size, 1);
  assert.equal(f.customers.size, 0);
});

test('Duplicate phone keeps the existing owner and skips automatic assignment', async () => {
  const f = fixture();
  f.customers.set('EXISTING', ['EXISTING', 'Existing customer', '0912345678', 'old@example.com', null, null, null, 'NEW', null, null, null, 'SALE-OLD', 'LEAD-OLD', 'TEAM-OLD']);
  const duplicate = await f.persistWebhook({ ...record, id: 'WHE-DUP', dedupeKey: 'different-payload', customer: { name: 'Changed name', phone: '0912345678', email: 'new@example.com' } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.customerId, 'EXISTING');
  assert.equal(duplicate.ownerSaleId, 'SALE-OLD');
  assert.equal(f.customers.size, 1);
  assert.equal(f.calls.includes('assign'), false);
});
test('Webhook maps website, campaign and source URL into MySQL customer', async () => {
  const f = fixture();
  const result = await f.persistWebhook(record);
  const values = f.customers.get(result.customerId);
  assert.equal(values[4], 'ACADEMY');
  assert.equal(values[5], 'WEB-TEST');
  const payload = JSON.parse(values[7]);
  assert.equal(payload.__crmMeta.landingPageName, 'Hoang Phuc Academy');
  assert.equal(payload.__crmMeta.landingPageUrl, 'https://www.hoangphucacademy.vn/');
  assert.equal(payload.__crmMeta.landingPageDomain, 'www.hoangphucacademy.vn');
  assert.equal(payload.__crmMeta.ipAddress, '203.0.113.14');
});
test('Webhook source follows the configured webhook slug instead of a default website', async () => {
  const f = fixture(false, [
    { id: 'WEB-A', name: 'Academy A', domain: 'academy-a.example', sourceUrl: 'https://academy-a.example/form', campaignId: 'A', webhookSlug: 'DS-A' },
    { id: 'WEB-B', name: 'Academy B', domain: 'academy-b.example', sourceUrl: 'https://academy-b.example/form', campaignId: 'B', webhookSlug: 'DS-B' }
  ]);
  const first = await f.persistWebhook({ ...record, id: 'WHE-A', dedupeKey: 'dedupe-a', slug: 'DS-A', customer: { ...record.customer, phone: '0911111111' } });
  const second = await f.persistWebhook({ ...record, id: 'WHE-B', dedupeKey: 'dedupe-b', slug: 'DS-B', customer: { ...record.customer, phone: '0922222222', email: 'other@example.com' } });
  assert.equal(first.source.landingPageUrl, 'https://academy-a.example/form');
  assert.equal(first.source.sourceUrl, 'https://academy-a.example/form');
  assert.equal(second.source.landingPageUrl, 'https://academy-b.example/form');
  assert.equal(second.source.sourceUrl, 'https://academy-b.example/form');
  assert.notEqual(first.source.sourceUrl, second.source.sourceUrl);
});
test('Duplicate phone keeps an active pending offer owner and does not consume the next round', async () => {
  const offeredAt = new Date(Date.now() - 60 * 60 * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 19);
  const f = fixture(false, undefined, [{ collection: 'dataOffers', id: 'OFFER-1', body: { id: 'OFFER-1', customerId: 'EXISTING', saleId: 'SALE-WAITING', status: 'PENDING', offeredAt }, deleted: 0 }]);
  f.customers.set('EXISTING', ['EXISTING', 'Existing customer', '0912345678', 'old@example.com', null, null, null, 'NEW', null, null, null, null, 'LEAD-OLD', 'TEAM-OLD']);
  const duplicate = await f.persistWebhook({ ...record, id: 'WHE-PENDING', dedupeKey: 'pending-payload', customer: { ...record.customer, phone: '0912345678', email: 'new@example.com' } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.ownerSaleId, 'SALE-WAITING');
  assert.equal(duplicate.pendingOfferId, 'OFFER-1');
  assert.equal(duplicate.duplicateStatus, 'PENDING_ACCEPTANCE');
  assert.equal(f.calls.includes('assign'), false);
  assert.ok(f.notices.some(notice => notice.kind === 'DUPLICATE_OWNER' && notice.recipientId === 'SALE-WAITING'));
});
test('Webhook stores the customer reference amount without changing the customer schema', async () => {
  const f = fixture();
  const result = await f.persistWebhook({ ...record, raw: { 'Số tiền khách tham khảo gần đây': '1.500.000 đ' } });
  const values = f.customers.get(result.customerId);
  const payload = JSON.parse(values[7]);
  assert.equal(payload.__crmMeta.referenceAmount, 1500000);
});
test('Unknown webhook slug stays unattributed without inventing a website', async () => {
  const f = fixture(false, []);
  const result = await f.persistWebhook(record);
  const values = f.customers.get(result.customerId);
  assert.equal(values[4], 'UNATTRIBUTED');
  assert.equal(values[5], null);
});

test('Webhook creates a durable data-arrival notice only once when the incoming event is replayed',async()=>{
 const f=fixture();await f.persistWebhook(record);await f.persistWebhook({...record,id:'WHE-replay'});
 const notices=[...f.documents.values()].filter(d=>d.collection==='notifications');assert.equal(notices.length,1);assert.equal(notices[0].body.kind,'DATA_ARRIVAL');assert.equal(notices[0].body.role,'ADMIN');
});

test('Recovery inserts only the missing lead without scanning old customers for assignment', async () => {
  const f = fixture();
  f.customers.set('OLD', ['OLD','Old customer','0900000000',null,null,null,null,'NEW',null,null,null,'old-sale','old-leader','old-team']);
  const before=JSON.stringify(f.customers.get('OLD'));
  const saved=await f.persistWebhook(record,{skipAutomatic:true});
  assert.equal(saved.customerId,'CUS-WHE-1');
  assert.equal(f.customers.size,2);
  assert.equal(JSON.stringify(f.customers.get('OLD')),before);
  assert.equal(f.calls.includes('assign'),false);
  assert.equal(f.notices.length,1);
  await f.persistWebhook(record,{skipAutomatic:true});
  assert.equal(f.notices.length,1);
});
