'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const payments=require('../order-payments.js');
const exported={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../crm-data.cjs'),'utf8'),{module:exported,require:name=>name==='./db.js'?{pool:{}}:require(name.startsWith('./')?'../'+name.slice(2):name),Buffer,console});
const crm=exported.exports;
function setup(){
 const members=[{id:'m',role:'MANAGER',active:true,teamId:'T'},{id:'l',role:'LEADER',active:true,managerId:'m',teamId:'T'},{id:'s',role:'SALE',active:true,leaderId:'l',managerId:'m',teamId:'T'},{id:'t',role:'SALE',active:true,leaderId:'l',managerId:'m',teamId:'T'}];
 const product={id:'p',kind:'COURSE'},customer={id:'c',saleId:'s',leaderId:'l',managerId:'m',teamId:'T',customFields:{batch:'K03'}},config={id:'cfg',productId:'p',courseKey:'K03',trainerIds:['t'],rateSale:15,rateTrainer:15,rateLeader:5,rateCompany:65};
 const fields=[{id:'batch',label:'Khoá'}],actor={id:'accountant',role:'ACCOUNTING'};
 const order={id:'o',code:'NVT-O',customerId:'c',createdBy:actor.id,saleId:'s',leaderId:'l',managerId:'m',teamId:'T',productId:'p',qty:1,subtotal:1000000,vatAmount:100000,vatRate:.1,total:1100000,discount:0,amountPaid:100000,depositAmount:100000,balanceDue:1000000,paymentMode:'DEPOSIT',status:'DEPOSIT',billing:{},paymentReconciled:false,vatIssued:false,refund:0,createdAt:'2026-10-01T00:00:00Z',receiptsVersion:1,paymentReceipts:[{id:'r',amount:100000,kind:'DEPOSIT',createdBy:actor.id,at:'2026-10-01T00:00:00Z',billImage:'data:image/png;base64,AA=='}]};
 const data={members:new Map(members.map(m=>[m.id,m])),products:new Map([['p',product]]),customers:new Map([['c',customer]]),courseConfigs:new Map([['cfg',config]]),customFieldDefinitions:new Map(fields.map(f=>[f.id,f]))};
 return {members,product,customer,config,fields,actor,order,data,assignment:()=>payments.commissionAssignment({product,seller:members[2],members,customer,fields,configs:[config]})};
}

test('A course requires a direct manager and exactly one active trainer assigned to the selected cohort',()=>{
 const f=setup();assert.deepEqual(f.assignment(),{commissionLeaderId:'l',commissionSellerRole:'SALE',commissionCourseKey:'K03',commissionTrainerId:'t'});
 f.config.trainerIds=[];assert.throws(f.assignment,/đúng một người đào tạo/);f.config.trainerIds=['t','l'];assert.throws(f.assignment,/đúng một người đào tạo/);
 f.config.trainerIds=['t'];f.members[3].active=false;assert.throws(f.assignment,/không còn hoạt động/);f.members[3].active=true;f.members[2].leaderId=null;f.members[2].managerId=null;assert.throws(f.assignment,/chưa có Leader hoặc Manager/);
});

test('Indicator and VIP do not require a trainer; a Manager can supervise a Sale directly',()=>{
 for(const kind of ['INDICATOR','VIP']){const f=setup();f.product.kind=kind;f.config.trainerIds=[];f.members[2].leaderId=null;assert.equal(f.assignment().commissionLeaderId,'m');assert.equal(f.assignment().commissionTrainerId,undefined);}
});

test('Server rejects a missing course trainer and fabricated recipients and saves the validated assignment',()=>{
 const f=setup();f.config.trainerIds=[];assert.throws(()=>crm.authorize(f.actor,'orders',null,f.order,f.data),/đúng một người đào tạo/);
 f.config.trainerIds=['t'];assert.throws(()=>crm.authorize(f.actor,'orders',null,{...f.order,commissionTrainerId:'invented'},f.data),/không khớp cấu hình/);
 crm.authorize(f.actor,'orders',null,f.order,f.data);assert.equal(f.order.commissionTrainerId,'t');assert.equal(f.order.commissionCourseKey,'K03');
 assert.throws(()=>crm.authorize({id:'admin',role:'ADMIN'},'orders',f.order,{...f.order,commissionTrainerId:'l'},f.data),/Không được thay đổi/);
});

test('Server caps selling, training and management percentages at the confirmed limits',()=>{
 const f=setup();for(const patch of [{rateSale:16},{saleRates:{s:16}},{rateTrainer:16},{trainerRates:{t:16}},{rateLeader:6},{leaderRates:{l:6}}])assert.throws(()=>crm.validate('courseConfigs',{...f.config,...patch},'cfg'),/tối đa/);
 assert.equal(payments.saleCommissionRate(18),15);assert.equal(payments.saleCommissionRate(10),10);assert.equal(payments.saleCommissionRate(0),0);
});

test('A new receipt order cannot omit its creator to skip commission validation',()=>{
 const f=setup();delete f.order.createdBy;
 assert.throws(()=>crm.authorize({id:'admin',role:'ADMIN'},'orders',null,f.order,f.data),/phải có người tạo/);
});
