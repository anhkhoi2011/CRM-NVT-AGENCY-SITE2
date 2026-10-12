'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrderPayments=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const num=v=>Math.max(0,Number(v)||0);
 function receipts(order){
  if(order.receiptsVersion===1)return (order.paymentReceipts||[]).map(r=>({...r}));
  const extra=(order.paymentReceipts||[]).map(r=>({...r,kind:r.kind||'PAYMENT',billImage:r.billImage||''}));
  const paid=Number.isFinite(Number(order.amountPaid))?num(order.amountPaid):order.status==='DEPOSIT'?num(order.depositAmount):(order.paidAt||['PAID','COURSE_GRANTED','REFUNDED'].includes(order.status))?num(order.total??order.subtotal):order.status==='DEPOSIT'?num(order.depositAmount):0;
  const extraSum=extra.reduce((s,r)=>s+num(r.amount),0),initial=Math.max(0,paid-extraSum);
  if(!extra.length&&order.depositAt&&order.paidAt&&num(order.depositAmount)>0&&num(order.depositAmount)<paid){return [{id:'LEGACY-DEP-'+order.id,amount:num(order.depositAmount),kind:'DEPOSIT',at:order.depositAt,billImage:order.billImage||'',bankReference:order.bankReference||'',legacy:true},{id:'LEGACY-PAY-'+order.id,amount:paid-num(order.depositAmount),kind:'FULL',at:order.paidAt,billImage:'',bankReference:'',legacy:true}];}
  return [...(initial?[{id:'LEGACY-'+order.id,amount:initial,kind:initial>=num(order.total)?'FULL':'DEPOSIT',at:order.depositAt||order.paidAt||order.createdAt,billImage:order.billImage||'',bankReference:order.bankReference||'',legacy:true}]:[]),...extra];
 }
 function paid(order){return receipts(order).reduce((s,r)=>s+num(r.amount),0);}
 function balance(order){return ['REFUNDED','CANCELLED'].includes(order.status)?0:Math.max(0,num(order.total)-paid(order));}
 function events(order){
  let cumulative=0,allocatedTax=0;const total=num(order.total??order.subtotal),tax=num(order.vatAmount),out=[];
  for(const r of receipts(order)){const amount=num(r.amount);cumulative+=amount;const nextTax=total?Math.round(Math.min(total,cumulative)*tax/total):0;const vatAmount=nextTax-allocatedTax;allocatedTax=nextTax;
   out.push({...r,id:r.id,type:'PAYMENT',label:r.kind==='DEPOSIT'?'Thu cọc':r.kind==='FULL'?'Thanh toán đủ':'Thu bổ sung',orderId:order.id,code:order.code,customerName:order.customerName,paymentMethod:order.paymentMethod,occurredAt:r.at||order.createdAt,amount,vatAmount,netAmount:amount-vatAmount,reconciled:!!order.paymentReconciled});}
  if(order.refundedAt&&num(order.refund)){const amount=-num(order.refund),vatAmount=total?-Math.round(num(order.refund)*tax/total):0;out.push({id:'REF-'+order.id,orderId:order.id,code:order.code,customerName:order.customerName,type:'REFUND',label:'Hoàn tiền',occurredAt:order.refundedAt,amount,vatAmount,netAmount:amount-vatAmount,reconciled:!!order.refundReconciled});}
  return out;
 }
 function status(order,format=String){return order.status==='REFUNDED'?'Đã hoàn tiền':order.status==='CANCELLED'?'Đã hủy':balance(order)===0&&paid(order)>0?'Thanh toán đủ':paid(order)>0?'Cọc '+format(paid(order)):'Chờ thanh toán';}
 function billLabel(kind){return kind==='FULL'?'Bill chuyển khoản đủ':'Bill cọc';}
 function images(receipt){return Array.isArray(receipt.images)?receipt.images.map(i=>({...i})):receipt.billImage?[{id:receipt.id+'-image',imageData:receipt.billImage,note:receipt.note||''}]:receipt.imageData?[{id:receipt.id+'-image',imageData:receipt.imageData,note:receipt.note||''}]:[];}
 function amounts(input){
  const inclusive=input.total!==undefined,base=Number(inclusive?input.total:input.subtotal);
  if(!Number.isSafeInteger(base)||base<=0)throw Error('Tổng tiền phải là số nguyên lớn hơn 0.');
  const vatAmount=Math.round(inclusive?base/11:base*.1),subtotal=inclusive?base-vatAmount:base,total=inclusive?base:base+vatAmount;
  return {subtotal,vatAmount,total,vatRate:.1};
 }
 function billImages(input){
  const list=Array.isArray(input.images)?input.images:input.billImage?[{id:'bill-1',imageData:input.billImage,note:''}]:[];
  const result=list.map((image,index)=>({id:String(image.id||('bill-'+(index+1))),imageData:String(image.imageData||''),note:String(image.note||'').slice(0,500)}));
  if(!result.length||result.length>10||new Set(result.map(i=>i.id)).size!==result.length||result.some(i=>!/^data:image\/(jpeg|png|webp);base64,/.test(i.imageData))||JSON.stringify(result).length>2800000)throw Error('Chọn từ 1 đến 10 ảnh bill, tổng dung lượng tối đa 2,8 MB.');
  return result;
 }
 function productKind(product){
  if(['COURSE','INDICATOR','VIP','OTHER'].includes(product?.kind))return product.kind;
  const label=String(product?.category||product?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();
  if(label.includes('vip'))return 'VIP';
  if(product?.type==='RENTAL'||label.includes('chi bao')||label.includes('indicator')||label.includes('tin hieu'))return 'INDICATOR';
  return label.includes('khoa hoc')||label.includes('course')?'COURSE':'OTHER';
 }
 function customerCourseKey(customer,fields=[]){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const field=fields.find(item=>item.active!==false&&normalize(item.label)==='khoa');
  const value=customer?.customFields?.[field?.id];
  return String(Array.isArray(value)?value.length===1?value[0]:'':value||'').trim();
 }
 function saleCommissionRate(value,fallback=15){const rate=Number(value??fallback);return Math.max(0,Math.min(15,Number.isFinite(rate)?rate:fallback));}
 function commissionAssignment({product,seller,members=[],customer,fields=[],configs=[],courseKey=''}){
  const active=member=>member&&member.active!==false&&member.active!==0&&member.active!=='0';
  const leader=['LEADER','MANAGER'].includes(seller?.role)?seller:members.find(member=>String(member.id)===String(seller?.leaderId||seller?.managerId||seller?.parentId||'')&&['LEADER','MANAGER'].includes(member.role)&&active(member));
  if(!leader||!active(leader))throw Error('Người phụ trách chưa có Leader hoặc Manager trực tiếp.');
  if(productKind(product)!=='COURSE')return {commissionLeaderId:leader.id,commissionSellerRole:seller.role};
  const key=String(courseKey||customerCourseKey(customer,fields)).trim();
  if(!key)throw Error('Chọn khóa của khách hàng trước khi tạo đơn.');
  const config=configs.find(item=>String(item.productId)===String(product.id)&&String(item.courseKey)===key);
  const trainerIds=[...new Set(config?.trainerIds||[])];
  if(trainerIds.length!==1)throw Error('Khóa '+key+' phải được chọn đúng một người đào tạo trong Cấu hình Đào tạo.');
  const trainer=members.find(member=>String(member.id)===String(trainerIds[0])&&active(member)&&['MANAGER','LEADER','SALE'].includes(member.role));
  if(!trainer)throw Error('Người đào tạo của khóa không còn hoạt động.');
  return {commissionLeaderId:leader.id,commissionSellerRole:seller.role,commissionCourseKey:key,commissionTrainerId:trainer.id};
 }
 return {receipts,paid,balance,events,status,images,amounts,billImages,billLabel,productKind,customerCourseKey,saleCommissionRate,commissionAssignment};
});
