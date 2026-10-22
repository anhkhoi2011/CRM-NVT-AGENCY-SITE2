'use strict';
// Test chạy theo thư mục gốc dự án: fs đọc file và require module từ gốc.
const ROOT=require('node:path').resolve(__dirname,'..');process.chdir(ROOT);
require=require('node:module').createRequire(ROOT+'/');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(ROOT+'/index.html','utf8');
const source=fs.readFileSync(ROOT+'/reference-crm.js','utf8');

test('F5: HTML mẫu được che ngay cả khi CSS ngoài chưa tải',()=>{
 const guard=html.match(/<style id="crm-startup-guard">([\s\S]*?)<\/style>/)[1];
 assert.match(guard,/body:not\(\.reference-ready\) > \.app-shell/);
 assert.match(guard,/visibility:hidden!important/);
 assert.doesNotMatch(html,/crm-instant-preheat|document\.documentElement\.classList\.add\('reference-ready'\)/);
});
test('F5: chỉ mở shell sau khi dựng tab và phân quyền',()=>{
 const code=source.slice(source.indexOf('  function refresh('),source.indexOf('  updateCustomerClass='));
 const reveal=code.indexOf("document.body.classList.add('reference-ready')");
 assert.ok(reveal>code.indexOf('paintTab(initialTab)'));
 assert.ok(reveal>code.indexOf('applyRoleVisibility()'));
 assert.ok(reveal>code.indexOf('restoreCustomerSelections()'));
 const cacheBoot=source.slice(source.indexOf('  const cachedSnapshot=readCachedSnapshot();'));
 assert.doesNotMatch(cacheBoot,/classList.add\('reference-ready'\)|bootScreen\?\.setAttribute\('hidden'/);
});
test('F5: hết thời gian chờ không tự hiển thị iframe hoặc ẩn splash',()=>{
 const start=source.indexOf('  const revealLoginFallback=');
 const end=source.indexOf("  window.addEventListener('crm:session-changed'",start);
 const timers=[];let refreshes=0;
 const boot={hidden:false};
 const context={data:null,bootScreen:boot,bootFallbackTimer:null,refresh(){refreshes++;},console,setTimeout(fn){timers.push(fn);}};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'revealLoginFallback();',context);
 for(let n=0;n<40;n++)timers.shift()();
 assert.equal(boot.hidden,false);assert.equal(refreshes,41);
 context.data={user:{id:'sale'}};timers.shift()();assert.equal(timers.length,0);
});
test('F5: chỉ runtime xác nhận unauthenticated mới được hiện login',()=>{
 const start=source.indexOf('  function refresh(force=false,suppliedSnapshot=null) {');
 const end=source.indexOf('    if(!next){',start);
 for(const authState of ['restoring','authenticated','unauthenticated']){
  const context={data:null,bootScreen:null,customerSaveQueue:{pending:0},normalizeAccountingMenu(){},document:{hidden:false,activeElement:{}},working:false,workflowBusy:false,q:()=>null,frame:{contentWindow:{crmApi:{snapshot:()=>null},crmRuntimeAuthState:authState,crmRuntimeBooted:true}},api:null,reachedLogin:false};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'reachedLogin=true;} refresh(true);',context);
  assert.equal(context.reachedLogin,authState==='unauthenticated');
 }
});

function restoreHarness(responses){
 const runtime=fs.readFileSync(ROOT+'/crm.js','utf8');
 const code=`let serverBootstrap=null,bootstrapReadPromise=null,bootstrapReadToken='';\n${runtime.slice(runtime.indexOf('async function readBootstrap'),runtime.indexOf('let serverReadPromise'))}\n${runtime.slice(runtime.indexOf('let runtimeRestorePromise='),runtime.indexOf('async function initialize()'))}`;
 const timers=[],removed=[],seen=[],nodes={};let session={token:'t'};
 const storage={getItem:()=>JSON.stringify(session)};
 const ctx={window:{},sessionStorage:storage,localStorage:storage,SESSION_KEY:'session',WEBHOOK_FETCH_TIMEOUT_MS:25000,serverSyncToken:'',console,AbortController,
  setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},webhookApiBase:()=>'',
  $:key=>nodes[key]||=( {classList:{add(){},remove(){}},textContent:''}),removeRuntimeSession(){removed.push(true);session=null;},
  fetch:async()=>{seen.push(true);const result=responses.shift();if(result instanceof Error)throw result;return result;},startSession:async()=>true};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,timers,removed,seen};
}
test('F5: 503 giữ token và thử lại nền thay vì chờ ba request liên tiếp',async()=>{
 const h=restoreHarness([{ok:false,status:503},{ok:true,status:200,json:async()=>({user:{id:'u',role:'SALE'},navigation:['dashboard'],settings:{},version:'1',stats:null,storage:{mode:'mysql',durable:true}})}]);
 assert.equal(await h.ctx.restoreRuntimeSession(),false);assert.equal(h.seen.length,1);assert.equal(h.ctx.serverSyncToken,'t');assert.equal(h.removed.length,0);
 assert.ok(h.timers.some(t=>t.delay===25000));assert.ok(h.timers.some(t=>t.delay===3000));assert.equal(h.ctx.window.crmRuntimeAuthState,'restoring');
 assert.equal(await h.ctx.restoreRuntimeSession(),true);assert.equal(h.ctx.window.crmRuntimeAuthState,'authenticated');assert.equal(h.ctx.window.crmRuntimeRestoreError,'');
});
test('F5: chỉ 401 mới xóa phiên, không tự thử lại token hết hạn',async()=>{
 const h=restoreHarness([{ok:false,status:401,json:async()=>({error:'Expired'})}]);assert.equal(await h.ctx.restoreRuntimeSession(),false);
 assert.equal(h.removed.length,1);assert.equal(h.ctx.serverSyncToken,'');assert.equal(h.ctx.window.crmRuntimeAuthState,'unauthenticated');assert.ok(!h.timers.some(t=>t.delay===3000));
});
test('F5: bấm thử lại liên tiếp chỉ có một request khôi phục đang chạy',async()=>{
 let release;const h=restoreHarness([]);h.ctx.fetch=()=>new Promise(resolve=>{release=resolve;h.seen.push(true);});
 const a=h.ctx.restoreRuntimeSession(),b=h.ctx.restoreRuntimeSession();assert.equal(a,b);assert.equal(h.seen.length,1);
 release({ok:true,status:200,json:async()=>({user:{id:'u',role:'SALE'},navigation:['dashboard'],settings:{},version:'1',stats:null,storage:{mode:'mysql',durable:true}})});await a;
});
test('HTML runtime có version vẫn phải kiểm tra lại cache khi deploy',()=>{
 const server=fs.readFileSync(ROOT+'/webhook-server.cjs','utf8');
 assert.match(server,/'Cache-Control':extension==='\.html' \? 'no-cache'/);
 assert.match(html,/crm-runtime\.html\?v=[\w-]+/);
});
test('Tab đã mở được lưu riêng theo tài khoản, không kế thừa tab Marketing sang Admin',()=>{
 const start=source.indexOf('  const activeTabStorageKey=');
 const end=source.indexOf('  const tabAllowedForSnapshot=',start);
 const values=new Map([['nvt-crm-active-tab-v1','tab-marketing'],['nvt-crm-active-tab-v1:marketing-1','tab-marketing']]);
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 const context={ACTIVE_TAB_KEY:'nvt-crm-active-tab-v1',data:{user:{id:'admin-1',role:'ADMIN'}},sessionStorage:storage,localStorage:storage,snapshotRole:value=>value?.user?.actualRole||value?.user?.role||''};
 vm.createContext(context);
 const tabs=vm.runInContext(source.slice(start,end)+';({activeTabStorageKey,rememberActiveTab,savedActiveTab})',context);
 assert.equal(tabs.savedActiveTab(),'','Admin không đọc tab Marketing cũ dùng chung');
 context.data={user:{id:'marketing-1',role:'MARKETING'}};
 assert.equal(tabs.savedActiveTab(),'tab-marketing','Tài khoản Marketing vẫn giữ tab của chính nó');
 tabs.rememberActiveTab('tab-profile');
 context.data={user:{id:'admin-1',role:'ADMIN'}};
 tabs.rememberActiveTab('tab-customers');
 assert.equal(tabs.savedActiveTab(),'tab-customers');
 context.data={user:{id:'marketing-1',role:'MARKETING'}};
 assert.equal(tabs.savedActiveTab(),'tab-profile');
});
test('Actions re-render immediately after save instead of waiting for the 15s poll',()=>{
 const src=require('node:fs').readFileSync('reference-crm.js','utf8');
 const body=src.slice(src.indexOf('async function run(action,done)'),src.indexOf('function project()'));
 // refresh() bỏ qua lượt vẽ khi working=true; lượt vẽ sau khi lưu phải nằm sau finally.
 assert.ok(body.indexOf('finally{working=false;}')>=0);
 assert.ok(body.lastIndexOf('refresh(true)')>body.indexOf('finally{working=false;}'));
 assert.doesNotMatch(body,/try \{ const result=await action\(\); if\(done\)done\(result\); refresh\(true\)/);
 assert.match(src,/finally\{workflowBusy=false;\}\s*if\(done\)refresh\(true\);/);
 assert.match(src,/if\(saved\)refresh\(true\);/);
});

// The shell and its nested order API must invalidate the same release together.
test('Order selector, runtime frame and create-order API use the same release',()=>{
 const html=fs.readFileSync('index.html','utf8'),runtime=fs.readFileSync('crm-runtime.html','utf8');
 const shellVersion=html.match(/src="reference-crm\.js\?v=([^"&]+)/)[1];
 const frameVersion=html.match(/src="crm-runtime\.html\?v=([^"&]+)/)[1];
 const apiVersion=runtime.match(/src="crm-runtime-api\.js\?v=([^"&]+)/)[1];
 assert.equal(frameVersion,shellVersion,'The runtime iframe must be refreshed with the order selector');
 assert.equal(apiVersion,shellVersion,'The nested API must match the shell release');
 assert.ok(fs.readFileSync('webhook-server.cjs','utf8').includes("const BUILD_VERSION = '"+shellVersion+"';"),'Hosting health identifies this order release');
});
