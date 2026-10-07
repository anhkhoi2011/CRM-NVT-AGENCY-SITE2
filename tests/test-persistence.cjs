"use strict";
// Test chạy theo thư mục gốc dự án: fs đọc file và require module từ gốc.
const ROOT=require('node:path').resolve(__dirname,'..');process.chdir(ROOT);
require=require('node:module').createRequire(ROOT+'/');
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
// CSDL giả lập giao dịch để kiểm tra logic; không thay thế thử nghiệm MySQL trên hosting.
function fixture(){
 let db={docs:[],customers:[],orders:[],products:[{id:'p1',sku:'TEST',name:'Test product',category:'Test',price:120,type:'RENTAL',rental_months:3,active:1,created_at:'2026-08-01 08:00:00'}],users:[],history:[],webhookEvents:[],staffAttendance:[]};let backup,fail=false;
 const events=[],queries=[];
 const c={async beginTransaction(){backup=structuredClone(db);events.push('begin');},async commit(){events.push('commit');},async rollback(){db=backup;events.push('rollback');},release(){events.push('release');},
 async query(sql){return this.execute(sql,[]);},
 async execute(sql,v){
  queries.push({sql,values:v,event:events.length});
  if(sql.includes('FROM crm_write_lock')){events.push('lock');return [[{id:1}]];}
  if(sql.startsWith('INSERT INTO webhook_events')){if(!db.webhookEvents.some(e=>e.dedupe===v[1]))db.webhookEvents.push({id:v[0],dedupe:v[1]});return [{}];}
  if(sql.includes('FROM webhook_events WHERE dedupe_key'))return [db.webhookEvents.filter(e=>e.dedupe===v[0])];
  if(sql.includes("FROM crm_documents WHERE collection='websites'"))return [db.docs.filter(d=>d.collection==='websites'&&!d.deleted)];
  if(sql.startsWith('SELECT id, name, phone, email, sale_id, leader_id, team_id, status FROM customers'))return [db.customers.filter(row=>v.includes(row.phone)||(!row.email?false:v.includes(row.email)) )];
  if(sql.startsWith('INSERT INTO customers (')){
   if(!db.customers.some(row=>row.id===v[0]))upsert('customers',['id','name','phone','email','source','campaign','website_id','status','note','custom_fields_json','created_at'],[v[0],v[1],v[2],v[3],'Landing Page',v[4],v[5],'NEW',v[6],v[7],v[8]]);
   return [{}];
  }
  if(sql.startsWith('SELECT * FROM crm_documents WHERE collection IN'))return [structuredClone(db.docs.filter(row=>v.includes(row.collection)))];
  if(sql.includes('FROM system_settings'))return [[{setting_key:'crm_defaults_v1',setting_value:'true'}]];
  if(sql.includes("SELECT deleted FROM crm_documents WHERE collection='customFieldDefinitions'"))return [[{deleted:0}]];
  if(sql.includes('FROM users'))return [structuredClone(db.users)];
  if(sql.includes('FROM staff_attendance'))return [structuredClone(db.staffAttendance)];
  for(const key of ['customers','orders','products'])if(sql===`SELECT * FROM ${key}`)return [structuredClone(db[key])];
  if(sql.startsWith('SELECT actor_id'))return [db.history.filter(x=>x.request_id===v[0])];
  if(sql.startsWith('INSERT INTO crm_changes')){db.history.push({request_id:v[0],actor_id:v[1],changes_json:JSON.parse(v[2])});return [{}];}
  if(sql.startsWith('INSERT INTO crm_documents')){
   if(fail)throw new Error('Disk/database failure');
   if(sql.includes('VALUES (?,?,?,0)')){
    for(let i=0;i<v.length;i+=3){
     const row={collection:v[i],id:v[i+1],body:JSON.parse(v[i+2]),deleted:0};
     db.docs=db.docs.filter(x=>x.collection!==row.collection||x.id!==row.id);db.docs.push(row);
    }
    return [{}];
   }
   const row={collection:v[0],id:v[1],body:JSON.parse(v[2]),deleted:v[3]||0};db.docs=db.docs.filter(x=>x.collection!==row.collection||x.id!==row.id);db.docs.push(row);return [{}];
  }
  if(sql.startsWith('INSERT INTO customers')){
   const keys=['id','name','phone','email','source','campaign','website_id','status','sale_id','leader_id','team_id','note','custom_fields_json','created_at'];
   upsert('customers',keys,v);return [{}];
  }
  if(sql.startsWith('INSERT INTO orders')){upsert('orders',['id','code','customer_id','sale_id','leader_id','team_id','total_amount','status','items_json','note','created_at'],v);return [{}];}
  if(sql.startsWith('INSERT INTO products')){upsert('products',['id','sku','name','category','price','type','rental_months','active','created_at'],v);return [{}];}
  if(sql.startsWith('UPDATE users SET name')){const row=db.users.find(x=>x.id===v[6]);if(row)Object.assign(row,{name:v[0],role:v[1],team_id:v[2],leader_id:v[3],active:v[4],email:v[5]||row.email});return [{}];}
  if(sql.startsWith('UPDATE users SET active')){const row=db.users.find(x=>x.id===v[0]);if(row)row.active=0;return [{}];}
  if(sql.startsWith('UPDATE ')||sql.startsWith('CREATE TABLE')||sql.startsWith('INSERT IGNORE INTO crm_write_lock')||sql.startsWith('INSERT INTO system_settings'))return [{}];
  throw new Error('Unexpected SQL: '+sql);
 }};
 function upsert(key,keys,v){const row=Object.fromEntries(keys.map((k,i)=>[k,v[i]]));row.created_at=db[key].find(r=>r.id===row.id)?.created_at||row.created_at||'2026-09-14 09:00:00';row.updated_at='2026-09-14 10:00:00';db[key]=db[key].filter(r=>r.id!==row.id);db[key].push(row);}
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('crm-data.cjs','utf8'),{module,require:name=>name==='./db.js'?{pool:{query:async()=>[{}],getConnection:async()=>c}}:require(name),Buffer,console});
 const webhook={exports:{}};
 vm.runInNewContext(fs.readFileSync('webhook-store.cjs','utf8'),{module:webhook,URL,require:name=>name==='./db.js'?{dbConfigured:true,pool:{query:async()=>[{}],getConnection:async()=>c}}:name==='./crm-data.cjs'?module.exports:require(name)});
 return {api:module.exports,webhook:webhook.exports,events,queries,get db(){return db;},fail(){fail=true;}};
}
const admin={id:'admin',role:'ADMIN'},sale={id:'sale',role:'SALE',teamId:'T',leaderId:'lead'};
const customer={id:'c1',name:'Khách thử',phone:'0912345678',saleId:'sale',teamId:'T',leaderId:'lead',status:'NEW',createdAt:'2026-08-01 09:00:00',customFields:{level:'L3'}};
const order={id:'o1',code:'NVT-o1',customerId:'c1',saleId:'sale',teamId:'T',leaderId:'lead',status:'PENDING',subtotal:360,vatRate:0.1,vatAmount:36,total:376,qty:3,unitPrice:120,discount:20,productId:'p1',productName:'Historical price',paymentMode:'DEPOSIT',depositAmount:100,balanceDue:376,amountPaid:0,paymentMethod:'VietQR',billing:{name:'Test customer',cccd:'012345678901',phone:'0912345678',email:'khach@example.vn',address:'TP HCM',taxId:''},rentalMonths:3,rentalEndsAt:'2026-11-01T03:00:00.000Z',createdAt:'2026-08-01 10:00:00'};
const change=(key,value,base=null)=>({key,id:value.id,base,value});
test('Sale tạo khách, đơn, ghi chú, công việc trong một giao dịch; giữ giá và ngày gốc',async()=>{
 const f=fixture();const result=await f.api.write(sale,'one',[change('orders',order),change('notes',{id:'n1',customerId:'c1',text:'Lần đầu'}),change('tasks',{id:'t1',customerId:'c1'}),change('customers',customer)]);
 assert.equal(result.state.orders[0].unitPrice,120);assert.equal(result.state.orders[0].discount,20);assert.equal(result.state.orders[0].vatAmount,36);assert.equal(result.state.orders[0].billing.cccd,'012345678901');assert.equal(result.state.orders[0].rentalMonths,3);assert.equal(result.state.customers[0].createdAt,customer.createdAt);assert.equal(result.state.notes.length,1);assert.equal(f.db.history.length,1);
 const reread=await f.api.read(admin);assert.equal(reread.state.tasks.length,1);assert.equal(reread.state.orders[0].createdAt,order.createdAt);
});
test('Đọc nền không giữ khóa ghi và không chạy lại quét phân data',async()=>{
 const f=fixture();await f.api.prepare();f.events.length=0;
 await f.api.read(admin,{passive:true});
 assert.equal(f.events.includes('lock'),false);
});
test('Lỗi giữa giao dịch rollback cả projection và documents',async()=>{
 const f=fixture();f.fail();await assert.rejects(f.api.write(admin,'fail',[change('customers',customer)]),/failure/);assert.equal(f.db.customers.length,0);assert.equal(f.db.history.length,0);assert.ok(f.events.includes('rollback'));
});
test('Gửi lại cùng requestId không tạo bản sao; phiên bản cũ bị 409',async()=>{
 const f=fixture(),first=await f.api.write(admin,'one',[change('customers',customer)]);
 const retry=await f.api.write(admin,'one',[change('customers',customer)]);assert.equal(retry.replayed,true);assert.equal(f.db.history.length,1);
 await f.api.write(admin,'two',[change('customers',{...first.state.customers[0],name:'Mới'},first.versions['customers/c1'])]);
 await assert.rejects(f.api.write(admin,'three',[change('customers',{...first.state.customers[0],name:'Cũ'},first.versions['customers/c1'])]),e=>e.status===409);
 assert.equal((await f.api.read(admin)).state.customers[0].name,'Mới');
});
test('Khách thêm thủ công được lưu trong customers SQL và đọc lại sau F5',async()=>{
 const f=fixture();
 const manual={id:'manual-customer',name:'Khách nhập tay',phone:'0865976582',email:'quangha@example.vn',source:'Khách hàng cũ',campaign:'MANUAL-CRM',websiteId:null,status:'NEW',saleId:'manager',leaderId:null,teamId:null,managerId:'manager',saleAcceptedAt:'2026-09-25 09:49:00',manualEntry:true,note:'Tạo thủ công từ CRM',customFields:{customerClass:'Nóng',customerLevel:'L4.1: Hẹn nạp vốn'},createdAt:'2026-09-25 09:49:00',updatedAt:'2026-09-25 09:49:00'};
 const saved=await f.api.write(admin,'manual-customer-save',[change('customers',manual)]);
 const sql=f.db.customers.find(row=>row.id===manual.id);
 assert.equal(sql.email,'quangha@example.vn');assert.equal(sql.source,'Khách hàng cũ');assert.equal(sql.website_id,null);assert.equal(sql.sale_id,'manager');
 const metadata=JSON.parse(sql.custom_fields_json).__crmMeta;
 assert.equal(metadata.manualEntry,true);assert.equal(metadata.managerId,'manager');
 const reread=await f.api.read(admin),restored=reread.state.customers.find(row=>row.id===manual.id);
 assert.equal(saved.ok,true);assert.equal(restored.email,'quangha@example.vn');assert.equal(restored.source,'Khách hàng cũ');assert.equal(restored.manualEntry,true);assert.equal(restored.managerId,'manager');assert.equal(restored.customFields.customerLevel,'L4.1: Hẹn nạp vốn');
});
test('Feedback và Quy Trình được lưu trong SQL document store và đọc lại sau F5',async()=>{
 const f=fixture();
 const feedback={id:'fb-sql',authorId:'admin',authorName:'Admin',category:'SUPPORT',note:'Đã kiểm tra lỗi webhook',imageData:'',createdAt:'2026-09-28 10:00:00',updatedAt:'2026-09-28 10:00:00'};
 const process={id:'proc-sql',title:'Quy trình xử lý data mới',summary:'Các bước tiếp nhận và phân data',content:'Kiểm tra nguồn, trùng số và phân người phụ trách.',link:'https://example.com/process',imageData:'',authorId:'admin',createdAt:'2026-09-28 10:00:00',updatedAt:'2026-09-28 10:00:00'};
 const saved=await f.api.write(admin,'feedback-process-sql',[change('feedbacks',feedback),change('processes',process)]);
 assert.equal(saved.ok,true);
 assert.equal(f.db.docs.find(row=>row.collection==='feedbacks'&&row.id==='fb-sql').deleted,0);
 assert.equal(f.db.docs.find(row=>row.collection==='processes'&&row.id==='proc-sql').deleted,0);
 const reread=await f.api.read(admin);
 assert.equal(reread.state.feedbacks.find(row=>row.id==='fb-sql').note,'Đã kiểm tra lỗi webhook');
 assert.equal(reread.state.processes.find(row=>row.id==='proc-sql').title,'Quy trình xử lý data mới');
 });
test('Sale nhận data đang chờ phục hồi đầy đủ số điện thoại và lưu thành công',async()=>{
 const f=fixture();
 f.db.users.push({id:'lead',name:'Leader',role:'LEADER',team_id:'T',active:1},{id:'sale',name:'Sale',role:'SALE',team_id:'T',leader_id:'lead',active:1});
 f.db.customers.push({id:'c_pending',name:'Khách pending',phone:'0988776655',email:'pending@test.vn',source:'Landing Page',campaign:'',website_id:null,status:'NEW',sale_id:null,leader_id:'lead',team_id:'T',custom_fields_json:'{}',created_at:'2026-08-01 09:00:00'});
 const nowStr=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);
 f.db.docs.push({collection:'dataOffers',id:'o_pending',body:{id:'o_pending',customerId:'c_pending',saleId:'sale',leaderId:'lead',teamId:'T',offeredAt:nowStr,status:'PENDING',resolvedAt:'',source:'AUTO'},deleted:0});
 const readBefore=await f.api.read(sale);
 const censored=readBefore.state.customers.find(c=>c.id==='c_pending');
 assert.equal(censored.phone,undefined);
 const acceptedCust={...censored,saleId:'sale',saleAcceptedAt:nowStr,updatedAt:nowStr};
 const acceptedOffer={id:'o_pending',customerId:'c_pending',saleId:'sale',leaderId:'lead',teamId:'T',offeredAt:nowStr,status:'ACCEPTED',resolvedAt:nowStr,source:'AUTO'};
 const writeResult=await f.api.write(sale,'accept-req-1',[change('customers',acceptedCust,readBefore.versions['customers/c_pending']),change('dataOffers',acceptedOffer,readBefore.versions['dataOffers/o_pending'])]);
 assert.equal(writeResult.ok,true);
 const readAfter=await f.api.read(sale);
 const fullCust=readAfter.state.customers.find(c=>c.id==='c_pending');
 assert.equal(fullCust.saleId,'sale');
 assert.equal(fullCust.phone,'0988776655');
 assert.equal(fullCust.email,'pending@test.vn');
});
test('Sale không thấy khách đội khác, không tự PAID hay tự thăng Admin',async()=>{
 const f=fixture();await f.api.write(admin,'one',[change('customers',customer),change('orders',order)]);
 assert.equal((await f.api.read({...sale,id:'other'})).state.customers.length,0);
 const result=await f.api.read(sale);
 await assert.rejects(f.api.write(sale,'two',[change('orders',{...result.state.orders[0],status:'PAID'},result.versions['orders/o1'])]),e=>e.status===403);
 await assert.rejects(f.api.write(sale,'three',[change('members',{id:'sale',name:'Sale',role:'ADMIN'})]),e=>e.status===403);
});
test('Chỉ Admin, Leader và Manager được đổi tên khách trong phạm vi; Sale bị từ chối',async()=>{
  const f=fixture();
  await f.api.write(admin,'name-permission-seed',[change('members',{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true}),change('customers',customer)]);
  let adminRead=await f.api.read(admin);
  await f.api.write(admin,'admin-name',[change('customers',{...adminRead.state.customers[0],name:'Tên Admin cập nhật'},adminRead.versions['customers/c1'])]);
  const leaderAccount={id:'lead',role:'LEADER',teamId:'T',leaderId:'lead'};
  let leaderRead=await f.api.read(leaderAccount);
  await f.api.write(leaderAccount,'leader-name',[change('customers',{...leaderRead.state.customers[0],name:'Tên Leader cập nhật'},leaderRead.versions['customers/c1'])]);
  const saleRead=await f.api.read(sale);
  await assert.rejects(f.api.write(sale,'sale-name',[change('customers',{...saleRead.state.customers[0],name:'Sale tự đổi tên'},saleRead.versions['customers/c1'])]),e=>e.status===403);
  const mf=await managerFixture(),managerAccount={id:'mgr',role:'MANAGER'};
  const managerRead=await mf.api.read(managerAccount);
  await mf.api.write(managerAccount,'manager-name',[change('customers',{...managerRead.state.customers.find(item=>item.id==='c1'),name:'Tên Manager cập nhật'},managerRead.versions['customers/c1'])]);
  assert.equal((await mf.api.read(admin)).state.customers.find(item=>item.id==='c1').name,'Tên Manager cập nhật');
 });
 test('Toàn bộ collection phụ đọc lại được; xóa giữ before-image',async()=>{
 const f=fixture();f.db.users.push({id:'sale',name:'Sale',role:'SALE',team_id:'T',leader_id:'lead',active:1});const keys=f.api.LISTS.filter(k=>!['customers','orders','products','members'].includes(k));
 const changes=keys.map(key=>change(key,key==='courseConfigs'?{id:'row-'+key,courseKey:'K01',trainerIds:[],leaderIds:[],rateSale:15,rateLeader:5,rateTrainer:15,rateCompany:65}:key==='brokerageMetrics'?{id:'row-'+key,memberId:'sale',leaderId:'lead',teamId:'T',period:'2026-09',basicLots:0,microLots:0,nanoLots:0,lotCommissionRate:0,indicatorCommissionRate:0,courseCommissionRate:0,vatRate:.1}:key==='hrProfiles'?{id:'sale',employeeId:'sale',fields:{cccd:'012345678901'},driveFiles:[]}: {id:'row-'+key,value:'giữ lâu dài'}));
 for(const key of f.api.OBJECTS)changes.push({key,id:'$',base:null,value:key==='productCategories'?['Dịch vụ']:{test:'giữ'}});
 await f.api.write(admin,'all',changes);let result=await f.api.read(admin);
 for(const key of keys)assert.equal(result.state[key].length,1,key);
 await f.api.write(admin,'delete',[{key:'notes',id:'row-notes',base:result.versions['notes/row-notes'],value:null}]);
 result=await f.api.read(admin);assert.equal(result.state.notes.length,0);assert.equal(f.db.history[1].changes_json[0].before.value,'giữ lâu dài');assert.equal(f.db.docs.find(r=>r.collection==='notes').deleted,1);
});
test('Phân quyền tài khoản chờ ghi đúng users; xóa không hồi sinh',async()=>{
 const f=fixture();f.db.users.push({id:'u1',name:'Nguyễn A',role:'UNASSIGNED',phone:'0900000000',email:'a@test.vn',active:1,created_at:'2026-09-14 09:00:00'});
 let r=await f.api.read(admin);assert.equal(r.state.registeredAccounts.length,1);
 r=await f.api.write(admin,'assign',[change('members',{...r.state.registeredAccounts[0],role:'LEADER',teamId:'T'},r.versions['members/u1'])]);
 assert.equal(f.db.users[0].role,'LEADER');assert.equal(r.state.registeredAccounts.length,0);assert.equal(r.state.members.length,1);
 await f.api.write(admin,'delete',[{key:'members',id:'u1',base:r.versions['members/u1'],value:null}]);assert.equal((await f.api.read(admin)).state.members.length,0);assert.equal(f.db.users[0].active,0);
});
test('Leader đổi phân phối không xóa bí mật của Admin',async()=>{
 const f=fixture();await f.api.write(admin,'settings',[{key:'settings',id:'$',base:null,value:{dataBotToken:'secret',saleAssignmentModes:{},assignmentCursor:{}}}]);
 const lead={id:'lead',role:'LEADER',teamId:'T'},r=await f.api.read(lead);assert.equal(r.state.settings.dataBotToken,undefined);
 await f.api.write(lead,'edit',[{key:'settings',id:'$',base:r.versions['settings/$'],value:{...r.state.settings,saleAssignmentModes:{lead:'AUTO'}}}]);
 assert.equal((await f.api.read(admin)).state.settings.dataBotToken,'secret');
});
test('Offer hết hạn được lưu bởi server',async()=>{
 const f=fixture();await f.api.write(admin,'offer',[change('dataOffers',{id:'of1',customerId:'c1',saleId:'sale',status:'PENDING',offeredAt:'2020-01-01 10:00'})]);
 assert.equal((await f.api.read(admin)).state.dataOffers[0].status,'EXPIRED');assert.equal(f.db.history.at(-1).actor_id,'SYSTEM');
});
function frontend(){
 const elements=new Map();const node=()=>({value:'',children:[],dataset:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},addEventListener(){},append(){},prepend(){},remove(){},focus(){},setAttribute(){},querySelectorAll(){return [];}});
 const document={readyState:'loading',activeElement:{},documentElement:node(),body:node(),addEventListener(){},createElement:node,querySelector(q){if(!elements.has(q))elements.set(q,node());return elements.get(q);},querySelectorAll(){return [];}};
 const values=new Map(),store={getItem(key){return values.has(key)?values.get(key):null;},setItem(key,value){values.set(key,String(value));},removeItem(key){values.delete(key);},key(index){return [...values.keys()][index]??null;}};Object.defineProperty(store,'length',{get(){return values.size;}});
 const context={OrderPayments:require('./order-payments.js'),document,window:{addEventListener(){},matchMedia(){return {matches:false};},location:{protocol:'http:',origin:'http://localhost:4173',hostname:'localhost'},confirm:()=>true},location:{protocol:'http:',origin:'http://localhost:4173',hostname:'localhost'},localStorage:store,sessionStorage:store,navigator:{},crypto:require('node:crypto').webcrypto,structuredClone,console,URL,Blob,Intl,TextEncoder,confirm:()=>true,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async()=>({ok:false,json:async()=>({error:'offline'})})};
 vm.createContext(context);vm.runInContext(fs.readFileSync('crm.js','utf8'),context);return context;
}
test('Khach hang tong chi hien mot dong cho moi so dien thoai va uu tien Sale dang phu trach', () => {
 const c=frontend();
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN',scope:'ALL'};state=initialState();state.members=[{id:'sale-old',name:'Sale dang phu trach',role:'SALE',active:true,teamId:'T'},{id:'sale-new',name:'Sale moi',role:'SALE',active:true,teamId:'T'}];state.customers=[{id:'old',name:'Khach cu',phone:'0912345678',saleId:'sale-old',saleAcceptedAt:'2026-09-21 10:00',status:'NEW',createdAt:'2026-09-20 10:00',updatedAt:'2026-09-21 10:00',customFields:{}},{id:'new',name:'Khach trung',phone:'+84912345678',saleId:null,status:'NEW',createdAt:'2026-09-21 11:00',updatedAt:'2026-09-21 11:00',customFields:{}}];state.dataOffers=[];STAFF=state.members;`,c);
 const html=vm.runInContext('customersView()',c);
 assert.equal((html.match(/data-open-customer=/g)||[]).length,1);
 assert.match(html,/Sale dang phu trach/);
});
test('Pending hierarchy does not put Manager-owned customers in unassigned Leader',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8');
 assert.match(source,/const managerFor=c=>\{/);
 assert.match(source,/!hasLeader\(c\)&&!managerFor\(c\)&&!directManagerSaleIds\.has\(saleIdFor\(c\)\)/);
 assert.match(source,/directRows=rows\.filter\(c=>managerFor\(c\)\?\.id===manager\.id/);
});
test('Pending data is driven by the selected customer Level value',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8');
 assert.match(source,/return !String\(c\.customFields\?\.customerLevel\|\|'\'\)\.trim\(\);/);
 assert.doesNotMatch(source,/return c\.levelChosen!==true;/);
 assert.match(source,/pending-data-head small/);
});
test('Frontend khởi tạo form đăng nhập không truy cập tài khoản mẫu đã xóa',async()=>{const c=frontend();await c.initialize();assert.equal(vm.runInContext('state.members.length',c),0);});
test('Frontend lỗi mạng giữ requestId và bản nháp để retry',async()=>{
 const c=frontend();vm.runInContext("currentAccount={id:'admin',role:'ADMIN'};serverSyncToken='token';applyServerSnapshot({state:initialState(),versions:{}});state.notes.push({id:'n1',text:'Bản nháp'});",c);
 assert.equal(await c.flushServerPersistence(),false);const id=vm.runInContext('serverPendingRequest.requestId',c);
 assert.equal(await c.flushServerPersistence(),false);assert.equal(vm.runInContext('serverPendingRequest.requestId',c),id);assert.equal(vm.runInContext('hasServerChanges()',c),true);
});
test('Frontend giữ sửa tiếp trong lúc request đang chạy; snapshot sạch không phát sinh ghi',()=>{
 const c=frontend();vm.runInContext("applyServerSnapshot({state:initialState(),versions:{}})",c);assert.equal(vm.runInContext('hasServerChanges()',c),false);
 vm.runInContext("state.notes=[{id:'n',text:'gửi'}]; const sent=serverRecords();state.notes[0].text='sửa tiếp';applyServerSnapshot({state:{...initialState(),notes:[{id:'n',text:'gửi'}]},versions:{'notes/n':'revision'}},sent);",c);
 assert.equal(vm.runInContext('state.notes[0].text',c),'sửa tiếp');assert.equal(vm.runInContext('pendingChanges()[0].base',c),'revision');
});

test('Các view chính dựng được sau khi tải snapshot rỗng',()=>{
 const c=frontend();vm.runInContext("currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});applyServerSnapshot({state:initialState(),versions:{}});",c);
 for(const view of ['dashboard','customers','orders','products','team','settings','audit','notifications'])vm.runInContext(`currentView=${JSON.stringify(view)};render()`,c);
});

test('Dashboard điều hành lấy KPI, doanh thu và cảnh báo thuê từ dữ liệu đã đồng bộ',()=>{
 const c=frontend();
 vm.runInContext(`
  const today=dayIso(0), future=new Date(Date.now()+2*86400000).toISOString();
  currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});
  applyServerSnapshot({state:{...initialState(),members:[
    {id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true},
    {id:'sale',name:'Sale',role:'SALE',teamId:'T',leaderId:'lead',target:10000000,active:true}
  ],customers:[{id:'c1',name:'Khách thật',phone:'0912345678',source:'Landing Page',status:'CONTACTED',saleId:'sale',leaderId:'lead',teamId:'T',createdAt:today+' 09:00',updatedAt:today+' 09:00',customFields:{}}],products:[{id:'p1',name:'Chỉ báo thật',sku:'IND-REAL',category:'Chỉ báo',price:1000000,type:'RENTAL',rentalMonths:1,active:true}],orders:[{id:'o1',code:'NVT-REAL',customerId:'c1',customerName:'Khách thật',saleId:'sale',leaderId:'lead',teamId:'T',source:'Landing Page',campaign:'LIVE',productId:'p1',productName:'Chỉ báo thật',sku:'IND-REAL',qty:1,unitPrice:1000000,subtotal:1000000,vatRate:.1,vatAmount:100000,discount:0,total:1100000,paymentMode:'FULL',depositAmount:0,amountPaid:1100000,balanceDue:0,paymentMethod:'VietQR',rentalMonths:1,rentalEndsAt:future,status:'PAID',createdAt:today+' 09:00',paidAt:today+' 10:00'}]},versions:{}});
 `,c);
 const html=vm.runInContext('executiveDashboardView()',c);
 assert.match(html,/Tổng khách hàng/);assert.match(html,/Khách thật/);assert.match(html,/Chỉ báo thật/);
 assert.match(html,/Gói thuê cần gia hạn/);assert.match(html,/Còn 2 ngày/);assert.match(html,/Tạo đơn hàng mới/);
 assert.doesNotMatch(html,/26\.000\.000/);
});

function authFixture(rows=[],duplicate=false,schemaReady=Promise.resolve(true)){
 const calls=[],signals=[];
 const query=async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT'))return rows;if(duplicate&&sql.startsWith('INSERT INTO users'))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});return [];};
 const c={setTimeout,clearTimeout,dbConfigured:true,systemSchemaReady:schemaReady,systemAccountsReady:Promise.resolve(true),crypto:require('node:crypto'),bcrypt:{hash:async p=>'hashed:'+p,compare:async(p,h)=>h==='hashed:'+p},passwordService:{hash:async p=>'hashed:'+p,compare:async(p,h)=>h==='hashed:'+p},crmData:{userRow:r=>({id:r.id,role:r.role})},dbQuery:query,authQuery:query,readBody:async r=>Buffer.from(JSON.stringify(r.body||{})),sendJson:(response,status,payload)=>{response.status=status;response.payload=payload;},notifyInboxListeners:e=>signals.push(e),stamp:()=> '2026-09-14 10:00',Buffer,console};
 const text=fs.readFileSync('webhook-server.cjs','utf8');vm.createContext(c);vm.runInContext(text.slice(text.indexOf('function dbJson('),text.indexOf('\n/**',text.indexOf('function dbJson('))),c);
 return {calls,signals,context:c,async request(path,body){const response={};await c.handleDbApi({method:'POST',headers:{},body},response,path);return response;}};
}
test('Login khong cho seed CRM hoan tat',async()=>{
 let release;
 const stalledSchema=new Promise(resolve=>{release=resolve;});
 const f=authFixture([{id:'active-admin',role:'ADMIN',password_hash:'correct-password'}],false,stalledSchema);
 const result=await Promise.race([f.request('/api/auth/login',{identifier:'admin@example.test',password:'correct-password'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('login waited for schema seed')),500))]);
 assert.equal(result.status,200);release(true);
});
test('Đăng ký công khai lưu hash và báo Admin ngay sau insert',async()=>{
 const f=authFixture();const result=await f.request('/api/auth/register',{phone:'0912345678',email:'sale@example.vn',name:'Sale',accountId:'SALE001',password:'password123'});
 assert.equal(result.status,201);assert.equal(f.signals.length,1);assert.equal(f.signals[0].kind,'users');const insert=f.calls.find(x=>x.sql.startsWith('INSERT'));assert.equal(insert.args[1],'SALE001');assert.equal(insert.args[4],'hashed:password123');assert.ok(insert.sql.includes("'UNASSIGNED'"));
});
test('Đăng ký trùng trả 400 không phát tín hiệu thành công',async()=>{
 const f=authFixture([],true);const result=await f.request('/api/auth/register',{phone:'0912345678',email:'sale@example.vn',name:'Sale',accountId:'SALE001',password:'password123'});assert.equal(result.status,400);assert.equal(f.signals.length,0);
});
test('Tài khoản chưa phân quyền không được cấp phiên đăng nhập',async()=>{
 const f=authFixture([{id:'u1',phone:'0912345678',role:'UNASSIGNED',password_hash:'password123'}]);const result=await f.request('/api/auth/login',{identifier:'0912345678',password:'password123'});assert.equal(result.status,403);assert.equal(f.calls.some(x=>x.sql.startsWith('INSERT INTO crm_sessions')),false);
});
test('User log dùng phiên máy chủ để ghi IP, đăng nhập, đăng xuất và màn hình đang mở',()=>{
 const server=fs.readFileSync('webhook-server.cjs','utf8'),ui=fs.readFileSync('reference-crm.js','utf8');
 assert.match(server,/user_activity_logs/);assert.match(server,/api\/admin\/user-activity/);assert.match(server,/recordUserActivity\(row,request,'LOGIN','Đăng nhập CRM'\)/);assert.match(server,/recordUserActivity\(user,request,'LOGOUT','Đăng xuất CRM'\)/);assert.match(server,/clientIp\(request\)/);
 assert.match(ui,/Trạng thái nhân sự/);assert.match(ui,/ĐANG LÀM GÌ/);assert.match(ui,/Lịch sử hoạt động/);assert.match(ui,/reportUserActivity\(id\)/);
 assert.match(ui,/\(roleA==='ADMIN'\)!==\(roleB==='ADMIN'\)/);assert.match(ui,/Boolean\(a\.online\)!==Boolean\(b\.online\)/);assert.match(ui,/const people=orderedUsers\.map/);
});

test('Đồng bộ giữ tham chiếu của form đang mở để lần sửa tiếp theo được lưu',()=>{
 const c=frontend();vm.runInContext("applyServerSnapshot({state:{...initialState(),customers:[{id:'c',name:'A'}]},versions:{}});const formCustomer=state.customers[0];applyServerSnapshot({state:{...initialState(),customers:[{id:'c',name:'B'}]},versions:{'customers/c':'new'}});formCustomer.name='C';",c);
 assert.equal(vm.runInContext('state.customers[0].name',c),'C');assert.equal(vm.runInContext('pendingChanges()[0].value.name',c),'C');
});

test('Marketing/Kế toán có dữ liệu tra cứu, được điểm danh cá nhân nhưng không có quyền ghi dữ liệu khác',async()=>{
 const f=fixture();await f.api.write(admin,'initial',[change('customers',customer),change('orders',order),{key:'settings',id:'$',base:null,value:{dataBotToken:'private'}},change('traffic',{id:'tr1',source:'Ads'})]);
 for(const role of ['MARKETING','ACCOUNTING']){
  const user={id:role,role},r=await f.api.read(user);
  assert.equal(r.state.customers.length,1);assert.equal(r.state.orders.length,1);if(role==='ACCOUNTING')assert.equal(r.state.settings.dataBotToken,undefined);else assert.equal(r.state.settings,undefined);assert.equal(r.state.accounts.length,0);
  assert.equal(r.state.traffic.length,role==='MARKETING'?1:0);
  await assert.rejects(f.api.write(user,'deny-'+role,[change('customers',{...r.state.customers[0],name:'Changed'},r.versions['customers/c1'])]),e=>e.status===403);
  await assert.rejects(f.api.write(user,'escalate-'+role,[change('members',{id:user.id,name:'X',role:'ADMIN'})]),e=>e.status===403);
 }
});
test('Hai vai trò phòng ban giữ đúng role, menu và không phát sinh ghi khi đăng nhập',async()=>{
 for(const role of ['MARKETING','ACCOUNTING']){
  const c=frontend();vm.runInContext(`currentAccount=hydrateSessionAccount({id:'dept',role:${JSON.stringify(role)},name:'Phòng ban'});applyServerSnapshot({state:initialState(),versions:{}});`,c);
  assert.equal(vm.runInContext('currentAccount.role',c),role);assert.equal(vm.runInContext('currentAccount.scope',c),'ALL');
  assert.equal(vm.runInContext("allowedViews().includes('settings')||allowedViews().includes('team')",c),false);
  for(const view of vm.runInContext('allowedViews()',c))vm.runInContext(`currentView=${JSON.stringify(view)};render()`,c);
  assert.equal(vm.runInContext('hasServerChanges()',c),false);assert.equal(vm.runInContext("orderEditState({createdAt:'2026-09-14 10:00'}).allowed",c),false);
 }
});
function seedFixture(existing=[],failEmail=null){
 const {provisionSystemAccounts}=require('./system-accounts.cjs');let users=structuredClone(existing),marker=false,backup;let sessions=['old'];const events=[];
 const c={async beginTransaction(){backup={users:structuredClone(users),marker,sessions:[...sessions]};},async commit(){events.push('commit');},async rollback(){if(backup)({users,marker,sessions}=backup);events.push('rollback');},release(){events.push('release');},async query(sql){if(sql.includes('GET_LOCK'))return [[{acquired:1}]];return [[]];},async execute(sql,v=[]){
  if(sql.startsWith('SELECT setting_key'))return [marker?[{setting_key:'done'}]:[]];
  if(sql.startsWith('SELECT id,email FROM users WHERE LOWER'))return [users.filter(u=>u.email.toLowerCase()===v[0])];
  if(sql.startsWith('SELECT id,email'))return [users.filter(u=>u.id==='u-admin-start'&&u.role==='ADMIN')];
  if(sql.startsWith('UPDATE users SET email')){if(v[0]===failEmail)throw new Error('DB failure');Object.assign(users.find(u=>u.id===v[4]),{email:v[0],name:v[1],role:v[2],password_hash:v[3],active:1});return [{}];}
  if(sql.startsWith('INSERT INTO users')){if(v[1]===failEmail)throw new Error('DB failure');users.push({id:v[0],email:v[1],name:v[2],role:v[3],password_hash:v[4],active:1});return [{}];}
  if(sql.startsWith('DELETE FROM crm_sessions')){sessions=[];return [{}];}
  if(sql.startsWith('UPDATE crm_documents'))return [{}];
  if(sql.startsWith('INSERT INTO system_settings')){marker=true;return [{}];}
  throw new Error('Unexpected: '+sql);
 }};
 return {run:()=>provisionSystemAccounts({getConnection:async()=>c}),get users(){return users;},get marker(){return marker;},events};
}
test('Khởi tạo ba tài khoản khi bảng đã có Sale; mật khẩu là bcrypt và role khác nhau',async()=>{
 const f=seedFixture([{id:'sale',email:'sale@test.vn',role:'SALE'}]);await f.run();assert.equal(f.users.length,4);
 const roles={'admin@nvtagency.top':'ADMIN','marketing@nvtagency.top':'MARKETING','ketoan@nvtagency.top':'ACCOUNTING'};
 for(const [email,role] of Object.entries(roles)){const user=f.users.find(u=>u.email===email);assert.equal(user.role,role);assert.match(user.password_hash,/^\$2[aby]\$/);}
 assert.equal(f.marker,true);
});
test('Khôi phục email Admin hiện hữu giữ ID, áp dụng một lần, restart không reset mật khẩu',async()=>{
 const f=seedFixture([{id:'existing-admin',email:'admin@nvtagency.top',role:'UNASSIGNED',password_hash:'old'}]);await f.run();const user=f.users.find(u=>u.email==='admin@nvtagency.top');assert.equal(user.id,'existing-admin');assert.equal(user.role,'ADMIN');assert.notEqual(user.password_hash,'old');user.password_hash='user-changed';assert.equal((await f.run()).applied,false);assert.equal(f.users.find(u=>u.id===user.id).password_hash,'user-changed');assert.equal(f.users.length,3);
});
test('Lỗi tạo một tài khoản rollback toàn bộ và không đánh dấu đã khởi tạo',async()=>{
 const f=seedFixture([{id:'sale',email:'sale@test.vn',role:'SALE'}],'marketing@nvtagency.top');await assert.rejects(f.run(),/DB failure/);assert.equal(f.users.length,1);assert.equal(f.marker,false);assert.ok(f.events.includes('rollback'));
});
test('Đăng nhập hiển thị đúng lỗi server thay vì luôn báo sai mật khẩu',async()=>{
 const c=frontend();await c.initialize();c.fetch=async()=>({ok:false,status:503,json:async()=>({error:'MySQL chưa được cấu hình'})});
 vm.runInContext("document.querySelector('#loginPhone').value='0900000001';document.querySelector('#loginPassword').value='dummy';document.querySelector('#loginForm button[type=\"submit\"]').innerHTML='Đăng nhập';",c);
 await vm.runInContext("document.querySelector('#loginForm').onsubmit({preventDefault(){}})",c);
 assert.equal(vm.runInContext("document.querySelector('#loginError').textContent",c),'MySQL chưa được cấu hình');
 assert.equal(vm.runInContext("document.querySelector('#loginForm button[type=\"submit\"]').disabled",c),false);
 assert.equal(vm.runInContext("document.querySelector('#loginForm button[type=\"submit\"]').innerHTML",c),'Đăng nhập');
 assert.doesNotMatch(fs.readFileSync('crm.js','utf8'),/Xuất dữ liệu trình duyệt cũ|exportLegacyData/);
});

test('Khôi phục sản phẩm localStorage cũ không ghi đè sản phẩm đã có',async()=>{
 const c=frontend();vm.runInContext(`localStorage.setItem(STORAGE_KEY,JSON.stringify({products:[{id:'old-1',name:'Chỉ báo Gold',sku:'GOLD',category:'Chỉ báo',price:2500000,type:'SALE'},{id:'same',name:'Đã có',sku:'EXIST',category:'CRM',price:1,type:'SALE'}]}));currentAccount={id:'admin',name:'Admin',role:'ADMIN',scope:'ALL'};applyServerSnapshot({state:{...initialState(),products:[{id:'same',name:'Đã có',sku:'EXIST',category:'CRM',price:1,type:'SALE',active:true}]},versions:{}});flushServerPersistence=async()=>true;`,c);
 assert.equal(vm.runInContext('legacyProductCandidates().length',c),1);await c.restoreLegacyProducts();
 assert.equal(vm.runInContext('state.products.length',c),2);assert.equal(vm.runInContext("state.products.find(p=>p.id==='old-1').price",c),2500000);assert.equal(vm.runInContext('localStorage.length',c),1);
});

function productSeedFixture(existing=[],failSku=''){
 let products=structuredClone(existing),marker=false,backup;
 const events=[];
 const c={async beginTransaction(){backup={products:structuredClone(products),marker};events.push('begin');},async commit(){events.push('commit');},async rollback(){products=backup.products;marker=backup.marker;events.push('rollback');},release(){},async query(sql){if(sql.includes('crm_write_lock'))return [[{id:1}]];throw new Error('Unexpected query: '+sql);},async execute(sql,v=[]){
  if(sql.includes("setting_key='product_catalog_20260914_v1'"))return [marker?[{setting_key:'product_catalog_20260914_v1'}]:[]];
  if(sql.startsWith('SELECT candidate.id FROM')){
   events.push('catalog-read');
   const matched=[];
   const same=(a,b)=>String(a||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===String(b||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   for(let i=0;i<v.length;i+=2)if(products.some(item=>same(item.id,v[i])||same(item.sku,v[i+1])))matched.push({id:v[i]});
   return [matched];
  }
  if(sql.startsWith('SELECT id FROM products'))return [products.filter(item=>item.id===v[0]||item.sku===v[1]).map(item=>({id:item.id}))];
  if(sql.startsWith('INSERT INTO products')){if(v[1]===failSku)throw new Error('Catalog failure');products.push({id:v[0],sku:v[1],name:v[2],category:v[3],price:v[4],type:v[5],rental_months:v[6],active:v[7]});return [{}];}
  if(sql.startsWith('INSERT INTO system_settings')){marker=true;return [{}];}
  throw new Error('Unexpected execute: '+sql);
 }};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('crm-data.cjs','utf8'),{module,require:name=>name==='./db.js'?{pool:{getConnection:async()=>c}}:require(name),Buffer,console});
 return {run:()=>module.exports.seedProductCatalog(),removeAll(){products=[];},get products(){return products;},get marker(){return marker;},events};
}
test('Catalog seed inserts seven products with exact prices and rental periods',async()=>{
 const f=productSeedFixture();const result=await f.run();assert.equal(result.inserted,7);assert.equal(f.products.length,7);assert.equal(f.marker,true);
 assert.deepEqual(f.products.map(p=>[p.sku,p.price,p.rental_months]),[['KH-HHCB-09',5000000,null],['KH-KLCS-10',10000000,null],['KH-RSIMA-11',26000000,null],['IND-BF-R1M',1014000,1],['IND-BF-R3M',3042000,3],['IND-BF-R6M',6084000,6],['IND-BF-R12M',12168000,12]]);
});
test('Catalog seed preserves existing ID/SKU and does not resurrect after marker',async()=>{
 const f=productSeedFixture([{id:'custom-id',sku:'KH-HHCB-09',name:'Admin edited name',price:123}]);await f.run();assert.equal(f.products.find(p=>p.sku==='KH-HHCB-09').price,123);assert.equal(f.products.length,7);
 f.removeAll();const retry=await f.run();assert.equal(retry.applied,false);assert.equal(f.products.length,0);
});
test('Catalog seed rolls back and leaves no marker after failure',async()=>{
 const f=productSeedFixture([], 'IND-BF-R3M');await assert.rejects(f.run(),/Catalog failure/);assert.equal(f.products.length,0);assert.equal(f.marker,false);assert.ok(f.events.includes('rollback'));
});
test('Frontend only permits theme and the account-scoped snapshot cache in localStorage',()=>{
 const html=fs.readFileSync('index.html','utf8'),runtime=fs.readFileSync('crm.js','utf8'),reference=fs.readFileSync('reference-crm.js','utf8');assert.doesNotMatch(html,/localStorage\.setItem|nvt-payment-sidecar|const CATALOG/);const runtimeWrites=[...runtime.matchAll(/localStorage\.setItem\(([^,]+)/g)].map(match=>match[1].trim());const referenceWrites=[...reference.matchAll(/localStorage\.setItem\(([^,]+)/g)].map(match=>match[1].trim());assert.deepEqual(runtimeWrites.sort(),['SESSION_KEY','SESSION_KEY','THEME_KEY','pendingWriteStorageKey()']);assert.deepEqual(referenceWrites.sort(),['ACTIVE_TAB_KEY','CACHED_SNAPSHOT_KEY','SESSION_KEY','key']);assert.match(reference,/const draftStore={/);assert.match(reference,/session\.accountId!==accountId\|\|session\.role!==role\)\{clearCachedSnapshot\(\);return null;\}/);
});
function referenceCacheFixture(){
 const source=fs.readFileSync('reference-crm.js','utf8'),start=source.indexOf('  const snapshotRole='),end=source.indexOf('    const esc=',start),values=new Map();
 const storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const context={sessionStorage:storage,localStorage:storage,console,Date};vm.createContext(context);vm.runInContext("const SESSION_KEY='nvt-crm-session-v1';const CACHED_SNAPSHOT_KEY='nvt_crm_cached_snapshot_v1';\n"+source.slice(start,end),context);return {context,storage,values};
}
test('Snapshot cache hydrates only for the matching account and role',()=>{
 const f=referenceCacheFixture(),snapshot={user:{id:'admin',role:'ADMIN'},navigation:['dashboard'],customers:[]};
 f.storage.setItem('nvt-crm-session-v1',JSON.stringify({token:'token',accountId:'admin',role:'ADMIN'}));
 f.storage.setItem('nvt_crm_cached_snapshot_v1',JSON.stringify({version:1,savedAt:Date.now(),accountId:'admin',role:'ADMIN',snapshot}));
 assert.equal(vm.runInContext('readCachedSnapshot().user.id',f.context),'admin');
 f.storage.setItem('nvt-crm-session-v1',JSON.stringify({token:'token',accountId:'sale',role:'SALE'}));
 assert.equal(vm.runInContext('readCachedSnapshot()',f.context),null);assert.equal(f.storage.getItem('nvt_crm_cached_snapshot_v1'),null);
});
test('Snapshot cache is cleared without a token and overwritten after revalidation',()=>{
 const f=referenceCacheFixture(),snapshot={user:{id:'sale',role:'SALE'},navigation:['dashboard'],customers:[]};
 f.storage.setItem('nvt_crm_cached_snapshot_v1',JSON.stringify({version:1,accountId:'sale',role:'SALE',snapshot}));
 assert.equal(vm.runInContext('readCachedSnapshot()',f.context),null);assert.equal(f.storage.getItem('nvt_crm_cached_snapshot_v1'),null);
 f.storage.setItem('nvt-crm-session-v1',JSON.stringify({token:'token',accountId:'sale',role:'SALE'}));f.context.snapshot=snapshot;vm.runInContext('saveCachedSnapshot(snapshot)',f.context);
 const saved=JSON.parse(f.storage.getItem('nvt_crm_cached_snapshot_v1'));assert.equal(saved.accountId,'sale');assert.equal(saved.role,'SALE');assert.ok(saved.savedAt>0);
});
test('Runtime session metadata and authentication exits clear the CRM snapshot cache',()=>{
 const source=fs.readFileSync('crm.js','utf8');assert.match(source,/accountId: currentAccount\.id, role: currentAccount\.actualRole \|\| currentAccount\.role/);assert.ok((source.match(/(?:localStorage|storage)\.removeItem\(CACHED_SNAPSHOT_KEY\)/g)||[]).length>=2);
});
test('Rental expiry warning persists exactly once',async()=>{
 const f=fixture(),ends=new Date(Date.now()+2*86400000).toISOString();await f.api.write(admin,'rental',[change('customers',customer),change('orders',{...order,status:'PAID',amountPaid:order.total,balanceDue:0,paidAt:'2026-09-14 10:00',rentalEndsAt:ends})]);
 const first=await f.api.read(admin),second=await f.api.read(admin);assert.equal(first.state.notifications.filter(n=>n.id==='NT-RENT-o1').length,1);assert.equal(second.state.notifications.filter(n=>n.id==='NT-RENT-o1').length,1);assert.equal(f.db.docs.filter(d=>d.collection==='notifications'&&d.id==='NT-RENT-o1').length,1);
});

test('Server rejects a Sale order whose price differs from the MySQL catalog',async()=>{
 const f=fixture();await assert.rejects(f.api.write(sale,'bad-price',[change('customers',customer),change('orders',{...order,unitPrice:1,subtotal:3,vatAmount:0,discount:0,total:3,balanceDue:3})]),error=>error.status===400);assert.equal(f.db.orders.length,0);
});
test('Sale order form keeps VAT, deposit, billing and rental data in the unified MySQL change',async()=>{
 const c=frontend();vm.runInContext(`applyServerSnapshot({state:{...initialState(),members:[{id:'sale',name:'Sale',role:'SALE',teamId:'T',leaderId:'lead',active:true}],customers:[{id:'c1',name:'Customer',phone:'0912345678',email:'c@example.vn',saleId:'sale',teamId:'T',leaderId:'lead',source:'Direct / Referral'}],products:[{id:'p1',name:'Indicator',sku:'IND-BF-R1M',category:'Indicator',price:1014000,type:'RENTAL',rentalMonths:1,active:true}]},versions:{}});currentAccount=hydrateSessionAccount({id:'sale',name:'Sale',role:'SALE',teamId:'T',leaderId:'lead'});flushServerPersistence=async()=>true;newOrderModal('c1');document.querySelector('#newOrderCustomer').value='c1';document.querySelector('#newOrderProduct').value='p1';document.querySelector('#newOrderQty').value='2';document.querySelector('#newOrderPaymentMode').value='DEPOSIT';document.querySelector('#newOrderDeposit').value='500000';document.querySelector('#newOrderPaymentMethod').value='VietQR';document.querySelector('#newOrderBillingName').value='Customer';document.querySelector('#newOrderBillingPhone').value='0912345678';document.querySelector('#newOrderBillingEmail').value='c@example.vn';`,c);
 await vm.runInContext("document.querySelector('#newOrderForm').onsubmit({preventDefault(){}})",c);const saved=vm.runInContext('state.orders[0]',c);assert.equal(saved.subtotal,2028000);assert.equal(saved.vatAmount,202800);assert.equal(saved.total,2230800);assert.equal(saved.depositAmount,500000);assert.equal(saved.billing.phone,'0912345678');assert.equal(saved.rentalMonths,1);assert.ok(saved.rentalEndsAt);assert.equal(saved.status,'PENDING');assert.equal(vm.runInContext("state.audit.some(row=>row.entity===state.orders[0].id)",c),true);
});

test('Product SKU remains unique inside one transactional state update',async()=>{
 const f=fixture(),productA={id:'pa',name:'A',sku:'DUP-SKU',category:'Test',price:1,type:'SALE',active:true},productB={id:'pb',name:'B',sku:'dup-sku',category:'Test',price:2,type:'SALE',active:true};await assert.rejects(f.api.write(admin,'duplicate-sku',[change('products',productA),change('products',productB)]),error=>error.status===400);assert.equal(f.db.products.filter(p=>p.id==='pa'||p.id==='pb').length,0);
});

test('Deposit and final payment financial events never double-count revenue',()=>{
 const c=frontend(),base={id:'o',code:'NVT-o',customerName:'Customer',total:1100,depositAmount:300,depositAt:'2026-09-14 09:00',paidAt:'2026-09-14 10:00',paymentMethod:'VietQR'};assert.deepEqual(Array.from(vm.runInContext(`orderFinancialEvents(${JSON.stringify(base)}).map(event=>event.amount)`,c)),[300,800]);assert.equal(vm.runInContext(`netRevenue([${JSON.stringify(base)}])`,c),1100);assert.equal(vm.runInContext(`netRevenue([${JSON.stringify({...base,refundedAt:'2026-09-14 11:00',refund:1100})}])`,c),0);
});

test('Frontend removes the manual sync toolbar and shows detailed landing source', () => {
 const js=fs.readFileSync('crm.js','utf8');
 assert.doesNotMatch(js,/id="syncNowButton"|id="exportDraftButton"|id="importRecoveryButton"|id="reloadServerButton"/);
 const c=frontend();
 vm.runInContext(`applyServerSnapshot({state:{...initialState(),websites:[{id:'web',name:'Hoang Phuc Academy',domain:'www.hoangphucacademy.vn',sourceUrl:'https://www.hoangphucacademy.vn/',webhookSlug:'DS-TEST'}],customers:[{id:'cus',name:'Customer',phone:'0912345678',source:'Landing Page',campaign:'ACADEMY',websiteId:'web',createdAt:'2026-09-14 10:00',updatedAt:'2026-09-14 10:00'}]},versions:{}})`,c);
 const details=vm.runInContext("customerSourceDetails(state.customers[0])",c);
 assert.equal(details.name,'Hoang Phuc Academy');assert.equal(details.url,'https://www.hoangphucacademy.vn/');
});
test('Old webhook customer is attributed from stored slug without changing assignment', async () => {
 const f=fixture();
 f.db.docs.push({collection:'websites',id:'web',deleted:0,body:{id:'web',name:'Hoang Phuc Academy',domain:'www.hoangphucacademy.vn',sourceUrl:'https://www.hoangphucacademy.vn/',webhookSlug:'DS-OLD'}});
 f.db.customers.push({id:'old',name:'Old customer',phone:'0911111111',email:null,source:'Landing Page',campaign:null,website_id:null,status:'NEW',sale_id:'sale',leader_id:'lead',team_id:'T',note:'',custom_fields_json:JSON.stringify({webhookSlug:'DS-OLD',webhookEventId:'event'}),created_at:'2026-09-01 09:00:00',updated_at:'2026-09-01 09:00:00'});
 const row=(await f.api.read(admin)).state.customers[0];
 assert.equal(row.websiteId,'web');assert.equal(row.landingPageUrl,'https://www.hoangphucacademy.vn/');assert.equal(row.saleId,'sale');
});

test('Data queue shows landing URL and rental products use rental availability labels', () => {
 const c=frontend();
 vm.runInContext(`currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});applyServerSnapshot({state:{...initialState(),websites:[{id:'web',name:'Hoang Phuc Academy',domain:'www.hoangphucacademy.vn',sourceUrl:'https://www.hoangphucacademy.vn/',webhookSlug:'DS-TEST'}],customers:[{id:'cus',name:'Customer',phone:'0912345678',source:'Landing Page',campaign:'UNATTRIBUTED',websiteId:'web',landingPageName:'Landing Page',createdAt:'2026-09-14 10:00',updatedAt:'2026-09-14 10:00',customFields:{}}],products:[{id:'rental',name:'Rental indicator',sku:'RENT-1',category:'Indicator',price:100,type:'RENTAL',rentalMonths:1,active:true}]},versions:{}});distributionTab='QUEUE';`,c);
 const dataHtml=vm.runInContext('distributionView()',c),productHtml=vm.runInContext('productsView()',c);
 assert.match(dataHtml,/Hoang Phuc Academy/);assert.match(dataHtml,/https:\/\/www\.hoangphucacademy\.vn\//);assert.doesNotMatch(dataHtml,/Khong campaign|Kh?ng campaign/);
 assert.match(productHtml,/Đang cho thuê/);assert.match(productHtml,/Ngừng cho thuê/);assert.doesNotMatch(productHtml,/Rental indicator[\s\S]*Đang bán/);
});

test('Admin navigation badges show pending data and unassigned accounts immediately', () => {
 const c=frontend();
 vm.runInContext(`currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});applyServerSnapshot({state:{...initialState(),customers:[{id:'cus',name:'New customer',phone:'0912345678',source:'Landing Page',status:'NEW',saleId:null,leaderId:null,teamId:null,createdAt:'2026-09-14 10:00',updatedAt:'2026-09-14 10:00',customFields:{}}],registeredAccounts:[{id:'new-user',name:'New user',role:'UNASSIGNED',active:true}]},versions:{}});webhookPending=[{id:'pending-webhook'}];renderNavigation();`,c);
 const html=c.document.querySelector('#sideNav').innerHTML;
 assert.match(html,/data-view-link="distribution"[\s\S]*?<span class="nav-badge">2<\/span>/);
 assert.match(html,/data-view-link="team"[\s\S]*?<span class="nav-badge">1<\/span>/);
 assert.equal(vm.runInContext("navigationBadgeCount('distribution')",c),2);
 assert.equal(vm.runInContext("navigationBadgeCount('team')",c),1);
});

test('Badge counts refresh from MySQL without replacing a form that is being edited', async () => {
 const c=frontend();
 vm.runInContext("currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});serverSyncToken='token';applyServerSnapshot({state:initialState(),versions:{}});document.activeElement.tagName='INPUT';",c);
 c.fetch=async()=>({ok:true,json:async()=>({data:4,team:2})});
 assert.equal(await c.refreshNavigationCounts(),true);
 assert.equal(vm.runInContext("navigationBadgeCount('distribution')",c),4);
 assert.equal(vm.runInContext("navigationBadgeCount('team')",c),2);
 assert.equal(vm.runInContext('state.customers.length',c),0);
});


test('Leader selects a Sale from the customer table and persists the pending assignment', async () => {
 const f=fixture(),c=frontend(),lead={id:'lead',name:'Leader',role:'LEADER',teamId:'T'};
 f.db.users.push({id:'lead',name:'Leader',role:'LEADER',team_id:'T',active:1},{id:'sale',name:'Sale One',phone:'0900000001',role:'SALE',team_id:'T',leader_id:'lead',active:1},{id:'sale2',name:'Sale Two',role:'SALE',team_id:'T',leader_id:'lead',active:1},{id:'other',name:'Other Team',role:'SALE',team_id:'OTHER',leader_id:'other-lead',active:1});
 await f.api.write(admin,'seed-manual',[change('customers',{...customer,saleId:null})]);
 c.snapshot=await f.api.read(lead);c.lead=lead;
 c.window.scrollTo=()=>{};
 vm.runInContext("currentAccount=hydrateSessionAccount(lead);serverSyncToken='token';applyServerSnapshot(snapshot);currentView='customers';queueEmailNotification=()=>{};",c);
 const html=vm.runInContext('customersView()',c);
 assert.match(html,/<td class="col-staff"><select[^>]*data-quick-sale="c1"/);
 assert.match(html,/value="sale"/);assert.doesNotMatch(html,/value="other"/);
 c.fetch=async(url,options)=>{const body=JSON.parse(options.body);const result=await f.api.write(lead,body.requestId,body.changes);return {ok:true,json:async()=>result};};
 assert.equal(await c.quickAssignSale('c1','sale'),true);
 let saved=await f.api.read(lead);
 assert.equal(saved.state.dataOffers.filter(o=>o.status==='PENDING').length,1);
 assert.equal(saved.state.dataOffers[0].saleId,'sale');assert.equal(saved.state.customers[0].saleId,null);
 assert.match(vm.runInContext('customersView()',c),/<option value="sale" selected>/);
 assert.equal(await c.quickAssignSale('c1','sale'),true);
 assert.equal((await f.api.read(lead)).state.dataOffers.length,1);
 assert.equal(await c.quickAssignSale('c1','other'),false);
 assert.equal((await f.api.read(lead)).state.dataOffers[0].saleId,'sale');
 assert.equal(await c.quickAssignSale('c1','lead'),true);
 saved=await f.api.read(lead);
 assert.equal(saved.state.customers[0].saleId,'lead');
 assert.equal(saved.state.dataOffers.filter(o=>o.status==='PENDING').length,0);
 assert.equal(await c.quickAssignSale('c1',''),true);
 saved=await f.api.read(lead);
 assert.equal(saved.state.customers[0].saleId,null);
 assert.equal(saved.state.customers[0].leaderId,'lead');
 assert.equal(saved.state.customers[0].teamId,'T');
});


test('Round robin keeps one customer per recipient and defers a new Sale to the next round',()=>{
 const c=frontend();
 vm.runInContext(`currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});state=initialState();state.members=[{id:'lead',name:'Leader',role:'LEADER',teamId:'T',managerId:'mgr',active:true},{id:'mgr',name:'Manager',role:'MANAGER',active:true},{id:'s1',name:'Sale 1',role:'SALE',leaderId:'lead',teamId:'T',active:true},{id:'s2',name:'Sale 2',role:'SALE',leaderId:'lead',teamId:'T',active:true},{id:'s3',name:'Sale 3',role:'SALE',leaderId:'lead',teamId:'T',active:true}];state.saleDistributionByLeader.lead={leaderEnabled:false,managerDistributionInitialized:false,enabledSaleIds:[],weights:{}};STAFF=state.members;`,c);
 const pick=()=>vm.runInContext(`chooseAssignmentTarget({leaderId:'lead',teamId:'T'},'ROUND_ROBIN').id`,c);
 assert.deepEqual([pick(),pick(),pick(),pick()],['mgr','s1','s2','s3']);
 vm.runInContext(`state.members.push({id:'s4',name:'Sale 4',role:'SALE',leaderId:'lead',teamId:'T',active:true})`,c);
 assert.equal(pick(),'mgr');
 assert.deepEqual([pick(),pick(),pick(),pick()],['s1','s2','s3','s4']);
});
test('Team allocation includes Leader, counts pending offers, and obeys weights', () => {
 const c=frontend();
 vm.runInContext(`currentAccount=hydrateSessionAccount({id:'lead',name:'Leader',role:'LEADER',teamId:'T'});applyServerSnapshot({state:{...initialState(),members:[{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true},...[1,2,3,4].map(n=>({id:'s'+n,name:'Sale '+n,role:'SALE',leaderId:'lead',teamId:'T',active:true}))]},versions:{}});queueEmailNotification=()=>{};`,c);
 const run=(n)=>vm.runInContext(`state.customers=[];state.dataOffers=[];for(let i=0;i<${n};i++){const row={id:'c'+i,name:'Customer',phone:'0900000000',leaderId:'lead',teamId:'T',saleId:null};state.customers.push(row);const target=chooseAssignmentTarget(row,'BALANCED');applyCustomerAssignment(row,target,'Test');}JSON.stringify(Object.fromEntries(teamRecipients('lead','T').map(p=>[p.id,assignmentLoad(p)])))`,c);
 assert.deepEqual(JSON.parse(run(10)),{lead:2,s1:2,s2:2,s3:2,s4:2});
 vm.runInContext("state.saleDistributionByLeader.lead={leaderEnabled:true,enabledSaleIds:['s1','s2','s3','s4'],weights:{lead:2,s1:1,s2:1,s3:1,s4:1}}",c);
 assert.deepEqual(JSON.parse(run(12)),{lead:4,s1:2,s2:2,s3:2,s4:2});
 vm.runInContext("state.saleDistributionByLeader.lead.leaderEnabled=false",c);
 assert.equal(vm.runInContext("assignmentCandidates({leaderId:'lead',teamId:'T'}).some(p=>p.id==='lead')",c),false);
});

test('24h expiry keeps Team and adds reassignment note; manual clear preserves Team',async()=>{
 const f=fixture();await f.api.write(admin,'expiry-note',[change('customers',{...customer,saleId:null}),change('dataOffers',{id:'expired',customerId:'c1',saleId:'sale',leaderId:'lead',teamId:'T',offeredAt:'2020-01-01 00:00',status:'PENDING'})]);
 const result=await f.api.read(admin);assert.equal(result.state.dataOffers[0].status,'EXPIRED');assert.equal(result.state.customers[0].saleId,null);assert.equal(result.state.customers[0].leaderId,'lead');assert.match(result.state.customers[0].note,/24h/);
 const c=frontend();c.snapshot=result;vm.runInContext("currentAccount=hydrateSessionAccount({id:'lead',name:'Leader',role:'LEADER',teamId:'T'});applyServerSnapshot(snapshot);flushServerPersistence=async()=>true;",c);c.window.scrollTo=()=>{};
 assert.equal(await c.quickAssignSale('c1',''),true);
 assert.equal(vm.runInContext('state.customers[0].teamId',c),'T');
});


test('Admin bulk allocation cascades to weighted Team recipients including Leader', () => {
 const c=frontend();
 vm.runInContext(`currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});applyServerSnapshot({state:{...initialState(),members:[{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true},...[1,2,3,4].map(n=>({id:'s'+n,name:'Sale '+n,role:'SALE',leaderId:'lead',teamId:'T',active:true}))],customers:Array.from({length:10},(_,i)=>({id:'c'+i,name:'Customer',phone:'0900000000',createdAt:'2026-09-14 09:00',leaderId:null,teamId:null,saleId:null}))},versions:{}});state.leaderDistribution.enabledLeaderIds=['lead'];queueEmailNotification=()=>{};bulkDistributePool('BALANCED');`,c);
 assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(Object.fromEntries(teamRecipients('lead','T').map(p=>[p.id,assignmentLoad(p)])))",c)),{lead:2,s1:2,s2:2,s3:2,s4:2});
});




async function automaticFixture(mode='ROUND_ROBIN',leaderWeight=1) {
 const f=fixture();
 f.db.users.push({id:'lead',name:'Leader',role:'LEADER',team_id:'T',active:1},...[1,2,3,4].map(n=>({id:'s'+n,name:'Sale '+n,role:'SALE',team_id:'T',leader_id:'lead',active:1})));
 await f.api.write(admin,'auto-config',[
  {key:'settings',id:'$',base:null,value:{assignmentMode:mode,assignmentCursor:{leaders:0,salesByTeam:{}}}},
  {key:'leaderDistribution',id:'$',base:null,value:{enabled:true,enabledLeaderIds:['lead'],weights:{lead:1},sourceRules:[]}},
  {key:'saleDistributionByLeader',id:'$',base:null,value:{lead:{leaderEnabled:true,enabledSaleIds:['s1','s2','s3','s4'],weights:{lead:leaderWeight,s1:1,s2:1,s3:1,s4:1}}}}
 ]);
 return f;
}
function landingRecord(n) {return {id:'WHE-'+n,dedupeKey:'dedupe-'+n,status:'NEW',slug:'DS-UNKNOWN',receivedAt:'2026-09-14 22:02:00',customer:{name:'Customer '+n,phone:'0900000'+String(n).padStart(3,'0')}};}
function recipientCounts(snapshot) {
 return Object.fromEntries(['lead','s1','s2','s3','s4'].map(id=>[id,snapshot.state.customers.filter(c=>c.saleId===id).length+snapshot.state.dataOffers.filter(o=>o.saleId===id&&o.status==='PENDING').length]));
}
test('Actual webhook routes and commits without an Admin browser; replay preserves assignment and cursor',async()=>{
 const f=await automaticFixture();
 for(let i=0;i<10;i++)await f.webhook.persistWebhook(landingRecord(i));
 // Inspect stored SQL rows before any API read: allocation happened inside webhook.
 assert.equal(f.db.customers.filter(c=>c.leader_id==='lead'&&c.team_id==='T').length,10);
 let result=await f.api.read(admin);
 assert.deepEqual(recipientCounts(result),{lead:2,s1:2,s2:2,s3:2,s4:2});
 const before=JSON.stringify({offers:result.state.dataOffers,history:result.state.assignmentHistory,cursor:result.state.settings.assignmentCursor});
 await f.webhook.persistWebhook(landingRecord(0));result=await f.api.read(admin);
 assert.equal(JSON.stringify({offers:result.state.dataOffers,history:result.state.assignmentHistory,cursor:result.state.settings.assignmentCursor}),before);
 assert.equal(f.db.customers.length,10);
 assert.ok(f.events.indexOf('lock')<f.events.indexOf('commit'));
});
for(const mode of ['ROUND_ROBIN','BALANCED'])test('Server '+mode+' respects 2:1 including pending offers',async()=>{
 const f=await automaticFixture(mode,2);
 for(let i=0;i<12;i++)await f.webhook.persistWebhook(landingRecord(i));
 assert.deepEqual(recipientCounts(await f.api.read(admin)),{lead:4,s1:2,s2:2,s3:2,s4:2});
});
test('Saving enabled configuration allocates existing queue, but leaves expired Team customer for Leader',async()=>{
 const f=await automaticFixture();
 let result=await f.api.read(admin);
 await f.api.write(admin,'disable',[{key:'leaderDistribution',id:'$',base:result.versions['leaderDistribution/$'],value:{...result.state.leaderDistribution,enabled:false}}]);
 await f.webhook.persistWebhook(landingRecord(1));
 assert.equal(f.db.customers[0].leader_id,undefined);
 await f.api.write(admin,'expired-team',[change('customers',{...customer,id:'expired-team',saleId:null}),change('dataOffers',{id:'old-offer',customerId:'expired-team',saleId:'s1',leaderId:'lead',teamId:'T',status:'PENDING',offeredAt:'2020-01-01 00:00'})]);
 result=await f.api.read(admin);
 result=await f.api.write(admin,'enable',[{key:'leaderDistribution',id:'$',base:result.versions['leaderDistribution/$'],value:{...result.state.leaderDistribution,enabled:true}}]);
 assert.equal(result.state.customers.find(c=>c.id==='CUS-WHE-1').leaderId,'lead');
 assert.equal(result.state.customers.find(c=>c.id==='expired-team').saleId,null);
 assert.equal(result.state.dataOffers.filter(o=>o.customerId==='expired-team'&&o.status==='PENDING').length,0);
});
test('Webhook assignment failure rolls back customer, event, history and weight cursor',async()=>{
 const f=await automaticFixture();const before=structuredClone(f.db);
 f.fail();await assert.rejects(f.webhook.persistWebhook(landingRecord(1)),/failure/);
 assert.deepEqual(f.db,before);
});
test('No enabled Leader keeps intake safely queued; enabling Leader processes it',async()=>{
 const f=await automaticFixture();let result=await f.api.read(admin);
 await f.api.write(admin,'no-leaders',[{key:'leaderDistribution',id:'$',base:result.versions['leaderDistribution/$'],value:{...result.state.leaderDistribution,enabledLeaderIds:[]}}]);
 await f.webhook.persistWebhook(landingRecord(1));result=await f.api.read(admin);
 assert.equal(result.state.customers[0].leaderId,null);
 result=await f.api.write(admin,'select-leader',[{key:'leaderDistribution',id:'$',base:result.versions['leaderDistribution/$'],value:{...result.state.leaderDistribution,enabledLeaderIds:['lead']}}]);
 assert.equal(result.state.customers[0].leaderId,'lead');
});


test('Automatic assignment returns SQL revision valid for immediate next edit',async()=>{
 const f=await automaticFixture();
 const result=await f.api.write(admin,'create-unassigned',[change('customers',{...customer,saleId:null,leaderId:null,teamId:null})]);
 const row=result.state.customers[0];
 await f.api.write(admin,'edit-assigned',[change('customers',{...row,note:'Edited'},result.versions['customers/'+row.id])]);
 assert.equal((await f.api.read(admin)).state.customers[0].note,'Edited');
});
test('Source rule overrides rotation; disabled team recipients receive no offer',async()=>{
 const f=await automaticFixture();f.db.users.push({id:'lead2',name:'Leader 2',role:'LEADER',team_id:'T2',active:1});
 const snapshot=await f.api.read(admin);
 await f.api.write(admin,'source-config',[
  {key:'leaderDistribution',id:'$',base:snapshot.versions['leaderDistribution/$'],value:{enabled:true,enabledLeaderIds:['lead','lead2'],weights:{lead:100,lead2:1},sourceRules:[{active:true,matchType:'SOURCE',matchValue:'Landing Page',targetLeaderId:'lead2'}]}},
  {key:'saleDistributionByLeader',id:'$',base:snapshot.versions['saleDistributionByLeader/$'],value:{...snapshot.state.saleDistributionByLeader,lead2:{leaderEnabled:false,enabledSaleIds:[],weights:{}}}}
 ]);
 await f.webhook.persistWebhook(landingRecord(1));
 const result=await f.api.read(admin);
 assert.equal(result.state.customers[0].leaderId,'lead2');
 assert.equal(result.state.customers[0].saleId,null);
 assert.equal(result.state.dataOffers.length,0);
});
test('Explicit global rounds take precedence over matching source rules for incoming webhook data',async()=>{
 const f=await automaticFixture();f.db.users.push({id:'lead2',name:'Leader 2',role:'LEADER',team_id:'T2',active:1});
 const snapshot=await f.api.read(admin);
 await f.api.write(admin,'global-round-source-rule',[
  {key:'leaderDistribution',id:'$',base:snapshot.versions['leaderDistribution/$'],value:{...snapshot.state.leaderDistribution,enabledLeaderIds:['lead','lead2'],sourceRules:[{active:true,matchType:'SOURCE',matchValue:'Landing Page',targetLeaderId:'lead2'}]}},
  {key:'saleDistributionByLeader',id:'$',base:snapshot.versions['saleDistributionByLeader/$'],value:{...snapshot.state.saleDistributionByLeader,'$':{globalCycle:true,rounds:[{id:'explicit-round-1',enabledSaleIds:['s2'],weights:{s2:1}}]}}}
 ]);
 await f.webhook.persistWebhook(landingRecord(1));
 const result=await f.api.read(admin);
 assert.equal(result.state.customers[0].leaderId,'lead');
 assert.deepEqual(recipientCounts(result),{lead:0,s1:0,s2:1,s3:0,s4:0});
});
test('Legacy global distribution configuration still takes precedence over source rules',async()=>{
 const f=await automaticFixture();f.db.users.push({id:'lead2',name:'Leader 2',role:'LEADER',team_id:'T2',active:1});
 const snapshot=await f.api.read(admin);
 await f.api.write(admin,'legacy-global-source-rule',[
  {key:'leaderDistribution',id:'$',base:snapshot.versions['leaderDistribution/$'],value:{...snapshot.state.leaderDistribution,enabledLeaderIds:['lead','lead2'],sourceRules:[{active:true,matchType:'SOURCE',matchValue:'Landing Page',targetLeaderId:'lead2'}]}},
  {key:'saleDistributionByLeader',id:'$',base:snapshot.versions['saleDistributionByLeader/$'],value:{...snapshot.state.saleDistributionByLeader,$:{globalCycle:true,enabledSaleIds:['s1'],weights:{s1:1}}}}
 ]);
 await f.webhook.persistWebhook(landingRecord(2));
 const result=await f.api.read(admin),customer=result.state.customers.find(row=>row.id==='CUS-WHE-2'),offer=result.state.dataOffers.find(row=>row.customerId===customer.id);
 assert.equal(customer.leaderId,'lead');
 assert.equal(offer.saleId,'s1');
});
test('UI mode and toggle save to server and allocate queue without client distribution',async()=>{
 const f=await automaticFixture();let snapshot=await f.api.read(admin);
 await f.api.write(admin,'ui-off',[{key:'leaderDistribution',id:'$',base:snapshot.versions['leaderDistribution/$'],value:{...snapshot.state.leaderDistribution,enabled:false}}]);
 await f.webhook.persistWebhook(landingRecord(1));
 const c=frontend();c.snapshot=await f.api.read(admin);
 vm.runInContext("currentAccount=hydrateSessionAccount({id:'admin',name:'Admin',role:'ADMIN'});serverSyncToken='token';applyServerSnapshot(snapshot);render=()=>{};bulkDistributePool=()=>{throw new Error('Must run on server');};",c);
 c.fetch=async(url,options)=>{const body=JSON.parse(options.body);return {ok:true,json:async()=>await f.api.write(admin,body.requestId,body.changes)};};
 await c.toggleLeaderDistribution();
 assert.equal(vm.runInContext('state.customers[0].leaderId',c),'lead');
 assert.equal(vm.runInContext('serverAutomationStatus.engine',c),'server-v1');
 await c.setAssignmentMode('MANUAL');
 await f.webhook.persistWebhook(landingRecord(2));
 c.snapshot=await f.api.read(admin);vm.runInContext('applyServerSnapshot(snapshot)',c);
 assert.equal(vm.runInContext("state.customers.find(c=>c.id==='CUS-WHE-2').leaderId",c),null);
 await c.setAssignmentMode('BALANCED');
 assert.equal(vm.runInContext("state.customers.find(c=>c.id==='CUS-WHE-2').leaderId",c),'lead');
});

test('Care renderer uses server field options, escapes labels, and recalculates membership',()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('care-ui.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN',scope:'ALL'};state=initialState();state.careGroups=[{id:'care',name:'<script>unsafe</script>',fieldId:'customerClass',values:['Premium'],color:'#2563eb'}];state.customers=[{id:'c1',name:'Care customer',phone:'0900000000',status:'NEW',customFields:{customerClass:'Premium'}}];`,c);
 assert.equal(vm.runInContext('careMembers(state.careGroups[0]).length',c),1);
 const html=c.careView();assert.match(html,/data-edit-care="care"/);assert.match(html,/data-quick-custom-field="c1"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>unsafe/);
 vm.runInContext(`state.customers[0].customFields.customerClass='Whale'`,c);
 assert.equal(vm.runInContext('careMembers(state.careGroups[0]).length',c),0);
});
test('Admin co the sua xoa va doi thu tu muc cham soc', async () => {
 const c=frontend();vm.runInContext(fs.readFileSync('care-ui.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN',scope:'ALL'};state=initialState();state.careGroups=[{id:'a',name:'A',fieldId:'customerClass',values:['Premium'],color:'#2563eb'},{id:'b',name:'B',fieldId:'customerClass',values:['Whale'],color:'#2563eb'}];saveState=()=>{};render=()=>{};flushServerPersistence=async()=>true;`,c);
 await vm.runInContext(`moveCareGroup('b','up')`,c);
 assert.equal(JSON.stringify(vm.runInContext('state.careGroups.map(group=>group.id)',c)),JSON.stringify(['b','a']));
 const html=vm.runInContext('careView()',c);assert.match(html,/data-edit-care="b"/);assert.match(html,/data-delete-care="a"/);assert.match(html,/data-move-care="b"/);
});
test('Care configuration persists through store and rejects Sale modifications',async()=>{
 const f=fixture();const groups=[{id:'cg',name:'Ưu tiên',fieldId:'customerClass',values:['Premium'],color:'#2563eb'}];
 await f.api.write(admin,'care-create',[{key:'careGroups',id:'$',base:null,value:groups}]);
 const result=await f.api.read(admin);assert.deepEqual(result.state.careGroups,groups);
 await assert.rejects(()=>f.api.write({id:'sale',role:'SALE',teamId:'T'},'care-denied',[{key:'careGroups',id:'$',base:result.versions['careGroups/$'],value:[]}]),/./);
 assert.deepEqual((await f.api.read(admin)).state.careGroups,groups);
});
test('Main shell loads functional CRM and shared care module, without a static business app',()=>{
 const html=fs.readFileSync('index.html','utf8')+fs.readFileSync('crm-runtime.html','utf8');
 for(const token of ['reference-view.js?v=','reference-crm.js?v=','crm-runtime-api.js?v=','crm.js?v=','id="loginForm"']) assert.ok(html.includes(token),token);
 assert.doesNotMatch(html,/INITIAL_CUSTOMERS|let appState|function saveState/);
});

test('Đăng nhập thành công mở lại nút để có thể đăng nhập tài khoản khác',async()=>{
 const c=frontend();await c.initialize();
 c.fetch=async()=>({ok:true,status:200,json:async()=>({token:'session',user:{id:'admin',role:'ADMIN',name:'Admin'}})});
 vm.runInContext(`startSession=async user=>{currentAccount=user;};document.querySelector('#loginPhone').value='0900000001';document.querySelector('#loginPassword').value='password';document.querySelector('#loginForm button[type="submit"]').innerHTML='Đăng nhập';`,c);
 await vm.runInContext("document.querySelector('#loginForm').onsubmit({preventDefault(){}})",c);
 assert.equal(vm.runInContext("document.querySelector('#loginForm button[type=\"submit\"]').disabled",c),false);
});

test('Reference layout retains active IDs and stylesheet, excluding removed customer count',()=>{
 const h=fs.readFileSync('index.html','utf8'),layout=JSON.parse(fs.readFileSync('reference-layout.json','utf8'));
 const css=[...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 assert.equal(require('node:crypto').createHash('sha256').update(css).digest('hex'),layout.styleHash);
 // Customer count badge removed at user request; remaining IDs stay compatible.
 for(const id of layout.ids.filter(id=>id!=='custCountText'))assert.ok(h.includes(`id="${id}"`),id);
 assert.ok(!h.includes('id="custCountText"'));
 assert.doesNotMatch(h,/<link[^>]+href=".*crm(?:-modern)?\.css/);
});
test('Distribution rounds stay visible when the current round has no enabled recipients',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8');
 const start=source.indexOf('    const globalCycle=()=>{'),end=source.indexOf("    const block=(title,sub,html,cycle='')",start);
 assert.ok(start>=0&&end>start,'global cycle renderer exists');
 const renderer=source.slice(start,end);
 assert.doesNotMatch(renderer,/if\s*\(!people\.length\)\s*return\s*''/);
 assert.match(renderer,/data.distributionRoundViews/);
 const rounds=require('./distribution-rounds.js');
 const config={rounds:[{id:'one',enabledSaleIds:[],weights:{}},{id:'two',enabledSaleIds:['a'],weights:{a:2}}]};
 const views=rounds.preview(config,null,[{id:'a'}],'BALANCED');
 assert.equal(views.length,2);assert.deepEqual(views[0].ids,[]);assert.deepEqual(views[1].ids,['a','a']);
 assert.match(renderer,/views.map/);

});
test('Reference care save retries the same group and denies a different operation while pending',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();let attempts=0;flushServerPersistence=async()=>++attempts!==2;`,c);
 const input={name:'Ưu tiên',fieldId:'customerClass',values:['Premium']};
 await assert.rejects(()=>c.window.crmApi.createCare(input),/Chưa lưu/);
 assert.equal(vm.runInContext('state.careGroups.length',c),1);
 await assert.rejects(()=>c.window.crmApi.settings({customAccent:'#2563eb'}),/thao tác trước/);
 const result=await c.window.crmApi.createCare(input);assert.ok(result.id);
 assert.equal(vm.runInContext('state.careGroups.length',c),1);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE'}`,c);
 await assert.rejects(()=>c.window.crmApi.createCare(input),/không có quyền/);
});
test('Reference customer form rejects an invalid assignee before mutating customer state',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();state.websites=[{id:'website',name:'Landing',domain:'example.test'}];flushServerPersistence=async()=>true;`,c);
 c.fetch=async()=>({ok:false,status:403,json:async()=>({error:'Người phụ trách không nằm trong phạm vi tài khoản.'})});
 await assert.rejects(()=>c.window.crmApi.createCustomer({name:'Customer',phone:'0900000999',websiteId:'website',saleId:'missing'}),/phạm vi/);
 assert.equal(vm.runInContext('state.customers.length',c),0);
});
test('Manager thêm khách cũ không cần landing vẫn tạo bản ghi chờ lưu bền vững',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'manager',name:'Manager',role:'LEADER',actualRole:'MANAGER',scope:'TEAM'};serverStateLoaded=true;serverSyncToken='token';state=initialState();state.websites=[];state.members=[{id:'manager',name:'Manager',role:'MANAGER',active:true,teamId:''}];STAFF=state.members;flushServerPersistence=async()=>true;`,c);
 let sent;c.fetch=async (_url,options)=>{sent=JSON.parse(options.body);const payload=vm.runInContext('structuredClone({state,versions:{}})',c);payload.customerId='manual-server';payload.state.customers=[{id:'manual-server',name:'Khách cũ',phone:'0865976582',email:'old@example.vn',source:'Khách hàng cũ',websiteId:null,manualEntry:true,managerId:'manager',customFields:{customerClass:'Nóng',customerLevel:'L4.1: Hẹn nạp vốn'}}];return {ok:true,status:200,json:async()=>payload};};
 const result=await c.window.crmApi.createCustomer({name:'Khách cũ',phone:'0865976582',email:'old@example.vn',source:'Khách hàng cũ',websiteId:'SOURCE:OLD_CUSTOMER',saleId:'',customFields:{customerClass:'Nóng',customerLevel:'L4.1: Hẹn nạp vốn'}});
 const saved=vm.runInContext('state.customers[0]',c);
 assert.ok(result.id);assert.equal(sent.websiteId,'SOURCE:OLD_CUSTOMER');assert.equal(sent.source,'Khách hàng cũ');assert.equal(saved.source,'Khách hàng cũ');assert.equal(saved.websiteId,null);assert.equal(saved.email,'old@example.vn');assert.equal(saved.manualEntry,true);assert.equal(saved.managerId,'manager');
});

test('Reference product validates before editing, preserves order history and denies Sale',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();flushServerPersistence=async()=>true;state.orders=[{id:'old',productName:'Old',total:100}];`,c);
 const input={name:'Product',sku:'QA',category:'Tools',price:1000,type:'SALE',active:true};
 const result=await c.window.crmApi.saveProduct(null,input);
 await assert.rejects(()=>c.window.crmApi.saveProduct(null,{...input,sku:'qa'}),/SKU/);
 await assert.rejects(()=>c.window.crmApi.saveProduct(result.id,{...input,type:'RENTAL',rentalMonths:2}),/gói/);
 assert.equal(vm.runInContext('state.products[0].type',c),'SALE');
 await c.window.crmApi.saveProduct(result.id,{...input,type:'RENTAL',rentalMonths:3,price:2000,active:false});
 assert.equal(vm.runInContext('state.products.length',c),1);
 assert.equal(vm.runInContext('state.products[0].rentalMonths',c),3);
 assert.equal(vm.runInContext('state.orders[0].total',c),100);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE'}`,c);
 await assert.rejects(()=>c.window.crmApi.saveProduct(null,input),/không có quyền/);
});
test('Reference product retry returns original ID without duplicate products',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();let attempts=0;flushServerPersistence=async()=>++attempts!==2;`,c);
 const input={name:'Retry',sku:'RETRY',category:'Tools',price:1000,type:'RENTAL',rentalMonths:1};
 await assert.rejects(()=>c.window.crmApi.saveProduct(null,input),/Chưa lưu/);
 const id=vm.runInContext('state.products[0].id',c);
 assert.equal((await c.window.crmApi.saveProduct(null,input)).id,id);
 assert.equal(vm.runInContext('state.products.length',c),1);
});

function referenceBridge(){const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);vm.runInContext(`currentAccount={id:'admin',name:'Admin',role:'ADMIN',scope:'ALL'};serverStateLoaded=true;state=initialState();state.websites=[];flushServerPersistence=async()=>true;`,c);return c;}
test('Reference care reorder persists for Admin and denies non-admin',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();state.careGroups=[{id:'a',name:'A',fieldId:'customerClass',values:['Premium']},{id:'b',name:'B',fieldId:'customerClass',values:['Whale']}];flushServerPersistence=async()=>true;`,c);
 await c.window.crmApi.reorderCare(['b','a']);
 assert.deepEqual(vm.runInContext('state.careGroups.map(group=>group.id)',c),['b','a']);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE'}`,c);
 await assert.rejects(()=>c.window.crmApi.reorderCare(['a','b']),/không có quyền/);
});
test('Required customerLevel field is present and saves through the runtime path',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext("state.customers=[{id:'level-customer',name:'Customer',phone:'0900000013',customFields:{},status:'NEW'}]",c);
 const field=vm.runInContext("state.customFieldDefinitions.find(item=>item.id==='customerLevel')",c);
 assert.ok(field);assert.equal(field.type,'SELECT');assert.ok(field.options.some(option=>option.value==='L5'));
 const result=await api.updateField('level-customer','customerLevel','L5');
 assert.equal(result.updated,true);assert.equal(vm.runInContext("state.customers[0].customFields.customerLevel",c),'L5');
 const legacy=await api.updateField('level-customer','customerLevel','L4.1: Hẹn nạp vốn');
 assert.equal(legacy.updated,true);assert.equal(vm.runInContext("state.customers[0].customFields.customerLevel",c),'L4.1');
 assert.ok(vm.runInContext("state.customerFieldHistory.some(item=>item.customerId==='level-customer'&&item.fieldId==='customerLevel'&&item.to==='L5')",c));
});
test('Reference fields preserve option keys, record edits, protect Level and care references',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.customers=[{id:'c',name:'Customer',phone:'0900000011',customFields:{},status:'NEW'}]`,c);
 const field=await api.saveField(null,{label:'QA select',type:'SELECT',options:[{label:'Alpha',value:'A',color:'#123456'}]});
 await api.updateField('c',field.id,'A');
 assert.equal(vm.runInContext(`state.customers[0].customFields[${JSON.stringify(field.id)}]`,c),'A');
 const history=vm.runInContext('state.customerFieldHistory.length',c);assert.ok(history>0);
 await api.saveField(field.id,{label:'Renamed',type:'SELECT',options:[{label:'New label',value:'A',color:'#abcdef'}]});
 assert.equal(vm.runInContext(`state.customers[0].customFields[${JSON.stringify(field.id)}]`,c),'A');
 await assert.rejects(()=>api.updateField('c',field.id,'unknown'),/không hợp lệ/);
 const care=await api.saveCare(null,{name:'QA Care',fieldId:field.id,values:['A'],color:'#123456'});
 await assert.rejects(()=>api.removeField(field.id),/đang dùng/);
 await assert.rejects(()=>api.removeField('customerLevel'),/Level/);
 await api.removeCare(care.id);await api.removeField(field.id);
 assert.equal(vm.runInContext('state.customers.length',c),1);
 assert.equal(vm.runInContext('state.customerFieldHistory.length',c),history);
});
test('Customer NOTE fields save the current value and change history through the SQL persistence path',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.customers=[{id:'note-customer',name:'Customer',phone:'0900000012',customFields:{},status:'NEW'}];let noteFlushes=0;flushServerPersistence=async()=>{noteFlushes++;return true;};`,c);
 const field=await api.saveField(null,{label:'Ghi chú',type:'NOTE',options:[]});
 const result=await api.updateField('note-customer',field.id,'Khách cần gọi lại\nSau 14:00');
 assert.equal(result.updated,true);
 assert.equal(vm.runInContext(`state.customers[0].customFields[${JSON.stringify(field.id)}]`,c),'Khách cần gọi lại\nSau 14:00');
 assert.equal(vm.runInContext(`state.customerFieldHistory.some(item=>item.customerId==='note-customer'&&item.fieldId===${JSON.stringify(field.id)}&&item.to==='Khách cần gọi lại\\nSau 14:00')`,c),true);
 assert.ok(vm.runInContext('noteFlushes',c)>=2);
 const runtime=fs.readFileSync('crm.js','utf8'),store=fs.readFileSync('crm-data.cjs','utf8');
 assert.match(runtime,/SERVER_LISTS = \[[^\]]*'customers'[^\]]*'customerFieldHistory'/s);
 assert.match(store,/LISTS = \[[^\]]*'customers'[^\]]*'customerFieldHistory'/s);
});
test('Reference website CRUD keeps webhook identity and rejects deletion of a customer source',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 const input={name:'QA site',sourceUrl:'https://example.test/landing',provider:'LANDING_API'};
 const w=await api.saveWebsite(null,input),slug=vm.runInContext('state.websites[0].webhookSlug',c);
 assert.ok(slug);assert.equal(vm.runInContext('state.websites[0].connectionStatus',c),'UNCONFIGURED');
 await assert.rejects(()=>api.saveWebsite(null,input),/tồn tại/);
 await api.saveWebsite(w.id,{...input,name:'Changed',sourceUrl:'https://example.test/updated'});
 assert.equal(vm.runInContext('state.websites[0].webhookSlug',c),slug);
 vm.runInContext(`state.customers=[{id:'c',websiteId:${JSON.stringify(w.id)}}]`,c);
 await assert.rejects(()=>api.removeWebsite(w.id),/đã có dữ liệu/);
 assert.equal(vm.runInContext('state.customers.length',c),1);
 vm.runInContext('state.customers=[]',c);await api.removeWebsite(w.id);
 assert.equal(vm.runInContext('state.websites.length',c),0);
});
test('Reference configuration mutations deny Sale and website retry does not duplicate',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`let attempts=0;flushServerPersistence=async()=>++attempts!==2`,c);
 const input={name:'Retry',sourceUrl:'https://retry.test/',provider:'CUSTOM_WEBHOOK'};
 await assert.rejects(()=>api.saveWebsite(null,input),/Chưa lưu/);
 const result=await api.saveWebsite(null,input);assert.ok(result.id);assert.equal(vm.runInContext('state.websites.length',c),1);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE'}`,c);
 for(const fn of [()=>api.saveWebsite(null,input),()=>api.removeWebsite(result.id),()=>api.saveField(null,{}),()=>api.removeField('x'),()=>api.saveCare(null,{}),()=>api.removeCare('x')])await assert.rejects(fn,/không có quyền/);
});

test('Reference source resolution retains invalid intake and removes valid intake only after creating customer',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 const w=await api.saveWebsite(null,{name:'Landing',sourceUrl:'https://landing.test/',provider:'LANDING_API'});
 vm.runInContext(`webhookPending=[{id:'pending',customer:{name:'Pending customer',phone:''}}];state.webhookPending=webhookPending;`,c);
 await assert.rejects(()=>api.resolveSource('pending',w.id),/./);
 assert.equal(vm.runInContext('webhookPending.length',c),1);
 vm.runInContext(`webhookPending[0].customer.phone='0900000011'`,c);
 const result=await api.resolveSource('pending',w.id);assert.ok(result.id);
 assert.equal(vm.runInContext('webhookPending.length',c),0);
 assert.equal(vm.runInContext('state.customers.length',c),1);
 assert.equal(vm.runInContext('state.customers[0].websiteId',c),w.id);
});

test('Reference member form reuses team rules and protects privileged accounts',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'admin',name:'Admin',role:'ADMIN',active:true},{id:'leader',name:'Leader',role:'LEADER',teamId:'T1',active:true}];STAFF=state.members;render=()=>{};`,c);
 await assert.rejects(()=>api.saveMember('admin',{name:'Admin',role:'SALE',teamId:'T1',leaderId:'leader'}),/quyền/);
 await assert.rejects(()=>api.saveMember(null,{name:'New',role:'SALE',teamId:'T2',leaderId:'leader'}),/đúng Team/);
 const saved=await api.saveMember(null,{name:'New',email:'new@example.test',phone:'0901234567',role:'SALE',teamId:'T1',leaderId:'leader'});assert.ok(saved.id);
 assert.equal(vm.runInContext(`state.members.find(m=>m.id===${JSON.stringify(saved.id)}).leaderId`,c),'leader');
 await assert.rejects(()=>api.removeMember('leader'),/Sale trực thuộc/);
 await assert.rejects(()=>api.removeMember('admin'),/quản trị/);
 await api.removeMember(saved.id);assert.equal(vm.runInContext(`state.members.find(m=>m.id===${JSON.stringify(saved.id)}).active`,c),false);
});
test('Reference approval preserves account ID and notifications persist read state',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'leader',name:'Leader',role:'LEADER',teamId:'T1',active:true}];state.registeredAccounts=[{id:'pending',name:'Pending',role:'UNASSIGNED',phone:'0901234567'}];`,c);
 await api.saveMember('pending',{name:'Pending',phone:'0901234567',role:'SALE',teamId:'T1',leaderId:'leader'});
 assert.equal(vm.runInContext('state.registeredAccounts.length',c),0);assert.equal(vm.runInContext('state.members[1].id',c),'pending');
 const n=await api.announce({title:'Thông báo QA',text:'Nội dung QA'});await api.readNotice(n.id);
 assert.equal(vm.runInContext(`state.notifications.find(n=>n.id===${JSON.stringify(n.id)}).readBy[0]`,c),'admin');
 vm.runInContext(`currentAccount={id:'sale',role:'SALE'}`,c);
 await assert.rejects(()=>api.announce({title:'x',text:'x'}),/không có quyền/);
 await assert.rejects(()=>api.saveMember(null,{}),/không có quyền/);
 await assert.rejects(()=>api.resetPassword('pending','password','password'),/không có quyền/);
});
test('Reference webhook configuration rejects duplicate slug and unsafe override',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 const first=await api.saveWebsite(null,{name:'One',sourceUrl:'https://one.test/',provider:'LANDING_API'}),second=await api.saveWebsite(null,{name:'Two',sourceUrl:'https://two.test/',provider:'LANDING_API'});
 const slug=vm.runInContext(`state.websites.find(w=>w.id===${JSON.stringify(first.id)}).webhookSlug`,c);
 await assert.rejects(()=>api.saveWebhook(second.id,{slug,override:'',base:''}),/thuộc website/);
 await assert.rejects(()=>api.saveWebhook(first.id,{slug,override:'http://unsafe.test/',base:''}),/HTTPS/);
 await api.saveWebhook(first.id,{slug,override:'https://hooks.test/endpoint',base:'https://crm.test'});
 assert.equal(vm.runInContext(`state.websites.find(w=>w.id===${JSON.stringify(first.id)}).webhookUrlOverride`,c),'https://hooks.test/endpoint/');
});

test('Reference password form validates confirmation and uses authenticated password API',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'member',role:'SALE',loginEnabled:true}];let passwordTarget='';saveAccountPassword=async body=>{passwordTarget=body.userId;return true;};`,c);
 await assert.rejects(()=>api.resetPassword('member','short','short'),/8 ký tự/);
 await assert.rejects(()=>api.resetPassword('member','Example2026!','Different2026!'),/xác nhận/);
 await assert.rejects(()=>api.resetPassword('missing','Example2026!','Example2026!'),/chưa có tài khoản/);
 await api.resetPassword('member','Example2026!','Example2026!');assert.equal(vm.runInContext('passwordTarget',c),'member');
 assert.equal(vm.runInContext('state.members[0].password',c),undefined);
});

test('Reference font catalog exactly matches all 51 legacy font keys',()=>{
 const source=fs.readFileSync('crm.js','utf8'),bridge=fs.readFileSync('crm-runtime-api.js','utf8');
 const legacy=vm.runInNewContext(source.match(/const settingsFontOptions = (\[.*?\]);/)[1]);
 const restored=JSON.parse(bridge.match(/const referenceFonts=(\[.*?\]);/)[1]);
 assert.equal(restored.length,51);assert.deepEqual(restored,JSON.parse(JSON.stringify(legacy)));
});
test('Reference workflows reject unknown actions, unaccepted Sale customer details and Admin configuration access',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 await assert.rejects(()=>api.openWorkflow('eval'),/không hợp lệ/);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE',saleId:'sale',scope:'OWN',teamId:'T',leaderId:'leader'};state.customers=[{id:'pending',saleId:'sale',teamId:'T',leaderId:'leader',saleAcceptedAt:null}];`,c);
 await assert.rejects(()=>api.openWorkflow('customer','pending'),/nhận data/);
 for(const kind of ['import','categories','fields','settings','createTeam','distribution','emailTest'])await assert.rejects(()=>api.openWorkflow(kind),/Admin/);
});
test('Reference workflow retries a closed form save without invoking the action twice',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`let workflowCalls=0,workflowRootAvailable=true,workflowFlush=0;const originalWorkflowQuery=document.querySelector;const fakeWorkflowNode={dataset:{},onclick:()=>{workflowCalls++;workflowRootAvailable=false;}};const fakeWorkflowRoot={contains:n=>n===fakeWorkflowNode};document.querySelector=selector=>selector==='#modalRoot .modal-body'?(workflowRootAvailable?fakeWorkflowRoot:null):selector==='#drawerRoot .drawer-body'?null:originalWorkflowQuery(selector);newCustomerModal=()=>{};hasServerChanges=()=>true;flushServerPersistence=async()=>++workflowFlush>1;`,c);
 await api.openWorkflow('newCustomer');
 await assert.rejects(()=>api.workflowEvent(vm.runInContext('fakeWorkflowNode',c),'click'),/chưa xác nhận/);
 await api.workflowEvent(vm.runInContext('fakeWorkflowNode',c),'click');
 assert.equal(vm.runInContext('workflowCalls',c),1);
});

// Manager: quyền được suy ra từ Leader.managerId trên server ở mỗi giao dịch.
async function managerFixture(){
 const f=fixture();
 const members=[{id:'mgr',name:'Manager',role:'MANAGER',active:true},{id:'mgr2',name:'Manager 2',role:'MANAGER',active:true},{id:'lead',name:'Leader A',role:'LEADER',teamId:'T',managerId:'mgr',active:true},{id:'lead2',name:'Leader B',role:'LEADER',teamId:'B',managerId:'mgr',active:true},{id:'outside',name:'Leader khác',role:'LEADER',teamId:'T',managerId:'mgr2',active:true},{id:'sale',name:'Sale A',role:'SALE',teamId:'T',leaderId:'lead',active:true},{id:'sale2',name:'Sale B',role:'SALE',teamId:'B',leaderId:'lead2',active:true},{id:'s-out',name:'Sale khác',role:'SALE',teamId:'T',leaderId:'outside',active:true}];
 await f.api.write(admin,'manager-seed',[
  ...members.map(m=>change('members',m)),change('customers',customer),change('customers',{...customer,id:'c2',leaderId:'lead2',teamId:'B',saleId:'sale2'}),change('customers',{...customer,id:'c-out',leaderId:'outside',saleId:'s-out'}),
  {key:'saleDistributionByLeader',id:'$',base:null,value:{lead:{weights:{sale:1}},lead2:{weights:{sale2:1}},outside:{weights:{'s-out':1}}}}
 ]);return f;
}
test('Manager chỉ đọc hai Leader được Admin giao, không đọc đội khác dù cùng mã Team',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER',teamId:'T',leaderId:'outside'};
 const r=await f.api.read(m);assert.deepEqual([...r.state.customers.map(x=>x.id)].sort(),['c1','c2']);assert.deepEqual([...r.state.members.map(x=>x.id)].sort(),['lead','lead2','mgr','sale','sale2']);assert.deepEqual(Object.keys(r.state.saleDistributionByLeader).sort(),['lead','lead2']);
 const empty=await f.api.read({id:'not-assigned',role:'MANAGER'});assert.equal(empty.state.customers.length,0);assert.equal(empty.state.members.length,0);
});
test('Manager ghi khách được giao nhưng không thể sửa khách ngoài hệ thống, tự cấp quyền hoặc xác nhận tiền',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'},a=await f.api.read(admin),r=await f.api.read(m);
 await f.api.write(m,'manager-edit',[change('customers',{...r.state.customers.find(c=>c.id==='c1'),note:'Manager chăm sóc'},r.versions['customers/c1'])]);
 await assert.rejects(f.api.write(m,'manager-out',[change('customers',{...a.state.customers.find(c=>c.id==='c-out'),note:'Không được'},a.versions['customers/c-out'])]),e=>e.status===403);
 const lead=a.state.members.find(x=>x.id==='outside');await assert.rejects(f.api.write(m,'manager-grant',[change('members',{...lead,managerId:'mgr'},a.versions['members/outside'])]),e=>e.status===403);
 await assert.rejects(f.api.write(m,'manager-paid',[change('orders',{...order,status:'PAID'})]),e=>e.status===403);
});
test('Manager phân lại được sang Leader và Sale ở mọi Team thuộc tuyến của mình',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'},r=await f.api.read(m);
 const source=r.state.customers.find(c=>c.id==='c1');
 const toLeader={...source,saleId:null,leaderId:'lead2',teamId:'B',updatedAt:'2026-09-21 19:00',note:'Manager phân lại cho Leader B'};
 await f.api.write(m,'manager-reassign-leader',[change('customers',toLeader,r.versions['customers/c1'])]);
 const afterLeader=await f.api.read(m);assert.equal(afterLeader.state.customers.find(c=>c.id==='c1').leaderId,'lead2');
 const saleSource=afterLeader.state.customers.find(c=>c.id==='c1');
 const offer={id:'offer-manager-reassign',customerId:'c1',saleId:'sale2',leaderId:'lead2',teamId:'B',offeredAt:'2026-09-21 19:01',status:'PENDING',resolvedAt:'',source:'MANUAL'};
 await f.api.write(m,'manager-reassign-sale',[change('customers',{...saleSource,saleId:null,leaderId:'lead2',teamId:'B',managerId:'mgr',updatedAt:'2026-09-21 19:01'},afterLeader.versions['customers/c1']),change('dataOffers',offer)]);
 const afterSale=await f.api.read(m);assert.equal(afterSale.state.dataOffers.find(o=>o.id===offer.id).saleId,'sale2');
});
test('Manager cài tỷ trọng đúng Leader, từ chối khóa ngoài phạm vi và giữ nguyên cấu hình đội khác',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'},r=await f.api.read(m);
 await f.api.write(m,'manager-weight',[{key:'saleDistributionByLeader',id:'$',base:r.versions['saleDistributionByLeader/$'],value:{...r.state.saleDistributionByLeader,lead:{weights:{sale:2}}}}]);
 const a=await f.api.read(admin);assert.equal(a.state.saleDistributionByLeader.outside.weights['s-out'],1);assert.equal(a.state.saleDistributionByLeader.lead.weights.sale,2);
 const now=await f.api.read(m);await assert.rejects(f.api.write(m,'manager-other-weight',[{key:'saleDistributionByLeader',id:'$',base:now.versions['saleDistributionByLeader/$'],value:{...now.state.saleDistributionByLeader,outside:{weights:{'s-out':9}}}}]),e=>e.status===403);
});
test('Bỏ phân công Manager thu hồi quyền ngay ở lần đọc/ghi tiếp theo, kể cả đang giữ phiên cũ',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'},r=await f.api.read(m),a=await f.api.read(admin);
 await f.api.write(admin,'manager-revoke',[change('members',{...a.state.members.find(x=>x.id==='lead'),managerId:null},a.versions['members/lead'])]);
 assert.equal((await f.api.read(m)).state.customers.some(c=>c.id==='c1'),false);
 await assert.rejects(f.api.write(m,'manager-stale-write',[change('customers',{...r.state.customers.find(c=>c.id==='c1'),note:'Phiên cũ'},r.versions['customers/c1'])]),e=>e.status===403);
});
test('Admin không thể gán Leader vào tài khoản không phải Manager',async()=>{
 const f=await managerFixture(),a=await f.api.read(admin);
 await assert.rejects(f.api.write(admin,'bad-manager',[change('members',{...a.state.members.find(x=>x.id==='lead'),managerId:'sale'},a.versions['members/lead'])]),e=>e.status===400);
});
test('Manager runtime dùng giao diện Leader và chỉ chọn được Team đã giao',async()=>{
 const c=referenceBridge();vm.runInContext(`state.members=[{id:'m',name:'Manager',role:'MANAGER',active:true},{id:'l',name:'Leader',role:'LEADER',teamId:'T',managerId:'m',active:true}];currentAccount=hydrateSessionAccount({id:'m',name:'Manager',role:'MANAGER'});`,c);
 assert.equal(vm.runInContext('currentAccount.actualRole',c),'MANAGER');assert.equal(vm.runInContext('currentAccount.role',c),'LEADER');assert.equal(vm.runInContext('currentAccount.leaderId',c),'l');
 await assert.rejects(c.window.crmApi.selectManagerTeam('outside'),/chưa được/);
 vm.runInContext(`state.members[1].managerId=null;currentAccount=hydrateSessionAccount(currentAccount)`,c);assert.equal(vm.runInContext('currentAccount.leaderId',c),null);
});

test('Manager runtime phÃ¢n cho chÃ­nh mÃ¬nh khi phiÃªn hydrate thiáº¿u actualRole',async()=>{
 const c=frontend();
 vm.runInContext(`state.members=[{id:'m',accountId:'MANAGER-DEMO',name:'Manager',role:'MANAGER',active:true},{id:'l2',name:'Leader 2',role:'LEADER',managerId:'m',teamId:'B',active:true}];state.customers=[{id:'c',name:'KhÃ¡ch',phone:'0900000000',managerId:'m',leaderId:'l2',teamId:'B',saleId:null,createdAt:'2026-09-21 10:00',updatedAt:'2026-09-21 10:00'}];STAFF=state.members;currentAccount={id:'m',accountId:'MANAGER-DEMO',role:'LEADER',leaderId:'l2',teamId:'B'};serverStateLoaded=true;renderPreservingCustomerScroll=()=>{};flushServerPersistence=async()=>true;`,c);
 assert.equal(await c.quickAssignSale('c','m'),true);
 assert.equal(vm.runInContext('effectivePermissionRole()',c),'MANAGER');
 assert.equal(vm.runInContext("state.customers[0].managerId",c),'m');
});

 test('Manager giữ đúng ID bản thân cho hồ sơ và điểm danh khi chọn một Leader',()=>{
 const c=referenceBridge();vm.runInContext(`state.members=[{id:'m',name:'Manager',initials:'M',role:'MANAGER',active:true},{id:'l',name:'Leader khác',role:'LEADER',teamId:'T',managerId:'m',active:true}];currentAccount=hydrateSessionAccount({id:'m',name:'Manager',role:'MANAGER'});`,c);
 vm.runInContext('STAFF=state.members',c);assert.equal(vm.runInContext('attendanceAccountId()',c),'m');const html=vm.runInContext('profileView()',c);assert.ok(html.includes('value="Manager"'));assert.ok(!html.includes('value="Leader khác"'));
 });

test('Manager không chuyển ghi chú đội khác vào khách của mình để vượt quyền',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'};
 await f.api.write(admin,'outside-note',[change('notes',{id:'n-out',customerId:'c-out',text:'Ngoài phạm vi'})]);const a=await f.api.read(admin);
 await assert.rejects(f.api.write(m,'steal-note',[change('notes',{id:'n-out',customerId:'c1',text:'Chuyển về đội mình'},a.versions['notes/n-out'])]),e=>e.status===403);
});

test('Manager UI hiá»ƒn Ä‘á»§ ngÆ°á»i nháº­n trong toÃ n tuyáº¿n vÃ  cho phÃ©p cáº­p nháº­t data',async()=>{
 const c=frontend();
 vm.runInContext(`state.members=[
  {id:'m',accountId:'MANAGER-DEMO',name:'Manager',role:'MANAGER',active:true},
  {id:'l1',name:'Leader 1',role:'LEADER',managerId:'m',teamId:'A',active:true},
  {id:'l2',name:'Leader 2',role:'LEADER',managerId:'m',teamId:'B',active:true},
  {id:'s1',name:'Sale 1',role:'SALE',leaderId:'l1',managerId:'m',teamId:'A',active:true},
  {id:'s2',name:'Sale 2',role:'SALE',leaderId:'l2',managerId:'m',teamId:'B',active:true},
  {id:'out',name:'Ngoai tuyen',role:'SALE',leaderId:'lo',managerId:'other',teamId:'X',active:true}
 ];STAFF=state.members;state.customers=[{id:'c-ui',name:'Khach UI',phone:'0900000000',managerId:'m',leaderId:'l2',teamId:'B',saleId:null,status:'NEW',createdAt:'2026-09-21 10:00',updatedAt:'2026-09-21 10:00',note:'',customFields:{}}];currentAccount={id:'m',accountId:'MANAGER-DEMO',role:'LEADER',leaderId:'l2',teamId:'B'};`,c);
 const html=vm.runInContext('quickSaleControl(state.customers[0])',c);
 assert.match(html,/value="m"/);assert.match(html,/value="l1"/);assert.match(html,/value="s2"/);assert.doesNotMatch(html,/value="out"/);
 assert.equal(vm.runInContext('canUpdateCustomer(state.customers[0])',c),true);
});

// Hang cho Sale phai dung cung tap du lieu cho badge va danh sach.
test('Sale queue excludes expired, missing and foreign offers; keeps yesterday within 24h',()=>{
 const c=frontend();
 vm.runInContext(`
 currentAccount={id:'sale',saleId:'sale',role:'SALE'};
 state.customers=[{id:'c1'},{id:'c2'},{id:'c3'}];
 const at=hours=>new Date(Date.now()-hours*3600000).toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);
 state.dataOffers=[
 {id:'of1',customerId:'c1',saleId:'sale',status:'PENDING',offeredAt:at(20)},
 {id:'of2',customerId:'c2',saleId:'sale',status:'PENDING',offeredAt:at(1)},
 {id:'old',customerId:'c3',saleId:'sale',status:'PENDING',offeredAt:at(25)},
 {id:'missing',customerId:'deleted',saleId:'sale',status:'PENDING',offeredAt:at(1)},
 {id:'other',customerId:'c3',saleId:'other',status:'PENDING',offeredAt:at(1)}];
 `,c);
 assert.deepEqual(Array.from(vm.runInContext('pendingOffersForMe().map(o=>o.id)',c)),['of1','of2']);
 assert.equal(vm.runInContext('pendingOfferCount()',c),2);
 assert.equal(vm.runInContext("acceptDataOffer('old')",c),false);
 assert.equal(vm.runInContext("state.dataOffers.find(o=>o.id==='old').status",c),'PENDING');
});

 test('Sale assigned statistics stay unchanged after acceptance and count only own unique customers in each period',()=>{
 const c=frontend();
 vm.runInContext(`
 currentAccount={id:'sale',saleId:'sale',role:'SALE'};
 const offer=(id,customerId,days,status='PENDING',saleId='sale')=>({id,customerId,saleId,status,offeredAt:dayIso(days)+' 09:00:00'});
 state.dataOffers=[offer('a','c1',0),offer('b','c2',0),offer('repeat','c1',0),
 offer('older','c3',2,'ACCEPTED'),offer('expired','c4',6,'EXPIRED'),
 offer('outside','c5',7),offer('future','c6',-1),offer('foreign','c7',0,'PENDING','other')];
 `,c);
 const stats=()=>JSON.parse(vm.runInContext('JSON.stringify(assignedDataStatsForMe())',c));
 assert.deepEqual(stats(),{today:2,threeDays:3,sevenDays:4});
 vm.runInContext("state.dataOffers[0].status='ACCEPTED';state.dataOffers[0].resolvedAt=stamp();",c);
 assert.deepEqual(stats(),{today:2,threeDays:3,sevenDays:4});
 vm.runInContext("state.dataOffers[1].status='EXPIRED';",c);
 assert.deepEqual(stats(),{today:2,threeDays:3,sevenDays:4});
 });

test('Manager direct sales weights persist, disabled sales stay disabled, and other managers are denied',async()=>{
 const f=await managerFixture(),m={id:'mgr',role:'MANAGER'};
 await f.api.write(admin,'direct-sale-seed',[change('members',{id:'direct',name:'Direct',role:'SALE',managerId:'mgr',leaderId:'mgr',teamId:'D',active:true})]);
 const c=referenceBridge(),r=await f.api.read(m);
 vm.runInContext(`applyServerSnapshot(${JSON.stringify(r)});currentAccount=hydrateSessionAccount({id:'mgr',name:'Manager',role:'MANAGER'});`,c);
 c.fetch=async(url,options)=>{try{return {ok:true,json:async()=>await f.api.write(m,JSON.parse(options.body).requestId,JSON.parse(options.body).changes)}}catch(e){return {ok:false,status:e.status,json:async()=>({error:e.message})}}};
 // Use the real persistence function, not the bridge stub.
 const source=fs.readFileSync('crm.js','utf8');vm.runInContext(source.slice(source.indexOf('async function flushServerPersistence('),source.indexOf('function startServerSyncPolling()')),c);
 vm.runInContext("serverSyncToken='test-token'",c);
 await c.window.crmApi.distributionWeight('SALE','direct',3);
 await c.window.crmApi.distributionMember('SALE','direct',false);
 await c.window.crmApi.distributionWeight('SALE','direct',4);
 let saved=await f.api.read(m);assert.equal(saved.state.saleDistributionByLeader['manager:mgr'].weights.direct,4);assert.deepEqual(Array.from(saved.state.saleDistributionByLeader['manager:mgr'].enabledSaleIds),[]);
 await c.window.crmApi.distributionMember('SALE','direct',true);
 saved=await f.api.read(m);assert.ok(saved.state.saleDistributionByLeader['manager:mgr'].enabledSaleIds.includes('direct'));
 await assert.rejects(c.window.crmApi.distributionWeight('SALE','s-out',9));
 await assert.rejects(f.api.write(m,'foreign-manager-config',[{key:'saleDistributionByLeader',id:'$',base:saved.versions['saleDistributionByLeader/$'],value:{...saved.state.saleDistributionByLeader,'manager:mgr2':{weights:{other:10}}}}]),e=>e.status===403);
});
for(const mode of ['BALANCED','ROUND_ROBIN'])test('Direct manager sales receive weighted pending offers without a Leader: '+mode,async()=>{
 const f=fixture();
 await f.api.write(admin,'direct-auto-seed',[
 ...[{id:'m',name:'Manager',role:'MANAGER',active:true},{id:'a',name:'A',role:'SALE',managerId:'m',leaderId:'m',teamId:'D',active:true},{id:'b',name:'B',role:'SALE',managerId:'m',leaderId:null,teamId:'D',active:true},{id:'off',name:'Off',role:'SALE',managerId:'m',leaderId:'m',teamId:'D',active:true}].map(m=>change('members',m)),
 {key:'settings',id:'$',base:null,value:{assignmentMode:mode}},
 {key:'leaderDistribution',id:'$',base:null,value:{enabled:true,enabledLeaderIds:[],weights:{}}},
 {key:'saleDistributionByLeader',id:'$',base:null,value:{'manager:m':{enabledSaleIds:['a','b'],weights:{a:2,b:1}}}},
 ...Array.from({length:12},(_,i)=>change('customers',{...customer,id:'direct-'+i,saleId:null,leaderId:null,teamId:null}))]);
 const r=await f.api.read(admin);
 const offerCounts=Object.fromEntries(['a','b','off'].map(id=>[id,r.state.dataOffers.filter(o=>o.saleId===id).length]));
 const managerDirectCount=r.state.customers.filter(row=>row.managerId==='m'&&!r.state.dataOffers.some(o=>o.customerId===row.id&&o.status==='PENDING')).length;
 assert.equal(offerCounts.off,0);assert.ok(managerDirectCount>0);assert.ok(offerCounts.a>0);assert.ok(offerCounts.b>0);assert.equal(r.state.customers.filter(row=>row.managerId==='m').length,12);
 const manager=await f.api.read({id:'m',role:'MANAGER'});assert.equal(manager.state.customers.length,12);assert.equal(manager.state.dataOffers.length,offerCounts.a+offerCounts.b);
 const saleSnapshot=await f.api.read({id:'b',role:'SALE',teamId:'D',leaderId:null});assert.ok(saleSnapshot.state.customers.length>0);
 const offer=saleSnapshot.state.dataOffers[0],row=saleSnapshot.state.customers.find(c=>c.id===offer.customerId),at=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);
 await f.api.write({id:'b',role:'SALE',teamId:'D',leaderId:null},'accept-direct',[
 change('customers',{...row,saleId:'b',saleAcceptedAt:at},saleSnapshot.versions['customers/'+row.id]),
 change('dataOffers',{...offer,status:'ACCEPTED',resolvedAt:at},saleSnapshot.versions['dataOffers/'+offer.id])]);
 assert.equal((await f.api.read({id:'b',role:'SALE',teamId:'D',leaderId:null})).state.customers.find(c=>c.id===row.id).saleId,'b');
});
test('Personnel customer filter includes each hierarchy and excludes sibling branches',()=>{
 const source=fs.readFileSync('reference-view.js','utf8'),a=source.indexOf('  function matchesPersonnelCustomer('),b=source.indexOf('\n  //',a),c=vm.createContext({});vm.runInContext(source.slice(a,b),c);
 const members=[{id:'m',role:'MANAGER'},{id:'l',role:'LEADER',managerId:'m'},{id:'s',role:'SALE',leaderId:'l'},{id:'d',role:'SALE',leaderId:'m',managerId:'m'},{id:'out',role:'SALE',leaderId:'other'}];
 const rows=[{id:'own',managerId:'m'},{id:'leader',leaderId:'l'},{id:'sale',saleId:'s'},{id:'direct',saleId:'d'},{id:'outside',saleId:'out'},{id:'waiting'}];
 const filter=id=>rows.filter(row=>c.matchesPersonnelCustomer(row,id,members)).map(row=>row.id);
 assert.deepEqual(filter('m'),['own','leader','sale','direct']);assert.deepEqual(filter('l'),['leader','sale']);assert.deepEqual(filter('s'),['sale']);assert.deepEqual(filter('d'),['direct']);assert.deepEqual(filter('UNASSIGNED'),['waiting']);assert.deepEqual(filter('ALL'),rows.map(r=>r.id));
});
test('Reference product saves image data, keeps it when editing, and rejects invalid image data',async()=>{
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN'};serverStateLoaded=true;state=initialState();flushServerPersistence=async()=>true;`,c);
 const imageData='data:image/webp;base64,AA==';
 const input={name:'Product image',sku:'IMG-QA',category:'Tools',price:1000,type:'SALE',active:true,imageData};
 const result=await c.window.crmApi.saveProduct(null,input);
 assert.equal(vm.runInContext(`state.products.find(p=>p.id===${JSON.stringify(result.id)}).imageData`,c),imageData);
 await c.window.crmApi.saveProduct(result.id,{...input,name:'Product image edited',price:1200});
 assert.equal(vm.runInContext(`state.products.find(p=>p.id===${JSON.stringify(result.id)}).imageData`,c),imageData);
 await assert.rejects(()=>c.window.crmApi.saveProduct(result.id,{...input,imageData:'https://example.com/product.jpg'}),/không hợp lệ/);
});

test('Admin edits queued round members without changing the active round',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'m1',name:'One',role:'SALE',active:true},{id:'m2',name:'Two',role:'SALE',active:true},{id:'m3',name:'Three',role:'SALE',active:true}];state.saleDistributionByLeader={'$':{globalCycle:true,rounds:[{id:'active',enabledSaleIds:['m1','m2'],weights:{m1:1,m2:1}},{id:'queued',enabledSaleIds:['m1','m2'],weights:{m1:1,m2:1}}]}};saveState=()=>{};`,c);
 await api.distributionRoundSave({roundId:'queued',enabledIds:['m2','m3'],weights:{m1:4,m2:2,m3:1}});
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds[0].enabledSaleIds`,c)),['m1','m2']);
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds[1].enabledSaleIds`,c)),['m2','m3']);
 assert.equal(vm.runInContext(`state.saleDistributionByLeader['$'].rounds[1].weights.m2`,c),2);
 await assert.rejects(()=>api.distributionRoundSave({roundId:'active',enabledIds:['m3'],weights:{m3:1}}),/vong dang chay/);
 await assert.rejects(()=>api.distributionRoundSave({roundId:'queued',enabledIds:[],weights:{m1:0,m2:0,m3:0}}),/it nhat mot nhan su/);
 });

function roundInput(state,roundIndex=0,position){
 const rounds=require('./distribution-rounds.js');
 const roster=rounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
 const config=state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights};
 const view=rounds.preview(config,rounds.cursorFrom(state.settings.assignmentCursor),roster.people,state.settings.assignmentMode)[roundIndex];
 position ??= view.index;
 return {roundId:view.roundId,token:view.token,position,memberId:view.ids[position]};
}
test('Skipping a slot persists through the existing state API without changing assigned customers',async()=>{
 const f=await automaticFixture();await f.webhook.persistWebhook(landingRecord(701));
 const before=await f.api.read(admin),roster=require('./distribution-rounds.js').recipients(before.state.members,before.state.leaderDistribution,before.state.saleDistributionByLeader);
 const config=before.state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights},view=require('./distribution-rounds.js').preview(config,before.state.settings.assignmentCursor.global,roster.people,before.state.settings.assignmentMode)[0];
 assert.equal(view.ids[0],'lead');
 const skipped=require('./distribution-rounds.js').skip(config,before.state.settings.assignmentCursor.global,roster.people,before.state.settings.assignmentMode,{roundId:view.roundId,token:view.token,position:1,memberId:'s1'});
 const settings={...before.state.settings,assignmentCursor:{...before.state.settings.assignmentCursor,global:skipped.cursor}};
 const saved=await f.api.write(admin,'skip-through-state',[{key:'settings',id:'$',base:before.versions['settings/$'],value:settings},{key:'saleDistributionByLeader',id:'$',base:before.versions['saleDistributionByLeader/$'],value:skipped.config}]);
 assert.deepEqual(saved.state.customers,before.state.customers);assert.deepEqual(saved.state.dataOffers,before.state.dataOffers);
 assert.deepEqual(saved.state.settings.assignmentCursor.global.ids,['lead','s2','s3','s4']);
 await f.webhook.persistWebhook(landingRecord(702));
 const after=await f.api.read(admin);assert.equal(recipientCounts(after).s2,recipientCounts(saved).s2+1);
});
test('Admin can remove a member from the active round without changing assigned slots',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'m1',name:'One',role:'SALE',active:true},{id:'m2',name:'Two',role:'SALE',active:true}];state.saleDistributionByLeader={'$':{globalCycle:true,rounds:[{id:'active',enabledSaleIds:['m1','m2'],weights:{m1:1,m2:1}},{id:'queued',enabledSaleIds:['m1','m2'],weights:{m1:1,m2:1}}]}};state.settings.assignmentMode='ROUND_ROBIN';state.settings.assignmentCursor.global={index:1,ids:['m1','m2'],cycleId:'1'};saveState=()=>{};`,c);
 const view=api.snapshot().distributionRoundViews[0];
 await api.distributionRoundRemoveMember({roundId:view.roundId,token:view.token,memberId:'m2'});
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds[0].enabledSaleIds`,c)),['m1']);
 assert.deepEqual(Array.from(vm.runInContext(`state.settings.assignmentCursor.global.ids`,c)),['m1']);
 assert.equal(vm.runInContext(`state.settings.assignmentCursor.global.index`,c),1);
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds[1].enabledSaleIds`,c)),['m1','m2']);
});
test('Deleting active round promotes queued round to round one and resets its cursor',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true},{id:'m1',name:'One',role:'SALE',leaderId:'lead',teamId:'T',active:true},{id:'m2',name:'Two',role:'SALE',leaderId:'lead',teamId:'T',active:true}];state.leaderDistribution={enabledLeaderIds:['lead']};state.saleDistributionByLeader={'$':{globalCycle:true,rounds:[{id:'active',enabledSaleIds:['m1'],weights:{m1:1}},{id:'queued',enabledSaleIds:['m2'],weights:{m2:1}}]},lead:{leaderEnabled:true,enabledSaleIds:['m1','m2'],weights:{lead:1,m1:1,m2:1}}};state.settings.assignmentMode='ROUND_ROBIN';state.settings.assignmentCursor.global={index:1,ids:['m1'],cycleId:'1'};saveState=()=>{};`,c);
 vm.runInContext(`state.saleDistributionByLeader['$'].rounds=state.saleDistributionByLeader['$'].rounds.slice(0,1)`,c);
 await assert.rejects(()=>api.distributionRoundDelete('active'),/vong ke tiep/);
 vm.runInContext(`state.saleDistributionByLeader['$'].rounds.push({id:'queued',enabledSaleIds:['m2'],weights:{m2:1}})`,c);
 await api.distributionRoundDelete('active');
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds.map(round=>round.id)`,c)),['queued']);
 assert.deepEqual(Array.from(vm.runInContext(`state.settings.assignmentCursor.global.ids`,c)),['m2']);
 assert.equal(vm.runInContext(`state.settings.assignmentCursor.global.index`,c),0);
 const promoted=vm.runInContext(`state.saleDistributionByLeader['$']`,c),people=[{id:'m1'},{id:'m2'}],rounds=require('./distribution-rounds.js');
 const first=rounds.take(promoted,vm.runInContext(`state.settings.assignmentCursor.global`,c),people,'ROUND_ROBIN');
 const second=rounds.take(first.config,first.cursor,people,'ROUND_ROBIN');
 assert.equal(first.id,'m2');assert.equal(second.id,'m2');
});
test('Explicit Admin role is not downgraded by a colliding Manager staff record',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'admin',name:'Manager collision',role:'MANAGER',active:true},{id:'a',role:'SALE',active:true},{id:'b',role:'SALE',active:true}];state.leaderDistribution={enabledLeaderIds:[]};state.saleDistributionByLeader={'$':{rounds:[{id:'one',enabledSaleIds:['a'],weights:{a:1}},{id:'two',enabledSaleIds:['b'],weights:{b:1}}]}};serverStateLoaded=false;let synced=false;syncServerState=async()=>{synced=true;serverStateLoaded=true;return true;};saveState=()=>{};`,c);
 assert.equal(vm.runInContext('effectivePermissionRole()',c),'ADMIN');
 await api.distributionRoundDelete('one');
 assert.equal(vm.runInContext('synced',c),true);
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds.map(round=>round.id)`,c)),['two']);
});
test('Admin actualRole keeps round deletion available when session role is stale',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`currentAccount={id:'admin',name:'Admin',role:'LEADER',actualRole:'ADMIN',scope:'ALL'};state.members=[{id:'lead',role:'LEADER',teamId:'T',active:true},{id:'s1',role:'SALE',leaderId:'lead',teamId:'T',active:true}];state.leaderDistribution={enabledLeaderIds:['lead']};state.saleDistributionByLeader={'$':{rounds:[{id:'one',enabledSaleIds:['s1'],weights:{s1:1}},{id:'two',enabledSaleIds:['s1'],weights:{s1:1}}]}};state.settings.assignmentCursor.global={index:0,ids:['s1'],cycleId:'1'};flushServerPersistence=async()=>true;`,c);
 await api.distributionRoundDelete('one');
 assert.deepEqual(Array.from(vm.runInContext(`state.saleDistributionByLeader['$'].rounds.map(round=>round.id)`,c)),['two']);
});
test('A concurrent webhook invalidates a stale slot skip through normal state revisions',async()=>{
 const f=await automaticFixture();const before=await f.api.read(admin);
 await f.webhook.persistWebhook(landingRecord(703));
 await assert.rejects(()=>f.api.write(admin,'skip-stale',[{key:'settings',id:'$',base:before.versions['settings/$'],value:{...before.state.settings,assignmentCursor:{...before.state.settings.assignmentCursor,global:{index:1,ids:['lead','s2','s3','s4']}}}}]),e=>e.status===409);
});
test('Skipping one weighted duplicate or final slot never removes previous allocations',()=>{
 const r=require('./distribution-rounds.js'),people=[{id:'a'},{id:'b'}],config={rounds:[{id:'one',enabledSaleIds:['a','b'],weights:{a:2,b:1}}]};
 let cursor={index:1,ids:['a','a','b'],cycleId:'9'};
 let view=r.preview(config,cursor,people,'ROUND_ROBIN')[0];
 let result=r.skip(config,cursor,people,'ROUND_ROBIN',{roundId:'one',token:view.token,position:1,memberId:'a'});
 assert.deepEqual(result.cursor.ids,['a','b']);assert.equal(result.cursor.index,1);
 view=r.preview(config,result.cursor,people,'ROUND_ROBIN')[0];
 result=r.skip(config,result.cursor,people,'ROUND_ROBIN',{roundId:'one',token:view.token,position:1,memberId:'b'});
 assert.deepEqual(result.cursor.ids,['a']);assert.equal(result.cursor.index,1);
 const next=r.take(config,result.cursor,people,'ROUND_ROBIN');
 assert.equal(next.id,'a');assert.deepEqual(next.cursor.ids,['a','a','b']);
 assert.equal(r.cursorFrom({global:0,salesByTeam:{global:{index:2,ids:['a','a','b']}}}).index,2);
});
test('Legacy global cursor restores a missing configured recipient before assigning',()=>{
 const r=require('./distribution-rounds.js'),people=[{id:'a'},{id:'b'}],config={rounds:[{id:'one',enabledSaleIds:['a','b'],weights:{a:1,b:1}}]};
 const step=r.take(config,{index:1,ids:['a'],cycleId:'legacy'},people,'ROUND_ROBIN');
 assert.equal(step.id,'b');
 assert.deepEqual(step.cursor.ids,['a','b']);
 assert.equal(step.cursor.roundId,'one');
});
test('Skip action persists config and cursor with regular CRM state save',async()=>{
 const c=referenceBridge();vm.runInContext(
  "currentAccount={id:'admin',role:'ADMIN'};state.members=[{id:'lead',role:'LEADER',teamId:'T',active:true},{id:'s1',role:'SALE',leaderId:'lead',teamId:'T',active:true},{id:'s2',role:'SALE',leaderId:'lead',teamId:'T',active:true}];state.leaderDistribution={enabledLeaderIds:['lead']};state.saleDistributionByLeader={'$':{rounds:[{id:'one',enabledSaleIds:['lead','s1','s2'],weights:{lead:1,s1:1,s2:1}}]}};state.settings.assignmentMode='ROUND_ROBIN';state.settings.assignmentCursor.global={index:1,ids:['lead','s1','s2'],cycleId:'1'};state.customers=[{id:'kept'}];let saved=0;saveState=()=>saved++;flushServerPersistence=async()=>true;",
  c);
 const snapshot=c.window.crmApi.snapshot(),view=snapshot.distributionRoundViews[0];
 await c.window.crmApi.distributionRoundSkip({roundId:view.roundId,token:view.token,position:1,memberId:'s1'});
 assert.deepEqual(Array.from(vm.runInContext("state.settings.assignmentCursor.global.ids",c)),['lead','s2']);
 assert.equal(vm.runInContext('state.customers[0].id',c),'kept');assert.equal(vm.runInContext('saved',c),1);
 assert.equal(vm.runInContext("state.audit.at(-1).action",c),'SKIP_DISTRIBUTION_SLOT');
 vm.runInContext("currentAccount={id:'sale',role:'SALE'};",c);
 await assert.rejects(()=>c.window.crmApi.distributionRoundSkip({}));
});
test('Runtime bundles round helper before consumers without a new static route',()=>{
 const source=fs.readFileSync('crm.js','utf8');
 const bundled=source.split('/* BEGIN BUNDLED DISTRIBUTION ROUNDS - source: distribution-rounds.js */')[1].split('/* END BUNDLED DISTRIBUTION ROUNDS */')[0].trim();
 assert.equal(bundled.replace(/\r/g,''),fs.readFileSync('distribution-rounds.js','utf8').trim().replace(/\r/g,''));
 assert.doesNotMatch(fs.readFileSync('crm-runtime.html','utf8'),/<script[^>]+src="[^"]*distribution-rounds/);
 const c=referenceBridge();
 assert.equal(vm.runInContext('typeof CrmDistributionRounds.preview',c),'function');
 const snapshot=c.window.crmApi.snapshot();
 assert.ok(snapshot.distributionRoundViews.length>0);
 assert.equal(snapshot.distributionRoundViews[0].roundId,'ROUND-1');
});

test('Extra turn appends once without changing weights, assigned prefix or next cycle',()=>{
 const r=require('./distribution-rounds.js'),people=[{id:'a'},{id:'b'}],config={rounds:[{id:'one',weights:{a:1,b:1},enabledSaleIds:['a','b']}]};
 const raw={index:1,ids:['a','b'],cycleId:'cycle'},view=r.preview(config,raw,people,'BALANCED')[0];
 const result=r.addExtraTurn(config,raw,people,'BALANCED',{roundId:'one',token:view.token,memberId:'a'});
 assert.deepEqual(result.cursor.ids,['a','b','a']);assert.equal(result.cursor.index,1);assert.deepEqual(result.config,config);assert.deepEqual(raw.ids,['a','b']);
 let step=r.take(result.config,result.cursor,people,'BALANCED');assert.equal(step.id,'b');
 step=r.take(step.config,step.cursor,people,'BALANCED');assert.equal(step.id,'a');
 step=r.take(step.config,step.cursor,people,'BALANCED');assert.deepEqual(step.cursor.ids,['a','b']);
 assert.throws(()=>r.addExtraTurn(config,result.cursor,people,'BALANCED',{roundId:'one',token:view.token,memberId:'a'}),/thay đổi/);
 assert.throws(()=>r.addExtraTurn(config,raw,people,'BALANCED',{roundId:'one',token:view.token,memberId:'unknown'}),/điều kiện/);
});
test('Extra turn finishes before queued round promotion and does not mutate queued round',()=>{
 const r=require('./distribution-rounds.js'),people=[{id:'a'},{id:'b'}],config={rounds:[{id:'one',weights:{a:1},enabledSaleIds:['a']},{id:'two',weights:{b:1},enabledSaleIds:['b']}]};
 const raw={index:1,ids:['a'],cycleId:'1'},v=r.preview(config,raw,people,'EQUAL');
 const added=r.addExtraTurn(config,raw,people,'EQUAL',{roundId:'one',token:v[0].token,memberId:'b'});
 let step=r.take(added.config,added.cursor,people,'EQUAL');assert.equal(step.id,'b');assert.equal(step.config.rounds[0].id,'one');
 step=r.take(step.config,step.cursor,people,'EQUAL');assert.equal(step.config.rounds[0].id,'two');assert.deepEqual(step.cursor.ids,['b']);
 assert.throws(()=>r.addExtraTurn(config,raw,people,'EQUAL',{roundId:'two',token:v[1].token,memberId:'a'}),/đang chạy/);
});
test('Extra turn API retries failed save without appending twice and denies Sale',async()=>{
 const c=referenceBridge();vm.runInContext("state.members=[{id:'l',role:'LEADER',teamId:'T',active:true},{id:'s',name:'Sale',role:'SALE',leaderId:'l',teamId:'T',active:true}];state.leaderDistribution={enabledLeaderIds:['l']};state.saleDistributionByLeader={'$':{rounds:[{id:'one',enabledSaleIds:['s'],weights:{s:1}}]}};state.settings.assignmentMode='BALANCED';state.settings.assignmentCursor.global={index:0,ids:['s'],cycleId:'1'};saveState=()=>{};let attempts=0;flushServerPersistence=async()=>++attempts!==2;",c);
 const api=c.window.crmApi,v=api.snapshot().distributionRoundViews[0],input={roundId:v.roundId,token:v.token,memberId:'s'};
 await assert.rejects(()=>api.distributionRoundAddExtraTurn(input),/Chưa lưu/);
 await api.distributionRoundAddExtraTurn(input);
 assert.deepEqual(Array.from(vm.runInContext('state.settings.assignmentCursor.global.ids',c)),['s','s']);
 vm.runInContext("currentAccount={id:'s',role:'SALE'}",c);await assert.rejects(()=>api.distributionRoundAddExtraTurn(input),/quyền/);
});
test('Extra turn persistence skips the expensive automatic distribution scan',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext("state.members=[{id:'l',role:'LEADER',teamId:'T',active:true},{id:'s',name:'Sale',role:'SALE',leaderId:'l',teamId:'T',active:true}];state.leaderDistribution={enabledLeaderIds:['l']};state.saleDistributionByLeader={'$':{rounds:[{id:'one',enabledSaleIds:['s'],weights:{s:1}}]}};state.settings.assignmentMode='BALANCED';state.settings.assignmentCursor.global={index:0,ids:['s'],cycleId:'1'};saveState=()=>{};let flushOptions=[];flushServerPersistence=async options=>{flushOptions.push(options||{});return true};",c);
 const view=api.snapshot().distributionRoundViews[0];
 await api.distributionRoundAddExtraTurn({roundId:view.roundId,token:view.token,memberId:'s'});
 assert.ok(vm.runInContext('flushOptions.some(options=>options.skipAutomatic===true)',c));
});
test('Extra turn persists and real webhook allocation consumes exactly the previewed sequence',async()=>{
 const f=await automaticFixture();await f.webhook.persistWebhook(landingRecord(801));
 const before=await f.api.read(admin),r=require('./distribution-rounds.js'),roster=r.recipients(before.state.members,before.state.leaderDistribution,before.state.saleDistributionByLeader);
 const config=before.state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights};
 const v=r.preview(config,r.cursorFrom(before.state.settings.assignmentCursor),roster.people,before.state.settings.assignmentMode)[0];
 const added=r.addExtraTurn(config,r.cursorFrom(before.state.settings.assignmentCursor),roster.people,before.state.settings.assignmentMode,{roundId:v.roundId,token:v.token,memberId:'s1'});
 const saved=await f.api.write(admin,'extra-turn-save',[
 {key:'settings',id:'$',base:before.versions['settings/$'],value:{...before.state.settings,assignmentCursor:{...before.state.settings.assignmentCursor,global:added.cursor}}},
 {key:'saleDistributionByLeader',id:'$',base:before.versions['saleDistributionByLeader/$'],value:{...before.state.saleDistributionByLeader,$:added.config}}]);
 assert.deepEqual(saved.state.customers,before.state.customers);
 for(const [index,id] of added.cursor.ids.slice(added.cursor.index).entries()){
  const record=landingRecord(810+index);await f.webhook.persistWebhook(record);const snapshot=await f.api.read(admin);const cid='CUS-'+record.id;
  const customer=snapshot.state.customers.find(c=>c.id===cid),offer=snapshot.state.dataOffers.find(o=>o.customerId===cid&&o.status==='PENDING');assert.equal(offer?.saleId||customer.saleId||customer.managerId,id);
 }
 const notices=f.db.docs.filter(d=>d.collection==='telegramOutbox');assert.ok(notices.some(d=>d.body.kind==='WEBHOOK_ADMIN'));assert.ok(notices.some(d=>d.body.offerId));assert.ok(notices.some(d=>d.body.acceptedAt));
 const publicState=await f.api.read(sale);assert.equal(publicState.state.telegramOutbox,undefined);
});
test('Telegram queue is atomic, replay-safe, and includes repeat-customer webhook events',async()=>{
 const f=await automaticFixture(),record=landingRecord(850);await f.webhook.persistWebhook(record);
 const before=f.db.docs.filter(d=>d.collection==='telegramOutbox').length;
 await f.webhook.persistWebhook(record);assert.equal(f.db.docs.filter(d=>d.collection==='telegramOutbox').length,before);
 await f.webhook.persistWebhook({...record,id:'new-repeat-event',dedupeKey:'different-payload'});
 assert.equal(f.db.docs.filter(d=>d.collection==='telegramOutbox'&&d.body.kind==='WEBHOOK_ADMIN').length,1);
 assert.equal(f.db.docs.filter(d=>d.collection==='telegramOutbox'&&d.body.kind==='DUPLICATE_ADMIN').length,1);
 assert.equal(f.db.docs.filter(d=>d.collection==='telegramOutbox'&&d.body.kind==='DUPLICATE_OWNER').length,1);
 const g=await automaticFixture();g.fail();await assert.rejects(()=>g.webhook.persistWebhook(landingRecord(851)));assert.equal(g.db.docs.filter(d=>d.collection==='telegramOutbox').length,0);
});

test('SQL feedback and processes reach the UI snapshot after reload',async()=>{
 const f=fixture();
 await f.api.write(admin,'organization-reload',[
 change('feedbacks',{id:'fb-reload',authorId:'admin',category:'SUPPORT',note:'Saved note',imageData:'',createdAt:'2026-09-28 10:00:00'}),
 change('processes',{id:'proc-reload',title:'Saved process',summary:'',content:'Steps',link:'',imageData:''})]);
 const c=referenceBridge();c.payload=await f.api.read(admin,{passive:true});
 vm.runInContext('applyServerSnapshot(payload)',c);
 const ui=c.window.crmApi.snapshot();
 assert.equal(ui.feedbacks[0].note,'Saved note');assert.equal(ui.processes[0].title,'Saved process');
});
test('Schema startup skips role ALTER when all roles already exist',async()=>{
 const queries=[],module={exports:{}};
 vm.runInNewContext(fs.readFileSync('crm-data.cjs','utf8')+';module.exports.checkRole=ensureRoleColumn;', {module,require:name=>name==='./db.js'?{pool:{query:async sql=>{queries.push(sql);return [[{role_type:"enum('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER','HRM')"}]];}}}:require(name)});
 await module.exports.checkRole();assert.equal(queries.length,1);
});

test('HRM đọc toàn bộ nhân sự, điểm danh, đơn hàng; hồ sơ và lot lưu SQL nhưng không sửa nghiệp vụ khác',async()=>{
 const f=fixture(),hrm={id:'hrm',role:'HRM'},employee={id:'sale',name:'Sale HRM',role:'SALE',team_id:'T',leader_id:'lead',active:1};
 f.db.users.push({id:'hrm',name:'HRM',role:'HRM',email:'hrm@example.test',active:1},employee);
 f.db.docs.push({collection:'attendance',id:'att-sale',deleted:0,body:{id:'att-sale',accountId:'sale',date:'2026-10-05',at:'2026-10-05 09:00:00',ipValid:true}});
 f.db.orders.push({id:'hr-order',code:'NVT-HR-1',customer_id:'c1',sale_id:'sale',leader_id:'lead',team_id:'T',total_amount:396,status:'DEPOSIT',items_json:JSON.stringify({subtotal:360,vatRate:.1,vatAmount:36,total:396,productId:'p1',productName:'Historical price',paymentReceipts:[],amountPaid:0}),note:'',created_at:'2026-10-05 10:00:00'});
 f.api.invalidateSnapshotCache();
 let snapshot=await f.api.read(hrm);
 assert.ok(snapshot.state.accounts.some(member=>member.id==='sale'));
 assert.ok(snapshot.state.attendance.some(record=>record.id==='att-sale'));
 assert.ok(snapshot.state.orders.some(record=>record.id==='hr-order'));
 assert.equal(snapshot.state.hrProfiles.length,0);

 const profile={id:'sale',employeeId:'sale',fields:{cccd:'012345678901',address:'TP HCM'},driveFiles:[{id:'cv',label:'Hồ sơ',url:'https://drive.google.com/file/d/1',note:'Hồ sơ nhân viên'}]};
 await f.api.write(hrm,'hr-profile-save',[change('hrProfiles',profile)]);
 assert.deepEqual((await f.api.read(admin)).state.hrProfiles[0].fields,profile.fields);
 assert.equal((await f.api.read(sale)).state.hrProfiles.length,0);

 snapshot=await f.api.read(hrm);
 const metric={...require('./hr-profiles.js').emptyMetric({id:'sale',role:'SALE',leaderId:'lead',teamId:'T'},'2026-09'),basicLots:2,miniLots:3,microLots:4};
 await f.api.write(hrm,'hr-lot-save',[change('brokerageMetrics',metric)]);
 const savedMetric=(await f.api.read(admin)).state.brokerageMetrics.find(row=>row.id===metric.id);
 assert.equal(savedMetric.basicLots,2);assert.equal(savedMetric.miniLots,3);assert.equal(savedMetric.microLots,4);
 await assert.rejects(f.api.write(hrm,'hr-lot-rate-denied',[change('brokerageMetrics',{...savedMetric,lotCommissionRate:999},(await f.api.read(hrm)).versions['brokerageMetrics/'+metric.id])]),e=>e.status===403);

 snapshot=await f.api.read(hrm);
 await assert.rejects(f.api.write(hrm,'hr-order-edit-denied',[change('orders',{...snapshot.state.orders.find(row=>row.id==='hr-order'),note:'tamper'},snapshot.versions['orders/hr-order'])]),e=>e.status===403);
 await assert.rejects(f.api.write(hrm,'hr-attendance-edit-denied',[change('attendance',{...snapshot.state.attendance.find(row=>row.id==='att-sale'),note:'tamper'},snapshot.versions['attendance/att-sale'])]),e=>e.status===403);
});

test('Existing provision marker skips startup advisory lock and account mutations',async()=>{
 let released=false;
 const {provisionSystemAccounts}=require('./system-accounts.cjs');
 const result=await provisionSystemAccounts({getConnection:async()=>({
 execute:async(sql)=>{assert.match(sql,/^SELECT setting_key/);return [[{setting_key:'done'}]];},
 // SHOW INDEX luôn chạy để bảo đảm chỉ mục đăng nhập; mọi query khác (GET_LOCK, ALTER) bị cấm.
 query:async(sql)=>{if(/^SHOW INDEX FROM users/.test(sql))return [[{Key_name:'idx_users_email_active'},{Key_name:'idx_users_phone_active'}]];throw Error('Existing accounts must not wait for migration lock');},
 rollback:async()=>{},
 release:()=>{released=true;}
 })});
 assert.equal(result.applied,false);assert.equal(released,true);
});
test('Login still authenticates before issuing a session',async()=>{
 const f=authFixture([{id:'active-admin',role:'ADMIN',password_hash:'correct-password'}]);
 const denied=await f.request('/api/auth/login',{identifier:'admin@example.test',password:'wrong'});
 assert.equal(denied.status,401);assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO crm_sessions')),false);
 const accepted=await f.request('/api/auth/login',{identifier:'admin@example.test',password:'correct-password'});
 assert.equal(accepted.status,200);assert.ok(accepted.payload.token);
 assert.ok(f.calls.some(call=>call.sql.startsWith('INSERT INTO crm_sessions')));
});
test('Login uses the dedicated auth pool and one indexed identifier column',()=>{
 const db=fs.readFileSync('db.js','utf8'),server=fs.readFileSync('webhook-server.cjs','utf8');
 assert.match(db,/const authPool = createManagedPool/);assert.match(db,/DB_AUTH_CONNECTION_LIMIT/);assert.match(db,/async function authQuery/);
 assert.match(server,/const rows=await loginStep.*authQuery\(`/);assert.match(server,/phone\?'phone=\?':'email=\?'/);assert.match(server,/await loginStep\(\(\) => authQuery\('INSERT INTO crm_sessions/);
});

test('Direct owner filter includes international phones and manager recipients without mixing team customers',()=>{
 const source=fs.readFileSync('reference-view.js','utf8');
 const c={window:{}};vm.createContext(c);vm.runInContext(source.slice(0,source.indexOf('function ensureCustomerPaginationStyles')),c);
 c.members=[{id:'m',role:'MANAGER'},{id:'l',role:'LEADER'},{id:'s',role:'SALE'}];
 vm.runInContext('appState.members=members;appState.offers=[]',c);
 for(const phone of ['0912345678','+84912345678','0084912345678']){
  assert.equal(c.normalizeCustomerFilterPhone(phone),'0912345678');
  assert.equal(c.assignedSaleIdForCustomer({id:'direct',phone,managerId:'m',saleAcceptedAt:'2026-09-28 10:00:00'}),'m');
  assert.equal(c.assignedSaleIdForCustomer({id:'owned',phone,ownerId:'m'}),'m');
  assert.equal(c.assignedSaleIdForCustomer({id:'team',phone,saleId:'s',managerId:'m',ownerId:'m'}),'s');
 }
 assert.equal(c.assignedSaleIdForCustomer({id:'waiting',managerId:'m'}),null);
 assert.equal(c.assignedSaleIdForCustomer({id:'leader',leaderId:'l',saleAcceptedAt:'2026-09-28 10:00:00'}),'l');
 vm.runInContext("appState.offers=[{customerId:'direct',saleId:'s',status:'PENDING'}]",c);
 assert.equal(c.assignedSaleIdForCustomer({id:'direct',managerId:'m',saleAcceptedAt:'2026-09-28 10:00:00'}),'s');
});

test('Column filters combine across the full dataset and discover new custom fields',()=>{
 const view=fs.readFileSync('reference-view.js','utf8'),bridge=fs.readFileSync('reference-crm.js','utf8');
 const c=vm.createContext({window:{}});
 vm.runInContext(view.slice(0,view.indexOf('function ensureCustomerPaginationStyles')),c);
 c.data={user:{role:'ADMIN'},members:[],websites:[],fields:[{id:'tags',label:'Tags',type:'MULTI_SELECT',showInTable:true,options:[{value:'hot',label:'Hot'}]},{id:'customerNote',label:'Ghi chú',type:'TEXT',showInTable:true,options:[]}],customers:Array.from({length:35},(_,index)=>({id:'c'+index,name:'Customer '+index,status:index%2?'NEW':'PAID',customFields:{tags:index<25?['hot','vip']:[],checkbox:false,customerNote:index<9?'Nội dung '+index:'  '}}))};
 vm.runInContext("const baseFields=['customerLevel','customerClass','callStatus','documentStatus','result'];appState.customers=data.customers",c);
 const start=bridge.indexOf('  function prepareCustomerColumnFilters()'),end=bridge.indexOf('  function installCustomerColumnFilters',start);
 vm.runInContext(bridge.slice(start,end),c);c.prepareCustomerColumnFilters();
 vm.runInContext("customerFilterState.columns={'field:tags':'hot',status:'PAID'}",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,13);
 vm.runInContext("delete customerFilterState.columns.status",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,25);
 vm.runInContext("customerFilterState.columns={'field:tags':''}",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,10);
 c.data.fields.push({id:'checkbox',label:'New column',type:'CHECKBOX',showInTable:true});c.prepareCustomerColumnFilters();
 vm.runInContext("customerFilterState.columns={'field:checkbox':'false'}",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,35);
 const noteColumn=vm.runInContext("customerColumnDefinitions.find(column=>column.key==='field:customerNote')",c);
 assert.equal(noteColumn.presenceFilter,true);
 assert.deepEqual([...new Set(c.data.customers.map(noteColumn.value))],['HAS_CONTENT','EMPTY']);
 assert.equal(noteColumn.labelFor('HAS_CONTENT'),'Có ghi chú');assert.equal(noteColumn.labelFor('EMPTY'),'Không ghi chú');
 vm.runInContext("customerFilterState.columns={'field:customerNote':'HAS_CONTENT'}",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,9);
 vm.runInContext("customerFilterState.columns={'field:customerNote':'EMPTY'}",c);
 assert.equal(c.data.customers.filter(c.matchesCustomerColumnFilters).length,26);
 c.data.fields=[];c.prepareCustomerColumnFilters();
 assert.equal(vm.runInContext('Object.keys(customerFilterState.columns).length',c),0);
 c.data.user.role='SALE';c.prepareCustomerColumnFilters();
 assert.equal(vm.runInContext("customerColumnDefinitions.some(column=>column.key==='source')",c),false);
});

test('Non-default data headers including new columns receive filters with valid arrow labels',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8'),start=source.indexOf('  function installCustomerColumnFilters('),end=source.indexOf('  function openCustomerColumnMenu(',start);
 const cells=Array.from({length:17},()=>({dataset:{},children:[],appendChild(button){this.children.push(button);}}));
 const expected=new Map([[3,'source'],[4,'leader'],[5,'sale'],[6,'field:customerLevel'],[7,'field:customerClass'],[8,'field:callStatus'],[9,'field:documentStatus'],[10,'field:result'],[13,'status'],[15,'referenceAmount']]);
 const c=vm.createContext({document:{createElement:()=>({dataset:{},setAttribute(){}})},customerFilterState:{columns:{}},customerColumnDefinitions:Array.from(expected.values()).map(key=>({key,label:key})),baseFields:['customerLevel','customerClass','callStatus','documentStatus','result'],data:{fields:[{id:'newField',active:true,showInTable:true}]},head:{cells,querySelectorAll:()=>[]},openCustomerColumnMenu:()=>{}});
 vm.runInContext(source.slice(start,end)+';installCustomerColumnFilters(head)',c);
 cells.forEach((cell,index)=>{const key=expected.get(index);assert.equal(cell.children[0]?.dataset.columnFilter,key);if(key)assert.equal(cell.children[0].textContent,'\u25be');});
});

test('Legacy latest-note column is hidden and NOTE cells autosave compact wrapped drafts',()=>{
 const html=fs.readFileSync('index.html','utf8'),source=fs.readFileSync('reference-crm.js','utf8');
 assert.match(html,/<th hidden aria-hidden="true">GHI CHÚ MỚI NHẤT<\/th>/);
 assert.doesNotMatch(source,/\{key:'note',label:/);
 assert.match(source,/className='customer-note-editor'/);
 assert.match(source,/white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:hidden/);
 assert.match(source,/Math\.min\(140,Math\.max\(58,control\.scrollHeight\)\)/);
 assert.match(source,/setTimeout\(flush,600\)/);
 assert.match(source,/control\.onblur=\(\)=>\{stageCustomerNoteSelection\(customer\.id,field\.id,control\.value,true\);/);
 assert.match(source,/nvt-crm-customer-note-drafts-v1:/);
 assert.match(source,/column\.presenceFilter\?\['HAS_CONTENT','EMPTY'\]/);
});

test('Accounting payment and VAT forms stay hidden until opened as accessible dialogs',()=>{
 const accounting=fs.readFileSync('commission_tree_demo.html','utf8'),shell=fs.readFileSync('index.html','utf8'),bridge=fs.readFileSync('reference-crm.js','utf8');
 assert.match(accounting,/\.modal-overlay\s*\{[^}]*display:\s*none/s);
 assert.match(accounting,/\.modal-overlay\.active\s*\{\s*display:\s*flex/s);
 assert.match(accounting,/function setAccountingModalOpen\(modalId, open\)/);
 assert.match(accounting,/body\.classList\.add\('accounting-modal-open'\)/);
 assert.match(accounting,/event\.key === 'Escape'/);
 assert.equal((accounting.match(/class="modal-overlay" role="dialog" aria-modal="true"/g)||[]).length,3);
  assert.doesNotMatch(shell,/<iframe[^>]+commission_tree_demo\.html/);
  assert.match(bridge,/commission_tree_demo\.html\?embedded=1&tab=\$\{encodeURIComponent\(targetTab\)\}&v=[\w-]+/);
});

test('Sale phụ trách uses the generic column filter value from the actual assignment',()=>{
 const source=fs.readFileSync('reference-view.js','utf8'),a=source.indexOf('function assignedSaleIdForCustomer'),b=source.indexOf('function ensureCustomerPaginationStyles');
 const c=vm.createContext({window:{}});vm.runInContext(source.slice(0,b),c);
 vm.runInContext("appState.members=[{id:'sale-a',name:'Sale A',role:'SALE'}];appState.offers=[];customerColumnDefinitions=[{key:'sale',value:customer=>assignedSaleIdForCustomer(customer)}];customerFilterState.columns={sale:'sale-a'}",c);
 assert.equal(vm.runInContext("matchesCustomerColumnFilters({id:'c1',saleId:'sale-a'})",c),true);
 assert.equal(vm.runInContext("matchesCustomerColumnFilters({id:'c2',saleId:'sale-b'})",c),false);
});


test('Concurrent initial sync callers wait for the same authoritative snapshot',async()=>{
 const c=frontend();let finish,calls=0;
 c.fetch=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 vm.runInContext("currentAccount={id:'admin',role:'ADMIN'};serverSyncToken='token';render=()=>{};",c);
 const first=vm.runInContext('syncServerState()',c),second=vm.runInContext('syncServerState()',c);
 assert.strictEqual(first,second);assert.equal(calls,1);
 assert.equal(vm.runInContext('serverStateLoaded',c),false);
 const payload=vm.runInContext('({state:initialState(),versions:{}})',c);
 finish({ok:true,json:async()=>payload});
 assert.equal(await first,true);assert.equal(await second,true);
 assert.equal(vm.runInContext('serverStateLoaded',c),true);
});

test('Failed sync releases the shared request so a retry can load state',async()=>{
 const c=frontend();vm.runInContext("currentAccount={id:'admin',role:'ADMIN'};serverSyncToken='token';render=()=>{};",c);
 assert.equal(await vm.runInContext('syncServerState()',c),false);
 const payload=vm.runInContext('({state:initialState(),versions:{}})',c);
 c.fetch=async()=>({ok:true,json:async()=>payload});
 assert.equal(await vm.runInContext('syncServerState()',c),true);
});

test('Field retry persists the latest selection after an earlier save failed',async()=>{
 const c=referenceBridge();
 vm.runInContext("state.customers=[{id:'c',name:'Customer',phone:'0900000011',customFields:{},status:'NEW'}];state.customFieldDefinitions=[{id:'test',label:'Test',type:'SELECT',active:true,options:[{value:'A',label:'A'},{value:'B',label:'B'}]}];saveState=()=>{};let saves=0;flushServerPersistence=async()=>++saves!==2;",c);
 await assert.rejects(()=>c.window.crmApi.updateField('c','test','A'),/Chưa lưu/);
 await c.window.crmApi.updateField('c','test','B');
 assert.equal(vm.runInContext("state.customers[0].customFields.test",c),'B');
 assert.ok(vm.runInContext('saves',c)>=4);
});

test('Restoring shell never exposes cached customer controls before runtime is ready',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8');
 const start=source.indexOf('  function refresh(force=false,suppliedSnapshot=null) {'),end=source.indexOf('    if(!next){',start);
 const context={customerSaveQueue:{pending:0},normalizeAccountingMenu(){},document:{hidden:false,activeElement:{}},working:false,workflowBusy:false,q:()=>null,frame:{contentWindow:{crmApi:{snapshot:()=>null},crmRuntimeAuthState:'restoring',crmRuntimeBooted:false}},api:null,data:null,rendered:false};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+' rendered=true; } refresh(true);',context);
 assert.equal(context.rendered,false);assert.equal(context.data,null);
});

test('Multi-select retries unchanged values after a failed database save',async()=>{
 const c=frontend();
 vm.runInContext("currentAccount={id:'admin',role:'ADMIN',scope:'ALL'};state=initialState();state.customers=[{id:'c',name:'Customer',customFields:{test:[]}}];state.customFieldDefinitions=[{id:'test',label:'Test',type:'MULTI_SELECT',active:true,options:[{value:'A',label:'A',color:'#123456'}]}];openModal=()=>{};let closed=0,writes=0;closeModal=()=>{closed++;};persistCustomer=async()=>++writes>1;saveState=()=>{};renderPreservingCustomerScroll=()=>{};toast=()=>{};quickMultiSelectModal('c','test');",c);
 c.document.querySelectorAll=()=>[{value:'A'}];
 const submit=c.document.querySelector('#quickMultiSelectForm').onsubmit;
 await submit({preventDefault(){}});assert.equal(vm.runInContext('closed',c),0);
 await submit({preventDefault(){}});assert.equal(vm.runInContext('writes',c),2);assert.equal(vm.runInContext('closed',c),1);
});


test('Saved session restores user and data with one authenticated state request',async()=>{
 const c=frontend(),calls=[];
 c.sessionStorage.setItem('nvt-crm-session-v1',JSON.stringify({token:'saved-token'}));
 const payload=vm.runInContext("({state:initialState(),versions:{},user:{id:'admin',role:'ADMIN'}})",c);
 vm.runInContext('refreshSessionContext=()=>{};startWebhookConsumer=()=>{};startServerSyncPolling=()=>{};refreshNavigationCounts=()=>{};render=()=>{};',c);
 c.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>payload};};
 await c.initialize();
 assert.equal(calls.length,1);assert.match(calls[0],/api\/state\?passive=1/);
 assert.equal(c.window.crmRuntimeAuthState,'authenticated');
 assert.equal(vm.runInContext('serverStateLoaded',c),true);
});


test('Failed session restoration keeps token and never falsely reports logout',async()=>{
 const c=frontend();c.sessionStorage.setItem('nvt-crm-session-v1',JSON.stringify({token:'saved-token'}));
 vm.runInContext('refreshSessionContext=()=>{};',c);
 c.setTimeout=(fn,ms)=>{if(ms<1000)queueMicrotask(fn);return 1;};
 c.fetch=async()=>{throw new Error('offline');};
 await c.initialize();
 assert.equal(c.window.crmRuntimeBooted,true);assert.equal(c.window.crmRuntimeAuthState,'restoring');
 assert.equal(JSON.parse(c.sessionStorage.getItem('nvt-crm-session-v1')).token,'saved-token');
 assert.match(c.document.querySelector('#loginError').textContent,/Phiên đăng nhập và bản nháp vẫn được giữ/);
 assert.match(c.window.crmRuntimeRestoreError,/tự thử lại/);
});


test('Pending SQL write is replayed with the same request ID after reload and cleared only on acknowledgement',async()=>{
 const c=frontend(),calls=[];
 vm.runInContext("currentAccount={id:'admin',role:'ADMIN'};serverSyncToken='token';serverStateLoaded=true;",c);
 const request={requestId:'SAVE-stable',changes:[{key:'customers',id:'c',base:null,value:{id:'c',name:'Saved'}}],skipAutomatic:false};
 c.sessionStorage.setItem('nvt-crm-pending-write-v1:admin',JSON.stringify({actorId:'admin',...request}));
 c.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,state:vm.runInContext('initialState()',c),versions:{}})};};
 const result=await vm.runInContext("recoverPendingWrite({id:'admin'})",c);
 assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0].body.requestId,'SAVE-stable');
 assert.equal(c.sessionStorage.getItem('nvt-crm-pending-write-v1:admin'),null);
});

test('Failed replay retains SQL draft and does not silently overwrite it',async()=>{
 const c=frontend();vm.runInContext("currentAccount={id:'admin',role:'ADMIN'};serverSyncToken='token';",c);
 c.sessionStorage.setItem('nvt-crm-pending-write-v1:admin',JSON.stringify({actorId:'admin',requestId:'SAVE-1',changes:[]}));
 c.fetch=async()=>({ok:false,json:async()=>({error:'Conflict'})});
 await assert.rejects(()=>vm.runInContext("recoverPendingWrite({id:'admin'})",c),/Conflict/);
 assert.ok(c.sessionStorage.getItem('nvt-crm-pending-write-v1:admin'));
});

test('Thirty concurrent logins complete when the business query path is stalled',async()=>{
 const f=authFixture([{id:'sale-test',role:'SALE',password_hash:'correct-password'}]);
 f.context.dbQuery=()=>new Promise(()=>{});
 const results=await Promise.all(Array.from({length:30},()=>f.request('/api/auth/login',{identifier:'0912345678',password:'correct-password'})));
 assert.ok(results.every(result=>result.status===200&&result.payload.token));
 assert.equal(new Set(results.map(result=>result.payload.token)).size,30);
});
test('Login returns structured 503 on acquisition timeout, without creating a session',async()=>{
 const f=authFixture();f.context.authQuery=async()=>{throw Object.assign(Error('queue timed out'),{code:'DB_ACQUIRE_TIMEOUT'});};
 const result=await f.request('/api/auth/login',{identifier:'0912345678',password:'password'});
 assert.equal(result.status,503);assert.equal(result.payload.code,'DB_ACQUIRE_TIMEOUT');assert.equal(f.calls.length,0);
});

test('Login body timeout restores submit button without starting a session',async()=>{
 const c=frontend();await c.initialize();let timers=0,cleared=0,bodies=0;
 c.setTimeout=()=>++timers;c.clearTimeout=id=>{if(id)cleared++;};c.AbortController=AbortController;
 c.fetch=async()=>({ok:true,status:200,json:async()=>{bodies++;throw Object.assign(Error('body stalled'),{name:'AbortError'});}});
 vm.runInContext('startSession=async()=>{throw Error("Must not start session");};document.querySelector("#loginPhone").value="0900000001";document.querySelector("#loginPassword").value="dummy";',c);
 await vm.runInContext('document.querySelector("#loginForm").onsubmit({preventDefault(){}})',c);
 assert.equal(bodies,2);assert.equal(timers,2);assert.equal(cleared,2);
 assert.equal(c.document.querySelector('#loginForm button[type="submit"]').disabled,false);
 assert.match(c.document.querySelector('#loginError').textContent,/Máy chủ phản hồi quá lâu/);
});

test('Login deadline returns JSON 503 and a late lookup cannot create a session',async()=>{
 const f=authFixture();let expire,resolveLookup;
 f.context.setTimeout=fn=>{expire=fn;return 1;};f.context.clearTimeout=()=>{};
 f.context.authQuery=()=>new Promise(resolve=>{resolveLookup=resolve;});
 const request=f.request('/api/auth/login',{identifier:'admin@example.test',password:'correct-password'});
 await new Promise(setImmediate);expire();
 const result=await request;assert.equal(result.status,503);assert.equal(result.payload.code,'DB_LOGIN_TIMEOUT');
 let sessionWrites=0;f.context.authQuery=async()=>{sessionWrites++;return [];};
 resolveLookup([{id:'admin',role:'ADMIN',password_hash:'correct-password'}]);
 await new Promise(setImmediate);assert.equal(sessionWrites,0);
});

test('Điểm danh Telegram rồi Web giữ một bản ghi và giờ đầu tiên trong SQL',async()=>{
 const f=fixture(),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 const tele={id:'ATT-'+date+'-sale',accountId:'sale',name:'Sale',date,at:date+' 08:30:00',ip:'Telegram',teamId:'T'};
 f.db.docs.push({collection:'attendance',id:tele.id,body:tele,deleted:0});
 const result=await f.api.write(sale,'web-after-telegram',[change('attendance',{...tele,id:'ATT-web',at:date+' 09:10:00',ip:'Web'})]);
 assert.equal(result.ok,true);assert.equal(result.state.attendance.length,1);assert.equal(result.state.attendance[0].at,tele.at);
 assert.equal(f.db.docs.filter(d=>d.collection==='attendance').length,1);
 const reread=await f.api.read(admin);assert.equal(reread.state.attendance[0].at,tele.at);
});
test('Hai lần điểm danh Web trong một giao dịch vẫn chỉ lưu một lần',async()=>{
 const f=fixture(),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 const record={accountId:'sale',name:'Sale',date,at:date+' 08:30:00',teamId:'T'};
 const result=await f.api.write(sale,'two-checkins',[change('attendance',{...record,id:'ATT-first'}),change('attendance',{...record,id:'ATT-second'})]);
 assert.equal(result.state.attendance.length,1);assert.equal(result.state.attendance[0].id,'ATT-first');
});
test('Chống trùng điểm danh không cho Sale điểm danh thay người khác',async()=>{
 const f=fixture(),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 const other={id:'ATT-other',accountId:'other',date,at:date+' 08:30:00'};
 f.db.docs.push({collection:'attendance',id:other.id,body:other,deleted:0});
 await assert.rejects(f.api.write(sale,'forged-checkin',[change('attendance',{...other,id:'ATT-forged'})]),e=>e.status===403);
});

test('SQL nhận điểm danh Telegram thì runtime báo ngay cho giao diện CRM',async()=>{
 const c=frontend(),events=[];c.Event=class{constructor(type){this.type=type;}};c.window.parent={dispatchEvent(event){events.push(event.type);}};
 vm.runInContext("currentAccount={id:'sale',role:'SALE'};serverSyncToken='session';applyServerSnapshot({state:initialState(),versions:{}});render=()=>{};",c);
 const payload=vm.runInContext("({state:{...state,attendance:[{id:'ATT-sync',accountId:'sale',date:dayIso(0),at:dayIso(0)+' 08:30:00',ip:'Telegram'}]},versions:{'attendance/ATT-sync':'v1'}})",c);
 c.fetch=async()=>({ok:true,json:async()=>payload});
 assert.equal(await c.syncServerState(),true);assert.deepEqual(events,['crm:session-changed']);
 assert.equal(await c.syncServerState(),true);assert.equal(events.length,1);
});

test('Customer note field edits merge with the SQL row and survive a next-day reread',async()=>{
 const f=fixture();
 await f.api.write(admin,'seed-note-customer',[change('customers',{...customer,customFields:{customerLevel:'L3',careNote:'Ghi chú ngày 1'}})]);
 let first=await f.api.read(sale);
 const firstCustomer=first.state.customers[0];
 // Simulate a stale/compact browser snapshot that lost the note locally while
 // still carrying the current row revision and an explicit edited-field list.
 const edited={...firstCustomer,customFields:{customerLevel:'L4'}};
 await f.api.write(sale,'edit-note-day-1',[{key:'customers',id:'c1',base:first.versions['customers/c1'],value:edited,fields:['customFields.customerLevel']}]);
 let reread=await f.api.read(sale,{passive:true});
 assert.equal(reread.state.customers[0].customFields.customerLevel,'L4');
 assert.equal(reread.state.customers[0].customFields.careNote,'Ghi chú ngày 1');
 // A second update on the following calendar day must retain the note again.
 const nextDay={...reread.state.customers[0],updatedAt:'2026-10-06 09:00:00',customFields:{...reread.state.customers[0].customFields,customerLevel:'L5'}};
 await f.api.write(sale,'edit-note-day-2',[{key:'customers',id:'c1',base:reread.versions['customers/c1'],value:nextDay,fields:['customFields.customerLevel','updatedAt']}]);
 const afterNextDay=await f.api.read(sale,{passive:true});
 assert.equal(afterNextDay.state.customers[0].customFields.careNote,'Ghi chú ngày 1');
 assert.equal(JSON.parse(f.db.customers[0].custom_fields_json).__crmFields.careNote,'Ghi chú ngày 1');
});

test('Customer field edits preserve raw SQL source metadata after UI enrichment',()=>{
 const c=frontend();
 vm.runInContext(`applyServerSnapshot({state:{...initialState(),websites:[{id:'w',name:'Landing',domain:'example.test'}],customers:[{id:'c',websiteId:'w',saleId:'sale',customFields:{}}]},versions:{'customers/c':'v1'}});state.customers[0].customFields={level:'L3',note:'Ghi chú đã lưu'};`,c);
 const patch=JSON.parse(JSON.stringify(vm.runInContext('pendingChanges().find(x=>x.key==="customers").value',c)));
 assert.equal(patch.landingPageUrl,undefined);assert.equal(patch.landingPageName,undefined);assert.equal(patch.customFields.level,'L3');assert.equal(patch.customFields.note,'Ghi chú đã lưu');
});

test('Sale Level and Note survive SQL reread on a fresh device with enriched website display',async()=>{
 const f=fixture();
 await f.api.write(admin,'seed-source',[change('websites',{id:'w',name:'Landing',domain:'example.test',webhookSlug:'DS-W'}),change('customers',{...customer,websiteId:'legacy-source',webhookSlug:'DS-W'})]);
 const snapshot=await f.api.read(sale),c=frontend();c.inputSnapshot=JSON.parse(JSON.stringify(snapshot));
 vm.runInContext(`applyServerSnapshot(inputSnapshot);state.customers[0].customFields={...state.customers[0].customFields,level:'L4',customerNote:'Ghi chú từ máy khác'};`,c);
 const changes=JSON.parse(JSON.stringify(vm.runInContext('pendingChanges()',c)));
 const unsafe=JSON.parse(JSON.stringify(vm.runInContext('state.customers[0]',c)));
 await assert.rejects(f.api.write(sale,'old-enriched-payload',[change('customers',unsafe,snapshot.versions['customers/c1'])]),e=>e.status===403);
 await f.api.write(sale,'save-from-other-device',changes);
 const fresh=await f.api.read(sale),other=frontend();other.inputSnapshot=JSON.parse(JSON.stringify(fresh));vm.runInContext('applyServerSnapshot(inputSnapshot)',other);
 assert.equal(vm.runInContext('state.customers[0].customFields.level',other),'L4');
 assert.equal(vm.runInContext('state.customers[0].customFields.customerNote',other),'Ghi chú từ máy khác');
 assert.equal(JSON.parse(f.db.customers[0].custom_fields_json).__crmFields.customerNote,'Ghi chú từ máy khác');
});

for(const actor of [admin,{id:'manager',role:'MANAGER'},{id:'lead',role:'LEADER',teamId:'T'},sale])test(actor.role+' saves Level and Note within assigned scope into SQL',async()=>{
 const f=fixture();f.db.docs.push({collection:'members',id:'manager',deleted:0,body:{id:'manager',name:'Manager',role:'MANAGER',active:true}},{collection:'members',id:'sale',deleted:0,body:{...sale,managerId:'manager',active:true}},{collection:'members',id:'lead',deleted:0,body:{id:'lead',role:'LEADER',teamId:'T',managerId:'manager',active:true}});await f.api.write(admin,'seed',[change('customers',{...customer,managerId:'manager'})]);
 const snap=await f.api.read(actor),c=frontend();c.inputSnapshot=JSON.parse(JSON.stringify(snap));
 vm.runInContext(`applyServerSnapshot(inputSnapshot);state.customers[0].customFields={level:'L5',customerNote:'Đã chăm sóc'};`,c);
 await f.api.write(actor,'edit',JSON.parse(JSON.stringify(vm.runInContext('pendingChanges()',c))));
 const again=await f.api.read(actor);assert.equal(again.state.customers[0].customFields.level,'L5');assert.equal(again.state.customers[0].customFields.customerNote,'Đã chăm sóc');
 if(actor.role!=='ADMIN')await assert.rejects(f.api.write({...actor,id:'outsider',teamId:'other'},'unauthorized',[change('customers',{...again.state.customers[0],customFields:{level:'HACK'}},again.versions['customers/c1'])]),e=>e.status===403);
});

test('Manual customer without webhook slug never inherits an unrelated website',()=>{
 const c=frontend();vm.runInContext(`applyServerSnapshot({state:{...initialState(),websites:[{id:'w',name:'Website',domain:'example.test'}],customers:[{id:'manual',websiteId:null,saleId:'sale',customFields:{}}]},versions:{}});`,c);
 assert.equal(vm.runInContext('state.customers[0].websiteId',c),null);assert.equal(vm.runInContext('state.customers[0].landingPageName',c),undefined);
});

test('F5 dựng snapshot xác thực trước khi chờ khôi phục SQL của bản nháp',async()=>{
 const c=frontend();let finish;c.holdRecovery=()=>new Promise(resolve=>{finish=resolve;});
 vm.runInContext('recoverPendingWrite=holdRecovery;render=()=>{};startWebhookConsumer=()=>{};startServerSyncPolling=()=>{};refreshNavigationCounts=()=>{};',c);
 const task=vm.runInContext("startSession({id:'admin',role:'ADMIN'},true,'token',{state:initialState(),versions:{}})",c);
 assert.equal(vm.runInContext('serverStateLoaded',c),true);assert.equal(vm.runInContext('serverRecoveryPending',c),true);
 finish(null);assert.equal(await task,true);assert.equal(vm.runInContext('serverRecoveryPending',c),false);
});

test('Phiên thiếu metadata không được lấy danh tính từ cache tài khoản cũ',()=>{
 const f=referenceCacheFixture();f.storage.setItem('nvt-crm-session-v1',JSON.stringify({token:'new-token'}));
 f.storage.setItem('nvt_crm_cached_snapshot_v1',JSON.stringify({version:1,accountId:'old-admin',role:'ADMIN',snapshot:{user:{id:'old-admin',role:'ADMIN'},navigation:[],customers:[]}}));
 assert.equal(vm.runInContext('readCachedSnapshot()',f.context),null);assert.equal(JSON.parse(f.storage.getItem('nvt-crm-session-v1')).accountId,undefined);
});
test('401 khi đồng bộ xóa token/cache nhưng giữ bản nháp riêng của tài khoản',async()=>{
 const c=frontend();vm.runInContext("currentAccount={id:'sale',role:'SALE'};serverSyncToken='expired';applyServerSnapshot({state:initialState(),versions:{}});",c);
 c.sessionStorage.setItem('nvt-crm-session-v1',JSON.stringify({token:'expired',accountId:'sale',role:'SALE'}));c.localStorage.setItem('nvt_crm_cached_snapshot_v1','cached');c.sessionStorage.setItem('nvt-crm-customer-edits-v1:sale','draft');
 c.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Expired'})});assert.equal(await c.syncServerState(),false);
 assert.equal(c.localStorage.getItem('nvt_crm_cached_snapshot_v1'),null);assert.equal(c.sessionStorage.getItem('nvt-crm-session-v1'),null);assert.equal(c.sessionStorage.getItem('nvt-crm-customer-edits-v1:sale'),'draft');assert.equal(c.window.crmRuntimeAuthState,'unauthenticated');
});

test('Non-admin background note saves may skip auto-distribution instead of getting 403',()=>{
 const server=fs.readFileSync('webhook-server.cjs','utf8');
 assert.ok(!/skipAutomatic===true&&user\.role!=='ADMIN'[^\n]*403/.test(server));
 assert.ok(server.includes("['customers','notes','audit','customerFieldHistory'].includes(change?.key)"));
 assert.ok(server.includes("body.skipAutomatic===true&&(user.role==='ADMIN'||backgroundOnly)"));
});
test('Snapshot reads on one connection run sequentially, avoiding false query timeouts',()=>{
 const store=fs.readFileSync('crm-data.cjs','utf8');
 const start=store.indexOf('async function allData');assert.ok(start>=0);
 const body=store.slice(start,store.indexOf('\n}\n',start));
 assert.ok(!body.includes('Promise.all('));
});
test('Passive reads share one snapshot query and see CRM writes immediately',async()=>{
 const f=fixture();await f.api.write(admin,'cache-1',[change('customers',customer)]);
 const customerSelects=()=>f.queries.filter(q=>q.sql==='SELECT * FROM customers').length;
 const before=customerSelects();
 // 3 người F5 cùng lúc: chỉ một lượt quét bảng, không xếp hàng 3 lần.
 const reads=await Promise.all([f.api.read(admin,{passive:true}),f.api.read(sale,{passive:true}),f.api.read(admin,{passive:true})]);
 assert.equal(customerSelects()-before,1);
 assert.equal(reads.map(r=>r.state.customers.length).join(','),'1,1,1');
 assert.equal(f.events.filter(e=>e==='lock').length>0,true);
 const locksBefore=f.events.filter(e=>e==='lock').length;
 await f.api.read(admin,{passive:true});
 assert.equal(f.events.filter(e=>e==='lock').length,locksBefore,'passive read must not take crm_write_lock');
 await f.api.write(admin,'cache-2',[change('customers',{...customer,id:'c2',phone:'0912345679'})]);
 const after=await f.api.read(admin,{passive:true});
 assert.equal(after.state.customers.map(r=>r.id).sort().join(','),'c1,c2');
 assert.equal(after.versions['customers/c1'],reads[0].versions['customers/c1']);
});
test('External invalidation refreshes the shared snapshot cache',async()=>{
 const f=fixture();await f.api.write(admin,'cache-3',[change('customers',customer)]);
 await f.api.read(admin,{passive:true});
 f.db.customers.find(r=>r.id==='c1').name='Đổi từ Telegram';
 f.api.invalidateSnapshotCache();
 const next=await f.api.read(admin,{passive:true});
 assert.equal(next.state.customers[0].name,'Đổi từ Telegram');
});

test('Nhiều người cùng sửa một khách khác cột: gộp theo trường, không 409, không mất dữ liệu',async()=>{
 const f=fixture(),first=await f.api.write(admin,'seed',[change('customers',customer)]);
 const stale=first.state.customers[0],base=first.versions['customers/c1'];
 // Admin đổi Level trước; Sale vẫn cầm bản cũ rồi đổi trạng thái gọi.
 await f.api.write(admin,'admin-level',[{...change('customers',{...stale,customFields:{...stale.customFields,level:'L5'}},base),fields:['customFields.level']}]);
 await f.api.write(sale,'sale-call',[{...change('customers',{...stale,customFields:{...stale.customFields,callStatus:'CALLED'}},base),fields:['customFields.callStatus']}]);
 for(const viewer of [admin,sale]){const c=(await f.api.read(viewer)).state.customers[0];assert.equal(c.customFields.level,'L5');assert.equal(c.customFields.callStatus,'CALLED');}
 // Cùng một cột: lượt lưu sau thắng.
 await f.api.write(admin,'admin-call',[{...change('customers',{...stale,customFields:{...stale.customFields,callStatus:'MISSED'}},base),fields:['customFields.callStatus']}]);
 assert.equal((await f.api.read(sale)).state.customers[0].customFields.callStatus,'MISSED');
 // Gộp vẫn kiểm tra quyền: Sale không được đổi đội qua danh sách trường.
 await assert.rejects(f.api.write(sale,'sale-team',[{...change('customers',{...stale,teamId:'X'},base),fields:['teamId']}]),e=>e.status===403);
 await assert.rejects(f.api.write(admin,'proto',[{...change('customers',stale,base),fields:['__proto__']}]),e=>e.status===400);
});
test('409 khi lưu: tự tải bản mới, gộp cột mình sửa và gửi lại, không khóa phiên lưu',async()=>{
 const c=frontend();
 vm.runInContext("currentAccount={id:'sale',role:'SALE'};serverSyncToken='token';applyServerSnapshot({state:{...initialState(),customers:[{id:'c1',name:'K',saleId:'sale',customFields:{level:'L1',call:''}}]},versions:{'customers/c1':'v1'}});state.customers[0].customFields.call='CALLED';",c);
 const posts=[],initialState=()=>vm.runInContext('initialState()',c);
 c.fetch=async(url,options)=>{
  if(options?.method==='POST'){const body=JSON.parse(options.body);posts.push(body);
   if(posts.length===1)return {ok:false,status:409,json:async()=>({error:'Đã đổi ở máy khác'})};
   const value=body.changes[0].value;return {ok:true,status:200,json:async()=>({state:{...initialState(),customers:[value]},versions:{'customers/c1':'v3'}})};}
  // Máy khác vừa đổi Level sang L4.
  return {ok:true,status:200,json:async()=>({state:{...initialState(),customers:[{id:'c1',name:'K',saleId:'sale',customFields:{level:'L4',call:''}}]},versions:{'customers/c1':'v2'}})};
 };
 assert.equal(await c.flushServerPersistence(),true);
 assert.equal(posts.length,2);assert.equal(posts[1].changes[0].base,'v2');assert.notEqual(posts[1].requestId,posts[0].requestId);
 assert.equal(vm.runInContext('serverConflict',c),false);
 assert.equal(vm.runInContext('state.customers[0].customFields.level',c),'L4');assert.equal(vm.runInContext('state.customers[0].customFields.call',c),'CALLED');
});
test('Xung đột cũ được gỡ bằng nút Thử lưu lại thay vì phải F5',async()=>{
 const c=frontend();
 vm.runInContext("currentAccount={id:'sale',role:'SALE'};serverSyncToken='token';applyServerSnapshot({state:{...initialState(),notes:[]},versions:{}});state.notes.push({id:'n1',text:'giữ'});serverConflict=true;",c);
 const initialState=()=>vm.runInContext('initialState()',c);
 c.fetch=async()=>({ok:true,status:200,json:async()=>({state:initialState(),versions:{}})});
 assert.equal(await c.resolveServerConflict(),true);assert.equal(vm.runInContext('serverConflict',c),false);
 assert.equal(vm.runInContext('state.notes[0].text',c),'giữ');
});
test('Lịch sử cột dùng mã ngẫu nhiên, nhiều máy cùng ghi không trùng khóa',()=>{
 const source=fs.readFileSync('crm.js','utf8');
 const body=source.slice(source.indexOf('function recordFieldChange('),source.indexOf('function setCustomerCustomFields('));
 assert.ok(body.includes("makeRecordId('FLD')"));assert.ok(!body.includes('customerFieldHistory.length}'));
});
test('Lượt lưu nền trả về dữ liệu vừa ghi, không chạy chia tự động',async()=>{
 const f=fixture();await f.api.write(admin,'seed-bg',[change('customers',customer)]);
 const before=await f.api.read(admin);const c1=before.state.customers[0];
 const result=await f.api.write(sale,'bg',[{...change('customers',{...c1,customFields:{...c1.customFields,level:'L5'}},before.versions['customers/c1']),fields:['customFields.level']}],{skipAutomatic:true});
 assert.equal(result.state.customers[0].customFields.level,'L5');
 assert.equal((await f.api.read(admin,{passive:true})).state.customers[0].customFields.level,'L5');
});
test('Lượt lưu thường chỉ đọc toàn bộ bảng một lần khi giữ khóa ghi chung, rồi commit ngay',async()=>{
 const f=fixture();await f.api.write(admin,'seed-lock',[change('customers',customer)]);
 const before=await f.api.read(admin);const c1=before.state.customers[0];
 const start=f.events.length;
 const result=await f.api.write(sale,'status-lock',[change('customers',{...c1,status:'CONTACTED'},before.versions['customers/c1'])]);
 assert.equal(result.ok,true);assert.equal(result.state.customers[0].status,'CONTACTED');
 const lock=f.events.indexOf('lock',start),commit=f.events.indexOf('commit',lock);
 const fullScans=f.queries.filter(q=>q.sql==='SELECT * FROM customers'&&q.event>lock&&q.event<=commit);
 assert.equal(fullScans.length,1);
});

test('Mindmap lưu lot/định mức cho cả Manager, Leader, Sale và giữ sau F5',async()=>{
 const f=await managerFixture();
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 c.snapshot=await f.api.read(admin,{passive:true});c.u={id:'admin',name:'Admin',role:'ADMIN'};
 c.fetch=async(url,o)=>{try{const res=o?.method==='POST'?await (()=>{const b=JSON.parse(o.body);return f.api.write(admin,b.requestId,b.changes,{skipAutomatic:b.skipAutomatic});})():await f.api.read(admin,{passive:true});return {ok:true,status:200,json:async()=>res};}catch(e){return {ok:false,status:e.status||500,json:async()=>({error:e.message})};}};
 vm.runInContext("currentAccount=hydrateSessionAccount(u);serverSyncToken='t';applyServerSnapshot(snapshot);",c);
 for(const [memberId,rate] of [['mgr',95000],['lead',75000],['sale',55000]])
  await c.window.crmApi.saveBrokerageMetric({memberId,period:'2026-10',basicLots:3,miniLots:2,microLots:1,lotCommissionRate:rate,productRate:12,bonus:100});
 const after=(await f.api.read(admin)).state.brokerageMetrics;
 for(const [memberId,rate] of [['mgr',95000],['lead',75000],['sale',55000]]){
  const m=after.find(x=>x.id==='BRK-2026-10-'+memberId);assert.ok(m,memberId);
  assert.equal(m.basicLots,3);assert.equal(m.miniLots,2);assert.equal(m.microLots,1);assert.equal(m.lotCommissionRate,rate);assert.equal(m.productRate,12);assert.equal(m.bonus,100);
 }
 // Lưu lại chỉ đổi định mức: các lot cũ vẫn được giữ.
 await c.window.crmApi.saveBrokerageMetric({memberId:'lead',period:'2026-10',lotCommissionRate:80000});
 const lead=(await f.api.read(admin)).state.brokerageMetrics.find(x=>x.id==='BRK-2026-10-lead');
 assert.equal(lead.lotCommissionRate,80000);assert.equal(lead.miniLots,2);
 assert.ok((await f.api.read({id:'lead',role:'LEADER',teamId:'T'})).state.brokerageMetrics.some(x=>x.memberId==='lead'));
});
test('Chọn Level L0 cho khách chưa có Level vẫn được lưu và ghi lịch sử', () => {
 const c=frontend();
 vm.runInContext(`currentAccount={id:'admin',role:'ADMIN',scope:'ALL'};state=initialState();state.members=[];state.customers=[{id:'k1',name:'Khach',phone:'0912345678',status:'NEW',createdAt:'2026-10-01 10:00',updatedAt:'2026-10-01 10:00',customFields:{}},{id:'k2',name:'Khach 2',phone:'0912345679',status:'NEW',createdAt:'2026-10-01 10:00',updatedAt:'2026-10-01 10:00'}];STAFF=state.members;`,c);
 for(const id of ['k1','k2']){
  const result=vm.runInContext(`setCustomerCustomFields('${id}',{customerLevel:'L0'})`,c);
  assert.equal(result.updated,true);
  assert.equal(vm.runInContext(`customerById('${id}').customFields.customerLevel`,c),'L0');
  assert.ok(vm.runInContext(`state.customerFieldHistory.some(h=>h.customerId==='${id}'&&h.fieldId==='customerLevel'&&h.to==='L0')`,c));
  // Chọn lại cùng giá trị thì không tạo thêm thay đổi.
  assert.equal(vm.runInContext(`setCustomerCustomFields('${id}',{customerLevel:'L0'})`,c).updated,false);
 }
 assert.equal(vm.runInContext(`setCustomerCustomFields('k1',{customerLevel:'L1'})`,c).updated,true);
 assert.equal(vm.runInContext(`customerById('k1').customFields.customerLevel`,c),'L1');
});

test('Pending SQL write survives a closed tab via localStorage and is cleared from both stores on acknowledgement',async()=>{
 const c=frontend();
 const mk=()=>{const v=new Map();return {v,getItem:k=>v.has(k)?v.get(k):null,setItem:(k,x)=>v.set(k,String(x)),removeItem:k=>v.delete(k)};};
 const tab=mk(),disk=mk();c.sessionStorage=tab;c.localStorage=disk;
 vm.runInContext("currentAccount={id:'sale',role:'SALE'};serverSyncToken='token';rememberPendingWrite({requestId:'SAVE-local',changes:[{key:'notes',id:'n',base:null,value:{id:'n'}}]});",c);
 assert.ok(disk.getItem('nvt-crm-pending-write-v1:sale'));
 tab.v.clear(); // đóng tab: sessionStorage mất, localStorage còn
 const calls=[];c.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,state:vm.runInContext('initialState()',c),versions:{}})};};
 await vm.runInContext("recoverPendingWrite({id:'sale'})",c);
 assert.equal(calls[0].requestId,'SAVE-local');
 assert.equal(disk.getItem('nvt-crm-pending-write-v1:sale'),null);assert.equal(tab.getItem('nvt-crm-pending-write-v1:sale'),null);
});

test('A newer debounced customer note draft wins over an older queued value on restore',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8');
 const start=source.indexOf('const combined=Array.from(new Map(');
 const end=source.indexOf(');',start);
 assert.ok(start>=0&&end>start);
 const merge=new Function('records','noteRecords',source.slice(start,end+2)+';return combined;');
 const older={key:'field:c1:careNote',payload:{value:'Ghi chú cũ'}};
 const newer={key:'field:c1:careNote',payload:{value:'Ghi chú mới'}};
 assert.equal(merge([older],[newer])[0].payload.value,'Ghi chú mới');
});

test('Customer cell drafts are mirrored to localStorage and reconnecting retries pending saves',()=>{
 const source=fs.readFileSync('reference-crm.js','utf8'),crm=fs.readFileSync('crm.js','utf8');
 assert.match(source,/set\(key,value\)\{sessionStorage\.setItem\(key,value\);try\{localStorage\.setItem\(key,value\);\}catch\{\}\}/);
 assert.match(source,/JSON\.parse\(draftStore\.get\(draftStorageKey\(\)\)\|\|'\[\]'\)/);
 assert.doesNotMatch(source,/sessionStorage\.(get|set|remove)Item\((noteD|d)raftStorageKey\(\)/);
 assert.match(source,/addEventListener\('online',\(\)=>\{if\(customerSaveQueue\.pending\)customerSaveQueue\.retry\(\);\}\)/);
 assert.match(crm,/addEventListener\('online'/);
});

test('Tạo lại đơn cho cùng SĐT dùng đúng hồ sơ của Sale được chọn, không đổi dữ liệu khách',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'sale1',role:'SALE',active:true,leaderId:'lead',teamId:'T'},{id:'sale2',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[{id:'other',name:'Khách Sale 1',phone:'0912345678',saleId:'sale1',leaderId:'lead',teamId:'T'},{id:'own',name:'Khách Sale 2',phone:'0912345678',saleId:'sale2',leaderId:'lead',teamId:'T'}];`,c);
 const input={source:'accounting-iframe',customerName:'Tên in trên đơn',phone:'+84 912345678',saleId:'sale2',productId:'p',total:5500000,amountPaid:500000,billImage:'data:image/png;base64,AA=='};
 const first=await api.createOrder(input),second=await api.createOrder({...input,customerName:'Tên trên đơn sau'});
 assert.notEqual(first.id,second.id);assert.equal(first.order.customerId,'own');assert.equal(second.order.customerId,'own');
 assert.equal(vm.runInContext('state.customers.length',c),2);assert.equal(vm.runInContext('state.orders.length',c),2);
 assert.equal(vm.runInContext('state.customers.find(row=>row.id==="own").name',c),'Khách Sale 2');
 assert.equal(second.order.customerName,'Tên trên đơn sau');assert.equal(first.order.paymentReceipts.length,1);
});

test('Trùng SĐT khác Sale hoặc data chưa phân không ngăn tạo đơn và không chuyển chủ data cũ',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'sale1',role:'SALE',active:true,leaderId:'lead',teamId:'T'},{id:'sale2',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[{id:'unassigned',name:'Data chưa phân',phone:'0912345678',saleId:null},{id:'other',name:'Khách Sale 1',phone:'0912345678',saleId:'sale1',leaderId:'lead',teamId:'T'}];`,c);
 const input={source:'accounting-iframe',customerName:'Khách mua',phone:'0912345678',saleId:'sale2',productId:'p',total:5500000,amountPaid:500000,billImage:'data:image/png;base64,AA=='};
 const first=await api.createOrder(input),second=await api.createOrder(input);
 assert.notEqual(first.id,second.id);assert.equal(second.order.customerId,first.customer.id);
 assert.equal(vm.runInContext('state.customers.length',c),3);assert.equal(vm.runInContext('state.customers.find(row=>row.id==="other").saleId',c),'sale1');
 assert.equal(vm.runInContext('state.customers.find(row=>row.id==="unassigned").saleId',c),null);
 assert.equal(vm.runInContext('state.orders.length',c),2);
});
test('Receipt orders apply VAT independently of invoice request and support own Sale updates',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`currentAccount={id:'sale',saleId:'sale',name:'Sale',role:'SALE',scope:'OWN',leaderId:'lead',teamId:'T'};state.members=[{id:'sale',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];`,c);
 const result=await api.createOrder({source:'accounting-iframe',customerName:'Test',phone:'0901234567',saleId:'sale',productId:'p',subtotal:5000000,amountPaid:500000,vatRate:0,requireVat:false,cccd:'',address:'',paymentReference:'NVTTEST',billImage:'data:image/jpeg;base64,AA=='});
 assert.equal(result.order.total,5500000);assert.equal(result.order.balanceDue,5000000);assert.equal(result.order.requireVat,false);assert.equal(result.order.paymentReceipts[0].images[0].note,'Bill cọc');
 const updated=await api.updateOrderAccounting(result.id,{action:'COLLECT',amount:5000000,confirmed:true,billImage:'data:image/jpeg;base64,AA=='});
 assert.equal(updated.order.status,'PAID');assert.equal(updated.order.paymentMode,'FULL');assert.equal(updated.order.paymentReceipts.at(-1).images[0].note,'Bill chuyển khoản đủ');assert.equal(updated.order.vatAmount,500000);assert.equal(vm.runInContext('state.customers[0].name',c),'Test');
 const before=JSON.stringify(updated.order);
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'UPDATE',customerName:'Invalid',customerPhone:'0901234567',subtotal:5000000,amountPaid:99999999}),/Thêm thanh toán/);
 assert.equal(JSON.stringify(vm.runInContext('state.orders[0]',c)),before);
 vm.runInContext(`currentAccount={id:'other',saleId:'other',role:'SALE',scope:'OWN',leaderId:'lead',teamId:'T'}`,c);
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'UPDATE'}),/quyền/);
});

test('Receipt API collects multiple bills, refuses overpayment and preserves initial receipt',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'sale',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];`,c);
 const initial=await api.createOrder({source:'accounting-iframe',customerName:'Test',phone:'0901234567',saleId:'sale',productId:'p',subtotal:5000000,amountPaid:500000,paymentReference:'MULTI',billImage:'data:image/jpeg;base64,AA=='});
 const originalReceipt=JSON.stringify(initial.order.paymentReceipts[0]);
 await assert.rejects(()=>api.updateOrderAccounting(initial.id,{action:'COLLECT',amount:1000000,confirmed:true}),/bill/);
 await api.updateOrderAccounting(initial.id,{action:'COLLECT',amount:1000000,confirmed:true,billImage:'data:image/jpeg;base64,AQ=='});
 let current=vm.runInContext('state.orders[0]',c);assert.equal(current.amountPaid,1500000);assert.equal(current.balanceDue,4000000);assert.equal(current.status,'DEPOSIT');assert.equal(current.depositAmount,500000);
 await assert.rejects(()=>api.updateOrderAccounting(initial.id,{action:'COLLECT',amount:4000001,confirmed:true,billImage:'data:image/jpeg;base64,Ag=='}),/không vượt/);
 await api.updateOrderAccounting(initial.id,{action:'COLLECT',amount:4000000,confirmed:true,billImage:'data:image/jpeg;base64,Ag=='});
 current=vm.runInContext('state.orders[0]',c);assert.equal(current.paymentReceipts.length,3);assert.equal(JSON.stringify(current.paymentReceipts[0]),originalReceipt);assert.equal(current.amountPaid,5500000);assert.equal(current.balanceDue,0);assert.equal(current.status,'PAID');assert.equal(vm.runInContext('financialEvents(state.orders).reduce((s,e)=>s+e.amount,0)',c),5500000);
 await assert.rejects(()=>api.updateOrderAccounting(initial.id,{action:'COLLECT',amount:1,confirmed:true,billImage:'data:image/jpeg;base64,Aw=='}),/không vượt/);
});

test('Receipt images can be replaced and added with individual notes without adding money; accounting review is separate',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`currentAccount={id:'sale',saleId:'sale',role:'SALE',name:'Sale',scope:'OWN',leaderId:'lead',teamId:'T'};state.members=[{id:'sale',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];`,c);
 const result=await api.createOrder({source:'accounting-iframe',customerName:'Customer',phone:'0901234567',saleId:'sale',productId:'p',subtotal:5000000,amountPaid:5500000,paymentReference:'IMAGEEDIT',billImage:'data:image/jpeg;base64,AA==',requireVat:true,taxCode:'0123456789',companyName:'Test Company'});
 const receiptId=result.order.paymentReceipts[0].id,images=require('./order-payments.js').images(result.order.paymentReceipts[0]);
 images[0].imageData='data:image/jpeg;base64,AQ==';images[0].note='Thay ảnh rõ hơn';images.push({id:'supplement',imageData:'data:image/jpeg;base64,Ag==',note:'Chi tiết giao dịch'});
 await api.updateOrderAccounting(result.id,{action:'SAVE_RECEIPT_IMAGES',receiptId,images});
 let saved=vm.runInContext('state.orders[0]',c);assert.equal(saved.amountPaid,5500000);assert.equal(saved.paymentReceipts.length,1);assert.equal(saved.paymentReceipts[0].images.length,2);assert.equal(saved.paymentReceipts[0].imageRevisions[0].images[0].imageData,'data:image/jpeg;base64,AA==');assert.equal(saved.paymentReceipts[0].images[1].note,'Chi tiết giao dịch');assert.equal(saved.taxCode,'0123456789');assert.equal(saved.companyName,'Test Company');
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'RECONCILE',confirmed:true}),/quyền/);
 vm.runInContext(`currentAccount={id:'accountant',role:'ACCOUNTING',scope:'ALL',name:'Accounting'}`,c);
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'ISSUE_VAT',invoiceNumber:'INV-1'}),/đối soát/);
 const events=JSON.stringify(vm.runInContext('financialEvents(state.orders).map(e=>({amount:e.amount,at:e.occurredAt}))',c));
 await api.updateOrderAccounting(result.id,{action:'RECONCILE',confirmed:true,note:'Đã khớp sao kê'});saved=vm.runInContext('state.orders[0]',c);
 assert.equal(saved.paymentReconciled,true);assert.equal(saved.paymentReconciledBy,'accountant');assert.equal(saved.amountPaid,5500000);assert.equal(saved.paymentReceipts.length,1);assert.equal(JSON.stringify(vm.runInContext('financialEvents(state.orders).map(e=>({amount:e.amount,at:e.occurredAt}))',c)),events);
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'RECONCILE',confirmed:true}),/đã được đối soát/);
 await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'SAVE_RECEIPT_IMAGES',receiptId,images}),/đối soát/);
 vm.runInContext(`currentAccount={id:'sale',role:'SALE',scope:'OWN',name:'Sale'}`,c);await assert.rejects(()=>api.updateOrderAccounting(result.id,{action:'ISSUE_VAT',invoiceNumber:'INV-2',taxCode:'0123456789',companyName:'Test Company'}),/Chỉ Kế toán hoặc Admin/);
 vm.runInContext(`currentAccount={id:'accountant',role:'ACCOUNTING',scope:'ALL',name:'Accounting'}`,c);
 await api.updateOrderAccounting(result.id,{action:'ISSUE_VAT',invoiceNumber:'INV-1',taxCode:'0123456789',companyName:'Test Company'});assert.equal(vm.runInContext('state.orders[0].vatInvoiceNumber',c),'INV-1');
});

test('Gross order input persists exact inclusive total through create, edit and collection',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`currentAccount={id:'sale',saleId:'sale',name:'Sale',role:'SALE',scope:'OWN',leaderId:'lead',teamId:'T'};state.members=[{id:'sale',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];`,c);
 const input={source:'accounting-iframe',customerName:'Test Customer',phone:'0901234567',saleId:'sale',productId:'p',total:5500006,amountPaid:500000,billImage:'data:image/jpeg;base64,AA=='};
 const created=await api.createOrder(input);assert.equal(created.order.total,5500006);assert.equal(created.order.vatAmount,500001);assert.equal(created.order.paymentReference,'Test Customer 0901234567');
 const receipt=JSON.stringify(created.order.paymentReceipts);
 const edited=await api.updateOrderAccounting(created.id,{...input,action:'UPDATE',customerPhone:input.phone});assert.equal(edited.order.total,5500006);assert.equal(JSON.stringify(edited.order.paymentReceipts),receipt);
 const collected=await api.updateOrderAccounting(created.id,{action:'COLLECT',amount:5000006,confirmed:true,billImage:input.billImage});assert.equal(collected.order.status,'PAID');assert.equal(collected.order.balanceDue,0);
 const events=require('./order-payments.js').events(collected.order);assert.equal(events.reduce((v,e)=>v+e.amount,0),5500006);assert.equal(events.reduce((v,e)=>v+e.vatAmount,0),500001);
});

test('Invoice email, image notes and accounting settings survive storage roundtrip',async()=>{
 const f=fixture(),p=require('./order-payments.js');
 const receipt={id:'r1',amount:5500000,kind:'FULL',at:'2026-10-03T10:00:00Z',createdBy:'admin',billImage:'data:image/png;base64,AA==',images:[{id:'i1',imageData:'data:image/png;base64,AA==',note:'Bill gốc'},{id:'i2',imageData:'data:image/png;base64,AQ==',note:'Sao kê bổ sung'}]};
 const o={...order,subtotal:5000000,vatRate:.1,vatAmount:500000,total:5500000,discount:0,amountPaid:5500000,balanceDue:0,status:'PAID',receiptsVersion:1,paymentReceipts:[receipt],billing:{email:'invoice@gmail.com',taxId:'0123456789'},taxCode:'0123456789',companyName:'Test Company',paymentReconciled:false};
 await f.api.write(admin,'invoice-accounting-roundtrip',[change('customers',customer),change('orders',o),change('expenses',{id:'expense-test',date:'2026-10-03',month:'2026-10',title:'Chi phí thử',amount:100000,category:'Marketing'}),change('courseConfigs',{id:'cfg-test',courseKey:'TEST',trainerIds:[],leaderIds:[],rateSale:15,rateLeader:5,rateTrainer:15,rateCompany:65}),change('brokerageMetrics',{id:'metric-test',memberId:'sale',leaderId:'lead',teamId:'T',period:'2026-10',basicLots:2,microLots:0,nanoLots:0,lotCommissionRate:10000,indicatorCommissionRate:0,courseCommissionRate:.1,vatRate:.1})]);
 const restored=(await f.api.read(admin)).state,saved=restored.orders.find(r=>r.id===o.id);assert.equal(saved.billing.email,'invoice@gmail.com');assert.equal(saved.paymentReceipts[0].images[1].note,'Sao kê bổ sung');assert.equal(p.paid(saved),5500000);assert.equal(p.events(saved)[0].netAmount,5000000);assert.equal(restored.expenses[0].amount,100000);assert.equal(restored.courseConfigs[0].rateSale,15);assert.equal(restored.brokerageMetrics[0].basicLots,2);
 const projection=JSON.parse(f.db.orders.find(r=>r.id===o.id).items_json);assert.equal(projection.billing.email,'invoice@gmail.com');assert.equal(projection.paymentReceipts[0].images.length,2);
});

test('Course configuration API preserves individual commission rates through edits',async()=>{const c=referenceBridge(),api=c.window.crmApi;await api.saveCourseConfig({courseKey:'p1',trainerIds:['trainer'],leaderIds:['lead'],trainerRates:{trainer:12},leaderRates:{lead:4},saleRates:{sale:18}});let saved=vm.runInContext('state.courseConfigs.find(c=>c.courseKey==="p1")',c);assert.equal(saved.trainerRates.trainer,12);assert.equal(saved.saleRates.sale,18);await api.saveCourseConfig({courseKey:'p1',rateSale:14});saved=vm.runInContext('state.courseConfigs.find(c=>c.courseKey==="p1")',c);assert.equal(saved.saleRates.sale,18);await assert.rejects(()=>api.saveCourseConfig({courseKey:'p1',saleRates:{sale:101}}),/Tỷ lệ/);});

test('Create and collect support many bill images; deletion preserves money and can be replenished',async()=>{const c=referenceBridge(),api=c.window.crmApi;vm.runInContext(`state.members=[{id:'sale',role:'SALE',active:true,leaderId:'lead',teamId:'T'}];state.products=[{id:'p',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];`,c);const images=[{id:'i1',imageData:'data:image/png;base64,AA==',note:'Bill 1'},{id:'i2',imageData:'data:image/png;base64,AQ==',note:'Bill 2'}];const created=await api.createOrder({source:'accounting-iframe',customerName:'Test',phone:'0901234567',saleId:'sale',productId:'p',total:5500000,amountPaid:500000,images});assert.equal(created.order.paymentReceipts[0].images.length,2);const full=await api.updateOrderAccounting(created.id,{action:'COLLECT',amount:5000000,confirmed:true,images});assert.equal(full.order.paymentReceipts[1].images.length,2);const receiptId=full.order.paymentReceipts[1].id;const removed=await api.updateOrderAccounting(created.id,{action:'SAVE_RECEIPT_IMAGES',receiptId,images:[]});assert.equal(removed.order.amountPaid,5500000);assert.equal(require('./order-payments.js').images(removed.order.paymentReceipts[1]).length,0);assert.equal(removed.order.paymentReceipts[1].imageRevisions[0].images.length,2);await assert.rejects(()=>api.updateOrderAccounting(created.id,{action:'RECONCILE',confirmed:true}),/bổ sung ảnh bill/);const restored=await api.updateOrderAccounting(created.id,{action:'SAVE_RECEIPT_IMAGES',receiptId,images});assert.equal(restored.order.paymentReceipts[1].images.length,2);assert.equal(restored.order.amountPaid,5500000);});

test('Accountant reads and writes the four accounting collections without changing users or private settings',async()=>{
 const f=fixture(),actor={id:'accountant',role:'ACCOUNTING'};
 await f.api.write(admin,'acct-seed',[change('customers',customer),change('orders',order),{key:'settings',id:'$',base:null,value:{dataBotToken:'secret',assignmentMode:'MANUAL',accountingLotConfig:{rateApex:90000}}}]);
 let r=await f.api.read(actor);assert.equal(r.state.settings.dataBotToken,undefined);assert.equal(r.state.settings.assignmentMode,undefined);assert.equal(r.state.settings.accountingLotConfig.rateApex,90000);
 const values=[change('expenses',{id:'acct-exp',date:'2026-10-03',title:'Office',category:'Admin',amount:100000}),change('courseConfigs',{id:'acct-course',courseKey:'p1',rateSale:15,rateLeader:5,rateTrainer:15,rateCompany:65,trainerIds:[],leaderIds:[]}),change('brokerageMetrics',{id:'acct-lots',memberId:'sale',leaderId:'lead',teamId:'T',period:'2026-10',basicLots:3,microLots:0,nanoLots:0,lotCommissionRate:10000,indicatorCommissionRate:0,courseCommissionRate:0,vatRate:.1}),{key:'settings',id:'$',base:r.versions['settings/$'],value:{...r.state.settings,accountingLotConfig:{rateApex:95000}}}];
 await f.api.write(actor,'acct-save',values);r=await f.api.read(actor);assert.equal(r.state.expenses[0].amount,100000);assert.equal(r.state.courseConfigs[0].rateSale,15);assert.equal(r.state.brokerageMetrics[0].basicLots,3);assert.equal(r.state.settings.accountingLotConfig.rateApex,95000);
 const adminRead=await f.api.read(admin);assert.equal(adminRead.state.settings.dataBotToken,'secret');assert.equal(adminRead.state.settings.assignmentMode,'MANUAL');
 await assert.rejects(()=>f.api.write(actor,'acct-escalate',[{key:'settings',id:'$',base:r.versions['settings/$'],value:{...r.state.settings,dataBotToken:'tamper'}}]),e=>e.status===403);
 await f.api.write(actor,'acct-delete',[{key:'expenses',id:'acct-exp',base:r.versions['expenses/acct-exp'],value:null}]);assert.equal((await f.api.read(actor)).state.expenses.length,0);assert.equal(f.db.history.at(-1).changes_json[0].before.amount,100000);
});
test('Accounting runtime opens accounting and notifications and can manage expense, course and lot configuration',async()=>{const c=referenceBridge(),api=c.window.crmApi;vm.runInContext(`currentAccount={id:'accountant',name:'Kế toán',role:'ACCOUNTING',scope:'ALL'};state.members=[{id:'sale',name:'Sale',role:'SALE',active:true}];`,c);assert.deepEqual(Array.from(vm.runInContext('allowedViews()',c)),['accounting','notifications','profile']);const expense=await api.saveExpense({date:'2026-10-03',title:'Office',amount:1000});await api.saveCourseConfig({courseKey:'p1'});await api.saveBrokerageMetric({memberId:'sale',period:'2026-10',basicLots:2});await api.settings({accountingLotConfig:{rateApex:90000}});assert.equal(vm.runInContext('state.expenses.length',c),1);assert.equal(vm.runInContext('state.courseConfigs.length',c),1);assert.equal(vm.runInContext('state.brokerageMetrics[0].basicLots',c),2);await api.removeExpense(expense.id);assert.equal(vm.runInContext('state.expenses.length',c),0);await assert.rejects(()=>api.settings({dataBotToken:'tamper'}),/Kế toán/);await assert.rejects(()=>api.saveMember(null,{}),/quyền/);});
test('Image deletion commits to SQL projection and rereads without altering receipts or original images',async()=>{const f=fixture(),actor={id:'accountant',role:'ACCOUNTING'},payments=require('./order-payments.js');f.db.users.push({id:'sale',name:'Sale',role:'SALE',leader_id:'lead',team_id:'T',active:1});const o={...order,subtotal:5000000,total:5500000,vatAmount:500000,discount:0,amountPaid:500000,depositAmount:500000,balanceDue:5000000,status:'DEPOSIT',receiptsVersion:1,paymentReceipts:[{id:'r',kind:'DEPOSIT',amount:500000,at:'2026-10-03T10:00:00Z',createdBy:'admin',billImage:'data:image/png;base64,AA=='}]};await f.api.write(admin,'bill-seed',[change('customers',customer),change('orders',o)]);let r=await f.api.read(actor);const next=structuredClone(r.state.orders[0]),receipt=next.paymentReceipts[0];const beforeImages=payments.images(receipt);receipt.images=[];receipt.imageRevisions=[{id:'rev',by:actor.id,at:'2026-10-03T11:00:00Z',images:beforeImages}];await f.api.write(actor,'bill-delete',[change('orders',next,r.versions['orders/o1'])]);r=await f.api.read(actor);assert.equal(payments.images(r.state.orders[0].paymentReceipts[0]).length,0);assert.equal(r.state.orders[0].amountPaid,500000);const projection=JSON.parse(f.db.orders[0].items_json);assert.equal(projection.paymentReceipts[0].images.length,0);assert.equal(projection.paymentReceipts[0].imageRevisions[0].images[0].imageData,'data:image/png;base64,AA==');});
test('Retry after server update clears old rejection and preserves pending bill edit exactly once',async()=>{const c=referenceBridge(),api=c.window.crmApi;vm.runInContext(`let tries=0;flushServerPersistence=async()=>{tries++;if(tries===2){serverConflict=true;serverSaveError='Máy chủ từ chối ảnh bill';return false;}return true;};resolveServerConflict=async()=>{serverConflict=false;return true;};`,c);await assert.rejects(()=>api.saveExpense({date:'2026-10-03',title:'Retry',amount:1000}),/Máy chủ từ chối ảnh bill/);await api.saveExpense({date:'2026-10-03',title:'Retry',amount:1000});assert.equal(vm.runInContext('state.expenses.length',c),1);assert.equal(vm.runInContext('serverConflict',c),false);});

test('Editing expense keeps original author/date and updates report month',async()=>{const c=referenceBridge(),api=c.window.crmApi;vm.runInContext(`state.expenses=[{id:'exp',date:'2026-09-01',month:'2026-09',title:'Old',amount:1000,createdBy:'original-user',createdAt:'2026-09-01T01:00:00Z'}];currentAccount={id:'accountant',role:'ACCOUNTING',scope:'ALL'};`,c);await api.saveExpense({id:'exp',date:'2026-10-03',title:'Updated',amount:2000});const result=vm.runInContext('state.expenses[0]',c);assert.equal(result.createdBy,'original-user');assert.equal(result.createdAt,'2026-09-01T01:00:00Z');assert.equal(result.month,'2026-10');});
test('Image edits never truncate a valid image larger than one megabyte',async()=>{const c=referenceBridge(),api=c.window.crmApi;vm.runInContext(`state.orders=[{id:'o',status:'DEPOSIT',total:5500000,amountPaid:500000,balanceDue:5000000,receiptsVersion:1,paymentReceipts:[{id:'r',amount:500000,kind:'DEPOSIT',at:'2026-10-03T10:00:00Z',billImage:'data:image/png;base64,AA=='}]}];`,c);const imageData='data:image/png;base64,'+'A'.repeat(1100000);const result=await api.updateOrderAccounting('o',{action:'SAVE_RECEIPT_IMAGES',receiptId:'r',images:[{id:'big',imageData,note:'Original image'}]});assert.equal(result.order.paymentReceipts[0].images[0].imageData,imageData);assert.equal(result.order.paymentReceipts[0].imageRevisions[0].images[0].imageData,'data:image/png;base64,AA==');});

for(const actorRole of ['ADMIN','ACCOUNTING','MANAGER','LEADER','SALE'])for(const ownerRole of ['MANAGER','LEADER','SALE'])test(actorRole+' creates order for '+ownerRole+' and SQL roundtrip preserves attribution',async()=>{
 const f=fixture(),c=referenceBridge();
 const members=[{id:'manager-owner',name:'Manager owner',role:'MANAGER',active:true,teamId:''},{id:'leader-owner',name:'Leader owner',role:'LEADER',active:true,managerId:'manager-owner',teamId:'T2'},{id:'sale-owner',name:'Sale owner',role:'SALE',active:true,leaderId:'leader-owner',teamId:'T2'}, {id:'inactive',name:'Inactive',role:'SALE',active:false}];
 await f.api.write(admin,'seed-owners',members.map(m=>change('members',m)));
 const actor={id:'creator',role:actorRole,actualRole:actorRole,scope:actorRole==='SALE'?'OWN':'ALL',teamId:'other',leaderId:'other'},owner=members.find(m=>m.role===ownerRole);
 const snapshot=await f.api.read(actor);
 assert.equal(snapshot.state.orderAssignees.length,3);
 assert.ok(snapshot.state.orderAssignees.every(m=>!Object.hasOwn(m,'email')&&!Object.hasOwn(m,'phone')));
 c.seed={actor,members,directory:snapshot.state.orderAssignees};
 vm.runInContext("currentAccount=seed.actor;state.members=[];state.orderAssignees=seed.directory;state.products=[{id:'p1',name:'Product',price:5000000,active:true,type:'SALE'}];state.customers=[];",c);
 const result=await c.window.crmApi.createOrder({source:'accounting-iframe',customerName:'Test',phone:'0901234567',saleId:owner.id,productId:'p1',total:5500000,amountPaid:500000,billImage:'data:image/png;base64,AA=='});
 assert.equal(result.order.saleId,owner.id);assert.equal(result.customer.saleId,owner.id);assert.equal(result.order.managerId,'manager-owner');
 assert.equal(result.order.leaderId,ownerRole==='MANAGER'?null:'leader-owner');
 await f.api.write(actor,'create-assignee-order',[change('customers',structuredClone(result.customer)),change('orders',structuredClone(result.order))]);
 const read=(await f.api.read(admin)).state,restored=read.orders.find(o=>o.id===result.id);
 assert.equal(restored.saleId,owner.id);assert.equal(restored.total,5500000);assert.equal(restored.amountPaid,500000);assert.equal(restored.paymentReceipts[0].images.length,1);
 assert.equal(f.db.orders.find(o=>o.id===result.id).sale_id,owner.id);
 assert.equal(JSON.parse(f.db.orders.find(o=>o.id===result.id).items_json).managerId,'manager-owner');
 assert.equal(require('./order-payments.js').events(restored).reduce((sum,e)=>sum+e.amount,0),500000);
 if(actorRole==='SALE'){
  const ownRead=await f.api.read(actor);assert.equal(ownRead.state.orders.length,0);
  await assert.rejects(()=>f.api.write(actor,'foreign-edit',[change('orders',{...restored,saleNote:'forged edit'},f.api.revision(restored))]),/phạm vi/);
 }
});
test('Một SĐT có nhiều đơn, kể cả khi khách cũ thuộc Sale khác và bị ẩn khỏi snapshot',async()=>{
 const f=fixture(),actor={id:'sale2',role:'SALE',leaderId:'lead',teamId:'T'};
 await f.api.write(admin,'owners',[change('members',{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true}),change('members',{id:'sale1',name:'Sale 1',role:'SALE',leaderId:'lead',teamId:'T',active:true}),change('members',{id:'sale2',name:'Sale 2',role:'SALE',leaderId:'lead',teamId:'T',active:true})]);
 const previous={...customer,id:'existing',saleId:'sale1',name:'Khách của Sale khác'};
 await f.api.write(admin,'existing',[change('customers',previous)]);
 assert.equal((await f.api.read(actor)).state.customers.length,0);
 const cust={id:'created',name:'Khách mua hàng',phone:'+84 912345678',saleId:'sale2',leaderId:'lead',teamId:'T',createdVia:'ORDER',createdBy:actor.id};
 await assert.rejects(()=>f.api.write(actor,'no-order',[change('customers',cust)]),/cùng đơn/);
 const o={...order,id:'new-order',code:'NVT-NEW',customerId:cust.id,saleId:'sale2',leaderId:'lead',managerId:null,teamId:'T',createdBy:actor.id,discount:0,subtotal:5000000,vatRate:.1,vatAmount:500000,total:5500000,amountPaid:500000,balanceDue:5000000,status:'DEPOSIT',paymentReference:'Test',receiptsVersion:1,paymentReceipts:[{id:'r1',amount:500000,kind:'DEPOSIT',at:'2026-10-04T00:00:00Z',createdBy:actor.id,billImage:'data:image/png;base64,AA=='}]};
 await assert.rejects(()=>f.api.write(actor,'no-bill',[change('customers',cust),change('orders',{...o,paymentReceipts:[]})]),/Lịch sử thanh toán/);
 assert.equal(f.db.customers.length,1);assert.equal(f.db.orders.length,0);
 const saved=await f.api.write(actor,'duplicate-phone',[change('customers',cust),change('orders',o)]);
 assert.equal(saved.ok,true);assert.equal(f.db.customers.length,2);assert.equal(f.db.orders.length,1);
 assert.equal((await f.api.read(admin)).state.customers.find(c=>c.id===previous.id).saleId,'sale1');
 const again={...o,id:'second-order',code:'NVT-SECOND',paymentReceipts:[{...o.paymentReceipts[0],id:'r2'}]};
 await f.api.write(actor,'same-customer-second-order',[change('orders',again)]);
 const replay=await f.api.write(actor,'same-customer-second-order',[change('orders',again)]);
 assert.equal(replay.replayed,true);
 const visible=(await f.api.read(actor)).state;
 assert.equal(visible.customers.length,1);assert.equal(visible.customers[0].id,cust.id);
 assert.equal(visible.orders.length,2);assert.equal(new Set(visible.orders.map(row=>row.customerId)).size,1);
 assert.equal(f.db.customers.length,2);assert.equal(f.db.orders.length,2);
});
test('Tạo đơn trùng SĐT vượt 409 cũ, mất phản hồi SQL thì retry không tạo bản sao và báo thay đổi form',async()=>{
 const f=fixture(),actor={id:'sale2',role:'SALE',teamId:'T',leaderId:'lead'};
 await f.api.write(admin,'retry-owners',[change('members',{id:'lead',name:'Leader',role:'LEADER',teamId:'T',active:true}),change('members',{id:'sale1',name:'Sale 1',role:'SALE',leaderId:'lead',teamId:'T',active:true}),change('members',{id:'sale2',name:'Sale 2',role:'SALE',leaderId:'lead',teamId:'T',active:true})]);
 await f.api.write(admin,'retry-existing',[change('customers',{...customer,id:'other-owner',saleId:'sale1'})]);
 const c=frontend();vm.runInContext(fs.readFileSync('crm-runtime-api.js','utf8'),c);
 c.seed={actor,snapshot:await f.api.read(actor,{passive:true})};
 vm.runInContext(`currentAccount=hydrateSessionAccount(seed.actor);serverSyncToken='token';applyServerSnapshot(seed.snapshot);`,c);
 const posts=[];let conflict=true,loseAck=true;
 c.fetch=async (url,options)=>{
  if(options?.method!=='POST')return {ok:true,status:200,json:async()=>f.api.read(actor,{passive:true})};
  const body=JSON.parse(options.body);posts.push(body);
  if(conflict){conflict=false;return {ok:false,status:409,json:async()=>({error:'Phiên cũ đang xung đột'})};}
  try{
   const saved=await f.api.write(actor,body.requestId,body.changes,{skipAutomatic:body.skipAutomatic,fastNote:body.fastNote});
   if(loseAck){loseAck=false;throw Error('Mất phản hồi sau khi lưu đơn');}
   return {ok:true,status:200,json:async()=>saved};
  }catch(err){if(err.status)return {ok:false,status:err.status,json:async()=>({error:err.message})};throw err;}
 };
 const input={source:'accounting-iframe',customerName:'Khách mua lại',phone:'0912345678',saleId:'sale2',productId:'p1',total:5500000,amountPaid:500000,billImage:'data:image/png;base64,AA=='};
 await assert.rejects(()=>c.window.crmApi.createOrder(input),/Mất phản hồi/);
 assert.equal(posts.length,2);assert.equal(f.db.orders.length,1);assert.equal(f.db.customers.length,2);
 assert.equal(vm.runInContext('serverPendingRequest.requestId',c),posts[1].requestId);
 const recovered=await c.window.crmApi.createOrder({...input,amountPaid:1000000});
 assert.equal(recovered.recoveredWithDifferentInput,true);
 assert.equal(recovered.order.amountPaid,500000);
 assert.equal(posts[2].requestId,posts[1].requestId);
 assert.equal(f.db.orders.length,1);assert.equal(f.db.customers.length,2);
 assert.equal(vm.runInContext('serverSaveError',c),'');assert.equal(vm.runInContext('hasServerChanges()',c),false);
 const next=await c.window.crmApi.createOrder({...input,amountPaid:1000000});
 assert.notEqual(next.id,recovered.id);assert.equal(next.order.amountPaid,1000000);
 assert.equal(f.db.orders.length,2);assert.equal(f.db.customers.length,2);
});
test('Course trainer configuration survives SQL roundtrip for Admin and Accounting, without changing receipts',async()=>{
 const f=fixture();const c=referenceBridge();const api=c.window.crmApi;
 await api.saveCourseConfig({courseKey:'K03',trainerIds:['trainer'],trainerRates:{trainer:12},leaderIds:[],rateSale:15,rateLeader:5,rateTrainer:15,rateCompany:65});
 const config=JSON.parse(vm.runInContext('JSON.stringify(state.courseConfigs[0])',c));
 await f.api.write(admin,'course-trainer-create',[change('courseConfigs',config)]);
 const accounting={id:'accountant',role:'ACCOUNTING'};let r=await f.api.read(accounting);let saved=r.state.courseConfigs.find(x=>x.courseKey==='K03');
 assert.equal(saved.trainerIds[0],'trainer');assert.equal(saved.trainerRates.trainer,12);assert.equal(saved.leaderIds.length,0);
 await f.api.write(accounting,'course-trainer-edit',[change('courseConfigs',{...saved,trainerIds:['trainer2'],trainerRates:{trainer2:0}},r.versions['courseConfigs/'+saved.id])]);
 r=await f.api.read(admin);saved=r.state.courseConfigs.find(x=>x.courseKey==='K03');assert.equal(saved.trainerIds[0],'trainer2');assert.equal(saved.trainerRates.trainer2,0);
 assert.equal(r.state.orders.length,0);assert.ok(f.events.includes('commit'));
 f.fail();await assert.rejects(f.api.write(accounting,'course-trainer-failure',[change('courseConfigs',{...saved,trainerIds:[]},r.versions['courseConfigs/'+saved.id])]),/failure/);
 assert.equal((await f.api.read(admin)).state.courseConfigs[0].trainerIds[0],'trainer2');assert.ok(f.events.includes('rollback'));
});

test('Product supports multiple cohort selections and SQL reload retains every selection',async()=>{
 const c=referenceBridge();const api=c.window.crmApi;
 const result=await api.saveProduct(null,{name:'Multi cohort course',sku:'MULTI',kind:'COURSE',type:'SALE',category:'Khóa học',price:1000000,vatRate:10,courseKeys:['K01','K03','K01']});
 const product=JSON.parse(vm.runInContext('JSON.stringify(state.products.find(p=>p.sku==="MULTI"))',c));assert.deepEqual(product.courseKeys,['K01','K03']);assert.equal(product.courseKey,'');
 const f=fixture();await f.api.write(admin,'multi-cohort-product',[change('products',product)]);assert.deepEqual(Array.from((await f.api.read(admin)).state.products.find(p=>p.id===product.id).courseKeys),['K01','K03']);
 await assert.rejects(()=>api.saveProduct(null,{name:'Bad',kind:'COURSE',type:'SALE',category:'Khóa học',price:1,courseKeys:['K01',{}]}),/khóa/i);
});
test('Course trainer configurations persist separately by product plus cohort for Admin and Accounting',async()=>{
 const c=referenceBridge();const api=c.window.crmApi;vm.runInContext('state.products=[{id:"p1",name:"One",kind:"COURSE"},{id:"p2",name:"Two",kind:"COURSE"}]',c);
 await api.saveCourseConfig({productId:'p1',courseKey:'K03',trainerIds:['t1'],trainerRates:{t1:10}});
 await api.saveCourseConfig({productId:'p2',courseKey:'K03',trainerIds:['t2'],trainerRates:{t2:20}});
 await api.saveCourseConfig({productId:'p1',courseKey:'K01',trainerIds:['t3'],trainerRates:{t3:15}});
 let rows=JSON.parse(vm.runInContext('JSON.stringify(state.courseConfigs)',c));assert.equal(rows.length,3);
 const f=fixture();await f.api.write(admin,'product-cohort-configs',rows.map(row=>change('courseConfigs',row)));
 const actor={id:'accountant',role:'ACCOUNTING'};let restored=await f.api.read(actor);assert.equal(restored.state.courseConfigs.length,3);
 const chosen=restored.state.courseConfigs.find(x=>x.productId==='p1'&&x.courseKey==='K03');await f.api.write(actor,'edit-one-cohort',[change('courseConfigs',{...chosen,trainerIds:['replacement'],trainerRates:{replacement:12}},restored.versions['courseConfigs/'+chosen.id])]);
 restored=await f.api.read(admin);assert.equal(restored.state.courseConfigs.find(x=>x.productId==='p1'&&x.courseKey==='K03').trainerIds[0],'replacement');assert.equal(restored.state.courseConfigs.find(x=>x.productId==='p2'&&x.courseKey==='K03').trainerIds[0],'t2');assert.equal(restored.state.courseConfigs.find(x=>x.productId==='p1'&&x.courseKey==='K01').trainerIds[0],'t3');
 await assert.rejects(()=>api.saveCourseConfig({productId:'missing',courseKey:'K03'}),/Sản phẩm/);
});

test('Admin backfill edits one daily record and validates input',async()=>{
 const c=referenceBridge();vm.runInContext("state.members=[{id:'staff',name:'Staff',role:'ACCOUNTING'}];state.attendance=[];state.settings.attendanceDeadline='09:00';",c);
 await c.window.crmApi.saveAttendance({accountId:'staff',date:'2026-01-02',time:'09:15',note:'Makeup'});
 await c.window.crmApi.saveAttendance({accountId:'staff',date:'2026-01-02',time:'08:45',note:'Correct time'});
 assert.equal(vm.runInContext('state.attendance.length',c),1);assert.equal(vm.runInContext('state.attendance[0].lateMinutes',c),0);
 assert.equal(vm.runInContext('state.attendance[0].editedById',c),'admin');assert.equal(vm.runInContext('state.attendance[0].status',c),'ONTIME');
 for(const input of [{date:'2026-02-30',time:'09:00'},{date:'2099-01-01',time:'09:00'},{date:'2026-01-02',time:'25:00'}])await assert.rejects(c.window.crmApi.saveAttendance({accountId:'staff',note:'Reason',...input}));
 vm.runInContext("currentAccount.role='SALE'",c);await assert.rejects(c.window.crmApi.saveAttendance({accountId:'staff',date:'2026-01-02',time:'09:00',note:'Reason'}));
});
test('SQL startup repairs a missing required customerLevel definition',()=>{
 const source=fs.readFileSync('crm-data.cjs','utf8');
 assert.match(source,/collection='customFieldDefinitions'.*id='customerLevel'/s);
 assert.match(source,/requiredLevel\s*=\s*defaults\.customFieldDefinitions\?\.find\(field=>field\.id==='customerLevel'\)/);
 assert.match(fs.readFileSync('crm-defaults.json','utf8'),/\"id\": \"customerLevel\"/);
});
test('Admin attendance SQL roundtrip keeps correction over legacy Telegram',async()=>{
 const f=fixture();f.db.users.push({id:'sale',name:'Sale',role:'SALE',active:1});
 const record={id:'ATT-backfill',accountId:'sale',name:'Sale',teamId:'',ip:'Admin ghi bù',ipValid:true,date:'2026-01-02',at:'2026-01-02 09:15:00',late:true,lateMinutes:15,note:'Makeup',editedById:'admin',editedBy:'Admin'};
 const first=await f.api.write(admin,'admin-backfill',[change('attendance',record)]);
 const updated={...first.state.attendance[0],at:'2026-01-02 08:30:00',late:false,lateMinutes:0,note:'Correct time'};
 await f.api.write(admin,'admin-edit',[change('attendance',updated,first.versions['attendance/'+record.id])]);
 f.db.staffAttendance.push({id:'legacy-different-id',user_id:'sale',attendance_date:record.date,check_in_time:'2026-01-02 10:00:00',status:'LATE'});
 const read=await f.api.read(admin);assert.equal(read.state.attendance.length,1);assert.equal(read.state.attendance[0].at,updated.at);assert.equal(read.state.attendance[0].note,'Correct time');
 await assert.rejects(f.api.write(sale,'sale-edit',[change('attendance',{...read.state.attendance[0],note:'Self edit'},read.versions['attendance/'+record.id])]),e=>e.status===403);
 await assert.rejects(f.api.write(admin,'duplicate-admin',[change('attendance',{...updated,id:'duplicate'})]),e=>e.status===409);
});
test('Backfill save failure retains draft and retry does not duplicate',async()=>{
 const c=referenceBridge();vm.runInContext("state.members=[{id:'staff',name:'Sale',role:'SALE'}];state.attendance=[];let calls=0;flushServerPersistence=async()=>++calls!==2;",c);
 const input={accountId:'staff',date:'2026-01-03',time:'08:30',note:'Makeup'};
 await assert.rejects(c.window.crmApi.saveAttendance(input));assert.equal(vm.runInContext('state.attendance.length',c),1);
 await c.window.crmApi.saveAttendance(input);assert.equal(vm.runInContext('state.attendance.length',c),1);
});


test('Notification read and per-viewer delete persist for Sale, Manager and Accounting without changing anyone else',async()=>{
 const f=fixture(),manager={id:'manager',role:'MANAGER'},accounting={id:'accountant',role:'ACCOUNTING'};
 await f.api.write(admin,'notices-seed',[change('members',{id:'manager',role:'MANAGER',active:true,name:'Manager'}),change('members',{id:'lead',role:'LEADER',managerId:'manager',active:true,teamId:'T',name:'Leader'}),change('members',{...sale,managerId:'manager',active:true,name:'Sale'}),change('notifications',{id:'notice-own',kind:'DATA_ARRIVAL',role:'OWN',saleId:'sale',leaderId:'lead',teamId:'T',readBy:['lead'],at:'2026-10-07 08:00'}),change('notifications',{id:'notice-review',kind:'PAYMENT_REVIEW',role:'ACCOUNTING',readBy:[],at:'2026-10-07 09:00'})]);
 for(const [actor,id] of [[sale,'notice-own'],[manager,'notice-own'],[accounting,'notice-review']]){
  let snapshot=await f.api.read(actor),notice=snapshot.state.notifications.find(n=>n.id===id);assert.ok(notice);
  await f.api.write(actor,'notice-read-'+actor.id,[change('notifications',{...notice,readBy:[...notice.readBy,actor.id]},snapshot.versions['notifications/'+id])]);
  snapshot=await f.api.read(actor);notice=snapshot.state.notifications.find(n=>n.id===id);assert.ok(notice.readBy.includes(actor.id));
  await f.api.write(actor,'notice-delete-'+actor.id,[change('notifications',{...notice,deletedBy:[...(notice.deletedBy||[]),actor.id]},snapshot.versions['notifications/'+id])]);
  assert.equal((await f.api.read(actor)).state.notifications.some(n=>n.id===id),false);
 }
 const visible=(await f.api.read(admin)).state.notifications.find(n=>n.id==='notice-own');assert.ok(visible);assert.ok(visible.readBy.includes('lead'));assert.ok(visible.deletedBy.includes('sale'));assert.ok(visible.deletedBy.includes('manager'));
 await assert.rejects(()=>f.api.write({...sale,id:'outsider'},'notice-outside',[change('notifications',{...visible,readBy:[...visible.readBy,'outsider']},f.api.revision(visible))]),e=>e.status===403);
 const snapshot=await f.api.read(admin),notice=snapshot.state.notifications.find(n=>n.id==='notice-review');
 await assert.rejects(()=>f.api.write({id:'other-accountant',role:'ACCOUNTING'},'notice-forge',[change('notifications',{...notice,deletedBy:['sale']},snapshot.versions['notifications/'+notice.id])]),e=>e.status===403);
});
test('Read-all and delete APIs await persistence and retry the same notification after a lost acknowledgement',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.notifications=[{id:'first',role:'ALL',title:'Data mới về',readBy:[]},{id:'second',role:'ALL',title:'Data mới về',readBy:['someone']}];`,c);
 await api.readNotice('first');await api.readNotifications();assert.equal(vm.runInContext('state.notifications.every(n=>n.readBy.includes("admin"))',c),true);
 vm.runInContext('let noticeFlushes=0;flushServerPersistence=async()=>++noticeFlushes!==2;',c);
 await assert.rejects(()=>api.deleteNotice('first'),/Chưa lưu/);await api.deleteNotice('first');
 assert.equal(vm.runInContext('state.notifications[0].deletedBy.length',c),1);assert.equal(vm.runInContext('visibleNotifications().length',c),1);
 await assert.rejects(()=>api.deleteNotice('missing'),/Không tìm thấy/);
});
test('Payment notices are generated inside the SQL transaction for deposits, new receipts and reconciliation exactly once',async()=>{
 const f=fixture(),paidOrder={...order,rentalEndsAt:null,status:'DEPOSIT',subtotal:5000000,vatAmount:500000,total:5500000,discount:0,amountPaid:500000,balanceDue:5000000,paidAt:null,receiptsVersion:1,paymentReceipts:[{id:'r1',kind:'DEPOSIT',amount:500000,at:'2026-10-07 08:00',createdBy:'admin',billImage:'data:image/png;base64,AA=='}],paymentReconciled:false};
 let result=await f.api.write(admin,'payment-notice-create',[change('customers',customer),change('orders',paidOrder)]);
 assert.equal(result.state.notifications.filter(n=>n.kind==='PAYMENT_REVIEW').length,1);
 result=await f.api.write(admin,'payment-notice-full',[change('orders',{...result.state.orders[0],status:'PAID',amountPaid:5500000,balanceDue:0,paidAt:'2026-10-07 09:00',paymentReceipts:[...paidOrder.paymentReceipts,{id:'r2',kind:'FULL',amount:5000000,at:'2026-10-07 09:00',createdBy:'admin',billImage:'data:image/png;base64,AA=='}]},result.versions['orders/o1'])]);
 assert.equal(result.state.notifications.filter(n=>n.kind==='PAYMENT_REVIEW').length,2);
 const accountant={id:'accountant',role:'ACCOUNTING'};
 result=await f.api.write(accountant,'payment-notice-confirm',[change('orders',{...result.state.orders[0],paymentReconciled:true,paymentReconciledBy:accountant.id,paymentReconciledAt:'2026-10-07 10:00'},result.versions['orders/o1'])]);
 await f.api.write(accountant,'payment-notice-confirm',[]);
 const notices=(await f.api.read(admin)).state.notifications;assert.equal(notices.filter(n=>n.kind==='PAYMENT_CONFIRMED').length,1);
 assert.equal(f.db.history.find(r=>r.request_id==='payment-notice-confirm').changes_json.some(c=>c.key==='notifications'),true);
 assert.equal((await f.api.read({id:'other',role:'SALE'})).state.notifications.length,0);
 assert.equal((await f.api.read(sale)).state.notifications.some(n=>n.kind==='PAYMENT_CONFIRMED'),true);
});
test('24-hour data expiry emits one notice, while accepted and manually revoked offers do not emit timeout notices',async()=>{
 const f=fixture();await f.api.write(admin,'notice-expiry-seed',[change('customers',{...customer,saleId:null}),...['late','accepted','revoked'].map((id,index)=>change('dataOffers',{id,customerId:customer.id,saleId:sale.id,leaderId:'lead',teamId:'T',status:['PENDING','ACCEPTED','EXPIRED'][index],offeredAt:'2020-01-01 00:00'}))]);
 await f.api.read(admin);const result=await f.api.read(admin),notices=result.state.notifications.filter(n=>n.kind==='DATA_UNRECEIVED_24H');assert.equal(notices.length,1);assert.equal(notices[0].id,'NT-DATA-24H-late');
 assert.equal((await f.api.read(sale)).state.notifications.some(n=>n.id===notices[0].id),true);
});


test('Sale can save with Manager only, preserve assigned customers and later become independent',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;
 vm.runInContext(`state.members=[{id:'m',name:'Manager',role:'MANAGER',active:true},{id:'s',name:'Sale',role:'SALE',teamId:'OWN',managerId:'m',leaderId:null,active:true}];STAFF=state.members;state.customers=[{id:'c',name:'Customer',phone:'0900000011',saleId:'s',managerId:'m',leaderId:null,teamId:'OWN',customFields:{}}];state.tasks=[{id:'task',ownerId:'s',leaderId:null,teamId:'OWN',status:'OPEN'}];render=()=>{};`,c);
 await api.saveMember('s',{name:'Sale edited',role:'SALE',teamId:'OWN',leaderId:'',managerId:'m'});
 assert.equal(vm.runInContext("state.members.find(m=>m.id==='s').managerId",c),'m');
 assert.equal(vm.runInContext("state.members.find(m=>m.id==='s').leaderId",c),'m');
 assert.equal(vm.runInContext("state.customers[0].saleId",c),'s');assert.equal(vm.runInContext("state.customers[0].managerId",c),'m');
 assert.equal(vm.runInContext("state.customers[0].leaderId",c),'m');assert.equal(vm.runInContext("state.tasks[0].leaderId",c),'m');
 await api.saveMember('s',{name:'Sale independent',role:'SALE',teamId:'OWN',leaderId:'',managerId:''});
 assert.equal(vm.runInContext("state.members.find(m=>m.id==='s').leaderId",c),null);assert.equal(vm.runInContext("state.members.find(m=>m.id==='s').managerId",c),null);
 assert.equal(vm.runInContext("state.customers[0].saleId",c),'s');assert.equal(vm.runInContext("state.customers[0].leaderId",c),null);assert.equal(vm.runInContext("state.customers[0].managerId",c),null);
 assert.equal(vm.runInContext("state.tasks[0].leaderId",c),null);
 await assert.rejects(()=>api.saveMember('s',{name:'Sale',role:'SALE',teamId:'OWN',managerId:'unknown'}),/đúng Team/);
});
test('New and pending Sale accounts can be saved without a Manager or Leader',async()=>{
 const c=referenceBridge(),api=c.window.crmApi;vm.runInContext("state.members=[];STAFF=state.members;render=()=>{};state.registeredAccounts=[{id:'pending-alone',name:'Pending',role:'UNASSIGNED'}];",c);
 const created=await api.saveMember(null,{name:'Independent',role:'SALE',teamId:'OWN',leaderId:'',managerId:''});
 assert.ok(created.id);assert.equal(vm.runInContext(`state.members.find(m=>m.id===${JSON.stringify(created.id)}).leaderId`,c),null);
 await api.saveMember('pending-alone',{name:'Pending',role:'SALE',teamId:'OWN2',leaderId:'',managerId:''});
 assert.equal(vm.runInContext("state.members.find(m=>m.id==='pending-alone').leaderId",c),null);assert.equal(vm.runInContext("state.registeredAccounts.length",c),0);
});
