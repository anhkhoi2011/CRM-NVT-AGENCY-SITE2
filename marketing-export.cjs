'use strict';
const MarketingHub = require('./marketing-hub.js');
function finiteAmount(value) { if(value==null || value==='')return null;const amount=Number(value);return Number.isFinite(amount)&&amount>=0?amount:null; }
function normalizePhoneForApi(value) {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  if (!digits.startsWith('0') && digits.length === 9) digits = '0' + digits;
  return digits;
}
function parseCrmTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T]\d{2}:\d{2})/);
  if(!match)return NaN;
  const [,year,month,day]=match.map(Number);if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return NaN;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return Date.parse(raw + 'T00:00:00+07:00');
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(iso) ? iso : iso + '+07:00');
}
function normalizeApiTimestamp(value) {
  const ms = parseCrmTimestamp(value);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ms)).reduce((out, item) => (out[item.type] = item.value, out), {});
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + '+07:00';
}
function formatLeadPayload(c, memberMap, ordersByCust, notesByCustomer) {
  const cf = c.customFields && typeof c.customFields === 'object' ? c.customFields : {};
  const orders = ordersByCust.get(String(c.id)) || [];

  const revenue = orders.reduce((sum, order) => sum + MarketingHub.orderCollected(order), 0);

  const ownNotes = notesByCustomer.get(String(c.id)) || [];
  const fallbackNotes = [...(Array.isArray(c.notes) ? c.notes : []),...(c.note?[c.note]:[])];
  const notes = [...ownNotes, ...fallbackNotes.map(note => typeof note === 'string' ? { content: note, created_at: c.updatedAt || c.updated_at || c.createdAt || c.created_at } : note)].map(note => ({
    content: String(note?.content ?? note?.text ?? note?.note ?? ''),
    created_at: normalizeApiTimestamp(note?.createdAt || note?.created_at || note?.at || c.updatedAt || c.updated_at || c.createdAt || c.created_at)
  })).filter(note => note.content).filter((note,index,list)=>list.findIndex(other=>other.content===note.content && other.created_at===note.created_at)===index);
  notes.sort((a,b)=>(parseCrmTimestamp(a.created_at)||0)-(parseCrmTimestamp(b.created_at)||0));
  const saleId = c.saleId || c.sale_id;
  const callStatus = cf.callStatus || cf.call_status || c.call_status || cf.goi_ket_noi || c.goi_ket_noi || cf.ket_qua_cham_soc || c.ket_qua_cham_soc || cf.result || c.result || null;
  const customerClass = cf.customerClass || cf.phan_loai_khach_hang || c.customerClass || c.phan_loai_khach_hang || null;
  const level = cf.customerLevel || cf.level_khach_hang || c.level_khach_hang || c.level || null;
  return {
    phone: c.phone || '', name: c.name || '', sale: saleId ? (memberMap.get(String(saleId)) || saleId) : (c.saleName || null),
    level, status: customerClass, call_status: callStatus,
    created_at: normalizeApiTimestamp(c.createdAt || c.created_at), updated_at: normalizeApiTimestamp(c.updatedAt || c.updated_at || c.createdAt || c.created_at),
    source: c.source || c.campaign || null, goi_ket_noi: cf.goi_ket_noi || c.goi_ket_noi || callStatus,
    first_call_at: normalizeApiTimestamp(cf.first_call_at || c.first_call_at || c.firstCallAt), ket_qua_cham_soc: cf.ket_qua_cham_soc || c.ket_qua_cham_soc || cf.result || c.result || null,
    level_khach_hang: level, phan_loai_khach_hang: customerClass, tinh_trang_nhan_tai_lieu: cf.documentStatus || cf.tinh_trang_nhan_tai_lieu || null,
    course: cf.course ? (Array.isArray(cf.course) ? cf.course.join(', ') : cf.course) : null,
    province: cf.province || c.province || cf.tinh_thanh || c.city || null, age: cf.age ?? c.age ?? null, birth_year: cf.birth_year ?? c.birth_year ?? null,
    age_range: cf.age_range || c.age_range || null, gender: cf.gender || c.gender || null, job: cf.job || c.job || null, revenue: revenue,
    capital_range: cf.capital_range || c.capital_range || null, experience: cf.experience || c.experience || null, market_interest: cf.market_interest || c.market_interest || null,
    main_interest: cf.main_interest || c.main_interest || null, main_objection: cf.main_objection || c.main_objection || null,
    deposit_amount: finiteAmount(cf.deposit_amount ?? c.deposit_amount),
    deposit_currency: cf.deposit_currency || c.deposit_currency || ((cf.deposit_amount ?? c.deposit_amount) != null ? 'VND' : null),
    first_deposit_at: normalizeApiTimestamp(cf.first_deposit_at || c.first_deposit_at),
    device_info: cf.device_info || c.device || c.device_info || null,
    custom_fields: { ...cf }, notes
  };
}

module.exports = { normalizePhoneForApi, parseCrmTimestamp, normalizeApiTimestamp, formatLeadPayload };
