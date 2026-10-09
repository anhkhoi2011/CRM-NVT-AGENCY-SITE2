'use strict';
// Read-only deployment check. Never seeds users, modifies records, or prints credentials.
const db=require('../db.js');
const payments=require('../order-payments.js');
(async()=>{
 try{
  if(!db.dbConfigured)throw Object.assign(new Error('MySQL chưa được cấu hình trong .env. Chưa thể xác nhận dữ liệu đã vào SQL.'),{code:'DB_NOT_CONFIGURED'});
  await db.dbHealth();
  const [counts]=await db.pool.query('SELECT collection, COUNT(*) AS records FROM crm_documents WHERE deleted=0 GROUP BY collection');
  const [accounts]=await db.pool.query("SELECT role,COUNT(*) AS accounts FROM users WHERE active=1 GROUP BY role");
  const [rows]=await db.pool.query("SELECT d.id,d.body,o.total_amount,o.items_json FROM crm_documents d LEFT JOIN orders o ON o.id=d.id WHERE d.collection='orders' AND d.deleted=0");
  const [auditRows]=await db.pool.query("SELECT id,body FROM crm_documents WHERE collection='audit' AND deleted=0 AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.source'))='ORDER_SQL'");
  const [requests]=await db.pool.query('SELECT request_id,actor_id FROM crm_changes');
  const failures=[];let receiptCount=0,imageCount=0;
  const parse=value=>typeof value==='string'?JSON.parse(value):value;
  for(const row of rows){
   const order=parse(row.body),projection=parse(row.items_json);
   if(row.total_amount==null||Number(row.total_amount)!==Number(order.total))failures.push({id:row.id,issue:'ORDER_TOTAL_PROJECTION'});
   if(order.receiptsVersion===1){
    const receipts=payments.receipts(order);receiptCount+=receipts.length;imageCount+=receipts.reduce((n,r)=>n+payments.images(r).length,0);
    if(payments.paid(order)!==Number(order.amountPaid))failures.push({id:row.id,issue:'RECEIPT_SUM'});
    if(JSON.stringify(projection?.paymentReceipts)!==JSON.stringify(order.paymentReceipts))failures.push({id:row.id,issue:'RECEIPT_PROJECTION'});
    if(JSON.stringify(projection?.billing)!==JSON.stringify(order.billing))failures.push({id:row.id,issue:'BILLING_PROJECTION'});
   }
  }
  const actors=new Map(requests.map(row=>[row.request_id,row.actor_id]));
  for(const row of auditRows){const event=parse(row.body);if(!event.orderId||!event.actorId||!event.role||!Number.isFinite(Date.parse(event.at))||actors.get(event.requestId)!==event.actorId)failures.push({id:row.id,issue:'ORDER_AUDIT_TRANSACTION'});}
  console.log(JSON.stringify({mysql:'connected',readOnly:true,collections:counts,accounts,checkedOrders:rows.length,checkedOrderLogs:auditRows.length,receiptCount,imageCount,failures},null,2));
  if(failures.length)process.exitCode=1;
 }catch(error){console.error(JSON.stringify({mysql:'not_verified',code:error.code||'DB_ERROR',message:error.code==='DB_NOT_CONFIGURED'?error.message:'Không thể hoàn tất kiểm tra SQL; kiểm tra kết nối và schema trên máy chủ.'}));process.exitCode=1;}
 finally{await Promise.all([db.pool.end(),db.authPool.end(),db.telegramPool.end()]);}
})();
