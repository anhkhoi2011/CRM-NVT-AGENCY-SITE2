/**
 * Server webhook + static cho CRM NVT Agency.
 *
 * Chạy:  node webhook-server.cjs
 * Mặc định: http://localhost:4173  (bind 0.0.0.0 nên máy khác trong LAN vào được)
 *
 * Hai việc:
 *  1. Phục vụ file tĩnh của repo (thay `python -m http.server 4173`).
 *  2. Nhận data landing page thật tại:
 *        POST /api/data-sources/webhook/ds-<13 số>-<11 ký tự A-Z0-9>/
 *     LadiPage gọi endpoint này. Data được ghi vào inbox bất biến trên đĩa,
 *     CRM (crm.js) đọc inbox rồi đưa vào Chia Leader.
 *
 * Không có dependency ngoài. Node >= 18 (dùng fetch/global có sẵn).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const zlib = require('node:zlib');
const bcrypt = require('bcryptjs');
const passwordService = require('./password-service.cjs');
const crmData = require('./crm-data.cjs');
const orderAudit = require('./order-audit.cjs');
const { dbConfigured, dbQuery, authQuery, dbHealth, pool, authPool } = require('./db.js');
const { provisionSystemAccounts } = require('./system-accounts.cjs');
const { persistWebhook } = require('./webhook-store.cjs');
const blacklist = require('./blacklist.cjs');
const telegramBot = require('./telegram-bot.cjs');
let telegramWorker=null;
const inlineTelegramScheduler=process.env.RUN_TELEGRAM_SCHEDULER==='1';
function wakeTelegramOutbox(){
 // SQL advisory lock coordinates fallback delivery with other workers.
 if(inlineTelegramScheduler || telegramWorker?.status() !== 'running')void telegramBot.drainLeadNotifications().catch(error=>console.warn('[telegram-outbox]',error.code||error.message));
}
const supportChat = require('./support-chat.cjs');
const googleSheetsBackup = require('./google-sheets-backup.cjs');
const pnlManagement = require('./pnl-management.cjs');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* email optional until npm install */ }

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const SERVER_INSTANCE = crypto.randomUUID();
let demoStateVersion = 1;
const BUILD_VERSION = '20261020-distribution-all-roles-1';
const REPO_ROOT = path.resolve(__dirname);
const runtimeStorage = require('./runtime-storage.cjs');
const runtimeHome = process.env.HOME || path.dirname(REPO_ROOT);
const webhookStorage = runtimeStorage.resolveWritableDirectory({ configured: process.env.WEBHOOK_DATA_DIR, fallback: path.join(runtimeHome, 'webhook-data'), label: 'WEBHOOK_DATA_DIR' });
const DEFAULT_WEBHOOK_DATA_DIR = webhookStorage.path;
const inboxStorage = runtimeStorage.resolveWritableFile({ configured: process.env.WEBHOOK_INBOX_FILE, fallback: path.join(DEFAULT_WEBHOOK_DATA_DIR, '.webhook-inbox.json'), label: 'WEBHOOK_INBOX_FILE' });
const INBOX_FILE = inboxStorage.path;
const webhookJournal = require('./webhook-journal.cjs').createJournal(path.join(DEFAULT_WEBHOOK_DATA_DIR, 'pending'));
function webhookHealthSummary() {
  const counts = {};
  let latest = null;
  for (const record of inbox) {
    const status = String(record.status || 'UNKNOWN');
    counts[status] = (counts[status] || 0) + 1;
    if (!latest || String(record.receivedAt || '') > String(latest.receivedAt || '')) latest = record;
  }
  return { total: inbox.length, statuses: counts, latestReceivedAt: latest?.receivedAt || null, latestStatus: latest?.status || null, latestPersisted: latest?.persisted === true };
}
function vietnamToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// Legacy inbox records are normally from the current incident day. Keep an
// explicit env override for an older backfill, but do not leave today's failed
// submissions stranded after a restart.
const WEBHOOK_RECOVERY_DATE = process.env.WEBHOOK_RECOVERY_DATE || vietnamToday();
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INBOX_RECORDS = 5000;
const MAX_SUPPORT_IMAGE_BYTES = 5 * 1024 * 1024;
const supportStorage = runtimeStorage.resolveWritableDirectory({ configured: process.env.SUPPORT_UPLOAD_DIR, fallback: path.join(runtimeHome, 'crm-support-uploads'), label: 'SUPPORT_UPLOAD_DIR' });
const SUPPORT_UPLOAD_DIR = supportStorage.path;
const TELEGRAM_WEBHOOK_URL = (process.env.TELEGRAM_WEBHOOK_URL || '').trim();
const TELEGRAM_WEBHOOK_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const TELEGRAM_SUPPORT_WEBHOOK_URL = (process.env.TELEGRAM_SUPPORT_WEBHOOK_URL ||
  TELEGRAM_WEBHOOK_URL.replace(/\/api\/telegram\/webhook\/?$/, '/api/telegram/support-webhook')).trim();
const TELEGRAM_SUPPORT_WEBHOOK_SECRET = (process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET || '').trim();

const EMAIL_TOKEN = (process.env.CRM_EMAIL_TOKEN || '').trim();
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : SMTP_PORT === 465;
const SMTP_USER = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER).trim();
const SMTP_ENABLED = Boolean(nodemailer && SMTP_USER && SMTP_PASS && SMTP_FROM);
const mailTransporter = SMTP_ENABLED ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
}) : null;

function dbJson(request, response, status, payload) { return sendJson(response, status, payload, { 'Access-Control-Allow-Origin': request.headers.origin || '*', Vary: 'Origin' }); }
function tokenHash(request) { return crypto.createHash('sha256').update(String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()).digest('hex'); }
const ACTIVITY_LABELS=Object.freeze({dashboard:'Đang xem Tổng quan',customers:'Đang xem Khách hàng tổng',care:'Đang chăm sóc khách hàng',data:'Đang xử lý Data',orders:'Đang xem Đơn hàng',products:'Đang quản lý Sản phẩm',team:'Đang xem Đội ngũ',attendance:'Đang xem Điểm danh',notifications:'Đang xem Thông báo',audit:'Đang xem User log',websites:'Đang quản lý Webhook',revenue:'Đang xem Doanh thu',businessReport:'Đang xem Báo cáo kinh doanh',accounting:'Đang xem Kế toán',settings:'Đang mở Cài đặt',profile:'Đang xem Hồ sơ cá nhân'});
function clientIp(request){
 const headers=request.headers||{};
 const values=[String(headers['x-forwarded-for']||'').split(',')[0],headers['x-real-ip'],request.socket?.remoteAddress];
 const value=values.map(item=>String(item||'').trim().replace(/^::ffff:/i,'')).find(Boolean)||'';
 return value.slice(0,64);
}
function clientUserAgent(request){return String(request.headers?.['user-agent']||'').replace(/[\r\n]/g,' ').slice(0,512);}
function activityLabel(view){return ACTIVITY_LABELS[String(view||'').replace(/^tab-/,'')]||'Đang sử dụng CRM';}
let userActivitySchemaReady=null;
function ensureUserActivitySchema(){
 if(!userActivitySchemaReady){
  userActivitySchemaReady=dbQuery(`CREATE TABLE IF NOT EXISTS user_activity_logs (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(96) NOT NULL, action VARCHAR(48) NOT NULL, detail VARCHAR(255) NOT NULL DEFAULT '', ip VARCHAR(64) NULL, user_agent VARCHAR(512) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_user_activity_user_time (user_id,created_at), INDEX idx_user_activity_time (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
   .then(()=>true)
   .catch(error=>{userActivitySchemaReady=null;throw error;});
 }
 return userActivitySchemaReady;
}
async function recordUserActivity(user,request,action,detail){
 try{await ensureUserActivitySchema();await dbQuery('INSERT INTO user_activity_logs(user_id,action,detail,ip,user_agent) VALUES (?,?,?,?,?)',[user.id,String(action||'').slice(0,48),String(detail||'').slice(0,255),clientIp(request)||null,clientUserAgent(request)||null]);}
 catch(error){console.warn('[user-activity] Không ghi được lịch sử:',error.code||error.message);}
}
async function touchUserSession(request){
 const hash=tokenHash(request);if(!hash)return;
 const cache=touchUserSession.recent||(touchUserSession.recent=new Map());
 const now=Date.now();
 if(cache.has(hash)&&now-cache.get(hash)<20000)return;
 if(cache.size>=5000)cache.delete(cache.keys().next().value);
 cache.set(hash,now);
 const ip=clientIp(request),agent=clientUserAgent(request);
 try {
 await dbQuery(`UPDATE crm_sessions SET last_seen_at=NOW(),expires_at=DATE_ADD(NOW(),INTERVAL 1 DAY),ip=IF(?<>'',?,ip),user_agent=IF(?<>'',?,user_agent) WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<DATE_SUB(NOW(),INTERVAL 20 SECOND))`,[ip,ip,agent,agent,hash]);
 } catch(error) {cache.delete(hash);throw error;}
}
async function setUserActivity(request,view){
 const hash=tokenHash(request),detail=activityLabel(view);if(!hash)return detail;
 const rows=await dbQuery('SELECT last_activity FROM crm_sessions WHERE token_hash=? LIMIT 1',[hash]);
 await dbQuery(`UPDATE crm_sessions SET last_seen_at=NOW(),last_activity=?,ip=IF(?<>'',?,ip),user_agent=IF(?<>'',?,user_agent) WHERE token_hash=?`,[detail,clientIp(request),clientIp(request),clientUserAgent(request),clientUserAgent(request),hash]);
 return {detail,changed:rows[0]?.last_activity!==detail};
}
async function adminUserActivity(){
 const [users,sessions]=await Promise.all([
  dbQuery(`SELECT id,name,role,account_code,active FROM users WHERE active=1 ORDER BY FIELD(role,'ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','HRM','UNASSIGNED'),name`),
  dbQuery(`SELECT user_id,ip,last_seen_at,last_activity,TIMESTAMPDIFF(SECOND,last_seen_at,NOW()) AS idle_seconds FROM crm_sessions WHERE expires_at>NOW() ORDER BY last_seen_at DESC`)
 ]);
 let events=[];
 try{
  await ensureUserActivitySchema();
  events=await dbQuery(`SELECT a.id,a.user_id,a.action,a.detail,a.ip,a.created_at AS at,u.name,u.role FROM user_activity_logs a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`);
 }catch(error){
  console.warn('[user-activity] History unavailable:',error.code||error.message);
 }
 const latestSession=new Map();for(const session of sessions)if(!latestSession.has(session.user_id))latestSession.set(session.user_id,session);
 const latestEvent=new Map();for(const event of events)if(!latestEvent.has(event.user_id))latestEvent.set(event.user_id,event);
 return {generatedAt:stamp(),users:users.map(user=>{const session=latestSession.get(user.id),event=latestEvent.get(user.id),online=Number(session?.idle_seconds)<=120;return {id:user.id,name:user.name,role:user.role,accountId:user.account_code||'',online,lastSeen:session?.last_seen_at||null,activity:online?(session?.last_activity||'Đang sử dụng CRM'):'Đã ngoại tuyến',ip:session?.ip||event?.ip||'',lastEvent:event||null};}),events};
}
const sessionUserCache = new Map();
const SESSION_CACHE_TTL = 60000;
function cacheSessionUser(hash, user) {
  if (!hash || !user) return;
  if (sessionUserCache.size >= 10000) sessionUserCache.delete(sessionUserCache.keys().next().value);
  sessionUserCache.set(hash, { user, at: Date.now() });
}
async function authUser(request) {
  const hash = tokenHash(request);
  if (!hash) return null;
  try {
    const rows=await authQuery('SELECT u.* FROM crm_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.active=1 LIMIT 1', [hash]);
    const user = rows[0] ? crmData.userRow(rows[0]) : null;
    if (user) cacheSessionUser(hash, user); else sessionUserCache.delete(hash);
    return user;
  } catch (error) {
    const cached = sessionUserCache.get(hash);
    if (cached && Date.now() - cached.at < SESSION_CACHE_TTL) {
      console.warn('[auth-session-cache] Dùng phiên cache tạm thời:', error.code || error.message);
      return cached.user;
    }
    throw error;
  }
}
function readDbBody(request) { return readBody(request).then(buffer => JSON.parse(buffer.toString('utf8') || '{}')); }
function manualCustomerError(message){throw Object.assign(new Error(message),{status:400});}
function manualCustomerRecord(user,state,input){
  const requestId=String(input?.requestId||'').trim();
  if(!/^[-\w]{8,96}$/.test(requestId))manualCustomerError('Mã lưu khách không hợp lệ. Hãy mở lại form và thử lại.');
  if(!['ADMIN','MANAGER','LEADER','SALE'].includes(user?.role))manualCustomerError('Tài khoản không có quyền thêm khách hàng.');
  const name=String(input?.name||'').trim().replace(/\s+/g,' '),phone=String(input?.phone||'').replace(/\D/g,'');
  const email=String(input?.email||'').trim().toLowerCase();
  if(!name||name.length>160)manualCustomerError('Họ và tên khách hàng không hợp lệ.');
  if(!/^\d{9,15}$/.test(phone))manualCustomerError('Số điện thoại phải có từ 9 đến 15 chữ số.');
  if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))manualCustomerError('Email không hợp lệ.');
  const sourceValue=String(input?.source||'').trim(),manualSources=new Set(['Khách hàng cũ','Khách hàng ngoài data']);
  const websites=Array.isArray(state.websites)?state.websites:[];
  const website=websites.find(item=>item.id===input?.websiteId);
  if(!manualSources.has(sourceValue)&&!website)manualCustomerError('Nguồn dữ liệu không hợp lệ.');
  const source=manualSources.has(sourceValue)?sourceValue:String(website.name||website.domain||'Nhập thủ công').slice(0,120);
  const staff=(state.accounts||state.members||[]).filter(item=>item.active!==false&&item.active!==0);
  const requestedId=String(input?.saleId||'').trim();
  const managerLeaders=staff.filter(item=>item.role==='LEADER'&&item.managerId===user.id);
  const managerLeaderIds=new Set(managerLeaders.map(item=>item.id));
  const managerSales=staff.filter(item=>item.role==='SALE'&&(item.managerId===user.id||managerLeaderIds.has(item.leaderId)));
  let allowed=[];
  if(user.role==='ADMIN')allowed=staff.filter(item=>['MANAGER','LEADER','SALE'].includes(item.role));
  if(user.role==='MANAGER')allowed=[staff.find(item=>item.id===user.id),...managerLeaders,...managerSales].filter(Boolean);
  if(user.role==='LEADER')allowed=[staff.find(item=>item.id===user.id),...staff.filter(item=>item.role==='SALE'&&item.leaderId===user.id)].filter(Boolean);
  if(user.role==='SALE')allowed=[staff.find(item=>item.id===user.id)].filter(Boolean);
  let recipient=requestedId?allowed.find(item=>item.id===requestedId):null;
  if(requestedId&&!recipient)manualCustomerError('Người phụ trách không nằm trong phạm vi tài khoản.');
  if(!recipient&&user.role!=='ADMIN')recipient=staff.find(item=>item.id===user.id)||null;
  const at=stamp(), id='CUS-MAN-'+crypto.createHash('sha256').update(requestId).digest('hex').slice(0,24);
  const customFields=input?.customFields&&typeof input.customFields==='object'&&!Array.isArray(input.customFields)?structuredClone(input.customFields):{};
  const customer={id,name,phone,email,source,campaign:'MANUAL-CRM',websiteId:website?.id||null,landingPageName:website?.name||website?.domain||source,landingPageUrl:website?.sourceUrl||'',landingPageDomain:website?.domain||'',ipAddress:clientIp(input?.request)||'Chưa xác định',manualEntry:true,status:'NEW',saleId:null,leaderId:null,teamId:null,managerId:null,saleAcceptedAt:null,createdAt:at,updatedAt:at,lastIntakeAt:at,lastIntakeType:'MANUAL',note:'Tạo thủ công từ CRM',customFields};
  if(recipient?.role==='MANAGER'){customer.saleId=recipient.id;customer.managerId=recipient.id;customer.saleAcceptedAt=at;customer.note='Phân công khi tạo khách từ CRM';}
  else if(recipient?.role==='LEADER'){customer.saleId=recipient.id;customer.leaderId=recipient.id;customer.teamId=recipient.teamId||null;customer.managerId=recipient.managerId||null;customer.saleAcceptedAt=at;customer.note='Phân công khi tạo khách từ CRM';}
  else if(recipient?.role==='SALE'){customer.saleId=recipient.id;customer.leaderId=recipient.leaderId||null;customer.teamId=recipient.teamId||null;customer.managerId=recipient.managerId||null;customer.saleAcceptedAt=at;customer.note='Phân công khi tạo khách từ CRM';}
  return customer;
}
async function createManualCustomer(user,input,request){
  const before=await crmData.read(user);
  const customer=manualCustomerRecord(user,before.state,{...input,request});
  const result=await crmData.write(user,String(input.requestId),[{key:'customers',id:customer.id,base:null,value:customer}]);
  return {...result,customerId:customer.id};
}
async function passwordMatches(value, stored) {
  if (/^\$2[aby]\$/.test(stored || '')) return passwordService.compare(value, stored);
  // Hỗ trợ mật khẩu cũ; nâng cấp sang bcrypt sau lần đăng nhập đúng.
  return value.length > 0 && value === stored;
}

async function hashPassword(value) {
  return passwordService.hash(value);
}

function needsPasswordRehash(stored) {
  return /^\$2[aby]\$/.test(stored || '') && typeof bcrypt.getRounds === 'function' && bcrypt.getRounds(stored) > 10;
}

// Chế độ demo chỉ được bật chủ động bằng DEMO_MODE=1. npm start/cPanel không bật cờ này.
const DEMO_MODE = typeof process !== 'undefined' && process.env?.DEMO_MODE === '1';
const demoUsers = [
  { id: 'demo-marketing', accountId: 'MARKETING-DEMO', phone: '0900000007', email: 'marketing.demo@local.test', name: 'Marketing Demo', role: 'MARKETING', teamId: '', leaderId: null, active: true },
  { id: 'demo-hrm', accountId: 'HRM-DEMO', phone: '0900000006', email: 'hrm.demo@local.test', name: 'HRM Demo', role: 'HRM', teamId: '', leaderId: null, active: true },
  { id: 'demo-accounting', accountId: 'ACCOUNTING-DEMO', phone: '0900000005', email: 'accounting.demo@local.test', name: 'Kế Toán Demo', role: 'ACCOUNTING', teamId: '', leaderId: null, active: true },
  { id: 'demo-admin', accountId: 'ADMIN-DEMO', phone: '0900000001', email: 'admin.demo@local.test', name: 'Admin Demo', role: 'ADMIN', teamId: '', leaderId: null, active: true },
  { id: 'demo-manager', accountId: 'MANAGER-DEMO', phone: '0900000004', email: 'manager.demo@local.test', name: 'Manager Demo', role: 'MANAGER', teamId: '', leaderId: null, active: true },
  { id: 'demo-leader', accountId: 'LEADER-DEMO', phone: '0900000002', email: 'leader.demo@local.test', name: 'Leader Demo', role: 'LEADER', teamId: 'DEMO', leaderId: null, managerId: 'demo-manager', active: true },
  { id: 'demo-sale', accountId: 'SALE-DEMO', phone: '0900000003', email: 'sale.demo@local.test', name: 'Sale Demo', role: 'SALE', teamId: 'DEMO', leaderId: 'demo-leader', active: true },
  { id: 'demo-sale-2', accountId: 'SALE-DEMO-2', phone: '0900000008', email: 'sale2.demo@local.test', name: 'Sale Demo 2', role: 'SALE', teamId: 'DEMO', leaderId: 'demo-leader', active: true }
];
const demoPasswords = {
  'marketing.demo@local.test': 'MarketingDemo2026!',
  'marketing@nvtagency.top': 'Marketing2026@',
  'hrm.demo@local.test': 'HrmDemo2026!',
  'accounting.demo@local.test': 'AccountingDemo2026!',
  'admin.demo@local.test': 'AdminDemo2026!',
  'manager.demo@local.test': 'ManagerDemo2026!',
  'leader.demo@local.test': 'LeaderDemo2026!',
  'sale.demo@local.test': 'SaleDemo2026!',
  'sale2.demo@local.test': 'SaleDemo2026!'
};
const demoSessions = new Map();
const demoSessionActivity = new Map();
const demoActivityLogs = [];
const demoState = {
  version: 3,
  members: demoUsers.map(user => ({
    ...user,
    initials: user.name.split(/\s+/).map(part => part[0]).join('').toUpperCase(),
    loginEnabled: true
  })),
  registeredAccounts: [],
  customers: [
    { id: 'DEMO-CUS-1', name: 'Khách demo Premium', phone: '0900000011', email: 'premium@local.test', source: 'Demo', campaign: 'DEMO', status: 'NEW', saleId: 'demo-sale', leaderId: 'demo-leader', teamId: 'DEMO', note: 'Dữ liệu demo', customFields: { customerClass: 'Premium' }, createdAt: '2026-09-15 09:00', updatedAt: '2026-09-15 09:00' },
    { id: 'DEMO-CUS-2', name: 'Khách demo Whale', phone: '0900000012', email: 'whale@local.test', source: 'Demo', campaign: 'DEMO', status: 'CONTACTED', saleId: null, leaderId: 'demo-leader', teamId: 'DEMO', note: 'Dữ liệu demo', customFields: { customerClass: 'Whale' }, createdAt: '2026-09-15 10:00', updatedAt: '2026-09-15 10:00' }
  ],
  orders: [], products: DEMO_MODE ? structuredClone(require('./product-catalog.json')) : [], productCategories: DEMO_MODE ? [...new Set(require('./product-catalog.json').map(item => item.category))] : [], registrations: [],
  customFieldDefinitions: DEMO_MODE ? structuredClone(require('./crm-defaults.json').customFieldDefinitions) : [], customerFieldHistory: [], assignmentHistory: [],
  resubmissions: [], notes: [], imports: [], attendance: [], dataOffers: [],
  traffic: [], tasks: [], notifications: [], audit: [], websites: [{ id: 'WEB-DEMO', name: 'Nguồn local', domain: 'localhost:4173', sourceUrl: 'http://localhost:4173/', status: 'ACTIVE' }],
  integrations: [], webhookPending: [], blacklistIps: [], blacklistEntries: [], brokerageMetrics: [], careGroups: [], expenses: [], courseConfigs: [], bankStatements: [], pnlCustomers: [], pnlDailyLogs: [], pnlWeeklySummaries: [],
  settings: { assignmentMode: 'BALANCED', leaderCanUpdate: true, leaderAttendanceRequired: true },
  leaderDistribution: { enabled: true, enabledLeaderIds: ['demo-leader'], weights: { 'demo-leader': 1 }, sourceRules: [] },
  saleDistributionByLeader: { 'demo-leader': { leaderEnabled: true, enabledSaleIds: ['demo-sale'], weights: { 'demo-leader': 1, 'demo-sale': 1 } } }
};

// Chỉ phục hồi RAM demo từ tệp local được chỉ định khi khởi động; production không đọc tệp này.
if(DEMO_MODE&&process.env.DEMO_STATE_FILE){Object.assign(demoState,JSON.parse(fs.readFileSync(process.env.DEMO_STATE_FILE,'utf8').replace(/^\uFEFF/,'')));}
// Repair older demo snapshots so the required Level column is always available.
if (DEMO_MODE) {
  const defaultFields = require('./crm-defaults.json').customFieldDefinitions || [];
  const defaultLevel = defaultFields.find(field => field.id === 'customerLevel');
  if (defaultLevel && !demoState.customFieldDefinitions.some(field => field.id === 'customerLevel')) demoState.customFieldDefinitions.unshift(structuredClone(defaultLevel));
  for (const customer of demoState.customers) {
    customer.customFields ||= {};
    if (!Object.hasOwn(customer.customFields, 'customerLevel')) customer.customFields.customerLevel = 'L0';
  }
}
// Ensure all demo roles remain available when restoring an older RAM snapshot.
if (DEMO_MODE) {
  for (const account of demoUsers) {
    const existing = demoState.members.find(member => member.id === account.id);
    if (existing) Object.assign(existing, account, { loginEnabled: true });
    else demoState.members.push({
      ...account,
      initials: account.name.split(/\s+/).map(part => part[0]).join('').toUpperCase(),
      loginEnabled: true
    });
  }
}

// Bo du lieu mau day du cho viec kiem tra giao dien va phan quyen tren demo server.
// Chi them ban ghi thieu, khong ghi de thao tac ma nguoi dung da tao trong phien demo.
function seedDemoWorkspace() {
  if (!DEMO_MODE) return;
  const addOnce = (list, row) => { if (!list.some(item => item.id === row.id)) list.push(row); };
  const demoNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 16);
  const addMember = (row, password) => {
    addOnce(demoState.members, { ...row, initials: row.name.split(/\\s+/).map(part => part[0]).join('').toUpperCase(), loginEnabled: true });
    demoPasswords[row.email] = password;
  };
  addMember({ id: 'demo-leader-2', accountId: 'LEADER-DEMO-2', phone: '0900000014', email: 'leader2.demo@local.test', name: 'Leader Demo 2', role: 'LEADER', teamId: 'DEMO-2', leaderId: null, managerId: 'demo-manager', active: true }, 'LeaderDemo2026!');
  addMember({ id: 'demo-sale-2', accountId: 'SALE-DEMO-2', phone: '0900000015', email: 'sale2.demo@local.test', name: 'Sale Demo 2', role: 'SALE', teamId: 'DEMO-2', leaderId: 'demo-leader-2', active: true }, 'SaleDemo2026!');
  addMember({ id: 'demo-sale-3', accountId: 'SALE-DEMO-3', phone: '0900000016', email: 'sale3.demo@local.test', name: 'Sale Demo 3', role: 'SALE', teamId: 'DEMO', leaderId: 'demo-leader', active: true }, 'SaleDemo2026!');
  addMember({ id: 'demo-sale-manager', accountId: 'SALE-MANAGER-DEMO', phone: '0900000017', email: 'sale.manager.demo@local.test', name: 'Sale Truc Thuoc Manager', role: 'SALE', teamId: 'MANAGER-DIRECT', leaderId: null, managerId: 'demo-manager', active: true }, 'SaleDemo2026!');

  const customer = (id, name, phone, owner, status, customerClass, level, createdAt, extra = {}) => ({
    id, name, phone, email: `${id.toLowerCase()}@local.test`, source: extra.source || 'Landing Page', campaign: extra.campaign || 'DEMO-2026', status,
    managerId: owner?.managerId || null, saleAcceptedAt: owner?.saleId ? createdAt : null, saleId: owner?.saleId || null, leaderId: owner?.leaderId || null, teamId: owner?.teamId || null,
    note: extra.note || 'Dữ liệu mẫu để kiểm tra quy trình CRM',
    customFields: {
      customerClass,
      customerLevel: level,
      callStatus: extra.callStatus || (status === 'CONTACTED' ? 'Đã gọi được' : 'Chưa gọi'),
      goi_ket_noi: extra.goi_ket_noi || (status === 'CONTACTED' ? 'Đã gọi được' : 'Chưa gọi'),
      first_call_at: extra.first_call_at || (status === 'CONTACTED' ? createdAt : null),
      ket_qua_cham_soc: extra.ket_qua_cham_soc || (status === 'CONTACTED' ? 'Quan tâm cao' : 'Không nghe máy'),
      province: extra.province || 'Hà Nội',
      age_range: extra.age_range || '25–34',
      gender: extra.gender || 'Nam',
      job: extra.job || 'Kinh doanh tự do',
      capital_range: extra.capital_range || '50–200 triệu',
      experience: extra.experience || '1–3 năm',
      market_interest: extra.market_interest || 'Vàng (XAUUSD)',
      main_interest: extra.main_interest || 'Tín hiệu giao dịch',
      main_objection: extra.main_objection || 'Không có',
      deposit_amount: extra.deposit_amount || null,
      device_info: extra.device_info || 'iPhone 15 Pro Max',
      utm_content: extra.utm_content || 'Video_TinHieuVang_Breakout',
      ...(extra.customFields || {})
    },
    createdAt, updatedAt: createdAt
  });
  const owners = {
    leader1: { leaderId: 'demo-leader', teamId: 'DEMO' },
    leader2: { leaderId: 'demo-leader-2', teamId: 'DEMO-2' },
    sale1: { saleId: 'demo-sale', leaderId: 'demo-leader', teamId: 'DEMO' },
    sale2: { saleId: 'demo-sale-2', leaderId: 'demo-leader-2', teamId: 'DEMO-2' },
    sale3: { saleId: 'demo-sale-3', leaderId: 'demo-leader', teamId: 'DEMO' },
    managerSale: { saleId: 'demo-sale-manager', leaderId: null, managerId: 'demo-manager', teamId: 'MANAGER-DIRECT' }
  };
  [
    customer('DEMO-CUS-3', 'Nguyễn Minh Anh', '0988407096', owners.sale1, 'CONTACTED', 'Premium', 'L3', '2026-09-16 08:30', { source: 'TikTok Ads', campaign: 'XAUUSD-Breakout', utm_content: 'Video_FakeBreakout_Vang', province: 'Hà Nội', age_range: '35–44', gender: 'Nam', job: 'Kinh doanh tự do', capital_range: '200 triệu–1 tỷ', market_interest: 'Vàng (XAUUSD)', main_interest: 'Tín hiệu giao dịch', deposit_amount: 50000000, device_info: 'iPhone 15 Pro Max' }),
    customer('DEMO-CUS-4', 'Trần Hoàng Nam', '0912345678', owners.sale3, 'NEW', 'Whale', 'L1', '2026-09-16 09:15', { source: 'Facebook Ads', campaign: 'Forex-NgoaiHoi', utm_content: 'Image_KienThuc_NgoaiHoi', province: 'TP. Hồ Chí Minh', age_range: '25–34', gender: 'Nam', job: 'Nhân viên văn phòng', capital_range: '50–200 triệu', market_interest: 'Forex', main_interest: 'Học phương pháp', device_info: 'iPhone 14 Pro' }),
    customer('DEMO-CUS-5', 'Lê Thu Hà', '0903456789', owners.sale2, 'CONTACTED', 'Premium', 'L4.1', '2026-09-15 10:00', { source: 'Google Ads', campaign: 'XAUUSD-VIP', utm_content: 'Search_TinHieu_Vang_VIP', province: 'Đà Nẵng', age_range: '35–44', gender: 'Nữ', job: 'Kinh doanh tự do', capital_range: '200 triệu–1 tỷ', market_interest: 'Vàng (XAUUSD)', main_interest: 'Coaching 1-1', deposit_amount: 100000000, device_info: 'iPhone 16 Pro Max' }),
    customer('DEMO-CUS-6', 'Phạm Gia Bảo', '0977112233', owners.leader1, 'NEW', 'Lạnh', 'L0', '2026-09-17 08:00', { goi_ket_noi: 'Chưa gọi được', callStatus: 'Thuê bao', ket_qua_cham_soc: 'Thuê bao', province: 'Hải Phòng', age_range: '18–24', gender: 'Nam', job: 'Sinh viên', capital_range: 'Dưới 10 triệu', main_objection: 'Chưa đủ vốn', device_info: 'Samsung Galaxy S23' }),
    customer('DEMO-CUS-7', 'Võ Thanh Tùng', '0944556677', owners.leader2, 'NEW', 'Ấm', 'L1', '2026-09-17 08:10', { source: 'TikTok Ads', campaign: 'XAUUSD-Breakout', utm_content: 'Video_FakeBreakout_Vang', province: 'Cần Thơ', age_range: '25–34', gender: 'Nam', job: 'Công chức/giáo viên', capital_range: '10–50 triệu', market_interest: 'Forex', device_info: 'iPhone 13' }),
    customer('DEMO-CUS-8', 'Đỗ Ngọc Linh', '0966778899', owners.sale1, 'CONTACTED', 'Nóng', 'L6', '2026-09-14 14:20', { source: 'Facebook Ads', campaign: 'XAUUSD-VIP', utm_content: 'Video_ChienLuoc_Gold', province: 'Hà Nội', age_range: '45–54', gender: 'Nữ', job: 'Kinh doanh tự do', capital_range: 'Trên 1 tỷ', market_interest: 'Vàng (XAUUSD)', main_interest: 'Tín hiệu giao dịch', deposit_amount: 250000000, device_info: 'iPhone 15 Plus' }),
    customer('DEMO-CUS-9', 'Bùi Quốc Việt', '0933221100', owners.sale3, 'NEW', 'Pending', 'L0', '2026-09-13 16:45', { goi_ket_noi: 'Chưa gọi', callStatus: 'Chưa gọi', ket_qua_cham_soc: '', province: 'Bình Dương (IP 4G)', age_range: '25–34', gender: 'Nam', job: 'Công nhân/lao động', capital_range: '10–50 triệu', device_info: 'Xiaomi Redmi Note 13' }),
    customer('DEMO-CUS-MANAGER', 'Khách của Sale Manager', '0988112233', owners.managerSale, 'NEW', 'Ấm', 'L2', '2026-09-18 09:20', { province: 'Đồng Nai', age_range: '35–44', gender: 'Nam', job: 'Kinh doanh tự do', capital_range: '50–200 triệu', device_info: 'iPhone 14' }),
    customer('DEMO-CUS-10', 'Hoàng Mai Phương', '0911223344', owners.leader2, 'CONTACTED', 'Whale', 'L7', '2026-09-12 11:30', { source: 'Facebook Ads', campaign: 'XAUUSD-VIP', utm_content: 'Video_ChienLuoc_Gold', province: 'TP. Hồ Chí Minh', age_range: '35–44', gender: 'Nữ', job: 'Kinh doanh tự do', capital_range: 'Trên 1 tỷ', market_interest: 'Vàng (XAUUSD)', main_interest: 'Coaching 1-1', deposit_amount: 500000000, device_info: 'iPhone 16 Pro Max' }),
    customer('DEMO-CUS-11', 'Đặng Quốc Huy', '0922334455', owners.sale1, 'NEW', 'Lạnh', 'L0', '2026-09-18 10:15', { goi_ket_noi: 'Chưa gọi', callStatus: 'Chưa gọi', ket_qua_cham_soc: '', province: 'Bắc Ninh', age_range: '25–34', gender: 'Nam', job: 'Nhân viên văn phòng', device_info: 'Oppo Reno 10' }),
    customer('DEMO-CUS-12', 'Nguyễn Thùy Trang', '0977889900', owners.sale2, 'CONTACTED', 'Premium', 'L8', '2026-09-10 14:00', { source: 'Google Ads', campaign: 'XAUUSD-VIP', utm_content: 'Search_TinHieu_Vang_VIP', province: 'Hà Nội', age_range: '35–44', gender: 'Nữ', job: 'Kinh doanh tự do', capital_range: '200 triệu–1 tỷ', market_interest: 'Vàng (XAUUSD)', deposit_amount: 150000000, device_info: 'iPhone 15 Pro' })
  ].forEach(row => addOnce(demoState.customers, row));

  // Cột "Khoá" của Chăm sóc khách là gốc của báo cáo khóa học: mỗi giá trị K0x là một lớp.
  const courseKeys = ['K01', 'K02', 'K03', 'K04', 'K05'];
  const courseColors = ['#246b9b', '#a3650b', '#157a4b', '#e8572a', '#7c3aed'];
  const courseField = demoState.customFieldDefinitions.find(field => field.id === 'course');
  if (courseField) {
    const known = new Set((courseField.options || []).map(option => option.value));
    courseField.label = 'Khoá';
    courseField.showInTable = true;
    courseField.options = [...courseKeys.filter(key => !known.has(key)).map((key, index) => ({ value: key, label: key, color: courseColors[index] })), ...(courseField.options || []).filter(option => courseKeys.includes(option.value) || !/^(BMĐTHH|Coaching VIP|Chuyên sâu|Cộng đồng giao dịch)$/.test(option.value))]
      .sort((a, b) => String(a.value).localeCompare(String(b.value)));
  }
  const customerCourse = { 'DEMO-CUS-1': ['K03'], 'DEMO-CUS-3': ['K03'], 'DEMO-CUS-4': ['K05'], 'DEMO-CUS-5': ['K04'], 'DEMO-CUS-8': ['K05'], 'DEMO-CUS-9': ['K03'], 'DEMO-CUS-MANAGER': ['K04'], 'DEMO-CUS-10': ['K02'] };
  for (const row of demoState.customers) {
    if (customerCourse[row.id] && !row.customFields?.course) row.customFields = { ...(row.customFields || {}), course: customerCourse[row.id] };
  }

  // Bốn nhóm sản phẩm của báo cáo doanh thu: Khóa học, Chỉ báo, Nhóm VIP, Khác.
  const kindOf = product => product.kind || (product.type === 'RENTAL' ? 'INDICATOR' : /kh[oó]a h[oọ]c/i.test(product.category || '') ? 'COURSE' : 'OTHER');
  for (const product of demoState.products) product.kind = kindOf(product);
  addOnce(demoState.products, { id: 'p-vip-3m', sku: 'VIP-SIGNAL-3M', name: 'Nhóm VIP tín hiệu · thuê 3 tháng', category: 'Nhóm VIP', kind: 'VIP', price: 6000000, type: 'RENTAL', rentalMonths: 3, vatRate: 0.1, active: true });
  addOnce(demoState.products, { id: 'p-vip-12m', sku: 'VIP-SIGNAL-12M', name: 'Nhóm VIP tín hiệu · thuê 1 năm', category: 'Nhóm VIP', kind: 'VIP', price: 18000000, type: 'RENTAL', rentalMonths: 12, vatRate: 0.1, active: true });
  addOnce(demoState.products, { id: 'p-other-coaching', sku: 'SV-COACH-11', name: 'Coaching 1-1 theo giờ', category: 'Dịch vụ khác', kind: 'OTHER', price: 3000000, type: 'SALE', rentalMonths: null, vatRate: 0.1, active: true });
  for (const category of ['Nhóm VIP', 'Dịch vụ khác']) if (!demoState.productCategories.includes(category)) demoState.productCategories.push(category);

  // Kế toán chỉ ghi nhận đơn được tạo trong CRM, không tự sinh doanh thu mẫu.
  demoState.expenses ||= [];
  demoState.courseConfigs ||= [];

  addOnce(demoState.dataOffers, { id: 'DEMO-OFFER-1', customerId: 'DEMO-CUS-6', saleId: 'demo-sale', leaderId: 'demo-leader', teamId: 'DEMO', status: 'PENDING', offeredAt: demoNow });
  addOnce(demoState.dataOffers, { id: 'DEMO-OFFER-2', customerId: 'DEMO-CUS-7', saleId: 'demo-sale-2', leaderId: 'demo-leader-2', teamId: 'DEMO-2', status: 'PENDING', offeredAt: demoNow });
  for (const offerId of ['DEMO-OFFER-1', 'DEMO-OFFER-2']) {
    const offer = demoState.dataOffers.find(item => item.id === offerId);
    const offeredAt = Date.parse(String(offer?.offeredAt || '').replace(' ', 'T') + '+07:00');
    if (offer?.status === 'PENDING' && (!Number.isFinite(offeredAt) || offeredAt + 24 * 3600000 <= Date.now())) {
      offer.offeredAt = demoNow;
      delete offer.resolvedAt;
    }
  }
  addOnce(demoState.careGroups, { id: 'DEMO-CARE-PREMIUM', name: 'Khach Premium', fieldId: 'customerClass', values: ['Premium'], color: '#ca8a04' });
  addOnce(demoState.careGroups, { id: 'DEMO-CARE-WHALE', name: 'Khach Whale', fieldId: 'customerClass', values: ['Whale'], color: '#0f766e' });
  addOnce(demoState.notifications, { id: 'DEMO-NOTICE-1', title: 'Co data moi can xu ly', text: 'Hai khach demo dang cho nhan va phan cong.', role: 'ALL', at: '2026-09-17 08:15', readBy: [] });
  const demoNoticeAt=new Date().toISOString();
  addOnce(demoState.notifications,{id:'DEMO-NOTICE-REVIEW',kind:'PAYMENT_REVIEW',role:'ACCOUNTING',title:'Có đơn hàng thanh toán cần kiểm tra',text:'Ví dụ demo: đơn đã có bill chuyển khoản, chờ Kế toán kiểm tra.',at:demoNoticeAt,readBy:[]});
  addOnce(demoState.notifications,{id:'DEMO-NOTICE-CONFIRMED',kind:'PAYMENT_CONFIRMED',role:'OWN',saleId:'demo-sale',leaderId:'demo-leader',title:'Đã xác nhận đơn hàng thanh toán thành công',text:'Ví dụ demo: Kế toán đã xác nhận giao dịch khớp với bill.',at:demoNoticeAt,readBy:[]});
  addOnce(demoState.notifications,{id:'DEMO-NOTICE-24H',kind:'DATA_UNRECEIVED_24H',role:'OWN',saleId:'demo-sale',leaderId:'demo-leader',title:'Data Sale không nhận trong 24 giờ',text:'Ví dụ demo: data quá hạn nhận, chờ Leader phân lại.',at:demoNoticeAt,readBy:[]});
  addOnce(demoState.attendance, { id: 'DEMO-ATT-1', accountId: 'demo-sale', date: '2026-09-17', checkInAt: '2026-09-17 08:02', status: 'PRESENT', ip: '127.0.0.1' });
  addOnce(demoState.attendance, { id: 'DEMO-ATT-2', accountId: 'demo-leader', date: '2026-09-17', checkInAt: '2026-09-17 08:05', status: 'PRESENT', ip: '127.0.0.1' });
  addOnce(demoState.tasks, { id: 'DEMO-TASK-1', customerId: 'DEMO-CUS-4', saleId: 'demo-sale-3', leaderId: 'demo-leader', teamId: 'DEMO', title: 'Goi lai khach Whale', status: 'OPEN', dueAt: '2026-09-18 09:00', createdAt: '2026-09-17 08:30' });
  addOnce(demoState.tasks, { id: 'DEMO-TASK-2', customerId: 'DEMO-CUS-5', saleId: 'demo-sale-2', leaderId: 'demo-leader-2', teamId: 'DEMO-2', title: 'Gui thong tin khoa hoc', status: 'DONE', dueAt: '2026-09-16 15:00', createdAt: '2026-09-15 10:30' });
  demoState.leaderDistribution = { ...demoState.leaderDistribution, enabled: true, enabledLeaderIds: ['demo-leader', 'demo-leader-2'], weights: { 'demo-leader': 1, 'demo-leader-2': 1 }, sourceRules: [] };
  demoState.saleDistributionByLeader = {
    ...demoState.saleDistributionByLeader,
    'demo-leader': { leaderEnabled: true, enabledSaleIds: ['demo-leader', 'demo-sale', 'demo-sale-3'], weights: { 'demo-leader': 1, 'demo-sale': 1, 'demo-sale-3': 1 } },
    'demo-leader-2': { leaderEnabled: true, enabledSaleIds: ['demo-leader-2', 'demo-sale-2'], weights: { 'demo-leader-2': 1, 'demo-sale-2': 1 } },
    'manager:demo-manager': { leaderEnabled: true, enabledSaleIds: ['demo-sale-manager'], weights: { 'demo-sale-manager': 1 }, managerDistributionInitialized: true }
  };
}
seedDemoWorkspace();
function demoData(state=demoState){return Object.fromEntries([...crmData.LISTS,...crmData.OBJECTS].map(key=>[key,new Map(crmData.LISTS.includes(key)?(state[key]||[]).map(r=>[r.id,r]):state[key]===undefined?[]:[['$',state[key]]])]));}
function demoToken(request) {
  return String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}
function demoUserFromToken(request) {
  return demoState.members.find(user => user.id === demoSessions.get(demoToken(request))&&user.active!==false) || null;
}
function demoRecordActivity(user,request,action,detail){
 demoActivityLogs.unshift({id:`DEMO-ACT-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,user_id:user.id,name:user.name,role:user.role,action,detail,ip:clientIp(request)||'127.0.0.1',at:stamp()});
 if(demoActivityLogs.length>300)demoActivityLogs.length=300;
}
function demoTouchSession(request,activity=''){
 const token=demoToken(request),current=demoSessionActivity.get(token)||{};
 demoSessionActivity.set(token,{...current,lastSeen:stamp(),activity:activity||current.activity||'Đang sử dụng CRM',ip:clientIp(request)||current.ip||'127.0.0.1'});
}
function demoAdminUserActivity(){
 const sessions=[...demoSessions.entries()].map(([token,userId])=>({userId,...(demoSessionActivity.get(token)||{})})).sort((a,b)=>String(b.lastSeen||'').localeCompare(String(a.lastSeen||'')));
 const latest=new Map();for(const session of sessions)if(!latest.has(session.userId))latest.set(session.userId,session);
 const events=demoActivityLogs.slice(0,300),latestEvent=new Map();for(const event of events)if(!latestEvent.has(event.user_id))latestEvent.set(event.user_id,event);
 return {generatedAt:stamp(),users:demoState.members.filter(user=>user.active!==false).map(user=>{const session=latest.get(user.id),event=latestEvent.get(user.id);return {id:user.id,name:user.name,role:user.role,accountId:user.accountId||'',online:Boolean(session),lastSeen:session?.lastSeen||null,activity:session?.activity||'Đã ngoại tuyến',ip:session?.ip||event?.ip||'',lastEvent:event||null};}),events};
}
function expireDemoOffers() {
  // Demo cung tuan theo han nhan 24 gio nhu MySQL, khong dem offer cu vao badge.
  const now=Date.now(),at=new Date(now).toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,16);
  for(const offer of demoState.dataOffers){
    if(offer.status!=='PENDING'||Date.parse(String(offer.offeredAt).replace(' ','T')+'+07:00')+24*3600000>now)continue;
    offer.status='EXPIRED';offer.resolvedAt=at;
    const notice=crmData.expiredOfferNotice(offer,demoData(),at);
    if(!demoState.notifications.some(item=>item.id===notice.id))demoState.notifications.unshift(notice);
    const customer=demoState.customers.find(c=>c.id===offer.customerId);
    if(customer&&!customer.saleId&&!demoState.dataOffers.some(o=>o.customerId===customer.id&&o.status==='PENDING')){
      customer.saleAcceptedAt=null;customer.updatedAt=at;
      customer.note='Sale khong nhan data sau 24h. Cho Leader phan lai.';
    }
  }
}
function demoPayload(user) {
  expireDemoOffers();
  return {...crmData.snapshot(user,demoData(),{compact:true}),user,storage:{mode:'demo',durable:false}};
}
const demoWebhookEvents = new Map();
let demoIntakeChain = Promise.resolve();
function persistDemoWebhook(record, { acceptBlacklistId = null, actor = null } = {}) {
  const task = demoIntakeChain.then(async () => {
    const next = structuredClone(demoState);
    let entry = null;
    if (acceptBlacklistId) {
      blacklist.requireAdmin(actor);
      entry = next.blacklistEntries.find(row => row.id === acceptBlacklistId);
      if (!entry) throw Object.assign(new Error('Data Blacklist không còn tồn tại.'), { status: 404 });
      if (entry.status === 'ACCEPTED') return { eventId: entry.record.id, customerId: entry.customerId, duplicate: entry.duplicate, replay: true, source: entry.source };
      record = entry.record;
      if (record.status !== 'NEW') throw Object.assign(new Error('Data thiếu hoặc sai thông tin. Chưa thể chấp nhận vào CRM.'), { status: 400 });
    }
    if (!entry && demoWebhookEvents.has(record.dedupeKey)) return { ...demoWebhookEvents.get(record.dedupeKey), replay: true, duplicate: true };
    const website = next.websites.find(row => String(row.webhookSlug || '').toUpperCase() === record.slug);
    const source = website ? { websiteId: website.id, landingPageName: website.name, landingPageUrl: website.sourceUrl || '', landingPageDomain: website.domain || '', campaign: website.campaignId || 'UNATTRIBUTED' } : null;
    const rule = !entry && blacklist.ruleFor(next.blacklistIps, record.customer?.ipAddress);
    let result = { eventId: record.id, customerId: null, source, replay: false, duplicate: false };
    if (rule) {
      next.blacklistEntries.unshift(blacklist.makeEntry(record, rule, source));
      result.blacklisted = true;
    } else if (record.status === 'NEW') {
      const normalizePhone = value => String(value || '').replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0');
      const existing = next.customers.find(row => normalizePhone(row.phone) === normalizePhone(record.customer.phone) || (record.customer.email && String(row.email || '').toLowerCase() === record.customer.email.toLowerCase()));
      if (existing) {
        result = { ...result, customerId: existing.id, duplicate: true, ownerSaleId: existing.saleId || null };
        next.resubmissions.unshift({ id: 'RESUB-' + record.id, customerId: existing.id, at: record.receivedAt, intakeType: 'API', duplicate: true, source: 'Landing page webhook', previousSaleId: existing.saleId || null });
        if (existing.saleId) next.notifications.unshift({ id: 'NT-DUP-' + record.id, role: 'OWN', saleId: existing.saleId, title: 'DATA TRÙNG - giữ Sale phụ trách', text: existing.name, at: new Date().toISOString(), readBy: [] });
      } else {
        const customer = { ...record.customer, id: 'CUS-' + record.id, ...(source || {}), source: 'Landing Page', webhookSlug: record.slug, webhookEventId: record.id,
          status: 'NEW', saleId: null, leaderId: null, teamId: null, createdAt: record.receivedAt, updatedAt: record.receivedAt, customFields: { customerLevel: 'L0' } };
        next.customers.unshift(customer);
        next.notifications.unshift(crmData.dataArrivalNotice(customer));
        result.customerId = customer.id;
        // Reuse production distribution rules with an in-memory document writer.
        const memoryConnection = { async execute(sql, values = []) {
          if (sql.startsWith('INSERT INTO crm_documents')) {
            const [key, id, body] = values, value = JSON.parse(body);
            if (crmData.LISTS.includes(key)) next[key] = [...(next[key] || []).filter(row => row.id !== id), value];
            else if (crmData.OBJECTS.includes(key)) next[key] = value;
          }
          return [[]];
        } };
        await crmData.distributeAutomatic(memoryConnection, demoData(next), { customerIds: [customer.id] });
      }
      if (entry) Object.assign(entry, blacklist.acceptedEntry(entry, actor, result));
    }
    Object.assign(demoState, next);
    demoStateVersion++;
    demoWebhookEvents.set(record.dedupeKey, result);
    return result;
  });
  demoIntakeChain = task.catch(() => {});
  return task;
}
async function handleBlacklistApi(request, response, pathname, user) {
  try {
    blacklist.requireAdmin(user);
    const ipMatch = pathname.match(/^\/api\/admin\/blacklist\/ips\/([^/]+)$/);
    const acceptMatch = pathname.match(/^\/api\/admin\/blacklist\/entries\/([^/]+)\/accept$/);
    if (pathname === '/api/admin/blacklist/ips' && request.method === 'POST') {
      const input = await readDbBody(request);
      let rule;
      if (DEMO_MODE) {
        const previous = blacklist.ruleFor(demoState.blacklistIps, input.ip);
        rule = blacklist.makeRule(user, input, previous);
        demoState.blacklistIps = [...demoState.blacklistIps.filter(row => row.id !== rule.id), rule];
        demoStateVersion++;
      } else rule = await blacklist.saveIp(user, input);
      notifyInboxListeners({ kind: 'blacklist' });
      return dbJson(request, response, 200, { ok: true, rule });
    }
    if (ipMatch && request.method === 'DELETE') {
      const id = decodeURIComponent(ipMatch[1]);
      if (DEMO_MODE) {
        if (!demoState.blacklistIps.some(row => row.id === id)) return dbJson(request, response, 404, { error: 'IP không còn trong Blacklist.' });
        demoState.blacklistIps = demoState.blacklistIps.filter(row => row.id !== id);
        demoStateVersion++;
      } else await blacklist.removeIp(user, id);
      notifyInboxListeners({ kind: 'blacklist' });
      return dbJson(request, response, 200, { ok: true });
    }
    if (acceptMatch && request.method === 'POST') {
      const id = decodeURIComponent(acceptMatch[1]);
      const entry = DEMO_MODE ? null : await blacklist.readEntry(user, id);
      const result = await (DEMO_MODE ? persistDemoWebhook(null, { acceptBlacklistId: id, actor: user }) : persistWebhook(entry.record, { acceptBlacklistId: id, actor: user }));
      if (!DEMO_MODE) { crmData.invalidateSnapshotCache(); wakeTelegramOutbox(); }
      notifyInboxListeners({ kind: 'blacklist-accepted' });
      return dbJson(request, response, 200, { ok: true, ...result });
    }
    return dbJson(request, response, 404, { error: 'Chức năng Blacklist không hợp lệ.' });
  } catch (error) { return dbJson(request, response, error.status || 503, { error: error.status ? error.message : 'Chưa lưu được Blacklist. Vui lòng thử lại.' }); }
}

async function handleGoogleSheetsBackupApi(request, response, user) {
  if (request.method !== 'POST') return dbJson(request, response, 405, { error: 'Chỉ chấp nhận POST' });
  if (user?.role !== 'ADMIN') return dbJson(request, response, 403, { error: 'Chỉ Admin được sao lưu đơn hàng' });
  if (!process.env.GOOGLE_SHEETS_BACKUP_URL) {
    return dbJson(request, response, 200, {
      ok: false,
      enabled: false,
      queued: 0,
      error: 'Chưa cấu hình Google Apps Script Web App trên máy chủ.'
    });
  }
  try {
    const source = DEMO_MODE
      ? { orders: demoState.orders || [], customers: demoState.customers || [] }
      : (await crmData.read(user, { passive: true, full: true })).state;
    const result = await googleSheetsBackup.backupOrders(source.orders || [], source.customers || [], user, 'BACKUP');
    return dbJson(request, response, 200, { ok: true, ...result });
  } catch (error) {
    console.error('[google-sheets-backup]', error.code || error.message);
    return dbJson(request, response, 503, {
      ok: false,
      enabled: true,
      queued: 0,
      error: 'Không sao lưu được đơn hàng lúc này. Vui lòng thử lại.'
    });
  }
}

function demoPnlVisible(user, customer) {
  const role = String(user?.role || '').toUpperCase();
  if (role === 'ADMIN') return true;
  if (role === 'SALE') return customer.createdBy === user.id;
  const creator = demoState.members.find(member => member.id === customer.createdBy);
  if (!creator) return false;
  if (role === 'LEADER') return customer.createdBy === user.id || (creator.role === 'SALE' && (creator.leaderId === user.id || creator.teamId === user.teamId));
  if (role === 'MANAGER') return customer.createdBy === user.id || creator.managerId === user.id || creator.leaderId === user.id;
  return false;
}
function demoPnlList(user, search = '') {
  const query = String(search || '').trim().toLowerCase();
  const start = pnlManagement.weekStart(), end = pnlManagement.weekEnd(start), date = pnlManagement.today();
  const visible = (demoState.pnlCustomers || []).filter(row => row.status !== 'inactive' && demoPnlVisible(user, row)).filter(row => !query || `${row.customerCode} ${row.customerName} ${row.cqgAccount}`.toLowerCase().includes(query));
  const logs = demoState.pnlDailyLogs || [], weekly = demoState.pnlWeeklySummaries || [];
  return { customers: visible.map(row => { const own = logs.filter(log => String(log.customerId) === String(row.id)); const todayLog = own.find(log => log.tradeDate === date); const weekLogs = own.filter(log => log.tradeDate >= start && log.tradeDate <= end); return { ...row, todayPnl: Number(todayLog?.pnlAmount || 0), weekPnl: weekLogs.reduce((sum, log) => sum + Number(log.pnlAmount || 0), 0), weekLots: weekLogs.reduce((sum, log) => sum + Number(log.lotVolume || 0), 0), creatorName: demoState.members.find(m => m.id === row.createdBy)?.name || '' }; }), logs: logs.filter(log => visible.some(row => String(row.id) === String(log.customerId))), weekly: weekly.filter(log => visible.some(row => String(row.id) === String(log.customerId))), weekStart: start, weekEnd: end, date };
}
async function handlePnlApi(request, response, pathname, user) {
  const role = String(user?.role || '').toUpperCase();
  if (!['ADMIN', 'MANAGER', 'LEADER', 'SALE'].includes(role)) return dbJson(request, response, 403, { error: 'Tài khoản không có quyền quản lý lãi lỗ.' });
  if (DEMO_MODE) {
    if (pathname === '/api/pnl' && request.method === 'GET') return dbJson(request, response, 200, demoPnlList(user, new URL(request.url, 'http://localhost').searchParams.get('search')));
    if (pathname === '/api/pnl/customers' && request.method === 'POST') {
      const body = await readDbBody(request), code = String(body.customerCode || '').trim(), cqg = String(body.cqgAccount || '').trim();
      if (!code || !cqg || !String(body.customerName || '').trim()) return dbJson(request, response, 400, { error: 'Vui lòng nhập đủ ID, tên và tài khoản CQG.' });
      if (role === 'SALE' && body.assignedTo && body.assignedTo !== user.id) return dbJson(request, response, 403, { error: 'Sale chỉ được tạo khách cho chính mình.' });
      if ((demoState.pnlCustomers || []).some(row => row.customerCode === code || row.cqgAccount === cqg)) return dbJson(request, response, 409, { error: 'ID khách hàng hoặc tài khoản CQG đã tồn tại.' });
      const id = `PNL-${crypto.randomUUID()}`; const capital = Number(body.initialCapital || 0);
      demoState.pnlCustomers.push({ id, customerCode: code, customerName: String(body.customerName).trim(), cqgAccount: cqg, initialCapital: capital, currentCapital: capital, defaultLot: Number(body.defaultLot || 0), assignedTo: body.assignedTo || user.id, createdBy: user.id, status: 'active', createdAt: new Date().toISOString() }); demoStateVersion++;
      return dbJson(request, response, 201, { ok: true, customer: demoState.pnlCustomers.at(-1) });
    }
    const logMatch = pathname.match(/^\/api\/pnl\/customers\/([^/]+)\/logs$/);
    if (logMatch && request.method === 'POST') {
      const body = await readDbBody(request), customer = demoState.pnlCustomers.find(row => row.id === decodeURIComponent(logMatch[1]));
      if (!customer || !demoPnlVisible(user, customer)) return dbJson(request, response, 403, { error: 'Bạn không có quyền với khách hàng PnL này.' });
      const tradeDate = String(body.tradeDate || pnlManagement.today()), existing = demoState.pnlDailyLogs.find(row => row.customerId === customer.id && row.tradeDate === tradeDate), log = { id: existing?.id || `PNLLOG-${crypto.randomUUID()}`, customerId: customer.id, tradeDate, lotVolume: Number(body.lotVolume || 0), pnlAmount: Number(body.pnlAmount || 0), source: body.source === 'telegram' ? 'telegram' : 'web', notes: String(body.notes || '').slice(0, 2000), recordedBy: user.id };
      if (existing) Object.assign(existing, log); else demoState.pnlDailyLogs.push(log); customer.currentCapital = Number(customer.initialCapital) + demoState.pnlDailyLogs.filter(row => row.customerId === customer.id).reduce((sum, row) => sum + Number(row.pnlAmount || 0), 0); demoStateVersion++;
      return dbJson(request, response, 200, { ok: true, log, customer, riskAlert: log.pnlAmount < 0 && Math.abs(log.pnlAmount) >= Math.max(1, Number(customer.initialCapital) * .2) });
    }
    if (pathname === '/api/pnl/weekly/close' && request.method === 'POST') { if (role !== 'ADMIN') return dbJson(request, response, 403, { error: 'Chỉ Admin được chốt tổng kết tuần.' }); return dbJson(request, response, 200, { ok: true, weekStart: pnlManagement.weekStart(), weekEnd: pnlManagement.weekEnd(pnlManagement.weekStart()), count: demoState.pnlCustomers.length }); }
    return dbJson(request, response, 404, { error: 'PnL API không tồn tại.' });
  }
  try {
    if (pathname === '/api/pnl' && request.method === 'GET') return dbJson(request, response, 200, await pnlManagement.list(user, Object.fromEntries(new URL(request.url, 'http://localhost').searchParams.entries())));
    if (pathname === '/api/pnl/customers' && request.method === 'POST') return dbJson(request, response, 201, { ok: true, customer: await pnlManagement.createCustomer(user, await readDbBody(request)) });
    const logMatch = pathname.match(/^\/api\/pnl\/customers\/([^/]+)\/logs$/);
    if (logMatch && request.method === 'POST') { const result = await pnlManagement.upsertLog(user, { ...(await readDbBody(request)), customerId: decodeURIComponent(logMatch[1]) }); return dbJson(request, response, 200, { ok: true, ...result }); }
    if (pathname === '/api/pnl/weekly/close' && request.method === 'POST') return dbJson(request, response, 200, { ok: true, ...(await pnlManagement.closeWeek(user, (await readDbBody(request)).weekStart || pnlManagement.weekStart())) });
    return dbJson(request, response, 404, { error: 'PnL API không tồn tại.' });
  } catch (error) {
    console.error('[pnl-api]', pathname, error.code || 'PNL_ERROR', error.message);
    return dbJson(request, response, error.status || 500, { error: error.status ? error.message : 'Không xử lý được dữ liệu lãi lỗ.', code: error.code || 'PNL_ERROR' });
  }
}
async function handleDemoApi(request, response, pathname) {
  if (pathname === '/api/db/health') return dbJson(request, response, 200, { configured: false, demo: true });
  if (pathname === '/api/auth/register' && request.method === 'POST') {
    const body=await readDbBody(request),phone=String(body.phone||'').replace(/\D/g,''),email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),accountId=String(body.accountId||'').trim().toUpperCase(),password=String(body.password||'');
    if(!name||!/^\d{9,15}$/.test(phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(accountId)||password.length<8)return dbJson(request,response,400,{error:'Thông tin đăng ký không hợp lệ'});
    if(demoState.members.some(user=>user.phone===phone||user.email===email||user.accountId===accountId))return dbJson(request,response,400,{error:'ID tài khoản, số điện thoại hoặc email đã tồn tại'});
    const id=`u-reg-${crypto.randomUUID()}`,user={id,accountId,phone,email,name,role:'UNASSIGNED',teamId:'',leaderId:null,active:true,initials:name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase(),loginEnabled:true};
    demoState.members.push(user);demoState.registeredAccounts.push(user);demoPasswords[email]=password;
    return dbJson(request,response,201,{success:true,message:'Đăng ký thành công',id});
  }
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readDbBody(request);
    const identifier = String(body.identifier || body.username || body.email || '').trim().toLowerCase();
    const user = demoState.members.find(item => item.active!==false && [item.phone,item.email,item.accountId].some(value => String(value || '').trim().toLowerCase() === identifier)) || (identifier === 'marketing@nvtagency.top' ? demoState.members.find(item => item.role === 'MARKETING') : null);
    const password = String(body.password || '');
    const validPassword = user && (demoPasswords[user.email] === password || (user.role === 'MARKETING' && (password === 'Marketing2026@' || password === 'MarketingDemo2026!')));
    if (!user || !validPassword) {
      return dbJson(request, response, 401, { error: 'Thông tin đăng nhập demo không đúng' });
    }
    if(user.role==='UNASSIGNED')return dbJson(request,response,403,{error:'Tài khoản đã đăng ký, đang chờ Admin phân chức vụ.'});
    const token = `demo-${crypto.randomBytes(12).toString('hex')}`;
    demoSessions.set(token, user.id);
    demoTouchSession({...request,headers:{...request.headers,authorization:`Bearer ${token}`}},'Đang vào CRM');
    demoRecordActivity(user,request,'LOGIN','Đăng nhập CRM');
    return dbJson(request, response, 200, { token, user });
  }
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const user = demoUserFromToken(request);
    if(user)demoTouchSession(request);
    return user ? dbJson(request, response, 200, { user }) : dbJson(request, response, 401, { error: 'Phiên demo hết hạn' });
  }
  if (pathname === '/api/auth/logout') {
    const user=demoUserFromToken(request);if(user)demoRecordActivity(user,request,'LOGOUT','Đăng xuất CRM');
    demoSessions.delete(demoToken(request));
    demoSessionActivity.delete(demoToken(request));
    return dbJson(request, response, 200, { ok: true });
  }
  const user = demoUserFromToken(request);
  if (!user) return dbJson(request, response, 401, { error: 'Đăng nhập demo trước' });
  demoTouchSession(request);
  if (pathname === '/api/pnl' || pathname.startsWith('/api/pnl/')) return handlePnlApi(request, response, pathname, user);
  if (pathname === '/api/google-sheets/backup') return handleGoogleSheetsBackupApi(request, response, user);
  if (pathname.startsWith('/api/admin/blacklist')) return handleBlacklistApi(request, response, pathname, user);
  const processMatch=pathname.match(/^\/api\/process-image\/([^/]+)$/), feedbackMatch=pathname.match(/^\/api\/feedback-image\/([^/]+)$/), receiptMatch=pathname.match(/^\/api\/order-receipt-image\/([^/]+)\/([^/]+)$/), statementMatch=pathname.match(/^\/api\/bank-statement-file\/([^/]+)$/);
  if(request.method==='GET'&&(processMatch||feedbackMatch||receiptMatch||statementMatch)){
    try{
      const type=processMatch?'process':feedbackMatch?'feedback':statementMatch?'bank-statement':'order',id=decodeURIComponent((processMatch||feedbackMatch||statementMatch||receiptMatch)[1]),childId=receiptMatch?decodeURIComponent(receiptMatch[2]):null;
      return dbJson(request,response,200,crmData.assetFromData(user,demoData(),type,id,childId));
    }catch(error){return dbJson(request,response,error.status||404,{error:error.message});}
  }
  if(pathname==='/api/audit'&&request.method==='GET'){
    const query=new URL(request.url,`http://${request.headers.host||'localhost'}`).searchParams;
    const source=demoData(),filters={orderId:query.get('orderId'),search:query.get('search'),actorId:query.get('actorId'),action:query.get('action'),ordersOnly:query.get('ordersOnly')==='1'};
    const all=demoState.audit.filter(row=>crmData.readable(user,'audit',row,source)&&(!filters.ordersOnly&&!filters.orderId||orderAudit.isOrder(row,source)));
    return dbJson(request,response,200,orderAudit.page(all,query.get('page'),query.get('limit'),filters));
  }
  if(pathname==='/api/user-activity'&&request.method==='POST'){const body=await readDbBody(request),detail=activityLabel(body.view),token=demoToken(request),old=demoSessionActivity.get(token)?.activity;demoTouchSession(request,detail);if(old!==detail)demoRecordActivity(user,request,'OPEN_SCREEN',detail);return dbJson(request,response,200,{ok:true,activity:detail});}
  if(pathname==='/api/admin/user-activity'&&request.method==='GET'){if(user.role!=='ADMIN')return dbJson(request,response,403,{error:'Chỉ Admin được xem User log'});return dbJson(request,response,200,demoAdminUserActivity());}
  if(pathname==='/api/customers/manual'&&request.method==='POST'){
    try{
      const body=await readDbBody(request),customer=manualCustomerRecord(user,{accounts:demoState.members,customers:demoState.customers,websites:demoState.websites},{...body,request});
      if(!demoState.customers.some(item=>item.id===customer.id)){demoState.customers.unshift(customer);demoState.notifications.unshift(crmData.dataArrivalNotice(customer));}
      return dbJson(request,response,200,{...demoPayload(user),ok:true,customerId:customer.id});
    }catch(error){return dbJson(request,response,error.status||400,{error:error.message});}
  }
  if (pathname === '/api/state/version' && request.method === 'GET') return dbJson(request, response, 200, { version: String(demoStateVersion) });
  if (pathname === '/api/state' && request.method === 'GET') return dbJson(request, response, 200, demoPayload(user));
  if (pathname === '/api/state' && request.method === 'POST') {
    const body = await readDbBody(request);
    try{
      expireDemoOffers();
      const next=structuredClone(demoState),original=demoData(),changes=body.changes||[];
      for(const change of changes.slice().sort((a,b)=>(a.key==='customers'?0:1)-(b.key==='customers'?0:1))){
        const {key,id}=change;let {value}=change;if(!original[key])throw Object.assign(Error('Collection không hợp lệ'),{status:400});
        const old=original[key].get(id);
        if(key==='orders'&&old&&value)value=crmData.mergeOrderAssets(old,value);
        if(key==='audit'&&!old&&value)value={...value,requestId:body.requestId};
        // Giống MySQL: khách sửa theo danh sách trường thì gộp vào bản mới nhất.
        if(key==='customers'&&old&&value&&Array.isArray(change.fields)&&change.fields.length<=200)value=crmData.mergeCustomerFields(old,value,change.fields);
        // Sale nhan ban ghi da che thong tin: giu thong tin goc nhu luong MySQL.
        const pending=key==='customers'&&user.role==='SALE'&&old&&demoState.dataOffers.some(o=>o.customerId===id&&o.saleId===user.id&&o.status==='PENDING');
        if(pending&&value)value={...old,saleId:user.id,saleAcceptedAt:value.saleAcceptedAt,updatedAt:value.updatedAt,status:value.status||old.status,note:value.note!==undefined?value.note:old.note};
        crmData.validate(key,value,id);crmData.authorize(user,key,old,value,demoData(next));
        if(key==='websites'&&value){
          if(value.designatedSalesEnabled&&value.designatedSaleIds.some(id=>!next.members.some(member=>member.id===id&&['SALE','LEADER','MANAGER'].includes(member.role)&&member.active!==false)))throw Error('Người nhận chỉ định không tồn tại hoặc đã ngừng hoạt động');
          value={...value,designatedSalesCursor:old?.designatedSalesCursor||{}};
        }
        if(crmData.OBJECTS.includes(key)){next[key]=(user.role==='MANAGER'&&['settings','saleDistributionByLeader'].includes(key)||user.role==='ACCOUNTING'&&key==='settings')?{...next[key],...value}:value;}
        else{next[key]=(next[key]||[]).filter(r=>r.id!==id);if(value)next[key].push(value);}
      }
      for(const change of changes.filter(item=>item.key==='customers'&&item.value&&item.value.createdVia!=='ORDER'&&!original.customers.has(item.id))){
        const notice=crmData.dataArrivalNotice(change.value);if(!next.notifications.some(item=>item.id===notice.id))next.notifications.unshift(notice);
      }
      for(const change of changes.filter(item=>item.key==='orders')){
        const saved=next.orders.find(row=>row.id===change.id)||null;
        const events=orderAudit.events(user,original.orders.get(change.id)||null,saved,body.requestId);if(events.length){const eventIds=new Set(events.map(event=>event.id));next.audit=next.audit.filter(event=>!eventIds.has(event.id));next.audit.unshift(...events);}
        for(const notice of crmData.orderNotices(original.orders.get(change.id),change.value)){
          if(!next.notifications.some(item=>item.id===notice.id))next.notifications.unshift(notice);
        }
      }
      Object.assign(demoState,next);
    }catch(e){return dbJson(request,response,e.status||400,{error:e.message});}
    demoStateVersion++;
    return dbJson(request, response, 200, { ...demoPayload(user), ok: true });
  }
  return dbJson(request, response, 404, { error: 'Demo API không hỗ trợ endpoint này' });
}

async function handleDbApi(request, response, pathname) {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': request.headers.origin || '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' }); return response.end(); }
  if (DEMO_MODE) return handleDemoApi(request,response,pathname);
  if (!dbConfigured) return dbJson(request,response,503,{error:'MySQL chưa được cấu hình. Không thể lưu dữ liệu.'});
  const loginTiming = pathname === '/api/auth/login' ? {started:Date.now(),last:Date.now(),phases:{}} : null;
  // Share one deadline across body, lookup, password verification and session write.
  const loginStep = async action => {
    const remaining = 12000 - (Date.now() - loginTiming.started);
    const timeout = () => Object.assign(new Error('Login deadline exceeded'), {code:'DB_LOGIN_TIMEOUT',status:503});
    if (remaining <= 0) throw timeout();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), remaining); })
      ]);
    } finally { clearTimeout(timer); }
  };
  const markLogin = phase => { if(loginTiming){const now=Date.now();loginTiming.phases[phase]=now-loginTiming.last;loginTiming.last=now;} };
  try {
    const isAuthRequest = pathname === '/api/auth/login' || pathname === '/api/auth/register';
    const isStateRead = pathname === '/api/state' && request.method === 'GET';
    // Dang nhap khong duoc cho seed/migration CRM chay ngam. Users va crm_sessions
    // la cac bang nen; truy van truc tiep de tra loi nhanh, loi thieu bang se tra ve ro rang.
    // Snapshot chi can schema CRM, khong can cho provision tai khoan he thong xong.
    if (!isAuthRequest && !isStateRead && pathname !== '/api/db/health' && !await systemAccountsReady) {
      return dbJson(request,response,503,{error:'Khoi tao tai khoan he thong chua hoan tat. Kiem tra log Node.'});
    }
    if (isStateRead) {
      const schemaReady = await systemSchemaReady;
      if (!schemaReady) return dbJson(request,response,503,{error:'Schema MySQL chua san sang. Kiem tra log Node.'});
    }
    markLogin('startup');
    if (pathname === '/api/db/health') return dbJson(request,response,200,await dbHealth());
    if (pathname === '/api/auth/register' && request.method === 'POST') {
      const body = await readDbBody(request);
      const phone = String(body.phone || '').replace(/\D/g,''), email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim(), accountId = String(body.accountId || '').trim().toUpperCase(), password = String(body.password || '');
      if (!/^\d{9,15}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>160 || !/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(accountId) || password.length<8 || Buffer.byteLength(password)>72) return dbJson(request,response,400,{error:'Họ tên, ID tài khoản, SĐT, email hoặc mật khẩu không hợp lệ.'});
      const id = `u-reg-${crypto.randomUUID()}`;
      try { await dbQuery("INSERT INTO users(id,account_code,phone,email,password_hash,name,role,active) VALUES (?,?,?,?,?,?,'UNASSIGNED',1)",[id,accountId||null,phone,email,await hashPassword(password),name]); }
      catch(e) { if(e.code==='ER_DUP_ENTRY')return dbJson(request,response,400,{error:'ID tài khoản, số điện thoại hoặc email đã tồn tại'});throw e; }
      notifyInboxListeners({id,kind:'users',receivedAt:stamp()});
      return dbJson(request,response,201,{success:true,message:'Đăng ký thành công',id});
    }
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await loginStep(() => readDbBody(request)), identifier=String(body.identifier||'').trim().toLowerCase();
      const phone=/^\d{9,15}$/.test(identifier);
      const rows=await loginStep(() => authQuery(`SELECT id,account_code,phone,email,password_hash,name,role,team_id,leader_id,telegram_chat_id,telegram_username,active,created_at FROM users WHERE active=1 AND ${phone?'phone=?':'email=?'} LIMIT 1`,[identifier]));
      markLogin('lookup');
      const row=rows[0], password=String(body.password||'');
      const matched=!!row && await loginStep(() => passwordMatches(password,row.password_hash));
      markLogin('password');
      if(!matched)return dbJson(request,response,401,{error:'Thông tin đăng nhập không đúng'});
      if(row.role==='UNASSIGNED')return dbJson(request,response,403,{error:'Tài khoản đã đăng ký, đang chờ Admin phân chức vụ.'});
      if(!/^\$2[aby]\$/.test(row.password_hash)) {
        void hashPassword(password).then(hash => authQuery('UPDATE users SET password_hash=? WHERE id=?',[hash,row.id])).catch(error => console.warn('[password-upgrade]',error.code||error.message));
      } else if (needsPasswordRehash(row.password_hash)) {
        void hashPassword(password).then(hash => authQuery('UPDATE users SET password_hash=? WHERE id=?',[hash,row.id])).catch(error => console.warn('[password-rehash]',error.code||error.message));
      }
      const token=crypto.randomBytes(32).toString('hex');
      const tokenHashValue=crypto.createHash('sha256').update(token).digest('hex');
      await loginStep(() => authQuery('INSERT INTO crm_sessions(token_hash,user_id,ip,user_agent,expires_at,last_seen_at,last_activity) VALUES (?,?,?,?,DATE_ADD(NOW(),INTERVAL 1 DAY),NOW(),?)',[tokenHashValue,row.id,clientIp(request)||null,clientUserAgent(request)||null,'Đang vào CRM']));
      cacheSessionUser(tokenHashValue, crmData.userRow(row));
      markLogin('session');
      // Nhat ky dang nhap khong duoc chan phan hoi xac thuc; ghi nen de nguoi dung vao CRM ngay.
      void recordUserActivity(row,request,'LOGIN','Đăng nhập CRM').catch(error=>console.warn('[user-activity login]',error.message));
      markLogin('audit');
      return dbJson(request,response,200,{token,user:crmData.userRow(row)});
    }
    const user=await authUser(request);
    if(!user)return dbJson(request,response,401,{error:'Phiên đã hết hạn. Đăng nhập lại để tiếp tục.'});
    // Refreshing last_seen is telemetry. It must never turn a valid session
    // into a 500/timeout when MySQL is briefly busy or waking from idle.
    void touchUserSession(request).catch(error => console.warn('[session-touch]', error.code || error.message));
    if(pathname==='/api/pnl' || pathname.startsWith('/api/pnl/'))return handlePnlApi(request,response,pathname,user);
    if(pathname==='/api/google-sheets/backup')return handleGoogleSheetsBackupApi(request,response,user);
    if(pathname.startsWith('/api/support/'))return await handleSupportApi(request,response,pathname,user);
    if(pathname==='/api/auth/me')return dbJson(request,response,200,{user});
    if(pathname==='/api/auth/logout' && request.method==='POST'){void recordUserActivity(user,request,'LOGOUT','Đăng xuất CRM');const hash=tokenHash(request);sessionUserCache.delete(hash);await authQuery('DELETE FROM crm_sessions WHERE token_hash=?',[hash]);return dbJson(request,response,200,{ok:true});}
    if(pathname==='/api/user-activity' && request.method==='POST'){
      const body=await readDbBody(request),activity=await setUserActivity(request,body.view);
      if(activity.changed)await recordUserActivity(user,request,'OPEN_SCREEN',activity.detail);
      return dbJson(request,response,200,{ok:true,activity:activity.detail});
    }
    if(pathname==='/api/admin/user-activity' && request.method==='GET'){
      if(user.role!=='ADMIN')return dbJson(request,response,403,{error:'Chỉ Admin được xem User log'});
      return dbJson(request,response,200,await adminUserActivity());
    }
    if (pathname.startsWith('/api/admin/blacklist')) return handleBlacklistApi(request, response, pathname, user);
    if(pathname==='/api/customers/manual' && request.method==='POST'){
      const body=await readDbBody(request);
      return dbJson(request,response,200,await createManualCustomer(user,body,request));
    }
    if(pathname==='/api/telegram/link-status' && request.method==='GET'){
      const rows=await dbQuery('SELECT telegram_chat_id FROM users WHERE id=? LIMIT 1',[user.id]);
      return dbJson(request,response,200,{linked:Boolean(rows[0]?.telegram_chat_id)});
    }
    if(pathname==='/api/telegram/link-code' && request.method==='POST'){
      const rows=await dbQuery('SELECT telegram_chat_id FROM users WHERE id=? AND active=1 LIMIT 1',[user.id]);
      if(!rows.length)return dbJson(request,response,404,{error:'Tài khoản không còn hoạt động.'});
      if(rows[0].telegram_chat_id)return dbJson(request,response,409,{error:'Hãy hủy liên kết Telegram hiện tại trước khi đổi.'});
      const code=crypto.randomBytes(24).toString('base64url');
      const hash=crypto.createHash('sha256').update(code).digest('hex');
      await dbQuery('DELETE FROM telegram_link_tokens WHERE user_id=? OR expires_at<NOW() OR consumed_at IS NOT NULL',[user.id]);
      await dbQuery('INSERT INTO telegram_link_tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 5 MINUTE))',[hash,user.id]);
      const botName=(process.env.TELEGRAM_BOT_USERNAME||'HeThongCRMNVT_BOT').replace(/^@/,'');
      return dbJson(request,response,200,{code,expiresIn:300,url:'https://t.me/'+botName+'?start='+encodeURIComponent(code)});
    }
    if(pathname==='/api/telegram/unlink' && request.method==='POST'){
      await dbQuery('UPDATE users SET telegram_chat_id=NULL,telegram_username=NULL WHERE id=?',[user.id]);
      await dbQuery('DELETE FROM telegram_link_tokens WHERE user_id=?',[user.id]);
      return dbJson(request,response,200,{ok:true});
    }
    if(pathname==='/api/navigation-counts' && request.method==='GET'){
      if(user.role!=='ADMIN')return dbJson(request,response,403,{error:'Chỉ Admin được xem số data và tài khoản chờ'});
      // API đếm riêng giúp badge cập nhật ngay mà không ghi đè form Admin đang nhập.
      const [dataRows,accountRows]=await Promise.all([
        dbQuery('SELECT COUNT(*) AS total FROM customers WHERE sale_id IS NULL AND leader_id IS NULL AND team_id IS NULL'),
        dbQuery("SELECT COUNT(*) AS total FROM users WHERE role='UNASSIGNED' AND active=1")
      ]);
      return dbJson(request,response,200,{
        data:Number(dataRows[0]?.total||0),
        team:Number(accountRows[0]?.total||0)
      });
    }
    if(pathname==='/api/auth/password' && request.method==='POST'){
      const body=await readDbBody(request), id=body.userId||user.id, password=String(body.password||'');
      if(password.length<8||Buffer.byteLength(password)>72)return dbJson(request,response,400,{error:'Mật khẩu phải từ 8 ký tự và không quá 72 byte'});
      if(id!==user.id&&user.role!=='ADMIN')return dbJson(request,response,403,{error:'Không có quyền'});
      const rows=await dbQuery('SELECT password_hash FROM users WHERE id=?',[id]);
      if(!rows.length)return dbJson(request,response,404,{error:'Nhân sự chưa có tài khoản đăng nhập'});
      if(id===user.id&&!await passwordMatches(String(body.currentPassword||''),rows[0].password_hash))return dbJson(request,response,400,{error:'Mật khẩu hiện tại không đúng'});
      await dbQuery('UPDATE users SET password_hash=? WHERE id=?',[await hashPassword(password),id]);
      await dbQuery('DELETE FROM crm_sessions WHERE user_id=?',[id]);
      return dbJson(request,response,200,{ok:true});
    }
    // Máy khác vừa ghi gì chưa: chỉ đọc id lớn nhất của crm_changes để các vai trò đồng bộ sau vài giây
    // mà không phải tải lại toàn bộ snapshot (SSE tắt trên shared hosting).
    const processMatch=pathname.match(/^\/api\/process-image\/([^/]+)$/), feedbackMatch=pathname.match(/^\/api\/feedback-image\/([^/]+)$/), receiptMatch=pathname.match(/^\/api\/order-receipt-image\/([^/]+)\/([^/]+)$/), statementMatch=pathname.match(/^\/api\/bank-statement-file\/([^/]+)$/);
    if(request.method==='GET'&&(processMatch||feedbackMatch||receiptMatch||statementMatch)){
      try{const type=processMatch?'process':feedbackMatch?'feedback':statementMatch?'bank-statement':'order',id=decodeURIComponent((processMatch||feedbackMatch||statementMatch||receiptMatch)[1]),childId=receiptMatch?decodeURIComponent(receiptMatch[2]):null;return dbJson(request,response,200,await crmData.readAsset(user,type,id,childId));}
      catch(error){return dbJson(request,response,error.status||404,{error:error.message});}
    }
    if(pathname==='/api/audit'&&request.method==='GET'){
      const query=new URL(request.url,`http://${request.headers.host||'localhost'}`).searchParams;return dbJson(request,response,200,await crmData.readAuditPage(user,query.get('page'),query.get('limit'),{orderId:query.get('orderId'),search:query.get('search'),actorId:query.get('actorId'),action:query.get('action'),ordersOnly:query.get('ordersOnly')==='1'}));
    }
    if(pathname==='/api/state/version'&&request.method==='GET'){
      const rows=await dbQuery('SELECT MAX(id) AS version FROM crm_changes');
      return dbJson(request,response,200,{version:String(rows[0]?.version||0)});
    }
    if(pathname==='/api/state'){
      if(request.method==='GET'){
        const query=new URL(request.url,`http://${request.headers.host||'localhost'}`).searchParams;
        const result=await crmData.read(user,{passive:query.get('passive')==='1'});
        if(query.get('passive')!=='1')wakeTelegramOutbox();
        return dbJson(request,response,200,{...result,user});
      }
      if(request.method==='POST'){
        const body=await readDbBody(request);
        // Client gửi skipAutomatic cho mọi lần sửa chỉ gồm khách/ghi chú/audit (kể cả Sale).
        // Trước đây non-Admin bị 403 → client đánh dấu xung đột, ghi chú không bao giờ lưu
        // và mất khi F5. Non-Admin chỉ được bỏ qua chia tự động với gói nền như vậy;
        // gói khác vẫn chạy chia tự động thay vì bị từ chối.
        const backgroundOnly=Array.isArray(body.changes)&&body.changes.length>0&&body.changes.every(change=>['customers','notes','audit','customerFieldHistory'].includes(change?.key));
        const skipAutomatic=body.skipAutomatic===true&&(user.role==='ADMIN'||backgroundOnly);
        const result=await crmData.write(user,body.requestId,body.changes,{skipAutomatic,fastNote:body.fastNote===true});
        notifyInboxListeners({id:body.requestId,kind:'state',receivedAt:stamp()});

        wakeTelegramOutbox();
        return dbJson(request,response,200,result);
      }
    }
    // API cũ đọc cùng nguồn; ghi bắt buộc kèm phiên bản để không ghi đè âm thầm.
    const [resource,encodedId]=pathname.replace('/api/','').split('/');
    const id=encodedId?decodeURIComponent(encodedId):null;
    const key=resource==='users'?'members':resource;
    if(['customers','orders','products','users','settings'].includes(resource)){
      if(resource==='users'&&!['ADMIN','LEADER','MANAGER'].includes(user.role))return dbJson(request,response,403,{error:'Không có quyền xem users'});
      const snapshot=await crmData.read(user);
      if(request.method==='GET')return dbJson(request,response,200,{items:resource==='users'?snapshot.state.accounts:snapshot.state[key],versions:snapshot.versions});
      const body=await readDbBody(request), recordId=key==='settings'?'$':id||body.id;
      if(request.method!=='POST'&&!Object.hasOwn(body,'_revision'))return dbJson(request,response,428,{error:'Hãy tải lại bản CRM mới; cập nhật cần phiên bản bản ghi'});
      const {_revision,...fields}=body;
      const old=key==='settings'?snapshot.state.settings:[...(snapshot.state[key]||[]),...(key==='members'?snapshot.state.registeredAccounts:[])].find(r=>r.id===recordId);
      const value=request.method==='DELETE'?null:{...old,...fields,...(key==='settings'?{}:{id:recordId})};
      const result=await crmData.write(user,crypto.randomUUID(),[{key,id:recordId,base:_revision??null,value}]);
      wakeTelegramOutbox();
      return dbJson(request,response,request.method==='POST'?201:200,result);
    }
    return dbJson(request,response,404,{error:'API không tồn tại'});
   }catch(e){
    console.error('[mysql-api]',pathname,e.code||'ERROR',e.message);
    const unavailable=/^DB_/.test(e.code||'')||['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ECONNABORTED','ENOTFOUND','EAI_AGAIN','PROTOCOL_CONNECTION_LOST','ER_CON_COUNT_ERROR','ER_USER_LIMIT_REACHED','ER_LOCK_WAIT_TIMEOUT','ER_LOCK_DEADLOCK','PROTOCOL_SEQUENCE_TIMEOUT','PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'].includes(e.code);
    // Convert database failures, including login failures, into a fast JSON 503.
    if(unavailable)return dbJson(request,response,503,{code:e.code,error:'Máy chủ đang bận, vui lòng thử lại sau vài giây'});
const duplicate=e.code==='ER_DUP_ENTRY';return dbJson(request,response,e.status||(duplicate||e instanceof SyntaxError?400:500),{error:e.status?e.message:duplicate?'ID tài khoản, số điện thoại hoặc email đã tồn tại':e instanceof SyntaxError?'JSON không hợp lệ':'Không lưu được MySQL. Giữ trang mở và thử lại.'});} finally {
    if(loginTiming){const total=Date.now()-loginTiming.started;if(total>=1000)console.warn('[login-timing]',JSON.stringify({totalMs:total,...loginTiming.phases}));}
  }
}

/**
 * Token tùy chọn. LadiPage cho phép khai báo "API Request Header" là một object
 * JSON tùy ý, ví dụ {"token": "abc"}. Nếu đặt WEBHOOK_TOKEN thì server từ chối
 * request không mang token này ở một trong các header dưới đây.
 * Để trống = không kiểm tra (tiện khi mới nối thử).
 */
const WEBHOOK_TOKEN = (process.env.WEBHOOK_TOKEN || '').trim();
const TOKEN_HEADERS = ['x-api-key', 'x-webhook-token', 'token', 'authorization'];

const WEBHOOK_PATH_PATTERN = /^\/api\/data-sources\/webhook\/([^/]+)\/?$/;
// Provider slugs are opaque identifiers. Keep accepting the generated format,
// but also accept older LadiPage slugs so a form configured before the CRM
// update is not rejected with 404 before its payload reaches the durable inbox.
const SLUG_PATTERN = /^ds-[a-z0-9][a-z0-9-]{4,159}$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

/* ------------------------------------------------------------------ inbox */

let inbox = [];
let inboxFlushScheduled = false;
let inboxFlushRunning = false;

function loadInbox() {
  try {
    const raw = fs.readFileSync(INBOX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    inbox = Array.isArray(parsed) ? parsed.filter(item => item && item.id) : [];
  } catch {
    inbox = [];
  }
}

async function flushInbox() {
  if(inboxFlushRunning)return;
  inboxFlushRunning=true;
  const tmp = INBOX_FILE + '.' + process.pid + '.tmp';
  try {
    await fsp.mkdir(path.dirname(INBOX_FILE), { recursive: true });
    do {
      inboxFlushScheduled=false;
      await fsp.writeFile(tmp, JSON.stringify(inbox), 'utf8');
      await fsp.rename(tmp, INBOX_FILE);
    } while(inboxFlushScheduled);
  } catch (error) {
    console.error('[inbox] Không ghi được file inbox:', error.message);
  } finally { inboxFlushRunning=false; inboxFlushScheduled=false; }
}

function scheduleFlush() {
  if (inboxFlushScheduled) return;
  inboxFlushScheduled = true;
  if(!inboxFlushRunning)setImmediate(flushInbox);
}

/* ------------------------------------------------------- LadiPage adapter */

/**
 * LadiPage gửi payload PHẲNG (một cấp) và tên trường là do người dùng tự đặt
 * trong builder — thường là tiếng Việt có dấu. Nên phải đoán trường theo alias,
 * sau khi bỏ dấu + bỏ ký tự không phải chữ số.
 *
 * Lấy họ tên, SĐT, email và IP khách nếu payload form có gửi IP hợp lệ.
 * Không dùng IP kết nối webhook để chặn: đó có thể là máy chủ LadiPage.
 * Không lấy utm/link/ladi_form_id vào khách hàng.
 */
const KEY_ALIASES = {
  name: ['name', 'fullname', 'hoten', 'hovaten', 'ten', 'tenkhachhang', 'khachhang', 'customer', 'customername', 'yourname', 'field', 'hotenkhachhang'],
  phone: ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'sdt', 'sodienthoai', 'dienthoai', 'cellphone', 'number', 'hotline', 'lienhe'],
  email: ['email', 'mail', 'gmail', 'emailaddress', 'thudientu'],
  ipAddress: ['ip', 'ipaddress', 'clientip', 'visitorip', 'remoteip', 'ipkhachhang', 'diachiip']
};

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function normalizeKey(key) {
  return stripDiacritics(key).replace(/[^a-z0-9]/g, '');
}

function normalizeVisitorIp(value) {
  let candidate = String(value || '').trim();
  if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) candidate = candidate.slice(1, -1).trim();
  return net.isIP(candidate) ? candidate.slice(0, 64) : '';
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Giá trị LadiPage có thể là mảng (field nhiều lựa chọn) — lấy phần tử đầu có nghĩa. */
function firstScalar(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const scalar = firstScalar(item);
      if (scalar !== '') return scalar;
    }
    return '';
  }
  if (value && typeof value === 'object') return '';
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Làm phẳng một cấp để chịu được payload lồng nhau dù LadiPage normally gửi phẳng. */
function flattenPayload(payload, depth = 0) {
  const flat = {};
  if (!payload || typeof payload !== 'object') return flat;
  for (const [key, value] of Object.entries(payload)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) {
      Object.assign(flat, flattenPayload(value, depth + 1));
      continue;
    }
    const scalar = firstScalar(value);
    if (scalar !== '') flat[key] = scalar;
  }
  return flat;
}

function pickField(flat, normalizedByKey, aliases) {
  for (const alias of aliases) {
    const hit = normalizedByKey[alias];
    if (hit !== undefined && hit !== '') return { value: flat[hit], key: hit };
  }
  // LadiPage may prefix custom field labels (for example `field_1_Họ và
  // tên`). Match a meaningful alias inside the normalized key as a fallback,
  // while ignoring the generic `field` alias to avoid selecting an arbitrary
  // field as the customer name.
  for (const alias of aliases.filter(item => item.length >= 4 && item !== 'field')) {
    const hit = Object.keys(normalizedByKey).find(normalized => normalized.includes(alias));
    if (hit) return { value: flat[normalizedByKey[hit]], key: normalizedByKey[hit] };
  }
  return { value: '', key: '' };
}

/**
 * Trả về { name, phone, email } hoặc lỗi. Đây là toàn bộ những gì landing page
 * được phép đưa vào khách hàng.
 */
function adaptLadiPagePayload(payload) {
  const flat = flattenPayload(payload);
  const normalizedByKey = {};
  for (const key of Object.keys(flat)) {
    const normalized = normalizeKey(key);
    if (normalized && !(normalized in normalizedByKey)) normalizedByKey[normalized] = key;
  }

  const name = pickField(flat, normalizedByKey, KEY_ALIASES.name);
  const phone = pickField(flat, normalizedByKey, KEY_ALIASES.phone);
  const email = pickField(flat, normalizedByKey, KEY_ALIASES.email);
  const ipAddress = pickField(flat, normalizedByKey, KEY_ALIASES.ipAddress);

  const problems = [];
  if (!name.value) problems.push('thiếu họ tên');

  const digits = normalizeDigits(phone.value);
  // 9–13 số sau khi bỏ ký tự lạ; chấp nhận +84/84 vì CRM tự chuẩn hóa tiếp.
  if (digits.length < 9 || digits.length > 13) problems.push('số điện thoại không hợp lệ');

  if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) problems.push('email sai định dạng');

  return {
    ok: problems.length === 0,
    problems,
    record: {
      name: String(name.value).slice(0, 160),
      phone: String(phone.value).slice(0, 32),
      email: String(email.value).slice(0, 254),
      ipAddress: normalizeVisitorIp(ipAddress.value),
      matchedKeys: { name: name.key, phone: phone.key, email: email.key, ipAddress: ipAddress.key }
    },
    flat
  };
}

/* ------------------------------------------------------------- parse body */

function contentTypeOf(request) {
  // Media type/charset are case-insensitive; multipart boundary values are not.
  const header = String(request.headers['content-type'] || '');
  return { full: header, base: header.split(';')[0].trim().toLowerCase(), charset: ((header.match(/charset=([\w-]+)/i) || [])[1] || '').toLowerCase() };
}

function parseUrlEncoded(text) {
  const out = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const rawKey = index === -1 ? pair : pair.slice(0, index);
    const rawValue = index === -1 ? '' : pair.slice(index + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      if (key in out) {
        out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
      } else {
        out[key] = value;
      }
    } catch {
      /* cặp lỗi encoding thì bỏ qua, không làm sập cả request */
    }
  }
  return out;
}

/**
 * LadiPage có 3 lựa chọn content type: x-www-form-urlencoded (MẶC ĐỊNH),
 * multipart/form-data và application/json. Phải chịu được cả ba, vì người dùng
 * rất dễ quên đổi dropdown và data sẽ mấtเงียบ.
 */
function parseMultipart(buffer, contentTypeFull) {
  const boundaryMatch = contentTypeFull.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = `--${(boundaryMatch[1] || boundaryMatch[2]).trim()}`;
  const out = {};
  const raw = buffer.toString('utf8');
  const parts = raw.split(boundary).slice(1, -1);
  for (const part of parts) {
    const separator = part.indexOf('\r\n\r\n');
    if (separator === -1) continue;
    const head = part.slice(0, separator);
    let body = part.slice(separator + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    const nameMatch = head.match(/name="([^"]*)"/i);
    if (!nameMatch) continue;
    out[nameMatch[1]] = body.trim();
  }
  return out;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // KHÔNG destroy socket ở đây: client sẽ thấy "fetch failed" thay vì 413.
        // Ngừng giữ chunk và hút cạn body để response 413 đi được trọn vẹn.
        tooLarge = true;
        chunks.length = 0;
        request.pause();
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }));
      else resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

async function saveSupportImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw Object.assign(new Error('Ảnh đính kèm không đúng định dạng PNG, JPG, WEBP hoặc GIF.'), { status: 400 });
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_SUPPORT_IMAGE_BYTES) throw Object.assign(new Error('Ảnh đính kèm phải nhỏ hơn hoặc bằng 5 MB.'), { status: 413 });
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[mime];
  const fileName = `support-${crypto.randomUUID()}.${extension}`;
  await fsp.mkdir(SUPPORT_UPLOAD_DIR, { recursive: true });
  await fsp.writeFile(path.join(SUPPORT_UPLOAD_DIR, fileName), bytes, { flag: 'wx' });
  return { fileName, mime, path: path.join(SUPPORT_UPLOAD_DIR, fileName) };
}

async function sendSupportUpload(request, response, user, fileName) {
  const safeName = path.basename(String(fileName || ''));
  if (!/^[a-z0-9][a-z0-9.-]{8,159}$/i.test(safeName)) return dbJson(request, response, 404, { error: 'Không tìm thấy ảnh đính kèm.' });
  const access = await supportChat.canReadUpload(user, safeName);
  if (!access?.allowed) return dbJson(request, response, 403, { error: 'Không có quyền xem ảnh đính kèm.' });
  const filePath = path.join(SUPPORT_UPLOAD_DIR, safeName);
  let image;
  try { image = await fsp.readFile(filePath); }
  catch { return dbJson(request, response, 404, { error: 'Ảnh đính kèm không còn tồn tại.' }); }
  response.writeHead(200, { 'Content-Type': access.mime || 'application/octet-stream', 'Content-Length': image.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  response.end(image);
}

async function handleSupportApi(request, response, pathname, user) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (pathname.startsWith('/api/support/uploads/') && request.method === 'GET') return sendSupportUpload(request, response, user, decodeURIComponent(pathname.slice('/api/support/uploads/'.length)));
  if (pathname === '/api/support/conversations' && request.method === 'GET') return dbJson(request, response, 200, { conversations: await supportChat.listConversations(user) });
  if (pathname === '/api/support/messages' && request.method === 'GET') return dbJson(request, response, 200, await supportChat.getMessages(user, url.searchParams.get('conversationId'), url.searchParams.get('beforeCreatedAt'), url.searchParams.get('beforeId')));
  if (pathname === '/api/support/messages' && request.method === 'POST') {
    const body = await readDbBody(request);
    let image = null;
    try {
      if (body.imageData) image = await saveSupportImage(body.imageData);
      const message = user.role === 'ADMIN'
        ? await supportChat.createAdminMessage(user, { conversationId: body.conversationId, content: body.content, imageFile: image?.fileName, imageMime: image?.mime })
        : await supportChat.createEmployeeMessage(user, { content: body.content, imageFile: image?.fileName, imageMime: image?.mime });
      let telegram = { skipped: true };
      if (user.role !== 'ADMIN') {
        telegram = await telegramBot.notifyInternalSupportMessage(message, image?.path || '');
        if (telegram?.messageId) await supportChat.setTelegramMessageId(message.id, telegram.messageId);
      }
      notifySupportListeners({ conversationId: message.conversationId, requesterUserId: message.requesterUserId || message.requester?.id || user.id });
      return dbJson(request, response, 201, { ok: true, message, telegram: { sent: Boolean(telegram?.sent), configured: telegram?.configured !== false } });
    } catch (error) {
      if (image?.path) await fsp.unlink(image.path).catch(() => {});
      throw error;
    }
  }
  if (pathname === '/api/support/stream' && request.method === 'GET') return handleSupportStream(request, response, user);
  if (pathname === '/api/support/resolve' && request.method === 'POST') {
    const body = await readDbBody(request);
    return dbJson(request, response, 200, await supportChat.markResolved(user, body.conversationId));
  }
  return dbJson(request, response, 404, { error: 'API hỗ trợ nội bộ không tồn tại.' });
}

function decodeBody(buffer, contentType) {
  const text = buffer.toString(contentType.charset === 'utf-16le' ? 'utf16le' : 'utf8');
  if (contentType.base === 'application/json' || contentType.base === 'text/json') {
    if (!text.trim()) return {};
    return JSON.parse(text);
  }
  if (contentType.base === 'application/x-www-form-urlencoded') return parseUrlEncoded(text);
  if (contentType.base === 'multipart/form-data') {
    const parsed = parseMultipart(buffer, contentType.full);
    if (parsed) return parsed;
  }
  // Không khai báo content type: thử JSON trước, rơi về form-urlencoded.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* rơi xuống dưới */ }
  }
  return parseUrlEncoded(trimmed);
}

/* --------------------------------------------------------------- helpers */

function acceptedContentEncoding(request) {
  const value = String(request?.headers?.['accept-encoding'] || '').toLowerCase();
  const quality = token => {
    const match = value.match(new RegExp(`(?:^|,)\\s*${token}\\s*(?:;\\s*q=([0-9.]+))?`));
    return match && Number(match[1] ?? 1) > 0 ? Number(match[1] ?? 1) : 0;
  };
  const gzip = quality('gzip');
  const deflate = quality('deflate');
  if (gzip >= deflate && gzip > 0) return 'gzip';
  if (deflate > 0) return 'deflate';
  return '';
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const source = Buffer.from(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': source.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  };
  const vary = new Set(String(headers.Vary || '').split(',').map(item => item.trim()).filter(Boolean));
  vary.add('Accept-Encoding');
  headers.Vary = [...vary].join(', ');
  const request = response.req;
  const encoding = source.length > 1024 ? acceptedContentEncoding(request) : '';
  if (!encoding) {
    response.writeHead(status, headers);
    response.end(source);
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const done = (error, compressed) => {
      if (error) {
        delete headers['Content-Encoding'];
        headers['Content-Length'] = source.length;
        response.writeHead(status, headers);
        response.end(source);
      } else {
        headers['Content-Encoding'] = encoding;
        headers['Content-Length'] = compressed.length;
        response.writeHead(status, headers);
        response.end(compressed);
      }
      resolve();
    };
    const options = { level: zlib.constants.Z_BEST_SPEED };
    if (encoding === 'gzip') zlib.gzip(source, options, done);
    else zlib.deflate(source, options, done);
  });
}

function emailCorsHeaders(request) {
  const origin = String(request.headers.origin || '').trim();
  if (!origin) return {};
  try {
    const originUrl = new URL(origin);
    const host = String(request.headers.host || '').split(':')[0].toLowerCase();
    if (originUrl.hostname.toLowerCase() !== host) return null;
  } catch {
    return null;
  }
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function checkEmailToken(request) {
  if (!EMAIL_TOKEN) return true;
  return String(request.headers['x-crm-email-token'] || '').trim() === EMAIL_TOKEN;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function maskEmail(value) {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at < 2) return email ? '?? c?u h?nh' : '';
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function handleEmailStatus(request, response) {
  const cors = emailCorsHeaders(request);
  if (cors === null) return sendJson(response, 403, { configured: false, error: 'Nguồn gửi không hợp lệ' });
  if (request.method !== 'GET') return sendJson(response, 405, { configured: false, error: 'Chỉ chấp nhận GET' }, { Allow: 'GET', ...cors });
  sendJson(response, 200, { configured: SMTP_ENABLED, sender: maskEmail(SMTP_FROM), host: SMTP_HOST, port: SMTP_PORT }, cors);
}

async function handleEmailNotify(request, response) {
  const cors = emailCorsHeaders(request);
  if (cors === null) return sendJson(response, 403, { sent: false, error: 'Nguồn gửi không hợp lệ' });
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-CRM-Email-Token', 'Access-Control-Max-Age': '600' });
    response.end();
    return;
  }
  if (request.method !== 'POST') return sendJson(response, 405, { sent: false, error: 'Chỉ chấp nhận POST' }, { Allow: 'POST, OPTIONS', ...cors });
  if (!checkEmailToken(request)) return sendJson(response, 401, { sent: false, error: 'Thiếu hoặc sai mã bảo vệ email' }, cors);
  if (!mailTransporter) return sendJson(response, 503, { sent: false, configured: false, error: 'Server chưa cấu hình Gmail SMTP' }, cors);

  let payload;
  try {
    const buffer = await readBody(request);
    payload = JSON.parse(buffer.toString('utf8'));
  } catch {
    return sendJson(response, 400, { sent: false, error: 'Body JSON không hợp lệ' }, cors);
  }
  const recipients = [...new Set((Array.isArray(payload?.recipients) ? payload.recipients : [payload?.to]).map(value => String(value || '').trim().toLowerCase()).filter(validEmail))].slice(0, 20);
  const subject = String(payload?.subject || '').trim().slice(0, 180);
  const text = String(payload?.text || '').trim().slice(0, 10000);
  if (!recipients.length || !subject || !text) return sendJson(response, 422, { sent: false, error: 'Thiếu người nhận, tiêu đề hoặc nội dung' }, cors);
  try {
    const result = await mailTransporter.sendMail({ from: SMTP_FROM, to: recipients.join(', '), subject, text });
    sendJson(response, 200, { sent: true, messageId: result.messageId, recipients }, cors);
  } catch (error) {
    console.error('[email] send failed:', error.message);
    sendJson(response, 502, { sent: false, error: 'Gửi Gmail thất bại' }, cors);
  }
}

function clientIpOf(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded;
  const socketAddress = request.socket && request.socket.remoteAddress ? request.socket.remoteAddress : '';
  return socketAddress.replace(/^::ffff:/, '') || 'Chưa xác định';
}

function checkToken(request) {
  if (!WEBHOOK_TOKEN) return true;
  return TOKEN_HEADERS.some(header => {
    const value = String(request.headers[header] || '').trim();
    if (!value) return false;
    const bare = value.replace(/^bearer\s+/i, '');
    return bare === WEBHOOK_TOKEN;
  });
}

function dedupeKey(slug, phone, payload) {
  const stablePayload = Object.fromEntries(Object.entries(payload || {}).filter(([key]) => !KEY_ALIASES.ipAddress.includes(normalizeKey(key))));
  const payloadHash = crypto.createHash('sha256')
    .update(JSON.stringify(stablePayload, Object.keys(stablePayload).sort()))
    .digest('hex');
  return crypto.createHash('sha256')
    .update(`${slug}|${normalizeDigits(phone)}|${payloadHash}`)
    .digest('hex');
}

function stamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const value = name => parts.find(part => part.type === name)?.value || '00';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

async function notificationWebsiteForSlug(slug) {
  if (DEMO_MODE) return demoState.websites.find(website => String(website.webhookSlug || '').toUpperCase() === String(slug).toUpperCase()) || null;
  if (!dbConfigured) return null;
  const rows = await dbQuery("SELECT body FROM crm_documents WHERE collection='websites' AND deleted=0");
  for (const row of rows) {
    try { const website = typeof row.body === 'string' ? JSON.parse(row.body) : row.body; if (String(website?.webhookSlug || '').toUpperCase() === String(slug).toUpperCase()) return website; } catch {}
  }
  return null;
}
function notificationPayloadText(payload) {
  const value = payload?.message ?? payload?.content ?? payload?.text ?? payload?.body ?? payload?.description;
  if (value != null && typeof value !== 'object') return String(value).slice(0, 8000);
  return JSON.stringify(payload).slice(0, 8000);
}
async function handleNotificationWebhook(request, response, slug, website, payload) {
  const title = String(payload.title ?? payload.subject ?? payload.event ?? payload.type ?? ('Thông báo từ ' + (website.name || 'Webhook'))).trim().slice(0, 200) || 'Thông báo mới';
  const text = notificationPayloadText(payload) || 'Webhook đã nhận một thông báo mới.';
  const notification = { id: 'NT-WEB-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(), title, text, role: 'ALL', at: stamp(), readBy: [], source: 'WEBHOOK', webhookSlug: slug.toUpperCase(), webhookId: website.id, payload };
  const fields = [];
  if (dbConfigured) {
    const docs = await dbQuery("SELECT body FROM crm_documents WHERE collection='customFieldDefinitions' AND deleted=0");
    for (const row of docs) { try { const field = typeof row.body === 'string' ? JSON.parse(row.body) : row.body; if (field?.notificationWebhookId === website.id) fields.push({ id: field.id, label: field.label }); } catch {} }
    notification.targetFields = fields;
    await pool.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0)', ['notifications', notification.id, JSON.stringify(notification)]);
  } else if (DEMO_MODE) {
    notification.targetFields = (demoState.customFieldDefinitions || []).filter(field => field.notificationWebhookId === website.id).map(field => ({ id: field.id, label: field.label }));
    demoState.notifications.unshift(notification);
  } else {
    throw new Error('Webhook Thông Báo cần MySQL hoặc DEMO_MODE.');
  }
  notifyInboxListeners({ kind: 'notification', id: notification.id });
  console.log('[notification-webhook] ' + slug + ' · ' + title);
  sendJson(response, 200, { received: true, type: 'notification', id: notification.id, title, targetFields: notification.targetFields || [] });
}

/* ------------------------------------------------------------ webhook POST */

async function handleWebhook(request, response, slug) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': request.headers.origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Webhook-Token, Token',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin'
    });
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { received: false, error: 'Chỉ chấp nhận POST' }, { Allow: 'POST, OPTIONS' });
    return;
  }

  if (!SLUG_PATTERN.test(slug)) {
    sendJson(response, 404, { received: false, error: 'Mã webhook sai định dạng' });
    return;
  }

  if (!checkToken(request)) {
    console.warn('[webhook-auth]', slug, 'TOKEN_MISMATCH');
    sendJson(response, 401, { received: false, error: 'Sai token' });
    return;
  }

  const contentType = contentTypeOf(request);
  let buffer;
  try {
    buffer = await readBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { received: false, error: 'Không đọc được body' });
    return;
  }

  let payload;
  try {
    payload = decodeBody(buffer, contentType);
  } catch {
    sendJson(response, 400, { received: false, error: 'Body không parse được (JSON/form hỏng)' });
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    sendJson(response, 400, { received: false, error: 'Body phải là object các trường form' });
    return;
  }

  const adapted = adaptLadiPagePayload(payload);
  const key = dedupeKey(slug, adapted.record.phone, adapted.flat);
  const record = {
    id: `WHE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    slug: slug.toUpperCase(),
    receivedAt: stamp(),
    contentType: contentType.base || 'unknown',
    status: adapted.ok ? 'NEW' : 'INVALID',
    problems: adapted.problems,
    matchedKeys: adapted.record.matchedKeys,
    // IP khách chỉ lấy từ payload form; không lấy từ socket/header máy chủ gửi webhook.
    customer: { name: adapted.record.name, phone: adapted.record.phone, email: adapted.record.email, ipAddress: adapted.record.ipAddress },
    raw: adapted.flat,
    dedupeKey: key,
    retryCount: 0,
    consumedAt: ''
  };

  if (!adapted.ok) console.warn('[webhook-invalid]', record.id, record.slug, JSON.stringify(record.problems));

  // Persist before any SQL lookup: an unavailable database must not lose a lead.
  try { if (!DEMO_MODE) await webhookJournal.put(record); }
  catch (error) { console.error('[webhook-journal]', error.code || 'WRITE_FAILED'); return sendJson(response,503,{received:false,error:'Khong luu duoc hang doi webhook. Vui long gui lai.'}); }
  let website;
  try { website = await notificationWebsiteForSlug(slug); }
  catch (error) { return sendJson(response,503,{received:false,queued:!DEMO_MODE,id:record.id,error:'MySQL tam thoi khong san sang. Data da duoc giu de thu lai.'}); }
  if (website?.provider === 'NOTIFICATION') {
    try {
      await handleNotificationWebhook(request, response, slug, website, payload);
      if (!DEMO_MODE) await webhookJournal.remove(record);
    } catch (error) { console.error('[notification-webhook]',error.code || 'FAILED'); if (!response.writableEnded) sendJson(response,503,{received:false,error:'Chua luu duoc thong bao webhook.'}); }
    return;
  }
  try {
    const saved = await (DEMO_MODE ? persistDemoWebhook(record) : persistWebhook(record));
    record.customerId = saved.customerId;
    record.source = saved.source || null;
    record.duplicate = Boolean(saved.duplicate);
    record.replay = Boolean(saved.replay);
    record.ownerSaleId = saved.ownerSaleId || null;
    record.persisted = true;
    if (!DEMO_MODE) await webhookJournal.remove(record).catch(error => console.warn('[webhook-journal-cleanup]',error.code));
    record.id = saved.eventId;
    if (saved.blacklisted) {
      if (!DEMO_MODE) crmData.invalidateSnapshotCache();
      notifyInboxListeners({ kind: 'blacklist' });
      return sendJson(response, 200, { received: true, id: record.id, status: 'BLACKLISTED', customerId: null });
    }
  } catch (error) {
    console.error('[webhook-mysql]', error.message);
    sendJson(response, 503, { received: false, queued: !DEMO_MODE, id: record.id, error: 'Chưa lưu được MySQL. Vui lòng gửi lại.' });
    return;
  }
  if (dbConfigured && !DEMO_MODE) crmData.invalidateSnapshotCache();
  if (!inbox.some(item => item.id === record.id)) inbox.push(record);
  if (inbox.length > MAX_INBOX_RECORDS) inbox.splice(0, inbox.length - MAX_INBOX_RECORDS);
  scheduleFlush();
  notifyInboxListeners(record);

  if(dbConfigured&&!DEMO_MODE)wakeTelegramOutbox();

  console.log(`[webhook] ${record.status} ${slug} · ${record.customer.name || '(không tên)'} · ${record.customer.phone || '(không sdt)'}`);
  sendJson(response, adapted.ok ? 200 : 422, {
    received: true,
    id: record.id,
    status: record.status,
    problems: record.problems,
    duplicate: Boolean(record.duplicate),
    customerId: record.customerId || null,
    ownerSaleId: record.ownerSaleId || null
  });
}

/* ------------------------------------------------------- inbox read + SSE */

const sseClients = new Set();
const supportSseClients = new Set();

function notifyInboxListeners(record) {
  const event = `data: ${JSON.stringify({ changed: true, kind: record?.kind || 'webhook' })}\n\n`;
  for (const client of sseClients) {
    try { client.write(event); } catch { sseClients.delete(client); }
  }
}

function notifySupportListeners(record) {
  const event = `data: ${JSON.stringify({ changed: true, conversationId: record?.conversationId || '' })}\n\n`;
  for (const client of supportSseClients) {
    if (client.user.role !== 'ADMIN' && client.user.id !== record?.requesterUserId) continue;
    try { client.response.write(event); } catch { supportSseClients.delete(client); }
  }
}

async function handleInbox(request, response, url) {
  const user = DEMO_MODE ? demoUserFromToken(request) : await authUser(request);
  if(user?.role!=='ADMIN')return sendJson(response,403,{error:'Chỉ Admin được xem inbox'},corsHeaders(request));
  const since = url.searchParams.get('since') || '';
  const includeRaw = url.searchParams.get('raw') === '1';
  const startIndex = since ? inbox.findIndex(item => item.id === since) : -1;
  const items = (startIndex === -1 ? inbox : inbox.slice(startIndex + 1)).filter(item => item.status !== 'BLACKLISTED').map(item => {
    if (includeRaw) return item;
    const { raw, dedupeKey, ...rest } = item;
    return rest;
  });
  sendJson(response, 200, {
    count: items.length,
    lastId: inbox.length ? inbox[inbox.length - 1].id : '',
    items
  }, corsHeaders(request));
}

// Trên shared hosting (LiteSpeed/CloudLinux) mỗi kết nối SSE giữ một slot xử lý
// vĩnh viễn; vài tab mở là đủ làm các request khác xếp hàng tới khi timeout.
// Mặc định tắt: trả 204 để EventSource ngừng tự nối lại, client dùng polling.
const SSE_ENABLED = process.env.ENABLE_SSE === '1';
function rejectStream(response, request) {
  response.writeHead(204, { 'Cache-Control': 'no-store', ...corsHeaders(request) });
  response.end();
}

function handleInboxStream(request, response) {
  if (!SSE_ENABLED) return rejectStream(response, request);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    ...corsHeaders(request)
  });
  response.write(`retry: 3000\n\n`);
  sseClients.add(response);
  const heartbeat = setInterval(() => {
    try { response.write(': ping\n\n'); } catch { /* đóng ở request close */ }
  }, 25000);
  request.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(response);
  });
}

function handleSupportStream(request, response, user) {
  if (!SSE_ENABLED) return rejectStream(response, request);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders(request)
  });
  response.write(`retry: 3000\n\n`);
  const client = { response, user };
  supportSseClients.add(client);
  const heartbeat = setInterval(() => {
    try { response.write(': ping\n\n'); } catch { /* closed with the request */ }
  }, 25000);
  request.on('close', () => {
    clearInterval(heartbeat);
    supportSseClients.delete(client);
  });
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

/* ------------------------------------- IP thật cho đăng ký web / đăng nhập */

/**
 * Quy tắc: IP chỉ thu cho (a) sale tự tạo khách và (b) khách đăng ký từ web.
 * Hai luồng này đi qua trình duyệt khách → server nhìn thấy IP thật của khách.
 */
function handleSessionContext(request, response) {
  sendJson(response, 200, { ip: clientIpOf(request) }, corsHeaders(request));
}

/* ------------------------------------------------------------- static file */

async function serveStatic(request, response, urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  if (['/customer-journey.svg', '/team-hierarchy-tree.svg'].includes(decoded)) {
    const absolute = path.resolve(REPO_ROOT, `.${decoded}`);
    try {
      const body = await fsp.readFile(absolute);
      const hasVersion=Boolean(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('v'));
      response.writeHead(200, {
        'Content-Type':'image/svg+xml; charset=utf-8',
        'Content-Length':body.length,
        'Cache-Control':hasVersion ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      response.end(body);
    } catch {
      response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      response.end('404 Khong tim thay file');
    }
    return;
  }
  if (!['/','/index.html','/crm.js','/crm.css','/crm-modern.css','/crm-boot.css','/logo.jpg','/login-background.jpg','/customer-journey.svg','/care-ui.js','/crm-runtime.html','/crm-runtime-api.js','/reference-view.js','/reference-crm.js','/marketing-hub.js','/crm-notifications.js','/crm-mobile.js','/crm-mobile.css','/order-payments.js','/accounting-detail.js','/hr-profiles.js','/customer-save-queue.js','/support-chat-widget.js','/nvt-mobile-auth.css','/team-tree-hierarchy.css','/commission_tree_demo.html','/commission-apex-mindmap.svg','/assets/livechat-employee.png'].includes(decoded)) return sendJson(response,404,{error:'Không tìm thấy tài nguyên'});

  let relative = decoded === '/' ? '/index.html' : decoded;
  const absolute = path.resolve(REPO_ROOT, `.${path.posix.normalize(relative)}`);

  // Chặn path traversal: phải nằm trong REPO_ROOT.
  if (absolute !== REPO_ROOT && !absolute.startsWith(REPO_ROOT + path.sep)) {
    sendJson(response, 403, { error: 'Đường dẫn không hợp lệ' });
    return;
  }

  try {
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory()) {
      return serveStatic(request, response, `${relative.replace(/\/$/, '')}/index.html`);
    }
    const extension = path.extname(absolute).toLowerCase();
    const body = await fsp.readFile(absolute);
    const hasVersion=Boolean(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('v'));
    const contentType=MIME[extension] || 'application/octet-stream';
    const compressible=/^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/i.test(contentType);
    const acceptsGzip=/\bgzip\b/i.test(String(request.headers['accept-encoding']||''));
    const responseBody=compressible&&acceptsGzip&&body.length>1024?await new Promise((resolve,reject)=>zlib.gzip(body,{level:zlib.constants.Z_BEST_SPEED},(error,result)=>error?reject(error):resolve(result))):body;
    const headers={
      'Content-Type':contentType,
      'Content-Length':responseBody.length,
      'Cache-Control':extension==='.html' ? 'no-cache' : hasVersion ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Vary':'Accept-Encoding'
    };
    if(responseBody!==body)headers['Content-Encoding']='gzip';
    response.writeHead(200, headers);
    response.end(responseBody);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('404 Không tìm thấy file');
  }
}

const DEMO_MARKETING_API_KEY = 'crm_secret_marketing_key_2026';
const CRM_EXPORT_API_KEY = String(process.env.CRM_API_KEY || '').trim();
const CRM_PUSH_API_KEY = String(process.env.CRM_PUSH_API_KEY || '').trim();
const demoMarketingPushRequests = new Set();

const MarketingHub = require('./marketing-hub.js');
const { normalizePhoneForApi, parseCrmTimestamp, formatLeadPayload } = require('./marketing-export.cjs');
const aiAnalysis = require('./ai-analysis.cjs');
function stateRows(state, key) { return Array.isArray(state?.[key]) ? state[key] : []; }
async function marketingApiState() {
  if (DEMO_MODE) return { state: demoState };
  if (!dbConfigured) throw Object.assign(new Error('CRM chua duoc cau hinh co so du lieu.'), { status: 503 });
  const snapshot = await crmData.read({ id: 'marketing-api', role: 'ADMIN', active: true }, { passive: true, full: true });
  return { state: snapshot.state || {} };
}
function marketingApiAuthorized(request) {
  const supplied=String(request.headers['x-api-key']||'').trim(), configured=DEMO_MODE?DEMO_MARKETING_API_KEY:CRM_EXPORT_API_KEY;
  if(!configured)return {ok:false,status:503,error:'CRM_API_KEY missing'};
  const a=Buffer.from(supplied),b=Buffer.from(configured); if(!supplied||a.length!==b.length||!crypto.timingSafeEqual(a,b))return {ok:false,status:401,error:'Invalid x-api-key'}; return {ok:true};
}
async function handleMarketingAnalysisApi(request,response,url){
  if(request.method==='OPTIONS'){response.writeHead(204,corsHeaders(request));return response.end();}
  if(request.method!=='GET')return sendJson(response,405,{error:'GET only'},corsHeaders(request));
  const auth=marketingApiAuthorized(request);if(!auth.ok)return sendJson(response,auth.status,{error:auth.error},corsHeaders(request));
  let snapshot;try{snapshot=await marketingApiState();}catch(e){return sendJson(response,e.status||500,{error:e.message},corsHeaders(request));}
  const state=snapshot.state||{};
  if(url.pathname==='/api/marketing/staff-ranking'){const result=aiAnalysis.rankStaff(state);if(url.searchParams.get('ai')==='1')result.ai_result=await aiAnalysis.callOpenAI('staff',{staff:result.staff.slice(0,100)});return sendJson(response,200,{ok:true,data:result},corsHeaders(request));}
  if(url.pathname==='/api/marketing/customer-analysis'){const id=String(url.searchParams.get('customer_id')||'').trim();if(!id)return sendJson(response,400,{error:'customer_id required'},corsHeaders(request));const result=aiAnalysis.customerAssessment(state,id);if(!result)return sendJson(response,404,{error:'Customer not found'},corsHeaders(request));if(url.searchParams.get('ai')==='1')result.ai_result=await aiAnalysis.callOpenAI('customer',result);return sendJson(response,200,{ok:true,data:result},corsHeaders(request));}
  return sendJson(response,404,{error:'Not found'},corsHeaders(request));
}

function marketingPushAuthorized(request) {
  const supplied = String(request.headers['x-api-key'] || '').trim();
  const configured = DEMO_MODE ? DEMO_MARKETING_API_KEY : CRM_PUSH_API_KEY;
  if (!configured) return { ok: false, status: 503, error: 'CRM_PUSH_API_KEY chua duoc cau hinh tren server.' };
  const suppliedBytes = Buffer.from(supplied), configuredBytes = Buffer.from(configured);
  if (!supplied || suppliedBytes.length !== configuredBytes.length || !crypto.timingSafeEqual(suppliedBytes, configuredBytes)) {
    return { ok: false, status: 401, error: 'API key khong hop le hoac thieu header x-api-key.' };
  }
  return { ok: true };
}

function pushBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return Boolean(value);
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'co', 'có', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'khong', 'không', 'off'].includes(normalized)) return false;
  throw Object.assign(new Error(`${field} phai la boolean.`), { status: 422 });
}

function pushPriority(value) {
  if (value == null || value === '') return null;
  const aliases = { urgent: 1, highest: 1, high: 1, cao: 1, medium: 3, normal: 3, trungbinh: 3, 'trung bình': 3, low: 5, thap: 5, 'thấp': 5 };
  const raw = typeof value === 'string' && aliases[value.trim().toLowerCase()] !== undefined
    ? aliases[value.trim().toLowerCase()]
    : Number(value);
  if (!Number.isInteger(raw) || raw < 1 || raw > 5) throw Object.assign(new Error('call_priority phai la so nguyen tu 1 den 5.'), { status: 422 });
  return raw;
}

function pushTimestamp(value) {
  if (value == null || value === '') return stamp();
  const parsed = parseCrmTimestamp(value);
  if (!Number.isFinite(parsed)) throw Object.assign(new Error('analyzed_at phai la timestamp hop le.'), { status: 422 });
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(new Date(parsed)).replace('T', ' ');
}

function marketingPushFields(record, body) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw Object.assign(new Error('Moi customer phai la object.'), { status: 422 });
  const fields = {};
  const quality = record.quality_label ?? record.data_quality_label ?? record.quality ?? record.nhan_chat_luong;
  if (quality != null && quality !== '') {
    const value = String(quality).trim();
    if (!value || value.length > 80) throw Object.assign(new Error('quality_label khong hop le.'), { status: 422 });
    fields.marketing_quality_label = value;
  }
  const audience = record.audience_network_avoid ?? record.audience_network_ne ?? record.avoid_audience_network;
  if (audience !== undefined && audience !== null && audience !== '') fields.marketing_audience_network_avoid = pushBoolean(audience, 'audience_network_avoid');
  const priority = record.call_priority ?? record.priority ?? record.muc_uu_tien_goi;
  if (priority !== undefined && priority !== null && priority !== '') fields.marketing_call_priority = pushPriority(priority);
  const analysisNote = record.analysis_note ?? record.quality_note ?? record.note;
  if (analysisNote !== undefined && analysisNote !== null) {
    const value = String(analysisNote).trim();
    if (value.length > 2000) throw Object.assign(new Error('analysis_note qua dai.'), { status: 422 });
    fields.marketing_analysis_note = value;
  }
  const source = record.analysis_source ?? body.source;
  if (source !== undefined && source !== null && source !== '') {
    const value = String(source).trim();
    if (value.length > 120) throw Object.assign(new Error('source qua dai.'), { status: 422 });
    fields.marketing_analysis_source = value;
  }
  const version = record.analysis_version ?? body.analysis_version;
  if (version !== undefined && version !== null && version !== '') {
    const value = String(version).trim();
    if (value.length > 80) throw Object.assign(new Error('analysis_version qua dai.'), { status: 422 });
    fields.marketing_analysis_version = value;
  }
  if (!Object.keys(fields).length) throw Object.assign(new Error('Customer thieu it nhat mot truong phan tich.'), { status: 422 });
  fields.marketing_analyzed_at = pushTimestamp(record.analyzed_at ?? body.analyzed_at);
  return fields;
}

async function handleLeadsPushApi(request, response, url) {
  if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders(request)); return response.end(); }
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Chi chap nhan POST' }, { Allow: 'POST, OPTIONS', ...corsHeaders(request) });
  const auth = marketingPushAuthorized(request);
  if (!auth.ok) return sendJson(response, auth.status, { error: auth.error }, corsHeaders(request));

  let body;
  try { body = await readDbBody(request); } catch (error) { return sendJson(response, error.status || 400, { error: 'Body JSON khong hop le.' }, corsHeaders(request)); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(response, 400, { error: 'Body phai la object JSON.' }, corsHeaders(request));
  const requestId = String(body.request_id || body.requestId || '').trim() || `marketing-push-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  if (!/^[-\w]{1,96}$/.test(requestId)) return sendJson(response, 422, { error: 'request_id chi duoc gom chu, so, dau gach ngang va gach duoi.' }, corsHeaders(request));
  const records = Array.isArray(body.customers) ? body.customers : Array.isArray(body.data) ? body.data : null;
  if (!records || !records.length) return sendJson(response, 400, { error: 'customers phai la mang khong rong.' }, corsHeaders(request));
  if (records.length > 500) return sendJson(response, 413, { error: 'Moi lan push toi da 500 customer.' }, corsHeaders(request));
  if (DEMO_MODE && demoMarketingPushRequests.has(requestId)) return sendJson(response, 200, { ok: true, request_id: requestId, replayed: true, results: [], summary: { received: 0, updated: 0, not_found: 0, invalid: 0, duplicate: 0 } }, corsHeaders(request));

  let snapshot;
  try { snapshot = await marketingApiState(); } catch (error) { return sendJson(response, error.status || 500, { error: error.message }, corsHeaders(request)); }
  const state = snapshot.state || {}, customers = Array.isArray(state.customers) ? state.customers : [];
  const byPhone = new Map();
  for (const customer of customers) {
    const phone = normalizePhoneForApi(customer.phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(customer);
  }
  const seenPhones = new Set(), results = [], changes = [], now = stamp();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const phone = normalizePhoneForApi(record?.phone ?? record?.phone_number ?? record?.sdt);
    const base = { index, phone: phone || null };
    if (!/^\d{9,15}$/.test(phone)) { results.push({ ...base, status: 'invalid', error: 'phone phai co tu 9 den 15 chu so.' }); continue; }
    if (seenPhones.has(phone)) { results.push({ ...base, status: 'duplicate' }); continue; }
    seenPhones.add(phone);
    const matches = byPhone.get(phone) || [];
    if (!matches.length) { results.push({ ...base, status: 'not_found', error: 'Khong tim thay khach hang trong CRM.' }); continue; }
    if (matches.length > 1) { results.push({ ...base, status: 'invalid', error: 'So dien thoai trung nhieu khach hang trong CRM.' }); continue; }
    try {
      const fields = marketingPushFields(record, body), customer = matches[0];
      const updated = { ...customer, updatedAt: now, customFields: { ...(customer.customFields || {}), ...fields } };
      changes.push({ key: 'customers', id: String(customer.id), base: null, fields: [...Object.keys(fields).map(field => `customFields.${field}`), 'updatedAt'], value: updated });
      const eventId = 'MKT-PUSH-' + crypto.createHash('sha256').update(JSON.stringify([requestId, String(customer.id)])).digest('hex');
      changes.push({ key: 'audit', id: eventId, base: null, value: { id: eventId, actorId: 'MARKETING_PUSH_API', action: 'MARKETING_ANALYSIS_PUSH', source: 'MARKETING_PUSH_API', customerId: String(customer.id), at: now, detail: 'Sheet phan tich cap nhat nhan chat luong, Audience Network va uu tien goi.' } });
      results.push({ ...base, customer_id: String(customer.id), status: 'updated', fields: Object.keys(fields) });
    } catch (error) { results.push({ ...base, status: 'invalid', error: error.message }); }
  }
  const updateResults = results.filter(item => item.status === 'updated');
  if (changes.length) {
    if (DEMO_MODE) {
      for (const change of changes.filter(item => item.key === 'customers')) {
        const customer = demoState.customers.find(item => String(item.id) === String(change.id));
        if (customer) Object.assign(customer, change.value);
      }
      for (const change of changes.filter(item => item.key === 'audit')) demoState.audit.unshift(change.value);
      demoMarketingPushRequests.add(requestId);
    } else {
      const actor = { id: 'MARKETING_PUSH_API', role: 'ADMIN', active: true, teamId: '', leaderId: null };
      try {
        const writeResult = await crmData.write(actor, requestId, changes, { skipAutomatic: true });
        if (writeResult?.replayed) return sendJson(response, 200, { ok: true, request_id: requestId, replayed: true, results: [], summary: { received: 0, updated: 0, not_found: 0, invalid: 0, duplicate: 0 } }, corsHeaders(request));
      }
      catch (error) { return sendJson(response, error.status || 500, { error: 'Khong ghi duoc du lieu phan tich vao CRM.', detail: error.message }, corsHeaders(request)); }
    }
  } else if (DEMO_MODE) demoMarketingPushRequests.add(requestId);
  const summary = { received: records.length, updated: updateResults.length, not_found: results.filter(item => item.status === 'not_found').length, invalid: results.filter(item => item.status === 'invalid').length, duplicate: results.filter(item => item.status === 'duplicate').length };
  return sendJson(response, 200, { ok: true, request_id: requestId, replayed: false, summary, results }, corsHeaders(request));
}

async function handleLeadsExportApi(request, response, url) {
  if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders(request)); return response.end(); }
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'Chi chap nhan GET' }, corsHeaders(request));
  const suppliedKey = String(request.headers['x-api-key'] || '').trim();
  const configuredKey = DEMO_MODE ? DEMO_MARKETING_API_KEY : CRM_EXPORT_API_KEY;
  if (!configuredKey) return sendJson(response, 503, { error: 'CRM_API_KEY chua duoc cau hinh tren server.' }, corsHeaders(request));
  const suppliedBytes=Buffer.from(suppliedKey),configuredBytes=Buffer.from(configuredKey);
  if (!suppliedKey || suppliedBytes.length !== configuredBytes.length || !crypto.timingSafeEqual(suppliedBytes,configuredBytes)) return sendJson(response, 401, { error: 'API key khong hop le hoac thieu header x-api-key.' }, corsHeaders(request));
  const sinceRaw = url.searchParams.get('since');
  const since = sinceRaw ? parseCrmTimestamp(sinceRaw, { dateOnlyStart: true }) : NaN;
  if (sinceRaw && !Number.isFinite(since)) return sendJson(response, 400, { error: 'since phai la ngay YYYY-MM-DD hoac timestamp hop le.' }, corsHeaders(request));
  const sourceFilter = String(url.searchParams.get('source') || '').trim().toLowerCase();
  const phoneFilter = url.searchParams.get('phone');
  if (url.pathname==='/api/customer' && (!phoneFilter || !normalizePhoneForApi(phoneFilter))) return sendJson(response,400,{error:'phone la tham so bat buoc.'},corsHeaders(request));
  const exportAll = url.pathname === '/api/leads/export-all';
  const pageRaw = Number(url.searchParams.get('page') || 1), limitRaw = Number(url.searchParams.get('limit') || 100);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1, limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(500, limitRaw) : 100;
  let snapshot;
  try { snapshot = await marketingApiState(); } catch (error) { return sendJson(response, error.status || 500, { error: error.message }, corsHeaders(request)); }
  const state = snapshot.state || {}, customers = MarketingHub.prepareData(state).customers, orders = stateRows(state, 'orders'), members = stateRows(state, 'members'), sourceNotes = stateRows(state, 'notes');
  const memberMap = new Map(members.map(member => [String(member.id), member.name || member.id])), notesByCustomer = new Map(), ordersByCust = new Map();
  for (const note of sourceNotes) { const customerId = note?.customerId || note?.customer_id; if (!customerId) continue; if (!notesByCustomer.has(String(customerId))) notesByCustomer.set(String(customerId), []); notesByCustomer.get(String(customerId)).push(note); }
  for (const order of orders) { const customerId = order?.customerId || order?.customer_id; if (!customerId) continue; if (!ordersByCust.has(String(customerId))) ordersByCust.set(String(customerId), []); ordersByCust.get(String(customerId)).push(order); }
  let filtered = customers.filter(customer => {
    if (Number.isFinite(since)) { const updated = parseCrmTimestamp(customer.updatedAt || customer.updated_at || customer.createdAt || customer.created_at); if (!Number.isFinite(updated) || updated < since) return false; }
    if (sourceFilter && !String(customer.source || customer.campaign || '').toLowerCase().includes(sourceFilter)) return false;
    if (phoneFilter && normalizePhoneForApi(customer.phone) !== normalizePhoneForApi(phoneFilter)) return false;
    return true;
  });
  if (url.pathname === '/api/customer' && phoneFilter) {
    const exact = filtered.filter(customer => normalizePhoneForApi(customer.phone) === normalizePhoneForApi(phoneFilter));
    if (!exact.length) return sendJson(response, 404, { ok: false, error: 'Khong tim thay khach hang voi SDT nay' }, corsHeaders(request));
    if (exact.length > 1) return sendJson(response, 409, { ok: false, error: 'So dien thoai trung nhieu khach hang trong CRM' }, corsHeaders(request));
    return sendJson(response, 200, { ok: true, data: formatLeadPayload(exact[0], memberMap, ordersByCust, notesByCustomer) }, corsHeaders(request));
  }
  filtered.sort((a, b) => (parseCrmTimestamp(b.updatedAt || b.updated_at || b.createdAt || b.created_at) || 0) - (parseCrmTimestamp(a.updatedAt || a.updated_at || a.createdAt || a.created_at) || 0));
  const total = filtered.length, start = exportAll ? 0 : (page - 1) * limit, pageItems = exportAll ? filtered : filtered.slice(start, start + limit);
  const nextPageUrl = exportAll || start + limit >= total ? null : (() => { const params = new URLSearchParams({ page: String(page + 1), limit: String(limit) }); if (sinceRaw) params.set('since', sinceRaw); if (sourceFilter) params.set('source', sourceFilter); if(phoneFilter)params.set('phone',phoneFilter);return new URL('/api/leads/export?' + params.toString(), DEMO_MODE ? url.origin : 'https://nvtagency.top').toString(); })();
  return sendJson(response, 200, { data: pageItems.map(customer => formatLeadPayload(customer, memberMap, ordersByCust, notesByCustomer)), total, page: exportAll ? 1 : page, limit: exportAll ? total : limit, next_page_url: nextPageUrl }, corsHeaders(request));
}

/* ------------------------------------------------------------------ router */

const server = http.createServer(async (request, response) => {
  let url;
  try {
    const rawUrl = String(request.url || '/');
    const host = String(request.headers.host || 'localhost').replace(/[\r\n]/g, '').trim() || 'localhost';
    url = new URL(rawUrl, `http://${host}`);
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'URL không hợp lệ' }));
    console.warn('[http] Bỏ qua request có URL không hợp lệ:', error.code || error.message);
    return;
  }
  const pathname = url.pathname;
  // Mọi request ghi (webhook, đăng nhập, CRM) làm mới cache snapshot dùng chung để lượt
  // đồng bộ kế tiếp của người khác thấy dữ liệu mới, không phải chờ hết TTL.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) response.once('finish', () => crmData.invalidateSnapshotCache());

  try {
    const webhookMatch = pathname.match(WEBHOOK_PATH_PATTERN);
    if (webhookMatch) {
      await handleWebhook(request, response, decodeURIComponent(webhookMatch[1]));
      return;
    }
    if (pathname === '/api/data-sources/inbox') return await handleInbox(request, response, url);
    if (pathname === '/api/data-sources/stream') return await handleInboxStream(request, response);
    if (pathname === '/api/session-context') return await handleSessionContext(request, response);
    if (pathname === '/api/email/status') return await handleEmailStatus(request, response);
    if (pathname === '/api/email/notify') return await handleEmailNotify(request, response);
    if (pathname === '/api/telegram/webhook' || pathname === '/api/telegram/support-webhook') {
      if (request.method === 'POST') {
        const supportWebhook = pathname === '/api/telegram/support-webhook';
        const expectedSecret = supportWebhook ? TELEGRAM_SUPPORT_WEBHOOK_SECRET : TELEGRAM_WEBHOOK_SECRET;
        if (expectedSecret && request.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
          return sendJson(response, 401, { ok: false, error: 'Telegram webhook secret khong hop le.' });
        }
        try {
          const buffer = await readBody(request);
          const update = JSON.parse(buffer.toString('utf8') || '{}');
          // Trả 200 ngay: Telegram chờ tối đa vài giây rồi báo "Read timeout" và gửi lại
          // cùng update. Điểm danh và nhận data đều idempotent nên xử lý nền là an toàn.
          sendJson(response, 200, { ok: true });
          void telegramBot.handleTelegramUpdate(update, supportWebhook ? 'support' : 'system')
            .then(handled => { if (handled?.support?.matched && handled.support.requesterUserId) notifySupportListeners(handled.support); })
            .catch(err => console.warn('[Telegram Webhook] error:', err.code || err.message))
            // Điểm danh/nhận data chạy nền sau khi đã trả 200: làm mới cache khi xong thật.
            .finally(() => crmData.invalidateSnapshotCache());
          return;
        } catch (err) {
          console.warn('[Telegram Webhook] error:', err.message);
          return sendJson(response, 200, { ok: false, error: err.message });
        }
      }
      return sendJson(response, 405, { error: 'Chỉ chấp nhận POST' });
    }
    if (pathname === '/api/broadcast' && request.method === 'POST') {
      const user = DEMO_MODE ? demoUserFromToken(request) : await authUser(request);
      if (!user || user.role !== 'ADMIN') return sendJson(response, 403, { error: 'Chỉ Admin được gửi thông báo' }, corsHeaders(request));
      const body = await readDbBody(request);
      const sent = await telegramBot.sendBroadcastAnnouncement(body);
      if (!sent) {
        return sendJson(response, 503, {
          ok: false,
          error: 'Bot chưa gửi được thông báo. Kiểm tra tài khoản đã liên kết Telegram và trạng thái Bot.'
        }, corsHeaders(request));
      }
      return sendJson(response, 200, { ok: true, sent }, corsHeaders(request));
    }
    if (pathname === '/api/appointments' && request.method === 'GET') {
      const user = DEMO_MODE ? demoUserFromToken(request) : await authUser(request);
      if (!user) return sendJson(response, 401, { error: 'Chưa đăng nhập' }, corsHeaders(request));
      const customerId = url.searchParams.get('customerId') || '';
      if (!customerId) return sendJson(response, 400, { error: 'Thiếu customerId' }, corsHeaders(request));
      if (!dbConfigured) return sendJson(response, 200, { ok: true, appointments: [] }, corsHeaders(request));
      try {
        const rows = await dbQuery(
          `SELECT a.*, u.name AS sale_name
           FROM customer_appointments a
           LEFT JOIN users u ON a.sale_id = u.id
           WHERE a.customer_id = ?
           ORDER BY a.appointment_time ASC`,
          [customerId]
        );
        return sendJson(response, 200, { ok: true, appointments: rows }, corsHeaders(request));
      } catch (err) {
        return sendJson(response, 500, { error: err.message }, corsHeaders(request));
      }
    }
    if (pathname === '/api/appointments' && request.method === 'POST') {
      const user = DEMO_MODE ? demoUserFromToken(request) : await authUser(request);
      if (!user) return sendJson(response, 401, { error: 'Chưa đăng nhập' }, corsHeaders(request));
      const body = await readDbBody(request);
      const { customerId, saleId, appointmentTime, type, note } = body;
      if (!customerId || !appointmentTime) return sendJson(response, 400, { error: 'Thiếu thông tin lịch hẹn' }, corsHeaders(request));
      const id = `APP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const targetSaleId = saleId || user.id;
      try {
        await dbQuery(
          `INSERT INTO customer_appointments (id, customer_id, sale_id, appointment_time, type, note, status)
           VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED')`,
          [id, customerId, targetSaleId, appointmentTime, type || 'CONSULTING', note || '']
        );
        return sendJson(response, 201, { ok: true, id }, corsHeaders(request));
      } catch (err) {
        return sendJson(response, 500, { error: err.message }, corsHeaders(request));
      }
    }
    if (pathname.startsWith('/api/appointments/') && (request.method === 'PUT' || request.method === 'DELETE')) {
      const user = DEMO_MODE ? demoUserFromToken(request) : await authUser(request);
      if (!user) return sendJson(response, 401, { error: 'Chưa đăng nhập' }, corsHeaders(request));
      const id = pathname.slice('/api/appointments/'.length);
      if (request.method === 'DELETE') {
        await dbQuery('DELETE FROM customer_appointments WHERE id = ?', [id]);
        return sendJson(response, 200, { ok: true }, corsHeaders(request));
      }
      const body = await readDbBody(request);
      const status = body.status || 'SCHEDULED';
      await dbQuery('UPDATE customer_appointments SET status = ?, note = COALESCE(?, note) WHERE id = ?', [status, body.note || null, id]);
      return sendJson(response, 200, { ok: true }, corsHeaders(request));
    }
    if (pathname === '/api/leads/push') return await handleLeadsPushApi(request, response, url);
    if (pathname === '/api/leads/export' || pathname === '/api/leads/export-all' || pathname === '/api/customer') return await handleLeadsExportApi(request, response, url);
    if (pathname === '/api/marketing/staff-ranking' || pathname === '/api/marketing/customer-analysis') return await handleMarketingAnalysisApi(request, response, url);
    if (pathname === '/api/db/health' || pathname === '/api/navigation-counts' || pathname === '/api/user-activity' || pathname === '/api/admin/user-activity' || pathname.startsWith('/api/admin/blacklist') || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/telegram/') || pathname.startsWith('/api/support/') || pathname.startsWith('/api/users') || pathname.startsWith('/api/customers') || pathname.startsWith('/api/orders') || pathname.startsWith('/api/products') || pathname.startsWith('/api/settings') || pathname === '/api/state' || pathname === '/api/state/version' || pathname === '/api/audit' || pathname === '/api/google-sheets/backup' || pathname === '/api/pnl' || pathname.startsWith('/api/pnl/') || pathname.startsWith('/api/process-image/') || pathname.startsWith('/api/feedback-image/') || pathname.startsWith('/api/order-receipt-image/') || pathname.startsWith('/api/bank-statement-file/')) return await handleDbApi(request, response, pathname);
    if (pathname === '/api/health/live') {
      return sendJson(response, 200, { ok: true, live: true, telegramWorker: telegramWorker?.status() || (inlineTelegramScheduler ? 'inline' : 'disabled'), webhookStorage: { ready: true, fallback: webhookStorage.fallback || inboxStorage.fallback }, webhooks: webhookHealthSummary(), instance: SERVER_INSTANCE, build: BUILD_VERSION, authPool: authPool.stats(), password: passwordService.stats() });
    }
    if (pathname === '/api/health') {
      if (DEMO_MODE) return sendJson(response, 200, { ok: true, demo: true, inbox: inbox.length, token: Boolean(WEBHOOK_TOKEN) });
      if (!dbConfigured) return sendJson(response, 503, { ok: false, mysql: 'not_configured', error: 'MySQL chưa được cấu hình.' });
      try {
        await dbHealth();
        return sendJson(response, 200, { ok: true, mysql: 'ready', inbox: inbox.length, webhooks: webhookHealthSummary(), token: Boolean(WEBHOOK_TOKEN), build: BUILD_VERSION, authPool: authPool.stats(), password: passwordService.stats() });
      } catch (error) {
        return sendJson(response, 503, { ok: false, mysql: 'unavailable', code: error.code || 'DB_ERROR', error: 'Node đang chạy nhưng chưa kết nối được MySQL.' });
      }
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Không có endpoint này' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Chỉ chấp nhận GET' }, { Allow: 'GET, HEAD' });
      return;
    }
    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error('[server] lỗi:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Lỗi server' });
  }
});

// Keep proxy/Passenger requests finite even if a downstream dependency stops responding.
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT || 15000);
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT || 20000);
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT || 5000);

loadInbox();
// Khôi phục inbox cũ theo ID ổn định; không xóa file gốc sau khi nhập.
let webhookRecoveryRunning = false;
let webhookRecoveryCursor = 0;
async function recoverLegacyInbox() {
  if (webhookRecoveryRunning) return;
  webhookRecoveryRunning = true;
  let recovered = 0;
  try {
    // Only this incident's date is eligible for historical backfill.
    const legacy = inbox.filter(record => !record.persisted && String(record.receivedAt || '').slice(0,10) === WEBHOOK_RECOVERY_DATE);
    const pending = await webhookJournal.list();
    const records = new Map();
    for (const record of [...legacy, ...pending]) {
      if (!record.dedupeKey || !record.customer) continue;
      if (!records.has(record.dedupeKey)) records.set(record.dedupeKey, []);
      records.get(record.dedupeKey).push(record);
    }
    const groups = [...records.values()];
    const start = groups.length ? webhookRecoveryCursor % groups.length : 0;
    const batch = [...groups.slice(start), ...groups.slice(0,start)].slice(0,100);
    webhookRecoveryCursor = groups.length ? (start + batch.length) % groups.length : 0;
    for (const copies of batch) {
      const record = copies[0];
      try {
        const website = await notificationWebsiteForSlug(record.slug);
        // Notification-only webhooks must never become customer records.
        if (website?.provider === 'NOTIFICATION') continue;
        const saved = await persistWebhook(record, { skipAutomatic: true, assignRecovered: true });
        // SQL success must be reflected in CRM even if filesystem cleanup fails.
        recovered++;
        for (const copy of copies) {
          Object.assign(copy,{customerId:saved.customerId,source:saved.source || null,persisted:true,...(saved.blacklisted ? {status:'BLACKLISTED'} : {})});
          await webhookJournal.remove(copy).catch(error => console.warn('[webhook-recovery-cleanup]',copy.id,error.code || 'CLEANUP_FAILED'));
        }
      } catch (error) { console.warn('[webhook-recovery]',record.id,error.code || 'RECOVERY_FAILED'); }
    }
  } finally {
    webhookRecoveryRunning = false;
    wakeTelegramOutbox();
    if (recovered) {
      crmData.invalidateSnapshotCache();
      scheduleFlush();
      console.log('[webhook-recovery] Recovered:', recovered);
    }
  }
}
const systemSchemaReady = (async () => {
  if (!dbConfigured) return false;
  await crmData.prepare();
  return true;
})().catch(error => { console.error('[mysql] Không chuẩn bị được schema:', error.message); return false; });
const systemAccountsReady = systemSchemaReady.then(async ready => {
  if (!ready) return false;
  const result = await provisionSystemAccounts(pool);
  if (result.applied) console.log('[mysql] Đã cấu hình Admin, Marketing, Kế toán theo yêu cầu.');
  return true;
}).catch(error => { console.error('[mysql] Không khởi tạo được tài khoản hệ thống:', error.message); return false; });
// Optional subsystems must not hold up authentication readiness.
void systemAccountsReady.then(ready => {
  if (!ready || DEMO_MODE) return;
  void supportChat.prepare().catch(error => console.error('[support-init]', error.code || 'INIT_ERROR'));
});
// Keep retrying even if MySQL was unavailable during initial schema/account setup.
if (dbConfigured && !DEMO_MODE) {
  const recover = () => void recoverLegacyInbox().catch(error => console.error('[webhook-recovery]', error.code || 'RECOVERY_ERROR'));
  void systemSchemaReady.then(recover);
  const recoveryTimer = setInterval(recover, 60000);
  recoveryTimer.unref();
  server.once('close', () => clearInterval(recoveryTimer));
}
server.listen(PORT, HOST, () => {
  const lan = HOST === '0.0.0.0' ? ' (mọi interface — máy khác trong LAN vào được)' : '';
  console.log(`\nCRM webhook server chạy tại http://localhost:${PORT}${lan}`);
  console.log(`Repo root : ${REPO_ROOT}`);
  console.log(`Inbox file: ${INBOX_FILE} (${inbox.length} bản ghi sẵn có)`);
  console.log(`Token     : ${WEBHOOK_TOKEN ? 'BẬT (WEBHOOK_TOKEN)' : 'TẮT — ai cũng POST được'}`);
  console.log('\nEndpoint nhận data landing page:');
  console.log(`  POST http://localhost:${PORT}/api/data-sources/webhook/ds-<13 số>-<11 ký tự>/`);
  console.log('  Chấp nhận: application/json, x-www-form-urlencoded, multipart/form-data');
  console.log('\nTest nhanh:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/data-sources/webhook/ds-1789180581447-IIM6U3AAD1R/ \\`);
  console.log(`       -H "Content-Type: application/json" \\`);
  console.log(`       -d '{"Họ và tên":"Nguyễn Test","Số điện thoại":"0912345678","Email":"test@gmail.com"}'\n`);
  selfCheckHealth();
  if(dbConfigured&&!DEMO_MODE){
    void systemAccountsReady.then(ready=>{
      if(!ready)return;
      if(inlineTelegramScheduler){
        console.warn('[Telegram] Đang dùng scheduler trong web do RUN_TELEGRAM_SCHEDULER=1.');
        const stop=require('./telegram-worker.cjs').createTelegramLoop(telegramBot);
        server.once('close',stop);
      }else if(process.env.RUN_TELEGRAM_WORKER!=='0'){
        telegramWorker=require('./telegram-worker-supervisor.cjs').startTelegramWorker();
        server.once('close',()=>telegramWorker.stop());
        process.once('exit',()=>telegramWorker.stop());
      }else console.warn('[Telegram] Worker tự động đã tắt; cần chạy telegram-worker.cjs riêng.');
    }).catch(error=>console.warn('[telegram-start]',error.code||error.message));
  }
  if (!DEMO_MODE && TELEGRAM_WEBHOOK_URL) {
    void telegramBot.setWebhook(TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET)
      .then(result => console.log(`[Telegram Bot] Webhook ${result?.ok ? 'da dong bo' : 'chua dong bo'}: ${TELEGRAM_WEBHOOK_URL}`));
  }
  if (!DEMO_MODE && process.env.TELEGRAM_SUPPORT_BOT_TOKEN && TELEGRAM_SUPPORT_WEBHOOK_URL) {
    void telegramBot.setSupportWebhook(TELEGRAM_SUPPORT_WEBHOOK_URL, TELEGRAM_SUPPORT_WEBHOOK_SECRET)
      .then(result => console.log(`[Telegram support bot] Webhook ${result?.ok ? 'da dong bo' : 'chua dong bo'}: ${TELEGRAM_SUPPORT_WEBHOOK_URL}`));
  }
});

// Check process liveness independently of MySQL readiness. Passenger may use
// a Unix socket instead of the configured TCP port; do not probe another port.
async function selfCheckHealth() {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address;
  const url = 'http://' + (net.isIP(host) === 6 ? '[' + host + ']' : host) + ':' + address.port + '/api/health/live';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || payload.instance !== SERVER_INSTANCE) {
      console.warn('[webhook] Kiểm tra liveness nhận phản hồi không khớp tiến trình CRM. HTTP ' + response.status);
    }
  } catch (error) {
    console.warn('[webhook] Không tự kiểm tra được liveness (' + (error.cause?.code || error.name) + '). Chưa đủ bằng chứng kết luận xung đột cổng; kiểm tra proxy và địa chỉ lắng nghe.');
  } finally {
    clearTimeout(timer);
  }
}
