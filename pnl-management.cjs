'use strict';

const crypto = require('node:crypto');
const { pool, dbQuery } = require('./db.js');

let schemaReady;
const TODAY_SQL = "CONVERT_TZ(NOW(),'SYSTEM','Asia/Bangkok')";

async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS pnl_customers (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(96) NOT NULL UNIQUE,
      customer_name VARCHAR(160) NOT NULL,
      cqg_account VARCHAR(96) NOT NULL UNIQUE,
      initial_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
      current_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
      default_lot DECIMAL(10,2) NOT NULL DEFAULT 0,
      assigned_to VARCHAR(96) NULL,
      created_by VARCHAR(96) NOT NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pnl_created_by (created_by), INDEX idx_pnl_assigned_to (assigned_to), INDEX idx_pnl_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS pnl_daily_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      trade_date DATE NOT NULL,
      lot_volume DECIMAL(10,2) NOT NULL DEFAULT 0,
      pnl_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      source ENUM('web','telegram') NOT NULL DEFAULT 'web',
      notes TEXT NULL,
      recorded_by VARCHAR(96) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pnl_customer_date (customer_id, trade_date),
      INDEX idx_pnl_log_date (trade_date), INDEX idx_pnl_log_recorded_by (recorded_by),
      CONSTRAINT fk_pnl_log_customer FOREIGN KEY (customer_id) REFERENCES pnl_customers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await pool.query(`CREATE TABLE IF NOT EXISTS pnl_weekly_summaries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      week_start_date DATE NOT NULL,
      week_end_date DATE NOT NULL,
      total_lots DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_pnl DECIMAL(18,2) NOT NULL DEFAULT 0,
      ending_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pnl_week (customer_id, week_start_date),
      INDEX idx_pnl_week_end (week_end_date),
      CONSTRAINT fk_pnl_week_customer FOREIGN KEY (customer_id) REFERENCES pnl_customers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    return true;
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

function roleOf(user) { return String(user?.role || '').toUpperCase(); }
function isPnlRole(user) { return ['ADMIN', 'MANAGER', 'LEADER', 'SALE'].includes(roleOf(user)); }
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
function weekStart(date = today()) {
  const d = new Date(`${date}T00:00:00+07:00`);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function weekEnd(start) { const d = new Date(`${start}T00:00:00+07:00`); d.setDate(d.getDate() + 6); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
function cleanText(value, max) { return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max); }
function money(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function idFor(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }

async function staffMap() {
  // The production users table stores the hierarchy in leader_id. Older PnL
  // code selected manager_id, but that column is not part of the CRM schema
  // and made every PnL read fail with ER_BAD_FIELD_ERROR.
  const rows = await dbQuery('SELECT id, name, role, team_id, leader_id, telegram_chat_id, active FROM users WHERE active = 1');
  return new Map(rows.map(row => [String(row.id), row]));
}
function managerIdFor(member, staff) {
  if (!member) return '';
  const role = String(member.role || '').toUpperCase();
  if (role === 'MANAGER') return String(member.id || '');
  if (role === 'LEADER') return String(member.leader_id || '');
  const leader = staff.get(String(member.leader_id || ''));
  return leader && String(leader.role || '').toUpperCase() === 'LEADER' ? String(leader.leader_id || '') : '';
}
function visibleByHierarchy(user, customer, staff) {
  const role = roleOf(user), creator = staff.get(String(customer.created_by)), assigned = staff.get(String(customer.assigned_to || ''));
  if (role === 'ADMIN') return true;
  if (!creator || creator.active === 0) return false;
  if (role === 'SALE') return String(customer.created_by) === String(user.id);
  if (role === 'LEADER') return String(customer.created_by) === String(user.id) || (creator.role === 'SALE' && (String(creator.leader_id || '') === String(user.id) || (creator.team_id && creator.team_id === user.teamId)));
  if (role === 'MANAGER') return String(customer.created_by) === String(user.id) || managerIdFor(creator, staff) === String(user.id) || managerIdFor(assigned, staff) === String(user.id);
  return false;
}
async function visibleCustomer(user, id) {
  const rows = await dbQuery('SELECT * FROM pnl_customers WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) throw Object.assign(new Error('Không tìm thấy khách hàng PnL.'), { status: 404 });
  const staff = await staffMap();
  if (!visibleByHierarchy(user, rows[0], staff)) throw Object.assign(new Error('Bạn không có quyền với khách hàng PnL này.'), { status: 403 });
  return rows[0];
}
function validateCustomer(input) {
  const customerCode = cleanText(input.customerCode, 96), customerName = cleanText(input.customerName, 160), cqgAccount = cleanText(input.cqgAccount, 96);
  const initialCapital = money(input.initialCapital), defaultLot = money(input.defaultLot);
  if (!customerCode || !/^[A-Za-z0-9._-]{2,96}$/.test(customerCode)) throw Object.assign(new Error('ID khách hàng không hợp lệ.'), { status: 400 });
  if (!customerName) throw Object.assign(new Error('Tên khách hàng không được để trống.'), { status: 400 });
  if (!cqgAccount) throw Object.assign(new Error('Tài khoản CQG không được để trống.'), { status: 400 });
  if (initialCapital < 0 || initialCapital > 1e18 || defaultLot < 0 || defaultLot > 1e8) throw Object.assign(new Error('Vốn hoặc số lot không hợp lệ.'), { status: 400 });
  return { customerCode, customerName, cqgAccount, initialCapital, defaultLot };
}

async function list(user, filters = {}) {
  await ensureSchema();
  if (!isPnlRole(user)) throw Object.assign(new Error('Tài khoản không có quyền quản lý lãi lỗ.'), { status: 403 });
  const [customers, logs, weekly, staff] = await Promise.all([
    dbQuery('SELECT * FROM pnl_customers WHERE status = \'active\' ORDER BY updated_at DESC, id DESC'),
    dbQuery('SELECT * FROM pnl_daily_logs WHERE trade_date >= DATE_SUB(CURDATE(), INTERVAL 35 DAY) ORDER BY trade_date DESC, id DESC'),
    dbQuery('SELECT * FROM pnl_weekly_summaries ORDER BY week_start_date DESC, id DESC LIMIT 500'),
    staffMap()
  ]);
  const visible = customers.filter(row => visibleByHierarchy(user, row, staff));
  const query = cleanText(filters.search, 120).toLowerCase();
  const filtered = visible.filter(row => !query || `${row.customer_code} ${row.customer_name} ${row.cqg_account}`.toLowerCase().includes(query));
  const currentWeek = filters.weekStart || weekStart();
  const weekEndDate = weekEnd(currentWeek), todayDate = filters.date || today();
  const visibleIds = new Set(filtered.map(row => String(row.id)));
  const dailyByCustomer = new Map(), weekByCustomer = new Map();
  for (const log of logs) if (visibleIds.has(String(log.customer_id))) {
    const id = String(log.customer_id); if (log.trade_date === todayDate) dailyByCustomer.set(id, Number(log.pnl_amount));
    if (String(log.trade_date) >= currentWeek && String(log.trade_date) <= weekEndDate) { const total = weekByCustomer.get(id) || { pnl: 0, lots: 0 }; total.pnl += Number(log.pnl_amount); total.lots += Number(log.lot_volume); weekByCustomer.set(id, total); }
  }
  return { customers: filtered.map(row => ({ ...row, id: String(row.id), initial_capital: Number(row.initial_capital), current_capital: Number(row.current_capital), default_lot: Number(row.default_lot), today_pnl: dailyByCustomer.get(String(row.id)) || 0, week_pnl: weekByCustomer.get(String(row.id))?.pnl || 0, week_lots: weekByCustomer.get(String(row.id))?.lots || 0, creator_name: staff.get(String(row.created_by))?.name || '', assignee_name: staff.get(String(row.assigned_to))?.name || '' })), logs: logs.filter(row => visibleIds.has(String(row.customer_id))).map(row => ({ ...row, id: String(row.id), customer_id: String(row.customer_id), lot_volume: Number(row.lot_volume), pnl_amount: Number(row.pnl_amount) })), weekly: weekly.filter(row => visibleIds.has(String(row.customer_id))).map(row => ({ ...row, id: String(row.id), customer_id: String(row.customer_id), total_lots: Number(row.total_lots), total_pnl: Number(row.total_pnl), ending_capital: Number(row.ending_capital) })), weekStart: currentWeek, weekEnd: weekEndDate, date: todayDate };
}

async function createCustomer(user, input) {
  await ensureSchema(); if (!isPnlRole(user)) throw Object.assign(new Error('Tài khoản không có quyền tạo khách PnL.'), { status: 403 });
  const v = validateCustomer(input), assignedTo = cleanText(input.assignedTo || user.id, 96);
  const staff = await staffMap(), assigned = staff.get(assignedTo);
  if (!assigned || !['ADMIN', 'MANAGER', 'LEADER', 'SALE'].includes(String(assigned.role).toUpperCase())) throw Object.assign(new Error('Người phụ trách không hợp lệ.'), { status: 400 });
  if (roleOf(user) === 'SALE' && assignedTo !== String(user.id)) throw Object.assign(new Error('Sale chỉ được tạo khách cho chính mình.'), { status: 403 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); await connection.query('SELECT id FROM pnl_customers WHERE customer_code = ? OR cqg_account = ? FOR UPDATE', [v.customerCode, v.cqgAccount]);
    const [result] = await connection.execute('INSERT INTO pnl_customers(customer_code,customer_name,cqg_account,initial_capital,current_capital,default_lot,assigned_to,created_by) VALUES (?,?,?,?,?,?,?,?)', [v.customerCode, v.customerName, v.cqgAccount, v.initialCapital, v.initialCapital, v.defaultLot, assignedTo, user.id]);
    await connection.commit(); return { id: String(result.insertId), ...v, currentCapital: v.initialCapital, assignedTo, createdBy: user.id };
  } catch (error) { await connection.rollback().catch(() => {}); if (error.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('ID khách hàng hoặc tài khoản CQG đã tồn tại.'), { status: 409 }); throw error; } finally { connection.release(); }
}

async function upsertLog(user, input) {
  await ensureSchema(); const customer = await visibleCustomer(user, input.customerId);
  const tradeDate = cleanText(input.tradeDate || today(), 10), lotVolume = money(input.lotVolume), pnlAmount = money(input.pnlAmount), notes = String(input.notes || '').trim().slice(0, 2000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || tradeDate > today()) throw Object.assign(new Error('Ngày giao dịch không hợp lệ.'), { status: 400 });
  if (lotVolume < 0 || lotVolume > 1e8 || !Number.isFinite(pnlAmount) || Math.abs(pnlAmount) > 1e18) throw Object.assign(new Error('Số lot hoặc lãi lỗ không hợp lệ.'), { status: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); await connection.query('SELECT id FROM pnl_customers WHERE id = ? FOR UPDATE', [customer.id]);
    await connection.execute(`INSERT INTO pnl_daily_logs(customer_id,trade_date,lot_volume,pnl_amount,source,notes,recorded_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE lot_volume=VALUES(lot_volume),pnl_amount=VALUES(pnl_amount),source=VALUES(source),notes=VALUES(notes),recorded_by=VALUES(recorded_by),updated_at=CURRENT_TIMESTAMP`, [customer.id, tradeDate, lotVolume, pnlAmount, input.source === 'telegram' ? 'telegram' : 'web', notes, user.id]);
    await connection.execute('UPDATE pnl_customers SET current_capital = initial_capital + COALESCE((SELECT SUM(pnl_amount) FROM pnl_daily_logs WHERE customer_id = ?),0), updated_at=CURRENT_TIMESTAMP WHERE id=?', [customer.id, customer.id]);
    const [rows] = await connection.execute('SELECT * FROM pnl_customers WHERE id=?', [customer.id]); await connection.commit();
    return { customer: rows[0], tradeDate, lotVolume, pnlAmount, riskAlert: pnlAmount < 0 && Math.abs(pnlAmount) >= Math.max(1, Number(customer.initial_capital) * 0.2) };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

async function closeWeek(user, start = weekStart()) {
  await ensureSchema(); if (roleOf(user) !== 'ADMIN') throw Object.assign(new Error('Chỉ Admin được chốt tổng kết tuần.'), { status: 403 });
  const end = weekEnd(start), rows = await dbQuery('SELECT c.id,c.initial_capital,COALESCE(SUM(l.lot_volume),0) total_lots,COALESCE(SUM(l.pnl_amount),0) total_pnl FROM pnl_customers c LEFT JOIN pnl_daily_logs l ON l.customer_id=c.id AND l.trade_date BETWEEN ? AND ? WHERE c.status=\'active\' GROUP BY c.id,c.initial_capital', [start, end]);
  for (const row of rows) await dbQuery('INSERT INTO pnl_weekly_summaries(customer_id,week_start_date,week_end_date,total_lots,total_pnl,ending_capital) VALUES (?,?,?,?,?,? ) ON DUPLICATE KEY UPDATE total_lots=VALUES(total_lots),total_pnl=VALUES(total_pnl),ending_capital=VALUES(ending_capital)', [row.id, start, end, row.total_lots, row.total_pnl, Number(row.initial_capital) + Number(row.total_pnl)]);
  return { weekStart: start, weekEnd: end, count: rows.length };
}

async function reminderCandidates(date = today()) {
  await ensureSchema();
  return dbQuery(`SELECT c.*,u.name AS owner_name,u.telegram_chat_id AS owner_chat_id FROM pnl_customers c LEFT JOIN users u ON u.id=COALESCE(c.assigned_to,c.created_by) LEFT JOIN pnl_daily_logs l ON l.customer_id=c.id AND l.trade_date=? WHERE c.status='active' AND l.id IS NULL AND u.telegram_chat_id IS NOT NULL`, [date]);
}

module.exports = { ensureSchema, list, createCustomer, upsertLog, closeWeek, reminderCandidates, weekStart, weekEnd, today, staffMap, managerIdFor, visibleByHierarchy, visibleCustomer, isPnlRole };
