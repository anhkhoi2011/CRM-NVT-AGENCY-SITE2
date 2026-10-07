'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),model=require('../crm-notifications.js');
test('Notifications have exactly four categories; unrelated legacy alerts stay outside the hub',()=>{
 assert.equal(Object.keys(model.labels).length,4);
 for(const [title,kind] of [['Data mới được phân','DATA_ARRIVAL'],['Data moi duoc phan','DATA_ARRIVAL'],['Khách mới trong tuyến','DATA_ARRIVAL'],['Có đơn hàng thanh toán cần kiểm tra','PAYMENT_REVIEW'],['Đã xác nhận đơn hàng thanh toán thành công','PAYMENT_CONFIRMED'],['Data Sale không nhận trong 24 giờ','DATA_UNRECEIVED_24H'],['Sắp hết hạn thuê',null],['Sale điểm danh muộn',null],['Telegram - lịch họp',null]])assert.equal(model.kind({title}),kind,title);
 assert.equal(model.kind({kind:'PAYMENT_CONFIRMED',title:'Order o1'}),'PAYMENT_CONFIRMED');
});
test('Newest-first ordering normalizes Vietnam local timestamps and ISO offsets, keeps read notices, hides deleted notices only for that viewer',()=>{
 const rows=[{id:'old',kind:'DATA_ARRIVAL',at:'2026-10-06 23:59'}, {id:'middle',kind:'PAYMENT_REVIEW',at:'2026-10-07T00:00:00Z',readBy:['viewer']}, {id:'new',kind:'PAYMENT_CONFIRMED',at:'2026-10-07 08:01'}, {id:'deleted',kind:'DATA_UNRECEIVED_24H',at:'2026-10-07T03:00:00Z',deletedBy:['viewer']}];
 assert.deepEqual(model.list(rows,'viewer').map(n=>n.id),['new','middle','old']);
 assert.equal(model.list(rows,'other')[0].id,'deleted');assert.equal(rows[0].id,'old');
});

test('Notification display uses Vietnam time for both local and UTC timestamps',()=>{
 assert.equal(model.formatTime('2026-10-07T03:47:24Z'),model.formatTime('2026-10-07 10:47:24'));
 assert.match(model.formatTime('2026-10-07T03:47:24Z'),/10:47/);assert.match(model.formatTime('2026-10-07T03:47:24Z'),/07\/10\/2026/);
 assert.equal(model.formatTime('invalid'),'—');
});
