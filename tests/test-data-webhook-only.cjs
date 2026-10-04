'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
const code=source.slice(source.indexOf('  function isWebhookDataCustomer('),source.indexOf('  const localDateValue='));
for(const role of ['ADMIN','MANAGER','LEADER'])test(role+' Data lists and counts only webhook customers without removing order customers',()=>{
 const common={createdAt:'2026-10-04 10:00',managerId:'manager',leaderId:'leader',teamId:'T'};
 const customers=[
  {...common,id:'web',name:'Webhook customer',webhookEventId:'event',saleId:'sale'},
  {...common,id:'legacy-web',name:'Legacy landing',source:'Landing Page'},
  {...common,id:'order',name:'Order customer',createdVia:'ORDER',source:'Nhập đơn hàng',saleId:'sale'},
  {...common,id:'legacy-order',name:'Legacy order customer',source:'Nhập đơn hàng',saleId:'sale'},
  {...common,id:'manual',name:'Manual customer',manualEntry:true,websiteId:'site'},
  {...common,id:'import',name:'Imported customer',source:'CSV'},
  {...common,id:'unknown',name:'Unattributed webhook',webhookSlug:'unknown'}
 ];
 const members=[{id:'manager',role:'MANAGER'},{id:'leader',role:'LEADER',managerId:'manager'},{id:'sale',role:'SALE',leaderId:'leader'}];
 const orders=[{id:'o',customerId:'order'}],data={user:{id:role==='MANAGER'?'manager':'leader',role},customers,members,orders,websites:[],today:'2026-10-04'};
 const before=JSON.stringify(data),counters={},head={},table={querySelector:()=>head},body={closest:()=>table,querySelectorAll:()=>[]};let total;
 const ctx=vm.createContext({data,q:sel=>sel==='#dataQueueTableBody'?body:sel==='#referenceManagementDataStyles'?{}:null,esc:String,fmtDate:String,fromDay:()=> '2026-10-01',text:(id,v)=>counters[id]=v,renderDataQueuePagination:(t,n)=>total=n,dataQueueDateFrom:'',dataQueueDateTo:'',URL});
 vm.runInContext(code,ctx);ctx.renderManagementDataTable(role);
 assert.match(body.innerHTML,/Webhook customer/);assert.match(body.innerHTML,/Legacy landing/);assert.match(body.innerHTML,/Unattributed webhook/);
 for(const name of ['Order customer','Legacy order customer','Manual customer','Imported customer'])assert.ok(!body.innerHTML.includes(name),name);
 assert.equal(total,3);assert.equal(counters.dataOverviewTotal,3);assert.equal(counters.dataOverviewAccepted,1);assert.equal(counters.sidebarDataBadge,3);assert.equal(counters.dataStatToday,'3 data');
 assert.equal(JSON.stringify(data),before,'Filtering must not mutate persisted customers or orders');
});
