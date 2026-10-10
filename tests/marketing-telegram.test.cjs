'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Hub=require('../marketing-hub.js');
const source=fs.readFileSync(require.resolve('../telegram-bot.cjs'),'utf8');
const state={customers:[{id:'l5',customFields:{customerLevel:'L5'}},{id:'l6',customFields:{customerLevel:'L6',goi_ket_noi:'Đã gọi được',utm_content:'<ad>'}},{id:'duplicate',customFields:{customerLevel:'L12.2'}}]};
function fixture(users){
 const sent=[],docs=new Map();let reads=0;
 const context={Date,Set,JSON,dbQuery:async()=>users,pool:{execute:async(sql,args)=>{if(sql.startsWith('INSERT IGNORE')){if(docs.has(args[0]))return [{affectedRows:0}];docs.set(args[0],JSON.parse(args[1]));return [{affectedRows:1}]};docs.set(args[1],JSON.parse(args[0]));return [{}]}},sendMessage:async(chat,text)=>{sent.push({chat,text});return {ok:true}},escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),require:name=>{if(name==='./marketing-hub.js')return Hub;if(name==='./crm-data.cjs')return {read:async()=>{reads++;return {state}}};throw Error(name)}};
 const command=source.slice(source.indexOf('async function marketingCommandResponse('),source.indexOf('async function handleIncomingMessage('));
 const weekly=source.slice(source.indexOf('async function sendWeeklyMarketingInsight('),source.indexOf('async function runTelegramScheduler('));
 vm.createContext(context);vm.runInContext(command+weekly,context);return {context,sent,docs,get reads(){return reads}};
}
test('Marketing Telegram commands require a linked Marketing or Admin account before reading CRM',async()=>{
 for(const users of [[],[{id:'sale',role:'SALE'}]]){const f=fixture(users);await f.context.marketingCommandResponse('1','/insight');assert.equal(f.reads,0);assert.equal(f.sent.length,1)}
 const f=fixture([{id:'m',role:'MARKETING'}]);for(const command of ['/insight','/chandung','/content'])await f.context.marketingCommandResponse('1',command);assert.equal(f.reads,3);assert.ok(f.sent[0].text.includes(Hub.analyzeData(state).aiInsight.summaryHeadline));assert.ok(f.sent[2].text.includes('&lt;ad&gt;'));
});
test('Monday insight uses a durable SQL claim and does not resend after a restart or duplicate chat mapping',async()=>{
 const f=fixture([{id:'m1',role:'MARKETING',telegram_chat_id:'101'},{id:'m2',role:'MARKETING',telegram_chat_id:'101'}]);assert.equal((await f.context.sendWeeklyMarketingInsight()).sent,1);assert.equal(f.sent.length,1);assert.equal([...f.docs.values()][0].status,'SENT');assert.equal((await f.context.sendWeeklyMarketingInsight()).sent,0);assert.equal(f.sent.length,1);
});
