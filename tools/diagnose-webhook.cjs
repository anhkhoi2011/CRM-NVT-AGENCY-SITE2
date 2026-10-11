"use strict";
// Read-only: no schema preparation, retries, assignment or Telegram sends.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function parse(value) { return typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/, '')) : value; }
function safeKey(value) { return String(value || '').replace(/[\r\n]/g, '').slice(0, 80); }
function summary(record) {
  return {
    id: record.id, slug: record.slug, receivedAt: record.receivedAt,
    contentType: record.contentType, status: record.status,
    persisted: record.persisted === true, duplicate: record.duplicate === true,
    customerId: record.duplicateCustomerId || record.customerId || null,
    hasName: Boolean(record.customer?.name), hasPhone: Boolean(record.customer?.phone),
    hasEmail: Boolean(record.customer?.email),
    problems: record.problems || [],
    matchedKeys: Object.fromEntries(Object.entries(record.matchedKeys || {}).map(([key, value]) => [key, safeKey(value)]))
  };
}
async function diagnose({ date, env = process.env, query, files = fs }) {
  const home = env.HOME || path.dirname(path.resolve(__dirname, '..'));
  const dataDirectory = path.resolve(env.WEBHOOK_DATA_DIR || path.join(home, 'webhook-data'));
  const inboxFile = path.resolve(env.WEBHOOK_INBOX_FILE || path.join(dataDirectory, '.webhook-inbox.json'));
  const report = { readOnly: true, date, generatedAt: new Date().toISOString(),
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webhookTokenConfigured: Boolean(String(env.WEBHOOK_TOKEN || '').trim()),
    databaseFingerprint: crypto.createHash('sha256').update([env.DB_HOST, env.DB_PORT || '3306', env.DB_NAME].join('|')).digest('hex').slice(0, 12),
    storage: { dataDirectory, inboxFile }, sql: {}, errors: [] };
  let inbox = [], pending = [];
  try { inbox = parse(await files.readFile(inboxFile, 'utf8')); if (!Array.isArray(inbox)) throw Error('INVALID_INBOX'); }
  catch (error) { inbox = []; report.errors.push({stage:'inbox', code:error.code || 'INVALID_INBOX'}); }
  const pendingDirectory = path.join(dataDirectory, 'pending');
  try {
    const names = (await files.readdir(pendingDirectory)).filter(name => /^WHE-[A-Za-z0-9-]+\.json$/.test(name));
    for (const name of names) {
      try { pending.push(parse(await files.readFile(path.join(pendingDirectory, name), 'utf8'))); }
      catch (error) { report.errors.push({stage:'pending', file:name, code:error.code || 'INVALID_JSON'}); }
    }
  } catch (error) { report.errors.push({stage:'pending', code:error.code || 'READ_FAILED'}); }
  const byDate = records => records.filter(record => String(record?.receivedAt || '').slice(0, 10) === date);
  report.storage.inboxTotal = inbox.length;
  report.storage.inboxOnDate = byDate(inbox).length;
  report.storage.unconfirmedOnDate = byDate(inbox).filter(record => !record.persisted).length;
  report.storage.pendingTotal = pending.length;
  report.storage.pendingOnDate = byDate(pending).length;
  report.storage.latestInbox = inbox.slice(-10).reverse().map(summary);
  report.storage.latestPending = pending.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 10).map(summary);
  const read = async (label, sql, params = []) => {
    try { const rows = await query(sql, params); report.sql[label] = rows; return rows; }
    catch (error) { report.errors.push({stage:label, code:error.code || 'SQL_ERROR'}); return null; }
  };
  await read('clock', 'SELECT NOW() AS databaseNow, @@session.time_zone AS timezone');
  await read('customersOnDate', 'SELECT COUNT(*) AS count FROM customers WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)', [date, date]);
  await read('eventStatusOnDate', `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.status')) AS status, COUNT(*) AS count
    FROM webhook_events WHERE LEFT(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.receivedAt')),10)=? GROUP BY status`, [date]);
  await read('latestCustomers', 'SELECT id,created_at AS createdAt,sale_id AS saleId,website_id AS websiteId FROM customers ORDER BY created_at DESC LIMIT 10');
  await read('websites', `SELECT id,JSON_UNQUOTE(JSON_EXTRACT(body,'$.webhookSlug')) AS slug,
    JSON_UNQUOTE(JSON_EXTRACT(body,'$.provider')) AS provider FROM crm_documents WHERE collection='websites' AND deleted=0`);
  await read('telegramOutbox', `SELECT JSON_UNQUOTE(JSON_EXTRACT(body,'$.kind')) AS kind,
    JSON_UNQUOTE(JSON_EXTRACT(body,'$.status')) AS status, COUNT(*) AS count
    FROM crm_documents WHERE collection='telegramOutbox' AND deleted=0 GROUP BY kind,status`);
  // Correlate both recent events and the incident date, without exposing contact details.
  const events = await read('events', `SELECT id,created_at,payload_json FROM webhook_events
    WHERE LEFT(JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.receivedAt')),10)=? ORDER BY created_at DESC LIMIT 10`, [date]);
  if (events) {
    delete report.sql.events;
    report.sql.eventsOnDate = [];
    for (const event of events) {
      try {
        const record = parse(event.payload_json);
        const customerId = record.status === 'NEW' ? record.duplicateCustomerId || record.customerId || 'CUS-' + event.id : null;
        const rows = customerId ? await query(`SELECT c.id,d.deleted FROM customers c LEFT JOIN crm_documents d
          ON d.collection='customers' AND d.id=c.id WHERE c.id=?`, [customerId]) : [];
        report.sql.eventsOnDate.push({...summary(record), id:event.id, committedAt:event.created_at,
          customerId, customerExists: rows.length > 0, hiddenByDeletedDocument: Number(rows[0]?.deleted) === 1});
      } catch (error) { report.errors.push({stage:'eventCorrelation', id:event.id, code:error.code || 'INVALID_EVENT'}); }
    }
  }
  return report;
}
async function main() {
  const dateFlag = process.argv.indexOf('--date');
  const date = dateFlag >= 0 ? process.argv[dateFlag + 1] : new Date().toLocaleString('sv-SE', {timeZone:'Asia/Ho_Chi_Minh'}).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    console.error('Usage: node tools/diagnose-webhook.cjs --date YYYY-MM-DD'); process.exitCode = 1; return;
  }
  const db = require('../db.js');
  try {
    const query = db.dbConfigured ? db.dbQuery : async () => { throw Object.assign(Error('Missing SQL settings'), {code:'DB_NOT_CONFIGURED'}); };
    const report = await diagnose({date, query});
    const source = await fs.readFile(path.resolve(__dirname, '../webhook-server.cjs'), 'utf8');
    report.diskBuild = source.match(/const BUILD_VERSION = '([^']+)'/)?.[1] || null;
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } finally { await Promise.all([db.pool.end(), db.authPool.end(), db.telegramPool.end()]); }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({code:error.code || 'DIAGNOSTIC_ERROR'})); process.exitCode = 1; });
module.exports = {diagnose};
