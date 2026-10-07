'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const moduleMock={exports:{}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../crm-data.cjs'),'utf8'),{module:moduleMock,require:name=>name==='./db.js'?{pool:{}}:require(name.startsWith('./')?'../'+name.slice(2):name),Buffer,console});const crm=moduleMock.exports;
const sale={id:'sale',role:'SALE',leaderId:'lead',teamId:'T'},customer={id:'customer',saleId:'sale',leaderId:'lead',teamId:'T'};
const data={customers:new Map([['customer',customer]]),members:new Map([['sale',sale]]),products:new Map([['product',{id:'product'}]])};
const order=()=>({id:'order',code:'NVT-test',paymentReference:'NVTTEST',customerId:'customer',saleId:'sale',leaderId:'lead',teamId:'T',productId:'product',qty:1,subtotal:5000000,vatRate:.1,vatAmount:500000,total:5500000,amountPaid:500000,depositAmount:500000,balanceDue:5000000,paymentMode:'DEPOSIT',status:'DEPOSIT',billImage:'data:image/jpeg;base64,AA==',billing:{cccd:'',address:''},paymentReconciled:false,vatIssued:false,refund:0,createdAt:'2026-01-01T00:00:00Z'});
test('Sale records an own deposit with optional identity/address and 10% VAT',()=>{const o=order();crm.authorize(sale,'orders',null,o,data);crm.validate('orders',o,o.id);});
test('Accounting can create and edit receipt orders',()=>{const actor={id:'accountant',role:'ACCOUNTING'},o=order();crm.authorize(actor,'orders',null,o,data);crm.authorize(actor,'orders',o,{...o,saleNote:'Updated'},data);});
test('Legacy customer hierarchy does not reject an order when the selected Sale is valid',()=>{
 const manager={id:'manager',role:'MANAGER',active:true,teamId:'T'},leader={id:'lead',role:'LEADER',active:true,managerId:'manager',teamId:'T'},owner={id:'sale',role:'SALE',active:true,leaderId:'lead',managerId:'manager',teamId:'T'};
 const staleCustomer={...customer,leaderId:'old-leader',managerId:'old-manager',teamId:'OLD'};
 const hierarchy={customers:new Map([['customer',staleCustomer]]),members:new Map([['manager',manager],['lead',leader],['sale',owner]]),products:new Map([['product',{id:'product'}]])};
 const o={...order(),leaderId:'lead',managerId:'manager',teamId:'T'};
 crm.authorize(owner,'orders',null,o,hierarchy);
});
test('Sale can edit own un-reconciled order even after 72 hours',()=>{const o=order();crm.authorize(sale,'orders',o,{...o,saleNote:'Updated'},data);});
test('Sale cannot edit another sale order or reassign ownership',()=>{const o=order();assert.throws(()=>crm.authorize({...sale,id:'other'},'orders',o,{...o,saleNote:'hack'},data));assert.throws(()=>crm.authorize(sale,'orders',o,{...o,saleId:'other'},data));});
test('Reconciled, invoiced and closed orders cannot be edited',()=>{for(const patch of [{paymentReconciled:true},{vatIssued:true},{status:'REFUNDED'},{status:'CANCELLED'},{status:'COURSE_GRANTED'}]){const o={...order(),...patch};assert.throws(()=>crm.authorize(sale,'orders',o,{...o,saleNote:'edit'},data));}});
test('Receipt path rejects missing bill, zero VAT, overpayment and inconsistent status',()=>{for(const patch of [{billImage:''},{vatRate:0},{amountPaid:5500001},{status:'PAID'},{vatAmount:0},{total:5000000}])assert.throws(()=>crm.authorize(sale,'orders',null,{...order(),...patch},data));});
test('Sale cannot reconcile or refund through a normal edit',()=>{const o=order();for(const patch of [{paymentReconciled:true},{refund:1},{vatIssued:true},{createdAt:'2026-10-03'}])assert.throws(()=>crm.authorize(sale,'orders',o,{...o,...patch},data));});
function form(createOrder,options={}){
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:false,required:false,dataset:{},classList:{add(){},toggle(){}},focus(){},before(n){this.back=n;},selectedOptions:[{dataset:{price:5000000},textContent:'Product'}]});return nodes.get(id);};
 let save,created=[],markup;const modal={querySelector:node,querySelectorAll:()=>[]};
 const context=vm.createContext({OrderPayments:require('../order-payments.js'),data:{products:[{id:'product',name:'Product',price:5000000}],customers:options.customers||[],user:sale},orderSalesInScope:()=>options.sales||[sale],q:node,esc:String,money:v=>String(v),opt:()=>'',ORDER_BANKS:['MB Bank'],phoneKey:String,compressBill:async()=> 'data:image/jpeg;base64,AA==',editor:(title,body,fn)=>{markup=body;save=fn;return modal;},document:{createElement:()=>({})},ensureAccountingOrderStyles(){},showOrderSuccess(){},api:{createOrder:async p=>{created.push(p);if(createOrder)return createOrder(p);return {order:{...p,status:'DEPOSIT',amountPaid:p.amountPaid,balanceDue:5500000-p.amountPaid}};}},Date,Math,alert:assert.fail});
 vm.runInContext(source.slice(source.indexOf('  function bindBillPicker('),source.indexOf('  function openReceiptPaymentForm(')),context);
 vm.runInContext(source.slice(source.indexOf('  function openAccountingOrderForm('),source.indexOf('  function ensureAccountingOrderStyles()')),context);
 context.openAccountingOrderForm('');node('#aoName').value='Test';node('#aoPhone').value='0901234567';node('#aoProduct').value='product';node('#aoSale').value='sale';node('#aoPayType').value='FULL';node('#aoPayType').onchange();
 return {node,save:()=>save(),created,get markup(){return markup;}};
}
test('Nhập SĐT có nhiều chủ không tự đổi Sale và chỉ lấy thông tin khách của Sale đã chọn',()=>{
 const owner={id:'other',role:'SALE',leaderId:'lead',teamId:'T'},sales=[sale,owner];
 const other={id:'other-customer',name:'Khách người khác',phone:'0901234567',saleId:owner.id,cccd:'987654321012'};
 const mine={id:'my-customer',name:'Khách của tôi',phone:'0901234567',saleId:sale.id,cccd:'123456789012'};
 const matched=form(undefined,{sales,customers:[other,mine]});matched.node('#aoName').value='Mới';matched.node('#aoPhone').onchange();
 assert.equal(matched.node('#aoSale').value,sale.id);assert.equal(matched.node('#aoName').value,mine.name);assert.equal(matched.node('#aoCccd').value,mine.cccd);
 const foreign=form(undefined,{sales,customers:[other]});foreign.node('#aoName').value='Tên trên đơn mới';foreign.node('#aoPhone').onchange();
 assert.equal(foreign.node('#aoSale').value,sale.id);assert.equal(foreign.node('#aoName').value,'Tên trên đơn mới');assert.equal(foreign.node('#aoCccd').value,'');
});
test('Continue renders payment slip without saving or requiring CCCD/address/bill',async()=>{const f=form();assert.equal(f.node('#aoCollected').value,5500000);assert.equal(await f.save(),false);assert.equal(f.created.length,0);assert.equal(f.node('#aoDetails').hidden,true);assert.match(f.node('#aoInvoice').innerHTML,/75725888888/);assert.match(f.node('#aoInvoice').innerHTML,/amount=5500000/);assert.doesNotMatch(f.markup,/id="aoCccd"[^>]*required|id="aoAddress"[^>]*required/);});
test('Custom deposit uses VAT total and save requires confirmation plus bill',async()=>{const f=form();f.node('#aoPayType').value='CUSTOM';f.node('#aoPayType').onchange();f.node('#aoCollected').value='500000';f.node('#aoCollected').oninput();assert.match(f.node('#aoRemaining').textContent,/5000000/);await f.save();await assert.rejects(f.save(),/Xác nhận/);f.node('#aoConfirmed').checked=true;await assert.rejects(f.save(),/bill/);await f.node('#aoBillFile').onchange({target:{files:[{name:'test.jpg'}]}});await f.save();assert.equal(f.created.length,1);assert.equal(f.created[0].vatRate,.1);assert.equal(f.created[0].requireVat,false);assert.equal(f.created[0].cccd,'');assert.equal(f.created[0].amountPaid,500000);});
test('Back preserves fields and recalculates next payment slip',async()=>{const f=form();await f.save();f.node('.modal-footer [type=submit]').back.onclick();assert.equal(f.node('#aoDetails').hidden,false);f.node('#aoTotal').value='1000000';f.node('#aoTotal').oninput();await f.save();assert.match(f.node('#aoInvoice').innerHTML,/amount=1000000/);assert.equal(f.created.length,0);});

const payments=require('../order-payments.js');

test('Legacy imageData bills remain visible through the lazy asset path',()=>{
 const legacyReceipt={id:'legacy-receipt',amount:500000,kind:'DEPOSIT',at:'2026-10-05T10:00:00Z',imageData:'data:image/png;base64,LEGACY'};
 assert.equal(payments.images(legacyReceipt)[0].imageData,legacyReceipt.imageData);
 const legacyOrder={id:'legacy-order',paymentReceipts:[legacyReceipt]};
 const asset=crm.assetFromData({id:'accountant',role:'ACCOUNTING'},{orders:new Map([[legacyOrder.id,legacyOrder]])},'order',legacyOrder.id,legacyReceipt.id);
 assert.equal(asset.images[0].imageData,legacyReceipt.imageData);
});
test('Legacy deposit retains the uploaded bill when migrating to multiple receipts',()=>{const old=order(),rs=payments.receipts(old);assert.equal(rs.length,1);assert.equal(rs[0].amount,500000);assert.equal(rs[0].billImage,old.billImage);assert.match(payments.status(old,String),/Cọc 500000/);});
test('Three payments across periods sum once, retain deposit and allocate VAT exactly',()=>{
 const o={...order(),status:'PAID',receiptsVersion:1,amountPaid:5500000,balanceDue:0,paymentMode:'FULL',billImage:'',paymentReceipts:[{id:'p1',kind:'DEPOSIT',amount:500000,at:'2026-09-30T10:00:00+07:00',billImage:'data:image/jpeg;base64,AA=='},{id:'p2',kind:'PAYMENT',amount:1000000,at:'2026-10-01T10:00:00+07:00',billImage:'data:image/jpeg;base64,AA=='},{id:'p3',kind:'FULL',amount:4000000,at:'2026-11-01T10:00:00+07:00',billImage:'data:image/jpeg;base64,AA=='}]};
 const events=payments.events(o);assert.equal(events.length,3);assert.equal(events.reduce((sum,e)=>sum+e.amount,0),5500000);assert.equal(events.reduce((sum,e)=>sum+e.netAmount,0),5000000);assert.equal(events.reduce((sum,e)=>sum+e.vatAmount,0),500000);assert.equal(events.filter(e=>e.occurredAt.startsWith('2026-10')).reduce((sum,e)=>sum+e.amount,0),1000000);assert.equal(payments.balance(o),0);assert.equal(payments.status(o),'Thanh toán đủ');
});
test('Partial collection shows cumulative collected amount, not original deposit or 50 percent',()=>{const o={...order(),receiptsVersion:1,amountPaid:1500000,paymentReceipts:[{amount:500000},{amount:1000000}]};assert.equal(payments.paid(o),1500000);assert.equal(payments.balance(o),4000000);assert.equal(payments.status(o),'Cọc 1500000');});
test('Append-only receipt validation protects old bills and blocks forged legacy receipts',()=>{
 const old=order(),next={...old,receiptsVersion:1,paymentReceipts:[...payments.receipts(old),{id:'new',kind:'PAYMENT',amount:1000000,billImage:'data:image/jpeg;base64,AA==',at:'2026-10-03T12:00:00+07:00',createdBy:'sale'}],amountPaid:1500000,balanceDue:4000000};
 crm.validate('orders',next,next.id);crm.authorize(sale,'orders',old,next,data);
 assert.throws(()=>crm.authorize(sale,'orders',old,{...next,paymentReceipts:next.paymentReceipts.map((r,i)=>i===0?{...r,billImage:'changed'}:r)},data));
 assert.throws(()=>crm.authorize(sale,'orders',old,{...next,paymentReceipts:next.paymentReceipts.map((r,i)=>i===1?{...r,legacy:true}:r)},data));
 assert.throws(()=>crm.authorize(sale,'orders',next,{...next,receiptsVersion:undefined},data));
 assert.throws(()=>crm.validate('orders',{...next,amountPaid:1},next.id));
});

test('Order details show every receipt image and label without exposing export VAT actions',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
 const ctx=vm.createContext({OrderPayments:payments,esc:String,money:String,fmtDate:String,person:String});
 const start=source.indexOf('  function receiptHistoryMarkup('),end=source.indexOf('  function bindReceiptImages(',start);vm.runInContext(source.slice(start,end),ctx);
 const o={...order(),receiptsVersion:1,paymentReceipts:[{id:'1',amount:500000,kind:'DEPOSIT',at:'2026-10-01',billImage:'data:image/png;base64,AAA='},{id:'2',amount:5000000,kind:'FULL',at:'2026-10-03',billImage:'data:image/png;base64,BBB='}]};
 const markup=ctx.receiptHistoryMarkup(o);assert.match(markup,/Bill cọc/);assert.match(markup,/Bill chuyển khoản đủ/);assert.equal((markup.match(/data-receipt-image=/g)||[]).length,2);assert.match(markup,/base64,AAA=/);assert.match(markup,/base64,BBB=/);
 const orders=source.slice(source.indexOf('  function drawOrders()'),source.indexOf('  renderOrdersTable=drawOrders;'));assert.doesNotMatch(orders,/data-order-vat|Xuất VAT/);assert.match(orders,/SỐ TIỀN CẦN THU/);
});

test('Server allows audited image edits but refuses replacing receipt money or removing its audit trail',()=>{
 const old={...order(),receiptsVersion:1,paymentReceipts:payments.receipts(order())},before=payments.images(old.paymentReceipts[0]);
 const next={...old,paymentReceipts:old.paymentReceipts.map(r=>({...r,images:[{...before[0],imageData:'data:image/jpeg;base64,AQ==',note:'Better image'},{id:'extra',imageData:'data:image/jpeg;base64,Ag==',note:'Bank statement'}],imageRevisions:[{id:'revision',by:'sale',at:'2026-10-03T12:00:00+07:00',images:before}]}))};
 crm.validate('orders',next,next.id);crm.authorize(sale,'orders',old,next,data);assert.equal(payments.paid(old),payments.paid(next));
 assert.throws(()=>crm.authorize(sale,'orders',old,{...next,paymentReceipts:next.paymentReceipts.map(r=>({...r,imageRevisions:[]}))},data));
 assert.throws(()=>crm.authorize(sale,'orders',old,{...next,paymentReceipts:next.paymentReceipts.map(r=>({...r,amount:1000000}))},data));
});
test('Server reconciliation is accounting-only, requires fully paid and never alters receipts',()=>{
 const old={...order(),amountPaid:5500000,depositAmount:5500000,balanceDue:0,paymentMode:'FULL',status:'PAID'},accountant={id:'accountant',role:'ACCOUNTING'};
 const next={...old,paymentReconciled:true,paymentReconciledBy:'accountant',paymentReconciledAt:'2026-10-03T12:00:00+07:00',reconciliationNote:'Checked'};
 crm.authorize(accountant,'orders',old,next,data);assert.throws(()=>crm.authorize(sale,'orders',old,{...next,paymentReconciledBy:'sale'},data));
 assert.throws(()=>crm.authorize(accountant,'orders',order(),{...order(),paymentReconciled:true,paymentReconciledBy:'accountant',paymentReconciledAt:next.paymentReconciledAt},data));
 assert.throws(()=>crm.authorize(accountant,'orders',old,{...next,saleNote:'hidden edit'},data));
});
test('Receipt gallery displays per-image notes including supplemental proof',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8'),ctx=vm.createContext({OrderPayments:payments,esc:String,money:String,fmtDate:String,person:String});
 vm.runInContext(source.slice(source.indexOf('  function receiptHistoryMarkup('),source.indexOf('  function bindReceiptImages(')),ctx);
 const markup=ctx.receiptHistoryMarkup({...order(),receiptsVersion:1,paymentReceipts:[{id:'r',amount:500000,kind:'DEPOSIT',images:[{id:'one',imageData:'data:image/png;base64,AA==',note:'Ảnh ngân hàng'},{id:'two',imageData:'data:image/png;base64,AQ==',note:'Ảnh bổ sung'}]}]},true);
 assert.match(markup,/Ảnh ngân hàng/);assert.match(markup,/Ảnh bổ sung/);assert.ok(markup.includes('Thêm bill / Sửa bill'));
});

test('Order detail renders MST, company, sale note and accounting note',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');let markup='';
 const item={...order(),requireVat:true,taxCode:'0123456789',companyName:'Example Company',saleNote:'Khách cần hóa đơn',reconciliationNote:'Giao dịch đã khớp'};
 const ctx=vm.createContext({OrderPayments:payments,data:{orders:[item],user:{role:'ADMIN'}},esc:String,money:String,fmtDate:String,person:String,shortOrderCode:String,ensureAccountingOrderStyles(){},canChangeReceiptOrder:()=>false,receiptHistoryMarkup:()=>'',bindReceiptImages(){},editor:(title,body)=>{markup=body;return {style:{},querySelector:()=>null};}});
 vm.runInContext(source.slice(source.indexOf('  function openReceiptOrderDetail('),source.indexOf('  function openReceiptPaymentForm(')),ctx);ctx.openReceiptOrderDetail(item.id);
 for(const value of ['0123456789','Example Company','Khách cần hóa đơn','Giao dịch đã khớp','Thông tin xuất hóa đơn'])assert.ok(markup.includes(value),value);
});

test('Reconciliation action is hidden in Orders and shown only in accounting context',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');let markup='';
 const item={...order(),status:'PAID',paymentMode:'FULL',amountPaid:5500000,depositAmount:5500000,balanceDue:0};
 const modal={style:{},querySelector:()=>null};
 const ctx=vm.createContext({OrderPayments:payments,data:{orders:[item],user:{role:'ADMIN'}},esc:String,money:String,fmtDate:String,person:String,shortOrderCode:String,ensureAccountingOrderStyles(){},canChangeReceiptOrder:()=>false,receiptHistoryMarkup:()=>'',bindReceiptImages(){},editor:(title,body)=>{markup=body;return modal;}});
 vm.runInContext(source.slice(source.indexOf('  function openReceiptOrderDetail('),source.indexOf('  function openReceiptPaymentForm(')),ctx);
 ctx.openReceiptOrderDetail(item.id);assert.doesNotMatch(markup,/receiptReconcile|Kế toán kiểm tra & Đối soát đủ/);
 ctx.openReceiptOrderDetail(item.id,false,true);assert.match(markup,/receiptReconcile/);assert.match(markup,/Kế toán kiểm tra & Đối soát đủ/);
});

test('All order-creating roles see Manager, Leader and every active Sale',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
 const makeNode=(id)=>({value:'',checked:false,hidden:false,required:false,dataset:{},classList:{add(){},toggle(){}},focus(){},before(){},selectedOptions:[{dataset:{price:5000000},textContent:'Product'}]});
 const members=[{id:'manager',name:'Manager',role:'MANAGER',active:true},{id:'leader',name:'Leader',role:'LEADER',managerId:'manager',active:true},{id:'sale-1',name:'Sale 1',role:'SALE',leaderId:'leader',managerId:'manager',active:true},{id:'sale-2',name:'Sale 2',role:'SALE',leaderId:'leader',managerId:'manager',active:true},{id:'sale-off',name:'Sale ngoài tuyến',role:'SALE',leaderId:'other',managerId:'other',active:true}];
 const renderFor=({role,actualRole,id='manager',leaderId=''})=>{
   const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id);};let markup='';
   const modal={querySelector:node,querySelectorAll:()=>[]};
   const ctx=vm.createContext({OrderPayments:payments,data:{products:[{id:'product',name:'Product',price:5000000}],customers:[],members:members.filter(m=>m.id===id),orderAssignees:members,managerHierarchy:{members},user:{id,role,actualRole,leaderId}},orderSalesInScope:undefined,q:node,esc:String,money:String,opt:()=>'',phoneKey:String,compressBill:async()=> 'data:image/jpeg;base64,AA==',editor:(title,body)=>{markup=body;return modal;},document:{createElement:()=>({})},ensureAccountingOrderStyles(){},showOrderSuccess(){},api:{createOrder:async()=>({order:{}})},Date,Math,alert:assert.fail});
   vm.runInContext(source.slice(source.indexOf('  const orderSalesInScope='),source.indexOf('  function openReceiptPaymentForm(')),ctx);
   vm.runInContext(source.slice(source.indexOf('  function openAccountingOrderForm('),source.indexOf('  function ensureAccountingOrderStyles()')),ctx);
   ctx.openAccountingOrderForm('');
   return {markup,node};
 };
 for(const role of ['ADMIN','ACCOUNTING','MANAGER','LEADER','SALE']){
   const result=renderFor({role,actualRole:role,id:'sale-1'});
   for(const member of members)assert.ok(result.markup.includes('value="'+member.id+'"'),role+' sees '+member.id);
   assert.match(result.markup,/Manager/);assert.match(result.markup,/Leader/);assert.doesNotMatch(result.markup,/id="aoSale" disabled/);
 }

});

test('Accepting data does not redirect Sale to the customer overview',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');
 const start=source.indexOf('  const ordinaryQueue=renderDataQueue;renderDataQueue=function(){');
 const end=source.indexOf('  const ordinaryQueueFilter=',start);
 const handler=source.slice(start,end);
 assert.ok(handler.includes('run(()=>api.acceptOffer(button.dataset.acceptOffer))'));
 assert.equal(handler.includes("switchTab('tab-customers')"),false);
 assert.equal(handler.includes('custSearchInput')&&handler.includes('topGlobalSearch'),false);
});

test('Inclusive VAT keeps every entered dong and allocates receipts consistently',()=>{for(const total of [1,6,16,1000000,5500000,5500006]){const a=payments.amounts({total});assert.equal(a.total,total);assert.equal(a.subtotal+a.vatAmount,total);assert.equal(a.vatAmount,Math.round(total/11));}assert.equal(payments.amounts({subtotal:5000000}).total,5500000);assert.throws(()=>payments.amounts({total:1.5}));});
test('Inclusive rounding is accepted by server for sale orders',()=>{const o={...order(),...payments.amounts({total:5500006})};o.balanceDue=o.total-o.amountPaid;crm.authorize(sale,'orders',null,o,data);crm.validate('orders',o,o.id);});
test('QR and saved transfer content use customer full name and phone',async()=>{const f=form();f.node('#aoName').value='Nguyễn Văn An';f.node('#aoTotal').value='1000000';f.node('#aoTotal').oninput();await f.save();assert.match(f.node('#aoInvoice').innerHTML,new RegExp('des='+encodeURIComponent('Nguyễn Văn An 0901234567')));f.node('#aoConfirmed').checked=true;await f.node('#aoBillFile').onchange({target:{files:[{name:'bill.jpg'}]}});await f.save();assert.equal(f.created[0].total,1000000);assert.equal(f.created[0].subtotal,909091);assert.equal(f.created[0].amountPaid,1000000);assert.equal(f.created[0].paymentReference,'Nguyễn Văn An 0901234567');});

test('Failed order save keeps bill and lets Sale reset the deposit amount before retry',async()=>{
 let attempts=0;const f=form(async p=>{if(++attempts===1)throw Error('ASSIGNEE_ERROR');return {order:{...p,status:'DEPOSIT',amountPaid:p.amountPaid,balanceDue:p.total-p.amountPaid}};});
 await f.save();await f.node('#aoBillFile').onchange({target:{files:[{name:'bill.jpg'}]}});f.node('#aoConfirmed').checked=true;
 await assert.rejects(f.save(),/ASSIGNEE_ERROR/);
 f.node('.modal-footer [type=submit]').back.onclick();f.node('#aoPayType').value='CUSTOM';f.node('#aoPayType').onchange();
 assert.equal(f.node('#aoCollected').readOnly,false);assert.equal(f.node('#aoCollected').disabled,false);assert.equal(f.node('#aoCollected').value,'');
 f.node('#aoCollected').value='500000';f.node('#aoCollected').oninput();assert.equal(f.node('#aoCollected').value,'500000');
 await f.save();f.node('#aoConfirmed').checked=true;await f.save();assert.equal(attempts,2);assert.equal(f.created.at(-1).amountPaid,500000);
});
test('Only full and deposit modes; switching to deposit asks for actual amount',async()=>{const f=form();const options=f.markup.match(/id="aoPayType"[\s\S]*?<\/select>/)[0];assert.equal((options.match(/<option/g)||[]).length,2);assert.equal(f.node('#aoCollected').readOnly,true);f.node('#aoPayType').value='CUSTOM';f.node('#aoPayType').onchange();assert.equal(f.node('#aoCollected').value,'');assert.equal(f.node('#aoCollected').readOnly,false);f.node('#aoCollected').value='5500000';await assert.rejects(f.save(),/Tiền cọc/);f.node('#aoPayType').value='FULL';f.node('#aoPayType').onchange();assert.equal(f.node('#aoCollected').value,5500000);});
test('Optional invoice email is validated and included in saved billing',async()=>{const f=form();f.node('#aoEmail').value='invalid';await assert.rejects(f.save(),/Email/);f.node('#aoEmail').value='invoice@gmail.com';await f.save();f.node('#aoConfirmed').checked=true;await f.node('#aoBillFile').onchange({target:{files:[{name:'bill.jpg'}]}});await f.save();assert.equal(f.created[0].billing.email,'invoice@gmail.com');assert.equal(f.created[0].email,'invoice@gmail.com');assert.doesNotMatch(f.markup,/id="aoEmail"[^>]*required/);});

test('Bill editor saves replacement, extra image and notes without recording more money',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');const o={...order(),receiptsVersion:1,paymentReceipts:[{id:'receipt',amount:500000,billImage:'data:image/png;base64,AA=='}]};const before=JSON.stringify(o);const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',classList:{add(){}},dataset:{}});return nodes.get(id);};let save,payload;const notes=[{dataset:{imageNote:'0'},value:''}],replace=[{dataset:{imageReplace:'0'},files:[{name:'replacement'}]}];const modal={style:{},querySelector:node,querySelectorAll:selector=>selector==='[data-image-note]'?notes:selector==='[data-image-replace]'?replace:[]};
 const ctx=vm.createContext({data:{orders:[o]},canChangeReceiptOrder:()=>true,OrderPayments:payments,esc:String,money:String,q:node,editor:(title,body,callback)=>{save=callback;return modal;},compressBill:async file=>'data:image/png;base64,'+(file.name==='replacement'?'AQ==':'Ag=='),api:{updateOrderAccounting:async(id,input)=>{payload=input;return {order:o};}},referenceNotice(){},setTimeout(){},Date,Math});
 vm.runInContext(source.slice(source.indexOf('  function openReceiptImageEditor('),source.indexOf('  function openOrderReconciliation(')),ctx);ctx.openReceiptImageEditor(o.id,'receipt');notes[0].value='Bill rõ hơn';notes[0].oninput();await replace[0].onchange();await node('#receiptImageAdd').onchange({target:{files:[{name:'additional'}],value:'file'}});await save();assert.equal(payload.action,'SAVE_RECEIPT_IMAGES');assert.equal(payload.images.length,2);assert.equal(payload.images[0].note,'Bill rõ hơn');assert.equal(payload.images[0].imageData,'data:image/png;base64,AQ==');assert.equal(payload.amount,undefined);assert.equal(JSON.stringify(o),before);
});

test('Create-order uploads multiple bills in one selection and keeps one collected amount',async()=>{const f=form();await f.save();await f.node('#aoBillFile').onchange({target:{files:[{name:'one.jpg'},{name:'two.jpg'}]}});f.node('#aoConfirmed').checked=true;await f.save();assert.equal(f.created[0].images.length,2);assert.equal(f.created[0].amountPaid,5500000);assert.match(f.node('#aoBillPreview').innerHTML,/Xóa bill/);});
test('Deleting all images retains payment and audited original, and prevents reconciliation',()=>{const old={...order(),receiptsVersion:1,paymentReceipts:payments.receipts(order())};const next=structuredClone(old);next.paymentReceipts[0].images=[];next.paymentReceipts[0].imageRevisions=[{id:'rev',by:'sale',at:'2026-10-03T10:00:00Z',images:payments.images(old.paymentReceipts[0])}];crm.authorize(sale,'orders',old,next,data);crm.validate('orders',next,next.id);assert.equal(payments.paid(next),500000);assert.equal(payments.images(next.paymentReceipts[0]).length,0);delete next.paymentReceipts[0].imageRevisions;assert.throws(()=>crm.authorize(sale,'orders',old,next,data));});

test('Accounting can maintain historical bill after customer is returned to pool or reassigned',()=>{const old={...order(),receiptsVersion:1,paymentReceipts:payments.receipts(order())};const changed=structuredClone(old);changed.paymentReceipts[0].images=[];changed.paymentReceipts[0].imageRevisions=[{id:'rev',at:'2026-10-03T12:00:00Z',by:'accountant',images:payments.images(old.paymentReceipts[0])}];const scope={...data,customers:new Map([['customer',{...customer,saleId:null}]])};crm.authorize({id:'accountant',role:'ACCOUNTING'},'orders',old,changed,scope);assert.throws(()=>crm.authorize(sale,'orders',old,changed,scope));assert.throws(()=>crm.authorize({id:'accountant',role:'ACCOUNTING'},'orders',null,order(),scope));});

test('Direct bill deletion reopens details with server-confirmed images instead of stale gallery',async()=>{const source=fs.readFileSync(require('node:path').join(__dirname,'../reference-crm.js'),'utf8');const order={id:'o',receiptsVersion:1,paymentReceipts:[{id:'r',amount:500000,billImage:'data:image/png;base64,AA=='}]};const button={dataset:{receiptDelete:'0:0'}};let shown;const ctx=vm.createContext({OrderPayments:payments,money:String,confirm:()=>true,run:async(action,done)=>done(await action()),api:{updateOrderAccounting:async(id,input)=>({order:{...order,paymentReceipts:[{...order.paymentReceipts[0],images:input.images}]}})},openReceiptOrderDetail:()=>{shown=payments.images(order.paymentReceipts[0]);}});vm.runInContext(source.slice(source.indexOf('  async function loadReceiptImages('),source.indexOf('  function openReceiptImageEditor(')),ctx);ctx.bindReceiptImages({querySelectorAll:selector=>selector==='[data-receipt-delete]'?[button]:[]},order);button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(shown.length,0);assert.equal(order.paymentReceipts[0].amount,500000);});

test('Bill category replaces banks and automatically labels every image',async()=>{const f=form();assert.doesNotMatch(f.markup,/Bill Vietcombank|Bill Techcombank|id="aoBank"/);assert.match(f.markup,/Bill chuyển khoản đủ/);assert.match(f.markup,/Bill cọc/);await f.save();await f.node('#aoBillFile').onchange({target:{files:[{name:'one.jpg'},{name:'two.jpg'}]}});f.node('#aoBillType').value='DEPOSIT';f.node('#aoBillType').onchange();f.node('#aoConfirmed').checked=true;await f.save();assert.equal(f.created[0].images.length,2);assert.ok(f.created[0].images.every(image=>image.note==='Bill cọc'));assert.equal(f.created[0].amountPaid,5500000);assert.equal(f.created[0].bankReference,'');});
test('Full-payment selection writes full-transfer note for all attached bills',async()=>{const f=form();await f.save();await f.node('#aoBillFile').onchange({target:{files:[{name:'one.jpg'},{name:'two.jpg'}]}});f.node('#aoConfirmed').checked=true;await f.save();assert.ok(f.created[0].images.every(image=>image.note==='Bill chuyển khoản đủ'));});


test('Compact order metadata edits restore original bills without changing amounts or history',()=>{
 const old={...order(),receiptsVersion:1,paymentReceipts:payments.receipts(order())};old.paymentReceipts[0].images=[{id:'image',imageData:'data:image/png;base64,AQ==',note:'Original note'}];
 const snapshot=crm.snapshot({id:'admin',role:'ADMIN'},{...Object.fromEntries([...crm.LISTS,...crm.OBJECTS].map(key=>[key,new Map()])),...data,orders:new Map([[old.id,old]])},{compact:true}).state.orders[0];
 assert.equal(snapshot.paymentReceipts[0].billImage,undefined);
 const next=crm.mergeOrderAssets(old,{...snapshot,billing:{...snapshot.billing,cccd:'012345678901',address:'Địa chỉ mới',email:'new@example.test'},saleNote:'Đã cập nhật'});
 crm.validate('orders',next,next.id);crm.authorize(sale,'orders',old,next,data);
 assert.equal(crm.canonical(next.paymentReceipts),crm.canonical(old.paymentReceipts));assert.equal(next.hasBill,undefined);assert.equal(next.billing.cccd,'012345678901');
 assert.equal(payments.paid(next),payments.paid(old));assert.equal(old.billing.cccd,'');
});
test('Asset restoration preserves explicit image deletion and does not authorize altered receipts',()=>{
 const old={...order(),receiptsVersion:1,paymentReceipts:payments.receipts(order())},snapshot=crm.snapshot({id:'admin',role:'ADMIN'},{...Object.fromEntries([...crm.LISTS,...crm.OBJECTS].map(key=>[key,new Map()])),...data,orders:new Map([[old.id,old]])},{compact:true}).state.orders[0];
 const changed=structuredClone(snapshot);changed.paymentReceipts[0].images=[];changed.paymentReceipts[0].imageRevisions=[{id:'rev',by:'sale',at:'2026-10-07T10:00:00Z',images:payments.images(old.paymentReceipts[0])}];
 const restored=crm.mergeOrderAssets(old,changed);crm.authorize(sale,'orders',old,restored,data);assert.equal(payments.images(restored.paymentReceipts[0]).length,0);
 const tampered=crm.mergeOrderAssets(old,{...snapshot,paymentReceipts:[{...snapshot.paymentReceipts[0],amount:600000}]});assert.throws(()=>crm.authorize(sale,'orders',old,tampered,data));
 const withoutAudit=crm.mergeOrderAssets(old,{...snapshot,paymentReceipts:[{...snapshot.paymentReceipts[0],images:[]}]});assert.throws(()=>crm.authorize(sale,'orders',old,withoutAudit,data));
});
