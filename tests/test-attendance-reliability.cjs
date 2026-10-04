'use strict';
// Test chạy theo thư mục gốc dự án: fs đọc file và require module từ gốc.
const ROOT=require('node:path').resolve(__dirname,'..');process.chdir(ROOT);
require=require('node:module').createRequire(ROOT+'/');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(shared={claims:new Map(),attendance:new Map(),changes:new Set()}) {
 const events=[],sent=[],user={id:'sale-1',name:'Nhân viên',team_id:'TEAM',role:'SALE',telegram_chat_id:'123'};
 let failing=false,lookupFailure=false,slowAnswer=false,network=false;
 const execute=async(sql,args=[])=>{
  events.push('sql');
  if(sql.includes("'telegramDaily'")){
   if(sql.includes('INSERT IGNORE')){if(shared.claims.has(args[0]))return [{affectedRows:0}];shared.claims.set(args[0],JSON.parse(args[1]));return [{affectedRows:1}];}
   if(sql.startsWith('SELECT body'))return [shared.claims.has(args[0])?[{body:JSON.stringify(shared.claims.get(args[0]))}]:[]];
   if(sql.startsWith('UPDATE')){const old=shared.claims.get(args[1]);if(!old)return [{affectedRows:0}];
    if(sql.includes("='FAILED'")&&!(old.status==='FAILED'&&Number(old.attempts)===args[2]))return [{affectedRows:0}];
    shared.claims.set(args[1],JSON.parse(args[0]));return [{affectedRows:1}];}
   if(sql.startsWith('DELETE'))throw Error('Không được xóa dấu đã gửi nhắc điểm danh');
  }
  if(sql.includes('crm_changes')){shared.changes.add(args[0]);return [{affectedRows:1}];}
  if(sql.includes("collection='settings'"))return [[{body:{attendanceDeadline:'09:00'}}]];
  if(sql.includes("'attendance'")){
   if(shared.attendanceFailures>0){shared.attendanceFailures--;throw Object.assign(Error('timeout'),{code:'DB_QUERY_TIMEOUT'});}
   if(sql.startsWith('SELECT body')&&sql.includes('AND id=?')){const row=shared.attendance.get(args[0]);return [row?[{body:row}]:[]];}
   if(sql.startsWith('SELECT body'))return [[...shared.attendance.values()].filter(x=>x.accountId===args[0]&&x.date===args[1]).map(body=>({body}))];
   if(sql.includes('INSERT IGNORE')){if(shared.attendance.has(args[0]))return [{affectedRows:0}];shared.attendance.set(args[0],JSON.parse(args[1]));return [{affectedRows:1}];}
   if(sql.startsWith('UPDATE'))return [{affectedRows:0}];
  }
  throw Error(sql);
 };
 let releaseLock;
 const connection={execute,query:async()=>[[]],beginTransaction:async()=>{await shared.lock;shared.lock=new Promise(r=>{releaseLock=r;});},commit:async()=>{},rollback:async()=>{},release(){events.push('release');releaseLock?.();}};
 const context={module:{exports:{}},console,AbortSignal,Buffer,FormData,Blob,process:{env:{TELEGRAM_BOT_TOKEN:'fake-token',TELEGRAM_CHECKIN_GAP_MS:'0'}},setTimeout,clearTimeout,fetch:async(url,options)=>{const method=url.split('/').pop();events.push(method);if(slowAnswer&&method==='answerCallbackQuery')return new Promise(()=>{});if(network&&method==='sendMessage'){sent.push({method,...JSON.parse(options.body)});throw Error('ETIMEDOUT');}sent.push({method,...JSON.parse(options.body)});return {json:async()=>failing&&method==='sendMessage'?{ok:false,error_code:429,parameters:{retry_after:0}}:{ok:true,result:{message_id:1}}};},require(name){
  if(name==='./db.js')return {pool:{execute,getConnection:async()=>connection},telegramPool:{getConnection:async()=>connection},dbQuery:async(sql)=>{events.push('lookup');if(lookupFailure)throw Error('DB_QUERY_TIMEOUT');if(shared.lookupFailures>0){shared.lookupFailures--;throw Object.assign(Error('temporary lookup timeout'),{code:'DB_QUERY_TIMEOUT'});}return shared.staff || [user];}};
  if(name==='./support-chat.cjs')return {};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync('telegram-bot.cjs','utf8'),context);
 return {api:context.module.exports,events,sent,shared,connection,fail(value){failing=value;},failLookup(){lookupFailure=true;},slowAnswer(){slowAnswer=true;},network(value){network=value;}};
}
const callback={callback_query:{id:'cb',data:'checkin',from:{id:123},message:{chat:{id:123,type:'private'},message_id:10}}};
test('Repeated scheduler calls and worker restarts send only one reminder per recipient/day',async()=>{
 const a=fixture();assert.equal((await a.api.sendMorningCheckinAlert()).failed,0);
 const b=fixture(a.shared);await Promise.all([a.api.sendMorningCheckinAlert(),b.api.sendMorningCheckinAlert()]);
 assert.equal(a.sent.length+b.sent.length,1);assert.match(a.sent[0].text,/NHẮC ĐIỂM DANH/);
});
test('Rejected reminders are attempted once per day, including after worker restart',async()=>{
 const f=fixture();f.fail(true);assert.equal((await f.api.sendMorningCheckinAlert()).failed,1);
 f.fail(false);for(let i=0;i<11;i++)await f.api.sendMorningCheckinAlert();
 const next=fixture(f.shared);await next.api.sendMorningCheckinAlert();
 assert.equal(f.sent.length+next.sent.length,1);assert.equal([...f.shared.claims.values()][0].attempts,1);
});
test('Network timeout keeps the reminder reserved because it may already be delivered',async()=>{
 const f=fixture();f.network(true);await f.api.sendMorningCheckinAlert();f.network(false);
 for(let i=0;i<5;i++)await f.api.sendMorningCheckinAlert();
 assert.equal(f.sent.length,1);assert.equal([...f.shared.claims.values()][0].status,'UNKNOWN');
});
test('Reminder is keyed per user, so a changed chat id on the same day does not send again',async()=>{
 const f=fixture();await f.api.sendMorningCheckinAlert();assert.ok([...f.shared.claims.keys()][0].endsWith(':sale-1'));
});
test('Attendance callback answers before SQL and persists once across repeated clicks',async()=>{
 const f=fixture();await f.api.handleTelegramUpdate(callback);assert.equal(f.events[0],'answerCallbackQuery');assert.equal(f.shared.attendance.size,1);
 const record=[...f.shared.attendance.values()][0];await f.api.handleTelegramUpdate(callback);assert.equal(f.shared.attendance.size,1);assert.deepEqual([...f.shared.attendance.values()][0],record);assert.equal(f.shared.changes.size,1);assert.match(f.sent.at(-1).text,/Đã điểm danh lúc/);
});
test('Existing web check-in keeps its timestamp when Telegram is clicked',async()=>{
 const f=fixture(),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}),record={id:'web-attendance',accountId:'sale-1',date,at:date+' 08:15:00'};f.shared.attendance.set(record.id,record);
 await f.api.handleTelegramUpdate(callback);assert.equal(f.shared.attendance.size,1);assert.match(f.sent.at(-1).text,/08:15:00/);
});
test('Database error still answers the button and reports no successful check-in',async()=>{
 const f=fixture();f.failLookup();await f.api.handleTelegramUpdate(callback);assert.equal(f.events[0],'answerCallbackQuery');assert.equal(f.shared.attendance.size,0);assert.match(f.sent.at(-1).text,/Chưa lưu được/);
});
test('Forwarded group check-in cannot mark another person present',async()=>{
 const f=fixture();await f.api.handleTelegramUpdate({callback_query:{...callback.callback_query,from:{id:999}}});assert.equal(f.shared.attendance.size,0);assert.ok(!f.events.includes('lookup'));
});

test('Telegram phản hồi nút chậm không chặn lưu SQL và báo thành công',async()=>{
 const f=fixture();f.slowAnswer();
 let timer;
 try{await Promise.race([f.api.handleTelegramUpdate(callback),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Điểm danh bị chặn bởi mạng Telegram')),500);})]);}
 finally{clearTimeout(timer);}
 assert.equal(f.shared.attendance.size,1);assert.match(f.sent.at(-1).text,/Đã đồng bộ vào CRM/);
});

test('Check-in saves while another CRM user holds the shared write lock',async()=>{
 const f=fixture();f.shared.lock=new Promise(()=>{}); // khóa ghi chung bị giữ mãi
 let timer;
 try{await Promise.race([f.api.handleTelegramUpdate(callback),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Điểm danh phải chờ khóa ghi chung')),500);})]);}
 finally{clearTimeout(timer);}
 assert.equal(f.shared.attendance.size,1);assert.match(f.sent.at(-1).text,/Đã đồng bộ vào CRM/);
});
test('Simultaneous check-in clicks store one record',async()=>{
 const f=fixture();await Promise.all([f.api.handleTelegramUpdate(callback),f.api.handleTelegramUpdate(callback),f.api.handleTelegramUpdate(callback)]);
 assert.equal(f.shared.attendance.size,1);assert.ok(f.sent.filter(x=>x.method==='sendMessage'||x.method==='editMessageText').every(x=>/Đã điểm danh/.test(x.text)));
});
test('Transient database timeout during check-in is retried automatically',async()=>{
 const f=fixture();f.shared.attendanceFailures=1;await f.api.handleTelegramUpdate(callback);
 assert.equal(f.shared.attendance.size,1);assert.match(f.sent.at(-1).text,/Đã đồng bộ vào CRM/);
});

test('Several accounts linked to one chat receive only one daily reminder across concurrent workers',async()=>{
 const shared={claims:new Map(),attendance:new Map(),changes:new Set(),staff:[{id:'a',name:'A',telegram_chat_id:'123'},{id:'b',name:'B',telegram_chat_id:'123'},{id:'c',name:'C',telegram_chat_id:'456'}]};
 const a=fixture(shared),b=fixture(shared);await Promise.all([a.api.sendMorningCheckinAlert(),b.api.sendMorningCheckinAlert()]);
 const sent=[...a.sent,...b.sent];assert.equal(sent.filter(m=>String(m.chat_id)==='123').length,1);assert.equal(sent.filter(m=>String(m.chat_id)==='456').length,1);
});
test('Shared support token cannot replace system webhook or drop check-in callbacks',async()=>{
 const f=fixture();const result=await f.api.setSupportWebhook('https://example.test/support');assert.equal(result.skipped,true);assert.equal(f.sent.length,0);
 await f.api.handleTelegramUpdate(callback,'support');assert.equal(f.shared.attendance.size,1);assert.equal(f.events[0],'answerCallbackQuery');
});
test('New calendar day permits one new reminder while same-day calls remain suppressed',async()=>{
 const f=fixture();const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 f.shared.claims.set('checkin:2000-01-01:sale-1',{status:'SENT'});f.shared.claims.set('checkin-chat:2000-01-01:123',{status:'SENT'});
 await f.api.sendMorningCheckinAlert();await f.api.sendMorningCheckinAlert();assert.equal(f.sent.length,1);assert.equal(f.shared.claims.get('checkin:'+day+':sale-1').status,'SENT');
});

test('Transient linked-account lookup failure retries before reporting check-in failure',async()=>{const f=fixture();f.shared.lookupFailures=1;await f.api.handleTelegramUpdate(callback);assert.equal(f.shared.attendance.size,1);assert.equal(f.sent.filter(item=>item.method==='sendMessage').length,0);});
