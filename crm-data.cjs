"use strict";
const OrderPayments = require('./order-payments.js');
// Kho dữ liệu nghiệp vụ: một giao dịch cho cả khách/đơn và lịch sử liên quan.
const crypto = require('node:crypto');
const distributionRounds = require('./distribution-rounds.js');
const { pool } = require('./db.js');
const LISTS = ['customers','orders','products','members','registrations','customFieldDefinitions','customerFieldHistory','assignmentHistory','resubmissions','notes','imports','attendance','dataOffers','traffic','tasks','notifications','audit','websites','integrations','webhookPending','brokerageMetrics','feedbacks','processes','expenses','courseConfigs'];
const OBJECTS = ['settings','leaderDistribution','saleDistributionByLeader','productCategories','careGroups'];
const ADMIN_ONLY = new Set(['products','members','registrations','customFieldDefinitions','imports','traffic','websites','integrations','webhookPending','productCategories','leaderDistribution','careGroups','processes','expenses','courseConfigs']);
const SCHEMA = [
 `CREATE TABLE IF NOT EXISTS crm_documents (collection VARCHAR(64) NOT NULL, id VARCHAR(96) NOT NULL, body JSON NOT NULL, deleted TINYINT NOT NULL DEFAULT 0, PRIMARY KEY(collection,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS crm_changes (id BIGINT AUTO_INCREMENT PRIMARY KEY, request_id VARCHAR(96) NOT NULL, actor_id VARCHAR(96) NOT NULL, changes_json JSON NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY(request_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS crm_write_lock (id INT PRIMARY KEY) ENGINE=InnoDB`,
 `INSERT IGNORE INTO crm_write_lock(id) VALUES (1)`
];
let prepared;
function prepare() {
 if (!prepared) prepared = (async()=>{for(const sql of SCHEMA) await pool.query(sql);await ensureRoleColumn();await ensureAccountCodeColumn();await ensureProductVatColumn();await ensureTelegramColumns();await ensureUserActivityTables();await ensureCustomerAppointmentsTable();await seedDefaults();await seedProductCatalog();})().catch(e=>{prepared=null;throw e;});
 return prepared;
}
async function ensureRoleColumn(){
 const [rows]=await pool.query("SELECT COLUMN_TYPE AS role_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='role'");
 const roles=String(rows[0]?.role_type||'');
 if(!['ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER'].every(role=>roles.includes("'"+role+"'")))
  await pool.query("ALTER TABLE users MODIFY role ENUM('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER') NOT NULL DEFAULT 'UNASSIGNED'");
}
async function ensureAccountCodeColumn(){
 const [rows]=await pool.query("SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='account_code'");
 if(!Number(rows[0]?.total))await pool.query('ALTER TABLE users ADD COLUMN account_code VARCHAR(64) NULL UNIQUE AFTER id');
}

async function ensureProductVatColumn(){
 const [rows]=await pool.query("SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products' AND column_name='vat_rate'");
 if(!Number(rows[0]?.total))await pool.query('ALTER TABLE products ADD COLUMN vat_rate DECIMAL(5,4) NOT NULL DEFAULT 0.1000 AFTER rental_months');
}

async function ensureTelegramColumns(){
 const res=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name IN ('telegram_chat_id','telegram_username')");
 const cols=Array.isArray(res?.[0])?res[0]:[];
 const existing=new Set(cols.map(c=>c?.column_name));
 if(!existing.has('telegram_chat_id'))await pool.query('ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(64) NULL AFTER active');
 if(!existing.has('telegram_username'))await pool.query('ALTER TABLE users ADD COLUMN telegram_username VARCHAR(128) NULL AFTER telegram_chat_id');
 await pool.query('CREATE TABLE IF NOT EXISTS telegram_link_tokens (token_hash CHAR(64) PRIMARY KEY, user_id VARCHAR(96) NOT NULL, expires_at DATETIME NOT NULL, consumed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_telegram_link_user (user_id), INDEX idx_telegram_link_expiry (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

async function ensureCustomerAppointmentsTable(){
 await pool.query(`CREATE TABLE IF NOT EXISTS customer_appointments (
  id VARCHAR(96) PRIMARY KEY,
  customer_id VARCHAR(96) NOT NULL,
  sale_id VARCHAR(96) NULL,
  appointment_time DATETIME NOT NULL,
  type VARCHAR(64) NOT NULL DEFAULT 'CONSULTING',
  note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
  reminded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id),
  INDEX idx_sale (sale_id),
  INDEX idx_time_status (appointment_time, status)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function seedProductCatalog(){
 const c=await pool.getConnection();
 try{
  await c.beginTransaction();
  await c.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
  const [marker]=await c.execute("SELECT setting_key FROM system_settings WHERE setting_key='product_catalog_20260914_v1' LIMIT 1");
  if(marker.length){await c.commit();return {applied:false,inserted:0};}
  const catalog=require('./product-catalog.json');
  let inserted=0;
  // Keep ID/SKU comparisons in MySQL so the database collation remains authoritative.
  const [existingProducts]=catalog.length ? await c.execute(
   'SELECT candidate.id FROM ('+catalog.map(()=> 'SELECT ? AS id, ? AS sku').join(' UNION ALL ')+') AS candidate WHERE EXISTS (SELECT 1 FROM products p WHERE p.id=candidate.id OR p.sku=candidate.sku)',
   catalog.flatMap(product=>[product.id,product.sku])
  ) : [[]];
  const existingIds=new Set(existingProducts.map(row=>String(row.id)));
  for(const product of catalog){
   if(existingIds.has(String(product.id)))continue;
   await c.execute('INSERT INTO products(id,sku,name,category,price,type,rental_months,active) VALUES (?,?,?,?,?,?,?,?)',[product.id,product.sku,product.name,product.category,product.price,product.type,product.rentalMonths,product.active===false?0:1]);
   inserted++;
  }
  await c.execute("INSERT INTO system_settings(setting_key,setting_value) VALUES ('product_catalog_20260914_v1','true')");
  await c.commit();return {applied:true,inserted};
 }catch(e){await c.rollback().catch(()=>{});throw e;}finally{c.release();}
}
async function seedDefaults(){
 const c=await pool.getConnection();
 try{
  await c.beginTransaction();await c.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
  const [existing]=await c.query("SELECT setting_key,setting_value FROM system_settings");
  // customerLevel is mandatory. Repair legacy databases where the collection exists but this record is missing.
  const defaults=require('./crm-defaults.json');
  const requiredLevel=defaults.customFieldDefinitions?.find(field=>field.id==='customerLevel');
  if(requiredLevel){
   const [rows]=await c.execute("SELECT deleted FROM crm_documents WHERE collection='customFieldDefinitions' AND id='customerLevel' LIMIT 1");
   if(!rows.length||Number(rows[0].deleted)===1)await c.execute("INSERT INTO crm_documents(collection,id,body,deleted) VALUES ('customFieldDefinitions','customerLevel',?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0",[JSON.stringify(requiredLevel)]);
  }
  if(!existing.some(r=>r.setting_key==='crm_defaults_v1')){
   const [existingCollections]=await c.execute('SELECT DISTINCT collection FROM crm_documents');
   const presentCollections=new Set(existingCollections.map(row=>String(row.collection)));
   for(const [key,value] of Object.entries(defaults)){
    if(presentCollections.has(key))continue;
    const actual=key==='settings'?(parsed(existing.find(r=>r.setting_key==='crm')?.setting_value,value)):value;
    for(const r of LISTS.includes(key)?actual:[actual])await c.execute('INSERT IGNORE INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0)',[key,LISTS.includes(key)?r.id:'$',JSON.stringify(r)]);
    presentCollections.add(key);
   }
   await c.execute("INSERT INTO system_settings(setting_key,setting_value) VALUES ('crm_defaults_v1','true')");
  }
  await c.commit();
 }catch(e){await c.rollback().catch(()=>{});throw e;}finally{c.release();}
}
function error(status,message){throw Object.assign(new Error(message),{status});}
function parsed(value,fallback={}){if(typeof value==='string')return JSON.parse(value);return value??fallback;}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
function revision(value){return value===undefined?null:crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function timestamp(v){return v instanceof Date?v.toISOString().slice(0,19).replace('T',' '):v;}
function userRow(r){return {id:r.id,accountId:r.account_code||'',phone:r.phone,email:r.email,name:r.name,role:r.role,teamId:r.team_id||'',leaderId:r.leader_id||null,telegramChatId:r.telegram_chat_id||null,telegramUsername:r.telegram_username||null,active:!!r.active,createdAt:timestamp(r.created_at)};}
function coreRow(key,r){
 if(key==='customers') {const j=parsed(r.custom_fields_json),meta=j.__crmMeta||((j.webhookSlug||j.webhookEventId)?{webhookSlug:j.webhookSlug,webhookEventId:j.webhookEventId}:{});return {...meta,id:r.id,name:r.name,phone:r.phone,email:r.email||'',source:r.source||'',campaign:r.campaign||'',websiteId:r.website_id||null,status:r.status,saleId:r.sale_id||null,leaderId:r.leader_id||null,teamId:r.team_id||null,note:r.note||'',customFields:j.__crmFields||(j.__crmMeta?{}:Object.fromEntries(Object.entries(j).filter(([key])=>!['webhookSlug','webhookEventId'].includes(key)))),createdAt:timestamp(r.created_at),updatedAt:timestamp(r.updated_at)};}
 if(key==='orders'){const j=parsed(r.items_json,[]);return {discount:0,refund:0,qty:1,unitPrice:Number(r.total_amount),subtotal:Number(r.total_amount),...(Array.isArray(j)?{}:j),id:r.id,code:r.code,customerId:r.customer_id,saleId:r.sale_id||null,leaderId:r.leader_id||null,teamId:r.team_id||null,total:Number(r.total_amount),status:r.status,items:Array.isArray(j)?j:j.items||[],note:r.note||'',createdAt:timestamp(r.created_at),updatedAt:timestamp(r.updated_at)};}
 return {id:r.id,name:r.name,sku:r.sku||'',category:r.category||'',price:Number(r.price),type:r.type,rentalMonths:r.rental_months,vatRate:Number(r.vat_rate ?? 0.1),active:!!r.active,createdAt:timestamp(r.created_at),updatedAt:timestamp(r.updated_at)};
}
async function allData(c, options={}){
 const data=Object.fromEntries([...LISTS,...OBJECTS].map(k=>[k,new Map()]));
 const collections=[...LISTS,...OBJECTS];
 const placeholders=collections.map(()=>'?').join(',');
 // Một kết nối MySQL chỉ chạy lần lượt từng câu. Promise.all làm đồng hồ timeout
 // của mọi câu bắt đầu cùng lúc, nên câu xếp sau bị DB_QUERY_TIMEOUT oan và hủy
 // cả kết nối (lỗi "Chưa tải được dữ liệu máy chủ"). Chạy tuần tự: mỗi câu đủ hạn riêng.
 const docsResult=await c.execute('SELECT * FROM crm_documents WHERE collection IN ('+placeholders+')',collections);
 const customersResult=await c.query('SELECT * FROM customers');
 const ordersResult=await c.query('SELECT * FROM orders');
 const productsResult=await c.query('SELECT * FROM products');
 const usersResult=await c.query('SELECT id,account_code,phone,email,name,role,team_id,leader_id,telegram_chat_id,telegram_username,active,created_at FROM users');
 const settingsResult=await c.query('SELECT setting_key,setting_value FROM system_settings');
 const [docs]=docsResult;
 const deleted=new Set();
 for(const d of docs){if(!data[d.collection])continue;if(d.deleted)deleted.add(`${d.collection}/${d.id}`);else data[d.collection].set(d.id,parsed(d.body));}
 const actualRows={customers:customersResult[0],orders:ordersResult[0],products:productsResult[0]};
 for(const key of ['customers','orders','products']){
  const rows=actualRows[key];
  // Ba bang nay la nguon ton tai that. Neu Admin xoa truc tiep trong MySQL,
  // snapshot cu trong crm_documents khong duoc phep lam ban ghi quay lai giao dien.
  const actualIds=new Set(rows.map(row=>String(row.id)));
  for(const id of data[key].keys())if(!actualIds.has(String(id)))data[key].delete(id);
  for(const row of rows){if(deleted.has(`${key}/${row.id}`))continue;data[key].set(row.id,{...data[key].get(row.id),...coreRow(key,row)});}
 }
 // Gắn nguồn cho dữ liệu webhook cũ bằng slug; chỉ bổ sung trường đang thiếu.
 const websiteBySlug=new Map([...data.websites.values()].filter(website=>website.webhookSlug).map(website=>[String(website.webhookSlug).toUpperCase(),website]));
 for(const [id,customer] of data.customers){
  const website=customer.websiteId?data.websites.get(customer.websiteId):websiteBySlug.get(String(customer.webhookSlug||'').toUpperCase());
  if(!website)continue;
  const sourceUrl=website.sourceUrl||(website.domain?`https://${String(website.domain).replace(/^https?:\/\//,'').replace(/\/+$/,'')}/`:'');
  data.customers.set(id,{...customer,websiteId:customer.websiteId||website.id,landingPageName:customer.landingPageName||website.name||website.domain,landingPageUrl:customer.landingPageUrl||sourceUrl,landingPageDomain:customer.landingPageDomain||website.domain});
 }
 const [users]=usersResult;
 const actualUserIds=new Set(users.map(u=>String(u.id)));
 if(actualUserIds.size>0){for(const id of data.members.keys())if(!actualUserIds.has(String(id)))data.members.delete(id);}
 for(const u of users){
  if(deleted.has(`members/${u.id}`))continue;
  const row=userRow(u);
  data.members.set(u.id,{...data.members.get(u.id),...row,active:row.active,loginEnabled:true,initials:data.members.get(u.id)?.initials||String(u.name).trim().split(/\s+/).slice(-2).map(x=>x[0]).join('').toUpperCase()});
 }
  const [settings]=settingsResult;
  if(!data.settings.has('$')) {const row=settings.find(r=>r.setting_key==='crm');if(row)data.settings.set('$',parsed(row.setting_value));}
  if(options.mirrorAttendance!==false)await mirrorAttendanceRecords(c,data);
  return data;
 }

// Telegram historically wrote to staff_attendance while the CRM snapshot reads
// crm_documents/attendance. Normalize both sources into the same record shape so
// check-ins made in Telegram appear in the web CRM immediately and old records
// remain visible after deployment.
async function mirrorAttendanceRecords(c,data){
 const settings=data.settings.get('$')||{};
 const deadline=String(settings.attendanceDeadline||'09:00');
 const toMinutes=value=>{const [h,m]=String(value||'00:00').split(':').map(Number);return (h||0)*60+(m||0);};
 const normalize=(id,record,member)=>{
  const at=String(record.at||record.checkInAt||record.time||'').replace('T',' ');
  const date=String(record.date||at.slice(0,10)).slice(0,10);
  const time=String(at.slice(11,19)||'00:00:00');
  const late=record.late===true||record.status==='LATE'||toMinutes(time)>toMinutes(deadline);
  return {...record,id,accountId:record.accountId||record.userId||member?.id||'',name:record.name||record.accountName||member?.name||'',teamId:record.teamId||member?.teamId||'',date,at:`${date} ${time}`,ip:record.ip||'Telegram',late,lateMinutes:late&&record.lateMinutes!=null?Number(record.lateMinutes):late?Math.max(0,toMinutes(time)-toMinutes(deadline)):0,ipValid:record.ipValid!==false,note:record.note||'Điểm danh qua Telegram'};
 };
 for(const [id,record] of data.attendance){
  const member=data.members.get(record.accountId||record.userId);
  data.attendance.set(id,normalize(id,record,member));
 }
 let legacy=[];
 try{[legacy]=await c.query('SELECT id,user_id,attendance_date,check_in_time,status FROM staff_attendance');}catch{}
 const changedRecords=new Map();
 for(const row of legacy||[]){
  const rawAt=String(row.check_in_time||'').replace('T',' ');
  const date=String(row.attendance_date||rawAt.slice(0,10)).slice(0,10);
  if(!date||date.length!==10)continue;
  const id=String(row.id||`ATT-${date}-${row.user_id}`),member=data.members.get(String(row.user_id));
  const record=normalize(id,{id,accountId:String(row.user_id),date,at:rawAt||`${date} 00:00:00`,status:row.status,ip:'Telegram',note:'Điểm danh qua Telegram'},member);
  // Preserve canonical CRM records, including Admin corrections to legacy check-ins.
  if([...data.attendance.values()].some(r=>r.accountId===record.accountId&&r.date===date))continue;
  if(canonical(data.attendance.get(id))!==canonical(record))changedRecords.set(id,record);
  data.attendance.set(id,record);
 }
 // Legacy check-ins rarely change; avoid rewriting all history on every active read.
 const records=[...changedRecords.values()];
 for(let offset=0;offset<records.length;offset+=100){
  const batch=records.slice(offset,offset+100);
  await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES '+batch.map(()=>'(?,?,?,0)').join(',')+' ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0',batch.flatMap(record=>['attendance',record.id,JSON.stringify(record)]));
 }
}
// Phạm vi Manager lấy từ bản ghi đã lưu, tuyệt đối không lấy danh sách quyền từ request.
// Trong một lượt snapshot(), các danh sách phạm vi không đổi. Trước đây mỗi khách
// hàng lại quét toàn bộ members/dataOffers (O(khách × thành viên)), làm một lượt
// F5 của Manager/Sale tốn hàng giây CPU và chặn mọi người dùng khác trên cùng Node.
let snapshotMemo=null;
function memoized(data,name,user,build){
 if(!snapshotMemo||snapshotMemo.data!==data)return build();
 const key=name+'\u0000'+user.id;
 if(!snapshotMemo.values.has(key))snapshotMemo.values.set(key,build());
 return snapshotMemo.values.get(key);
}
function managerLeaders(user,data){return memoized(data,'leaders',user,()=>[...data.members.values()].filter(m=>m.active!==false&&m.role==='LEADER'&&m.managerId===user.id));}
function managerSales(user,data){return memoized(data,'sales',user,()=>{const leaders=managerLeaders(user,data),leaderIds=new Set(leaders.map(l=>l.id));return [...data.members.values()].filter(m=>m.active!==false&&m.role==='SALE'&&(m.managerId===user.id||m.leaderId===user.id||leaderIds.has(m.leaderId)));});}
// members là Map theo id; tra trực tiếp thay vì duyệt toàn bộ cho từng bản ghi.
function memberById(data,id){return id==null?null:data.members.get(id)||null;}
function managerOwns(user,row,data){if(!row)return false;const leaders=managerLeaders(user,data),sales=managerSales(user,data);return row.managerId===user.id||row.ownerId===user.id||row.leaderId===user.id||leaders.some(l=>row.leaderId===l.id&&row.teamId===l.teamId)||sales.some(s=>row.saleId===s.id);}
function managerReadable(user,key,r,data){
 const leaders=managerLeaders(user,data),ids=new Set(leaders.map(l=>l.id));
 if(key==='members')return r.id===user.id||ids.has(r.id)||(r.role==='SALE'&&((r.managerId===user.id)||r.leaderId===user.id||ids.has(r.leaderId)&&leaders.some(l=>l.id===r.leaderId&&l.teamId===r.teamId)));
 if(['customers','orders'].includes(key))return managerOwns(user,r,data);
 if(['products','customFieldDefinitions','productCategories','websites','settings','saleDistributionByLeader','careGroups','leaderDistribution'].includes(key))return true;
 const inScope=m=>!!m&&(ids.has(m.id)||m.role==='SALE'&&ids.has(m.leaderId));
 if(key==='attendance')return r.accountId===user.id||inScope(memberById(data,r.accountId));
 if(key==='brokerageMetrics')return r.memberId===user.id||ids.has(r.leaderId);
 if(key==='notifications')return r.role==='ALL'||r.saleId===user.id||managerSales(user,data).some(m=>m.id===r.saleId)||ids.has(r.leaderId)||inScope(memberById(data,r.saleId));
 if(key==='audit')return r.actorId===user.id;
 if(key==='dataOffers')return (ids.has(r.leaderId)||r.leaderId===user.id||managerSales(user,data).some(m=>m.id===r.saleId))&&managerOwns(user,data.customers.get(r.customerId),data);
 return !!r.customerId&&managerOwns(user,data.customers.get(r.customerId),data);
}
function authorizeManager(user,key,old,next,data){
 if(key==='orders'&&old&&orderLockedForStaff(old))error(403,'Đơn hàng đã khóa chỉnh sửa sau 72 giờ');
 const r=next||old,leaders=managerLeaders(user,data),ids=leaders.map(l=>l.id);
 if(key==='members'&&old?.id===user.id&&next&&sameExcept(old,next,['name','accountId','email','phone','initials','avatar']))return;
 if(key==='saleDistributionByLeader'){
  const allowed=new Set([...ids,'manager:'+user.id,String.fromCharCode(36)]);
  if(!next||Object.keys(next).some(id=>!allowed.has(id)))error(403,'Distribution outside manager scope');
  const global=next[String.fromCharCode(36)];
  if(global&&user.role==='MANAGER'){
   const scope=new Set([user.id,...ids,...managerSales(user,data).map(member=>member.id)]);
   if((global.enabledSaleIds||[]).some(id=>!scope.has(id))||Object.keys(global.weights||{}).some(id=>!scope.has(id)))error(403,'Distribution member outside manager scope');
  }
  return;
 }
 if(key==='settings'){
  const visible=publicValue(user,key,old,data);
  if(!next||!sameExcept(visible,next,['saleAssignmentModes','assignmentCursor'])||Object.keys(next.saleAssignmentModes||{}).some(id=>!ids.includes(id)))error(403,'Manager chỉ được cài chia Sale trong Team được giao');return;
 }
 if(ADMIN_ONLY.has(key))error(403,'Chỉ Admin được phân quyền và quản lý hệ thống');
 if(key==='audit'){if(!old&&next&&next.actorId===user.id)return;error(403,'Nhật ký chỉ được ghi thêm');}
 if(key==='attendance'){if(!old&&next&&next.accountId===user.id)return authorize({...user,role:'LEADER'},key,old,next,data);error(403,'Không được sửa điểm danh');}
 if(key==='notifications'){
  if(old&&next&&managerReadable(user,key,old,data)&&sameExcept(old,next,['readBy'])&&next.readBy?.every(id=>id===user.id||(old.readBy||[]).includes(id)))return;
  if(!old&&next&&next.role!=='ALL'&&managerReadable(user,key,next,data))return;
  error(403,'Thông báo ngoài hệ thống được giao');
 }
 if(old?.customerId&&!managerOwns(user,data.customers.get(old.customerId),data))error(403,'Bản ghi gốc ngoài hệ thống được giao');
 const customer=key==='customers'?old||next:key==='orders'?data.customers.get(r.customerId):data.customers.get(r?.customerId);
 if(!managerOwns(user,customer,data))error(403,'Dữ liệu ngoài hệ thống được Admin giao');
 if(key==='customers'){
  if(!next||!managerOwns(user,next,data))error(403,'Không được chuyển khách ngoài hệ thống');
  if(next.saleId&&!([...data.members.values()].some(m=>m.id===next.saleId&&m.active!==false&&((m.role==='MANAGER'&&m.id===next.managerId)||(m.role==='SALE'&&(m.leaderId||null)===(next.leaderId||null)&&m.teamId===next.teamId)||(m.role==='LEADER'&&m.id===next.leaderId)))))error(403,'Recipient outside manager scope');
 }
 if(key==='orders'&&old&&!managerOwns(user,old,data))error(403,'Đơn ngoài hệ thống');
 if(key==='dataOffers'&&next){
  const recipient=managerSales(user,data).find(m=>m.id===next.saleId);
  if(!recipient||(recipient.leaderId||null)!==(next.leaderId||null)||recipient.teamId!==next.teamId||next.teamId!==customer.teamId)error(403,'Lời mời ngoài Team');
 }
 // Đơn hàng vẫn giữ các giới hạn riêng của Leader/Sale (ví dụ không tự xác
 // nhận thanh toán). Chỉ các thao tác Data mới dùng toàn bộ tuyến Manager.
 if(key==='orders'){
  const leader=leaders.find(l=>l.id===customer.leaderId);
  if(!leader)return;
  return authorize({...user,role:'LEADER',id:leader.id,teamId:leader.teamId,leaderId:leader.id},key,old,next,data);
 }
 // Manager có toàn quyền trong các Leader/Sale trực thuộc. Không chuyển tiếp
 // sang quyền Leader cũ của data, vì thao tác phân lại có thể đổi sang Team
 // khác nhưng vẫn nằm trong cùng tuyến Manager.
 return;
}
function customerScope(user,r){return !!r&&(user.role==='ADMIN'||(user.role==='SALE'&&r.saleId===user.id)||(user.role==='LEADER'&&((!!user.teamId&&r.teamId===user.teamId)||r.leaderId===user.id)));}
function offerPending(o,user,id){return o.customerId===id&&o.saleId===user.id&&o.status==='PENDING'&&Date.parse(String(o.offeredAt).replace(' ','T')+'+07:00')+24*3600000>Date.now();}
function pendingOffer(data,user,id){
 // Trong snapshot: lập chỉ mục một lần theo customerId thay vì quét mọi lời mời cho từng khách.
 const index=memoized(data,'pendingOffers',user,()=>{const map=new Map();for(const o of data.dataOffers.values())if(o.saleId===user.id&&o.status==='PENDING'){if(!map.has(o.customerId))map.set(o.customerId,[]);map.get(o.customerId).push(o);}return map;});
 return (index.get(id)||[]).find(o=>offerPending(o,user,id));
}
function readable(user,key,r,data){
 if(key==='feedbacks'||key==='processes')return true;
 if(user.role==='MANAGER')return managerReadable(user,key,r,data);
 if(user.role==='ADMIN')return true;
 if(user.role==='MARKETING')return key==='attendance' ? r.accountId===user.id : ['customers','orders','products','customFieldDefinitions','productCategories','websites','traffic','careGroups'].includes(key) || (key==='notifications'&&(r.role==='ALL'||r.role==='MARKETING'||r.saleId===user.id));
 if(user.role==='UNASSIGNED')return key==='attendance' ? r.accountId===user.id : false;
 if(user.role==='ACCOUNTING')return key==='attendance' ? r.accountId===user.id : ['customers','orders','products','productCategories','customFieldDefinitions','brokerageMetrics','courseConfigs','expenses','settings'].includes(key) || (key==='members'&&['SALE','LEADER','MANAGER'].includes(r.role)) || (key==='notifications'&&(r.role==='ALL'||r.role==='ACCOUNTING'||r.saleId===user.id));
 if(!['LEADER','SALE'].includes(user.role))return false;
 if(key==='members')return r.id===user.id||r.id===user.leaderId||(user.role==='LEADER'&&r.teamId===user.teamId);
 if(key==='customers')return customerScope(user,r)||!!pendingOffer(data,user,r.id);
 if(key==='orders')return customerScope(user,r);
 if(['products','customFieldDefinitions','productCategories','websites'].includes(key))return true;
 if(OBJECTS.includes(key))return key==='settings'||user.role==='LEADER';
 if(key==='attendance')return r.accountId===user.id||(user.role==='LEADER'&&r.teamId===user.teamId);
 if(key==='brokerageMetrics')return user.role==='SALE'?r.memberId===user.id:r.leaderId===user.id;
 if(key==='notifications')return r.role==='ALL'||r.saleId===user.id||r.leaderId===user.id||(r.role===user.role&&!r.saleId&&!r.leaderId);
 if(key==='audit')return r.actorId===user.id;
 if(key==='dataOffers')return r.saleId===user.id||(user.role==='LEADER'&&r.leaderId===user.id);
 return !!r.customerId&&customerScope(user,data.customers.get(r.customerId));
}
function publicValue(user,key,r,data){
 if(user.role==='MANAGER'&&data){
  const ids=managerLeaders(user,data).map(l=>l.id);
  if(key==='saleDistributionByLeader'){
   const allowed=new Set([...ids,'manager:'+user.id,String.fromCharCode(36)]);
   const value=Object.fromEntries(Object.entries(r).filter(([id])=>allowed.has(id)));
   const global=value[String.fromCharCode(36)];
   if(global){const scope=new Set([user.id,...ids,...managerSales(user,data).map(member=>member.id)]);value[String.fromCharCode(36)]={...global,enabledSaleIds:(global.enabledSaleIds||[]).filter(id=>scope.has(id)),weights:Object.fromEntries(Object.entries(global.weights||{}).filter(([id])=>scope.has(id)))};}
   return value;
  }
  if(key==='leaderDistribution')return {enabled:r.enabled===true,enabledLeaderIds:(r.enabledLeaderIds||[]).filter(id=>ids.includes(id))};
  if(key==='settings')r={...r,saleAssignmentModes:Object.fromEntries(Object.entries(r.saleAssignmentModes||{}).filter(([id])=>ids.includes(id)))};
 }

 if(key==='settings'&&user.role==='ACCOUNTING')return Object.fromEntries(Object.entries(r).filter(([k])=>['accountingLotConfig','brokeragePublishedPeriods','fontFamily','customAccent'].includes(k)));
 if(key==='settings'&&user.role!=='ADMIN')return Object.fromEntries(Object.entries(r).filter(([k])=>!['dataBotToken','memberBotToken','dataBotChatId','memberBotChatId'].includes(k)));

 // Offer dang cho nhan chi duoc xem ten, khong gui du lieu lien he qua snapshot.
 if(key==='customers'&&user.role==='SALE'&&pendingOffer(data,user,r.id)){
  const value={...r};
  for(const field of ['phone','email','ipAddress','landingPageUrl','landingPageDomain','note','customerCode','accountCode'])delete value[field];
  value.customFields={};
  return value;
 }
 return r;
}
function compactAssetValue(key, value) {
 if (!value || typeof value !== 'object') return value;
 if (key === 'processes') {
  const images = Array.isArray(value.imageData) ? value.imageData : (value.imageData ? [value.imageData] : []);
  const next = {...value}; delete next.imageData; next.hasImage = images.length > 0; next.imageCount = images.length; return next;
 }
 if (key === 'feedbacks') { const next = {...value}; next.hasImage = Boolean(next.imageData); delete next.imageData; return next; }
 if (key === 'orders') {
  const next = {...value}; const receipts = Array.isArray(next.paymentReceipts) ? next.paymentReceipts : [];
  next.paymentReceipts = receipts.map(receipt => {
   const images = Array.isArray(receipt.images) ? receipt.images : (receipt.billImage ? [{imageData: receipt.billImage}] : []);
   const compact = {...receipt}; delete compact.billImage; delete compact.imageData; delete compact.images; compact.hasBill = images.length > 0; compact.billCount = images.length; return compact;
  });
  next.hasBill = Boolean(next.billImage) || next.paymentReceipts.some(receipt => receipt.hasBill); delete next.billImage; return next;
 }
 return value;
}
function historyTime(row) { return String(row?.at || row?.createdAt || row?.updatedAt || '').replace('T',' '); }
function newestRows(values, limit) { return values.slice().sort((a,b) => historyTime(b).localeCompare(historyTime(a)) || String(b?.id||'').localeCompare(String(a?.id||''))).slice(0, limit); }
function snapshot(user,data,options={compact:false}){
 const state={},versions={};
 // data.revisions chỉ có trên bản dữ liệu dùng chung (chỉ đọc) của sharedData():
 // bản ghi không đổi giữ nguyên object nên khỏi băm SHA-256 lại ở mỗi lượt đồng bộ.
 const revisions=data.revisions instanceof WeakMap?data.revisions:null;
 const previousMemo=snapshotMemo;snapshotMemo={data,values:new Map()};
 try{
  for(const key of [...LISTS,...OBJECTS]){
   const list=LISTS.includes(key);
   if(list)state[key]=[];
   for(const [id,r]of data[key]){
    if(!readable(user,key,r,data))continue;
    const value=options.compact===true?compactAssetValue(key, publicValue(user,key,r,data)):publicValue(user,key,r,data);
    if(list)state[key].push(value);else state[key]=value;
    let hash=revisions&&value&&typeof value==='object'?revisions.get(value):undefined;
    if(hash===undefined){hash=revision(value);if(revisions&&value&&typeof value==='object')revisions.set(value,hash);}
    versions[`${key}/${id}`]=hash;
   }
  }
 }finally{snapshotMemo=previousMemo;}
 // Only public assignment fields; does not grant access to other teams' records.
 if(options.compact===true){if(Array.isArray(state.audit))state.audit=newestRows(state.audit,100);if(Array.isArray(state.customerFieldHistory))state.customerFieldHistory=newestRows(state.customerFieldHistory,200);}
 state.orderAssignees=['ADMIN','ACCOUNTING','MANAGER','LEADER','SALE'].includes(user.role)
  ? [...data.members.values()].filter(m=>m.active!==false&&m.active!==0&&m.active!=='0'&&['MANAGER','LEADER','SALE'].includes(m.role)).map(m=>({id:m.id,name:m.name,role:m.role,teamId:m.teamId||'',leaderId:m.leaderId||null,managerId:m.managerId||null,active:true})) : [];
 state.accounts=state.members;
 state.registeredAccounts=state.members.filter(r=>r.role==='UNASSIGNED');
 state.members=state.members.filter(r=>['SALE','LEADER','MANAGER'].includes(r.role));
 const config=data.leaderDistribution.get('$')||{};
 const automation=user.role==='ADMIN'?{engine:'server-v1',enabled:config.enabled===true,mode:data.settings.get('$')?.assignmentMode||'MANUAL',eligibleLeaderCount:[...data.members.values()].filter(p=>p.role==='LEADER'&&p.active!==false&&p.teamId&&(config.enabledLeaderIds||[]).includes(p.id)).length}:undefined;
 return {state,versions,automation,storage:{mode:'mysql',durable:true}};
}
function sameExcept(a,b,allowed){const clean=o=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>!allowed.includes(k)));return canonical(clean(a))===canonical(clean(b));}
function orderCreatedAtMs(value){
 const raw=String(value||'').trim();
 if(!raw)return NaN;
 const iso=raw.includes('T')?raw:raw.replace(' ','T');
 return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)?iso:`${iso}+07:00`);
}
function orderLockedForStaff(order){
 const created=orderCreatedAtMs(order?.createdAt);
 return Number.isFinite(created)&&Date.now()-created>=3*24*60*60*1000;
}

function validOrderAssignee(row,data){
 const member=data.members.get(row?.saleId);
 if(!member||member.active===false||member.active===0||member.active==='0'||!['MANAGER','LEADER','SALE'].includes(member.role))return false;
 const leader=member.role==='LEADER'?member:data.members.get(member.leaderId);
 const managerId=member.role==='MANAGER'?member.id:member.managerId||(leader?.role==='LEADER'?leader.managerId:leader?.role==='MANAGER'?leader.id:null)||null;
 const leaderId=member.role==='LEADER'?member.id:member.leaderId||null;
 return (row.leaderId||null)===leaderId&&(row.managerId||null)===managerId&&(row.teamId||'')===(member.teamId||(leader?.role==='LEADER'?leader.teamId:'')||'');
}
// Sales record receipts for their own orders; reconciliation remains an accounting action.
function authorizeReceiptOrder(user,old,next,data){
 if(!next)error(403,'Không được xóa đơn qua luồng thanh toán');
 const customer=data.customers.get(next.customerId),sale=data.members.get(next.saleId);
 const owns=row=>user.role==='ACCOUNTING'||(user.role==='SALE'?row?.saleId===user.id:user.role==='LEADER'?customerScope(user,row):managerOwns(user,row,data));
 if(!customer||!sale||!['MANAGER','LEADER','SALE'].includes(sale.role)|| (old ? (!owns(customer)||!owns(next)||!owns(old)) : (!(next.createdBy===user.id&&validOrderAssignee(next,data))&&(!owns(customer)||!owns(next)))))error(403,'Đơn ngoài phạm vi');
 if(!old&&(next.saleId!==customer.saleId||next.leaderId!==customer.leaderId||next.teamId!==customer.teamId||(next.managerId||null)!==(customer.managerId||null)))error(403,'Đơn không khớp người phụ trách khách');
 if(!data.products.get(next.productId))error(400,'Sản phẩm không tồn tại');
 if(old&&(old.paymentReconciled||old.vatIssued||['REFUNDED','CANCELLED','COURSE_GRANTED'].includes(old.status)))error(403,'Đơn đã khóa sau đối soát hoặc kết thúc');
 if(old&&sameExcept(old,next,['paymentReceipts','receiptsVersion','updatedAt']))return;
 const allowed=['customerName','customerPhone','productId','productName','sku','unitPrice','subtotal','vatRate','vatAmount','total','amountPaid','depositAmount','balanceDue','status','paidAt','paymentMode','billing','requireVat','taxCode','companyName','saleNote','billImage','updatedAt','paymentReceipts','receiptsVersion'];
 if(old&&!sameExcept(old,next,allowed))error(403,'Không được đổi chủ đơn hoặc thông tin đối soát');
 if(!old&&(next.paymentReconciled||next.vatIssued||Number(next.refund||0)||next.refundedAt||next.refundVouchers?.length))error(403,'Đơn mới không được tự đối soát hoặc hoàn tiền');
 if(next.vatRate!==0.1||(next.vatAmount!==Math.round(next.subtotal*0.1)&&next.vatAmount!==Math.round(next.total/11))||next.total!==next.subtotal+next.vatAmount||!(next.subtotal>0)||!(next.amountPaid>0)||next.amountPaid>next.total||(!next.billImage&&!next.paymentReceipts?.some(r=>r.billImage)))error(400,'Kiểm tra VAT 10%, số tiền và bill chuyển khoản');
 if(next.status!==(next.amountPaid===next.total?'PAID':'DEPOSIT'))error(400,'Trạng thái không khớp số tiền đã thu');
}
function authorize(user,key,old,next,data){
 if(key==='customers'&&!old&&next?.createdVia==='ORDER'&&['ADMIN','ACCOUNTING','MANAGER','LEADER','SALE'].includes(user.role)){
  if(next.createdBy!==user.id||!validOrderAssignee(next,data))error(403,'Người phụ trách khách không hợp lệ');
  return;
 }

 if(key==='orders'&&!old&&next?.createdBy&&(!validOrderAssignee(next,data)||next.createdBy!==user.id))error(403,'Người phụ trách đơn không hợp lệ');
 if(key==='orders'&&!old&&next?.receiptsVersion===1&&next.paymentReceipts.some(r=>r.legacy||r.createdBy!==user.id))error(403,'Bill mới không hợp lệ');
 if(key==='orders'&&old?.receiptsVersion===1&&next&&next.receiptsVersion!==1)error(403,'Không được xóa lịch sử thanh toán');
 if(key==='orders'&&old&&next&&next.receiptsVersion===1){
  const before=OrderPayments.receipts(old),after=next.paymentReceipts||[];
  if(after.slice(before.length).some(r=>r.legacy||r.createdBy!==user.id))error(403,'Bill mới phải do người hiện tại ghi nhận');
  if(after.length<before.length)error(403,'Không được xóa lịch sử thu');
  for(let i=0;i<before.length;i++){
   const prior=before[i],current=after[i];
   if(!sameExcept(prior,current,['images','imageRevisions']))error(403,'Không được sửa số tiền hoặc thời điểm của lần thu');
   if(canonical(prior)!==canonical(current)){
    const priorImages=OrderPayments.images(prior),images=OrderPayments.images(current),history=prior.imageRevisions||[],nextHistory=current.imageRevisions||[],revision=nextHistory.at(-1);
    if(nextHistory.length!==history.length+1||history.some((r,index)=>canonical(r)!==canonical(nextHistory[index]))||revision?.by!==user.id||!Number.isFinite(Date.parse(revision?.at))||canonical(revision?.images)!==canonical(priorImages))error(403,'Sửa ảnh phải giữ lịch sử ảnh và người thay đổi');
   }
  }
  if((old.paymentReconciled||old.vatIssued)&&canonical(before)!==canonical(after))error(403,'Đơn đã đối soát hoặc xuất hóa đơn');
 }

 if(key==='orders'&&old&&next&&old.paymentReconciled!==next.paymentReconciled){
  if(!['ADMIN','ACCOUNTING'].includes(user.role)||old.paymentReconciled||next.paymentReconciled!==true||!['PAID','COURSE_GRANTED'].includes(old.status)||OrderPayments.paid(old)!==old.total||OrderPayments.balance(old)!==0||OrderPayments.receipts(old).some(r=>!OrderPayments.images(r).length)||next.paymentReconciledBy!==user.id||!Number.isFinite(Date.parse(next.paymentReconciledAt))||!sameExcept(old,next,['paymentReconciled','paymentReconciledAt','paymentReconciledBy','reconciliationNote']))error(403,'Đối soát chỉ xác nhận đơn đủ tiền, không thay đổi giao dịch');
  return;
 }
 if(key==='orders'&&old&&next&&!old.vatIssued&&next.vatIssued&&user.role==='ACCOUNTING'){
  if(!old.paymentReconciled||OrderPayments.balance(old)!==0||!next.vatInvoiceNumber||!next.taxCode||!next.companyName||!sameExcept(old,next,['vatIssued','vatIssuedAt','vatInvoiceNumber','requireVat','taxCode','companyName','billing']))error(403,'Chỉ ghi nhận VAT sau đối soát và đủ thông tin hóa đơn');
  return;
 }
 if(['SALE','LEADER','MANAGER','ACCOUNTING'].includes(user.role)&&key==='orders'&&next&&(next.paymentReference||old?.paymentReference||next.receiptsVersion===1))return authorizeReceiptOrder(user,old,next,data);
 if(user.role==='ACCOUNTING'&&key==='customers'&&!old&&next){const sale=data.members.get(next.saleId);if(sale?.role==='SALE'&&next.leaderId===sale.leaderId&&next.teamId===sale.teamId)return;error(403,'Sale phụ trách không hợp lệ');}
 if(user.role==='ACCOUNTING'&&['expenses','courseConfigs','brokerageMetrics'].includes(key))return;
 if(user.role==='ACCOUNTING'&&key==='settings'&&next&&sameExcept(publicValue(user,key,old||{},data),next,['accountingLotConfig','brokeragePublishedPeriods']))return;
 if(user.role==='ACCOUNTING'&&key==='orders'&&old&&!next)return;
 if(user.role==='ACCOUNTING'&&key==='audit'&&!old&&next?.actorId===user.id)return;
 if(key==='feedbacks'){
  if(user.role==='ADMIN')return;
  if(next&&next.authorId===user.id&&(!old||old.authorId===user.id))return;
  if(!next&&old?.authorId===user.id)return;
  error(403,'Chỉ được sửa hoặc xóa feedback do chính mình tạo');
 }
 if(key==='processes'&&user.role!=='ADMIN')error(403,'Chỉ Admin được quản lý Quy Trình');
 if(user.role==='MANAGER')return authorizeManager(user,key,old,next,data);
 if(user.role==='ADMIN')return;
 if(key==='members'&&old?.id===user.id&&next&&next.id===user.id&&sameExcept(old,next,['name','accountId','email','phone','initials','avatar']))return;
 if(['MARKETING','ACCOUNTING','UNASSIGNED'].includes(user.role)){if(key==='attendance'&&!old&&next&&next.accountId===user.id&&next.date===new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}))return;error(403,'Tài khoản chỉ được điểm danh hôm nay và xem lịch sử cá nhân');}
 if(!['LEADER','SALE'].includes(user.role))error(403,'Tài khoản đang chờ Admin phân quyền');
 const r=next||old;
 if(key==='members'&&r?.id===user.id&&old&&next&&sameExcept(old,next,['name','accountId','email','phone','initials','avatar']))return;
 if(ADMIN_ONLY.has(key))error(403,'Chỉ Admin được cập nhật '+key);
 if(key==='settings') {
  if(user.role==='LEADER'&&old&&next&&sameExcept(old,next,['saleAssignmentModes','assignmentCursor'])&&Object.keys(next.saleAssignmentModes||{}).every(k=>k===user.id||next.saleAssignmentModes[k]===old.saleAssignmentModes?.[k]))return;
  error(403,'Chỉ Admin được đổi cài đặt');
 }
 if(key==='saleDistributionByLeader') {if(user.role==='LEADER'&&old&&next&&sameExcept(old,next,[user.id]))return;error(403,'Không được đổi phân phối của đội khác');}
 if(key==='customers'){
  const offer=old&&pendingOffer(data,user,old.id);
  if(!customerScope(user,old||next)&&!offer)error(403,'Khách ngoài phạm vi');
  if(!next)error(403,'Chỉ Admin được lưu trữ khách');
  if(user.role==='SALE') {
   if(next.saleId!==user.id)error(403,'Không được giao khách cho Sale khác');
   if(old&&!sameExcept(old,next,['email','phone','status','note','customFields','updatedAt','saleAcceptedAt','saleId']))error(403,'Không được thay đổi nguồn hoặc đội');
   if(!old&&(next.leaderId!==user.leaderId||next.teamId!==user.teamId))error(403,'Đội không hợp lệ');
  } else if(!customerScope(user,next))error(403,'Không được chuyển khách ngoài đội');
  return;
 }
 if(key==='orders'){
  if(old&&next&&(Number(next.refund||0)!==Number(old.refund||0)||next.refundedAt!==old.refundedAt||next.refundReason!==old.refundReason||JSON.stringify(next.refundVouchers||[])!==JSON.stringify(old.refundVouchers||[])))error(403,'Chỉ Admin được tạo phiếu hoàn tiền');
  // createdAt là thời điểm gốc của đơn. Sale/Leader chỉ được sửa hoặc xóa trong 72 giờ đầu.
  if(old&&['SALE','LEADER'].includes(user.role)&&orderLockedForStaff(old))error(403,'\u0110\u01a1n h\u00e0ng ch\u1ec9 \u0111\u01b0\u1ee3c x\u00f3a ho\u1eb7c ch\u1ec9nh s\u1eeda trong 3 ng\u00e0y \u0111\u1ea7u');
  if(!customerScope(user,old||next)||!customerScope(user,data.customers.get(r.customerId)))error(403,'Đơn ngoài phạm vi');
  if(next){const product=data.products.get(next.productId);if(!product||(product.active===false&&old?.productId!==product.id)||!Number.isInteger(next.qty)||next.qty<1||next.qty>10||Number(next.unitPrice)!==Number(product.price)||Number(next.subtotal)!==Number(product.price)*next.qty)error(400,'Sản phẩm, số lượng hoặc đơn giá không khớp danh mục MySQL');}
  if(next&&old&&!sameExcept(old,next,['productId','productName','sku','qty','unitPrice','subtotal','vatRate','vatAmount','total','discount','updatedAt','items','note','paymentMode','depositAmount','balanceDue','billing','paymentMethod','rentalMonths','rentalEndsAt']))error(403,'Chỉ Admin xác nhận thanh toán hoặc chuyển đơn');
  if(next&&!old&&(next.status!=='PENDING'||next.saleId!==data.customers.get(next.customerId)?.saleId||next.leaderId!==data.customers.get(next.customerId)?.leaderId||next.teamId!==data.customers.get(next.customerId)?.teamId))error(403,'Đơn mới không hợp lệ');
  if(next&&old&&old.status!=='PENDING')error(403,'Đơn đã thanh toán không được sửa');
  return;
 }
 if(key==='attendance'){if(!old&&next&&next.accountId===user.id&&next.date===new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}))return;error(403,'Không được sửa điểm danh');}
 if(key==='audit'){if(!old&&next&&next.actorId===user.id)return;error(403,'Nhật ký chỉ được ghi thêm');}
 if(key==='notifications'){
  if(old&&next&&readable(user,key,old,data)&&sameExcept(old,next,['readBy'])&&Array.isArray(next.readBy)&&next.readBy.every(id=>id===user.id||(old.readBy||[]).includes(id)))return;
  if(!old&&next&&['SALE','LEADER'].includes(user.role)){
   const ownLeaderNotice=user.role==='SALE'&&next.role==='LEADER'&&next.leaderId===user.leaderId&&next.teamId===user.teamId&&next.saleId===user.id;
   const ownLeaderNoticeAsLeader=user.role==='LEADER'&&next.role!=='ALL';
   if(next.role==='ALL'||ownLeaderNotice||ownLeaderNoticeAsLeader)return;
  }
  error(403,'Không được sửa thông báo');
 }
 if(key==='dataOffers'){
  if(user.role==='LEADER'&&r.leaderId===user.id&&customerScope(user,data.customers.get(r.customerId)))return;
  if(user.role==='SALE'&&old&&next&&old.saleId===user.id&&old.status==='PENDING'&&next.status==='ACCEPTED'&&sameExcept(old,next,['status','resolvedAt'])&&pendingOffer(data,user,old.customerId))return;
  error(403,'Không được xử lý offer này');
 }
 if(r?.customerId&&(customerScope(user,data.customers.get(r.customerId))||pendingOffer(data,user,r.customerId)))return;
 error(403,'Không có quyền cập nhật '+key);
}
function validate(key,value,id){
 if(value===null)return;
 if(key==='expenses'&&(Object.hasOwn(value,'date')||Object.hasOwn(value,'title')||Object.hasOwn(value,'amount'))){
  if(typeof value.date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value.date))error(400,'Invalid expense date');
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>200)error(400,'Invalid expense title');
  if(typeof value.category!=='string'||value.category.length>100)error(400,'Invalid expense category');
  if(!Number.isFinite(Number(value.amount))||Number(value.amount)<=0||Number(value.amount)>1e15)error(400,'Invalid expense amount');
  for(const field of ['payer','note'])if(typeof (value[field]??'')!=='string'||String(value[field]??'').length>1000)error(400,'Expense field is too long');
 }
 if(value===null)return;
 if(!value||typeof value!=='object'||(LISTS.includes(key)&&(Array.isArray(value)||value.id!==id)))error(400,'Bản ghi không hợp lệ');
 if(['members','customers','products'].includes(key)&&(typeof value.name!=='string'||!value.name.trim()||value.name.length>(key==='products'?200:160)))error(400,'Tên không hợp lệ');
 if(key==='members'&&!['ADMIN','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED','MANAGER'].includes(value.role))error(400,'Chức vụ không hợp lệ');
 if(key==='members'&&Object.hasOwn(value,'accountId')&&value.accountId&&!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(String(value.accountId)))error(400,'ID tài khoản không hợp lệ');
 if(key==='customers'&&(!value.phone||value.phone.length>30))error(400,'Số điện thoại không hợp lệ');
 if(key==='products'&&(!Number.isFinite(value.price)||value.price<0||!['SALE','RENTAL'].includes(value.type)))error(400,'Sản phẩm không hợp lệ');
 if(key==='products'&&Object.hasOwn(value,'kind')&&!['COURSE','INDICATOR','VIP','OTHER'].includes(value.kind))error(400,'Loại sản phẩm không hợp lệ');
 if(key==='products'&&Object.hasOwn(value,'courseKey')&&(typeof value.courseKey!=='string'||value.courseKey.length>120))error(400,'Khoá học của sản phẩm không hợp lệ');
 if(key==='products'&&Object.hasOwn(value,'courseKeys')&&(!Array.isArray(value.courseKeys)||value.courseKeys.length>200||value.courseKeys.some(key=>typeof key!=='string'||!key.trim()||key.length>120)))error(400,'Danh sách khóa của sản phẩm không hợp lệ');
 if(key==='courseConfigs'){
  if(Object.hasOwn(value,'productId')&&(typeof value.productId!=='string'||!value.productId.trim()||value.productId.length>120))error(400,'Sản phẩm cấu hình đào tạo không hợp lệ');
  if(typeof value.courseKey!=='string'||!value.courseKey.trim()||value.courseKey.length>120)error(400,'Khoá học không hợp lệ');
  for(const field of ['trainerIds','leaderIds'])if(!Array.isArray(value[field]??[])||(value[field]??[]).length>50||(value[field]??[]).some(item=>typeof item!=='string'||item.length>80))error(400,'Danh sách nhân sự khóa học không hợp lệ');
  for(const field of ['rateSale','rateLeader','rateTrainer','rateCompany'])if(!Number.isFinite(Number(value[field]??0))||Number(value[field]??0)<0||Number(value[field]??0)>100)error(400,'Tỷ lệ chia khóa học không hợp lệ');
  for(const field of ['trainerRates','leaderRates','saleRates'])if(value[field]!==undefined&&(!value[field]||typeof value[field]!=='object'||Array.isArray(value[field])||Object.keys(value[field]).length>500||Object.values(value[field]).some(rate=>!Number.isFinite(Number(rate))||Number(rate)<0||Number(rate)>100)))error(400,'Tỷ lệ hoa hồng cá nhân không hợp lệ');
  if(Object.hasOwn(value,'startDate')&&value.startDate&&!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(value.startDate)))error(400,'Ngày khai giảng không hợp lệ');
 }
 if(key==='products'&&Object.hasOwn(value,'imageData')&&(typeof value.imageData!=='string'||(value.imageData!==''&&(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageData)||value.imageData.length>2_800_000))))error(400,'\u1ea2nh s\u1ea3n ph\u1ea9m kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c qu\u00e1 l\u1edbn');
 if(key==='feedbacks'&&(Object.hasOwn(value,'category')||Object.hasOwn(value,'note')||Object.hasOwn(value,'imageData')||Object.hasOwn(value,'authorId'))){
  if(!['COURSE','SUPPORT','GROUP_SIGNAL'].includes(String(value.category||'')))error(400,'Lo\u1ea1i feedback kh\u00f4ng h\u1ee3p l\u1ec7');
  if(typeof value.note!=='string'||value.note.trim().length>2000)error(400,'Ghi ch\u00fa feedback kh\u00f4ng h\u1ee3p l\u1ec7');
  if(typeof value.imageData!=='string'||(value.imageData!==''&&(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.imageData)||value.imageData.length>2_800_000)))error(400,'\u1ea2nh feedback kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c qu\u00e1 l\u1edbn');
  if(typeof value.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(value.createdAt))error(400,'Ng\u00e0y feedback kh\u00f4ng h\u1ee3p l\u1ec7');
 }
 if(key==='processes'&&(Object.hasOwn(value,'title')||Object.hasOwn(value,'summary')||Object.hasOwn(value,'content')||Object.hasOwn(value,'link')||Object.hasOwn(value,'imageData'))){
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>200)error(400,'Ti\u00eau \u0111\u1ec1 quy tr\u00ecnh kh\u00f4ng h\u1ee3p l\u1ec7');
  if(typeof value.summary!=='string'||value.summary.length>500)error(400,'M\u00f4 t\u1ea3 ng\u1eafn quy tr\u00ecnh kh\u00f4ng h\u1ee3p l\u1ec7');
  if(typeof value.content!=='string'||!value.content.trim()||value.content.length>20000)error(400,'N\u1ed9i dung quy tr\u00ecnh kh\u00f4ng h\u1ee3p l\u1ec7');
  if(typeof value.link!=='string'||value.link.length>500||value.link&&!/^https?:\/\/[^\s]+$/i.test(value.link))error(400,'Link quy tr\u00ecnh kh\u00f4ng h\u1ee3p l\u1ec7');
  const processImages=Array.isArray(value.imageData)?value.imageData:(typeof value.imageData==='string'?[value.imageData]:null);
  if(!processImages||processImages.length>10||processImages.some(image=>typeof image!=='string'||(image!==''&&(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)||image.length>2_800_000))))error(400,'\u1ea2nh quy tr\u00ecnh kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c qu\u00e1 l\u1edbn');
 }
 if(key==='brokerageMetrics'){
  if(!/^[0-9]{4}-[0-9]{2}$/.test(String(value.period||'')))error(400,'Kỳ báo cáo lot không hợp lệ');
  // Manager/Leader không thuộc Team nào nên chỉ Sale bắt buộc teamId.
  if(!value.memberId||!value.leaderId||(!['MANAGER','LEADER'].includes(value.memberRole)&&!value.teamId))error(400,'Thiếu nhân sự hoặc Team cho báo cáo lot');
  for(const field of ['miniLots','productRate'])if(Object.hasOwn(value,field)&&(!Number.isFinite(Number(value[field]))||Number(value[field])<0))error(400,'Dữ liệu lot hoặc tỷ lệ hoa hồng không hợp lệ');
  for(const field of ['basicLots','microLots','nanoLots','lotCommissionRate','indicatorCommissionRate','courseCommissionRate','vatRate'])if(!Number.isFinite(Number(value[field]))||Number(value[field])<0)error(400,'Dữ liệu lot hoặc tỷ lệ hoa hồng không hợp lệ');if(Object.hasOwn(value,'bonus')&&(!Number.isFinite(Number(value.bonus))||Number(value.bonus)<0))error(400,'Tiền thưởng không hợp lệ');
  if(Number(value.vatRate)>1)error(400,'Thuế suất báo cáo không hợp lệ');
 }
 if(key==='orders'&&!['PENDING','PAID','DEPOSIT','COURSE_GRANTED','CANCELLED','REFUNDED'].includes(value.status))error(400,'Trạng thái đơn không hợp lệ');
 if(key==='orders'&&(!value.customerId||!value.code||!Number.isFinite(value.total)||value.total<0))error(400,'Đơn không hợp lệ');
 if(key==='orders'){
  if(value.receiptsVersion===1){
   const receipts=value.paymentReceipts;
   if(!Array.isArray(receipts)||!receipts.length||receipts.length>20||JSON.stringify(receipts).length>6000000)error(400,'Lịch sử thanh toán không hợp lệ hoặc vượt dung lượng');
   const ids=new Set();
   for(const r of receipts){if(!r.id||ids.has(r.id)||!Number.isSafeInteger(r.amount)||r.amount<=0||!['DEPOSIT','PAYMENT','FULL'].includes(r.kind)||!Number.isFinite(Date.parse(r.at))||typeof r.billImage!=='string'||(!r.legacy&&!/^data:image\/(jpeg|png|webp);base64,/.test(r.billImage)))error(400,'Bill thanh toán không hợp lệ');ids.add(r.id);}
   for(const r of receipts){
    const images=OrderPayments.images(r);
    if(images.length>10||new Set(images.map(i=>i.id)).size!==images.length||images.some(i=>!i.id||typeof i.note!=='string'||i.note.length>500||typeof i.imageData!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(i.imageData)))error(400,'Ảnh hoặc ghi chú bill không hợp lệ');
    if(r.imageRevisions&&(!Array.isArray(r.imageRevisions)||r.imageRevisions.length>30))error(400,'Lịch sử sửa ảnh không hợp lệ');
   }
   if(value.amountPaid!==OrderPayments.paid(value)||value.amountPaid>value.total)error(400,'Thực thu không khớp các bill thanh toán');
   if(!['REFUNDED','CANCELLED','COURSE_GRANTED'].includes(value.status)&&value.status!==(value.amountPaid===value.total?'PAID':'DEPOSIT'))error(400,'Trạng thái không khớp thanh toán');
  }
  for(const field of ['subtotal','vatAmount','discount','depositAmount','amountPaid','balanceDue'])if(Object.hasOwn(value,field)&&(!Number.isFinite(value[field])||value[field]<0))error(400,'Số tiền đơn hàng không hợp lệ');
  if(Object.hasOwn(value,'refund')&&(!Number.isFinite(Number(value.refund))||Number(value.refund)<0))error(400,'Số tiền hoàn không hợp lệ');
  if(Object.hasOwn(value,'refundReason')&&(typeof value.refundReason!=='string'||value.refundReason.length>500))error(400,'Lý do hoàn tiền không hợp lệ');
  if(Object.hasOwn(value,'refundVouchers')&&(!Array.isArray(value.refundVouchers)||value.refundVouchers.length>100))error(400,'Danh sách phiếu hoàn không hợp lệ');
  if(Object.hasOwn(value,'vatRate')&&(!Number.isFinite(value.vatRate)||value.vatRate<0||value.vatRate>1))error(400,'Thuế suất không hợp lệ');
  if(value.paymentMode&&!['FULL','DEPOSIT'].includes(value.paymentMode))error(400,'Hình thức thanh toán không hợp lệ');
  if(value.paymentMode==='DEPOSIT'&&(!Number.isFinite(value.depositAmount)||value.depositAmount<=0||value.depositAmount>value.total))error(400,'Tiền cọc không hợp lệ');
  if(value.billing&&((typeof value.billing!=='object'||Array.isArray(value.billing))||['name','cccd','phone','email','address','taxId'].some(field=>typeof (value.billing[field]??'')!=='string'||String(value.billing[field]??'').length>254)))error(400,'Thông tin hóa đơn không hợp lệ');
  if(value.rentalMonths!=null&&![1,3,6,12].includes(Number(value.rentalMonths)))error(400,'Kỳ thuê không hợp lệ');
  if(value.rentalEndsAt!=null&&!Number.isFinite(Date.parse(value.rentalEndsAt)))error(400,'Ngày hết hạn thuê không hợp lệ');
  if(Number.isFinite(value.subtotal)&&Number.isFinite(value.vatAmount)&&Math.abs(value.total-(value.subtotal-Number(value.discount||0)+value.vatAmount))>0.01)error(400,'Tổng tiền đơn hàng không khớp');
  if(value.status!=='REFUNDED'&&Number.isFinite(value.amountPaid)&&Number.isFinite(value.balanceDue)&&Math.abs(value.balanceDue-Math.max(0,value.total-value.amountPaid))>0.01)error(400,'Số tiền còn lại không khớp');
 }
 if(['password','password_hash','adminPassword','twoFactorCode'].some(k=>Object.hasOwn(value,k)))error(400,'Mật khẩu phải gửi qua API xác thực');
}
// Server-only durable notices: excluded from snapshots and public state writes.
async function queueTelegramNotice(c,key,notice){
 const id='TG-'+crypto.createHash('sha256').update(key).digest('hex');
 await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE id=id', ['telegramOutbox',id,JSON.stringify({...notice,status:'PENDING',attempts:0,createdAt:new Date().toISOString()})]);
}

async function ensureUserActivityTables(){
 const result=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='crm_sessions' AND column_name IN ('ip','user_agent','last_seen_at','last_activity')`);
 const rows=Array.isArray(result[0])?result[0]:[];
 const columns=new Set(rows.map(row=>row.column_name));
 if(!columns.has('ip'))await pool.query('ALTER TABLE crm_sessions ADD COLUMN ip VARCHAR(64) NULL AFTER user_id');
 if(!columns.has('user_agent'))await pool.query('ALTER TABLE crm_sessions ADD COLUMN user_agent VARCHAR(512) NULL AFTER ip');
 if(!columns.has('last_seen_at'))await pool.query('ALTER TABLE crm_sessions ADD COLUMN last_seen_at DATETIME NULL AFTER created_at');
 if(!columns.has('last_activity'))await pool.query('ALTER TABLE crm_sessions ADD COLUMN last_activity VARCHAR(160) NULL AFTER last_seen_at');
 await pool.query(`CREATE TABLE IF NOT EXISTS user_activity_logs (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(96) NOT NULL, action VARCHAR(48) NOT NULL, detail VARCHAR(255) NOT NULL DEFAULT '', ip VARCHAR(64) NULL, user_agent VARCHAR(512) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_user_activity_user_time (user_id,created_at), INDEX idx_user_activity_time (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
async function project(c,key,id,r){
 if(key==='dataOffers'&&r?.status==='PENDING'&&r.saleId){
  await queueTelegramNotice(c,'offer:'+id+':'+r.saleId,{kind:'ASSIGNMENT',customerId:r.customerId,offerId:id,recipientId:r.saleId});
 }
 if(key==='customers'&&r?.saleAcceptedAt&&(r.saleId||r.ownerId||r.managerId)){
  const recipientId=r.saleId||r.ownerId||r.managerId;
  await queueTelegramNotice(c,'direct:'+id+':'+recipientId+':'+r.saleAcceptedAt,{kind:'ASSIGNMENT',customerId:id,recipientId,acceptedAt:r.saleAcceptedAt});
 }

 if(key==='customers'){
  if(!r){await c.execute("UPDATE customers SET status='ARCHIVED' WHERE id=?",[id]);return;}
  const {custom_fields_json,...details}=r;
  await c.execute(`INSERT INTO customers(id,name,phone,email,source,campaign,website_id,status,sale_id,leader_id,team_id,note,custom_fields_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone=VALUES(phone),email=VALUES(email),source=VALUES(source),campaign=VALUES(campaign),website_id=VALUES(website_id),status=VALUES(status),sale_id=VALUES(sale_id),leader_id=VALUES(leader_id),team_id=VALUES(team_id),note=VALUES(note),custom_fields_json=VALUES(custom_fields_json)`,[id,r.name,r.phone,r.email||null,r.source||null,r.campaign||null,r.websiteId||null,r.status||'NEW',r.saleId||null,r.leaderId||null,r.teamId||null,r.note||null,JSON.stringify({__crmMeta:details,__crmFields:r.customFields||{}}),r.createdAt||new Date()]);
  }else if(key==='orders'){
   if(!r){await c.execute('DELETE FROM orders WHERE id=?',[id]);return;}
   const {items_json,...details}=r;
   await c.execute(`INSERT INTO orders(id,code,customer_id,sale_id,leader_id,team_id,total_amount,status,items_json,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE code=VALUES(code),customer_id=VALUES(customer_id),sale_id=VALUES(sale_id),leader_id=VALUES(leader_id),team_id=VALUES(team_id),total_amount=VALUES(total_amount),status=VALUES(status),items_json=VALUES(items_json),note=VALUES(note)`,[id,r.code,r.customerId,r.saleId||null,r.leaderId||null,r.teamId||null,r.total,r.status||'PENDING',JSON.stringify(details),r.note||null,r.createdAt||new Date()]);
  }else if(key==='products'){
   if(!r){await c.execute('UPDATE products SET active=0 WHERE id=?',[id]);return;}
   await c.execute(`INSERT INTO products(id,sku,name,category,price,type,rental_months,vat_rate,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sku=VALUES(sku),name=VALUES(name),category=VALUES(category),price=VALUES(price),type=VALUES(type),rental_months=VALUES(rental_months),vat_rate=VALUES(vat_rate),active=VALUES(active)`,[id,r.sku||null,r.name,r.category||null,r.price,r.type,r.rentalMonths||null,Number.isFinite(Number(r.vatRate))?Number(r.vatRate):0.1,r.active===false?0:1,r.createdAt||new Date()]);
  }else if(key==='members'){
   if(!r){await c.execute('UPDATE users SET active=0 WHERE id=?',[id]);return;}
   await c.execute('UPDATE users SET name=?,role=?,team_id=?,leader_id=?,active=?,email=COALESCE(?,email) WHERE id=?',[r.name,r.role,r.teamId||null,r.leaderId||null,r.active===false?0:1,r.email||null,id]);
   await c.execute('UPDATE users SET account_code=? WHERE id=?',[r.accountId||null,id]);
   if(Object.hasOwn(r,'telegramChatId'))await c.execute('UPDATE users SET telegram_chat_id=?,telegram_username=? WHERE id=?',[r.telegramChatId||null,r.telegramUsername||null,id]);
 }else if(key==='settings')await c.execute("INSERT INTO system_settings(setting_key,setting_value) VALUES ('crm',?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[JSON.stringify(r||{})]);
}
// Hết hạn được lưu trên server ngay ở lần đọc tiếp theo, kể cả Admin đã đóng trình duyệt.
async function expireOffers(c,data){
 for(const [id,offer] of data.dataOffers){
  const expiry=Date.parse(String(offer.offeredAt).replace(' ','T')+'+07:00')+24*3600000;
  if(offer.status!=='PENDING'||!Number.isFinite(expiry)||expiry>Date.now())continue;
  const next={...offer,status:'EXPIRED',resolvedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,16)};
  await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0',['dataOffers',id,JSON.stringify(next)]);
  await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',['expire-'+crypto.randomUUID(),'SYSTEM',JSON.stringify([{key:'dataOffers',id,before:offer,after:next}])]);
  data.dataOffers.set(id,next);
  // Ghi chu het han va tra ve dung Team, khong tu dong chia lai.
  const customer=data.customers.get(offer.customerId);
  if(customer && !customer.saleId && ![...data.dataOffers.values()].some(o=>o.id!==id&&o.customerId===offer.customerId&&o.status==='PENDING')){
    const updated={...customer,saleId:null,saleAcceptedAt:null,updatedAt:next.resolvedAt,note:'Sale không nhận data sau 24h. Chờ Leader phân lại.'};
    await project(c,'customers',customer.id,updated);
    await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0',['customers',customer.id,JSON.stringify(updated)]);
    await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',['expire-customer-'+crypto.randomUUID(),'SYSTEM',JSON.stringify([{key:'customers',id:customer.id,before:customer,after:updated}])]);
    data.customers.set(customer.id,updated);
  }

 }
}
async function warnRentalExpiry(c,data){
 for(const order of data.orders.values()){
  if(!order.rentalEndsAt||order.status!=='PAID')continue;
  const expiry=Date.parse(order.rentalEndsAt),daysLeft=(expiry-Date.now())/86400000,id=`NT-RENT-${order.id}`;
  if(!Number.isFinite(expiry)||daysLeft>7||daysLeft<0||data.notifications.has(id))continue;
  const customer=data.customers.get(order.customerId);
  const notification={id,role:'OWN',saleId:order.saleId,title:'Sắp hết hạn thuê',text:`${customer?.name||order.customerName||'Khách hàng'} · ${order.productName} · còn ${Math.ceil(daysLeft)} ngày`,at:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,16),readBy:[]};
  await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0',['notifications',id,JSON.stringify(notification)]);
  await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',['rental-'+crypto.randomUUID(),'SYSTEM',JSON.stringify([{key:'notifications',id,before:null,after:notification}])]);
  data.notifications.set(id,notification);
 }
}

// Chia trong giao dich dang giu crm_write_lock: webhook dong thoi khong trung luot.
// Người nhận data tự động: Leader được bật + nhánh Manager có Sale trực tiếp.
function automaticLeaders(data,config){
 const members = [...data.members.values()].filter(p => p.active !== false);
 const leaders = members.filter(p => p.role === 'LEADER' && p.teamId && (config.enabledLeaderIds || []).includes(p.id));
 const saleConfigs = data.saleDistributionByLeader.get('$') || {};
 const directSales = managerId => members.filter(p=>p.role==='SALE'&&(p.leaderId===managerId||p.managerId===managerId&&!members.some(l=>l.role==='LEADER'&&l.id===p.leaderId)));
 for(const manager of members.filter(p=>p.role==='MANAGER')){
  const ownConfig=saleConfigs['manager:'+manager.id]||{};
  const ownConfigured=Array.isArray(ownConfig.enabledSaleIds)&&ownConfig.enabledSaleIds.length>0;
  if(directSales(manager.id).some(p=>!ownConfigured||ownConfig.enabledSaleIds.includes(p.id)))leaders.push({...manager,directManagerBranch:true});
 }
 leaders.sort((a,b)=>a.id.localeCompare(b.id));
 return {members,leaders,saleConfigs,directSales};
}
// distributeAutomatic chỉ ghi khi có khách đang chờ chia và có người nhận; ngoài ra nó trả 0 mà không đổi gì.
// Kiểm tra trước trên dữ liệu đã có trong RAM để lượt lưu bình thường không phải quét lại DB khi giữ khóa.
function automaticPending(data){
 const config=data.leaderDistribution.get('$')||{};
 if(config.enabled!==true)return false;
 const offered=new Set([...data.dataOffers.values()].filter(o=>o.status==='PENDING').map(o=>o.customerId));
 const waiting=[...data.customers.values()].some(row=>!row.saleId&&!row.leaderId&&!row.teamId&&!row.managerId&&row.status!=='ARCHIVED'&&!offered.has(row.id));
 return waiting&&automaticLeaders(data,config).leaders.length>0;
}
async function distributeAutomatic(c, data = null) {
 data ||= await allData(c);
 const config = data.leaderDistribution.get('$') || {};
 const settings = JSON.parse(JSON.stringify(data.settings.get('$') || {}));
 if (config.enabled !== true) return 0;
 const mode = settings.assignmentMode;
 const automatic = ['EQUAL','ROUND_ROBIN','BALANCED'].includes(mode);
 const {members,leaders,saleConfigs,directSales} = automaticLeaders(data,config);
 if(!leaders.length)return 0;
 const history = [];
 const at = new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);
 const cursor = settings.assignmentCursor ||= {leaders:0,salesByTeam:{}};
 cursor.salesByTeam ||= {};
 const weight = (weights,id) => { const raw = Number(weights?.[id]); return Number.isFinite(raw) ? Math.max(0,Math.min(100,Math.round(raw))) : 1; };
 const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const pick = (people, weights, key, team) => {
  people = people.filter(person => weight(weights, person.id) > 0);
  if (!people.length) return null;
  // BALANCED and ROUND_ROBIN both use the same weighted cycle. This keeps
  // the incoming-data order, the pending queue and the cycle counter aligned.
  const weighted = mode === 'ROUND_ROBIN' || mode === 'BALANCED';
  const candidates = weighted ? people.flatMap(person => Array.from({length: weight(weights, person.id)}, () => person)) : people;
  const raw = team ? cursor.salesByTeam[key] : cursor.leaders;
  let stateCursor = typeof raw === 'object' && raw ? {index:Number.isInteger(raw.index)?raw.index:0,ids:Array.isArray(raw.ids)?raw.ids.map(String):[]} : {index:Number.isInteger(raw)?raw:0,ids:[]};
  const candidateIds = candidates.map(person=>person.id);
  let roundIds = stateCursor.ids.filter(id=>candidateIds.includes(id));
  if (!roundIds.length || stateCursor.index >= roundIds.length) { roundIds=candidateIds; stateCursor.index=0; }
  const targetId=roundIds[stateCursor.index];
  const person=candidates.find(candidate=>candidate.id===targetId)||null;
  stateCursor.index += 1; stateCursor.ids=roundIds;
  if (team) cursor.salesByTeam[key]=stateCursor; else cursor.leaders=stateCursor;
  return person;
 };
 const roster=distributionRounds.recipients(members,config,saleConfigs);
 const globalRecipients=roster.people,globalWeights=roster.weights;
 let globalConfig=saleConfigs.$||{id:'ROUND-1',enabledSaleIds:globalRecipients.map(p=>p.id),weights:globalWeights};
 let roundsChanged=false;
 const put = async (key,id,value) => {
  history.push({key,id,before:data[key].get(id) || null,after:value});
  await project(c,key,id,value);
  await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0',[key,id,JSON.stringify(value)]);
  data[key].set(id,value);
 };
 // Chi chia hang cho Admin. Khach da vao Team (ke ca het han 24h) de Leader phan lai.
 const waiting = [...data.customers.values()].filter(row=>!row.saleId&&!row.leaderId&&!row.teamId&&!row.managerId&&row.status!=='ARCHIVED'&&![...data.dataOffers.values()].some(o=>o.customerId===row.id&&o.status==='PENDING'))
  .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
 let count = 0;
 for (const row of waiting) {
  const sourceRule = (config.sourceRules || []).find(rule => {
   if (rule.active === false || !leaders.some(leader => leader.id === rule.targetLeaderId)) return false;
   const value = rule.matchType === 'WEBSITE' ? row.websiteId : rule.matchType === 'CAMPAIGN' ? row.campaign : row.source;
   return normalize(value) === normalize(rule.matchValue);
  });
  const globalSettings=saleConfigs.$;
  const globalDistributionConfigured=Boolean(globalSettings&&(
   (Array.isArray(globalSettings.rounds)&&globalSettings.rounds.length>0)||
   (Array.isArray(globalSettings.enabledSaleIds)&&globalSettings.enabledSaleIds.length>0)||
   (globalSettings.weights&&Object.keys(globalSettings.weights).length>0)
  ));
  if (automatic && (!sourceRule || globalDistributionConfigured)) {
   const step=distributionRounds.take(globalConfig,distributionRounds.cursorFrom(cursor),globalRecipients,mode);
   globalConfig=step.config;roundsChanged ||= step.changed;
   cursor.global=step.cursor;
   delete cursor.salesByTeam.global;
   const recipient=globalRecipients.find(p=>p.id===step.id);
   if(!recipient)continue;
   const direct=recipient.teamLeaderRecipient===true;
   const managerDirect=recipient.managerRecipient===true;
   const assignedLeaderId=direct?recipient.id:(recipient.directManagerBranch?null:(recipient.leaderId||null));
   const assignedTeamId=recipient.teamId||null;
   const assignedManagerId=managerDirect?recipient.id:(recipient.directManagerBranch?recipient.managerId:(recipient.role==='SALE'&&recipient.managerId&&!recipient.leaderId?recipient.managerId:null));
   const next={...row,leaderId:assignedLeaderId,teamId:assignedTeamId,managerId:assignedManagerId,saleId:direct?recipient.id:null,saleAcceptedAt:(direct||managerDirect)?at:null,updatedAt:at,note:'Phan tu dong theo vong chung'};
   await put('customers',row.id,next);
   if(!direct&&!managerDirect){const id='OFR-'+crypto.randomUUID();await put('dataOffers',id,{id,customerId:row.id,saleId:recipient.id,leaderId:assignedLeaderId,teamId:assignedTeamId,offeredAt:at,status:'PENDING',resolvedAt:'',source:'AUTO'});}
   if(direct){const id='TSK-'+crypto.randomUUID();const dueAt=new Date(Date.parse(at.replace(' ','T')+'+07:00')+(Number(settings.slaMinutes)||30)*60000).toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);await put('tasks',id,{id,customerId:row.id,customerName:row.name,ownerId:recipient.id,leaderId:assignedLeaderId,teamId:assignedTeamId,type:'Lien he data moi',createdAt:at,dueAt,slaBased:true,status:'OPEN',priority:'HIGH'});}
   const id='ASN-'+crypto.randomUUID();await put('assignmentHistory',id,{id,customerId:row.id,fromSaleId:null,fromLeaderId:null,toSaleId:next.saleId,toLeaderId:assignedLeaderId,toLeaderName:assignedLeaderId?members.find(p=>p.id===assignedLeaderId)?.name||'':'',toSaleName:direct||managerDirect?recipient.name:'',offeredSaleId:direct||managerDirect?null:recipient.id,managerId:assignedManagerId,teamId:assignedTeamId,actorId:'SYSTEM',actor:'He thong',source:'AUTO',reason:next.note,at});
   const notificationId='NT-'+crypto.randomUUID();await put('notifications',notificationId,{id:notificationId,role:managerDirect?'MANAGER':'OWN',saleId:managerDirect?null:recipient.id,managerId:assignedManagerId,leaderId:assignedLeaderId,teamId:assignedTeamId,title:'Data moi duoc phan',text:row.name,at,readBy:[]});
   count++;
   continue;
  }
  const leader = automatic ? (sourceRule ? leaders.find(item => item.id === sourceRule.targetLeaderId) : pick(leaders,config.weights,'leaders',false)) : null;
  if (!leader) continue;
  const saleConfigKey=leader.directManagerBranch?'manager:'+leader.id:leader.id;
  let saleConfig = saleConfigs[saleConfigKey] || {};
  const manager = leader.managerId ? members.find(p=>p.role==='MANAGER'&&p.id===leader.managerId) : null;
  const managerRecipient = leader.directManagerBranch
   ? {...leader,role:'SALE',actualRole:'MANAGER',managerRecipient:true,leaderId:null,teamId:leader.teamId}
   : manager ? {...manager,role:'SALE',actualRole:'MANAGER',managerRecipient:true,leaderId:leader.id,teamId:leader.teamId} : null;
  const configuredRecipients=Array.isArray(saleConfig.enabledSaleIds)&&saleConfig.enabledSaleIds.length>0;
  if(managerRecipient && saleConfig.managerDistributionInitialized !== true && Array.isArray(saleConfig.enabledSaleIds) && !saleConfig.enabledSaleIds.includes(managerRecipient.id)){
   saleConfig={...saleConfig,enabledSaleIds:[...saleConfig.enabledSaleIds,managerRecipient.id],managerDistributionInitialized:true};
   saleConfigs[saleConfigKey]=saleConfig;
  }
  const managerEnabled = managerRecipient && (!configuredRecipients || saleConfig.enabledSaleIds.includes(managerRecipient.id));
  const recipients = leader.directManagerBranch ? [
   ...(managerRecipient ? [managerRecipient] : []),
   ...directSales(leader.id).filter(p=>!configuredRecipients||saleConfig.enabledSaleIds.includes(p.id))
  ] : [
   ...members.filter(p=>p.id===leader.id && saleConfig.leaderEnabled!==false),
   ...members.filter(p=>p.teamId===leader.teamId && p.role==='SALE'&&p.leaderId===leader.id&&(!configuredRecipients||saleConfig.enabledSaleIds.includes(p.id))),
   ...(managerEnabled ? [managerRecipient] : [])
  ].sort((a,b)=>a.id.localeCompare(b.id));
  const recipient = automatic ? pick(recipients,saleConfig.weights,leader.id,true) : null;
  const assignedLeaderId=leader.directManagerBranch?(recipient?.leaderId||null):leader.id;
  const assignedTeamId=leader.directManagerBranch?recipient?.teamId:leader.teamId;
  const direct = recipient?.id===leader.id&&!recipient?.managerRecipient;
  const managerDirect = recipient?.managerRecipient === true;
  const next = {...row,leaderId:assignedLeaderId,teamId:assignedTeamId,managerId:leader.directManagerBranch?leader.id:managerDirect?recipient.id:(row.managerId||null),saleId:direct?leader.id:null,saleAcceptedAt:(direct||managerDirect)?at:null,updatedAt:at,note:'Ph\u00e2n t\u1ef1 \u0111\u1ed9ng theo t\u1ef7 tr\u1ecdng'};
  await put('customers',row.id,next);
  if (recipient && !direct && !managerDirect) {
   const id='OFR-'+crypto.randomUUID();
   await put('dataOffers',id,{id,customerId:row.id,saleId:recipient.id,leaderId:assignedLeaderId,teamId:assignedTeamId,offeredAt:at,status:'PENDING',resolvedAt:'',source:'AUTO'});
  }
  if (direct) {
   const id='TSK-'+crypto.randomUUID();
   const dueAt=new Date(Date.parse(at.replace(' ','T')+'+07:00')+(Number(settings.slaMinutes)||30)*60000).toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19);
   await put('tasks',id,{id,customerId:row.id,customerName:row.name,ownerId:leader.id,leaderId:leader.id,teamId:leader.teamId,type:'Li\u00ean h\u1ec7 data m\u1edbi',createdAt:at,dueAt,slaBased:true,status:'OPEN',priority:'HIGH'});
  }
  const id='ASN-'+crypto.randomUUID();
  await put('assignmentHistory',id,{id,customerId:row.id,fromSaleId:null,fromLeaderId:null,toSaleId:next.saleId,toLeaderId:assignedLeaderId,toLeaderName:leader.name,toSaleName:direct?leader.name:managerDirect?recipient.name:'',offeredSaleId:direct||managerDirect?null:recipient?.id||null,managerId:leader.directManagerBranch?leader.id:managerDirect?recipient.id:null,teamId:assignedTeamId,actorId:'SYSTEM',actor:'H\u1ec7 th\u1ed1ng',source:'AUTO',reason:next.note,at});
  const notificationId='NT-'+crypto.randomUUID();
  await put('notifications',notificationId,{id:notificationId,role:managerDirect?'MANAGER':recipient?'OWN':'LEADER',saleId:managerDirect?null:recipient?.id||null,managerId:leader.directManagerBranch?leader.id:managerDirect?recipient.id:null,leaderId:assignedLeaderId,teamId:assignedTeamId,title:recipient?'Data m\u1edbi \u0111\u01b0\u1ee3c ph\u00e2n':'Kh\u00e1ch m\u1edbi trong Team',text:row.name,at,readBy:[]});
  count++;
 }
 if (count || roundsChanged) {
  if(roundsChanged)await put('saleDistributionByLeader','$',{...saleConfigs,$:globalConfig});
  await put('settings','$',settings);
  await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',['auto-'+crypto.randomUUID(),'SYSTEM',JSON.stringify(history)]);
 }
 return count || (roundsChanged?1:0);
}

// Bộ đệm dữ liệu dùng chung cho các lượt đọc passive (F5 + đồng bộ 15 giây).
// Trước đây mỗi người dùng tự SELECT toàn bộ 6 bảng và dựng lại mọi bản ghi; 30 người
// cùng lúc là 30 lượt quét đầy đủ xếp hàng trên một luồng Node nên F5 quá 20 giây.
// - Các lượt đọc đồng thời dùng chung một truy vấn (single-flight).
// - Ghi qua CRM gọi invalidateSnapshotCache() nên người khác thấy ngay thay đổi.
// - TTL ngắn bao phủ ghi từ tiến trình khác (worker Telegram, cron) không gọi được hàm trên.
// Dữ liệu trong cache là chỉ đọc: snapshot()/publicValue() luôn tạo object mới khi cần sửa.
const SNAPSHOT_CACHE_TTL_MS=Math.max(0,Number(typeof process!=='undefined'&&process.env?.CRM_SNAPSHOT_CACHE_MS!=null?process.env.CRM_SNAPSHOT_CACHE_MS:3000)||0);
let sharedCache={generation:0,data:null,loadedAt:0,loading:null};
function invalidateSnapshotCache(){sharedCache={generation:sharedCache.generation+1,data:null,loadedAt:0,loading:null};}
async function loadSharedData(){
 const c=await pool.getConnection();
 try{await c.beginTransaction();const data=await allData(c,{mirrorAttendance:false});await c.commit();data.revisions=new WeakMap();return data;}
 catch(e){await c.rollback().catch(()=>{});throw e;}
 finally{c.release();}
}
function sharedData(){
 const entry=sharedCache;
 if(entry.data&&Date.now()-entry.loadedAt<SNAPSHOT_CACHE_TTL_MS)return Promise.resolve(entry.data);
 if(entry.loading)return entry.loading;
 const loading=loadSharedData().then(data=>{
  // Có lượt ghi xen giữa: trả dữ liệu cho người đang chờ nhưng không giữ lại làm cache.
  if(sharedCache===entry){entry.data=data;entry.loadedAt=Date.now();}
  return data;
 }).finally(()=>{if(entry.loading===loading)entry.loading=null;});
 entry.loading=loading;
 return loading;
}
async function read(user, options={}){
 await prepare();
 if(options.passive===true)return snapshot(user,await sharedData(),{compact:options.full!==true});
 try{return await readActive(user);}finally{invalidateSnapshotCache();}
}
async function readActive(user){const c=await pool.getConnection();try{await c.beginTransaction();await c.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');const data=await allData(c,{mirrorAttendance:true});await expireOffers(c,data);const assigned=await distributeAutomatic(c,data);await warnRentalExpiry(c,data);const result=snapshot(user,assigned?await allData(c):data);await c.commit();return result;}catch(e){await c.rollback().catch(()=>{});throw e;}finally{c.release();}}
function noteOnlyCustomerChange(oldValue, nextValue) {
 if (!oldValue || !nextValue || typeof oldValue !== 'object' || typeof nextValue !== 'object') return false;
 const allowed = new Set(['note','updatedAt']);
 const keys = new Set([...Object.keys(oldValue), ...Object.keys(nextValue)]);
 for (const key of keys) { if (!allowed.has(key) && canonical(oldValue[key]) !== canonical(nextValue[key])) return false; }
 return true;
}
function fastNoteScope(user, row, members) {
 if (!row || user?.active === false) return false;
 if (user.role === 'ADMIN') return true;
 if (user.role === 'SALE') return String(row.sale_id || '') === String(user.id);
 if (user.role === 'LEADER') return String(row.leader_id || '') === String(user.id) || String(row.team_id || '') === String(user.teamId || '');
 if (user.role === 'MANAGER') {
  if (String(row.manager_id || '') === String(user.id)) return true;
  const leader = members.find(member => String(member.id) === String(row.leader_id || ''));
  return Boolean(leader && String(leader.managerId || '') === String(user.id) && String(leader.teamId || '') === String(row.team_id || ''));
 }
 return false;
}
async function writeFastCustomerNotes(user, requestId, changes, enabled = false) {
 if (!enabled || !Array.isArray(changes) || !changes.length) return null;
 const customerChanges = changes.filter(change => change?.key === 'customers');
 if (!customerChanges.length || changes.some(change => !['customers','notes','audit'].includes(change?.key))) return null;
 await prepare();
 const ids = [...new Set(customerChanges.map(change => String(change.id)))];
 const c = await pool.getConnection();
 try {
  const [done] = await c.query('SELECT actor_id FROM crm_changes WHERE request_id=? LIMIT 1', [requestId]);
  if (done.length) { if (String(done[0].actor_id) !== String(user.id)) error(409, 'Mã yêu cầu đã tồn tại.'); await c.rollback().catch(() => {}); return {...await read(user,{passive:true}),ok:true,replayed:true}; }
  const [rows] = await c.query('SELECT * FROM customers WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const [members] = await c.query('SELECT id,role,team_id,leader_id,active FROM users WHERE active=1');
  const memberRows = members.map(row => ({id:String(row.id),role:row.role,teamId:row.team_id||'',leaderId:row.leader_id||null,managerId:null,active:!!row.active}));
  const leaderIds = [...new Set(memberRows.filter(row => row.role === 'LEADER' && row.leaderId).map(row => row.leaderId))];
  if (leaderIds.length) {
   const [leaders] = await c.query('SELECT id,leader_id FROM users WHERE id IN (' + leaderIds.map(() => '?').join(',') + ')', leaderIds);
   const managerByLeader = new Map(leaders.map(row => [String(row.id), String(row.leader_id || '')]));
   for (const member of memberRows) member.managerId = managerByLeader.get(member.id) || null;
  }
  const history = [];
  for (const change of customerChanges) {
   const row = byId.get(String(change.id));
   if (!row) error(409, 'Khách hàng không còn tồn tại.');
   const old = coreRow('customers', row);
   if (!noteOnlyCustomerChange(old, change.value)) { await c.rollback().catch(() => {}); return null; }
   if (!fastNoteScope(user, row, memberRows)) error(403, 'Bạn không có quyền sửa ghi chú khách này.');
   // Bản ghi đã đổi ở máy khác: chuyển sang đường ghi đầy đủ để gộp theo trường thay vì báo 409.
   if (change.base && revision(old) !== change.base) { await c.rollback().catch(() => {}); return null; }
   const next = change.value;
   const note = String(next.note || '').slice(0, 2000);
   const updatedAt = String(next.updatedAt || new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19)).slice(0,19);
   await c.execute('UPDATE customers SET note=?, updated_at=? WHERE id=?', [note, updatedAt, row.id]);
   const [docRows] = await c.query("SELECT body FROM crm_documents WHERE collection='customers' AND id=? LIMIT 1", [row.id]);
   let body = docRows[0]?.body;
   if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
   body = {...(body || {}), ...next, id:String(row.id), note, updatedAt};
   await c.execute("INSERT INTO crm_documents(collection,id,body,deleted) VALUES ('customers',?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0", [row.id, JSON.stringify(body)]);
   history.push({key:'customers',id:String(row.id),before:old,after:body});
  }
  for (const change of changes.filter(item => item.key === 'notes' || item.key === 'audit')) {
   validate(change.key, change.value, change.id);
   await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=VALUES(deleted)', [change.key, change.id, JSON.stringify(change.value || {}), change.value ? 0 : 1]);
   history.push({key:change.key,id:change.id,before:null,after:change.value});
  }
  await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)', [requestId, user.id, JSON.stringify(history)]);
  await c.commit();
  // Bỏ cache trước khi đọc (trong dataAfterCommit): nếu không, snapshot trả về là bản cũ và ô vừa ghi nhảy về giá trị trước.
  return {...snapshot(user, await dataAfterCommit()), ok:true, fastPath:'customer-note'};
 } catch (error) { await c.rollback().catch(() => {}); throw error; }
 finally { c.release(); }
}

// Gộp theo trường: nhiều người cùng sửa một khách (khác cột) không còn bị 409 khóa cả phiên lưu.
// Cột trùng nhau thì lượt lưu sau thắng; các cột người khác vừa sửa được giữ nguyên.
const BLOCKED_FIELDS=new Set(['__proto__','constructor','prototype','id']);
function mergeCustomerFields(old,next,fields){
 const merged=JSON.parse(JSON.stringify(old));
 for(const path of fields){
  if(typeof path!=='string'||!path||path.length>200)error(400,'Trường khách không hợp lệ');
  if(path.startsWith('customFields.')){
   const field=path.slice(13);if(!field||BLOCKED_FIELDS.has(field))error(400,'Trường khách không hợp lệ');
   merged.customFields={...(merged.customFields||{})};
   if(next.customFields&&Object.hasOwn(next.customFields,field))merged.customFields[field]=next.customFields[field];else delete merged.customFields[field];
   continue;
  }
  if(BLOCKED_FIELDS.has(path))error(400,'Trường khách không hợp lệ');
  if(Object.hasOwn(next,path))merged[path]=next[path];else delete merged[path];
 }
 return merged;
}
// Dữ liệu sau khi áp các thay đổi của lượt lưu (chỉ trong RAM, không đụng DB).
function withChanges(data,changes){
 const next={...data};
 for(const {key,id,value} of changes){
  if(!(data[key] instanceof Map))continue;
  if(next[key]===data[key])next[key]=new Map(data[key]);
  if(value)next[key].set(id,value);else next[key].delete(id);
 }
 return next;
}
// Đọc lại sau commit (ngoài khóa ghi): bỏ cache cũ rồi dùng chung một lượt tải với các người dùng khác.
async function dataAfterCommit(){invalidateSnapshotCache();return sharedData();}
async function writeLocked(user,requestId,changes,options={}){
 if(typeof requestId!=='string'||!/^[-\w]{1,96}$/.test(requestId)||!Array.isArray(changes)||changes.length>2000)error(400,'Gói lưu không hợp lệ');
 const fastResult = await writeFastCustomerNotes(user, requestId, changes, options.fastNote === true);
 if (fastResult) return fastResult;
 if(typeof requestId!=='string'||!/^[-\w]{1,96}$/.test(requestId)||!Array.isArray(changes)||changes.length>2000)error(400,'Gói lưu không hợp lệ');
 await prepare();const c=await pool.getConnection();
 try{
  await c.beginTransaction();
  await c.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
  const [done]=await c.execute('SELECT actor_id FROM crm_changes WHERE request_id=?',[requestId]);
  if(done.length){if(done[0].actor_id!==user.id)error(409,'Mã yêu cầu đã tồn tại');await c.commit();return {...snapshot(user,await dataAfterCommit()),ok:true,replayed:true};}
  const data=await allData(c),seen=new Set(),history=[];
  // Telegram và Web dùng chung khóa ghi: giữ lần điểm danh đầu tiên của mỗi ngày.
  const attendanceDays=new Set([...data.attendance.values()].map(row=>JSON.stringify([row.accountId,row.date])));
  const duplicateAttendance=new Set();
  // Kiểm tra khách trước; ghi chú/công việc/đơn có thể tham chiếu khách mới trong cùng giao dịch.
  changes=changes.map(change=>({...change})).sort((a,b)=>(a.key==='customers'?0:1)-(b.key==='customers'?0:1));
  const prospective={...data,customers:new Map(data.customers)};
  // Kiểm tra toàn bộ xung đột/quyền trước khi ghi bất kỳ bảng nào.
  for(const change of changes){
   const {key,id}=change;let {base,value}=change;
   if(!data[key]||typeof id!=='string'||!/^[-\w.$:]{1,96}$/.test(id)||seen.has(`${key}/${id}`))error(400,'Mã bản ghi không hợp lệ/trùng');
   if(OBJECTS.includes(key)&&id!=='$')error(400,'Khóa cấu hình không hợp lệ');
   seen.add(`${key}/${id}`);
   const old=data[key].get(id);
   if(key==='customers'&&old&&value&&Array.isArray(change.fields)&&change.fields.length<=200){
    const current=revision(publicValue(user,key,old,data));
    if(current!==base){change.value=value=mergeCustomerFields(old,value,change.fields);change.base=base=current;}
   }
   if(key==='customers'&&user.role==='SALE'&&old&&pendingOffer(data,user,old.id)&&value){
     change.value={...old,saleId:user.id,saleAcceptedAt:value.saleAcceptedAt||new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19),updatedAt:value.updatedAt||new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,19),status:value.status||old.status,note:value.note!==undefined?value.note:old.note};
   }
   validate(key,change.value,id);
   if(key==='members'&&old?.role==='ADMIN'&&old.active!==false&&(!value||value.role!=='ADMIN'||value.active===false)&&[...data.members.values()].filter(r=>r.role==='ADMIN'&&r.active!==false).length<=1)error(400,'Phải giữ ít nhất một Admin hoạt động');
   if(revision(old===undefined?undefined:publicValue(user,key,old,data))!==base)error(409,`Bản ghi ${key}/${id} đã được máy khác cập nhật. Xuất bản nháp rồi tải lại.`);
   authorize(user,key,key==='settings'&&old?publicValue(user,key,old,data):old,change.value,key==='customers'?data:prospective);
   if(key==='attendance'&&value&&user.role==='ADMIN'&&value.editedById){
    const date=String(value.date||''),at=String(value.at||'');
    if(!prospective.members.has(value.accountId))error(400,'Nhân viên không tồn tại');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'})||at.slice(0,10)!==date||!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:00$/.test(at))error(400,'Ngày giờ điểm danh không hợp lệ');
    if(old&&(old.accountId!==value.accountId||old.date!==value.date))error(400,'Không được chuyển bản ghi sang nhân viên hoặc ngày khác');
    if(value.editedById!==user.id||typeof value.note!=='string'||!value.note.trim()||value.note.length>300)error(400,'Thông tin điều chỉnh không hợp lệ');
    const minutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
    const lateMinutes=Math.max(0,minutes(at.slice(11,16))-minutes(data.settings.get('$')?.attendanceDeadline||'09:00'));
    if(value.lateMinutes!==lateMinutes||value.late!==(lateMinutes>0))error(400,'Kết quả đi muộn không khớp giờ điểm danh');
    if(!old&&attendanceDays.has(JSON.stringify([value.accountId,date])))error(409,'Ngày này vừa có điểm danh. Tải lại trước khi sửa.');
   }
   if(key==='attendance'&&!old&&change.value){
    const dayKey=JSON.stringify([change.value.accountId,change.value.date]);
    if(attendanceDays.has(dayKey)){duplicateAttendance.add(change);continue;}
    attendanceDays.add(dayKey);
   }
   if(key==='settings'&&value&&user.role!=='ADMIN')change.value={...old,...value,...(user.role==='MANAGER'?{saleAssignmentModes:{...old?.saleAssignmentModes,...value.saleAssignmentModes}}:{})};
   if(key==='saleDistributionByLeader'&&value&&user.role==='MANAGER')change.value={...old,...value};
   history.push({key,id,before:old??null,after:change.value});
   if(key==='customers'){if(change.value)prospective.customers.set(id,change.value);else prospective.customers.delete(id);}
  }
  for(const {key,id,value} of changes){
   if(key!=='customers'||data.customers.has(id)||value?.createdVia!=='ORDER')continue;
   if(!changes.some(c=>c.key==='orders'&&c.value?.customerId===id&&!data.orders.has(c.id)&&c.value?.receiptsVersion===1&&c.value?.createdBy===user.id))error(403,'Khách tạo từ đơn phải được lưu cùng đơn và bill');
   const phoneKey=v=>String(v||'').replace(/\D/g,'').replace(/^84/,'0');
   if([...data.customers.values()].some(c=>phoneKey(c.phone)&&phoneKey(c.phone)===phoneKey(value.phone)))error(409,'Số điện thoại đã tồn tại. Tải lại hoặc nhờ quản lý kiểm tra khách trước khi tạo đơn.');
  }
  const resulting=new Map(data.customers);
  for(const change of changes.filter(x=>x.key==='customers')){if(change.value)resulting.set(change.id,change.value);else resulting.delete(change.id);}
  for(const change of changes.filter(x=>x.key==='orders'&&x.value)){if(!resulting.has(change.value.customerId))error(400,'Khách của đơn chưa tồn tại');}
  const resultingMembers=new Map(data.members);
  for(const change of changes.filter(x=>x.key==='members')){if(change.value)resultingMembers.set(change.id,change.value);else resultingMembers.delete(change.id);}
  if([...data.members.values()].some(r=>r.role==='ADMIN'&&r.active!==false)&&![...resultingMembers.values()].some(r=>r.role==='ADMIN'&&r.active!==false))error(400,'Phải giữ ít nhất một Admin hoạt động');
  for(const m of resultingMembers.values()){
   if(m.managerId&&(!['LEADER','SALE'].includes(m.role)||resultingMembers.get(m.managerId)?.role!=='MANAGER'||resultingMembers.get(m.managerId)?.active===false))error(400,'Leader hoặc Sale phải thuộc Manager đang hoạt động');
  }
  const resultingProducts=new Map(data.products);
  for(const change of changes.filter(x=>x.key==='products')){if(change.value)resultingProducts.set(change.id,change.value);else resultingProducts.delete(change.id);}
  const productSkus=new Set();
  for(const product of resultingProducts.values()){const sku=String(product.sku||'').trim().toLowerCase();if(!sku)continue;if(productSkus.has(sku))error(400,'Mã SKU sản phẩm đã tồn tại');productSkus.add(sku);}
  for(const {key,id,value}of changes.filter(change=>!duplicateAttendance.has(change))){
   await project(c,key,id,value);
   await c.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=VALUES(deleted)',[key,id,JSON.stringify(value===null?data[key].get(id)||{}:value),value===null?1:0]);
  }
  await c.execute('INSERT INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)',[requestId,user.id,JSON.stringify(history)]);
  // Chỉ quét lại DB + chia data khi thật sự có khách đang chờ chia. Lượt lưu thường (đổi trạng thái,
  // sửa đơn, cấu hình...) commit và nhả khóa ghi chung ngay: 20 người lưu cùng lúc không còn phải chờ
  // nhau từng lượt đọc toàn bộ 6 bảng. Snapshot trả về dựng sau commit, ngoài khóa.
  if(options.skipAutomatic!==true&&automaticPending(withChanges(data,changes))){
   const updated=await allData(c);await distributeAutomatic(c,updated);
  }
  await c.commit();
  return {...snapshot(user,await dataAfterCommit()),ok:true};
 }catch(e){await c.rollback().catch(()=>{});throw e;}finally{c.release();}
}
// Mọi lượt ghi qua CRM làm mới bộ đệm snapshot dùng chung (kể cả khi lỗi giữa chừng).
async function write(user,requestId,changes,options={}){try{return await writeLocked(user,requestId,changes,options);}finally{invalidateSnapshotCache();}}
function assetFromData(user, data, type, id, childId = null) {
 const key = type === 'process' ? 'processes' : type === 'feedback' ? 'feedbacks' : 'orders';
 const source=data.state||data; const row = source[key]?.get ? source[key].get(id) : (source[key]||[]).find(item => String(item.id)===String(id));
 if (!row) error(404,'Khong tim thay du lieu anh.');
 if (type === 'process') { const images=Array.isArray(row.imageData)?row.imageData:(row.imageData?[row.imageData]:[]); return {id:row.id,images}; }
 if (type === 'feedback') return {id:row.id,imageData:row.imageData||''};
 const receipt=(row.paymentReceipts||[]).find(item=>String(item.id)===String(childId));
 if(!receipt)error(404,'Khong tim thay bill.');
 const images=Array.isArray(receipt.images)?receipt.images:(receipt.billImage?[{id:`${receipt.id}-image`,imageData:receipt.billImage,note:receipt.note||''}]:[]);
 return {orderId:row.id,receiptId:receipt.id,images};
}
async function readAsset(user, type, id, childId = null) {
 const data = await read(user, {passive:true, full:true});
 return assetFromData(user, new Map(Object.entries(data.state)), type, id, childId);
}
async function readAuditPage(user, page=1, limit=50) {
 const result = await read(user,{passive:true,full:true}); const all=result.state.audit||[]; const safePage=Math.max(1,Number(page)||1), safeLimit=Math.min(200,Math.max(1,Number(limit)||50));
 return {items:all.slice((safePage-1)*safeLimit,safePage*safeLimit),page:safePage,limit:safeLimit,total:all.length,hasMore:all.length>safePage*safeLimit};
}
module.exports={mergeCustomerFields,invalidateSnapshotCache,queueTelegramNotice,snapshot,readAsset,assetFromData,readAuditPage,distributeAutomatic,prepare,seedProductCatalog,read,write,writeFastCustomerNotes,revision,canonical,coreRow,userRow,authorize,readable,validate,LISTS,OBJECTS,SCHEMA};
