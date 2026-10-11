"use strict";
const { pool, dbConfigured } = require('./db.js');
const defaultWebsites = require('./crm-defaults.json').websites || [];
const crmData = require('./crm-data.cjs');
let ready;
// Chỉ tạo bảng bổ sung; không sửa hoặc xóa bảng khách hàng hiện có.
function ensureSchema() {
  if (!dbConfigured) return Promise.reject(new Error('MySQL chưa được cấu hình'));
  if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(96) PRIMARY KEY,
  dedupe_key CHAR(64) NOT NULL UNIQUE,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`).catch(error => { ready = null; throw error; });
  return ready;
}
function parsed(value) {
  if (!value) return null;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}
function extractReferenceAmount(raw) {
  const values = raw && typeof raw === 'object' ? raw : {};
  const aliases = new Set(['referenceamount','amountreference','sotienkhachthamkhao','sotienkhachhang','sotien','von','capital','budget','investment','khoandautu','taichinh','financialcapacity','customerbudget','recentamount']);
  for (const [key, value] of Object.entries(values)) {
    const normalized = String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const inferredReference = normalized.includes('sotien') && (normalized.includes('thamkhao') || normalized.includes('khach'));
    if (!aliases.has(normalized) && !inferredReference) continue;
    const digits = String(value ?? '').replace(/[^0-9]/g, '');
    if (!digits) continue;
    const amount = Number(digits);
    if (Number.isFinite(amount) && amount >= 0 && amount <= 1e15) return amount;
  }
  return null;
}
function cleanSourceUrl(value, domain = '') {
  const raw = String(value || (domain ? `https://${domain}/` : '')).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}
async function sourceBySlug(connection, slug) {
  const wanted = String(slug || '').toUpperCase();
  const [rows] = await connection.execute("SELECT id, body FROM crm_documents WHERE collection='websites' AND deleted=0");
  const configured = rows.map(row => ({ id: row.id, ...parsed(row.body) })).find(website => String(website.webhookSlug || '').toUpperCase() === wanted);
  const website = configured || defaultWebsites.find(item => String(item.webhookSlug || '').toUpperCase() === wanted);
  if (!website) return null;
  const sourceUrl = cleanSourceUrl(website.sourceUrl, website.domain);
  let domain = String(website.domain || '').trim().toLowerCase();
  if (!domain && sourceUrl) try { domain = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
  return { id: website.id, name: String(website.name || domain || 'Landing page'), domain, sourceUrl, campaign: String(website.campaignId || 'UNATTRIBUTED') };
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits;
}

function phoneCandidates(value) {
  const normalized = normalizePhone(value);
  if (!normalized) return [];
  const candidates = new Set([normalized, String(value || '').trim()]);
  if (normalized.startsWith('0')) candidates.add(`84${normalized.slice(1)}`);
  return [...candidates].filter(Boolean);
}
function parsedDocument(value) {
  if (!value) return {};
  try {
    return typeof value === 'string' ? (JSON.parse(value) || {}) : (value || {});
  } catch {
    return {};
  }
}

function offerIsActive(offer) {
  if (!offer || offer.status !== 'PENDING') return false;
  const value = String(offer.offeredAt || offer.offered_at || '').trim().replace(' ', 'T');
  if (!value) return false;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const offeredAt = Date.parse(hasTimezone ? value : `${value}+07:00`);
  return Number.isFinite(offeredAt) && offeredAt + 86400000 > Date.now();
}

async function findPendingOffer(connection, customerId) {
  const [rows] = await connection.execute(
    `SELECT id, body FROM crm_documents WHERE collection='dataOffers' AND deleted=0`
  );
  return (rows || [])
    .map(row => ({ id: row.id, ...parsedDocument(row.body) }))
    .find(offer => String(offer.customerId || '') === String(customerId || '') && offerIsActive(offer)) || null;
}

async function findExistingCustomer(connection, customer) {
  const phones = phoneCandidates(customer?.phone);
  const email = String(customer?.email || '').trim().toLowerCase();
  if (!phones.length && !email) return null;
  const clauses = [];
  const values = [];
  if (phones.length) {
    clauses.push(`phone IN (${phones.map(() => '?').join(',')})`);
    values.push(...phones);
  }
  if (email) {
    clauses.push('LOWER(email) = ?');
    values.push(email);
  }
  const [rows] = await connection.execute(
    `SELECT id, name, phone, email, sale_id, leader_id, team_id, status FROM customers WHERE ${clauses.join(' OR ')} ORDER BY created_at ASC LIMIT 20`,
    values
  );
  const normalized = normalizePhone(customer?.phone);
  return (rows || []).find(row =>
    (normalized && normalizePhone(row.phone) === normalized) ||
    (email && String(row.email || '').trim().toLowerCase() === email)
  ) || null;
}

async function recordDuplicate(connection, eventId, record, existing, sourceSnapshot, pendingOffer = null) {
  const at = record.receivedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const ownerSaleId = existing.sale_id || pendingOffer?.saleId || pendingOffer?.sale_id || null;
  const waitingForAcceptance = !existing.sale_id && Boolean(ownerSaleId);
  const resubmission = {
    id: `RESUB-${eventId}`,
    customerId: existing.id,
    phone: normalizePhone(record.customer?.phone),
    source: 'Landing page webhook',
    campaign: sourceSnapshot?.campaign || '',
    websiteId: sourceSnapshot?.websiteId || null,
    previousSaleId: ownerSaleId,
    assignedSaleId: ownerSaleId,
    pendingOfferId: pendingOffer?.id || null,
    duplicateStatus: waitingForAcceptance ? 'PENDING_ACCEPTANCE' : ownerSaleId ? 'ASSIGNED' : 'UNASSIGNED',
    registeredAccount: false,
    at,
    intakeType: 'API',
    duplicate: true
  };
  await connection.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0', ['resubmissions', resubmission.id, JSON.stringify(resubmission)]);
  if (ownerSaleId) {
    const notification = {
      id: `NT-DUP-${eventId}`,
      role: 'OWN',
      saleId: ownerSaleId,
      leaderId: existing.leader_id || null,
      teamId: existing.team_id || null,
      title: waitingForAcceptance ? 'DATA TRUNG - Sale dang cho nhan' : 'DATA TRUNG - giu Sale phu trach',
      text: `${existing.name || record.customer?.name || 'Khach hang'} · ${record.customer?.phone || ''}`,
      at,
      readBy: []
    };
    await connection.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0', ['notifications', notification.id, JSON.stringify(notification)]);
    await crmData.queueTelegramNotice(connection, `duplicate-owner:${eventId}:${ownerSaleId}`, {
      kind: 'DUPLICATE_OWNER',
      customer: { id: existing.id, name: existing.name || record.customer?.name || '', phone: existing.phone || record.customer?.phone || '', email: existing.email || record.customer?.email || '' },
      customerId: existing.id,
      recipientId: ownerSaleId,
      offerId: pendingOffer?.id || null,
      duplicateAt: at,
      waitingForAcceptance
    });
  }
  return { ownerSaleId, pendingOfferId: pendingOffer?.id || null, waitingForAcceptance };
}

async function persistWebhook(record, { skipAutomatic = false } = {}) {
  await ensureSchema();
  await crmData.prepare();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Cung khoa voi API CRM de phan cong va con tro ty trong luon nhat quan.
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const website = await sourceBySlug(connection, record.slug);
    const sourceSnapshot = website ? { websiteId: website.id, landingPageName: website.name, landingPageUrl: website.sourceUrl, sourceUrl: website.sourceUrl, landingPageDomain: website.domain, campaign: website.campaign } : null;
    const storedRecord = sourceSnapshot ? { ...record, source: sourceSnapshot } : record;
    const [existingEvents] = await connection.execute('SELECT id, payload_json FROM webhook_events WHERE dedupe_key = ?', [record.dedupeKey]);
    await connection.execute('INSERT INTO webhook_events (id, dedupe_key, payload_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id', [record.id, record.dedupeKey, JSON.stringify(storedRecord)]);
    const [rows] = await connection.execute('SELECT id, payload_json FROM webhook_events WHERE dedupe_key = ?', [record.dedupeKey]);
    const eventId = rows[0].id;
    const replay = existingEvents.length > 0 || eventId !== record.id;
    if (replay) {
      // A duplicate intake may point to a pre-existing customer, not CUS-eventId.
      const original = parsed(existingEvents[0]?.payload_json) || parsed(rows[0]?.payload_json) || storedRecord;
      await connection.commit();
      return {
        eventId, replay: true, duplicate: true,
        customerId: original.status === 'NEW' ? (original.duplicateCustomerId || original.customerId || `CUS-${eventId}`) : null,
        ownerSaleId: original.ownerSaleId || null,
        pendingOfferId: original.pendingOfferId || null,
        duplicateStatus: original.duplicateStatus || null,
        source: original.source || null
      };
    }
    const customerId = `CUS-${eventId}`;
    if (record.status === 'NEW' && !replay) {
      const existing = await findExistingCustomer(connection, record.customer);
      if (existing) {
        const pendingOffer = existing.sale_id ? null : await findPendingOffer(connection, existing.id);
        const duplicate = await recordDuplicate(connection, eventId, record, existing, sourceSnapshot, pendingOffer);
        await crmData.queueTelegramNotice(connection, 'duplicate-admin:' + eventId, {
          kind: 'DUPLICATE_ADMIN',
          customer: {
            id: existing.id,
            name: existing.name || record.customer?.name || '',
            phone: existing.phone || record.customer?.phone || '',
            email: existing.email || record.customer?.email || '',
            ipAddress: record.customer?.ipAddress || ''
          },
          customerId: existing.id,
          receivedAt: record.receivedAt,
          source: sourceSnapshot,
          ownerSaleId: duplicate.ownerSaleId,
          offerId: duplicate.pendingOfferId,
          waitingForAcceptance: duplicate.waitingForAcceptance
        });
        const duplicateRecord = { ...storedRecord, duplicate: true, duplicateCustomerId: existing.id, ownerSaleId: duplicate.ownerSaleId, pendingOfferId: duplicate.pendingOfferId, duplicateStatus: duplicate.waitingForAcceptance ? 'PENDING_ACCEPTANCE' : duplicate.ownerSaleId ? 'ASSIGNED' : 'UNASSIGNED' };
        await connection.execute('UPDATE webhook_events SET payload_json = ? WHERE id = ?', [JSON.stringify(duplicateRecord), eventId]);
        await connection.commit();
        return { eventId, customerId: existing.id, duplicate: true, replay: false, ownerSaleId: duplicate.ownerSaleId, pendingOfferId: duplicate.pendingOfferId, duplicateStatus: duplicateRecord.duplicateStatus, source: sourceSnapshot };
      }
      await crmData.queueTelegramNotice(connection, 'webhook:' + eventId, { kind: 'WEBHOOK_ADMIN', customer: record.customer, receivedAt: record.receivedAt, source: sourceSnapshot });
      // Lưu ảnh chụp nguồn cùng khách; replay không ghi đè phân công/trạng thái cũ.
      const referenceAmount = extractReferenceAmount(record.raw);
      const meta = { webhookSlug: record.slug, webhookEventId: eventId };
      if (record.customer?.ipAddress) meta.ipAddress = record.customer.ipAddress;
      if (referenceAmount !== null) meta.referenceAmount = referenceAmount;
      if (sourceSnapshot) Object.assign(meta, sourceSnapshot);
      await connection.execute(`INSERT INTO customers (id, name, phone, email, source, campaign, website_id, status, note, custom_fields_json, created_at)
        VALUES (?, ?, ?, ?, 'Landing Page', ?, ?, 'NEW', ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [customerId, record.customer.name, record.customer.phone, record.customer.email || null,
        website?.campaign || 'UNATTRIBUTED', website?.id || null,
        website ? `Data từ ${website.sourceUrl || website.domain}` : 'Data landing page chưa gắn nguồn',
        JSON.stringify({ __crmMeta: meta, __crmFields: {} }), record.receivedAt]);
    }
    if(record.status==='NEW'&&!replay){
      const notification={id:`NT-DATA-${eventId}`,kind:'DATA_ARRIVAL',role:'ADMIN',customerId,title:'Data mới về',text:`${record.customer.name} · ${website?.name||'Landing Page'}`,at:new Date().toISOString(),readBy:[]};
      await connection.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE id=id',['notifications',notification.id,JSON.stringify(notification)]);
    }
    if (record.status === 'NEW' && !replay && !skipAutomatic) await crmData.distributeAutomatic(connection);
    await connection.commit();
    return { eventId, customerId: record.status === 'NEW' ? customerId : null, duplicate: replay, replay, source: sourceSnapshot };
  } catch (error) {
    await connection.rollback().catch(()=>{});
    throw error;
  } finally { connection.release(); }
}
module.exports = { persistWebhook, sourceBySlug, cleanSourceUrl };
