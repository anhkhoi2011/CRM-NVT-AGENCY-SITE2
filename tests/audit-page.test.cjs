'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

const ROOT=path.resolve(__dirname,'..');

function fixture(){
  const auditRows=[
    {id:'a-admin',body:{id:'a-admin',actorId:'admin',actor:'Admin',role:'ADMIN',action:'LOGIN',entity:'AUTH',detail:'login',at:'2026-10-10 10:00:00'}},
    {id:'a-sale',body:{id:'a-sale',actorId:'sale',actor:'Sale',role:'SALE',action:'UPDATE_ORDER',entity:'o1',orderId:'o1',orderCode:'NVT-o1',customerName:'Khách A',detail:'đổi trạng thái',at:'2026-10-09 10:00:00'}},
    {id:'a-order',body:{id:'a-order',source:'ORDER_SQL',requestId:'req-1',actorId:'accounting',actor:'Kế toán',role:'ACCOUNTING',action:'UPDATE_BILL',entity:'o2',orderId:'o2',orderCode:'NVT-o2',customerName:'Khách B',detail:'bill',at:'2026-10-08 10:00:00'}}
  ];
  const calls=[];let activeUser=null;
  const execute=async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('SELECT COUNT(*) AS total FROM crm_documents d')){
      const visible=activeUser?.role==='ADMIN'?auditRows:activeUser?.role==='ACCOUNTING'?[auditRows[2]]:activeUser?.role==='SALE'?[auditRows[1]]:[];
      return [[{total:visible.length}]];
    }
    if(sql.includes('SELECT d.id,d.body FROM crm_documents d')){
      const visible=activeUser?.role==='ADMIN'?auditRows:activeUser?.role==='ACCOUNTING'?[auditRows[2]]:activeUser?.role==='SALE'?[auditRows[1]]:[];
      const limit=Number(values.at(-2)),offset=Number(values.at(-1));
      return [visible.slice(offset,offset+limit)];
    }
    if(sql.includes('role_type'))return [[{role_type:"'ADMIN','MANAGER','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','HRM'"}]];
    if(sql.includes('information_schema.columns')&&sql.includes('COUNT(*)'))return [[{total:1}]];
    if(sql.includes('information_schema.columns')&&sql.includes('column_name'))return [[{column_name:'telegram_chat_id'},{column_name:'telegram_username'}]];
    if(sql.includes("product_catalog_20260914_v1"))return [[{setting_key:'product_catalog_20260914_v1'}]];
    if(sql.includes('SELECT setting_key,setting_value FROM system_settings'))return [[]];
    if(sql.includes("SELECT deleted FROM crm_documents WHERE collection='customFieldDefinitions'"))return [[{deleted:0}]];
    if(sql.includes('SELECT DISTINCT collection FROM crm_documents'))return [[]];
    if(sql.includes('SELECT id FROM crm_write_lock'))return [[{id:1}]];
    return [[]];
  };
  const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:execute,execute};
  const pool={query:execute,getConnection:async()=>connection};
  const module={exports:{}};
  const rootRequire=createRequire(path.join(ROOT,'crm-data.cjs'));
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'crm-data.cjs'),'utf8'),{module,require:name=>name==='./db.js'?{pool}:rootRequire(name),Buffer,console,crypto:rootRequire('node:crypto'),Date,JSON,Map,Set,WeakMap,structuredClone,process});
  return {api:module.exports,calls,setUser(user){activeUser=user;}};
}

test('readAuditPage queries audit JSON directly and paginates in SQL',async()=>{
  const f=fixture();f.setUser({id:'admin',role:'ADMIN'});
  const page=await f.api.readAuditPage({id:'admin',role:'ADMIN'},1,1,{search:'khách',ordersOnly:true});
  assert.equal(page.total,3);assert.equal(page.limit,1);assert.equal(page.items.length,1);assert.equal(page.hasMore,true);
  const count=f.calls.find(call=>call.sql.includes('COUNT(*) AS total FROM crm_documents d'));
  const rows=f.calls.find(call=>call.sql.includes('SELECT d.id,d.body FROM crm_documents d'));
  assert.ok(count);assert.ok(rows);assert.match(rows.sql,/LIMIT \? OFFSET \?/);assert.match(rows.sql,/JSON_EXTRACT/);assert.doesNotMatch(rows.sql,/SELECT \*/);
  assert.equal(f.calls.some(call=>call.sql.includes('SELECT * FROM crm_documents WHERE collection IN')),false);
});

test('readAuditPage preserves actor scope for Sale and order scope for Accounting',async()=>{
  const f=fixture();
  f.setUser({id:'sale',role:'SALE'});
  const sale=await f.api.readAuditPage({id:'sale',role:'SALE'},1,50,{});
  assert.deepEqual(sale.items.map(item=>item.id),['a-sale']);
  const saleSql=f.calls.at(-1).sql;assert.match(saleSql,/JSON_EXTRACT\(d\.body,'\$\.actorId'\)/);
  f.setUser({id:'accounting',role:'ACCOUNTING'});
  const accounting=await f.api.readAuditPage({id:'accounting',role:'ACCOUNTING'},1,50,{ordersOnly:true});
  assert.deepEqual(accounting.items.map(item=>item.id),['a-order']);
  assert.match(f.calls.at(-1).sql,/EXISTS \(SELECT 1 FROM orders oa/);
});

test('readAuditPage clamps page size and returns empty pages without reading a full snapshot',async()=>{
  const f=fixture();f.setUser({id:'admin',role:'ADMIN'});
  const page=await f.api.readAuditPage({id:'admin',role:'ADMIN'},999,999,{});
  assert.equal(page.page,999);assert.equal(page.limit,200);assert.deepEqual(page.items,[]);assert.equal(page.hasMore,false);
  const source=fs.readFileSync(path.join(ROOT,'crm-data.cjs'),'utf8');
  const start=source.indexOf('async function readAuditPage');const end=source.indexOf('\nmodule.exports=',start);
  assert.doesNotMatch(source.slice(start,end),/\bread\s*\(/);assert.match(source.slice(start,end),/SELECT COUNT\(\*\)/);
  assert.equal(f.calls.some(call=>call.sql.includes('SELECT * FROM crm_documents WHERE collection IN')),false);
});
