'use strict';
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.CrmNotifications=model;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const labels={DATA_ARRIVAL:'Data về',PAYMENT_REVIEW:'Thanh toán cần kiểm tra',PAYMENT_CONFIRMED:'Thanh toán thành công',DATA_UNRECEIVED_24H:'Sale không nhận trong 24 giờ'};
 function kind(notice){
  if(labels[notice.kind])return notice.kind;
  if(labels[notice.type])return notice.type;
  const title=String(notice.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toUpperCase();
  if(/24\s*(H|GIO|HOUR)/.test(title)&&/KHONG NHAN|HET HAN|EXPIRE|UNRECEIVED/.test(title))return 'DATA_UNRECEIVED_24H';
  if(/THANH TOAN|PAYMENT|PAID/.test(title))return /THANH CONG|XAC NHAN|CONFIRM|SUCCESS/.test(title)?'PAYMENT_CONFIRMED':'PAYMENT_REVIEW';
  if(/DATA|WEBHOOK|KHACH MOI|KHACH CU DIEN LAI|KHACH DUOC CHUYEN/.test(title))return 'DATA_ARRIVAL';
  return null;
 }
 function time(value){
  let text=String(value||'').trim().replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text))text+='+07:00';
  return Date.parse(text)||0;
 }
 const clock=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 function formatTime(value){const instant=time(value);return instant?clock.format(new Date(instant)):'—';}
 function list(notices,userId){
  return (notices||[]).filter(n=>kind(n)&&!(n.deletedBy||[]).includes(userId)).slice().sort((a,b)=>time(b.at||b.createdAt)-time(a.at||a.createdAt)||String(b.id||'').localeCompare(String(a.id||'')));
 }
 function shortOrderCode(value){
  const raw=String(value||'').trim();
  if(!raw)return '—';
  if(/^\d{1,8}$/.test(raw))return raw;
  let hash=2166136261;
  for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return String((hash>>>0)%100000000).padStart(8,'0');
 }
 function displayText(notice,value=notice.text){
  const text=String(value||'');
  if(!['PAYMENT_REVIEW','PAYMENT_CONFIRMED'].includes(kind(notice)))return text;
  return text.replace(/\bNVT[-_][a-z0-9]+(?:[-_][a-z0-9]+)*\b/gi,shortOrderCode);
 }
 return {labels,kind,time,formatTime,list,shortOrderCode,displayText};
});
