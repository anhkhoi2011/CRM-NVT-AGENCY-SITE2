'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../reference-crm.js'),'utf8');
const ctx=vm.createContext({OrderPayments:require('../order-payments.js')});
vm.runInContext(source.slice(source.indexOf('  function isWebhookDataCustomer('),source.indexOf('  function renderManagementDataTable('))+source.slice(source.indexOf('  function dashboardCohortStats('),source.indexOf('  function renderDashboardCohortStats(')),ctx);
test('Dashboard cohorts include unused and unselected cohorts, distinct buyers and webhook-only data',()=>{
 const customers=[{id:'a',webhookEventId:'event',customFields:{batch:'K03'}},{id:'b',manualEntry:true,customFields:{batch:'K03'}},{id:'c',source:'CSV',customFields:{}},{id:'d',webhookSlug:'site',customFields:{}},{id:'e',source:'Landing Page',customFields:{batch:'K07'}},{id:'f',source:'Nhập đơn hàng',createdVia:'ORDER',customFields:{batch:'K01'}}];
 const paid=(id,customerId,status='PAID')=>({id,customerId,status,total:100,amountPaid:100});
 const orders=[paid('a1','a'),paid('a2','a'),{id:'b1',customerId:'b',status:'DEPOSIT',total:100,amountPaid:30},paid('c1','c'),paid('d1','d','CANCELLED'),paid('e1','e','REFUNDED'),{id:'f1',customerId:'f',status:'PENDING',total:100},paid('hidden','outside')];
 const field={id:'batch',options:[{value:'K03'},{value:'K01'},{value:'K02'}]};const before=JSON.stringify({customers,orders,field});
 const result=ctx.dashboardCohortStats(customers,orders,field);assert.deepEqual(Array.from(result.rows,r=>r.key),['K01','K02','K03','K07','']);
 const row=key=>result.rows.find(r=>r.key===key);
 assert.equal(row('K03').webhook,1);assert.equal(row('K03').buyers,2);assert.equal(row('K03').webhookBuyers,1);
 assert.equal(row('K02').webhook,0);assert.equal(row('K02').buyers,0);
 assert.equal(row('').webhook,1);assert.equal(row('').buyers,1);assert.equal(row('').webhookBuyers,0);
 assert.equal(result.totals.webhook,3);assert.equal(result.totals.buyers,3);assert.equal(result.totals.webhookBuyers,1);
 assert.equal(JSON.stringify({customers,orders,field}),before);
});
test('Dashboard cohort totals stay unique for multiple cohort values and missing field',()=>{
 const customers=[{id:'a',webhookSlug:'site',customFields:{batch:['K01','K01','K02']}}];const orders=[{customerId:'a',status:'PAID',amountPaid:100,total:100}];
 const result=ctx.dashboardCohortStats(customers,orders,{id:'batch',options:[]});assert.equal(result.totals.buyers,1);assert.equal(result.rows.find(r=>r.key==='K01').buyers,1);assert.equal(result.rows.find(r=>r.key==='K02').buyers,1);
 const missing=ctx.dashboardCohortStats(customers,orders,null);assert.equal(missing.rows.length,1);assert.equal(missing.rows[0].key,'');assert.equal(missing.rows[0].buyers,1);
});
