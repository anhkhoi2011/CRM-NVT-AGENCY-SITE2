'use strict';

/**
 * Module: telegram-bot.cjs
 * Hệ thống Bot Telegram NVT Agency (@HotroTinNhanCRM_bot)
 * Xử lý: Liên kết tài khoản, thông báo data mới realtime, nhận data 1 chạm,
 * nhắc lịch hẹn khách hàng, cảnh báo data nóng 12h, nhắc điểm danh 09h00.
 */

const { pool, telegramPool, dbQuery } = require('./db.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const supportChat = require('./support-chat.cjs');

// The system bot owns account linking, data, attendance and agency notices.
// The support bot is intentionally isolated to the internal CRM support inbox.
const SYSTEM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const SUPPORT_BOT_TOKEN = (process.env.TELEGRAM_SUPPORT_BOT_TOKEN || SYSTEM_BOT_TOKEN).trim();
const SYSTEM_ADMIN_CHAT_ID = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
const SUPPORT_ADMIN_CHAT_ID = (process.env.TELEGRAM_SUPPORT_ADMIN_CHAT_ID || SYSTEM_ADMIN_CHAT_ID).trim();
const BOT_TOKEN = SYSTEM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function botConfig(kind = 'system') {
  const token = kind === 'support' ? SUPPORT_BOT_TOKEN : SYSTEM_BOT_TOKEN;
  return { token, api: `https://api.telegram.org/bot${token}` };
}

// ==================== CÁC HÀM GỌI TELEGRAM BOT API ====================

async function callTelegram(method, body = {}, kind = 'system') {
  const { token, api } = botConfig(kind);
  if (!token) return { ok: false, error: kind === 'support' ? 'TELEGRAM_SUPPORT_BOT_TOKEN is not configured' : 'TELEGRAM_BOT_TOKEN is not configured' };
  try {
    const res = await fetch(`${api}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`[Telegram Bot] API call ${method} warning:`, data.description || data);
    }
    return data;
  } catch (err) {
    console.error(`[Telegram Bot] Fetch error on ${method}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function callTelegramForm(method, form, kind = 'system') {
  const { token, api } = botConfig(kind);
  if (!token) return { ok: false, error: kind === 'support' ? 'TELEGRAM_SUPPORT_BOT_TOKEN is not configured' : 'TELEGRAM_BOT_TOKEN is not configured' };
  try {
    const res = await fetch(`${api}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!data.ok) console.warn(`[Telegram Bot] API call ${method} warning:`, data.description || data);
    return data;
  } catch (err) {
    console.error(`[Telegram Bot] Fetch error on ${method}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendMessage(chatId, text, options = {}) {
  if (!chatId) return null;
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode || 'HTML',
    reply_markup: options.reply_markup || undefined,
    disable_web_page_preview: options.disable_web_page_preview !== false
  }, options.bot || 'system');
}

async function sendPhoto(chatId, filePath, caption, options = {}) {
  if (!chatId || !filePath) return null;
  try {
    const image = await fs.readFile(filePath);
    const mime = options.mime || ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new Blob([image], { type: mime }), path.basename(filePath));
    form.set('caption', String(caption || '').slice(0, 1024));
    form.set('parse_mode', options.parse_mode || 'HTML');
    if (options.reply_markup) form.set('reply_markup', JSON.stringify(options.reply_markup));
    return callTelegramForm('sendPhoto', form, options.bot || 'system');
  } catch (error) {
    console.error('[Telegram Bot] Không đọc được ảnh hỗ trợ:', error.message);
    return { ok: false, error: error.message };
  }
}

async function editMessageText(chatId, messageId, text, options = {}) {
  if (!chatId || !messageId) return null;
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parse_mode || 'HTML',
    reply_markup: options.reply_markup || undefined,
    disable_web_page_preview: options.disable_web_page_preview !== false
  }, options.bot || 'system');
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  if (!callbackQueryId) return null;
  return callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  }, 'system');
}

async function setWebhook(webhookUrl, secretToken = '', bot = 'system') {
  // Telegram giữ allowed_updates cũ nếu không gửi lại. Bot hệ thống bắt buộc nhận
  // callback_query, nếu không nút "ĐIỂM DANH"/"Nhận data" sẽ không bao giờ tới server.
  // max_connections nhỏ để webhook không chiếm hết slot kết nối của hosting.
  const body = {
    url: webhookUrl,
    allowed_updates: bot === 'support' ? ['message'] : ['message', 'callback_query'],
    max_connections: 5
  };
  if (secretToken) body.secret_token = secretToken;
  const res = await callTelegram('setWebhook', body, bot);
  console.log(`[Telegram ${bot} Bot] Webhook setup result:`, res);
  return res;
}

async function setSupportWebhook(webhookUrl, secretToken = '') {
  if (SUPPORT_BOT_TOKEN === SYSTEM_BOT_TOKEN) return {ok:true,skipped:true,reason:'System webhook owns the shared bot token'};
  return setWebhook(webhookUrl, secretToken, 'support');
}

// ==================== TIỆN ÍCH ĐỊNH DẠNG ====================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatVND(amount) {
  return Number(amount || 0).toLocaleString('vi-VN') + ' ₫';
}

function formatDateTimeVN(dt) {
  if (!dt) return '';
  try {
    const localStamp=typeof dt==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(dt);
    const d = new Date(localStamp?dt.replace(' ','T')+'+07:00':dt);
    if (isNaN(d.getTime())) return String(dt);
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  } catch {
    return String(dt);
  }
}

// ==================== XỬ LÝ INCOMING WEBHOOK (UPDATES) ====================

async function handleTelegramUpdate(update, bot = 'system') {
  if (!update || typeof update !== 'object') return { ok: true };

  if (bot === 'support' && !(SUPPORT_BOT_TOKEN === SYSTEM_BOT_TOKEN && update.callback_query)) return handleSupportTelegramUpdate(update);

  // 1. Xử lý Message từ người dùng
  if (update.message) {
    return { ok: true, support: await handleIncomingMessage(update.message) };
  }
  // 2. Xử lý Callback Query từ nút bấm Inline Keyboard
  else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }

  return { ok: true };
}

async function handleSupportTelegramUpdate(update) {
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!msg || !chatId || String(chatId) !== SUPPORT_ADMIN_CHAT_ID || !msg.reply_to_message?.message_id) {
    return { ok: true, support: { matched: false } };
  }
  const rawText = String(msg.text || '').trim();
  const supportReply = await supportChat.createTelegramAdminReply(chatId, msg.reply_to_message.message_id, rawText);
  return { ok: true, support: supportReply };
}

async function marketingCommandResponse(chatId, command) {
  const linked = await dbQuery('SELECT id, name, role FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1', [String(chatId)]);
  if (!linked?.length) { await sendMessage(chatId, '⚠️ Bạn chưa liên kết tài khoản CRM. Gõ /start để liên kết.'); return true; }
  const user = linked[0];
  if (!['MARKETING', 'ADMIN'].includes(String(user.role || '').toUpperCase())) { await sendMessage(chatId, '🔒 Lệnh này chỉ dành cho tài khoản Marketing.'); return true; }
  const crmData = require('./crm-data.cjs');
  const snapshot = await crmData.read({ id: user.id, role: 'ADMIN', active: true }, { passive: true, full: true });
  const MarketingHub = require('./marketing-hub.js');
  const analysis = MarketingHub.analyzeData(snapshot.state || {});
  const insight = analysis.aiInsight;
  let text;
  if (command === '/chandung') text = '👤 <b>Chân dung khách hàng CRM</b>\n\n' + escapeHtml(insight.summaryHeadline) + '\nChưa gọi: ' + analysis.uncalledData + ' · Chưa rõ: ' + analysis.unknownData + ' · Trùng loại thống kê: ' + analysis.excludedData + '\n\n' + escapeHtml(insight.personaInsight);
  if (command === '/content') text = '🎯 <b>Content hiệu quả từ CRM</b>\n\n' + escapeHtml(insight.contentInsight);
  if (command === '/insight') text = '💡 <b>Insight tự động từ dữ liệu CRM</b>\n\n' + [insight.summaryHeadline, insight.personaInsight, insight.contentInsight, insight.objectionInsight].map(escapeHtml).join('\n\n');
  if (text) { await sendMessage(chatId,text); return true; }
  return false;
}

async function pnlCommandResponse(chatId, rawText) {
  const rows = await dbQuery('SELECT * FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1', [String(chatId)]);
  if (!rows?.length) { await sendMessage(chatId, '⚠️ Tài khoản Telegram chưa được liên kết với CRM.'); return true; }
  const user = { ...rows[0], teamId: rows[0].team_id || '', leaderId: rows[0].leader_id || null, managerId: rows[0].manager_id || null };
  if (!['ADMIN', 'MANAGER', 'LEADER', 'SALE'].includes(String(user.role).toUpperCase())) { await sendMessage(chatId, '🔒 Tài khoản của bạn chưa được cấp quyền quản lý lãi lỗ.'); return true; }
  const pnl = require('./pnl-management.cjs');
  const [command, ...parts] = String(rawText).trim().split(/\s+/);
  try {
    if (command.toLowerCase() === '/taokhach') {
      if (parts.length < 5) throw Error('Cú pháp: /taokhach <ID_KHÁCH> <TK_CQG> <SỐ_LOT> <VỐN> <TÊN_KHÁCH>');
      const customer = await pnl.createCustomer(user, { customerCode: parts[0], cqgAccount: parts[1], defaultLot: parts[2], initialCapital: parts[3], customerName: parts.slice(4).join(' ') });
      await sendMessage(chatId, `✅ <b>ĐÃ TẠO KHÁCH PNL</b>\nID: <code>${escapeHtml(customer.customerCode)}</code>\nCQG: <code>${escapeHtml(customer.cqgAccount)}</code>\nTên: <b>${escapeHtml(customer.customerName)}</b>\nVốn: <b>${formatVND(customer.initialCapital)}</b>`);
      return true;
    }
    if (command.toLowerCase() === '/lailo') {
      if (parts.length < 2) throw Error('Cú pháp: /lailo <ID_KHÁCH|CQG> <LÃI_LỖ> [SỐ_LOT] [GHI_CHÚ]');
      const list = await pnl.list(user, { search: parts[0] });
      const customer = list.customers.find(row => row.customer_code === parts[0] || row.cqg_account === parts[0]);
      if (!customer) throw Error('Không tìm thấy khách hàng hoặc bạn không có quyền với khách này.');
      const result = await pnl.upsertLog(user, { customerId: customer.id, pnlAmount: parts[1], lotVolume: parts[2] || customer.default_lot, notes: parts.slice(3).join(' '), source: 'telegram' });
      const sign = Number(result.pnlAmount) > 0 ? '+' : '';
      await sendMessage(chatId, `✅ <b>CẬP NHẬT LÃI/LỖ THÀNH CÔNG</b>\n👤 ${escapeHtml(customer.customer_code)} · ${escapeHtml(customer.customer_name)}\n📊 Lot: <b>${Number(result.lotVolume).toLocaleString('vi-VN')}</b>\n💰 Hôm nay: <b>${sign}${formatVND(result.pnlAmount)}</b>\n🏦 Vốn hiện tại: <b>${formatVND(result.customer.current_capital)}</b>${result.riskAlert ? '\n⚠️ <b>CẢNH BÁO LỖ VƯỢT NGƯỠNG 20% VỐN</b>' : ''}`);
      return true;
    }
    if (command.toLowerCase() === '/xemlailo') {
      const result = await pnl.list(user, parts[0] ? { search: parts[0] } : {});
      const rowsText = result.customers.slice(0, 20).map(row => `• <b>${escapeHtml(row.customer_code)}</b> · hôm nay ${formatVND(row.today_pnl)} · tuần ${formatVND(row.week_pnl)} · vốn ${formatVND(row.current_capital)}`).join('\n');
      await sendMessage(chatId, `📊 <b>TỔNG HỢP LÃI/LỖ</b> (${result.weekStart} → ${result.weekEnd})\n${rowsText || 'Chưa có dữ liệu.'}`);
      return true;
    }
  } catch (error) { await sendMessage(chatId, `⚠️ ${escapeHtml(error.message || 'Không xử lý được lệnh PnL.')}`); return true; }
  return false;
}

async function handleIncomingMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  const rawText = String(msg.text || '').trim();
  const fromUsername = msg.from?.username || '';

  // Admin trả lời trực tiếp vào thông báo hỗ trợ: Telegram gửi lại message_id
  // gốc, nhờ đó phản hồi luôn quay đúng hội thoại của nhân viên.
  // Backward compatibility for deployments that have not configured the
  // dedicated support token yet. Once TELEGRAM_SUPPORT_BOT_TOKEN is set,
  // support replies are accepted only through the support bot webhook.
  if (!process.env.TELEGRAM_SUPPORT_BOT_TOKEN && SUPPORT_ADMIN_CHAT_ID && String(chatId) === SUPPORT_ADMIN_CHAT_ID && msg.reply_to_message?.message_id) {
    const supportReply = await supportChat.createTelegramAdminReply(chatId, msg.reply_to_message.message_id, rawText);
    if (supportReply.matched) return supportReply;
  }

  // Lệnh /start
  if (rawText.startsWith('/start')) {
    const linkCode = rawText.split(/\s+/, 2)[1] || '';
    if (msg.chat?.type && msg.chat.type !== 'private') {
      await sendMessage(chatId, 'Liên kết tài khoản chỉ được phép trong cuộc trò chuyện riêng với bot.');
      return;
    }
    if (!linkCode) {
      await sendMessage(chatId, '🤖 Để bảo mật, hãy đăng nhập CRM → Hồ sơ cá nhân → Liên kết Telegram để tạo mã kết nối. Bot không liên kết bằng số điện thoại, email hoặc ID tài khoản.');
      return;
    }
    try {
      const connection = await pool.getConnection();
      let linkedUser;
      try {
        await connection.beginTransaction();
        const [tokens] = await connection.execute(
          'SELECT user_id FROM telegram_link_tokens WHERE token_hash = ? AND expires_at > NOW() AND consumed_at IS NULL LIMIT 1 FOR UPDATE',
          [require('node:crypto').createHash('sha256').update(linkCode).digest('hex')]
        );
        if (!tokens.length) throw new Error('Mã liên kết không hợp lệ hoặc đã hết hạn. Hãy tạo mã mới trong Hồ sơ cá nhân.');
        const [users] = await connection.execute('SELECT id, name, role, telegram_chat_id FROM users WHERE id = ? AND active = 1 LIMIT 1 FOR UPDATE', [tokens[0].user_id]);
        if (!users.length) throw new Error('Tài khoản CRM không còn hoạt động.');
        if (users[0].telegram_chat_id) throw new Error('Tài khoản này đang liên kết Telegram. Hãy hủy liên kết trong Hồ sơ cá nhân trước khi đổi.');
        const [chatOwners] = await connection.execute('SELECT id FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1 FOR UPDATE', [String(chatId)]);
        if (chatOwners.length) throw new Error('Telegram này đã liên kết với một tài khoản CRM khác.');
        const [claimed] = await connection.execute('UPDATE users SET telegram_chat_id = ?, telegram_username = ? WHERE id = ? AND telegram_chat_id IS NULL', [String(chatId), fromUsername || null, users[0].id]);
        if (claimed.affectedRows !== 1) throw new Error('Tài khoản vừa được liên kết ở nơi khác.');
        await connection.execute('UPDATE telegram_link_tokens SET consumed_at = NOW() WHERE token_hash = ?', [require('node:crypto').createHash('sha256').update(linkCode).digest('hex')]);
        linkedUser = users[0];
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally { connection.release(); }
      await sendMessage(chatId, `✅ Đã liên kết Telegram với hồ sơ CRM của <b>${escapeHtml(linkedUser.name)}</b> (${escapeHtml(linkedUser.role)}).`);
    } catch (error) {
      await sendMessage(chatId, `⚠️ ${escapeHtml(error.message || 'Không liên kết được. Hãy thử tạo mã mới trong CRM.')}`);
    }
    return;
  }

  // Lệnh /me
  // Lệnh Marketing chỉ chạy sau khi đã xác thực tài khoản Telegram.
  if (['/chandung', '/content', '/insight'].includes(rawText)) {
    try { await marketingCommandResponse(chatId, rawText); } catch (error) { await sendMessage(chatId, '⚠️ Không tạo được báo cáo Marketing: ' + escapeHtml(error.message || 'CRM đang bận.')); }
    return;
  }

  if (/^\/(lailo|taokhach|xemlailo)(?:\s|$)/i.test(rawText)) {
    await pnlCommandResponse(chatId, rawText);
    return;
  }

  if (rawText === '/me') {
    const rows = await dbQuery('SELECT id, name, role, team_id FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1', [String(chatId)]);
    if (!rows || rows.length === 0) {
      await sendMessage(chatId, `⚠️ Bạn chưa liên kết tài khoản. Hãy tạo mã trong CRM → Hồ sơ cá nhân.`);
      return;
    }
    const u = rows[0];
    const text = `👤 <b>THÔNG TIN TÀI KHOẢN LIÊN KẾT:</b>\n\n` +
      `• <b>Họ tên:</b> ${escapeHtml(u.name)}\n` +
      `• <b>Chức vụ:</b> <code>${escapeHtml(u.role)}</code>\n` +
      `• <b>Team:</b> ${escapeHtml(u.team_id || '—')}\n` +
      `\n<i>Muốn đổi tài khoản Telegram, hãy hủy liên kết tại CRM → Hồ sơ cá nhân.</i>`;
    await sendMessage(chatId, text);
    return;
  }

  // Lệnh /huylienket
  if (rawText === '/huylienket') {
    await sendMessage(chatId, `🔒 Để bảo vệ tài khoản, bot không thể tự hủy liên kết. Vui lòng đăng nhập CRM → Hồ sơ cá nhân để thực hiện.`);
    return;
  }

  // Lệnh /help
  if (rawText === '/help') {
    const helpText = `📖 <b>HƯỚNG DẪN SỬ DỤNG BOT CRM NVT AGENCY:</b>\n\n` +
      `1. <b>Nhận Data nóng:</b> Khi có khách hàng điền form, bot sẽ gửi thông báo và nút <i>[📥 BẤM NHẬN DATA & XỬ LÝ]</i>. Bấm 1 chạm để nhận và hiện SĐT liên hệ ngay.\n` +
      `2. <b>Điểm danh:</b> Đúng 09:00 hàng ngày, bot gửi tin nhắn kèm nút điểm danh nhanh.\n` +
      `3. <b>Nhắc lịch hẹn:</b> Tự động nhắc trước 15-30 phút khi đến lịch hẹn chốt cọc / tư vấn 1-1.\n` +
      `4. <b>Cảnh báo Data nóng:</b> Nhắc nhở nếu data nhận quá 12h chưa được chăm sóc.\n\n` +
      `<b>Các lệnh quản lý:</b>\n` +
      `• /start - Bắt đầu / Liên kết tài khoản\n` +
      `• /me - Xem thông tin tài khoản đang liên kết\n` +
      `• /huylienket - Hủy liên kết để đăng nhập máy mới\n` +
      `• /help - Xem hướng dẫn này`;
    await sendMessage(chatId, helpText + '\n\n<b>Lệnh Marketing:</b> /chandung · /content · /insight');
    return;
  }

  await sendMessage(chatId, 'Để liên kết an toàn, hãy tạo mã dùng một lần trong CRM → Hồ sơ cá nhân rồi mở liên kết bot từ đó.');
}

// ==================== XỬ LÝ NÚT BẤM INLINE (CALLBACK QUERIES) ====================

// Lỗi tạm thời của MySQL (đợi khóa khi nhiều người cùng lưu): tự thử lại thay vì bắt người dùng bấm lại.
const TRANSIENT_DB_ERRORS = new Set(['ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'DB_QUERY_TIMEOUT', 'DB_ACQUIRE_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET']);
async function retryTransient(task, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await task(); }
    catch (error) {
      if (attempt >= attempts || !TRANSIENT_DB_ERRORS.has(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    }
  }
}
function friendlyError(error, fallback) {
  return error?.code ? fallback : (error?.message || fallback);
}

async function acceptDataFromTelegram(chatId, callbackData) {
  const userRows = await dbQuery('SELECT * FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1', [String(chatId)]);
  if (!userRows?.length) throw new Error('Tài khoản Telegram này chưa liên kết CRM. Gõ /start để liên kết.');
  const user = userRows[0];
  if (String(user.role || '').toUpperCase() !== 'SALE') throw new Error('Chức năng nhận data chỉ dành cho Sale được phân công.');

  let customerId,requestedOfferId='';
  if(String(callbackData).startsWith('accept_offer:')){
    requestedOfferId=String(callbackData).slice('accept_offer:'.length);
    const docs=await dbQuery("SELECT body FROM crm_documents WHERE collection='dataOffers' AND id=? AND deleted=0",[requestedOfferId]);
    const requested=docs[0]?(typeof docs[0].body==='string'?JSON.parse(docs[0].body):docs[0].body):null;
    if(!requested||requested.saleId!==user.id)throw Error('Lượt phân không còn dành cho bạn.');
    customerId=requested.customerId;
  }else{
    [customerId,requestedOfferId='']=String(callbackData||'').slice('accept_data:'.length).split(':',2);
  }
  if (!customerId) throw new Error('Nút nhận data không hợp lệ. Vui lòng mở thông báo mới nhất.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const [customerRows] = await connection.execute('SELECT * FROM customers WHERE id = ? LIMIT 1 FOR UPDATE', [customerId]);
    if (!customerRows?.length) throw new Error('Khách hàng không còn tồn tại.');
    const customer = customerRows[0];

    // Nút mới mang sẵn mã lượt phân: đọc theo khóa chính để giữ khóa ghi chung thật ngắn.
    const [offerRows] = requestedOfferId
      ? await connection.execute("SELECT id, body FROM crm_documents WHERE collection='dataOffers' AND id=? AND (deleted=0 OR deleted IS NULL) FOR UPDATE", [requestedOfferId])
      : await connection.execute(
      `SELECT id, body FROM crm_documents
       WHERE collection = 'dataOffers' AND (deleted = 0 OR deleted IS NULL)
         AND JSON_UNQUOTE(JSON_EXTRACT(body, '$.customerId')) = ?
       FOR UPDATE`,
      [customerId]
    );
    const offers = offerRows.map(row => {
      try { return { id: row.id, body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body }; }
      catch { return null; }
    }).filter(Boolean);
    const offer = offers.find(item =>
      (!requestedOfferId || item.id === requestedOfferId || item.body?.id === requestedOfferId)
      && (!item.body?.customerId || item.body.customerId === customerId)
      && item.body?.status === 'PENDING'
      && item.body?.saleId === user.id
    );

    const customerFields = typeof customer.custom_fields_json === 'string' ? JSON.parse(customer.custom_fields_json || '{}') : (customer.custom_fields_json || {});
    const customerMeta = customerFields.__crmMeta || {};
    if (!offer) {
      // Bấm lại (hoặc Telegram gửi lại cùng callback) sau khi đã nhận: coi là thành công và hiện lại SĐT.
      if (customer.sale_id === user.id && customerMeta.saleAcceptedAt) {
        await connection.commit();
        return { customer, user, nowStamp: customerMeta.saleAcceptedAt, already: true };
      }
      if (customer.sale_id && customer.sale_id !== user.id) throw new Error('Data này đã được Sale khác nhận.');
      throw new Error('Data này không còn chờ bạn nhận hoặc đã hết hạn.');
    }

    const offeredMs=Date.parse(String(offer.body.offeredAt||'').replace(' ','T')+'+07:00');
    if(!Number.isFinite(offeredMs)||Date.now()-offeredMs>=86400000)throw Error('Lượt nhận data đã hết hạn.');
    const nowStamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 19);
    const [updated] = await connection.execute(
      `UPDATE customers
       SET sale_id = ?, leader_id = COALESCE(leader_id, ?), team_id = COALESCE(team_id, ?), updated_at = ?
       WHERE id = ? AND (sale_id IS NULL OR sale_id = ?)`,
      [user.id, offer.body.leaderId || null, user.team_id || offer.body.teamId || '', nowStamp, customerId, user.id]
    );
    if (updated.affectedRows !== 1) throw new Error('Data này vừa được người khác nhận.');

    const acceptedOffer = { ...offer.body, status: 'ACCEPTED', saleId: user.id, resolvedAt: nowStamp };
    await connection.execute(
      `UPDATE crm_documents SET body = ? WHERE collection = 'dataOffers' AND id = ?`,
      [JSON.stringify(acceptedOffer), offer.id]
    );
    const fields=customerFields;
    fields.__crmMeta={...(fields.__crmMeta||{}),saleId:user.id,saleAcceptedAt:nowStamp,updatedAt:nowStamp};
    await connection.execute('UPDATE customers SET custom_fields_json=? WHERE id=?',[JSON.stringify(fields),customerId]);
    // Tăng phiên bản /api/state/version để màn hình CRM của mọi người tải lại sau vài giây.
    await connection.execute('INSERT IGNORE INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',
      ['tg-accept-' + offer.id, user.id, JSON.stringify([{ key: 'dataOffers', id: offer.id, before: offer.body, after: acceptedOffer }])]);
    await connection.commit();
    console.info('[Telegram Bot] Data accepted:', customerId, 'by', user.id);
    return { customer, user, nowStamp };
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}

async function handleCallbackQuery(query) {
  const queryId = query.id;
  const data = String(query.data || '');
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;

  if (!data.startsWith('accept_data:')&&!data.startsWith('accept_offer:')) return handleCallbackQueryLegacy(query);
  if (!chatId || !messageId) {
    await answerCallbackQuery(queryId);
    return;
  }

  // Tắt vòng xoay ngay; không để mạng Telegram chậm chặn giao dịch SQL.
  void answerCallbackQuery(queryId, 'Đang nhận data...');
  try {
    if(query.message?.chat?.type!=='private'||String(query.from?.id)!==String(chatId))throw Error('Chỉ nhận data trong cuộc trò chuyện riêng đã liên kết với bot.');
    const { customer, user, nowStamp, already } = await retryTransient(() => acceptDataFromTelegram(chatId, data));
    const updatedText = (already ? `✅ <b>BẠN ĐÃ NHẬN DATA NÀY</b>\n\n` : `✅ <b>ĐÃ TIẾP NHẬN DATA THÀNH CÔNG!</b>\n\n`) +
      `• <b>Khách hàng:</b> ${escapeHtml(customer.name)}\n` +
      `• 📞 <b>Số điện thoại:</b> <code>${escapeHtml(customer.phone)}</code> (Bấm để gọi)\n` +
      `• <b>Nguồn:</b> ${escapeHtml(customer.source || 'Landing Page')}\n` +
      `• <b>Thời điểm tiếp nhận:</b> ${formatDateTimeVN(nowStamp)}\n` +
      `• 👤 <b>Sale phụ trách:</b> ${escapeHtml(user.name)}\n\n` +
      `👉 <i>Vui lòng chủ động gọi điện tư vấn khách hàng ngay!</i> 🚀`;
    const edited = await editMessageText(chatId, messageId, updatedText, { reply_markup: { inline_keyboard: [] } });
    if (!edited?.ok) await sendMessage(chatId, updatedText);
  } catch (err) {
    console.error('[Telegram Bot] accept data callback error:', err.message);
    await sendMessage(chatId, `⚠️ <b>Chưa nhận được data</b>\n${escapeHtml(friendlyError(err, 'Hệ thống đang bận. Vui lòng bấm lại sau vài giây.'))}`);
  }
}

async function recordTelegramAttendance(user) {
  const at = new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19), day=at.slice(0,10);
  const id='ATT-'+day+'-'+user.id, parse=value=>typeof value==='string'?JSON.parse(value):value;
  // Không xếp hàng sau khóa ghi chung của CRM: lúc 20 người cùng lưu, nút điểm danh
  // từng phải đợi quá 10 giây rồi báo lỗi. Mã cố định theo người + ngày và INSERT IGNORE
  // bảo đảm bấm nhiều lần, Telegram gửi lại callback hay 2 tiến trình cùng xử lý vẫn chỉ 1 bản ghi.
  const [own]=await pool.execute("SELECT body FROM crm_documents WHERE collection='attendance' AND id=? AND deleted=0 LIMIT 1",[id]);
  if(own.length)return parse(own[0].body);
  // Đã điểm danh trên Web trước đó: giữ nguyên giờ của lần đầu tiên.
  const [existing]=await pool.execute("SELECT body FROM crm_documents WHERE collection='attendance' AND deleted=0 AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.accountId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.date'))=? LIMIT 1",[user.id,day]);
  if(existing.length)return parse(existing[0].body);
  const [settingsRows]=await pool.execute("SELECT body FROM crm_documents WHERE collection='settings' AND id='$' AND deleted=0 LIMIT 1");
  const settings=settingsRows[0]?parse(settingsRows[0].body):null;
  const minutes=value=>{const [h,m]=String(value).split(':').map(Number);return (h||0)*60+(m||0);};
  const lateMinutes=Math.max(0,minutes(at.slice(11,16))-minutes(settings?.attendanceDeadline||'09:00'));
  const record={id,accountId:user.id,name:user.name,teamId:user.team_id||'',date:day,at,ip:'Telegram',ipValid:true,late:lateMinutes>0,lateMinutes,note:'Điểm danh qua Telegram',editedBy:''};
  const [inserted]=await pool.execute("INSERT IGNORE INTO crm_documents(collection,id,body,deleted) VALUES ('attendance',?,?,0)",[id,JSON.stringify(record)]);
  if(!inserted.affectedRows){
    // Một lượt bấm song song đã lưu trước (hoặc bản ghi cũ bị xóa mềm): trả về bản đang có.
    await pool.execute("UPDATE crm_documents SET body=?,deleted=0 WHERE collection='attendance' AND id=? AND deleted<>0",[JSON.stringify(record),id]);
    const [saved]=await pool.execute("SELECT body FROM crm_documents WHERE collection='attendance' AND id=? AND deleted=0 LIMIT 1",[id]);
    return saved.length?parse(saved[0].body):record;
  }
  // Tăng phiên bản đồng bộ để màn hình Điểm danh trên Web của mọi người cập nhật sau vài giây.
  await pool.execute('INSERT IGNORE INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',['tg-checkin-'+id,user.id,JSON.stringify([{key:'attendance',id,before:null,after:record}])]).catch(error=>console.warn('[Telegram check-in] version',error.code||error.message));
  return record;
}

async function handleCallbackQueryLegacy(query) {
  const chatId = query.message?.chat?.id, messageId = query.message?.message_id;
  if (query.data !== 'checkin' || !chatId || !messageId) { await answerCallbackQuery(query.id); return; }
  // Tắt vòng xoay ngay, không để mạng Telegram chặn giao dịch SQL.
  void answerCallbackQuery(query.id, 'Đang lưu điểm danh...');
  try {
    if (query.message.chat.type !== 'private' || String(query.from?.id) !== String(chatId)) throw Error('Hãy điểm danh trong cuộc trò chuyện riêng đã liên kết với CRM.');
    const rows = await retryTransient(() => dbQuery('SELECT * FROM users WHERE telegram_chat_id = ? AND active = 1 LIMIT 1', [String(chatId)]));
    if (!rows.length) throw Error('Bạn chưa liên kết tài khoản. Mở Hồ sơ cá nhân trên CRM để liên kết Telegram.');
    const record = await retryTransient(() => recordTelegramAttendance(rows[0]));
    const text = '✅ <b>Đã điểm danh lúc ' + escapeHtml(String(record.at).slice(11,19)) + '</b>\nĐã đồng bộ vào CRM cho <b>' + escapeHtml(rows[0].name) + '</b>.';
    const edited = await editMessageText(chatId, messageId, text, {reply_markup:{inline_keyboard:[]}});
    if (!edited?.ok && !String(edited?.description||'').includes('message is not modified')) await sendMessage(chatId,text);
  } catch (error) {
    console.warn('[Telegram check-in]', error.code || error.message);
    await sendMessage(chatId, '⚠️ Chưa lưu được điểm danh. ' + escapeHtml(friendlyError(error, 'Vui lòng bấm lại sau vài giây.')));
  }
}

// ==================== CÁC HÀM BẮN THÔNG BÁO TỰ ĐỘNG ====================

/**
 * Tính năng 2 & 8: Bắn thông báo Data mới Realtime
 */
async function notifyNewLead(customer, offer = null) {
  try {
    const targetUserId = offer?.saleId || offer?.sale_id || customer?.sale_id || customer?.saleId || customer?.managerId || customer?.ownerId;
    if (!targetUserId) return { sent: 0, skipped: true, reason: 'missing-recipient' };
    const targets = await dbQuery('SELECT id, name, role, telegram_chat_id FROM users WHERE id = ? AND active = 1 AND telegram_chat_id IS NOT NULL LIMIT 1', [targetUserId]);
    const recipient = targets?.[0];
    if (!recipient?.telegram_chat_id) return { sent: 0, skipped: true, reason: 'missing-chat-id' };
    if(!['SALE','LEADER','MANAGER'].includes(recipient.role))return {sent:0,skipped:true,reason:'invalid-role'};
    if(offer&&offer.status!=='PENDING')return {sent:0,skipped:true,reason:'resolved-offer'};
    const targetChatIds = [recipient.telegram_chat_id];
    const pendingSaleOffer = offer?.status === 'PENDING' && String(recipient.role).toUpperCase() === 'SALE';

    // Kiểm tra xem data có quan tâm khóa học / chỉ báo không
    const noteOrCampaign = `${customer.note || ''} ${customer.campaign || ''} ${customer.source || ''}`.toLowerCase();
    const isTradingCourse = noteOrCampaign.includes('khóa học') || noteOrCampaign.includes('khoa hoc') || noteOrCampaign.includes('chỉ báo') || noteOrCampaign.includes('chi bao') || noteOrCampaign.includes('indicator') || noteOrCampaign.includes('rsi');

    let title = isTradingCourse ? `🎓 <b>KHÁCH QUAN TÂM KHÓA HỌC &amp; CHỈ BÁO TRADING!</b>` : `🔥 <b>CÓ DATA KHÁCH HÀNG MỚI!</b>`;
    let msgText = `${title}\n\n` +
      `• <b>Khách hàng:</b> ${escapeHtml(customer.name)}\n` +
      `• <b>Nguồn Form:</b> ${escapeHtml(customer.landingPageName || customer.source || 'Landing Page')}\n` +
      (customer.campaign ? `• <b>Chiến dịch:</b> ${escapeHtml(customer.campaign)}\n` : '') +
      (customer.note ? `• <b>Nhu cầu / Ghi chú:</b> <i>${escapeHtml(customer.note)}</i>\n` : '') +
      `• <b>Thời gian:</b> ${formatDateTimeVN(customer.created_at || customer.createdAt || new Date())}\n\n` +
      `👉 <i>Bấm nút bên dưới để nhận data và bắt đầu tư vấn ngay:</i>`;

    if (!pendingSaleOffer) {
      msgText = msgText.replace('👉 <i>Bấm nút bên dưới để nhận data và bắt đầu tư vấn ngay:</i>',
        '• <b>SĐT:</b> <code>' + escapeHtml(customer.phone || 'Chưa có') + '</code>' + String.fromCharCode(10) +
        '• <b>Gmail:</b> ' + escapeHtml(customer.email || 'Chưa có'));
    }
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '📥 BẤM NHẬN DATA & XỬ LÝ', callback_data: offer?.id ? `accept_offer:${offer.id}` : `accept_data:${customer.id}` }]
      ]
    };

    let sent=0;
    for (const chatId of targetChatIds) {
      const result=await sendMessage(chatId,msgText,pendingSaleOffer?{reply_markup:inlineKeyboard}:{});
      if(result?.ok)sent++;
    }
    return { sent, total:targetChatIds.length, recipientRole: recipient.role, requiresAcceptance: pendingSaleOffer };
  } catch (err) {
    console.error('[Telegram Bot] notifyNewLead error:', err.message);
    return { sent: 0, error: err.message };
  }
}

async function notifyWebhookLeadAdmins(customer, receivedAt, deliveredChatIds = [], source = null) {
  try {
    const admins = String(SYSTEM_ADMIN_CHAT_ID || '').trim() ? [] : await dbQuery("SELECT telegram_chat_id FROM users WHERE role = 'ADMIN' AND active = 1 AND telegram_chat_id IS NOT NULL");
    // Data webhook phải luôn về đúng hộp thư Admin đã cấu hình, không phụ thuộc
    // việc Admin đã liên kết Telegram trong hồ sơ CRM hay chưa. Nếu chưa có
    // biến môi trường thì mới dùng các tài khoản Admin đã liên kết làm fallback.
    const configuredAdminChatId = String(SYSTEM_ADMIN_CHAT_ID || '').trim();
    const linkedAdminChatIds = admins.map(row => row.telegram_chat_id).filter(Boolean).map(String);
    const chatIds = configuredAdminChatId
      ? [configuredAdminChatId]
      : [...new Set(linkedAdminChatIds)];
    const delivered=new Set(deliveredChatIds.map(String));
    if (!chatIds.length) return { sent: 0, skipped: true, reason: 'missing-admin-chat-id', deliveredChatIds: [...delivered] };
    // Webhook snapshots use landingPageUrl; sourceUrl remains supported for older records.
    const ipAddress = String(customer?.ipAddress || customer?.ip || '').trim();
    const ipLine = '• <b>IP khách hàng:</b> <code>' + escapeHtml(ipAddress || 'Chưa ghi nhận') + '</code>' + String.fromCharCode(10);
    const sourceUrl = String(
      source?.landingPageUrl || source?.sourceUrl || source?.url ||
      customer?.landingPageUrl || customer?.sourceUrl || ''
    ).trim();
    const text = '<b>NVT AGENCY CÓ DATA MỚI</b>\n\n' +
      '• <b>Họ tên:</b> ' + escapeHtml(customer.name || 'Chưa có') + '\n' +
      '• <b>SĐT:</b> <code>' + escapeHtml(customer.phone || 'Chưa có') + '</code>\n' +
      '• <b>Gmail:</b> ' + escapeHtml(customer.email || 'Chưa có') + '\n' +
      '• <b>Nguồn data:</b> ' + (sourceUrl ? `<a href='${escapeHtml(sourceUrl)}'>${escapeHtml(sourceUrl)}</a>` : 'Chưa gắn URL nguồn') + '\n' +
      '• <b>Thời gian data về:</b> ' + escapeHtml(formatDateTimeVN(receivedAt));
    const messageText = ipLine + text;
    let sent = 0;
    for (const chatId of chatIds) {
      if(delivered.has(chatId))continue;
      if((await sendMessage(chatId,messageText))?.ok){sent++;delivered.add(chatId);}
    }
    return { sent,total:chatIds.length,deliveredChatIds:[...delivered],complete:chatIds.every(id=>delivered.has(id)) };
  } catch (error) {
    console.error('[Telegram Bot] notifyWebhookLeadAdmins error:', error.message);
    return { sent: 0, error: error.message };
  }
}

async function notifyDuplicateOwner(customer, notice) {
  const rows = await dbQuery(
    'SELECT id, name, role, telegram_chat_id FROM users WHERE id = ? AND active = 1 AND telegram_chat_id IS NOT NULL LIMIT 1',
    [notice.recipientId]
  );
  const sale = rows?.[0];
  if (!sale?.telegram_chat_id) return { sent: 0, skipped: true, reason: 'missing-chat-id' };
  if (!['SALE', 'LEADER', 'MANAGER'].includes(String(sale.role || '').toUpperCase())) {
    return { sent: 0, skipped: true, reason: 'invalid-role' };
  }

  const status = notice.waitingForAcceptance
    ? 'Dang giu luot cho Sale nay nhan'
    : 'Giu Sale cu phu trach';
  const text = '<b>DATA TRUNG HE THONG</b>\n\n' +
    `• <b>Khach hang:</b> ${escapeHtml(customer.name || 'Chua co')}\n` +
    `• <b>SDT:</b> <code>${escapeHtml(customer.phone || 'Chua co')}</code>\n` +
    `• <b>Gmail:</b> ${escapeHtml(customer.email || 'Chua co')}\n` +
    `• <b>Trang thai:</b> ${status}\n` +
    `• <b>Thoi gian:</b> ${escapeHtml(formatDateTimeVN(notice.duplicateAt || new Date()))}`;
  const result = await sendMessage(String(sale.telegram_chat_id), text);
  return { sent: result?.ok ? 1 : 0, skipped: !result?.ok };
}

async function notifyDuplicateLeadAdmins(customer, receivedAt, ownerSaleId = null, waitingForAcceptance = false, source = null) {
  try {
    const admins = String(SYSTEM_ADMIN_CHAT_ID || '').trim() ? [] : await dbQuery("SELECT telegram_chat_id FROM users WHERE role = 'ADMIN' AND active = 1 AND telegram_chat_id IS NOT NULL");
    const configuredAdminChatId = String(SYSTEM_ADMIN_CHAT_ID || '').trim();
    const linkedAdminChatIds = admins.map(row => row.telegram_chat_id).filter(Boolean).map(String);
    const chatIds = configuredAdminChatId ? [configuredAdminChatId] : [...new Set(linkedAdminChatIds)];
    if (!chatIds.length) return { sent: 0, skipped: true, reason: 'missing-admin-chat-id' };
    const sourceUrl = String(source?.landingPageUrl || source?.sourceUrl || '').trim();
    const ipAddress = String(customer?.ipAddress || customer?.ip || '').trim();
    const ipLine = '• <b>IP khach hang:</b> <code>' + escapeHtml(ipAddress || 'Chua ghi nhan') + '</code>' + String.fromCharCode(10);
    const ownerLabel = ownerSaleId ? `\n• <b>Sale giu luot:</b> <code>${escapeHtml(ownerSaleId)}</code>` : '';
    const waitingLabel = waitingForAcceptance ? '\n• <b>Trang thai:</b> Dang cho Sale hien tai nhan data' : '';
    const text = '<b>DATA TRUNG TU WEBHOOK</b>\n\n' +
      `• <b>Ho ten:</b> ${escapeHtml(customer.name || 'Chua co')}\n` +
      `• <b>SDT:</b> <code>${escapeHtml(customer.phone || 'Chua co')}</code>\n` +
      `• <b>Gmail:</b> ${escapeHtml(customer.email || 'Chua co')}\n` +
      (sourceUrl ? `• <b>Nguon data:</b> <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>\n` : '') +
      `• <b>Thoi gian data ve:</b> ${escapeHtml(formatDateTimeVN(receivedAt))}` + ownerLabel + waitingLabel;
    const messageText = ipLine + text;
    let sent = 0;
    for (const chatId of chatIds) if ((await sendMessage(chatId, messageText))?.ok) sent++;
    return { sent, total: chatIds.length, complete: sent === chatIds.length };
  } catch (error) {
    console.error('[Telegram Bot] notifyDuplicateLeadAdmins error:', error.message);
    return { sent: 0, error: error.message };
  }
}

async function notifyInternalSupportMessage(message, imagePath = '') {
  if (!SUPPORT_ADMIN_CHAT_ID) return { sent: false, configured: false, reason: 'missing-admin-chat-id' };
  const requester = message.requester || {};
  const content = String(message.content || '').trim() || 'Nhân viên gửi ảnh đính kèm, vui lòng xem chi tiết.';
  const text = '🔔 <b>YÊU CẦU NỘI BỘ CRM</b>\n\n' +
    '👤 <b>Nhân viên:</b> ' + escapeHtml(requester.name || 'Chưa xác định') +
    ' (' + escapeHtml(requester.department || requester.role || 'Nhân viên') + ' - ' + escapeHtml(requester.accountId || requester.id || '—') + ')\n' +
    '⏰ <b>Thời gian:</b> ' + escapeHtml(formatDateTimeVN(message.createdAt || new Date())) + '\n' +
    '💬 <b>Nội dung:</b> ' + escapeHtml(content) +
    '\n\n<i>Trả lời trực tiếp vào tin nhắn này để phản hồi về CRM của nhân viên.</i>';
  const replyMarkup = { force_reply: true, input_field_placeholder: 'Nhập phản hồi cho nhân viên...' };
  const result = imagePath
    ? await sendPhoto(SUPPORT_ADMIN_CHAT_ID, imagePath, text, { reply_markup: replyMarkup, mime: message.imageMime, bot: 'support' })
    : await sendMessage(SUPPORT_ADMIN_CHAT_ID, text, { reply_markup: replyMarkup, bot: 'support' });
  return { sent: Boolean(result?.ok), configured: true, messageId: result?.result?.message_id || null };
}

/**
 * Gửi thông báo riêng khi data được phân lại cho một Sale mới.
 * Chỉ gửi đến Sale trong offer hiện tại, không gửi lại cho Sale cũ hoặc Leader.
 */
async function notifyReassignedLead(customer, offer = null) {
  try {
    const targetSaleId = customer?.sale_id || customer?.saleId || offer?.saleId || offer?.sale_id;
    if (!targetSaleId || !offer || offer.status !== 'PENDING') {
      return { ok: false, skipped: true, reason: 'missing-target' };
    }

    const rows = await dbQuery(
      "SELECT id, name, telegram_chat_id FROM users WHERE id = ? AND role = 'SALE' AND active = 1 AND telegram_chat_id IS NOT NULL LIMIT 1",
      [targetSaleId]
    );
    const sale = rows?.[0];
    if (!sale?.telegram_chat_id) {
      return { ok: false, skipped: true, reason: 'missing-chat-id' };
    }

    const source = customer.landingPageName || customer.landing_page_name || customer.source || 'Chưa gắn nguồn';
    const offeredAt = offer.offeredAt || offer.offered_at || customer.updated_at || customer.updatedAt || new Date();
    const text = `🔄 <b>DATA ĐƯỢC PHÂN LẠI CHO BẠN</b>\n\n` +
      `• <b>Khách hàng:</b> ${escapeHtml(customer.name || 'Khách hàng mới')}\n` +
      `• <b>Nguồn Form:</b> ${escapeHtml(source)}\n` +
      `• <b>Thời gian phân:</b> ${escapeHtml(formatDateTimeVN(offeredAt))}\n` +
      `• <b>Trạng thái:</b> <i>Đang chờ bạn nhận data</i>\n\n` +
      `👉 Vui lòng bấm nút bên dưới để nhận data và bắt đầu tư vấn.`;

    const result = await sendMessage(String(sale.telegram_chat_id), text, {
      reply_markup: {
        inline_keyboard: [[{
          text: '📥 NHẬN DATA & XỬ LÝ',
          callback_data: `accept_data:${customer.id}`
        }]]
      }
    });
    return { ok: Boolean(result?.ok), chatId: String(sale.telegram_chat_id) };
  } catch (err) {
    console.error('[Telegram Bot] notifyReassignedLead error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Tính năng 10: Nhắc lịch hẹn khách hàng sắp diễn ra (15-30 phút trước)
 */
async function notifyAppointmentReminder(appointment, customer, sale) {
  try {
    if (!sale?.telegram_chat_id) return;

    const typeLabels = {
      DEPOSIT: 'Chốt cọc / Deposit',
      CONSULTING: 'Tư vấn chuyên sâu 1-1',
      PAYMENT: 'Hẹn thanh toán',
      COURSE: 'Tư vấn Khóa học',
      OTHER: 'Cuộc hẹn quan trọng'
    };
    const label = typeLabels[appointment.type] || appointment.type || 'Lịch hẹn';

    const text = `⏰ <b>NHẮC HẸN KHÁCH HÀNG SẮP DIỄN RA!</b>\n\n` +
      `• <b>Khách hàng:</b> ${escapeHtml(customer.name)} - <code>${escapeHtml(customer.phone)}</code>\n` +
      `• <b>Mục đích hẹn:</b> 🎯 <b>${label}</b>\n` +
      `• <b>Thời gian hẹn:</b> ⏰ <b>${formatDateTimeVN(appointment.appointment_time)}</b>\n` +
      `• <b>Sale phụ trách:</b> ${escapeHtml(sale.name)}\n` +
      (appointment.note ? `• <b>Ghi chú:</b> <i>${escapeHtml(appointment.note)}</i>\n\n` : '\n') +
      `👉 <i>Vui lòng chuẩn bị tài liệu và chủ động liên hệ đúng giờ để chốt giao dịch thành công!</i> 🚀`;

    await sendMessage(sale.telegram_chat_id, text);
  } catch (err) {
    console.error('[Telegram Bot] notifyAppointmentReminder error:', err.message);
  }
}

/**
 * Tính năng 3: Cảnh báo Data nóng chưa xử lý quá 12 tiếng
 */
async function notifyStaleLeadWarning(customer, sale, leader) {
  try {
    const chatIds = [sale?.telegram_chat_id, leader?.telegram_chat_id].filter(Boolean);
    if (chatIds.length === 0) return;

    const text = `🚨 <b>CẢNH BÁO: DATA NÓNG CHƯA XỬ LÝ QUÁ 12 TIẾNG!</b>\n\n` +
      `• <b>Khách hàng:</b> ${escapeHtml(customer.name)} - <code>${escapeHtml(customer.phone)}</code>\n` +
      `• <b>Sale phụ trách:</b> ${escapeHtml(sale?.name || 'Chưa gán')}\n` +
      `• <b>Thời điểm nhận:</b> ${formatDateTimeVN(nowStamp)}\n` +
      `• <b>Tình trạng:</b> Chưa cập nhật tiến độ / ghi chú sau 12 giờ!\n\n` +
      `⚠️ <i>Yêu cầu kiểm tra và liên hệ xử lý ngay để tránh nguội data!</i>`;

    for (const cid of chatIds) {
      await sendMessage(cid, text);
    }
  } catch (err) {
    console.error('[Telegram Bot] notifyStaleLeadWarning error:', err.message);
  }
}

/**
 * Tính năng 1: Gửi thông báo Điểm danh đầu ngày (09h00)
 */
const CHECKIN_SEND_GAP_MS = Number(process.env.TELEGRAM_CHECKIN_GAP_MS ?? 60);
async function sendMorningCheckinAlert() {
  let failed = 0;
  try {
    const day = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Ho_Chi_Minh'});
    const staff = await dbQuery("SELECT id, telegram_chat_id, name, role FROM users WHERE role <> 'ADMIN' AND active = 1 AND telegram_chat_id IS NOT NULL");
    for (const member of staff) {
      try {
        const chatId = String(member.telegram_chat_id || '').trim();
        if (!chatId) continue;
        const key = 'checkin:' + day + ':' + String(member.id).slice(0,160);
        const state = {day,userId:member.id,status:'ATTEMPTED',attempts:1};
        // Keep the legacy user key; never resend after rejection, restart or an uncertain network result.
        const [claim] = await pool.execute("INSERT IGNORE INTO crm_documents(collection,id,body,deleted) VALUES ('telegramDaily',?,?,0)", [key,JSON.stringify(state)]);
        if (!claim.affectedRows) continue;
        // Several CRM accounts can point at the same Telegram conversation.
        const chatKey = 'checkin-chat:' + day + ':' + chatId;
        const [chatClaim] = await pool.execute("INSERT IGNORE INTO crm_documents(collection,id,body,deleted) VALUES ('telegramDaily',?,?,0)", [chatKey,JSON.stringify(state)]);
        if (!chatClaim.affectedRows) continue;
        const text = '⏰ <b>NHẮC ĐIỂM DANH ĐẦU NGÀY</b>\nChào <b>' + escapeHtml(member.name) + '</b>! Bấm nút bên dưới để điểm danh hôm nay.';
        const markup = {reply_markup:{inline_keyboard:[[{text:'✅ ĐIỂM DANH',callback_data:'checkin'}]]}};
        const result = await sendMessage(chatId,text,markup);
        const status = result?.ok ? 'SENT' : result?.error_code ? 'FAILED' : 'UNKNOWN';
        if (!result?.ok) failed++;
        const saved = JSON.stringify({...state,status,messageId:result?.result?.message_id||null,errorCode:result?.error_code||null});
        for (const id of [key,chatKey]) await pool.execute("UPDATE crm_documents SET body=? WHERE collection='telegramDaily' AND id=?",[saved,id]);
        await new Promise(resolve => setTimeout(resolve, CHECKIN_SEND_GAP_MS));
      } catch (error) { failed++; console.warn('[Telegram attendance recipient]',error.code||error.message); }
    }
  } catch(error) { failed++; console.warn('[Telegram attendance reminder]',error.code||error.message); }
  return {failed};
}

/**
 * Tính năng 4 & 5: Admin phát thông báo cuộc họp, quy trình, thưởng nóng, động viên
 */
async function sendBroadcastAnnouncement(announcement) {
  try {
    let roleFilter = '';
    if (announcement.target === 'SALE') {
      roleFilter = ` AND role = 'SALE'`;
    } else if (announcement.target === 'MANAGERS') {
      roleFilter = ` AND role IN ('ADMIN', 'MANAGER', 'LEADER')`;
    }

    const staff = await dbQuery(`SELECT telegram_chat_id FROM users WHERE active = 1 AND telegram_chat_id IS NOT NULL${roleFilter}`);
    const chatIds = staff.map(s => s.telegram_chat_id).filter(Boolean);
    if (chatIds.length === 0) return 0;

    let header = '📢 <b>THÔNG BÁO TỪ BAN QUẢN TRỊ NVT AGENCY</b>';
    if (announcement.type === 'MEETING') header = '📢 <b>THÔNG BÁO LỊCH HỌP AGENCY</b>';
    else if (announcement.type === 'POLICY') header = '📋 <b>CẬP NHẬT QUY TRÌNH LÀM VIỆC MỚI</b>';
    else if (announcement.type === 'REWARD') header = '🎁 <b>CHÍNH SÁCH THƯỞNG NÓNG & VINH DANH</b>';
    else if (announcement.type === 'WARNING') header = '⚠️ <b>CẢNH BÁO TIẾN ĐỘ & XỬ LÝ DATA</b>';
    else if (announcement.type === 'MOTIVATION') header = '🔥 <b>THÔNG ĐIỆP ĐỘNG VIÊN & MỤC TIÊU</b>';

    const targetLabel = announcement.target === 'SALE' ? 'Đội ngũ Sales / Tư vấn' :
      announcement.target === 'MANAGERS' ? 'Leader & Quản lý' : 'Toàn thể Agency';

    const remindMinutes = Number(announcement.remind_minutes ?? 15);

    let text = `${header}\n\n` +
      `• <b>Tiêu đề:</b> 🎯 <b>${escapeHtml(announcement.title || '')}</b>\n` +
      `• <b>Gửi tới:</b> 👥 <b>${escapeHtml(targetLabel)}</b>\n` +
      (announcement.meeting_time ? `• <b>Thời gian:</b> ⏰ <b>${formatDateTimeVN(announcement.meeting_time)}</b>\n` : '') +
      (announcement.meeting_link ? `• <b>Địa điểm / Link:</b> 📍 <a href="${escapeHtml(announcement.meeting_link)}">${escapeHtml(announcement.meeting_link)}</a>\n` : '') +
      (announcement.type === 'MEETING' && remindMinutes > 0 ? `• <b>Nhắc lại:</b> 🔔 Tự động nhắc trước ${remindMinutes} phút\n` : '') +
      (announcement.effective_date ? `• <b>Ngày áp dụng:</b> 📅 ${formatDateTimeVN(announcement.effective_date)}\n` : '') +
      `• <b>Người gửi:</b> ✍️ ${escapeHtml(announcement.host || 'Ban Quản Trị')}\n\n` +
      `📝 <b>Nội dung chi tiết:</b>\n${escapeHtml(announcement.content || '')}\n\n` +
      `👉 <i>Thông báo tự động phát từ hệ thống CRM NVT Agency!</i>`;

    let sent = 0;
    for (const cid of chatIds) {
      const res = await sendMessage(cid, text);
      if (res?.ok) sent++;
    }

    // Nếu là cuộc họp có bật nhắc lại, lưu vào bảng để scheduler quét nhắc trước giờ họp
    if (announcement.type === 'MEETING' && announcement.meeting_time && remindMinutes > 0) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS meeting_broadcasts (
          id VARCHAR(96) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          meeting_time DATETIME NOT NULL,
          meeting_link VARCHAR(255),
          host VARCHAR(100),
          target VARCHAR(50) DEFAULT 'ALL',
          remind_minutes INT DEFAULT 15,
          reminded_at DATETIME,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        const meetingId = 'mb_' + Date.now();
        await pool.execute(
          `INSERT INTO meeting_broadcasts (id, title, meeting_time, meeting_link, host, target, remind_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [meetingId, announcement.title || 'Cuộc họp', announcement.meeting_time, announcement.meeting_link || '', announcement.host || 'Ban Quản Trị', announcement.target || 'ALL', remindMinutes]
        );
      } catch (err) {
        console.warn('[Telegram Bot] Lưu lịch nhắc cuộc họp thất bại:', err.message);
      }
    }

    return sent;
  } catch (err) {
    console.error('[Telegram Bot] sendBroadcastAnnouncement error:', err.message);
    return 0;
  }
}

/**
 * Tính năng 7: Gửi Báo cáo kinh doanh tuần (Tối Chủ Nhật)
 */
async function sendWeeklyReport() {
  try {
    const managers = await dbQuery(`SELECT telegram_chat_id FROM users WHERE role IN ('ADMIN', 'MANAGER', 'LEADER') AND active = 1 AND telegram_chat_id IS NOT NULL`);
    const chatIds = managers.map(m => m.telegram_chat_id).filter(Boolean);
    if (chatIds.length === 0) return;

    // Tổng hợp số liệu trong 7 ngày qua
    const [leadStats] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'PAID' OR status = 'WON' THEN 1 ELSE 0 END) AS won,
              SUM(CASE WHEN sale_id IS NOT NULL AND status != 'PAID' THEN 1 ELSE 0 END) AS in_progress
       FROM customers WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    const [revStats] = await pool.query(
      `SELECT SUM(total_amount) AS revenue FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'PAID'`
    );

    const totalLeads = Number(leadStats[0]?.total || 0);
    const wonLeads = Number(leadStats[0]?.won || 0);
    const inProgress = Number(leadStats[0]?.in_progress || 0);
    const convRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';
    const totalRev = Number(revStats[0]?.revenue || 0);

    const reportText = `📊 <b>BÁO CÁO KẾT QUẢ KINH DOANH TUẦN (CHỦ NHẬT)</b>\n\n` +
      `📥 <b>TỔNG QUAN DATA KHÁCH HÀNG:</b>\n` +
      `• Tổng số data nhận trong tuần: <b>${totalLeads}</b> data\n` +
      `• Data ĐÃ chuyển đổi (Paid): <b>${wonLeads}</b> (${convRate}%)\n` +
      `• Data ĐANG chăm sóc: <b>${inProgress}</b> data\n\n` +
      `💵 <b>DOANH SỐ BÁN HÀNG:</b>\n` +
      `• Tổng doanh thu thuần tuần: <b>${formatVND(totalRev)}</b>\n\n` +
      `🚀 <i>Chúc toàn thể NVT Agency chuẩn bị tinh thần bứt phá mạnh mẽ trong tuần mới!</i> 🔥`;

    for (const cid of chatIds) {
      await sendMessage(cid, reportText);
    }
  } catch (err) {
    console.error('[Telegram Bot] sendWeeklyReport error:', err.message);
  }
}

// ==================== SCHEDULER CHẠY NỀN QUÉT LỊCH ====================

let lastCheckinDate = '';
let lastWeeklyReportDate = '';
let lastMarketingInsightDate = '';
let lastPnlReminderKey = '';
let lastPnlWeeklyKey = '';

async function sendPnlDailyReminders(vnDateStr) {
  try {
    const pnl = typeof require === 'function' ? require('./pnl-management.cjs') : null;
    if (!pnl) return;
    const candidates = await pnl.reminderCandidates(vnDateStr);
    for (const row of candidates.slice(0, 100)) await sendMessage(row.owner_chat_id, `⏰ <b>NHẮC NHẬP LÃI/LỖ</b>\nKhách <b>${escapeHtml(row.customer_code)}</b> · CQG <code>${escapeHtml(row.cqg_account)}</code> chưa có số liệu ngày ${escapeHtml(vnDateStr)}.\nGõ: <code>/lailo ${escapeHtml(row.cqg_account)} +0 ${Number(row.default_lot || 0)}</code>`);
  } catch (error) { console.warn('[Telegram PnL reminder]', error.code || error.message); }
}

async function sendPnlWeeklySummary(vnDateStr) {
  try {
    const pnl = typeof require === 'function' ? require('./pnl-management.cjs') : null;
    if (!pnl) return;
    await pnl.closeWeek({ id: 'pnl-scheduler', role: 'ADMIN' }, pnl.weekStart(vnDateStr));
    const users = await dbQuery("SELECT id,name,role,telegram_chat_id FROM users WHERE active=1 AND telegram_chat_id IS NOT NULL AND role IN ('ADMIN','MANAGER','LEADER','SALE')");
    for (const user of users) { const result = await pnl.list({ ...user, teamId: user.team_id || '', leaderId: user.leader_id || null, managerId: user.manager_id || null }); const total = result.customers.reduce((sum, row) => sum + Number(row.week_pnl || 0), 0); await sendMessage(user.telegram_chat_id, `📊 <b>TỔNG KẾT LÃI/LỖ TUẦN</b>\nTuần ${result.weekStart} → ${result.weekEnd}\nKhách trong phạm vi: <b>${result.customers.length}</b>\nTổng lãi/lỗ: <b>${formatVND(total)}</b>`); }
  } catch (error) { console.warn('[Telegram PnL weekly]', error.code || error.message); }
}

async function sendWeeklyMarketingInsight() {
  const crmData = require('./crm-data.cjs');
  const MarketingHub = require('./marketing-hub.js');
  const users = await dbQuery("SELECT id, name, role, telegram_chat_id FROM users WHERE role = 'MARKETING' AND active = 1 AND telegram_chat_id IS NOT NULL");
  if (!users?.length) return { sent: 0 };
  const snapshot = await crmData.read({ id: 'marketing-weekly', role: 'ADMIN', active: true }, { passive: true, full: true });
  const analysis = MarketingHub.analyzeData(snapshot.state || {}), insight = analysis.aiInsight;
  const text = '📊 <b>Insight Marketing tuần mới từ CRM</b>\n\n' + [insight.summaryHeadline, insight.personaInsight, insight.contentInsight, insight.objectionInsight].map(escapeHtml).join('\n\n');
  let sent = 0;
  const day = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Ho_Chi_Minh'});
  for (const chatId of new Set(users.map(user=>String(user.telegram_chat_id)))) {
    const id = 'marketing-insight:'+day+':'+chatId;
    const body = {day,status:'ATTEMPTED',insight};
    const [claim] = await pool.execute("INSERT IGNORE INTO crm_documents(collection,id,body,deleted) VALUES ('telegramDaily',?,?,0)",[id,JSON.stringify(body)]);
    if(!claim.affectedRows)continue;
    const result = await sendMessage(chatId, text);
    if(result?.ok)sent++;
    await pool.execute("UPDATE crm_documents SET body=? WHERE collection='telegramDaily' AND id=?",[JSON.stringify({...body,status:result?.ok?'SENT':'UNKNOWN'}),id]);
  }
  return { sent };
}

async function runTelegramScheduler({skipLeadDrain=false}={}) {
  try {
    // Retry durable lead notices before lower-priority periodic reminders.
    if(!skipLeadDrain)await drainLeadNotifications();
    const now = new Date();
    const vnTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const vnDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const vnDay = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getDay(); // 0 = Sunday
    const [hour, minute] = vnTimeStr.split(':').map(Number);

    if ((vnDay >= 1 && vnDay <= 5 && ((hour === 16 && minute >= 30 && minute <= 35) || (hour === 20 && minute <= 5))) && lastPnlReminderKey !== `${vnDateStr}:${hour}`) {
      lastPnlReminderKey = `${vnDateStr}:${hour}`;
      await sendPnlDailyReminders(vnDateStr);
    }
    if (vnDay === 0 && hour === 20 && minute <= 10 && lastPnlWeeklyKey !== vnDateStr) {
      lastPnlWeeklyKey = vnDateStr;
      await sendPnlWeeklySummary(vnDateStr);
    }

    // 1. Quét Lịch hẹn khách hàng sắp tới (trước 15 - 30 phút)
    try {
      const upcoming = await dbQuery(
        `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS sale_name, u.telegram_chat_id AS sale_chat_id
         FROM customer_appointments a
         JOIN customers c ON a.customer_id = c.id
         LEFT JOIN users u ON a.sale_id = u.id
         WHERE a.status = 'SCHEDULED'
           AND a.reminded_at IS NULL
           AND a.appointment_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 MINUTE)
           AND u.telegram_chat_id IS NOT NULL`
      );

      for (const app of upcoming) {
        await notifyAppointmentReminder(app, { name: app.customer_name, phone: app.customer_phone }, { name: app.sale_name, telegram_chat_id: app.sale_chat_id });
        await pool.execute(`UPDATE customer_appointments SET reminded_at = NOW() WHERE id = ?`, [app.id]);
      }
    } catch (e) {
      // Table may not exist yet if db unconfigured
    }

    // 1b. Quét Cuộc họp Agency sắp diễn ra để nhắc lại 1 lần nữa theo cài đặt Admin
    try {
      const upcomingMeetings = await dbQuery(
        `SELECT * FROM meeting_broadcasts
         WHERE reminded_at IS NULL
           AND meeting_time > NOW()
           AND meeting_time <= DATE_ADD(NOW(), INTERVAL remind_minutes MINUTE)`
      );

      // Reuse one recipient read for this scan instead of re-querying per meeting.
      const allStaffToRemind = upcomingMeetings.length
        ? await dbQuery('SELECT telegram_chat_id, role FROM users WHERE active = 1 AND telegram_chat_id IS NOT NULL')
        : [];
      for (const mb of upcomingMeetings) {
        const staffToRemind = allStaffToRemind.filter(member =>
          mb.target === 'SALE' ? member.role === 'SALE' :
          mb.target === 'MANAGERS' ? ['ADMIN', 'MANAGER', 'LEADER'].includes(member.role) : true
        );
        const chatIdsToRemind = staffToRemind.map(s => s.telegram_chat_id).filter(Boolean);

        const remindText = `⏰ <b>NHẮC NHỞ: CUỘC HỌP SẮP DIỄN RA TRONG ${mb.remind_minutes} PHÚT NỮA!</b>\n\n` +
          `• <b>Cuộc họp:</b> 🎯 <b>${escapeHtml(mb.title)}</b>\n` +
          `• <b>Thời gian bắt đầu:</b> ⏰ <b>${formatDateTimeVN(mb.meeting_time)}</b> (Sắp diễn ra)\n` +
          (mb.meeting_link ? `• <b>Địa điểm / Link vào họp:</b> 📍 <a href="${escapeHtml(mb.meeting_link)}">${escapeHtml(mb.meeting_link)}</a>\n` : '') +
          `• <b>Người chủ trì:</b> ✍️ ${escapeHtml(mb.host || 'Ban Quản Trị')}\n\n` +
          `👉 <i>Toàn thể nhân sự khẩn trương sắp xếp công việc và vào phòng họp đúng giờ!</i> 🚀`;

        for (const cid of chatIdsToRemind) {
          await sendMessage(cid, remindText);
        }

        await pool.execute(`UPDATE meeting_broadcasts SET reminded_at = NOW() WHERE id = ?`, [mb.id]);
      }
    } catch (e) {
      // Safe skip
    }

    // 2. Điểm danh lúc 09:00 - 09:10 sáng hàng ngày
    if (hour === 9 && minute >= 0 && minute <= 10 && lastCheckinDate !== vnDateStr) {
      // Đánh dấu trước khi gửi để tránh chạy chồng trong cùng tiến trình.
      lastCheckinDate = vnDateStr;
      await sendMorningCheckinAlert();
      // Khóa SQL giữ từng người đã gửi; không gửi lại trong ngày kể cả khi Telegram báo lỗi.
      // Giữ nguyên ngày đã gửi, không phát lại toàn bộ danh sách khi một người bị lỗi.
    }

    // 3. Báo cáo tuần tối Chủ Nhật lúc 20:00 - 20:10
    if (vnDay === 0 && hour === 20 && minute >= 0 && minute <= 10 && lastWeeklyReportDate !== vnDateStr) {
      lastWeeklyReportDate = vnDateStr;
      await sendWeeklyReport();
    }

    // 3b. Insight Marketing CRM sáng thứ Hai lúc 09:00 - 09:10
    if (vnDay === 1 && hour === 9 && minute >= 0 && minute <= 10 && lastMarketingInsightDate !== vnDateStr) {
      lastMarketingInsightDate = vnDateStr;
      await sendWeeklyMarketingInsight();
    }

    // 4. Cảnh báo Data nóng quá 12 tiếng chưa xử lý (quét mỗi 15 phút)
    if (minute % 15 === 0) {
      try {
        const staleLeads = await dbQuery(
          `SELECT c.*, JSON_UNQUOTE(JSON_EXTRACT(c.custom_fields_json, '$.__crmMeta.saleAcceptedAt')) AS sale_accepted_at, s.name AS sale_name, s.telegram_chat_id AS sale_chat_id, l.name AS leader_name, l.telegram_chat_id AS leader_chat_id
           FROM customers c
           LEFT JOIN users s ON c.sale_id = s.id
           LEFT JOIN users l ON c.leader_id = l.id
           WHERE JSON_UNQUOTE(JSON_EXTRACT(c.custom_fields_json, '$.__crmMeta.saleAcceptedAt')) IS NOT NULL
             AND STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(c.custom_fields_json, '$.__crmMeta.saleAcceptedAt')), '%Y-%m-%d %H:%i:%s') <= DATE_SUB(NOW(), INTERVAL 12 HOUR)
             AND c.status = 'NEW'
             AND (c.note IS NULL OR c.note = '' OR c.note LIKE '%nhận từ hàng chờ%')
             AND (s.telegram_chat_id IS NOT NULL OR l.telegram_chat_id IS NOT NULL)
           LIMIT 10`
        );
        for (const lead of staleLeads) {
          await notifyStaleLeadWarning(lead, { name: lead.sale_name, telegram_chat_id: lead.sale_chat_id }, { name: lead.leader_name, telegram_chat_id: lead.leader_chat_id });
        }
      } catch (e) {
        // Safe skip
      }
    }
  } catch (err) {
    console.error('[Telegram Bot] Scheduler error:', err.message);
  }
}


// Persist before send; retry failures across restarts. A database advisory lock
// serializes workers across Passenger processes. Delivery is at-least-once:
// a crash after Telegram accepts but before SQL acknowledgment may repeat a notice.
let drainingNotices=false;
async function drainLeadNotifications(){
 if(!BOT_TOKEN||drainingNotices)return {skipped:true};
 drainingNotices=true;
 let connection,locked=false,processed=0;
 const parse=value=>typeof value==='string'?JSON.parse(value):value;
 try{
  connection=await telegramPool.getConnection();
  const [locks]=await connection.query("SELECT GET_LOCK(CONCAT('crm-telegram-',DATABASE()),0) AS acquired");
  locked=Number(locks[0]?.acquired)===1;
  if(!locked)return {skipped:true};
  const [rows]=await connection.query("SELECT id,body FROM crm_documents WHERE collection='telegramOutbox' AND deleted=0 AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.status'))='PENDING' AND (JSON_EXTRACT(body,'$.nextAttemptAt') IS NULL OR CAST(JSON_UNQUOTE(JSON_EXTRACT(body,'$.nextAttemptAt')) AS UNSIGNED)<=UNIX_TIMESTAMP()*1000) ORDER BY id LIMIT 20");
  for(const row of rows){
   let notice;
   try{notice=parse(row.body);}catch{continue;}
   try{
    if(notice.kind==='WEBHOOK_ADMIN'){
     const result=await notifyWebhookLeadAdmins(notice.customer,notice.receivedAt,notice.deliveredChatIds||[],notice.source||null);
     notice.deliveredChatIds=result.deliveredChatIds||notice.deliveredChatIds||[];
     if(result.complete)notice.status='SENT';
     else notice.lastError=result.skipped?'ADMIN_CHAT_NOT_CONFIGURED':'TELEGRAM_DELIVERY_FAILED';
    }else if(notice.kind==='DUPLICATE_ADMIN'){
     const result=await notifyDuplicateLeadAdmins(notice.customer,notice.receivedAt,notice.ownerSaleId||null,Boolean(notice.waitingForAcceptance),notice.source||null);
     if(result.complete)notice.status='SENT';
     else notice.lastError=result.skipped?'ADMIN_CHAT_NOT_CONFIGURED':'TELEGRAM_DELIVERY_FAILED';
    }else if(notice.kind==='DUPLICATE_OWNER'){
     const [customers]=await connection.execute('SELECT * FROM customers WHERE id=? LIMIT 1',[notice.customerId]);
     const sql=customers[0];
     if(!sql){
      notice.status='SKIPPED';
     }else{
      let fields={};
      try{fields=parse(sql.custom_fields_json||'{}')||{};}catch{fields={};}
      const customer={...(fields.__crmMeta||{}),...sql};
      let valid=sql.sale_id===notice.recipientId;
      if(!valid&&notice.offerId){
       const [offers]=await connection.execute("SELECT body FROM crm_documents WHERE collection='dataOffers' AND id=? AND deleted=0",[notice.offerId]);
       let offer=null;
       try{offer=offers[0]?parse(offers[0].body):null;}catch{offer=null;}
       const raw=String(offer?.offeredAt||offer?.offered_at||'').replace(' ','T');
       const offeredAt=raw?(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?Date.parse(raw):Date.parse(raw+'+07:00')):NaN;
       valid=offer?.status==='PENDING'&&offer.saleId===notice.recipientId&&offer.customerId===notice.customerId&&Number.isFinite(offeredAt)&&offeredAt+86400000>Date.now();
      }
      if(!valid){
       notice.status='SKIPPED';
      }else{
       const result=await notifyDuplicateOwner(customer,notice);
       if(result.sent>0)notice.status='SENT';
       else if(result.reason==='invalid-role')notice.status='SKIPPED';
       else notice.lastError=result.reason||'TELEGRAM_DELIVERY_FAILED';
      }
     }
    }else if(notice.kind==='ASSIGNMENT'){
     const [customers]=await connection.execute('SELECT * FROM customers WHERE id=? LIMIT 1',[notice.customerId]);
     const sql=customers[0];
     if(!sql||sql.status==='ARCHIVED'){notice.status='SKIPPED';}
     else {
      const fields=parse(sql.custom_fields_json||'{}');
      const customer={...(fields.__crmMeta||{}),...sql,saleId:sql.sale_id||null};
      let offer=null,valid=true;
      if(notice.offerId){
       const [offers]=await connection.execute("SELECT body FROM crm_documents WHERE collection='dataOffers' AND id=? AND deleted=0",[notice.offerId]);
       offer=offers[0]?parse(offers[0].body):null;
       const offered=Date.parse(String(offer?.offeredAt||'').replace(' ','T')+'+07:00');
       valid=offer?.status==='PENDING'&&offer.saleId===notice.recipientId&&offer.customerId===notice.customerId&&Number.isFinite(offered)&&Date.now()-offered<86400000&&(!customer.sale_id||customer.sale_id===notice.recipientId);
      }else{
       const owner=customer.sale_id||customer.saleId||customer.ownerId||customer.managerId;
       valid=owner===notice.recipientId&&String(customer.saleAcceptedAt||customer.sale_accepted_at||'')===String(notice.acceptedAt||'');
       const [pending]=await connection.execute("SELECT id FROM crm_documents WHERE collection='dataOffers' AND deleted=0 AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.customerId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.status'))='PENDING' LIMIT 1",[notice.customerId]);
       if(pending.length)valid=false;
      }
      if(!valid)notice.status='SKIPPED';
      else{
       const result=await notifyNewLead(customer,offer);
       if(result?.sent>0)notice.status='SENT';
       else if(result?.reason==='invalid-role')notice.status='SKIPPED';
       else notice.lastError=result?.reason||'TELEGRAM_DELIVERY_FAILED';
      }
     }
    }else notice.status='SKIPPED';
   }catch(error){notice.lastError='DELIVERY_ERROR';console.warn('[Telegram Bot] Notice retry:',row.id,error.code||'ERROR');}
   notice.attempts=(Number(notice.attempts)||0)+1;
   notice.nextAttemptAt=Date.now()+Math.min(300000,15000*2**Math.min(notice.attempts,5));
   if(notice.status==='SENT'){notice.sentAt=new Date().toISOString();delete notice.lastError;}
   await connection.execute("UPDATE crm_documents SET body=? WHERE collection='telegramOutbox' AND id=?",[JSON.stringify(notice),row.id]);
   processed++;
  }
  return {processed};
 }catch(error){console.warn('[Telegram Bot] Outbox unavailable:',error.code||'ERROR');return {processed,error:'OUTBOX_UNAVAILABLE'};}
 finally{
  if(locked)await connection.query("SELECT RELEASE_LOCK(CONCAT('crm-telegram-',DATABASE()))").catch(()=>{});
  connection?.release();drainingNotices=false;
 }
}

module.exports = {
  drainLeadNotifications,
  callTelegram,
  sendMessage,
  sendPhoto,
  editMessageText,
  answerCallbackQuery,
  setWebhook,
  setSupportWebhook,
  handleTelegramUpdate,
  notifyNewLead,
  notifyWebhookLeadAdmins,
  notifyDuplicateOwner,
  notifyDuplicateLeadAdmins,
  notifyInternalSupportMessage,
  notifyReassignedLead,
  notifyAppointmentReminder,
  notifyStaleLeadWarning,
  sendMorningCheckinAlert,
  sendBroadcastAnnouncement,
  sendWeeklyReport,
  sendWeeklyMarketingInsight,
  runTelegramScheduler
};
