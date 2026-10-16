'use strict';

// One-time backfill for orders that existed before Google Sheets backup was enabled.
// Run from the project root after setting GOOGLE_SHEETS_BACKUP_URL and secret.
const crmData = require('../crm-data.cjs');
const backup = require('../google-sheets-backup.cjs');

(async () => {
  if (!process.env.GOOGLE_SHEETS_BACKUP_URL) throw new Error('GOOGLE_SHEETS_BACKUP_URL chưa được cấu hình.');
  const admin = { id: 'SYSTEM-GOOGLE-SHEETS', name: 'Google Sheets backup', role: 'ADMIN', active: true };
  const result = await crmData.read(admin, { passive: true, full: true });
  const customers = new Map((result.state.customers || []).map(item => [item.id, item]));
  const orders = result.state.orders || [];
  for (const order of orders) {
    await backup.enqueueOrder(order, customers.get(order.customerId) || null, admin, 'BACKFILL');
  }
  await backup.flush();
  console.log(`Đã xếp ${orders.length} đơn vào hàng đợi backup Google Sheets.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
