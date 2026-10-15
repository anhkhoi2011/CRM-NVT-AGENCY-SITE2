'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../commission_tree_demo.html'), 'utf8');
function model() {
 const ctx = vm.createContext({window:{},OrderPayments:require('../order-payments.js')});
 const start = html.indexOf('  function rebuildAccountingRevenueFromCRM()');
 const end = html.indexOf('  function syncTeamMembersFromCRM(', start);
 vm.runInContext('var ACCOUNTING_CRM_STATE={products:[],orders:[],courseConfigs:[],brokerageMetrics:[]}; var currentGlobalMonth="2026-10"; var COURSES_DATA=[]; var APEX_DATA=[{id:"sale-1"}];'+html.slice(start,end), ctx);
 return ctx;
}
test('Accounting inline scripts parse without syntax errors', () => {
 for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('VAT order table shows copyable CCCD, address and phone columns', () => {
 assert.match(html, /<th style=\"width:125px;\">CCCD<\/th>/);
 assert.match(html, /<th style="min-width:190px;">[^<]*<\/th>/);
 assert.match(html, /class=\"order-copy-field\"/);
 assert.match(html, /copyOrderField\(this\)/);
 assert.match(html, /data-copy-value=\"\$\{escapeOrderContact\(text\)\}\"/);
});
test('Accounting starts empty with no sample financial datasets', () => {
 for (const name of ['APEX_DATA','COURSES_DATA','VAT_ORDERS_DATA','ADMIN_EXPENSES_DATA']) assert.ok(html.includes('let '+name+' = [];'), name);
 assert.doesNotMatch(html,/448\.500\.000|231\.500\.000|117\.000\.000|MONTHLY_REVENUE_COMMISSION|MONTH_FACTORS/);
 const ctx=model(); ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.length,0); assert.equal(ctx.APEX_DATA[0].courseRev,0);
});
test('Only paid CRM orders count, grouped by category, employee and paid month', () => {
 const ctx=model();
 ctx.ACCOUNTING_CRM_STATE.products=[{id:'c',kind:'COURSE'},{id:'i',kind:'INDICATOR'},{id:'v',kind:'VIP'}];
 ctx.ACCOUNTING_CRM_STATE.orders=[
  {id:'1',productId:'c',saleId:'sale-1',subtotal:125,status:'PAID',vatIssued:true,createdAt:'2026-09-01',paidAt:'2026-10-01'},
  {id:'2',productId:'i',saleId:'sale-1',subtotal:75,status:'PAID',vatIssued:true,paidAt:'2026-10-01'},
  {id:'3',productId:'v',saleId:'sale-2',subtotal:50,status:'PAID',vatIssued:true,paidAt:'2026-10-01'},
  {id:'4',productId:'c',saleId:'sale-1',subtotal:900,status:'DEPOSIT',paidAt:'2026-10-01'},
  {id:'5',productId:'c',saleId:'sale-1',subtotal:30,status:'PAID',vatIssued:true,paidAt:'2026-09-01'}
 ];
 ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.reduce((sum,c)=>sum+c.totalRevenue,0),250);
 assert.equal(ctx.APEX_DATA[0].courseRev,125); assert.equal(ctx.APEX_DATA[0].indicatorRev,75); assert.equal(ctx.APEX_DATA[0].vipRev,0);
 ctx.currentGlobalMonth='2026-09'; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA[0].totalRevenue,30); assert.equal(ctx.APEX_DATA[0].indicatorRev,0);
 ctx.currentGlobalMonth='ALL'; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.reduce((sum,c)=>sum+c.totalRevenue,0),280);
 ctx.ACCOUNTING_CRM_STATE.orders=[]; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.length,3); assert.ok(ctx.COURSES_DATA.every(g=>g.totalRevenue===0)); assert.equal(ctx.APEX_DATA[0].courseRev,0);
});
test('Only VAT-issued orders generate product commissions',()=>{
 const ctx=model();ctx.ACCOUNTING_CRM_STATE.products=[{id:'c',kind:'COURSE'}];ctx.ACCOUNTING_CRM_STATE.courseField={id:'batch'};ctx.ACCOUNTING_CRM_STATE.customers=[{id:'c1',customFields:{batch:'K03'}}];ctx.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'c',courseKey:'K03',rateSale:10,trainerIds:['trainer'],trainerRates:{trainer:15},leaderIds:['leader'],rateLeader:5}];
 ctx.ACCOUNTING_CRM_STATE.orders=[{id:'o',customerId:'c1',productId:'c',saleId:'sale-1',status:'PAID',subtotal:1000,paidAt:'2026-10-01'}];ctx.rebuildAccountingRevenueFromCRM();
 const pending=ctx.COURSES_DATA.find(g=>g.cohortKey==='K03');assert.equal(pending.totalRevenue,1000);assert.equal(pending.commissionRevenue,0);assert.equal(Object.keys(pending.salesConfig).length,0);assert.equal(ctx.APEX_DATA[0].courseRev,1000);
 ctx.ACCOUNTING_CRM_STATE.orders[0].vatIssued=true;ctx.rebuildAccountingRevenueFromCRM();const issued=ctx.COURSES_DATA.find(g=>g.cohortKey==='K03');assert.equal(issued.commissionRevenue,1000);assert.equal(issued.salesConfig['sale-1'].revenue,1000);assert.equal(ctx.APEX_DATA[0].courseRev,1000);
});
test('Lot and bonus values come only from CRM metrics for the selected period', () => {
 const ctx=model();
 ctx.ACCOUNTING_CRM_STATE.brokerageMetrics=[{memberId:'sale-1',period:'2026-10',basicLots:2,bonus:100},{memberId:'sale-1',period:'2026-09',basicLots:7,bonus:50}];
 ctx.rebuildAccountingRevenueFromCRM(); assert.equal(ctx.APEX_DATA[0].basicLot,2); assert.equal(ctx.APEX_DATA[0].bonus,100);
 ctx.currentGlobalMonth='2026-08'; ctx.rebuildAccountingRevenueFromCRM(); assert.equal(ctx.APEX_DATA[0].basicLot,0); assert.equal(ctx.APEX_DATA[0].bonus,0);
});

test('Demo startup never creates paid sample orders or accounting configuration', () => {
 const server = fs.readFileSync(require('node:path').join(__dirname, '../webhook-server.cjs'), 'utf8');
 const start = server.indexOf('function seedDemoWorkspace()');
 const end = server.indexOf('\nseedDemoWorkspace();', start);
 assert.ok(start >= 0 && end > start);
 const demoState = Object.fromEntries(['members','customers','products','productCategories','customFieldDefinitions','orders','expenses','courseConfigs','dataOffers','careGroups','notifications','attendance','tasks'].map(key=>[key,[]]));
 const ctx = vm.createContext({DEMO_MODE:true,demoState,demoPasswords:{}});
 vm.runInContext(server.slice(start,end),ctx);
 ctx.seedDemoWorkspace();
 assert.equal(demoState.orders.length,0);
 assert.equal(demoState.courseConfigs.length,0);
 assert.equal(demoState.dataOffers.filter(offer=>offer.status==='PENDING').length,2);
 assert.ok(demoState.dataOffers.every(offer=>Date.parse(offer.offeredAt.replace(' ','T')+'+07:00')+24*3600000>Date.now()));
 demoState.orders.push({id:'user-created-order',status:'PAID',subtotal:500});
 ctx.seedDemoWorkspace();
 assert.equal(demoState.orders.length,1);
 assert.equal(demoState.orders[0].id,'user-created-order');
});

test('Mindmap đọc lại đúng mini/micro lot, định mức và biến số lot đã lưu', () => {
 const ctx=model();
 ctx.ACCOUNTING_CRM_STATE.brokerageMetrics=[{memberId:'sale-1',period:'2026-10',basicLots:3,miniLots:2,microLots:1,lotCommissionRate:55000,productRate:12}];
 ctx.rebuildAccountingRevenueFromCRM();
 const p=vm.runInContext('APEX_DATA[0]',ctx);
 assert.equal(p.basicLot,3);assert.equal(p.miniLot,2);assert.equal(p.microLot,1);assert.equal(p.ratePerLot,55000);assert.equal(p.productRate,12);
 assert.match(html,/ACCOUNTING_LOT_CONFIG_SAVE/);assert.match(html,/applyLotConfigFromCRM\(msg\.lotConfig\)/);
 assert.doesNotMatch(html,/if \(person\.roleLevel === 'LV3'\) \{\s*postAccountingMessage\('ACCOUNTING_BROKERAGE_SAVE'/);
});

test('Accounting recognizes deposit and later bills in their actual months without double counting',()=>{
 const ctx=model();ctx.ACCOUNTING_CRM_STATE.products=[{id:'c',kind:'COURSE'}];
 ctx.ACCOUNTING_CRM_STATE.orders=[{id:'receipt-order',productId:'c',saleId:'sale-1',subtotal:5000000,total:5500000,vatAmount:500000,status:'PAID',vatIssued:true,receiptsVersion:1,paymentReceipts:[{id:'deposit',kind:'DEPOSIT',amount:500000,at:'2026-09-30T12:00:00+07:00'},{id:'full',kind:'FULL',amount:5000000,at:'2026-10-03T12:00:00+07:00'}]}];
 ctx.currentGlobalMonth='2026-09';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,454545);assert.equal(ctx.APEX_DATA[0].courseRev,454545);
 ctx.currentGlobalMonth='2026-10';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,4545455);
 ctx.currentGlobalMonth='ALL';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,5000000);
 ctx.currentGlobalMonth='2026-11';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA.length,1);assert.equal(ctx.COURSES_DATA[0].totalRevenue,0);
});

test('Accounting display preserves CRM VAT and receipt balances regardless of invoice request',()=>{
 const start=html.indexOf('function recalculateAllVatOrdersData()'),end=html.indexOf('function renderVatOrdersView()',start);
 const ctx=vm.createContext({VAT_ORDERS_DATA:[{crmOrderId:'deposit',subtotal:5000000,vatAmount:500000,total:5500000,collected:500000,remaining:5000000,requireVat:false,paymentStatus:'DEPOSIT'},{crmOrderId:'paid',subtotal:5000000,vatAmount:500000,total:5500000,collected:5500000,remaining:0,requireVat:false,paymentStatus:'PAID'}]});
 vm.runInContext(html.slice(start,end),ctx);ctx.recalculateAllVatOrdersData();assert.equal(ctx.VAT_ORDERS_DATA[0].total,5500000);assert.equal(ctx.VAT_ORDERS_DATA[0].remaining,5000000);assert.equal(ctx.VAT_ORDERS_DATA[1].collected,5500000);
});

test('Order review and expenses consume saved CRM email, VAT, balances and expense dates',()=>{
 const start=html.indexOf('  function syncAccountingExpensesFromCRM('),end=html.indexOf('  // Lắng nghe lệnh từ parent CRM',start);
 const ctx=vm.createContext({window:{},OrderPayments:require('../order-payments.js'),ACCOUNTING_CRM_STATE:{},ADMIN_EXPENSES_DATA:[],VAT_ORDERS_DATA:[],syncAccountingSelects(){},rebuildAccountingRevenueFromCRM(){}});
 vm.runInContext(html.slice(start,end),ctx);
 ctx.syncAccountingDataFromCRM({orders:[{id:'o',subtotal:5000000,vatAmount:500000,total:5500000,amountPaid:500000,balanceDue:5000000,status:'DEPOSIT',receiptsVersion:1,paymentReceipts:[{id:'r',amount:500000,billImage:'data:image/png;base64,AA==',images:[]}],billing:{email:'invoice@gmail.com',taxId:'0123456789'},companyName:'Test Company'}]});
 assert.equal(ctx.VAT_ORDERS_DATA[0].billImage,'');assert.equal(ctx.VAT_ORDERS_DATA[0].invoiceEmail,'invoice@gmail.com');assert.equal(ctx.VAT_ORDERS_DATA[0].taxCode,'0123456789');assert.equal(ctx.VAT_ORDERS_DATA[0].remaining,5000000);assert.equal(ctx.VAT_ORDERS_DATA[0].paymentReconciled,false);
 ctx.syncAccountingExpensesFromCRM({expenses:[{id:'e',date:'2026-10-03',amount:100000,note:'Đã lưu'}]});assert.equal(ctx.ADMIN_EXPENSES_DATA[0].month,'2026-10');assert.equal(ctx.ADMIN_EXPENSES_DATA[0].amount,100000);assert.equal(ctx.ADMIN_EXPENSES_DATA[0].note,'Đã lưu');
});
test('Embedded expense save waits for server acknowledgement and preserves draft on failure',()=>{
 const nodes=new Map(Object.entries({editingExpenseId:{value:''},inputExpTitle:{value:'Test expense'},inputExpCategory:{value:'Marketing'},inputExpAmount:{value:'100000'},inputExpMonth:{value:'2026-10'},inputExpDate:{value:'2026-10-03'},inputExpPayer:{value:'Admin'},inputExpNote:{value:'Note'}}));const button={};let messages=[];
 const ctx=vm.createContext({window:{parent:{}},document:{getElementById:id=>nodes.get(id),querySelector:()=>button},ADMIN_EXPENSES_DATA:[],currentAccountingMonth:'2026-10',postAccountingMessage:(...args)=>messages.push(args),alert:assert.fail,Date,Math});
 const start=html.indexOf('  function saveExpense()'),end=html.indexOf('  function handleExpenseSearch(',start);vm.runInContext(html.slice(start,end),ctx);ctx.saveExpense();ctx.saveExpense();assert.equal(messages.length,1);assert.equal(ctx.ADMIN_EXPENSES_DATA.length,0);assert.equal(button.disabled,true);assert.equal(nodes.get('inputExpTitle').value,'Test expense');assert.equal(messages[0][0],'ACCOUNTING_EXPENSE_SAVE');assert.ok(nodes.get('editingExpenseId').value);
});

test('Commission saves target selected historical month instead of today',()=>{const start=html.indexOf('  function accountingSavePeriod()'),end=html.indexOf('  // Lưu chỉ số',start);const ctx=vm.createContext({currentGlobalMonth:'2026-08',Date});vm.runInContext(html.slice(start,end),ctx);assert.equal(ctx.accountingSavePeriod(),'2026-08');});
test('Product-cohort settings restore rates without changing actual collected revenue',()=>{
 const ctx=model();ctx.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE',price:5000000}];
 ctx.ACCOUNTING_CRM_STATE.courseField={id:'batch'};ctx.ACCOUNTING_CRM_STATE.customers=[{id:'c',customFields:{batch:'K03'}}];
  ctx.ACCOUNTING_CRM_STATE.orders=[{id:'o',customerId:'c',productId:'p',saleId:'sale-1',subtotal:5000000,total:5500000,vatAmount:500000,amountPaid:5500000,status:'PAID',vatIssued:true,paidAt:'2026-10-03'}];
 ctx.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'p',courseKey:'K03',trainerIds:['trainer'],leaderIds:['leader'],trainerRates:{trainer:12},leaderRates:{leader:4},saleRates:{'sale-1':18}}];
 ctx.rebuildAccountingRevenueFromCRM();const group=ctx.COURSES_DATA.find(g=>g.cohortKey==='K03');assert.equal(group.trainers[0].rate,12);assert.equal(group.leaders[0].rate,4);assert.equal(group.salesConfig['sale-1'].rateSale,15);assert.equal(group.totalRevenue,5000000);
});

function commissions(ctx) {
 const start = html.indexOf('  function courseLeaderCommission(');
 const end = html.indexOf('  // ====================================================================', start);
 vm.runInContext(html.slice(start,end),ctx);
 return ctx;
}

function financeModel(){
 const c=commissions(model());
 c.LOT_CONFIG={standardMultiplier:1,miniMultiplier:.8,microMultiplier:.35,rateLv1:90000,rateLv2:70000,rateLv3:50000,defaultProductRate:15};
 c.ACCOUNTING_CRM_STATE.members=[{id:'m',role:'MANAGER'},{id:'l',role:'LEADER',managerId:'m'},{id:'s',role:'SALE',leaderId:'l',managerId:'m'},{id:'t',role:'SALE',leaderId:'l',managerId:'m'}];
 c.APEX_DATA=c.ACCOUNTING_CRM_STATE.members.map(member=>({...member,roleLevel:{MANAGER:'LV1',LEADER:'LV2',SALE:'LV3'}[member.role],parentId:member.role==='LEADER'?member.managerId:member.role==='SALE'?member.leaderId:null,basicLot:0,miniLot:0,microLot:0,bonus:0}));
 c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE'}];c.ACCOUNTING_CRM_STATE.courseField={id:'batch'};c.ACCOUNTING_CRM_STATE.customers=[{id:'customer',customFields:{batch:'K03'}}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'p',courseKey:'K03',trainerIds:['t'],rateSale:15,rateTrainer:15,rateLeader:5}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'o',customerId:'customer',productId:'p',saleId:'s',leaderId:'l',managerId:'m',subtotal:1000000,vatAmount:100000,total:1100000,status:'PAID',paidAt:'2026-10-01',vatIssued:true}];
 vm.runInContext(html.slice(html.indexOf(' function getPersonalStdLot('),html.indexOf(' function formatMoney(')),c);
 vm.runInContext(html.slice(html.indexOf('  function calculateTrainerCommission('),html.indexOf('  function courseLeaderCommission(')),c);
 return c;
}

test('Uninvoiced revenue stays visible while sale, direct leader and trainer commissions remain zero',()=>{
 const c=financeModel();c.ACCOUNTING_CRM_STATE.orders[0].vatIssued=false;c.rebuildAccountingRevenueFromCRM();
 assert.equal(c.APEX_DATA.find(p=>p.id==='s').courseRev,1000000);
 for(const person of c.APEX_DATA)assert.equal(c.calculatePersonnelFinance(person).netIncome,0);
 c.ACCOUNTING_CRM_STATE.orders[0].vatIssued=true;c.rebuildAccountingRevenueFromCRM();
 const fin=id=>c.calculatePersonnelFinance(c.APEX_DATA.find(person=>person.id===id));
 assert.equal(fin('s').hhSaleProducts,150000);assert.equal(fin('l').hhLeaderCourse,50000);assert.equal(fin('m').hhLeaderCourse,0);assert.equal(fin('t').hhTrainer,150000);
 const summary=c.courseCommissionSummary(c.COURSES_DATA.find(group=>group.cohortKey==='K03'));assert.equal(summary.company,650000);assert.equal(summary.sale+summary.leader+summary.trainer+summary.company,summary.revenue);
});

test('Manager or Leader sells for 20%, and the selling trainer receives 30% without an extra management share',()=>{
 for(const sellerId of ['m','l','t']){
  const c=financeModel(),order=c.ACCOUNTING_CRM_STATE.orders[0];order.saleId=sellerId;
  if(sellerId==='t')c.ACCOUNTING_CRM_STATE.courseConfigs[0].trainerIds=['t'];
  c.rebuildAccountingRevenueFromCRM();const seller=c.APEX_DATA.find(person=>person.id===sellerId),fin=c.calculatePersonnelFinance(seller);
  assert.equal(fin.hhSaleProducts,150000);
  if(sellerId==='t'){assert.equal(fin.hhTrainer,150000);assert.equal(fin.hhLeaderCourse,0);assert.equal(fin.netIncome,300000);}
  else {assert.equal(fin.hhLeaderCourse,50000);assert.equal(fin.netIncome,200000);}
 }
 for(const sellerId of ['m','l']){
  const c=financeModel();c.ACCOUNTING_CRM_STATE.orders[0].saleId=sellerId;c.ACCOUNTING_CRM_STATE.courseConfigs[0].trainerIds=[sellerId];c.rebuildAccountingRevenueFromCRM();
  const fin=c.calculatePersonnelFinance(c.APEX_DATA.find(person=>person.id===sellerId));assert.equal(fin.netIncome,300000);assert.equal(fin.hhLeaderCourse,0);
 }
});

test('Invoice issuance unlocks the original collection month and saved participants survive customer reassignment',()=>{
 const c=financeModel(),order=c.ACCOUNTING_CRM_STATE.orders[0];Object.assign(order,{paidAt:'2026-09-15',vatIssuedAt:'2026-10-01',commissionCourseKey:'K03',commissionTrainerId:'t',commissionLeaderId:'l',commissionSellerRole:'SALE'});
 c.ACCOUNTING_CRM_STATE.customers[0].customFields.batch='K05';c.currentGlobalMonth='2026-09';c.rebuildAccountingRevenueFromCRM();
 assert.equal(c.calculatePersonnelFinance(c.APEX_DATA.find(person=>person.id==='s')).hhSaleProducts,150000);assert.equal(c.COURSES_DATA.find(group=>group.cohortKey==='K03').totalRevenue,1000000);
 c.currentGlobalMonth='2026-10';c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculatePersonnelFinance(c.APEX_DATA.find(person=>person.id==='s')).hhSaleProducts,0);
});

test('Monthly rate changes are respected and all-period lot and product commission equals the sum of individual months',()=>{
 const c=financeModel(),order=c.ACCOUNTING_CRM_STATE.orders[0];Object.assign(order,{receiptsVersion:1,paymentReceipts:[{id:'sep',amount:550000,at:'2026-09-15',kind:'DEPOSIT'},{id:'oct',amount:550000,at:'2026-10-01',kind:'FULL'}]});
 c.ACCOUNTING_CRM_STATE.brokerageMetrics=[{memberId:'s',period:'2026-09',basicLots:4,lotCommissionRate:40000,productRate:10},{memberId:'s',period:'2026-10',basicLots:6,lotCommissionRate:60000,productRate:15},{memberId:'l',period:'2026-09',basicLots:1,lotCommissionRate:70000},{memberId:'l',period:'2026-10',basicLots:2,lotCommissionRate:90000},{memberId:'m',period:'2026-09',lotCommissionRate:90000},{memberId:'m',period:'2026-10',lotCommissionRate:100000}];
 const totals=new Map();for(const month of ['2026-09','2026-10']){c.currentGlobalMonth=month;c.rebuildAccountingRevenueFromCRM();for(const person of c.APEX_DATA)totals.set(person.id,(totals.get(person.id)||0)+c.calculatePersonnelFinance(person).netIncome);}
 c.currentGlobalMonth='ALL';c.rebuildAccountingRevenueFromCRM();for(const person of c.APEX_DATA)assert.equal(c.calculatePersonnelFinance(person).netIncome,totals.get(person.id),person.id);
 assert.equal(c.calculatePersonnelFinance(c.APEX_DATA.find(person=>person.id==='s')).hhSaleProducts,125000);
 c.currentGlobalMonth='2026-11';c.rebuildAccountingRevenueFromCRM();assert.equal(c.APEX_DATA.find(person=>person.id==='s').ratePerLot,50000);assert.equal(c.APEX_DATA.find(person=>person.id==='s').productRate,15);
});

test('Personnel commission preview uses VAT eligibility and includes training and management shares',()=>{
 const c=financeModel(),nodes={};c.document={getElementById:id=>nodes[id]||=( {value:'0',textContent:''} )};c.formatVND=String;c.currentEditingPersonnelId='l';
 for(const id of ['inputRatePerLot','inputProductRate','inputBasicLot','inputMiniLot','inputMicroLot','inputBonus'])c.document.getElementById(id);
 nodes.inputProductRate.value='15';nodes.inputRatePerLot.value='70000';
 vm.runInContext(html.slice(html.indexOf('  function updateModalPreview()'),html.indexOf('  function savePersonnelChanges()')),c);
 c.ACCOUNTING_CRM_STATE.orders[0].saleId='l';c.rebuildAccountingRevenueFromCRM();c.updateModalPreview();assert.equal(nodes.previewTotalNet.textContent,'200000');assert.equal(nodes.previewManagementHh.textContent,'50000');
 c.ACCOUNTING_CRM_STATE.courseConfigs[0].trainerIds=['l'];c.rebuildAccountingRevenueFromCRM();c.updateModalPreview();assert.equal(nodes.previewTotalNet.textContent,'300000');assert.equal(nodes.previewTrainerHh.textContent,'150000');assert.equal(nodes.previewManagementHh.textContent,'0');
 nodes.inputProductRate.value='10';c.updateModalPreview();assert.equal(nodes.previewTotalNet.textContent,'250000');
 c.ACCOUNTING_CRM_STATE.orders[0].vatIssued=false;c.rebuildAccountingRevenueFromCRM();c.updateModalPreview();assert.equal(nodes.previewTotalNet.textContent,'0');
 assert.equal(c.APEX_DATA.find(p=>p.id==='l').courseRev,1000000);
});
test('Only the selling Sale direct leader receives commission, even with legacy all-leaders configuration',()=>{
 const c=commissions(model());
 c.ACCOUNTING_CRM_STATE.members=[{id:'sale-1',role:'SALE',leaderId:'l1',managerId:'m'},{id:'sale-2',role:'SALE',leaderId:'l2',managerId:'m'}];
 c.APEX_DATA=[{id:'l1',roleLevel:'LV2'},{id:'l2',roleLevel:'LV2'},{id:'l3',roleLevel:'LV2'},{id:'m',roleLevel:'LV1'}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE',price:5000000}];
 c.ACCOUNTING_CRM_STATE.courseField={id:'batch'};c.ACCOUNTING_CRM_STATE.customers=[{id:'c',customFields:{batch:'K03'}}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'p',courseKey:'K03',leaderIds:['l1','l2','l3','m'],rateLeader:5,trainerIds:['l3'],trainerRates:{l3:15}}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'o',customerId:'c',productId:'p',saleId:'sale-1',status:'DEPOSIT',vatIssued:true,subtotal:5000000,total:5500000,vatAmount:500000,receiptsVersion:1,paymentReceipts:[{id:'r1',kind:'DEPOSIT',amount:550000,at:'2026-10-01'}]}];
 c.rebuildAccountingRevenueFromCRM();
 assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0],c.APEX_DATA),25000);
 for(const p of c.APEX_DATA.slice(1))assert.equal(c.calculateLeaderCourseCommission(p,c.APEX_DATA),0);
 const g=c.COURSES_DATA.find(g=>g.cohortKey==='K03'),s=c.courseCommissionSummary(g);
 assert.equal(s.revenue,500000);assert.equal(s.sale,75000);assert.equal(s.leader,25000);assert.equal(s.trainer,75000);assert.equal(s.company,325000);
 const before=JSON.stringify(g);
 c.currentDetailCourseDraft=g;c.currentDetailCourseId=g.id;c.document={getElementById:()=>null};c.formatMoney=String;
 const a=html.indexOf('  function updateCdmSummary()'),b=html.indexOf('  function saveCoursePersonnelDetail()',a);
 vm.runInContext(html.slice(a,b),c);c.updateCdmSummary();assert.equal(JSON.stringify(g),before,'summary must never replace receipts with students times list price');
 c.ACCOUNTING_CRM_STATE.orders=[];c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0],c.APEX_DATA),0);
});
test('Same cohort has separate trainers for each product; all catalogue products remain available without orders',()=>{
 const c=commissions(model());
 c.ACCOUNTING_CRM_STATE.courseKeys=['K01','K02','K03'];c.ACCOUNTING_CRM_STATE.courseField={id:'batch'};
 c.ACCOUNTING_CRM_STATE.customers=[{id:'c1',customFields:{batch:'K03',course:['BMĐTHH']}},{id:'c2',customFields:{batch:'K03'}}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p1',name:'Product 1',kind:'COURSE',courseKeys:['K01','K03']},{id:'p2',name:'Product 2',kind:'COURSE'},{id:'vip',name:'VIP',kind:'VIP'},{id:'ind',name:'Indicator',kind:'INDICATOR'}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'p1',courseKey:'K03',trainerIds:['t1'],trainerRates:{t1:10},rateLeader:0,rateSale:0},{productId:'p2',courseKey:'K03',trainerIds:['t2'],trainerRates:{t2:15},rateLeader:0,rateSale:0}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'o1',customerId:'c1',productId:'p1',saleId:'sale-1',status:'PAID',vatIssued:true,subtotal:1000000,paidAt:'2026-10-01'},{id:'o2',customerId:'c2',productId:'p2',saleId:'sale-1',status:'PAID',vatIssued:true,subtotal:2000000,paidAt:'2026-10-01'}];
 c.rebuildAccountingRevenueFromCRM();assert.equal(new Set(c.COURSES_DATA.map(g=>g.productId)).size,4);
 const first=c.COURSES_DATA.find(g=>g.productId==='p1'&&g.cohortKey==='K03'),second=c.COURSES_DATA.find(g=>g.productId==='p2'&&g.cohortKey==='K03');
 assert.equal(first.name,'Product 1');assert.equal(first.totalRevenue,1000000);assert.equal(first.trainers[0].id,'t1');assert.equal(c.courseCommissionSummary(first).trainer,100000);
 assert.equal(second.totalRevenue,2000000);assert.equal(second.trainers[0].id,'t2');assert.equal(c.courseCommissionSummary(second).trainer,300000);
 assert.equal(c.COURSES_DATA.reduce((sum,g)=>sum+g.totalRevenue,0),3000000);
 c.currentGlobalMonth='2026-11';c.rebuildAccountingRevenueFromCRM();assert.equal(new Set(c.COURSES_DATA.map(g=>g.productId)).size,4);assert.ok(c.COURSES_DATA.every(g=>g.totalRevenue===0));
});
test('Customers without a cohort never inherit a product cohort or legacy unscoped trainer',()=>{
 const c=commissions(model());c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE',courseKey:'K03'}];c.ACCOUNTING_CRM_STATE.courseField={id:'batch'};
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{courseKey:'p',trainerIds:['legacy'],rateTrainer:15},{productId:'p',courseKey:'K03',trainerIds:['t'],rateTrainer:15}];
 c.ACCOUNTING_CRM_STATE.customers=[{id:'c',customFields:{course:['BMĐTHH']}}];c.ACCOUNTING_CRM_STATE.orders=[{id:'o',customerId:'c',productId:'p',courseKey:'K03',saleId:'sale-1',status:'PAID',vatIssued:true,subtotal:1000000,paidAt:'2026-10-01'}];
 c.rebuildAccountingRevenueFromCRM();assert.equal(c.COURSES_DATA.reduce((sum,g)=>sum+c.courseCommissionSummary(g).trainer,0),0);assert.equal(c.COURSES_DATA.reduce((sum,g)=>sum+g.totalRevenue,0),1000000);
});
test('A direct Manager sale does not earn a second leader commission; sale owner snapshot takes precedence',()=>{
 const c=commissions(model());c.APEX_DATA=[{id:'m',roleLevel:'LV1'},{id:'old',roleLevel:'LV2'},{id:'new',roleLevel:'LV2'}];
 c.ACCOUNTING_CRM_STATE.members=[{id:'m',role:'MANAGER'},{id:'sale-1',role:'SALE',leaderId:'new'}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE'}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'a',productId:'p',saleId:'m',managerId:'m',status:'PAID',vatIssued:true,subtotal:1000,paidAt:'2026-10-01'},{id:'b',productId:'p',saleId:'sale-1',leaderId:'old',status:'PAID',vatIssued:true,subtotal:2000,paidAt:'2026-10-01'}];
 c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0]),50);assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[1]),100);assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[2]),0);
});
test('Report sorting uses numeric money values and toggles direction without mutating personnel',()=>{
 const source=html.slice(html.indexOf(' let personnelReportSort ='),html.indexOf(' function renderReportTable()'));
 const ctx=vm.createContext({calculatePersonnelFinance:p=>p.fin,renderReportTable(){}});vm.runInContext(source,ctx);
 const people=[{id:'a',name:'An',fin:{netIncome:900,hhTrainer:0,hhLeaderCourse:300}},{id:'b',name:'Bình',fin:{netIncome:10000,hhTrainer:100,hhLeaderCourse:0}},{id:'c',name:'Cường',fin:{netIncome:1000,hhTrainer:0,hhLeaderCourse:0}}];
 ctx.sortPersonnelReport('netIncome');assert.deepEqual(Array.from(ctx.sortedPersonnelReport(people),p=>p.id),['a','c','b']);
 ctx.sortPersonnelReport('netIncome');assert.deepEqual(Array.from(ctx.sortedPersonnelReport(people),p=>p.id),['b','c','a']);
 ctx.sortPersonnelReport('trainingLeader');assert.deepEqual(Array.from(ctx.sortedPersonnelReport(people),p=>p.id),['c','b','a']);
 ctx.sortPersonnelReport('name');assert.deepEqual(Array.from(ctx.sortedPersonnelReport(people),p=>p.id),['a','b','c']);assert.deepEqual(people.map(p=>p.id),['a','b','c']);
});

test('Course trainer edits stay in a draft until SQL acknowledgement; closing discards unsaved edits',()=>{
 const source=html.slice(html.indexOf('  let currentDetailCourseId ='),html.indexOf('  function openTrainingConfigModal()'));
 const original={id:'course:K03',courseKey:'K03',name:'K03',trainers:[{id:'trainer',name:'Teacher',rate:15}],salesConfig:{},totalRevenue:0};
 const nodes={};const element=()=>({innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}},appendChild(){}});
 const win={parent:{}};const sent=[];
 const ctx=vm.createContext({structuredClone,window:win,COURSES_DATA:[original],APEX_DATA:[],document:{getElementById:id=>nodes[id]||=(element()),createElement:element},formatMoney:String,courseCommissionSummary:()=>({sale:0,leader:0,trainer:0,company:0}),alert(){},persistCourseConfigs:(courses,view)=>{sent.push(structuredClone(courses));win.__PENDING_COURSE_CONFIG=view;}});
 vm.runInContext(source,ctx);ctx.openCoursePersonnelDetailModal('course:K03');ctx.updateTrainerRateInCourse('trainer',0);
 assert.equal(original.trainers[0].rate,15);ctx.closeCoursePersonnelDetailModal();ctx.openCoursePersonnelDetailModal('course:K03');ctx.updateTrainerRateInCourse('trainer',12);ctx.saveCoursePersonnelDetail();
 assert.equal(sent[0][0].trainers[0].rate,12);assert.equal(original.trainers[0].rate,15);ctx.closeCoursePersonnelDetailModal();assert.equal(vm.runInContext('currentDetailCourseDraft.trainers[0].rate',ctx),12);
});

test('Course field lookup selects Khóa cohort column instead of default Khoá học interests',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
 const ctx=vm.createContext({data:{fields:[{id:'course',label:'Khoá học',options:[{value:'BMĐTHH'}]},{id:'custom-batch',label:'KHÓA',options:[{value:'K03'},{value:'K01'},'K02']}],customers:[{customFields:{'custom-batch':'K04',course:['Coaching VIP']}}]}});
 vm.runInContext(source.slice(source.indexOf('  function courseField(){'),source.indexOf('  function productModal(')),ctx);
 assert.equal(ctx.courseField().id,'custom-batch');assert.deepEqual(Array.from(ctx.courseKeys()),['K01','K02','K03','K04']);ctx.data.fields.pop();assert.equal(ctx.courseField(),null);assert.equal(ctx.courseKeys().length,0);
});
test('One product can pay different trainers for K01 and K03 without cross-credit',()=>{
 const c=commissions(model());c.ACCOUNTING_CRM_STATE.products=[{id:'p',name:'Course product',kind:'COURSE',courseKeys:['K01','K03']}];c.ACCOUNTING_CRM_STATE.courseField={id:'batch'};
 c.ACCOUNTING_CRM_STATE.customers=[{id:'a',customFields:{batch:'K01'}},{id:'b',customFields:{batch:'K03'}}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{productId:'p',courseKey:'K01',trainerIds:['t1'],trainerRates:{t1:10}},{productId:'p',courseKey:'K03',trainerIds:['t3'],trainerRates:{t3:15}}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'oa',productId:'p',customerId:'a',saleId:'sale-1',status:'PAID',vatIssued:true,subtotal:1000000,paidAt:'2026-10-01'},{id:'ob',productId:'p',customerId:'b',saleId:'sale-1',status:'PAID',vatIssued:true,subtotal:2000000,paidAt:'2026-10-01'}];c.rebuildAccountingRevenueFromCRM();
 const start=html.indexOf('  function calculateTrainerCommission('),end=html.indexOf('  function courseLeaderCommission(',start);vm.runInContext(html.slice(start,end),c);
 assert.equal(c.calculateTrainerCommission('t1').totalTrainerComm,100000);assert.equal(c.calculateTrainerCommission('t3').totalTrainerComm,300000);
 c.ACCOUNTING_CRM_STATE.customers[1].customFields.batch='K01';c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculateTrainerCommission('t1').totalTrainerComm,300000);assert.equal(c.calculateTrainerCommission('t3').totalTrainerComm,0);
});

test('Training table renders all products and requires cohort selection before opening a course trainer',()=>{
 const c=model();c.ACCOUNTING_CRM_STATE.products=[{id:'p1',name:'Course One',kind:'COURSE',courseKeys:['K01','K03']},{id:'p2',name:'Course Two',kind:'COURSE'},{id:'vip',name:'VIP',kind:'VIP'},{id:'ind',name:'Indicator',kind:'INDICATOR'}];c.ACCOUNTING_CRM_STATE.courseKeys=['K01','K02','K03'];c.rebuildAccountingRevenueFromCRM();
 function element(){return {children:[],style:{},value:'',nodes:{},setAttribute(){},add(option){this.children.push(option);},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},querySelector(key){return this.nodes[key]||=(element());}};}
 const body=element();let opened='';c.document={getElementById:()=>body,createElement:element};c.Option=function(label,value){return {label,value};};c.currentTrainingModalCategory='ALL';c.formatMoney=String;c.openCoursePersonnelDetailModal=id=>opened=id;
 vm.runInContext(html.slice(html.indexOf('  const trainingProductSelections'),html.indexOf('  function onCourseRatesChange(')),c);c.renderTrainingConfigTable();assert.equal(body.children.length,4);
 const first=body.children[0],second=body.children[1];assert.match(first.innerHTML,/Course One/);assert.match(second.innerHTML,/Course Two/);
 const select=first.querySelector('.training-cohort-cell').children[0];assert.deepEqual(select.children.map(o=>o.label),['— Chọn khóa —','K01','K02','K03']);assert.equal(first.querySelector('button').disabled,true);
 select.value=select.children[3].value;select.onchange();assert.equal(first.querySelector('button').disabled,false);first.querySelector('button').onclick();assert.equal(opened,select.value);assert.equal(second.querySelector('button').disabled,true);
 assert.equal(body.children[2].querySelector('.training-cohort-cell').children.length,0);assert.equal(body.children[2].querySelector('button').disabled,false);
});

test('Course revenue KPI switches between total, trainer and cohort views',()=>{
 const source=html.slice(html.indexOf("  let courseRevenueViewMode = 'TOTAL';"),html.indexOf('  // ====================================================================',html.indexOf("  let courseRevenueViewMode = 'TOTAL';")));
 function select(){return {value:'',hidden:false,options:[],replaceChildren(){this.options=[];},add(option){this.options.push(option);}};}
 const nodes={courseRevenueViewMode:select(),courseRevenueViewTarget:select(),statTotalCourseRev:{textContent:''},statCourseDetail:{innerHTML:''}};
 const ctx=vm.createContext({OrderPayments:require('../order-payments.js'),COURSES_DATA:[
  {id:'a',category:'course',cohortKey:'K01',totalRevenue:1000000,commissionRevenue:1000000,rateTrainer:15,trainers:[{id:'t1',name:'Trainer One',rate:10}]},
  {id:'b',category:'course',cohortKey:'K03',totalRevenue:2000000,commissionRevenue:2000000,rateTrainer:15,trainers:[{id:'t2',name:'Trainer Two',rate:15}]},
  {id:'c',category:'indicator',totalRevenue:9000000,trainers:[{id:'t1',name:'Trainer One',rate:10}]}
 ],document:{getElementById:id=>nodes[id]},Option:function(label,value){return {label,value};},formatMoney:value=>String(value),courseCommissionSummary:course=>({trainer:(course.trainers||[]).reduce((sum,t)=>sum+course.totalRevenue*t.rate/100,0),company:0})});
 vm.runInContext(source,ctx);ctx.updateCourseStatBox();assert.equal(nodes.statTotalCourseRev.textContent,'3000000');assert.match(nodes.statCourseDetail.innerHTML,/400000/);
 ctx.setCourseRevenueViewMode('TRAINER');assert.deepEqual(nodes.courseRevenueViewTarget.options.map(o=>o.label),['Trainer One','Trainer Two']);assert.equal(nodes.statTotalCourseRev.textContent,'1000000');assert.match(nodes.statCourseDetail.innerHTML,/100000/);
 ctx.setCourseRevenueViewTarget('t2');assert.equal(nodes.statTotalCourseRev.textContent,'2000000');assert.match(nodes.statCourseDetail.innerHTML,/300000/);
 ctx.setCourseRevenueViewMode('COHORT');assert.deepEqual(nodes.courseRevenueViewTarget.options.map(o=>o.label),['K01','K03']);assert.equal(nodes.statTotalCourseRev.textContent,'1000000');assert.match(nodes.statCourseDetail.innerHTML,/Trainer One/);
 ctx.setCourseRevenueViewTarget('K03');assert.equal(nodes.statTotalCourseRev.textContent,'2000000');assert.match(nodes.statCourseDetail.innerHTML,/Trainer Two/);
 ctx.setCourseRevenueViewMode('TOTAL');assert.equal(nodes.courseRevenueViewTarget.hidden,true);assert.equal(nodes.statTotalCourseRev.textContent,'3000000');
});

test('Contact copy preserves leading zeroes and escapes saved customer values', async () => {
 const copied=[];
 const ctx=vm.createContext({navigator:{clipboard:{writeText:async value=>copied.push(value)}},clearTimeout(){},setTimeout(){return 1;}});
 vm.runInContext(html.slice(html.indexOf('function escapeOrderContact('),html.indexOf('function renderVatOrdersTable(')),ctx);
 const button={dataset:{copyValue:'001234567890'},textContent:'001234567890',classList:{add(){},remove(){}}};
 await ctx.copyOrderField(button);
 assert.deepEqual(copied,['001234567890']);
 assert.equal(button.textContent,'\u0110\u00e3 copy');
 assert.equal(ctx.escapeOrderContact('A "B" <C>'),'A &quot;B&quot; &lt;C&gt;');
});

function orderFilterContext() {
 const nodes = {};
 const ctx = vm.createContext({VAT_ORDERS_DATA:[
  {id:'deposit',month:'2026-10',type:'COURSE',customerName:'An',collected:40,remaining:60,subtotal:90,vatAmount:10,paymentStatus:'DEPOSIT'},
  {id:'pending',month:'2026-10',type:'COURSE',collected:0,remaining:100,paymentStatus:'PENDING'},
  {id:'paid',month:'2026-10',type:'SALE',collected:100,remaining:0,paymentStatus:'PAID'},
  {id:'reviewed',month:'2026-10',type:'COURSE',collected:100,remaining:0,paymentStatus:'PAID',paymentReconciled:true},
  {id:'vat',month:'2026-10',type:'COURSE',collected:100,remaining:0,paymentStatus:'PAID',paymentReconciled:true,vatStatus:'ISSUED'},
  {id:'old',month:'2026-09',type:'COURSE',collected:40,remaining:60,paymentStatus:'DEPOSIT'}
 ],currentOrderMonth:'2026-10',currentOrderSearchQuery:'',currentOrderStatusFilter:'ALL',currentOrderTypeFilter:'ALL',currentOrderPage:1,currentOrderPageSize:10,
 document:{getElementById:id=>nodes[id]||=( {textContent:'stale',innerHTML:'',setAttribute(){},querySelectorAll(){return [];},focus(){}} )},formatCurrency:String,
 recalculateAllVatOrdersData(){},renderPaymentNotificationBanner(){},renderVatOrdersTable(){}});
 vm.runInContext(html.slice(html.indexOf('function isVatOrderDeposit('),html.indexOf('function renderPaymentNotificationBanner(')),ctx);
 return {ctx,nodes};
}
test('Accounting filters combine month, four payment stages, product type and search',()=>{
 const {ctx:c}=orderFilterContext();const ids=()=>Array.from(c.filteredVatOrders(),o=>o.id);
 c.currentOrderStatusFilter='DEPOSIT';assert.deepEqual(ids(),['deposit']);
 c.currentOrderStatusFilter='PAID';assert.deepEqual(ids(),['paid','reviewed','vat']);
 c.currentOrderStatusFilter='RECONCILED';assert.deepEqual(ids(),['reviewed','vat']);
 c.currentOrderStatusFilter='VAT_ISSUED';assert.deepEqual(ids(),['vat']);
 c.currentOrderMonth='2026-09';assert.deepEqual(ids(),[]);
 c.currentOrderStatusFilter='DEPOSIT';assert.deepEqual(ids(),['old']);
 c.currentOrderMonth='ALL';assert.deepEqual(ids(),['deposit','old']);
 c.currentOrderTypeFilter='SALE';assert.deepEqual(ids(),[]);
 c.currentOrderTypeFilter='COURSE';c.currentOrderSearchQuery=' AN ';assert.deepEqual(ids(),['deposit']);
 c.currentOrderSearchQuery='';c.currentOrderMonth='2027-01';assert.deepEqual(ids(),[]);
});
test('Accounting KPIs reflect selected filters and exclude unpaid orders from deposits',()=>{
 const {ctx:c,nodes}=orderFilterContext();c.renderVatOrdersView();
 assert.equal(nodes.kpiOrderTotalCount.textContent,'5 đơn');assert.equal(nodes.kpiOrderDepositCount.textContent,'1 đơn');
 c.currentOrderStatusFilter='DEPOSIT';c.renderVatOrdersView();assert.equal(nodes.kpiOrderTotalCount.textContent,'1 đơn');assert.equal(nodes.kpiOrderPaidCount.textContent,'0 đơn');assert.equal(nodes.kpiOrderTotalValue.textContent,'90');
 c.currentOrderMonth='2026-09';c.renderVatOrdersView();assert.equal(nodes.orderFilterMonth.value,'2026-09');
});
test('Empty accounting filter resets every table total and count',()=>{
 const {ctx:c,nodes}=orderFilterContext();
 vm.runInContext(html.slice(html.indexOf('function renderVatOrdersTable()'),html.indexOf('function openOrderDetailModal(',html.indexOf('function renderVatOrdersTable()'))),c);
 c.currentOrderStatusFilter='VAT_ISSUED';c.currentOrderMonth='2026-09';c.renderVatOrdersTable();
 for(const id of ['footOrderTotalRev','footOrderTotalVat','footOrderTotalCollected','footOrderTotalRemaining'])assert.equal(nodes[id].textContent,'0');
 assert.equal(nodes.badgeOrderTableCount.textContent,'0 đơn');assert.match(nodes.vatOrdersTableBody.innerHTML,/Không tìm thấy/);
});


test('Accounting renders 10 or 20 rows per page while retaining full filtered totals',()=>{
 const {ctx:c,nodes}=orderFilterContext();
 const body={rows:[],set innerHTML(value){this.rows=[];this.markup=value;},get innerHTML(){return this.markup;},appendChild(row){this.rows.push(row);}};
 nodes.vatOrdersTableBody=body;c.escapeOrderContact=String;c.document.createElement=()=>({style:{},innerHTML:''});
 c.VAT_ORDERS_DATA=Array.from({length:25},(_,i)=>({id:'page-'+i,crmOrderId:'page-'+i,month:'2026-10',type:'COURSE',customerName:'Customer '+i,collected:110,remaining:0,subtotal:100,vatAmount:10,paymentStatus:'PAID'}));
 vm.runInContext(html.slice(html.indexOf('function renderVatOrdersTable()'),html.indexOf('function openOrderDetailModal(',html.indexOf('function renderVatOrdersTable()'))),c);
 c.renderVatOrdersTable();assert.equal(body.rows.length,10);assert.equal(c.currentOrderPage,1);assert.match(body.rows[0].innerHTML,/Customer 0</);assert.match(nodes.vatOrdersPagination.innerHTML,/1&ndash;10 \/ 25/);assert.equal(nodes.footOrderTotalCollected.textContent,'2750');
 c.changeOrderPage(1);assert.equal(body.rows.length,10);assert.match(body.rows[0].innerHTML,/Customer 10</);assert.match(nodes.vatOrdersPagination.innerHTML,/11&ndash;20 \/ 25/);assert.equal(nodes.footOrderTotalCollected.textContent,'2750');
 c.changeOrderPage(1);assert.equal(body.rows.length,5);assert.match(body.rows[0].innerHTML,/Customer 20</);assert.match(nodes.vatOrdersPagination.innerHTML,/21&ndash;25 \/ 25/);assert.match(nodes.vatOrdersPagination.innerHTML,/id="orderPageNext"[^>]*disabled/);
 c.changeOrderPage(1);assert.equal(c.currentOrderPage,3);
 c.setOrderPageSize('20');assert.equal(c.currentOrderPage,1);assert.equal(body.rows.length,20);assert.equal(c.currentOrderPageSize,20);
 c.changeOrderPage(1);assert.equal(body.rows.length,5);
 c.VAT_ORDERS_DATA=c.VAT_ORDERS_DATA.slice(0,11);c.renderVatOrdersTable();assert.equal(c.currentOrderPage,1);assert.equal(body.rows.length,11);
 c.setOrderPageSize('999');assert.equal(c.currentOrderPageSize,10);assert.equal(body.rows.length,10);
});

test('Status buttons show counts within the chosen month, product and search independently of the active status',()=>{
 const {ctx:c,nodes}=orderFilterContext(),buttons=new Map();
 for(const status of ['ALL','PAID','DEPOSIT'])buttons.set(status,{dataset:{orderStatus:status},count:{textContent:''},classList:{toggle(key,value){this[key]=value;}},setAttribute(key,value){this[key]=value;},querySelector(){return this.count;}});
 nodes.orderStatusFilterStrip={querySelectorAll:()=>Array.from(buttons.values())};
 c.currentOrderStatusFilter='DEPOSIT';c.renderVatOrdersView();
 assert.deepEqual(Array.from(buttons.values(),button=>button.count.textContent),['5','3','1']);
 assert.equal(buttons.get('DEPOSIT')['aria-pressed'],'true');assert.equal(buttons.get('PAID')['aria-pressed'],'false');
 c.currentOrderTypeFilter='COURSE';c.renderVatOrdersView();assert.equal(buttons.get('ALL').count.textContent,'4');assert.equal(buttons.get('PAID').count.textContent,'2');
 c.currentOrderSearchQuery='An';c.renderVatOrdersView();assert.equal(buttons.get('ALL').count.textContent,'1');assert.equal(buttons.get('PAID').count.textContent,'0');
});

test('Changing order filters resets pagination and empty results retain the row-size control',()=>{
 const {ctx:c,nodes}=orderFilterContext();
 vm.runInContext(html.slice(html.indexOf('function handleOrderSearch('),html.indexOf('function exportVatOrdersToCSV()')),c);
 for(const [handler,value] of [['handleOrderSearch','An'],['handleOrderStatusFilter','DEPOSIT'],['handleOrderTypeFilter','COURSE']]){
  c.currentOrderPage=3;c[handler](value);assert.equal(c.currentOrderPage,1);
 }
 c.currentOrderPage=3;c.renderVatOrdersPagination(0);assert.equal(c.currentOrderPage,1);assert.equal(nodes.vatOrdersPagination.hidden,false);assert.match(nodes.vatOrdersPagination.innerHTML,/0&ndash;0 \/ 0/);assert.match(nodes.vatOrdersPagination.innerHTML,/id="orderPageSizeSelect"/);assert.match(nodes.vatOrdersPagination.innerHTML,/id="orderPageNext"[^>]*disabled/);
});
