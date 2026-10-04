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

for(const role of ['ADMIN','MANAGER','LEADER','SALE'])test(role+' received data is collapsed and only contains assigned webhook customers',()=>{
 const members=[{id:'manager',role:'MANAGER',name:'Manager'},{id:'leader',role:'LEADER',name:'Leader',managerId:'manager'},{id:'sale',role:'SALE',name:'Sale',leaderId:'leader',managerId:'manager'}];
 const customers=[
  {id:'web',name:'Webhook received',webhookEventId:'evt',saleId:'sale'},
  {id:'legacy',name:'Legacy webhook',source:'Landing Page',saleId:'sale'},
  {id:'manual',name:'Manual excluded',source:'Landing Page',manualEntry:true,saleId:'sale'},
  {id:'order',name:'Order excluded',source:'Nhập đơn hàng',createdVia:'ORDER',saleId:'sale'},
  {id:'csv',name:'Import excluded',source:'CSV',saleId:'sale'},
  {id:'pending',name:'Pending excluded',webhookSlug:'site',saleId:'sale'},
  {id:'unassigned',name:'Unassigned excluded',webhookSlug:'site'}
 ];
 const data={user:{id:role.toLowerCase(),role},members,customers,offers:[{customerId:'web',saleId:'sale',status:'ACCEPTED'},{customerId:'csv',saleId:'sale',status:'ACCEPTED'},{customerId:'pending',saleId:'sale',status:'PENDING'}]};
 const original=JSON.stringify(data),style={},detail={hidden:true},icon={textContent:'+'};
 const button={dataset:{autoRecipientToggle:'sale'},setAttribute(key,value){this[key]=value;},querySelector:()=>icon};
 const host={innerHTML:'',querySelectorAll:selector=>selector==='[data-auto-recipient-toggle]'?[button]:[],querySelector:()=>detail};
 const ctx=vm.createContext({data,q:selector=>selector==='#autoRecipientStats'?host:null,esc:String,fmtDate:String,CSS:{escape:String},document:{createElement:()=>style,head:{appendChild(){}}}});
 const start=source.indexOf('  function renderAutoRecipientStats(){');
 const end=source.indexOf('  function ',start+10);
 const predicate=source.slice(source.indexOf('  function isWebhookDataCustomer('),source.indexOf('  function renderManagementDataTable('));
 vm.runInContext(predicate+source.slice(start,end),ctx);ctx.renderAutoRecipientStats();
 assert.match(host.innerHTML,/Webhook received/);assert.match(host.innerHTML,/Legacy webhook/);assert.match(host.innerHTML,/auto-recipient-count">2 data/);
 for(const name of ['Manual excluded','Order excluded','Import excluded','Pending excluded','Unassigned excluded'])assert.ok(!host.innerHTML.includes(name),name);
 assert.equal((host.innerHTML.match(/data-auto-recipient-customer="web"/g)||[]).length,1);
 assert.match(host.innerHTML,/aria-expanded="false"/);assert.match(host.innerHTML,/data-auto-recipient-detail="sale" hidden/);
 assert.match(style.textContent,/\.auto-recipient-detail\[hidden\]\{display:none!important\}/);
 button.onclick();assert.equal(detail.hidden,false);assert.equal(button['aria-expanded'],'true');assert.equal(icon.textContent,'−');
 button.onclick();assert.equal(detail.hidden,true);assert.equal(button['aria-expanded'],'false');assert.equal(icon.textContent,'+');
 assert.equal(JSON.stringify(data),original);
});
