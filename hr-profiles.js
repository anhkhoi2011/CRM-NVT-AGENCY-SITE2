'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HrProfiles=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const labels={cccd:'CCCD',cccdIssuedDate:'Ngày cấp CCCD',cccdIssuedPlace:'Nơi cấp CCCD',address:'Địa chỉ thường trú',currentAddress:'Địa chỉ hiện tại',birthDate:'Ngày sinh',gender:'Giới tính',personalTaxCode:'Mã số thuế cá nhân',bankName:'Ngân hàng',bankAccount:'Số tài khoản ngân hàng',bankHolder:'Chủ tài khoản',department:'Phòng ban',position:'Vị trí công việc',startDate:'Ngày vào làm',contract:'Loại hợp đồng',contractNumber:'Số hợp đồng',contractStart:'Ngày bắt đầu hợp đồng',contractEnd:'Ngày hết hạn hợp đồng',emergencyContact:'Người liên hệ khẩn cấp',emergencyPhone:'SĐT liên hệ khẩn cấp',note:'Ghi chú nhân sự'};
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0111/gi,'d').toLowerCase().trim();
 const safeKey=key=>/^[A-Za-z0-9_-]{1,64}$/.test(key)&&!['__proto__','constructor','prototype'].includes(key);
 const safeUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&url.length<=2000;}catch{return false;}};
 function validate(value){
  if(!value||typeof value!=='object'||value.id!==value.employeeId)throw Error('Hồ sơ nhân sự không hợp lệ');
  if(typeof value.employeeId!=='string'||!value.employeeId.trim()||value.employeeId.length>96)throw Error('Nhân viên hồ sơ không hợp lệ');
  const fields=value.fields||{},columns=value.columns||{};
  for(const object of [fields,columns])if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).length>200)throw Error('Danh sách cột hồ sơ không hợp lệ');
  for(const [key,item] of Object.entries(fields))if(!safeKey(key)||typeof item!=='string'||item.length>4000)throw Error('Cột hồ sơ nhân sự không hợp lệ');
  for(const [key,label] of Object.entries(columns))if(!safeKey(key)||typeof label!=='string'||!label.trim()||label.length>160)throw Error('Tên cột hồ sơ không hợp lệ');
  const files=value.driveFiles||[],ids=new Set();
  if(!Array.isArray(files)||files.length>100)throw Error('Danh sách tài liệu nhân sự không hợp lệ');
  for(const file of files){
   if(!file||typeof file.id!=='string'||!file.id||file.id.length>96||ids.has(file.id)||typeof file.label!=='string'||!file.label.trim()||file.label.length>160||typeof file.url!=='string'||!safeUrl(file.url)||typeof (file.note??'')!=='string'||String(file.note??'').length>500)throw Error('Liên kết tài liệu Drive không hợp lệ');
   ids.add(file.id);
  }
  return true;
 }
 function emptyMetric(member,period){return {id:'BRK-'+period+'-'+member.id,memberId:member.id,leaderId:member.role==='SALE'?(member.leaderId||member.managerId||member.id):member.id,teamId:member.teamId||'',memberRole:member.role,period,basicLots:0,miniLots:0,microLots:0,nanoLots:0,productRate:0,lotCommissionRate:0,indicatorCommissionRate:0,courseCommissionRate:0,bonus:0,vatRate:0};}
 function columnKey(label){
  const raw=normalize(label).replace(/[^a-z0-9]/g,'');
  const aliases={id:'id',idtaikhoan:'accountId',accountid:'accountId',mataikhoan:'accountId',manhanvien:'accountId',employeeid:'accountId',hovaten:'name',hoten:'name',tennhanvien:'name',nhanvien:'name',name:'name',email:'email',gmail:'email',sodienthoai:'phone',sdt:'phone',phone:'phone',chucvu:'role',role:'role',team:'team',cccd:'cccd',socccd:'cccd',cmnd:'cccd',diachi:'address',diachithuongtru:'address',ngaysinh:'birthDate',nganhang:'bankName',sotaikhoan:'bankAccount',sotaikhoannganhang:'bankAccount',bankaccount:'bankAccount',hopdong:'contract',masothuecanhan:'personalTaxCode',mst:'personalTaxCode',ghichu:'note',linkdrive:'driveUrl',drive:'driveUrl',driveurl:'driveUrl',tailieu:'driveUrl'};
  if(aliases[raw])return aliases[raw];
  const existing=Object.keys(labels).find(key=>normalize(labels[key]).replace(/[^a-z0-9]/g,'')===raw||normalize(key)===raw);
  if(existing)return existing;
  let hash=2166136261;for(const c of String(label))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  return 'custom_'+(raw.slice(0,40)||'column')+'_'+hash.toString(36);
 }
 function parseCsv(text){
  const source=String(text||'').replace(/^\uFEFF/,''),first=source.split(/\r?\n/)[0]||'';
  const separator=[';', '\t', ','].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){const ch=source[i];if(ch==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===separator&&!quoted){row.push(cell.trim());cell='';}else if((ch==='\r'||ch==='\n')&&!quoted){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw Error('CSV có dấu nháy chưa đóng. Hãy xuất lại file CSV UTF-8.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('CSV phải có hàng tiêu đề và ít nhất một nhân sự.');
  if(rows.length>501)throw Error('Mỗi lần nhập tối đa 500 nhân sự.');
  const headers=rows.shift(),keys=headers.map(columnKey);
  if(headers.some(h=>!h)||new Set(keys).size!==keys.length||headers.length>200)throw Error('Tên cột CSV bị trống, trùng hoặc có quá nhiều cột.');
  const columns=Object.fromEntries(keys.map((key,i)=>[key,headers[i]]));
  return {columns,rows:rows.map((values,i)=>{if(values.length!==keys.length)throw Error('Dòng '+(i+2)+' có số ô khác tiêu đề.');return Object.fromEntries(keys.map((key,j)=>[key,values[j]]));})};
 }
 function importRecords(parsed,members){
  const seen=new Set();return parsed.rows.map((row,index)=>{
   const value=v=>normalize(v),phone=v=>String(v||'').replace(/\D/g,'').replace(/^84/,'0');
   const identifiers=['accountId','id','email','phone'].filter(key=>row[key]);
   if(!identifiers.length&&row.name)identifiers.push('name');
   if(!identifiers.length)throw Error('Dòng '+(index+2)+': cần ID tài khoản, email, SĐT hoặc họ tên.');
   const matches=members.filter(member=>identifiers.every(key=>key==='phone'?phone(member.phone)&&phone(member.phone)===phone(row.phone):key==='accountId'?value(member.accountId)&&value(member.accountId)===value(row.accountId):value(member[key])&&value(member[key])===value(row[key])));
   if(matches.length!==1)throw Error('Dòng '+(index+2)+': '+(matches.length?'trùng nhân sự, cần ID tài khoản/email duy nhất.':'không tìm thấy nhân sự khớp thông tin.'));
   const member=matches[0];if(seen.has(member.id))throw Error('Dòng '+(index+2)+': nhân sự bị lặp trong file.');seen.add(member.id);
   const identity=new Set(['accountId','id','email','phone','name','role','team','driveUrl']);
   const fields=Object.fromEntries(Object.entries(row).filter(([key,value])=>!identity.has(key)&&value!==''));
   const columns=Object.fromEntries(Object.keys(fields).map(key=>[key,parsed.columns[key]]));
   const record={employeeId:member.id,fields,columns,displayName:member.name};
   if(row.driveUrl){if(!safeUrl(row.driveUrl))throw Error('Dòng '+(index+2)+': link tài liệu không hợp lệ.');record.importDriveUrl=row.driveUrl;}
   return record;
  });
 }
 return {labels,normalize,safeKey,safeUrl,validate,emptyMetric,columnKey,parseCsv,importRecords};
});
