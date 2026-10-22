'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

const ROOT=path.resolve(__dirname,'..');

function fixture(){
  const calls=[];
  const rows=[{id:'c1',name:'Khách A',phone:'0901',email:'a@example.test',source:'web',campaign:'c1',website_id:'w1',status:'NEW',sale_id:'sale-1',leader_id:'lead-1',team_id:'team-1',note:'',created_at:'2026-10-20 10:00:00',updated_at:'2026-10-20 10:00:00'}];
  const execute=async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('1=0')){
      if(sql.includes('SELECT COUNT(*) AS total FROM customers'))return [[{total:0}]];
      if(sql.includes('SELECT c.id,c.name,c.phone'))return [[]];
    }
    if(sql.includes('SELECT COUNT(*) AS total FROM customers'))return [[{total:rows.length}]];
    if(sql.includes('SELECT c.id,c.name,c.phone'))return [rows];
    if(sql.includes('SELECT id,account_code'))return [[]];
    if(sql.includes('information_schema.columns')&&sql.includes('COUNT(*)'))return [[{total:1}]];
    if(sql.includes('information_schema.columns')&&sql.includes('column_name'))return [[{column_name:'telegram_chat_id'},{column_name:'telegram_username'}]];
    if(sql.includes('role_type'))return [[{role_type:"'ADMIN','MANAGER','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','HRM'"}]];
    if(sql.includes('SELECT setting_key,setting_value FROM system_settings'))return [[]];
    if(sql.includes("SELECT deleted FROM crm_documents WHERE collection='customFieldDefinitions'"))return [[{deleted:0}]];
    if(sql.includes('SELECT DISTINCT collection FROM crm_documents'))return [[]];
    if(sql.includes('product_catalog_20260914_v1'))return [[{setting_key:'product_catalog_20260914_v1'}]];
    if(sql.includes('SELECT id FROM crm_write_lock'))return [[{id:1}]];
    return [[]];
  };
  const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:execute,execute};
  const pool={query:execute,execute,getConnection:async()=>connection};
  const module={exports:{}};
  const rootRequire=createRequire(path.join(ROOT,'crm-data.cjs'));
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'crm-data.cjs'),'utf8'),{
    module,require:name=>name==='./db.js'?{pool}:rootRequire(name),Buffer,console,
    crypto:rootRequire('node:crypto'),Date,JSON,Map,Set,WeakMap,structuredClone,process
  });
  return {api:module.exports,calls};
}

test('customer page uses direct SQL, shared count/page filters and a small column set',async()=>{
  const f=fixture();
  const page=await f.api.readCustomerPage({id:'admin',role:'ADMIN'},{page:'2',limit:'20',search:'khách',status:'NEW',sort:'name',direction:'asc'});
  assert.equal(page.page,2);
  assert.equal(page.limit,20);
  assert.equal(page.total,1);
  assert.equal(page.items[0].id,'c1');
  const count=f.calls.find(call=>call.sql.includes('SELECT COUNT(*) AS total FROM customers'));
  const rows=f.calls.find(call=>call.sql.includes('SELECT c.id,c.name,c.phone'));
  assert.ok(count);assert.ok(rows);
  assert.match(rows.sql,/ORDER BY c\.name ASC,c\.id ASC LIMIT \? OFFSET \?/);
  assert.equal(count.sql.slice(count.sql.indexOf(' FROM ')),rows.sql.slice(rows.sql.indexOf(' FROM '),rows.sql.indexOf(' ORDER BY')));
  assert.doesNotMatch(rows.sql,/SELECT \* FROM customers/);
  assert.equal(Object.hasOwn(page.items[0],'custom_fields_json'),false);
  assert.equal(Object.hasOwn(page.items[0],'password_hash'),false);
});

test('customer page applies role scope from the authenticated user',async()=>{
  for(const user of [
    {id:'admin',role:'ADMIN'},
    {id:'accounting',role:'ACCOUNTING'},
    {id:'marketing',role:'MARKETING'},
    {id:'sale-1',role:'SALE'},
    {id:'lead-1',role:'LEADER',teamId:'team-1'},
    {id:'manager-1',role:'MANAGER'}
  ]){
    const f=fixture();
    await f.api.readCustomerPage(user,{limit:10});
    const row=f.calls.find(call=>call.sql.includes('SELECT c.id,c.name,c.phone'));
    assert.ok(row, user.role);
    if(user.role==='SALE')assert.match(row.sql,/c\.sale_id=\?/);
    if(user.role==='LEADER')assert.match(row.sql,/c\.leader_id=\?/);
    if(user.role==='MANAGER')assert.match(row.sql,/JSON_EXTRACT\(cd\.body,'\$\.managerId'\)/);
    if(['ADMIN','ACCOUNTING','MARKETING'].includes(user.role))assert.doesNotMatch(row.sql,/1=0/);
  }
});

test('customer page rejects invalid page size and denies unsupported roles',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.api.readCustomerPage({id:'sale-1',role:'SALE'},{limit:'20.5'}),error=>error.status===400);
  const invalid=await f.api.readCustomerPage({id:'unknown',role:'INVALID'},{limit:10});
  assert.equal(invalid.total,0);
  const row=f.calls.find(call=>call.sql.includes('SELECT c.id,c.name,c.phone'));
  assert.match(row.sql,/1=0/);
});

test('customer page implementation does not call full snapshot readers',()=>{
  const source=fs.readFileSync(path.join(ROOT,'crm-data.cjs'),'utf8');
  const start=source.indexOf('async function readCustomerPage');
  const end=source.indexOf('\nmodule.exports=',start);
  const body=source.slice(start,end);
  assert.doesNotMatch(body,/\bread\s*\(/);
  assert.doesNotMatch(body,/\bsnapshot\s*\(/);
  assert.doesNotMatch(body,/\ballData\s*\(/);
});

test('customer page route relies on the authenticated session and leaves the legacy route intact',()=>{
  const source=fs.readFileSync(path.join(ROOT,'webhook-server.cjs'),'utf8');
  const routeStart=source.indexOf("if(pathname==='/api/customers/page'");
  const routeEnd=source.indexOf("if(pathname==='/api/telegram/link-status'",routeStart);
  const route=source.slice(routeStart,routeEnd);
  assert.ok(routeStart>source.indexOf('const user=await authUser(request)'));
  assert.match(route,/readCustomerPage\(user/);
  assert.doesNotMatch(route,/query\.get\(['"](?:role|userId|saleId|teamId)['"]\).*permission|scope/i);
  assert.match(source,/if\(request\.method==='GET'\)return dbJson\(request,response,200,\{items:resource==='users'\?snapshot\.state\.accounts:snapshot\.state\[key\],versions:snapshot\.versions\}\);/);
});
