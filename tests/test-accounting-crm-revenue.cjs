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
  {id:'1',productId:'c',saleId:'sale-1',subtotal:125,status:'PAID',createdAt:'2026-09-01',paidAt:'2026-10-01'},
  {id:'2',productId:'i',saleId:'sale-1',subtotal:75,status:'PAID',paidAt:'2026-10-01'},
  {id:'3',productId:'v',saleId:'sale-2',subtotal:50,status:'PAID',paidAt:'2026-10-01'},
  {id:'4',productId:'c',saleId:'sale-1',subtotal:900,status:'DEPOSIT',paidAt:'2026-10-01'},
  {id:'5',productId:'c',saleId:'sale-1',subtotal:30,status:'PAID',paidAt:'2026-09-01'}
 ];
 ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.reduce((sum,c)=>sum+c.totalRevenue,0),250);
 assert.equal(ctx.APEX_DATA[0].courseRev,125); assert.equal(ctx.APEX_DATA[0].indicatorRev,75); assert.equal(ctx.APEX_DATA[0].vipRev,0);
 ctx.currentGlobalMonth='2026-09'; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA[0].totalRevenue,30); assert.equal(ctx.APEX_DATA[0].indicatorRev,0);
 ctx.currentGlobalMonth='ALL'; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.reduce((sum,c)=>sum+c.totalRevenue,0),280);
 ctx.ACCOUNTING_CRM_STATE.orders=[]; ctx.rebuildAccountingRevenueFromCRM();
 assert.equal(ctx.COURSES_DATA.length,0); assert.equal(ctx.APEX_DATA[0].courseRev,0);
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
 ctx.ACCOUNTING_CRM_STATE.orders=[{id:'receipt-order',productId:'c',saleId:'sale-1',subtotal:5000000,total:5500000,vatAmount:500000,status:'PAID',receiptsVersion:1,paymentReceipts:[{id:'deposit',kind:'DEPOSIT',amount:500000,at:'2026-09-30T12:00:00+07:00'},{id:'full',kind:'FULL',amount:5000000,at:'2026-10-03T12:00:00+07:00'}]}];
 ctx.currentGlobalMonth='2026-09';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,454545);assert.equal(ctx.APEX_DATA[0].courseRev,454545);
 ctx.currentGlobalMonth='2026-10';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,4545455);
 ctx.currentGlobalMonth='ALL';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA[0].totalRevenue,5000000);
 ctx.currentGlobalMonth='2026-11';ctx.rebuildAccountingRevenueFromCRM();assert.equal(ctx.COURSES_DATA.length,0);
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
 const start=html.indexOf('  function saveExpense()'),end=html.indexOf('  function deleteExpense(',start);vm.runInContext(html.slice(start,end),ctx);ctx.saveExpense();ctx.saveExpense();assert.equal(messages.length,1);assert.equal(ctx.ADMIN_EXPENSES_DATA.length,0);assert.equal(button.disabled,true);assert.equal(nodes.get('inputExpTitle').value,'Test expense');assert.equal(messages[0][0],'ACCOUNTING_EXPENSE_SAVE');assert.ok(nodes.get('editingExpenseId').value);
});

test('Commission saves target selected historical month instead of today',()=>{const start=html.indexOf('  function accountingSavePeriod()'),end=html.indexOf('  // Lưu chỉ số',start);const ctx=vm.createContext({currentGlobalMonth:'2026-08',Date});vm.runInContext(html.slice(start,end),ctx);assert.equal(ctx.accountingSavePeriod(),'2026-08');});
test('Course settings send persistent IDs and restore individual rates without changing collected revenue',()=>{
 const ctx=model();ctx.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE',price:5000000}];ctx.ACCOUNTING_CRM_STATE.orders=[{id:'o',productId:'p',saleId:'sale-1',subtotal:5000000,total:5500000,vatAmount:500000,amountPaid:5500000,status:'PAID',paidAt:'2026-10-03'}];ctx.ACCOUNTING_CRM_STATE.courseConfigs=[{courseKey:'p',trainerIds:['trainer'],leaderIds:['leader'],trainerRates:{trainer:12},leaderRates:{leader:4},saleRates:{'sale-1':18}}];ctx.rebuildAccountingRevenueFromCRM();const group=ctx.COURSES_DATA[0];assert.equal(group.trainers[0].rate,12);assert.equal(group.leaders[0].rate,4);assert.equal(group.salesConfig['sale-1'].rateSale,18);assert.equal(group.totalRevenue,5000000);
 let message;ctx.postAccountingMessage=(type,body)=>message={type,body};ctx.alert=assert.fail;const start=html.indexOf('  function persistCourseConfigs('),end=html.indexOf('  function saveTrainingConfig()',start);vm.runInContext(html.slice(start,end),ctx);ctx.persistCourseConfigs([group],'detail');assert.equal(message.type,'ACCOUNTING_COURSE_CONFIG_SAVE');assert.equal(message.body.payload[0].courseKey,'p');assert.equal(message.body.payload[0].saleRates['sale-1'],18);assert.equal(message.body.payload[0].totalRevenue,undefined);
});

function commissions(ctx) {
 const start = html.indexOf('  function courseLeaderCommission(');
 const end = html.indexOf('  // ====================================================================', start);
 vm.runInContext(html.slice(start,end),ctx);
 return ctx;
}
test('Only the selling Sale direct leader receives commission, even with legacy all-leaders configuration',()=>{
 const c=commissions(model());
 c.ACCOUNTING_CRM_STATE.members=[{id:'sale-1',role:'SALE',leaderId:'l1',managerId:'m'},{id:'sale-2',role:'SALE',leaderId:'l2',managerId:'m'}];
 c.APEX_DATA=[{id:'l1',roleLevel:'LV2'},{id:'l2',roleLevel:'LV2'},{id:'l3',roleLevel:'LV2'},{id:'m',roleLevel:'LV1'}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE',price:5000000}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{courseKey:'p',leaderIds:['l1','l2','l3','m'],rateLeader:5,trainerIds:['l3'],trainerRates:{l3:15}}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'o',productId:'p',saleId:'sale-1',status:'DEPOSIT',subtotal:5000000,total:5500000,vatAmount:500000,receiptsVersion:1,paymentReceipts:[{id:'r1',kind:'DEPOSIT',amount:550000,at:'2026-10-01'}]}];
 c.rebuildAccountingRevenueFromCRM();
 assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0],c.APEX_DATA),25000);
 for(const p of c.APEX_DATA.slice(1))assert.equal(c.calculateLeaderCourseCommission(p,c.APEX_DATA),0);
 const g=c.COURSES_DATA[0],s=c.courseCommissionSummary(g);
 assert.equal(s.revenue,500000);assert.equal(s.sale,75000);assert.equal(s.leader,25000);assert.equal(s.trainer,75000);assert.equal(s.company,325000);
 const before=JSON.stringify(g);
 c.currentDetailCourseDraft=g;c.currentDetailCourseId=g.id;c.document={getElementById:()=>null};c.formatMoney=String;
 const a=html.indexOf('  function updateCdmSummary()'),b=html.indexOf('  function saveCoursePersonnelDetail()',a);
 vm.runInContext(html.slice(a,b),c);c.updateCdmSummary();assert.equal(JSON.stringify(g),before,'summary must never replace receipts with students times list price');
 c.ACCOUNTING_CRM_STATE.orders=[];c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0],c.APEX_DATA),0);
});
test('Course selector uses customer course column; products in one course share a trainer configuration',()=>{
 const c=commissions(model());
 c.ACCOUNTING_CRM_STATE.courseKeys=['K01','K02','K03'];c.ACCOUNTING_CRM_STATE.courseField={id:'course'};
 c.ACCOUNTING_CRM_STATE.customers=[{id:'c1',customFields:{course:'K03'}},{id:'c2',customFields:{course:'K03'}}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p1',kind:'COURSE',courseKey:'K01'},{id:'p2',kind:'COURSE'}];
 c.ACCOUNTING_CRM_STATE.courseConfigs=[{courseKey:'K03',trainerIds:['t'],trainerRates:{t:10},rateLeader:0,rateSale:0}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'o1',customerId:'c1',productId:'p1',saleId:'sale-1',status:'PAID',subtotal:1000000,paidAt:'2026-10-01'},{id:'o2',customerId:'c2',productId:'p2',saleId:'sale-1',status:'PAID',subtotal:2000000,paidAt:'2026-10-01'}];
 c.rebuildAccountingRevenueFromCRM();assert.equal(c.COURSES_DATA.length,3);
 const group=c.COURSES_DATA.find(g=>g.courseKey==='K03');assert.equal(group.totalRevenue,3000000);assert.equal(group.studentsCount,2);
 const summary=c.courseCommissionSummary(group);assert.equal(summary.trainer,300000);assert.equal(summary.sale,0);assert.equal(summary.leader,0);assert.equal(summary.company,2700000);
 assert.equal(c.COURSES_DATA.find(g=>g.courseKey==='K01').totalRevenue,0);
 c.currentGlobalMonth='2026-11';c.rebuildAccountingRevenueFromCRM();assert.equal(c.COURSES_DATA.length,3);assert.ok(c.COURSES_DATA.every(g=>g.totalRevenue===0));
});
test('A direct Manager sale does not earn a second leader commission; sale owner snapshot takes precedence',()=>{
 const c=commissions(model());c.APEX_DATA=[{id:'m',roleLevel:'LV1'},{id:'old',roleLevel:'LV2'},{id:'new',roleLevel:'LV2'}];
 c.ACCOUNTING_CRM_STATE.members=[{id:'m',role:'MANAGER'},{id:'sale-1',role:'SALE',leaderId:'new'}];
 c.ACCOUNTING_CRM_STATE.products=[{id:'p',kind:'COURSE'}];
 c.ACCOUNTING_CRM_STATE.orders=[{id:'a',productId:'p',saleId:'m',managerId:'m',status:'PAID',subtotal:1000,paidAt:'2026-10-01'},{id:'b',productId:'p',saleId:'sale-1',leaderId:'old',status:'PAID',subtotal:2000,paidAt:'2026-10-01'}];
 c.rebuildAccountingRevenueFromCRM();assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[0]),0);assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[1]),100);assert.equal(c.calculateLeaderCourseCommission(c.APEX_DATA[2]),0);
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
