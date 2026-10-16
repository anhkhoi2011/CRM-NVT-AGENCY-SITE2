// Dán toàn bộ file này vào Google Apps Script gắn với file Google Sheet backup.
// Sau đó Deploy > New deployment > Web app, quyền Execute as: Me,
// Who has access: Anyone with the link. Đặt URL triển khai vào
// GOOGLE_SHEETS_BACKUP_URL và cùng một secret vào GOOGLE_SHEETS_BACKUP_SECRET.

const CRM_SHEET_ID = '1Gs50FplPekASSHN7Ha2eXlG0je1AVPHtIA_bD_I1Pns';
const CRM_BACKUP_SECRET = 'THAY_BANG_SECRET_DAI_NGAU_NHIEN';
const ORDER_SHEET = 'Orders';
const IMAGE_FOLDER = 'CRM Order Images';

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return json_({ ok: true, service: 'crm-order-backup' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    if (!CRM_BACKUP_SECRET || body.secret !== CRM_BACKUP_SECRET) return json_({ ok: false, error: 'Unauthorized' });
    if (!body.eventId || !body.order?.id) return json_({ ok: false, error: 'Missing eventId/order' });

    const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    const sheet = ss.getSheetByName(ORDER_SHEET) || ss.insertSheet(ORDER_SHEET);
    const eventSheet = ss.getSheetByName('_BackupEvents') || ss.insertSheet('_BackupEvents');
    if (eventSheet.getLastRow() === 0) eventSheet.appendRow(['eventId', 'receivedAt']);
    const seen = eventSheet.getRange(1, 1, eventSheet.getLastRow(), 1).getValues().flat();
    if (seen.indexOf(body.eventId) >= 0) return json_({ ok: true, duplicate: true });
    if (sheet.getLastRow() === 0) sheet.appendRow([
      'Thời gian backup', 'Mã đơn', 'Trạng thái', 'Khách hàng', 'SĐT', 'Sản phẩm',
      'Tổng tiền', 'Đã thu', 'Còn lại', 'Sale', 'Leader', 'Manager', 'Thanh toán',
      'Mã tham chiếu', 'Ngày tạo', 'Ảnh bill (Drive)', 'Dữ liệu đơn (JSON)', 'Dữ liệu khách (JSON)'
    ]);

    const order = body.order;
    const customer = body.customer || {};
    const imageLinks = (body.images || []).map((image, index) => saveImage_(image, order, index)).filter(Boolean);
    sheet.appendRow([
      new Date(), order.code || order.id, order.status || '', order.customerName || customer.name || '',
      order.customerPhone || customer.phone || '', order.productName || '', Number(order.total || 0),
      Number(order.amountPaid || 0), Number(order.balanceDue || 0), order.saleName || order.saleId || '',
      order.leaderId || '', order.managerId || '', order.paymentMethod || '', order.bankReference || '',
      order.createdAt || '', imageLinks.join('\n'), JSON.stringify(order), JSON.stringify(customer)
    ]);
    eventSheet.appendRow([body.eventId, new Date()]);
    return json_({ ok: true, eventId: body.eventId, imageCount: imageLinks.length });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  } finally { lock.releaseLock(); }
}

function saveImage_(image, order, index) {
  const data = String(image?.data || '');
  const match = data.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return '';
  const folder = getFolder_();
  const bytes = Utilities.base64Decode(match[2]);
  const name = `${order.code || order.id}-${index + 1}-${String(image.fileName || 'bill.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const file = folder.createFile(Utilities.newBlob(bytes, match[1], name));
  if (image.note) file.setDescription(String(image.note));
  return file.getUrl();
}

function getFolder_() {
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER);
}
