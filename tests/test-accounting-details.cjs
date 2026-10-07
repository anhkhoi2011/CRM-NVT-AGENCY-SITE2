 'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Detail=require('../accounting-detail.js');
function input(){return {
 period:'2026-10',products:[{id:'p',name:'Khóa học'}],customers:[{id:'c',name:'Nguyễn Ánh'}],members:[{id:'s',name:'Sale'}],
 orders:[{id:'o',code:'NVT-01',customerId:'c',productId:'p',receiptsVersion:1,total:1100,vatAmount:100,paymentReceipts:[
  {id:'sep',kind:'DEPOSIT',at:'2026-09-30',amount:220},{id:'oct',kind:'FULL',at:'2026-10-01',amount:880}
 ],refund:110,refundedAt:'2026-10-02'}],
 personnel:[{id:'s',name:'Đỗ An',roleLevel:'LV3',finance:{hhLot:50,hhDownline:10,hhSaleProducts:70,hhTrainer:20,hhLeaderCourse:10,bonus:5,netIncome:165}},
 {id:'empty',name:'Chưa có hoa hồng',finance:{netIncome:0}}],
 expenses:[{date:'2026-10-05',title:'Máy chủ',category:'Hạ tầng',payer:'Admin',amount:100},{month:'2026-10',date:'2026-09-30',title:'Ads',category:'Marketing',amount:50},{date:'2026-09-20',title:'Tháng trước',amount:900}],
 groups:[{name:'Khóa học',categoryLabel:'Đào tạo',cohortKey:'K01',totalRevenue:700}]
};}
test('Accounting detail uses receipt month and refunds with VAT separated, with newest rows first',()=>{
 const data=Detail.snapshot(input());assert.equal(data.revenue.length,2);assert.equal(data.revenue[0].kind,'Hoàn tiền');
 assert.equal(data.cash,770);assert.equal(data.vat,70);assert.equal(data.totalRevenue,700);
 assert.equal(data.revenue[1].customer,'Nguyễn Ánh');assert.equal(data.revenue[1].product,'Khóa học');
 assert.equal(Detail.sum(Detail.table(data,'revenue').rows,'net'),data.totalRevenue);
 const september=Detail.snapshot({...input(),period:'2026-09'});assert.equal(september.totalRevenue,200);assert.equal(september.revenue.length,1);
});
test('Accounting detail reconciles commissions, full period expenses and every P&L component',()=>{
 const data=Detail.snapshot(input());assert.equal(data.totalCommission,165);assert.equal(data.commissions.length,1);assert.equal(data.commissions[0].lot,60);
 assert.equal(data.totalExpense,150);assert.equal(data.operating.length,2);assert.equal(data.netProfit,385);
 assert.equal(Detail.sum(data.profit,'amount'),data.netProfit);
 assert.equal(Detail.table(data,'profit').total,data.netProfit);assert.equal(Detail.table(data,'expense').total,150);
 assert.equal(data.margin,385/700*100);
});
test('Accounting detail supports all periods, empty data and losses without invalid percentages',()=>{
 const all=Detail.snapshot({...input(),period:'ALL',groups:[]});assert.equal(all.totalRevenue,900);assert.equal(all.totalExpense,1050);
 assert.equal(all.netProfit,-315);assert.equal(Detail.sum(all.profit,'amount'),all.netProfit);
 const empty=Detail.snapshot({period:'2026-11'});assert.equal(empty.margin,0);assert.equal(empty.netProfit,0);
 for(const type of ['revenue','commission','expense','profit'])assert.equal(Detail.table(empty,type).rows.length,0);
 const loss=Detail.snapshot({period:'2026-10',expenses:[{date:'2026-10-02',amount:100}]});assert.equal(loss.netProfit,-100);assert.equal(loss.margin,0);
});
test('Detail search accepts Vietnamese names with or without diacritics and preserves the period total',()=>{
 const data=Detail.snapshot(input()),table=Detail.table(data,'commission');assert.equal(Detail.filter(table,'do an').length,1);
 assert.equal(Detail.filter(table,'Đỗ An').length,1);assert.equal(Detail.filter(table,'  ').length,1);assert.equal(Detail.filter(table,'khong co').length,0);
 assert.equal(Detail.filter(Detail.table(data,'revenue'),'nguyen anh').length,2);assert.equal(table.total,165);
 assert.equal(Detail.filter(Detail.table(data,'expense'),'ha tang').length,1);
});
