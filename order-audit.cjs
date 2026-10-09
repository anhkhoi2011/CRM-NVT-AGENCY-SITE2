'use strict';
const crypto=require('node:crypto');
const payments=require('./order-payments.js');
const SOURCE='ORDER_SQL';
const LEGACY_ACTIONS=new Set(['CREATE_ORDER','EDIT_ORDER','UPDATE_ACCOUNTING_ORDER','COLLECT_ORDER_DEBT','UPDATE_RECEIPT_IMAGES','RECONCILE_ORDER','ISSUE_VAT','DELETE_ACCOUNTING_ORDER','PAYMENT_CONFIRMED','DEPOSIT_CONFIRMED','ORDER_REFUNDED','CANCEL_ORDER']);
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function isOrder(row,data){return row.source===SOURCE||LEGACY_ACTIONS.has(row.action)&&data.orders.has(row.entity);}
// Derive events only from the accepted, complete SQL rows and authenticated actor.
// Image bytes stay in the order; logs record image IDs and note changes.
function events(user,before,after,requestId,at=new Date().toISOString()){
 const order=after||before;if(!order||same(before,after))return [];
 const out=[],amount=v=>Number(v||0).toLocaleString('vi-VN')+' đ';
 const add=(action,detail,extra={})=>out.push({id:'OA-'+crypto.randomBytes(16).toString('hex'),source:SOURCE,orderId:order.id,entity:order.id,orderCode:order.code||order.id,customerName:order.customerName||'',saleId:order.saleId||'',actorId:user.id,actor:user.name||user.accountId||user.id,role:user.role,at,requestId,action,detail,...extra});
 if(!after){add('DELETE_ORDER','Xóa đơn '+(order.code||order.id));return out;}
 if(!before)add('CREATE_ORDER','Tạo đơn · Tổng tiền '+amount(after.total));
 const oldReceipts=new Map((before?payments.receipts(before):[]).map(r=>[r.id,r]));
 for(const receipt of payments.receipts(after)){
  const old=oldReceipts.get(receipt.id),images=payments.images(receipt),previous=old?payments.images(old):[];
  const extra={receiptId:receipt.id,amount:Number(receipt.amount||0),receiptKind:receipt.kind||'PAYMENT'};
  if(!old){add('CREATE_BILL','Ghi nhận lần thu '+amount(receipt.amount)+' · '+images.length+' ảnh bill',{...extra,imageCount:images.length});continue;}
  const changes=[],oldImages=new Map(previous.map(image=>[image.id,image])),newImages=new Map(images.map(image=>[image.id,image]));
  for(const image of images){
   const prior=oldImages.get(image.id);
   if(!prior)changes.push({field:image.id,label:'Thêm ảnh bill',before:null,after:image.note||''});
   else{if(prior.imageData!==image.imageData)changes.push({field:image.id,label:'Thay ảnh bill',before:'Ảnh cũ',after:'Ảnh mới'});if((prior.note||'')!==(image.note||''))changes.push({field:image.id,label:'Ghi chú ảnh bill',before:prior.note||'',after:image.note||''});}
  }
  for(const image of previous)if(!newImages.has(image.id))changes.push({field:image.id,label:'Xóa ảnh bill',before:image.note||'',after:null});
  for(const field of ['amount','kind','bankReference','note'])if(!same(old[field],receipt[field]))changes.push({field,label:({amount:'Số tiền thu',kind:'Loại thanh toán',bankReference:'Mã giao dịch',note:'Ghi chú lần thu'})[field],before:old[field]??null,after:receipt[field]??null});
  if(changes.length)add('UPDATE_BILL','Cập nhật bill · '+amount(receipt.amount)+' · '+previous.length+' → '+images.length+' ảnh',{...extra,imageCount:images.length,changes});
  oldReceipts.delete(receipt.id);
 }
 for(const receipt of oldReceipts.values())add('DELETE_BILL','Xóa lần thu '+amount(receipt.amount),{receiptId:receipt.id,amount:Number(receipt.amount||0),imageCount:payments.images(receipt).length});
 if(before){
  const fields={customerName:'Khách hàng',customerPhone:'Điện thoại',productName:'Sản phẩm',productId:'Mã sản phẩm',saleId:'Sale phụ trách',total:'Tổng tiền',subtotal:'Trước VAT',vatAmount:'Tiền VAT',qty:'Số lượng',discount:'Giảm giá',saleNote:'Ghi chú đơn',note:'Ghi chú',paymentMethod:'Phương thức thanh toán',paymentReference:'Nội dung chuyển khoản',companyName:'Tên công ty',taxCode:'Mã số thuế',requireVat:'Yêu cầu VAT',reconciliationNote:'Ghi chú đối soát',refund:'Tiền hoàn',refundReason:'Lý do hoàn',vatInvoiceNumber:'Số hóa đơn'};
  const changes=Object.entries(fields).filter(([field])=>!same(before[field],after[field])).map(([field,label])=>({field,label,before:before[field]??null,after:after[field]??null}));
  for(const field of ['name','cccd','phone','email','address','taxId'])if(!same(before.billing?.[field],after.billing?.[field]))changes.push({field:'billing.'+field,label:({name:'Tên trên hóa đơn',cccd:'CCCD',phone:'Điện thoại hóa đơn',email:'Email hóa đơn',address:'Địa chỉ',taxId:'MST hóa đơn'})[field],before:before.billing?.[field]??null,after:after.billing?.[field]??null});
  if(before.status!==after.status)add('ORDER_STATUS','Trạng thái đơn: '+before.status+' → '+after.status,{changes:[{field:'status',label:'Trạng thái',before:before.status,after:after.status}]});
  if(before.paymentReconciled!==after.paymentReconciled&&(before.paymentReconciled||after.paymentReconciled))add('RECONCILE_ORDER',after.paymentReconciled?'Xác nhận đối soát đủ · '+amount(payments.paid(after))+(after.reconciliationNote?' · '+after.reconciliationNote:''):'Hủy xác nhận đối soát');
  if(before.vatIssued!==after.vatIssued&&(before.vatIssued||after.vatIssued))add('ISSUE_VAT',after.vatIssued?'Xác nhận xuất VAT · '+(after.vatInvoiceNumber||''):'Hủy xác nhận xuất VAT');
  if(!before.refundedAt&&after.refundedAt)add('ORDER_REFUNDED','Xác nhận hoàn tiền · '+amount(after.refund));
  if(changes.length)add('UPDATE_ORDER','Cập nhật thông tin đơn · '+changes.map(c=>c.label).join(', '),{changes});
 }
 return out;
}
function page(items,page=1,limit=50,filters={}){
 const orderId=String(filters.orderId||''),search=String(filters.search||'').trim().toLocaleLowerCase('vi'),actorId=String(filters.actorId||''),action=String(filters.action||'');
 const trusted=new Set(items.filter(row=>row.source===SOURCE&&row.requestId).map(row=>JSON.stringify([row.requestId,row.orderId])));
 const time=row=>{const raw=String(row.at||'');return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)?raw.replace(' ','T')+'+07:00':raw)||0;};
 const all=items.filter(row=>!(row.source!==SOURCE&&row.requestId&&trusted.has(JSON.stringify([row.requestId,row.entity])))&&(!orderId||(row.orderId||row.entity)===orderId)&&(!actorId||row.actorId===actorId)&&(!action||row.action===action)&&(!search||[row.orderCode,row.customerName,row.actor,row.actorId,row.detail,row.entity].join(' ').toLocaleLowerCase('vi').includes(search))).sort((a,b)=>time(b)-time(a)||String(b.id||'').localeCompare(String(a.id||'')));
 const integer=(v,fallback)=>Number.isFinite(Number(v))?Math.floor(Number(v))||fallback:fallback;
 const safePage=Math.max(1,integer(page,1)),safeLimit=Math.min(200,Math.max(1,integer(limit,50)));
 return {items:all.slice((safePage-1)*safeLimit,safePage*safeLimit),page:safePage,limit:safeLimit,total:all.length,hasMore:all.length>safePage*safeLimit};
}
module.exports={SOURCE,isOrder,events,page};
