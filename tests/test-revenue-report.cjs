'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const payments=require('../order-payments.js');
const source=fs.readFileSync(path.join(__dirname,'../reference-crm.js'),'utf8');

function report(orders,products=[]){
 const nodes=new Map(),tables=new Map();
 const q=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#revStartDate'?'2026-10-01':id==='#revEndDate'?'2026-10-12':'',textContent:'',rows:[],closest:()=>null,setAttribute(){}});return nodes.get(id);};
 const ctx=vm.createContext({data:{today:'2026-10-12',user:{role:'ADMIN'},orders,products,financialEvents:orders.flatMap(payments.events),customers:[],websites:[]},q,money:String,fmtDate:String,person:String,internalCode:String,qa:()=>[],fromDay:days=>{const date=new Date(Date.parse('2026-10-12T00:00:00Z'));date.setUTCDate(date.getUTCDate()-days+1);return date.toISOString().slice(0,10);},text:(id,value)=>{q('#'+id).textContent=value;},table:(node,rows)=>tables.set(node,rows)});
 vm.runInContext(source.slice(source.indexOf('  let revenuePeriod=30;'),source.indexOf('  setRevenueDonutPeriod=',source.indexOf('  let revenuePeriod=30;'))),ctx);
 return {ctx,q,tables,summary:(from='2026-10-01',to='2026-10-12')=>ctx.revenueRangeSummary(from,to)};
}

test('Revenue cards and ledger use saved VAT allocation for the seven orders totalling 41 million',()=>{
 const orders=[6000000,6000000,6000000,6000000,6000000,6000000,5000000].map((amount,index)=>({id:'order-'+index,customerId:'customer-'+index,status:'PAID',paidAt:'2026-10-10',...payments.amounts({total:amount})}));
 const f=report(orders),summary=f.summary();
 assert.equal(summary.total,41000000);assert.equal(summary.tax,3727275);assert.equal(summary.afterTax,37272725);assert.equal(summary.courseCount,7);
 f.ctx.renderRevenue();assert.equal(f.q('#revStatAov').textContent,'37272725');assert.equal(f.q('#revNetAmountFooter').textContent,'37272725');assert.equal(f.q('#revGrossAmountFooter').textContent,'41000000');assert.equal(f.q('#revDonutVatAmount').textContent,'3727275');
 assert.equal(f.q('#revRentalCountBadge').textContent,'0 khách đang thuê');assert.equal(f.tables.get(f.q('#revenueSalesTableBody')).length,7);
});

test('Deposit, remaining payment and refund are counted only in their receipt periods',()=>{
 const order={id:'split',status:'REFUNDED',total:5500000,subtotal:5000000,vatAmount:500000,receiptsVersion:1,paymentReceipts:[{id:'deposit',kind:'DEPOSIT',amount:500000,at:'2026-09-30'},{id:'remaining',kind:'FULL',amount:5000000,at:'2026-10-02'}],refund:1100000,refundedAt:'2026-10-10'};
 const f=report([order]),sept=f.summary('2026-09-01','2026-09-30'),oct=f.summary();
 assert.equal(sept.total,500000);assert.equal(sept.afterTax,454545);assert.equal(oct.total,3900000);assert.equal(oct.afterTax,3545455);
 assert.equal(f.summary('','').afterTax,4000000);assert.equal(oct.events.length,2);
});

test('Rental rows, badge and footer agree and exclude expired, cancelled and future contracts',()=>{
 const base={status:'PAID',rentalMonths:1,total:1100000,subtotal:1000000,vatAmount:100000,paidAt:'2026-10-01',rentalEndsAt:'2026-10-31'};
 const orders=[{...base,id:'active',customerId:'c1'},{...base,id:'expired',customerId:'c2',rentalEndsAt:'2026-10-11'},{...base,id:'cancelled',customerId:'c3',status:'CANCELLED'},{...base,id:'future',customerId:'c4',paidAt:'2026-10-13'}];
 const f=report(orders);f.ctx.renderRevenue();assert.equal(f.summary().rentalCustomers,1);assert.equal(f.q('#revRentalCountBadge').textContent,'1 khách đang thuê');assert.equal(f.q('#revRentalCountFooter').textContent,'1 khách');assert.equal(f.tables.get(f.q('#rentalCustomersTableBody')).length,1);
});

test('Comparison period immediately precedes the chosen range without losing a day to UTC conversion',()=>{
 const f=report([{id:'previous',status:'PAID',paidAt:'2026-09-30',total:1100000,subtotal:1000000,vatAmount:100000}]);
 const ranges=[],base=f.ctx.revenueRangeSummary;f.ctx.revenueRangeSummary=(from,to)=>{ranges.push([from,to]);return base(from,to);};
 f.ctx.renderRevenue();assert.deepEqual(ranges,[['2026-10-01','2026-10-12'],['2026-09-19','2026-09-30']]);
});

test('Invalid or stale demo dates fall back to the last 30 days instead of filtering real revenue',()=>{
 const order={id:'recent',status:'PAID',paidAt:'2026-10-10',total:1100000,subtotal:1000000,vatAmount:100000};
 const f=report([order]);
 f.q('#revStartDate').value='2026-09-15';f.q('#revEndDate').value='2026-09-01';
 const ranges=[],base=f.ctx.revenueRangeSummary;f.ctx.revenueRangeSummary=(from,to)=>{ranges.push([from,to]);return base(from,to);};
 f.ctx.renderRevenue();
 assert.deepEqual(ranges[0],['2026-09-13','2026-10-12']);
 assert.equal(f.q('#revStartDate').value,'2026-09-13');assert.equal(f.q('#revEndDate').value,'2026-10-12');
 assert.equal(f.q('#revDonutCenterAmount').textContent,'1100000');assert.equal(f.q('#revGrossAmountFooter').textContent,'1100000');
});
