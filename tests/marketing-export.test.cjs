'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Hub=require('../marketing-hub.js'),Export=require('../marketing-export.cjs');
const required=['phone','sale','level','status','call_status','notes','updated_at','created_at','source','goi_ket_noi','first_call_at','ket_qua_cham_soc','level_khach_hang','phan_loai_khach_hang','tinh_trang_nhan_tai_lieu','course','province','age_range','gender','job','capital_range','experience','market_interest','main_interest','main_objection','revenue','deposit_amount','first_deposit_at'];
const lead={id:'c1',name:'A',phone:'0901234567',saleId:'s',createdAt:'2026-10-01 10:00:00',updatedAt:'2026-10-01 10:00:00',customFields:{customerLevel:'L5'}};
function payload(customer=lead,orders=[],notes=[]){return Export.formatLeadPayload(customer,new Map([['s','Sale A']]),new Map([['c1',orders]]),new Map([['c1',notes]]));}
test('Export contract retains missing keys and separates collected order revenue from broker deposits',()=>{
 const data=payload(lead,[{status:'DEPOSIT',total:5000000,amountPaid:1000000},{status:'PAID',total:2000000,refund:100000}]);
 for(const key of required)assert.ok(Object.hasOwn(data,key),key);
 assert.equal(data.revenue,2900000);assert.equal(data.deposit_amount,null);assert.equal(data.first_deposit_at,null);assert.equal(data.sale,'Sale A');assert.equal(data.created_at,'2026-10-01T10:00:00+07:00');
 assert.equal(payload({...lead,customFields:{deposit_amount:'invalid'}}).deposit_amount,null);
});
test('Export preserves note-only updates, original notes, first call history and CRM result aliases',()=>{
 const state={customers:[{...lead,note:'Original'}],orders:[],customerFieldHistory:[{customerId:'c1',fieldId:'callStatus',to:'CONTACTED',at:'2026-10-01 10:12:00',source:'SALE'}],notes:[{customerId:'c1',text:'New note',at:'2026-10-10 12:00:00'}]};
 const prepared=Hub.prepareData(state).customers[0],data=payload(prepared,[],state.notes);
 assert.equal(data.first_call_at,'2026-10-01T10:12:00+07:00');assert.equal(data.updated_at,'2026-10-10T12:00:00+07:00');assert.equal(data.notes.length,2);assert.ok(data.notes.some(n=>n.content==='Original'));
 assert.equal(payload({...lead,customFields:{result:'Wrong number'}}).ket_qua_cham_soc,'Wrong number');
});
test('Export rejects impossible dates and normalizes exact international phone numbers',()=>{
 assert.ok(Number.isNaN(Export.parseCrmTimestamp('2026-02-30')));assert.ok(Number.isNaN(Export.parseCrmTimestamp('2026-13-01')));assert.equal(Export.normalizeApiTimestamp('invalid'),null);
 assert.equal(Export.normalizePhoneForApi('+84 901 234 567'),'0901234567');assert.equal(Export.normalizePhoneForApi('0901234'),'0901234');
});
function apiFixture(state,production=false){
 const src=fs.readFileSync(require.resolve('../webhook-server.cjs'),'utf8');const body=src.slice(src.indexOf('async function handleLeadsExportApi('),src.indexOf('/* ------------------------------------------------------------------ router */'));
 const before=JSON.stringify(state),context={crypto,Buffer,URL,URLSearchParams,DEMO_MODE:!production,DEMO_MARKETING_API_KEY:'test-key',CRM_EXPORT_API_KEY:production?'':'configured',MarketingHub:Hub,...Export,stateRows:(s,k)=>s[k]||[],marketingApiState:async()=>({state}),corsHeaders:()=>({}),sendJson:(res,status,data)=>{res.status=status;res.data=data}};
 vm.createContext(context);vm.runInContext(body,context);
 return {async get(path,headers={'x-api-key':'test-key'},method='GET'){const response={};await context.handleLeadsExportApi({headers,method},response,new URL(path,'http://localhost:4173'));assert.equal(JSON.stringify(state),before,'GET must not modify CRM state');return response;}};
}
test('Read-only export requires the exact header key, supports Unicode errors safely and fails closed without production config',async()=>{
 const f=apiFixture({customers:[lead]});assert.equal((await f.get('/api/leads/export',{})).status,401);assert.equal((await f.get('/api/leads/export?api_key=test-key',{})).status,401);assert.equal((await f.get('/api/leads/export',{'x-api-key':'éééé'})).status,401);assert.equal((await f.get('/api/leads/export',{'x-api-key':'test-key'},'POST')).status,405);assert.equal((await apiFixture({},true).get('/api/leads/export')).status,503);
});
test('Read-only export paginates, retains filters, clamps page size and looks up only an exact phone',async()=>{
 const f=apiFixture({customers:[lead,{...lead,id:'c2',phone:'0909999999',source:'webhook-A',updatedAt:'2026-10-10 12:00:00'},{...lead,id:'c3',phone:'0909999998',source:'webhook-A',updatedAt:'2026-10-10 13:00:00'}]});
 const page=await f.get('/api/leads/export?source=webhook-A&since=2026-10-09&limit=1');assert.equal(page.status,200);assert.equal(page.data.total,2);assert.ok(page.data.next_page_url.startsWith('http://localhost:4173/'));assert.ok(page.data.next_page_url.includes('since=2026-10-09'));assert.equal((await f.get(page.data.next_page_url)).data.next_page_url,null);
 assert.equal((await f.get('/api/leads/export?limit=999')).data.limit,500);assert.equal((await f.get('/api/leads/export?since=2026-02-30')).status,400);assert.equal((await f.get('/api/customer')).status,400);assert.equal((await f.get('/api/customer?phone=0901234')).status,404);assert.equal((await f.get('/api/customer?phone=%2B84901234567')).data.data.phone,lead.phone);
});
test('All-export endpoint returns every filtered customer in one response',async()=>{
 const f=apiFixture({customers:[lead,{...lead,id:'c2',phone:'0909999999',source:'webhook-A',updatedAt:'2026-10-10 12:00:00'},{...lead,id:'c3',phone:'0909999998',source:'other',updatedAt:'2026-10-10 13:00:00'}]});
 const result=await f.get('/api/leads/export-all?source=webhook-A');
 assert.equal(result.status,200);assert.equal(result.data.total,1);assert.equal(result.data.data.length,1);assert.equal(result.data.data[0].phone,'0909999999');assert.equal(result.data.page,1);assert.equal(result.data.limit,1);assert.equal(result.data.next_page_url,null);
});
test('Ambiguous phone lookup is rejected instead of returning an arbitrary duplicate',async()=>{
 const f=apiFixture({customers:[lead,{...lead,id:'duplicate'}]});assert.equal((await f.get('/api/customer?phone=0901234567')).status,409);
});
test('Conversion and spend analytics preserve historic deposits, exclude L12.2 and never mix USD into VND',()=>{
 const data=Hub.analyzeData({customers:[{...lead,customFields:{customerLevel:'L1',deposit_amount:100,deposit_currency:'USD'}},{...lead,id:'c2',customFields:{customerLevel:'L5'}},{...lead,id:'c3',customFields:{customerLevel:'L12.2',deposit_amount:999}}],customerFieldHistory:[{customerId:'c2',fieldId:'customerLevel',to:'L6: deposit',source:'SALE',at:'2026-10-02 10:00:00'}],traffic:[{utm_content:'ad',spend:null}]});
 assert.equal(data.totalData,2);assert.equal(data.totalConverted,2);assert.equal(data.excludedData,1);assert.equal(data.totalDeposit,0);assert.equal(data.depositsByCurrency.USD,100);
});
test('Automatic import history is not evidence of a human first call and 4G province labels survive normalization',()=>{
 const prepared=Hub.prepareData({customers:[lead],customerFieldHistory:[{customerId:'c1',fieldId:'callStatus',to:'CONTACTED',source:'FORM',at:'2026-10-01 10:00:00'}]}).customers[0];assert.equal(prepared.first_call_at,null);
 assert.equal(Hub.normalizeProvince('Bình Dương (IP 4G)'),'TP. Hồ Chí Minh (IP 4G)');
 const data=Hub.analyzeData({customers:[{...lead,customFields:{customerLevel:'L6',utm_content:'ad'}}],traffic:[{utm_content:'ad',spend:null}]});assert.equal(data.contentGroups[0].spendAvailable,false);
});
