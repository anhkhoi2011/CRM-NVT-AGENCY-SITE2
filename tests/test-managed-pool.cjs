'use strict';
// Test chạy theo thư mục gốc dự án: fs đọc file và require module từ gốc.
const ROOT=require('node:path').resolve(__dirname,'..');process.chdir(ROOT);
require=require('node:module').createRequire(ROOT+'/');
const test=require('node:test'),assert=require('node:assert/strict');
const {managedPool}=require('./managed-pool.cjs');
function fixture(options={}){
 const events=[];
 const raw={async getConnection(){events.push('acquire');return {async query(){events.push('query');return [[1]];},async execute(){throw Error('SQL failed');},async beginTransaction(){},async rollback(){events.push('rollback');},release(){events.push('release');},destroy(){events.push('destroy');}};}};
 return {events,raw,pool:managedPool(raw,{limit:1,acquireTimeout:30,queryTimeout:30,...options})};
}
test('Automatic queries return connections on both success and SQL failure',async()=>{
 const f=fixture();assert.deepEqual(await f.pool.query('SELECT 1'),[[1]]);await assert.rejects(f.pool.execute('bad'),/SQL failed/);assert.equal(f.events.filter(x=>x==='release').length,2);assert.equal(f.pool.stats().active,0);
});
test('Timed-out queued requests are removed and never execute later',async()=>{
 const f=fixture(),held=await f.pool.getConnection();await assert.rejects(f.pool.query('SELECT 1'),{code:'DB_ACQUIRE_TIMEOUT'});assert.equal(f.pool.stats().queued,0);held.release();assert.deepEqual(f.events,['acquire','release']);await f.pool.query('SELECT 1');assert.equal(f.pool.stats().active,0);
});
test('Connection returned after acquisition deadline is destroyed exactly once',async()=>{
 let resolve,destroys=0;const raw={getConnection:()=>new Promise(r=>{resolve=r;})};const pool=managedPool(raw,{limit:1,acquireTimeout:10});await assert.rejects(pool.getConnection(),{code:'DB_ACQUIRE_TIMEOUT'});resolve({release(){},destroy(){destroys++;}});await new Promise(setImmediate);assert.equal(destroys,1);assert.equal(pool.stats().active,0);
});
test('Hung SQL destroys connection and cannot return a transaction to pool',async()=>{
 const f=fixture();f.raw.getConnection=async()=>({query:()=>new Promise(()=>{}),release(){f.events.push('release');},destroy(){f.events.push('destroy');}});await assert.rejects(f.pool.query('hung'),{code:'DB_QUERY_TIMEOUT'});assert.deepEqual(f.events,['destroy']);assert.equal(f.pool.stats().active,0);
});
test('Queued callers are served in order; duplicate release cannot exceed limit',async()=>{
 const f=fixture({acquireTimeout:500});const first=await f.pool.getConnection(),next=f.pool.getConnection();assert.equal(f.pool.stats().queued,1);first.release();first.release();const second=await next;assert.equal(f.pool.stats().active,1);second.release();assert.equal(f.pool.stats().active,0);
});
test('Dedicated authentication pool remains available when data pool is full',async()=>{
 const data=fixture(),auth=fixture();const held=await data.pool.getConnection();assert.deepEqual(await auth.pool.query('SELECT user'),[[1]]);held.release();
});
test('Connection creation failure frees slot for next request',async()=>{
 const f=fixture();const original=f.raw.getConnection;f.raw.getConnection=async()=>{throw Error('connection failed');};await assert.rejects(f.pool.getConnection(),/connection failed/);assert.equal(f.pool.stats().active,0);f.raw.getConnection=original;await f.pool.query('SELECT 1');
});
test('Fatal handlers log once and exit instead of continuing unsafe state',()=>{
 const {EventEmitter}=require('node:events'),target=new EventEmitter(),logs=[],exits=[];target.exit=code=>exits.push(code);require('./process-safety.cjs').installProcessSafety(target,{error:(...args)=>logs.push(args)});target.emit('unhandledRejection',Error('fatal-test'));target.emit('uncaughtException',Error('again'));assert.deepEqual(exits,[1]);assert.equal(logs.length,1);assert.match(logs[0][2],/fatal-test/);
});

test('Rollback failure discards the connection instead of reusing its transaction',async()=>{
 const events=[],pool=managedPool({getConnection:async()=>({rollback:async()=>{throw Error('rollback failed');},destroy:()=>events.push('destroy'),release:()=>events.push('release')})},{limit:1});const c=await pool.getConnection();await assert.rejects(c.rollback(),/rollback failed/);c.release();assert.deepEqual(events,['destroy']);assert.equal(pool.stats().active,0);
});
test('Deployment copies both new runtime modules to the Node app',()=>{
 const text=require('node:fs').readFileSync(ROOT+'/.cpanel.yml','utf8');const line=text.split('\n').find(line=>line.includes('webhook-server.cjs')&&line.includes('$CRMPATH'));assert.ok(line.includes('managed-pool.cjs'));assert.ok(line.includes('process-safety.cjs'));
 assert.ok(line.includes('password-service.cjs'));assert.ok(line.includes('password-worker.cjs'));
});

test('Eight database leases run concurrently and the next waits for release',async()=>{
 const f=fixture({limit:8,acquireTimeout:1000});const leases=await Promise.all(Array.from({length:8},()=>f.pool.getConnection()));assert.equal(f.pool.stats().active,8);const pending=f.pool.getConnection();assert.equal(f.pool.stats().queued,1);leases[0].release();const last=await pending;assert.equal(f.pool.stats().active,8);leases.slice(1).forEach(c=>c.release());last.release();assert.equal(f.pool.stats().active,0);assert.equal(f.pool.stats().queued,0);
});
test('Database defaults and overrides use supported driver options and managed acquisition timeout',()=>{
 const configs=[],fs=require('node:fs'),vm=require('node:vm');function load(env){const context={module:{exports:{}},__dirname:ROOT,process:{env},console,require:name=>name==='dotenv'?{config(){}}:name==='mysql2/promise'?{createPool:options=>{configs.push(options);return {on(){},end(){}};}}:require(name)};vm.runInNewContext(fs.readFileSync(ROOT+'/db.js','utf8'),context);return context.module.exports;}
 const defaults=load({});assert.equal(defaults.pool.stats().limit,60);assert.equal(defaults.authPool.stats().limit,25);assert.equal(configs[0].connectTimeout,10000);assert.equal(configs[0].queueLimit,0);assert.equal(configs[0].waitForConnections,true);assert.equal('acquireTimeout' in configs[0],false);
 const custom=load({DB_CONNECTION_LIMIT:'12',DB_AUTH_CONNECTION_LIMIT:'4'});assert.equal(custom.pool.stats().limit,12);assert.equal(custom.authPool.stats().limit,4);
});

test('Pool limits are capped against stale hosting environment values',()=>{
 const db=require('node:fs').readFileSync(ROOT+'/db.js','utf8');assert.ok(db.includes("setting('DB_CONNECTION_LIMIT', 60)"));assert.ok(db.includes("setting('DB_AUTH_CONNECTION_LIMIT', 25)"));
});

test('All 25 stalled authentication acquisitions time out and the next wave recovers',async()=>{
 const late=[];let stalled=true,destroyed=0;
 const raw={getConnection(){if(stalled)return new Promise(resolve=>late.push(resolve));return Promise.resolve({query:async()=>[[1]],release(){},destroy(){}});}};
 const pool=managedPool(raw,{limit:25,acquireTimeout:20});
 const first=await Promise.allSettled(Array.from({length:25},()=>pool.getConnection()));
 assert.ok(first.every(r=>r.status==='rejected'&&r.reason.code==='DB_ACQUIRE_TIMEOUT'));
 assert.equal(pool.stats().active,0);stalled=false;
 const held=await pool.getConnection();
 late.forEach(resolve=>resolve({destroy(){destroyed++;},release(){throw Error('late lease released');}}));
 await new Promise(setImmediate);
 assert.equal(destroyed,25);assert.equal(pool.stats().active,1);
 held.release();await Promise.all(Array.from({length:50},()=>pool.query('SELECT 1')));
 assert.equal(pool.stats().active,0);assert.equal(pool.stats().queued,0);
});
test('Throwing destroy on a late connection cannot strand the next lease',async()=>{
 let resolve;const pool=managedPool({getConnection:()=>new Promise(r=>{resolve=r;})},{limit:1,acquireTimeout:10});
 await assert.rejects(pool.getConnection(),{code:'DB_ACQUIRE_TIMEOUT'});
 resolve({destroy(){throw Error('already closed');}});await new Promise(setImmediate);
 assert.equal(pool.stats().active,0);
});


test('Every local UI script and stylesheet is included in both deployment roots',()=>{
 const fs=require('node:fs'),deployment=fs.readFileSync(ROOT+'/.cpanel.yml','utf8');
 const copyLines=deployment.split('\n').filter(line=>line.includes('/bin/cp -R'));
 for(const destination of ['$PUBLICPATH','$CRMPATH']){
  const line=copyLines.find(line=>line.trim().endsWith(destination));
  assert.ok(line,'Missing deployment destination '+destination);
  const files=new Set(line.trim().split(/\s+/));
  for(const page of ['index.html','crm-runtime.html','commission_tree_demo.html']){
   const html=fs.readFileSync(ROOT+'/'+page,'utf8');
   for(const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)){
    const file=match[1].split(/[?#]/)[0].replace(/^\.\//,'');
    if(/^(?:[a-z]+:|\/\/)/i.test(file)||! /\.(?:js|css)$/.test(file))continue;
    assert.ok(fs.existsSync(ROOT+'/'+file),page+' references missing file '+file);
    assert.ok(files.has(file),destination+' is missing '+file+' referenced by '+page);
   }
  }
 }
});
