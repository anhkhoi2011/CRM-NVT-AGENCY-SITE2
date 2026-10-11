'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createJournal}=require('../webhook-journal.cjs');
const source=require('node:fs').readFileSync(require.resolve('../webhook-server.cjs'),'utf8');
const record=(id,day='2026-10-11')=>({id:'WHE-'+id,dedupeKey:id,receivedAt:day+' 12:00:00',slug:'DS-TEST',status:'NEW',customer:{name:'Test',phone:'0901234567'}});
test('Journal survives reopening; acknowledgement removes only the processed event',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-webhook-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const journal=createJournal(dir);await journal.put(record('1'));await journal.put(record('2'));
 assert.equal((await createJournal(dir).list()).length,2);
 await journal.remove(record('1'));await journal.remove(record('1'));
 assert.deepEqual((await journal.list()).map(r=>r.id),['WHE-2']);
 await assert.rejects(()=>journal.put({...record('3'),id:'../../escape'}));
 await fs.writeFile(path.join(dir,'WHE-bad.json'),'{');
 assert.equal((await journal.list()).length,1);
});
function recovery({inbox=[],pending=[],fail='',notification=false,cleanupFail=false,listFail=false}={}){
 const writes=[],removed=[];let wakes=0,invalidations=0;
 const context={inbox,WEBHOOK_RECOVERY_DATE:'2026-10-11',console,Map,webhookJournal:{list:async()=>{if(listFail)throw Error('disk unavailable');return pending;},remove:async r=>{if(cleanupFail)throw Error('unlink failed');removed.push(r.id);}},notificationWebsiteForSlug:async()=>notification?{provider:'NOTIFICATION'}:null,persistWebhook:async(r,opts)=>{if(typeof fail==='function'?fail(r):r.id===fail)throw Error('SQL failed');writes.push({r,opts});return {customerId:'CUS-'+r.id};},scheduleFlush:()=>{},crmData:{invalidateSnapshotCache:()=>invalidations++},wakeTelegramOutbox:()=>wakes++};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let webhookRecoveryRunning = false;'),source.indexOf('const systemSchemaReady')),context);
 return {run:()=>context.recoverLegacyInbox(),writes,removed,get wakes(){return wakes;},get invalidations(){return invalidations;}};
}
test('Historical recovery only processes incident date, leaves older and confirmed records untouched',async()=>{
 const old=record('old','2026-10-10'),today=record('today'),saved={...record('saved'),persisted:true};
 const before=JSON.stringify(old);const f=recovery({inbox:[old,today,saved]});await f.run();
 assert.deepEqual(f.writes.map(w=>w.r.id),['WHE-today']);assert.equal(f.writes[0].opts.skipAutomatic,true);assert.equal(JSON.stringify(old),before);assert.equal(f.invalidations,1);
 await f.run();assert.equal(f.writes.length,1);
});
test('One SQL failure does not discard pending records or stop recovery of the next event',async()=>{
 const f=recovery({pending:[record('fail'),record('ok')],fail:'WHE-fail'});await f.run();
 assert.deepEqual(f.removed,['WHE-ok']);assert.equal(f.writes.length,1);assert.equal(f.wakes,1);
});
test('Recovery never imports notification-only webhooks as customers',async()=>{
 const f=recovery({pending:[record('notification')],notification:true});await f.run();assert.equal(f.writes.length,0);assert.equal(f.removed.length,0);
});
test('Outbox fallback runs without a healthy local worker and leaves a running worker in charge',async()=>{
 let sent=0,state='standby';const context={inlineTelegramScheduler:false,telegramWorker:{status:()=>state},telegramBot:{drainLeadNotifications:async()=>sent++},console};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function wakeTelegramOutbox()'),source.indexOf('const supportChat =')),context);
 context.wakeTelegramOutbox();await Promise.resolve();assert.equal(sent,1);state='running';context.wakeTelegramOutbox();await Promise.resolve();assert.equal(sent,1);
});
test('Webhook durably captures the record before SQL lookups and keeps it on SQL failure',async()=>{
 const events=[];let response;
 const context={SLUG_PATTERN:/.*/,checkToken:()=>true,contentTypeOf:()=>({base:'application/json'}),readBody:async()=>Buffer.from('{}'),decodeBody:()=>({phone:'0901234567'}),adaptLadiPagePayload:()=>({ok:true,record:{name:'Test',phone:'0901234567'},flat:{}}),dedupeKey:()=> 'key',stamp:()=> '2026-10-11 12:00:00',crypto:require('node:crypto'),Date,DEMO_MODE:false,webhookJournal:{put:async()=>events.push('journal'),remove:async()=>events.push('remove')},notificationWebsiteForSlug:async()=>{events.push('lookup');throw Error('SQL down');},sendJson:(res,status,body)=>{response={status,body};},console};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function handleWebhook('),source.indexOf('/* ------------------------------------------------------- inbox read + SSE */')),context);
 await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.deepEqual(events,['journal','lookup']);assert.equal(response.status,503);assert.equal(response.body.queued,true);
});

test('Recovery timer survives failed startup readiness and continues retrying',async()=>{
 let callback,attempts=0;
 const context={dbConfigured:true,DEMO_MODE:false,systemSchemaReady:Promise.resolve(false),recoverLegacyInbox:async()=>attempts++,console,setInterval:fn=>{callback=fn;return {unref(){}};},clearInterval:()=>{},server:{once:()=>{}}};
 vm.createContext(context);
 const begin=source.indexOf('// Keep retrying even if MySQL was unavailable');
 vm.runInContext(source.slice(begin,source.indexOf('server.listen(PORT',begin)),context);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,1);
 callback();await Promise.resolve();assert.equal(attempts,2);
});

test('SQL failure retains journal; successful replay returns stable event ID without duplicate inbox rows',async()=>{
 const pending=new Set(),inbox=[];let fail=true,response;
 const context={SLUG_PATTERN:/.*/,checkToken:()=>true,contentTypeOf:()=>({base:'application/json'}),readBody:async()=>Buffer.from('{}'),decodeBody:()=>({}),adaptLadiPagePayload:()=>({ok:true,record:{name:'Test',phone:'0901234567'},flat:{}}),dedupeKey:()=> 'key',stamp:()=> '2026-10-11 12:00:00',crypto:require('node:crypto'),Date,DEMO_MODE:false,dbConfigured:true,crmData:{invalidateSnapshotCache(){}},webhookJournal:{put:async r=>pending.add(r.id),remove:async r=>pending.delete(r.id)},notificationWebsiteForSlug:async()=>null,persistWebhook:async()=>{if(fail)throw Error('SQL down');return {eventId:'WHE-stable',customerId:'CUS-stable',replay:true,duplicate:true};},sendJson:(res,status,body)=>{response={status,body};},console,inbox,MAX_INBOX_RECORDS:5000,scheduleFlush:()=>{},notifyInboxListeners:()=>{},wakeTelegramOutbox:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function handleWebhook('),source.indexOf('/* ------------------------------------------------------- inbox read + SSE */')),context);
 await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.equal(response.status,503);assert.equal(pending.size,1);assert.equal(inbox.length,0);
 fail=false;await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.equal(response.status,200);assert.equal(response.body.id,'WHE-stable');assert.equal(pending.size,1);
 await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.equal(inbox.length,1);assert.equal(pending.size,1);
});

test('Committed recovery refreshes CRM even when journal cleanup fails',async()=>{
 const f=recovery({pending:[record('saved')],cleanupFail:true});await f.run();
 assert.equal(f.writes.length,1);assert.equal(f.invalidations,1);assert.equal(f.wakes,1);
});
test('Legacy and journal copies of the same event are acknowledged together',async()=>{
 const legacy=record('legacy'),pending={...record('pending'),dedupeKey:legacy.dedupeKey};
 const f=recovery({inbox:[legacy],pending:[pending]});await f.run();
 assert.equal(f.writes.length,1);assert.equal(legacy.persisted,true);assert.equal(pending.persisted,true);
 assert.ok(f.removed.includes(pending.id));
});
test('A full batch of failures does not starve later pending leads',async()=>{
 const pending=Array.from({length:101},(_,i)=>record(String(i)));
 const f=recovery({pending,fail:r=>r.id!=='WHE-100'});await f.run();await f.run();
 assert.ok(f.writes.some(w=>w.r.id==='WHE-100'));
});
test('Telegram wake is independent of a journal filesystem failure',async()=>{
 const f=recovery({listFail:true});await assert.rejects(f.run(),/disk unavailable/);assert.equal(f.wakes,1);
});

test('Webhook invalidates a snapshot populated during SQL intake only after SQL success',async()=>{
 const actions=[];let fail=false;
 const context={SLUG_PATTERN:/.*/,checkToken:()=>true,contentTypeOf:()=>({base:'application/json'}),readBody:async()=>Buffer.from('{}'),decodeBody:()=>({}),adaptLadiPagePayload:()=>({ok:true,record:{name:'Test',phone:'0901234567'},flat:{}}),dedupeKey:()=> 'key',stamp:()=> '2026-10-11 12:00:00',crypto:require('node:crypto'),Date,DEMO_MODE:false,dbConfigured:true,crmData:{invalidateSnapshotCache:()=>actions.push('invalidate')},webhookJournal:{put:async()=>{},remove:async()=>{}},notificationWebsiteForSlug:async()=>null,persistWebhook:async()=>{if(fail)throw Error('SQL failed');actions.push('commit');return {eventId:'WHE-test',customerId:'CUS-test'};},sendJson:(res,status)=>actions.push('response-'+status),console,inbox:[],MAX_INBOX_RECORDS:5000,scheduleFlush:()=>{},notifyInboxListeners:()=>{},wakeTelegramOutbox:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function handleWebhook('),source.indexOf('/* ------------------------------------------------------- inbox read + SSE */')),context);
 await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.deepEqual(actions,['commit','invalidate','response-200']);
 actions.length=0;fail=true;await context.handleWebhook({method:'POST'}, {},'DS-TEST');assert.deepEqual(actions,['response-503']);
});
