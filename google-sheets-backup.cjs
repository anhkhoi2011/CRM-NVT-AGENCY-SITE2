'use strict';

// Optional, durable order backup transport. Configure GOOGLE_SHEETS_BACKUP_URL
// with the deployed Google Apps Script Web App URL to enable it.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const OrderPayments = require('./order-payments.js');

const endpoint = String(process.env.GOOGLE_SHEETS_BACKUP_URL || '').trim();
const secret = String(process.env.GOOGLE_SHEETS_BACKUP_SECRET || '').trim();
const queueFile = String(process.env.GOOGLE_SHEETS_BACKUP_QUEUE_FILE || path.join(
  process.env.WEBHOOK_DATA_DIR || path.join(process.env.HOME || process.cwd(), 'webhook-data'),
  'google-sheets-order-queue.jsonl'
));
let flushing = false;

function cloneWithoutImageData(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneWithoutImageData);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'imageData' || key === 'billImage') continue;
    result[key] = cloneWithoutImageData(child);
  }
  return result;
}

function orderImages(order) {
  const images = [];
  for (const receipt of OrderPayments.receipts(order)) {
    for (const image of OrderPayments.images(receipt)) {
      if (!image?.imageData) continue;
      images.push({
        receiptId: receipt.id || '',
        imageId: image.id || crypto.randomUUID(),
        fileName: image.fileName || `${order.code || order.id}-${image.id || 'bill'}.jpg`,
        fileType: image.fileType || 'image/jpeg',
        note: String(image.note || ''),
        data: image.imageData
      });
    }
  }
  if (!images.length && order?.billImage) {
    images.push({
      receiptId: '',
      imageId: `${order.id}-bill`,
      fileName: `${order.code || order.id}-bill.jpg`,
      fileType: 'image/jpeg',
      note: 'Bill chuyển khoản',
      data: order.billImage
    });
  }
  return images;
}

function payloadForOrder(order, customer, actor, action) {
  const images = orderImages(order);
  const eventId = `${action || 'UPSERT'}:${order.id}:${order.updatedAt || order.createdAt || ''}`;
  return {
    eventId,
    action: action || 'UPSERT',
    sentAt: new Date().toISOString(),
    actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : null,
    order: cloneWithoutImageData(order),
    customer: cloneWithoutImageData(customer),
    images
  };
}

async function appendQueue(payload) {
  await fs.mkdir(path.dirname(queueFile), { recursive: true });
  await fs.appendFile(queueFile, JSON.stringify(payload) + '\n', 'utf8');
}

async function post(payload) {
  if (!endpoint) return false;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, ...payload })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Sheets backup HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    const result = JSON.parse(text);
    if (result && result.ok === false) throw new Error(result.error || 'Google Sheets backup rejected the payload');
  } catch (error) {
    if (error instanceof SyntaxError) return true;
    throw error;
  }
  return true;
}

async function flush() {
  if (flushing || !endpoint) return;
  flushing = true;
  try {
    let content = '';
    try { content = await fs.readFile(queueFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const rows = content.split(/\r?\n/).filter(Boolean);
    if (!rows.length) return;
    const pending = [];
    for (const row of rows) {
      let payload;
      try { payload = JSON.parse(row); } catch { continue; }
      try { await post(payload); } catch (error) { pending.push({ payload, error }); }
    }
    if (pending.length) await fs.writeFile(queueFile, pending.map(item => JSON.stringify(item.payload)).join('\n') + '\n', 'utf8');
    else await fs.rm(queueFile, { force: true });
    for (const item of pending.slice(0, 1)) console.warn('[google-sheets-backup]', item.error.message);
  } catch (error) {
    console.warn('[google-sheets-backup]', error.code || error.message);
  } finally { flushing = false; }
}

async function enqueueOrder(order, customer, actor, action = 'UPSERT') {
  if (!endpoint) return { enabled: false };
  const payload = payloadForOrder(order, customer, actor, action);
  await appendQueue(payload);
  void flush();
  return { enabled: true, eventId: payload.eventId };
}

async function backupOrders(orders, customers, actor, action = 'BACKUP') {
  if (!endpoint) return { enabled: false, queued: 0 };
  const customerMap = customers instanceof Map ? customers : new Map((customers || []).map(item => [item.id, item]));
  let queued = 0;
  for (const order of orders || []) {
    await enqueueOrder(order, customerMap.get(order.customerId) || null, actor, action);
    queued++;
  }
  await flush();
  return { enabled: true, queued };
}

if (endpoint) {
  setInterval(() => { void flush(); }, 30_000).unref?.();
}

module.exports = { enqueueOrder, backupOrders, flush, orderImages, payloadForOrder };
