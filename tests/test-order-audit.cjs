'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const audit=require('../order-audit.cjs');
const actor={id:'accountant',name:'Kế toán',role:'ACCOUNTING'};
const receipt={id:'receipt',amount:110,kind:'FULL',at:'2026-10-09T02:00:00Z',images:[{id:'a',imageData:'data:image/png;base64,AA==',note:'Gốc'},{id:'b',imageData:'data:image/png;base64,BB==',note:'Xóa'}]};
const order={id:'order',code:'NVT-TEST',customerName:'Khách hàng',saleId:'sale',total:110,status:'PAID',receiptsVersion:1,paymentReceipts:[receipt]};
test('Image history describes add, remove, replacement and note edits without copying image bytes',()=>{
 const after={...order,paymentReceipts:[{...receipt,images:[{id:'a',imageData:'data:image/png;base64,CC==',note:'Mới'},{id:'c',imageData:'data:image/png;base64,DD==',note:'Thêm'}]}]};
 const events=audit.events(actor,order,after,'request'),bill=events.find(event=>event.action==='UPDATE_BILL');
 assert.deepEqual(bill.changes.map(change=>change.label),['Thay ảnh bill','Ghi chú ảnh bill','Thêm ảnh bill','Xóa ảnh bill']);assert.equal(bill.receiptId,'receipt');assert.equal(bill.imageCount,2);assert.doesNotMatch(JSON.stringify(events),/data:image/);
});
test('Confirming reconciliation records the authenticated actor and server timestamp without changing receipts',()=>{
 const after={...order,paymentReconciled:true,paymentReconciledBy:'spoof',paymentReconciledAt:'2000-01-01',reconciliationNote:'Khớp ngân hàng'};
 const events=audit.events(actor,order,after,'request','2026-10-09T03:45:12Z'),event=events.find(event=>event.action==='RECONCILE_ORDER');
 assert.equal(event.actorId,actor.id);assert.equal(event.role,'ACCOUNTING');assert.equal(event.at,'2026-10-09T03:45:12Z');assert.equal(events.some(event=>event.action.includes('BILL')),false);assert.deepEqual(after.paymentReceipts,order.paymentReceipts);
});
test('Audit pagination filters and sorts Vietnam local and ISO times and suppresses duplicate browser events',()=>{
 const items=[{id:'old',entity:'order',action:'CREATE_ORDER',at:'2026-10-09 09:00:00',actorId:'sale'},...audit.events(actor,null,order,'create','2026-10-09T03:00:00Z'),{id:'browser-copy',entity:'order',action:'CREATE_ORDER',requestId:'create',at:'2026-10-09 10:00:00'}];
 const page=audit.page(items,1,1,{orderId:'order'});assert.equal(page.total,3);assert.equal(page.hasMore,true);assert.equal(page.items[0].source,audit.SOURCE);
 assert.equal(audit.page(items,1,50,{actorId:'sale'}).total,1);assert.equal(audit.page(items,1,50,{search:'khách hàng'}).total,2);assert.equal(audit.page(items,Infinity,Infinity).limit,50);
});
test('No-op saves do not invent history and deletion retains order identity',()=>{
 assert.deepEqual(audit.events(actor,order,structuredClone(order),'noop'),[]);const event=audit.events(actor,order,null,'delete')[0];assert.equal(event.orderId,order.id);assert.equal(event.orderCode,order.code);assert.equal(event.action,'DELETE_ORDER');
});
