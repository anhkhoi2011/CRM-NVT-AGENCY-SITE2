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
 return {receipts,paid,balance,events,status,images,amounts,billImages,billLabel};
});
