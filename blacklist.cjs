'use strict';
const net = require('node:net');
const crypto = require('node:crypto');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function requireAdmin(user) { if (user?.role !== 'ADMIN') fail(403, 'Chỉ Admin được quản lý Blacklist.'); }
function normalizeIp(value) {
  let ip = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!net.isIP(ip)) return '';
  if (net.isIP(ip) === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = ip.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      ip = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
  }
  return ip;
}
function ipId(ip) { return 'BLIP-' + crypto.createHash('sha256').update(ip).digest('hex'); }
function ruleFor(rules, ip) {
  const normalized = normalizeIp(ip);
  return normalized ? rules.find(rule => rule.active !== false && normalizeIp(rule.ip) === normalized) || null : null;
}
function makeRule(user, input, previous = null) {
  requireAdmin(user);
  const ip = normalizeIp(input?.ip);
  if (!ip) fail(400, 'Nhập địa chỉ IPv4 hoặc IPv6 hợp lệ.');
  const at = new Date().toISOString();
  return { id: ipId(ip), ip, reason: String(input.reason || '').trim().slice(0, 500), active: true,
    createdAt: previous?.createdAt || at, createdBy: previous?.createdBy || user.id, updatedAt: at, updatedBy: user.id };
}
function makeEntry(record, rule, source) {
  return { id: 'BL-' + record.id, ip: normalizeIp(record.customer?.ipAddress), ruleId: rule.id, reason: rule.reason,
    status: 'PENDING', receivedAt: record.receivedAt, customer: record.customer, source: source || null,
    record: { ...record, source: source || null } };
}
function acceptedEntry(entry, user, result) {
  requireAdmin(user);
  return { ...entry, status: 'ACCEPTED', acceptedAt: new Date().toISOString(), acceptedBy: user.id,
    customerId: result.customerId, duplicate: Boolean(result.duplicate) };
}
function parse(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
async function sqlRows(connection, collection) {
  const [rows] = await connection.execute('SELECT id, body FROM crm_documents WHERE collection=? AND deleted=0', [collection]);
  return rows.map(row => ({ ...parse(row.body), id: row.id }));
}
async function sqlEntry(connection, id) {
  const [rows] = await connection.execute("SELECT body FROM crm_documents WHERE collection='blacklistEntries' AND id=? AND deleted=0", [id]);
  if (!rows.length) fail(404, 'Data Blacklist không còn tồn tại.');
  return parse(rows[0].body);
}
async function sqlSave(connection, collection, row) {
  await connection.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0', [collection, row.id, JSON.stringify(row)]);
}
async function sqlChanged(connection, actorId, action, target) {
  const requestId = 'blacklist-' + crypto.randomUUID();
  const event = { id: requestId, actorId, action, target, at: new Date().toISOString() };
  await sqlSave(connection, 'audit', event);
  await connection.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)', [requestId, actorId, JSON.stringify([{ key: 'blacklistEntries', id: target }])]);
}
async function saveIp(user, input) {
  requireAdmin(user);
  const crmData = require('./crm-data.cjs'), { pool } = require('./db.js');
  await crmData.prepare();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const previous = ruleFor(await sqlRows(connection, 'blacklistIps'), input.ip);
    const rule = makeRule(user, input, previous);
    await sqlSave(connection, 'blacklistIps', rule);
    await sqlChanged(connection, user.id, 'BLACKLIST_IP', rule.id);
    await connection.commit();
    crmData.invalidateSnapshotCache();
    return rule;
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}
async function removeIp(user, id) {
  requireAdmin(user);
  const crmData = require('./crm-data.cjs'), { pool } = require('./db.js');
  await crmData.prepare();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const rule = (await sqlRows(connection, 'blacklistIps')).find(row => row.id === id);
    if (!rule) fail(404, 'IP không còn trong Blacklist.');
    await connection.execute("UPDATE crm_documents SET deleted=1 WHERE collection='blacklistIps' AND id=?", [id]);
    await sqlChanged(connection, user.id, 'UNBLOCK_IP', id);
    await connection.commit();
    crmData.invalidateSnapshotCache();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}
async function readEntry(user, id) {
  requireAdmin(user);
  await require('./crm-data.cjs').prepare();
  return sqlEntry(require('./db.js').pool, id);
}
module.exports = { requireAdmin, normalizeIp, ipId, ruleFor, makeRule, makeEntry, acceptedEntry,
  sqlRows, sqlEntry, sqlSave, sqlChanged, saveIp, removeIp, readEntry };
