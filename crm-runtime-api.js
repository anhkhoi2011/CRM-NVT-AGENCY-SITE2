'use strict';
// Cầu nối cùng origin: dùng lại nghiệp vụ, phiên đăng nhập và hàng đợi lưu của CRM.
// Frame chỉ hiển thị lúc đăng nhập; tuyệt đối không đưa DOM/CSS runtime vào trang mẫu.
(() => {
  const referenceFonts=[["aptos","Aptos"],["arial","Arial"],["arialBlack","Arial Black"],["bahnschrift","Bahnschrift"],["calibri","Calibri"],["cambria","Cambria"],["candara","Candara"],["century","Century Gothic"],["comic","Comic Sans MS"],["consolas","Consolas"],["constantia","Constantia"],["corbel","Corbel"],["courier","Courier New"],["franklin","Franklin Gothic Medium"],["georgia","Georgia"],["impact","Impact"],["segoe","Segoe UI"],["tahoma","Tahoma"],["times","Times New Roman"],["trebuchet","Trebuchet MS"],["verdana","Verdana"],["beVietnam","Be Vietnam Pro"],["inter","Inter"],["roboto","Roboto"],["openSans","Open Sans"],["montserrat","Montserrat"],["poppins","Poppins"],["lato","Lato"],["nunito","Nunito"],["raleway","Raleway"],["oswald","Oswald"],["ubuntu","Ubuntu"],["rubik","Rubik"],["manrope","Manrope"],["dmSans","DM Sans"],["workSans","Work Sans"],["quicksand","Quicksand"],["notoSans","Noto Sans"],["notoSerif","Noto Serif"],["plex","IBM Plex Sans"],["merriweather","Merriweather"],["playfair","Playfair Display"],["sourceSans","Source Sans 3"],["fira","Fira Sans"],["firaCode","Fira Code"],["barlow","Barlow"],["outfit","Outfit"],["spaceGrotesk","Space Grotesk"],["sora","Sora"],["plusJakarta","Plus Jakarta Sans"],["libreBaskerville","Libre Baskerville"]];
  let lastNotice = '', pendingResult = null, pendingManualCustomer = null;
  const runtimeToast = toast;
  toast = message => { lastNotice = String(message); runtimeToast(message); };
  const permissionRole = () => typeof effectivePermissionRole === 'function'
    ? effectivePermissionRole()
    : currentAccount?.actualRole || currentAccount?.role || '';
  const requireRole = roles => { if(serverRecoveryPending)throw Error('Đang khôi phục lần lưu trước. Vui lòng chờ trong giây lát.'); if (!currentAccount || !serverStateLoaded || !roles.includes(permissionRole())) throw Error('Tài khoản không có quyền thực hiện thao tác này.'); };
  const persistenceError=()=>Error((typeof serverSaveError!=='undefined'&&serverSaveError?serverSaveError+' — ':'')+'Chưa lưu được dữ liệu. Bản nháp được giữ lại; bấm Lưu để thử lại.');
  async function persist(action, kind, retryInputKey=null) {
    if (!serverStateLoaded && currentAccount && serverSyncToken) await syncServerState();
    if (!currentAccount || !serverStateLoaded) throw Error('Dữ liệu chưa sẵn sàng. Vui lòng chờ đồng bộ rồi thử lại.');
    requireRole(['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED','HRM']);
    if(typeof serverConflict!=='undefined'&&serverConflict&&typeof resolveServerConflict==='function'&&!await resolveServerConflict())throw persistenceError();
    if (pendingResult) {
      if(pendingResult.kind!==kind) throw Error("Hãy lưu lại thao tác trước đó trước khi chuyển sang thao tác khác.");
      if (!await flushServerPersistence({skipAutomatic:kind.startsWith('add-extra-round-turn:')||kind.startsWith('accept-offer:')})) throw persistenceError();
      const changedInput=kind==='accounting-order'&&pendingResult.retryInputKey!==retryInputKey;
      const result=pendingResult.result;pendingResult=null;
      if (!kind.startsWith('customer-field:')) return changedInput?{...result,recoveredWithDifferentInput:true}:result;
    }
    const persistenceBlocked=typeof serverPendingRequest!=='undefined'&&(serverPendingRequest||serverConflict||serverSaveRunning);
    if (!persistenceBlocked&&!await flushServerPersistence()) throw Error('Máy chủ chưa xác nhận dữ liệu trước đó.');
    const result=await action();pendingResult={kind,result:result || {ok:true},retryInputKey}; saveState();
    if (!await flushServerPersistence({skipAutomatic:kind.startsWith('add-extra-round-turn:')})) throw persistenceError();
    pendingResult=null;return result;
  }
  function resetDistributionCursor() {
    state.settings.assignmentCursor ||= {};
    state.settings.assignmentCursor.global = {index:0,ids:[]};
    state.settings.assignmentCursor.leaders = {index:0,ids:[]};
    state.settings.assignmentCursor.salesByTeam = {};
  }
  function distributionRoundViews(){
    const roster=CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
    const config=state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights};
    const store=state.settings.assignmentCursor||{};
    return CrmDistributionRounds.preview(config,CrmDistributionRounds.cursorFrom(store),roster.people,state.settings.assignmentMode);
  }
  const fieldOptionsValid=value=>value===''||state.customFieldDefinitions.find(f=>f.id==='customerClass')?.options.some(o=>o.value===value);
  // Chỉ mở danh sách nghiệp vụ đã cho phép, không nhận tên hàm tùy ý từ giao diện.
  let workflowActive=false,workflowView=false,workflowPending=false;
  function workflowRoot(){return workflowActive?($('#modalRoot .modal-body')||$('#drawerRoot .drawer-body')||(workflowView?$('#content'):null)):null;}
  async function openWorkflow(kind,id){
    if(!currentAccount||!serverStateLoaded)throw Error('Chưa đăng nhập.');
    if(workflowPending||pendingResult)throw Error('Hoàn tất thao tác đang chờ lưu trước.');
    const roles=permissionRole();
    const admin=['import','categories','fields','settings','createTeam','products','distribution','emailTest'];
    if(admin.includes(kind)&&roles!=='ADMIN')throw Error('Chỉ Admin được dùng chức năng này.');
    const allowed=['customer','order','editOrder','newOrder','import','categories','fields','settings','createTeam','password','profile','products','distribution','customers','pool','accept','attendance','revenue','businessReport','accounting','marketing','reports','orders','emailTest','newCustomer'];
    if(!allowed.includes(kind))throw Error('Chức năng không hợp lệ.');
    if(['profile','customers','pool','accept','attendance','revenue','businessReport','accounting','marketing','orders'].includes(kind)&&!allowedViews().includes(kind)&&!(kind==='pool'&&roles==='ADMIN'))throw Error('Không có quyền truy cập.');
    if(['newCustomer','newOrder','editOrder'].includes(kind))requireRole(['ADMIN','MANAGER','LEADER','SALE']);
    if(kind==='reports'&&!['ADMIN','LEADER'].includes(roles))throw Error('Không có quyền báo cáo.');
    if(kind==='customer'&&roles==='SALE'&&!customerById(id)?.saleAcceptedAt)throw Error('Phải nhận data trước khi xem thông tin khách.');
    closeModal();closeDrawer();workflowActive=true;workflowView=false;lastNotice='';
    const actions={customer:()=>openCustomerDrawer(id),order:()=>openOrderDrawer(id),editOrder:()=>editOrderModal(id),newOrder:()=>newOrderModal(id||''),import:customerImportModal,categories:productCategoriesModal,fields:customFieldsModal,createTeam:createTeamModal,password:changePasswordModal,newCustomer:newCustomerModal,emailTest:()=>{openModal('Gửi email kiểm tra','<form id="workflowEmailForm"><label class="form-field">Email nhận thử<input id="emailTestRecipient" type="email" required></label><div class="modal-actions"><button class="button button-primary" type="submit">Gửi kiểm tra</button></div></form>');$('#workflowEmailForm').onsubmit=async e=>{e.preventDefault();await sendTestEmail();};}};
    if(actions[kind])actions[kind]();else{workflowView=true;if(kind==='reports'){VIEW_RENDERERS.reports=reportsView;currentView='reports';render();}else{currentView=kind;render();}}
    if(!workflowRoot())throw Error(lastNotice||'Không mở được chức năng.');
    return {title:$('#modalTitle')?.textContent||$('#drawerRoot h2')?.textContent||$('#content h1')?.textContent||'Chi tiết',notice:lastNotice};
  }
  async function workflowEvent(node,type){
    if(workflowPending){if(!await flushServerPersistence())throw Error('Chưa lưu được. Giữ form và thử lại.');workflowPending=false;return {notice:'Đã lưu dữ liệu.'};}
    const root=workflowRoot();if(!root||!root.contains(node))throw Error('Form đã thay đổi; mở lại để tiếp tục.');
    lastNotice='';
    if(type==='submit'){
      if(!node.checkValidity())throw Error('Kiểm tra các trường bắt buộc trong form.');
      if(node.onsubmit)await node.onsubmit({preventDefault(){},target:node,currentTarget:node});else node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    }else if(type==='click'){
      // Các nút drawer gắn listener không trả Promise: gọi nghiệp vụ tương ứng để chờ lưu.
      if(node.dataset.editNote)editCustomerNote(node.dataset.editNote);
      else if(node.dataset.deleteNote)deleteCustomerNote(node.dataset.deleteNote);






      else if(node.dataset.markPaid)await changeOrderStatus(node.dataset.markPaid,'PAID');
      else if(node.dataset.markDeposit)await changeOrderStatus(node.dataset.markDeposit,'DEPOSIT');
      else if(node.dataset.refundOrder)refundOrderModal(node.dataset.refundOrder);
      else if(node.dataset.grantCourse)await changeOrderStatus(node.dataset.grantCourse,'COURSE_GRANTED');
      else if(node.onclick)await node.onclick({preventDefault(){},stopPropagation(){},target:node,currentTarget:node});else node.click();
    }else{node.dispatchEvent(new Event(type,{bubbles:true,cancelable:true}));if(type==='change'&&node.type==='file')await new Promise(resolve=>setTimeout(resolve,900));}
    if(type!=='input'&&(hasServerChanges()||serverPendingRequest||serverSaveRunning)){
      workflowPending=true;if(!await flushServerPersistence())throw Error('Máy chủ chưa xác nhận. Bấm lại để thử lưu, không tạo bản sao.');workflowPending=false;
    }
    return {notice:lastNotice};
  }
  window.crmApi = {
    openWorkflow,workflowRoot,workflowEvent,
    async saveHrProfiles(inputs){
      requireRole(['ADMIN','HRM']);
      if(!Array.isArray(inputs)||!inputs.length||inputs.length>500)throw Error('Chọn từ 1 đến 500 hồ sơ mỗi lần.');
      return persist(()=>{
        const seen=new Set(),members=state.accounts||state.members;
        const records=inputs.map(input=>{
          const employeeId=String(input.employeeId||'');
          if(seen.has(employeeId)||!members.some(member=>member.id===employeeId))throw Error('Nhân viên không tồn tại hoặc bị trùng trong file.');
          seen.add(employeeId);
          const previous=(state.hrProfiles||[]).find(row=>row.employeeId===employeeId)||{};
          const driveFiles=structuredClone(input.driveFiles??previous.driveFiles??[]);
          if(input.importDriveUrl&&!driveFiles.some(file=>file.url===input.importDriveUrl))driveFiles.push({id:makeRecordId('HRFILE'),label:'Tài liệu nhập từ CSV',url:input.importDriveUrl,note:''});
          const record={...previous,id:employeeId,employeeId,fields:{...previous.fields,...input.fields},columns:{...previous.columns,...input.columns},driveFiles,updatedAt:stamp(),updatedBy:currentAccount.id};
          HrProfiles.validate(record);
          return record;
        });
        state.hrProfiles||=[];
        for(const record of records){const index=state.hrProfiles.findIndex(row=>row.id===record.id);if(index<0)state.hrProfiles.push(record);else state.hrProfiles[index]=record;}
        audit('SAVE_HR_PROFILES','HR',String(records.length)+' hồ sơ');
        return {count:records.length};
      },'hr-profiles');
    },
    exportData(kind,start,end){requireRole(['ADMIN','LEADER','MARKETING','ACCOUNTING']);const methods={customers:exportCustomers,orders:exportOrders,revenue:exportRevenue,marketing:exportMarketing,team:exportTeam,reports:exportFullReport};if(!methods[kind])throw Error('Loại xuất không hợp lệ.');if(start&&end){customDateStart=start;customDateEnd=end;datePreset='CUSTOM';}methods[kind]();},
    async attendanceSettings(input){requireRole(['ADMIN']);return persist(()=>{const time=cleanClockTime(input.deadline,'');if(!time)throw Error('Giờ vào làm không hợp lệ.');state.settings.attendanceDeadline=time;state.settings.acceptTimeoutHours=24;return {ok:true};},'attendance-settings');},
    async saveAttendance(input){
      requireRole(['ADMIN']);
      return persist(()=>{
        const member=state.members.find(m=>m.id===input.accountId);
        if(!member)throw Error('Nhân viên không tồn tại.');
        const date=String(input.date||''),time=String(input.time||'');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>dayIso(0))throw Error('Chọn ngày hợp lệ, không sau hôm nay.');
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Giờ điểm danh không hợp lệ.');
        const note=String(input.note||'').trim();if(!note||note.length>300)throw Error('Nhập lý do điều chỉnh, tối đa 300 ký tự.');
        const previous=state.attendance.find(r=>r.accountId===member.id&&r.date===date);
        const lateMinutes=Math.max(0,timeToMinutes(time)-timeToMinutes(state.settings.attendanceDeadline||'09:00'));
        const next={...previous,id:previous?.id||'ATT-'+date+'-'+member.id,accountId:member.id,name:member.name,teamId:member.teamId||'',date,at:date+' '+time+':00',ip:previous?.ip||'Admin ghi bù',ipValid:previous?.ipValid!==false,late:lateMinutes>0,status:lateMinutes>0?'LATE':'ONTIME',lateMinutes,note,editedBy:currentAccount.name,editedById:currentAccount.id,editedAt:stamp(),source:previous?.source||'ADMIN'};
        if(previous)state.attendance[state.attendance.indexOf(previous)]=next;else state.attendance.unshift(next);
        audit(previous?'UPDATE_ATTENDANCE':'MAKEUP_ATTENDANCE',next.id,member.name+' · '+next.at+' · '+note);
        return {ok:true,id:next.id};
      },'save-attendance:'+input.accountId+':'+input.date);
    },
    async checkIn(){requireRole(['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED']);return persist(()=>{const changed=checkInToday({save:false,render:false});return {ok:true,alreadyCheckedIn:changed===false};},'check-in');},
    async saveBrokerageMetric(metric){
      requireRole(['ADMIN','ACCOUNTING','HRM']);
      if(permissionRole()==='HRM'&&Object.keys(metric||{}).some(key=>!['memberId','period','basicLots','miniLots','microLots'].includes(key)))throw Error('HRM chỉ được nhập Basic, Mini, Micro lot.');
      return persist(()=>{
        const member=state.members.find(item=>item.id===metric.memberId&&['MANAGER','LEADER','SALE'].includes(item.role)&&item.active!==false);
        if(!member)throw Error('Nhân sự không còn hoạt động.');
        const period=String(metric.period||'');if(!/^\d{4}-\d{2}$/.test(period))throw Error('Kỳ báo cáo không hợp lệ.');
        const numberValue=(value,max=1e12)=>{const result=Number(value);if(!Number.isFinite(result)||result<0||result>max)throw Error('Dữ liệu lot hoặc tỷ lệ không hợp lệ.');return result;};
        const id='BRK-'+period+'-'+member.id;
        const index=state.brokerageMetrics.findIndex(item=>item.id===id),previous=index>=0?state.brokerageMetrics[index]:permissionRole()==='HRM'?{id,memberId:member.id,leaderId:member.role==='SALE'?(member.leaderId||member.managerId||member.id):member.id,teamId:member.teamId||'',memberRole:member.role,period,basicLots:0,miniLots:0,microLots:0,nanoLots:0,productRate:0,lotCommissionRate:0,indicatorCommissionRate:0,courseCommissionRate:0,bonus:0,vatRate:0}:{};
        // Trường không gửi lên (vd. Mindmap không có nano lot) giữ nguyên giá trị đã lưu.
        const keep=(field,max)=>numberValue(metric[field]??previous[field]??0,max);
        const next=permissionRole()==='HRM'?{...previous,basicLots:keep('basicLots'),miniLots:keep('miniLots'),microLots:keep('microLots'),updatedAt:stamp()}:{...previous,id,memberId:member.id,leaderId:member.role==='SALE'?(member.leaderId||member.managerId||member.id):member.id,teamId:member.teamId||'',memberRole:member.role,period,basicLots:keep('basicLots'),miniLots:keep('miniLots'),microLots:keep('microLots'),nanoLots:keep('nanoLots'),productRate:keep('productRate',100),lotCommissionRate:keep('lotCommissionRate'),indicatorCommissionRate:keep('indicatorCommissionRate',1),courseCommissionRate:keep('courseCommissionRate',1),bonus:keep('bonus'),vatRate:keep('vatRate',1),updatedAt:stamp()};
        if(next.vatRate>1)throw Error('Thuế suất không hợp lệ.');
        if(index>=0)state.brokerageMetrics[index]=next;else state.brokerageMetrics.unshift(next);
        audit('SAVE_BROKERAGE_METRIC',id,member.name+' · '+period);return {ok:true};
      },'brokerage-metric');
    },
    async saveCourseConfig(input){
      requireRole(['ADMIN','ACCOUNTING']);
      return persist(()=>{
        const courseKey=String(input?.courseKey||'').trim();
        if(!courseKey||courseKey.length>120)throw Error('Chọn Khoá học cần cấu hình.');
        const ids=list=>[...new Set((Array.isArray(list)?list:[]).map(value=>String(value||'').trim()).filter(Boolean))].slice(0,50);
        const rate=(value,fallback)=>{const number=value===''||value==null?fallback:Number(value);if(!Number.isFinite(number)||number<0||number>100)throw Error('Tỷ lệ chia phải từ 0 đến 100%.');return number;};
        state.courseConfigs||=[];
        const productId=String(input?.productId||'').trim();
        if(productId&&!state.products.some(product=>String(product.id)===productId))throw Error('Sản phẩm không còn tồn tại.');
        const existing=state.courseConfigs.find(row=>row.courseKey===courseKey&&String(row.productId||'')===productId);
        const startDate=String(input.startDate||'').slice(0,10);
        if(startDate&&!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate))throw Error('Ngày khai giảng không hợp lệ.');
        const item={id:existing?.id||makeRecordId('CCFG'),courseKey,...(productId?{productId}:{}),trainerIds:ids(input.trainerIds),leaderIds:ids(input.leaderIds),rateSale:rate(input.rateSale,15),rateLeader:rate(input.rateLeader,5),rateTrainer:rate(input.rateTrainer,15),rateCompany:rate(input.rateCompany,65),startDate,updatedAt:stamp()};
        for(const field of ['trainerRates','leaderRates','saleRates']){const source=input[field]??existing?.[field]??{};if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>500)throw Error('Danh sách tỷ lệ hoa hồng không hợp lệ.');item[field]=Object.fromEntries(Object.entries(source).map(([id,value])=>[String(id),rate(value,0)]));}
        if(item.rateSale+item.rateLeader+item.rateTrainer+item.rateCompany>100.0001)throw Error('Tổng tỷ lệ chia không được vượt 100%.');
        if(existing)Object.assign(existing,item);else state.courseConfigs.push(item);
        audit('SAVE_COURSE_CONFIG',item.id,courseKey);
        return {id:item.id,courseKey};
      },'course-config:'+JSON.stringify([input?.productId||'',input?.courseKey||'']));
    },
    async saveExpense(input){
      requireRole(['ADMIN','ACCOUNTING']);
      return persist(()=>{
        const previous=(state.expenses||[]).find(row=>row.id===input.id);
        const item={id:String(input.id||makeRecordId('EXP')),date:String(input.date||''),month:String(input.date||'').slice(0,7),title:String(input.title||'').trim(),category:String(input.category||'Khác').trim(),amount:Number(input.amount),payer:String(input.payer||currentAccount.name).trim(),note:String(input.note||'').trim(),createdAt:previous?.createdAt||stamp(),createdBy:previous?.createdBy||currentAccount.id,updatedAt:stamp()};
        if(!item.date||!item.title||!Number.isFinite(item.amount)||item.amount<=0)throw Error('Nhập đầy đủ khoản chi và số tiền hợp lệ.');
        const index=(state.expenses||[]).findIndex(row=>row.id===item.id);if(index>=0)state.expenses[index]={...state.expenses[index],...item};else{state.expenses||=[];state.expenses.unshift(item);}audit(index>=0?'UPDATE_EXPENSE':'CREATE_EXPENSE',item.id,item.title);return {id:item.id};
      },'expense:'+String(input.id||'new'));
    },
    async removeExpense(id){requireRole(['ADMIN','ACCOUNTING']);return persist(()=>{const item=(state.expenses||[]).find(row=>row.id===id);if(!item)throw Error('Khoản chi không còn tồn tại.');state.expenses=state.expenses.filter(row=>row.id!==id);audit('DELETE_EXPENSE',id,item.title);return {ok:true};},'remove-expense:'+id);},
    async updateOrderAccounting(id,input){
      requireRole(['ADMIN','ACCOUNTING','SALE','LEADER','MANAGER']);
      return persist(()=>{
        const original=state.orders.find(item=>item.id===id);if(!original)throw Error('Đơn hàng không còn tồn tại.');const order=structuredClone(original);
        const action=String(input?.action||'');
        const role=permissionRole();
        if(action==='ISSUE_VAT'&&!['ADMIN','ACCOUNTING'].includes(role))throw Error('Chỉ Kế toán hoặc Admin được xuất VAT.');
        if(!['ADMIN','ACCOUNTING'].includes(role)&&(!scopedOrders().some(o=>o.id===id)||!['UPDATE','COLLECT','SAVE_RECEIPT_IMAGES'].includes(action)))throw Error('Không có quyền chỉnh sửa đơn này.');
        if(['UPDATE','COLLECT','SAVE_RECEIPT_IMAGES'].includes(action)&&(order.paymentReconciled||order.vatIssued||['REFUNDED','CANCELLED','COURSE_GRANTED'].includes(order.status)))throw Error('Đơn đã đối soát, xuất hóa đơn hoặc kết thúc; không thể sửa trực tiếp.');
        const text=(value,max=4000)=>String(value??'').trim().slice(0,max);
        if(action==='RECONCILE'){
          if(!['ADMIN','ACCOUNTING'].includes(role))throw Error('Chỉ Kế toán hoặc Admin được xác nhận đối soát.');
          if(order.paymentReconciled)throw Error('Đơn đã được đối soát.');
          if(!['PAID','COURSE_GRANTED'].includes(order.status)||OrderPayments.balance(order)!==0||OrderPayments.paid(order)!==order.total)throw Error('Sale cần ghi nhận đủ tiền trước khi Kế toán đối soát.');
          if(input.confirmed!==true)throw Error('Xác nhận đã kiểm tra các bill và giao dịch ngân hàng.');
          if(OrderPayments.receipts(order).some(r=>!OrderPayments.images(r).length))throw Error('Cần bổ sung ảnh bill cho từng lần thu trước khi đối soát.');
          order.paymentReconciled=true;order.paymentReconciledAt=stamp();order.paymentReconciledBy=currentAccount.id;order.reconciliationNote=text(input.note,1000);
          audit('RECONCILE_ORDER',id,order.code);
        }else if(action==='SAVE_RECEIPT_IMAGES'){
          const receipts=OrderPayments.receipts(order),receipt=receipts.find(r=>r.id===input.receiptId);
          if(!receipt)throw Error('Không tìm thấy lần thanh toán.');
          const before=OrderPayments.images(receipt),images=(Array.isArray(input.images)?input.images:[]).map(i=>({id:text(i.id,120)||makeRecordId('IMG'),imageData:String(i.imageData??''),note:text(i.note,500)}));
          if(images.length>10||images.some(i=>!/^data:image\/(jpeg|png|webp);base64,/.test(i.imageData))||new Set(images.map(i=>i.id)).size!==images.length)throw Error('Tối đa 10 ảnh bill hợp lệ.');
          if(JSON.stringify(before)===JSON.stringify(images))return {ok:true,order:original};
          receipt.images=images;receipt.imageRevisions=[...(receipt.imageRevisions||[]),{id:makeRecordId('REV'),at:stamp(),by:currentAccount.id,images:before}];
          if(JSON.stringify(receipts).length>6000000)throw Error('Dung lượng ảnh của đơn đã đầy, hãy dùng ảnh nhỏ hơn.');
          order.receiptsVersion=1;order.paymentReceipts=receipts;order.updatedAt=stamp();
          audit('UPDATE_RECEIPT_IMAGES',id,receipt.id+' · '+images.length+' ảnh');
        }else if(action==='ISSUE_VAT'){
          if(!['ADMIN','ACCOUNTING'].includes(role))throw Error('Chỉ Kế toán hoặc Admin được xuất VAT.');
          if(!order.paymentReconciled||OrderPayments.balance(order)!==0)throw Error('Cần Kế toán đối soát đủ trước khi ghi nhận hóa đơn VAT.');
          if(!text(input.invoiceNumber,120)||!/^\d{10,13}$/.test(text(input.taxCode,20)||order.taxCode||'')||!(text(input.companyName,200)||order.companyName))throw Error('Nhập số hóa đơn, MST và tên công ty hợp lệ.');
          order.vatIssued=true;order.vatIssuedAt=stamp();
          order.vatInvoiceNumber=text(input.invoiceNumber,120);order.requireVat=true;
          order.taxCode=text(input.taxCode,20)||text(order.taxCode,20);
          order.companyName=text(input.companyName,200)||text(order.companyName,200);
          order.billing={...(order.billing||{}),address:text(input.address,240)||text(order.billing?.address,240),email:text(input.email,254)||text(order.billing?.email,254),taxId:order.taxCode};
          audit('ISSUE_VAT',id,order.vatInvoiceNumber||order.code);
        }else if(action==='COLLECT'){
          const amount=Number(input.amount),balance=OrderPayments.balance(order),images=OrderPayments.billImages(input),billImage=images[0].imageData;
          if(!Number.isSafeInteger(amount)||amount<=0||amount>balance)throw Error('Số tiền thu thêm phải lớn hơn 0 và không vượt số tiền cần thu.');
          if(!/^data:image\/(jpeg|png|webp);base64,/.test(billImage))throw Error('Cần tải bill cho lần thanh toán này.');
          if(input.confirmed!==true)throw Error('Xác nhận đã nhận tiền trước khi lưu.');
          images.forEach(image=>{if(!image.note)image.note=OrderPayments.billLabel(amount===balance?'FULL':'DEPOSIT');});
          const receipts=OrderPayments.receipts(order);
          if(receipts.length>=20||JSON.stringify(receipts).length+JSON.stringify(images).length+billImage.length>6000000)throw Error('Dung lượng bill của đơn đã đầy. Hãy sử dụng ảnh bill nhỏ hơn.');
          receipts.push({id:makeRecordId('PAY'),amount,kind:amount===balance?'FULL':receipts.length?'PAYMENT':'DEPOSIT',bankReference:text(input.bankReference,240),note:text(input.note,500),billImage,images,at:stamp(),createdBy:currentAccount.id});
          order.receiptsVersion=1;order.paymentReceipts=receipts;order.billImage='';
          order.amountPaid=OrderPayments.paid(order);order.balanceDue=OrderPayments.balance(order);
          order.paymentMode=order.balanceDue===0?'FULL':'DEPOSIT';order.status=order.balanceDue===0?'PAID':'DEPOSIT';
          order.depositAmount=receipts[0]?.kind==='DEPOSIT'?receipts[0].amount:0;
          if(order.status==='PAID')order.paidAt=stamp();order.updatedAt=stamp();
          audit('COLLECT_ORDER_DEBT',id,String(amount));
        }else if(action==='UPDATE'){
          const customer=state.customers.find(item=>String(item.id)===String(order.customerId));
          const name=text(input.customerName,160),phone=text(input.customerPhone,30);
          if(!name||phone.replace(/\D/g,'').length<9)throw Error('Tên và số điện thoại khách hàng không hợp lệ.');
          order.customerName=name;order.customerPhone=phone;
          order.saleNote=text(input.saleNote,1000);order.requireVat=input.requireVat===true;
          order.billing={...(order.billing||{}),name,phone,email:text(input.customerEmail||input.email,254),cccd:text(input.customerCccd,20),address:text(input.customerAddress||input.address,240),taxId:text(input.taxCode,20)};
          order.taxCode=text(input.taxCode,20);order.companyName=text(input.companyName,200);
          const breakdown=OrderPayments.amounts(input),subtotal=breakdown.subtotal;
          Object.assign(order,breakdown);
          const amountPaid=OrderPayments.paid(original);
          if(Number(input.amountPaid??input.collected??amountPaid)!==amountPaid)throw Error('Dùng Thêm thanh toán để ghi nhận tiền thu thêm; không sửa đè lịch sử thu.');
          if(!Number.isFinite(amountPaid)||amountPaid<=0||amountPaid>order.total)throw Error('Số tiền đã thu không hợp lệ.');
          const product=state.products.find(p=>p.id===(input.productId||order.productId));if(!product)throw Error('Sản phẩm không tồn tại.');
          Object.assign(order,{productId:product.id,productName:product.name,sku:product.sku||'',unitPrice:subtotal/(order.qty||1),updatedAt:stamp()});
          order.paymentMode=amountPaid===order.total?'FULL':'DEPOSIT';
          if(amountPaid<order.total)order.paidAt=null;
          order.amountPaid=amountPaid;order.balanceDue=Math.max(0,order.total-amountPaid);order.status=order.balanceDue===0?'PAID':amountPaid>0?'DEPOSIT':'PENDING';
          if(order.status==='PAID')order.paidAt=order.paidAt||stamp();
          // Thông tin khách trên đơn là bản chụp riêng, không đổi hồ sơ nguồn.
          audit('UPDATE_ACCOUNTING_ORDER',id,order.code||id);
        }else if(action==='DELETE'){
          state.orders=state.orders.filter(item=>item.id!==id);audit('DELETE_ACCOUNTING_ORDER',id,order.code||id);return {ok:true,deleted:true};
        }else throw Error('Thao tác kế toán không hợp lệ.');
        Object.assign(original,order);return {ok:true,order:original};
      },'order-accounting:'+id+':'+String(input?.action||'')+':'+String(input?.receiptId||''));
    },

    async closeWorkflow(force=false){
      if(!force&&workflowPending&&!await flushServerPersistence())throw Error("Dữ liệu chưa được lưu; giữ form để thử lại.");
      // Cho phép đóng giao diện khi mạng/MySQL tạm thời lỗi; request nháp vẫn
      // được giữ trong hàng đợi để vòng đồng bộ nền tiếp tục thử lại.
      workflowPending=false;workflowActive=false;workflowView=false;closeModal();closeDrawer();
    },
    async selectManagerTeam(leaderId){
      if(currentAccount?.actualRole!=='MANAGER')throw Error('Chỉ Manager được chọn hệ thống quản lý.');
      if(!state.members.some(m=>m.id===leaderId&&m.role==='LEADER'&&m.active!==false&&m.managerId===currentAccount.id))throw Error('Team chưa được Admin giao.');
      if(!await flushServerPersistence())throw Error('Hoàn tất lưu trước khi đổi Team.');
      managerTeamSelection=leaderId;currentAccount=hydrateSessionAccount({...currentAccount,role:'MANAGER'});closeModal();closeDrawer();return {ok:true};
    },
    resolveConflict(){return resolveServerConflict();},
    sessionIdentity(){return currentAccount&&serverStateLoaded&&!serverRecoveryPending?{id:currentAccount.id,conflict:serverConflict}:null;},
    customerSelection(id,kind,fieldId){
      const customer=customerById(id);
      if(!currentAccount||!serverStateLoaded||!customer||!canViewCustomer(customer))throw Error('Không còn quyền xem khách hàng trong bản nháp.');
      return structuredClone(kind==='field'?(customer.customFields?.[fieldId]??''):kind==='leader'?(customer.leaderId||''):(customer.saleId||''));
    },
    snapshot() {
      if (!currentAccount || !serverStateLoaded) return null;
      if(currentAccount.actualRole==='MANAGER')currentAccount=hydrateSessionAccount(currentAccount);
      // Manager xem toan bo cac nhanh Leader duoc Admin giao; Sale chi nhan snapshot day du sau khi da bam nhan data.
      const managerLeaderIds=currentAccount.actualRole==='MANAGER'
        ? new Set(state.members.filter(m=>m.role==='LEADER'&&m.active!==false&&m.managerId===currentAccount.id).map(m=>m.id))
        : null;
      const customers=currentAccount.actualRole==='MANAGER'
        ? state.customers.filter(c=>c.managerId===currentAccount.id||c.ownerId===currentAccount.id||managerLeaderIds.has(c.leaderId)||state.members.some(m=>m.role==='SALE'&&m.managerId===currentAccount.id&&m.id===c.saleId))
        : scopedCustomers().filter(c=>permissionRole()!=='SALE'||!!c.saleAcceptedAt);
      const managerHierarchy=currentAccount.actualRole==='MANAGER'?(()=>{
        const leaderIds=new Set(state.members.filter(m=>m.role==='LEADER'&&m.active!==false&&m.managerId===currentAccount.id).map(m=>m.id));
        const managerSales=new Set(state.members.filter(m=>m.role==='SALE'&&m.active!==false&&(m.managerId===currentAccount.id||leaderIds.has(m.leaderId))).map(m=>m.id));
        const members=state.members.filter(m=>m.id===currentAccount.id||leaderIds.has(m.id)||m.role==='SALE'&&managerSales.has(m.id));
        const hierarchyCustomers=state.customers.filter(c=>c.managerId===currentAccount.id||c.ownerId===currentAccount.id||leaderIds.has(c.leaderId)||managerSales.has(c.saleId));
        const orders=state.orders.filter(o=>o.managerId===currentAccount.id||o.saleId===currentAccount.id||leaderIds.has(o.leaderId)||managerSales.has(o.saleId));
        const orderIds=new Set(orders.map(o=>o.id));
        return {members,customers:hierarchyCustomers,orders,tasks:state.tasks.filter(t=>leaderIds.has(t.leaderId)||managerSales.has(t.ownerId)),financialEvents:financialEvents(orders).filter(e=>orderIds.has(e.orderId))};
      })():null;
      const visibleOrders=currentAccount.actualRole==='MANAGER'
        ? state.orders.filter(o=>o.managerId===currentAccount.id||o.saleId===currentAccount.id||managerLeaderIds.has(o.leaderId)||state.members.some(m=>m.role==='SALE'&&m.managerId===currentAccount.id&&m.id===o.saleId))
        : scopedOrders();
      const visibleCustomerIds=new Set(customers.map(customer=>customer.id));
      const assignmentHistory=state.assignmentHistory.filter(item=>visibleCustomerIds.has(item.customerId));
      // Level do nhân viên chủ động chọn: có lịch sử đổi Level không phải nguồn tự động,
      // hoặc dữ liệu cũ đã mang Level khác mặc định L0.
      const autoLevelSources=new Set(['API','FORM','IMPORT','SYSTEM']);
      const levelChosenIds=new Set(state.customerFieldHistory.filter(h=>h.fieldId==='customerLevel'&&h.to!==''&&h.to!=null&&!autoLevelSources.has(h.source)).map(h=>h.customerId));
      const markLevel=list=>(list||[]).forEach(c=>{const level=String(c.customFields?.customerLevel??'');c.levelChosen=levelChosenIds.has(c.id)||(level!==''&&level!=='L0');});
      const view=structuredClone({user:currentAccount,distributionRoundViews:distributionRoundViews(),distributionExtraTurnPeople:CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader).people,managerHierarchy,fonts:referenceFonts,assignedDataStats:currentAccount.role==='SALE'?assignedDataStatsForMe():null,pendingOffers:currentAccount.role==='SALE'?pendingOffersForMe().map(o=>({id:o.id,name:customerById(o.customerId)?.name||'',offeredAt:o.offeredAt,minutesLeft:offerMinutesLeft(o)})):[],customers,orders:visibleOrders,products:state.products,productCategories:state.productCategories,members:state.members,hrRoster:['ADMIN','HRM'].includes(permissionRole())?(state.accounts||state.members):[],hrProfiles:['ADMIN','HRM'].includes(permissionRole())?(state.hrProfiles||[]):[],orderAssignees:state.orderAssignees||state.members,registeredAccounts:state.registeredAccounts,fields:state.customFieldDefinitions,careGroups:state.careGroups,imports:currentAccount.role==='ADMIN'?state.imports:[],resubmissions:state.resubmissions,assignmentHistory,websites:state.websites.map(w=>({...w,publicWebhookUrl:webhookUrlFor(w)})),webhookPending,webhookTransport:{...webhookTransport,label:(WEBHOOK_TRANSPORT_META[webhookTransport.mode]||WEBHOOK_TRANSPORT_META.idle)[0]},settings:state.settings,notifications:visibleNotifications(),audit:state.audit,attendance:state.attendance,brokerageMetrics:state.brokerageMetrics,feedbacks:state.feedbacks,processes:state.processes,expenses:['ADMIN','ACCOUNTING'].includes(permissionRole())?state.expenses:[],courseConfigs:state.courseConfigs||[],tasks:scopedTasks(),leaderDistribution:state.leaderDistribution,saleDistributionByLeader:state.saleDistributionByLeader,offers:state.dataOffers,financialEvents:financialEvents(visibleOrders),navigation:allowedViews(),today:dayIso(0)});
      markLevel(view.customers);markLevel(view.managerHierarchy?.customers);
      return view;
    },
    async logout() { await endSession(); },
    async refresh() { return syncServerState(); },
    // Sale nhận đúng lời mời đang chờ và chỉ báo thành công sau khi MySQL xác nhận lưu.
    async acceptOffer(offerId) {
      requireRole(['SALE']);
      return persist(() => {
        if (!acceptDataOffer(offerId)) throw Error(lastNotice || 'Không nhận được data này.');
        return {ok:true};
      }, 'accept-offer:' + offerId);
    },
    async classify(id, value) {
      const c=customerById(id);if (!fieldOptionsValid(value)) throw Error('Phân loại không hợp lệ.');if (!canUpdateCustomer(c)) throw Error('Không được sửa khách hàng này.');
      await quickUpdateCustomerField(id,'customerClass',value);
      if (!await flushServerPersistence()) throw Error('Chưa lưu được phân loại khách.');
    },
    // Chuyển Team phải thu hồi lời mời cũ, giữ lịch sử và chờ máy chủ xác nhận.
    async assignLeader(id,leaderId){
      requireRole(['ADMIN']);
      return persist(()=>{
        const customer=customerById(id),leader=activeStaff().find(m=>m.id===leaderId&&['MANAGER','LEADER'].includes(m.role));
        if(!customer||!leader)throw Error('Khách hoặc Leader không còn hoạt động.');
        if(customer.leaderId===leader.id&&customer.teamId===leader.teamId)return {ok:true};
        closeOpenCustomerTasks(customer,'TRANSFERRED_TO_LEADER');
        state.dataOffers.forEach(o=>{if(o.customerId===id&&o.status==='PENDING'){o.status='EXPIRED';o.resolvedAt=stamp();}});
        customer.saleAcceptedAt=null;
        applyCustomerAssignment(customer,leader,'Chuyển Team/Leader thủ công');
        audit('REASSIGN_CUSTOMER',id,leader.name+' · '+leader.teamId);
        return {ok:true};
      },'assign-leader:'+id);
    },
    async assign(id, saleId) { if (!await quickAssignSale(id,saleId)) throw Error(lastNotice || 'Chưa phân công được Sale.'); },
    async createCustomer(input) {
      requireRole(['ADMIN','MANAGER','LEADER','SALE']);
      if(serverConflict)throw Error('Dữ liệu đang xung đột. Hãy tải lại CRM trước khi thêm khách.');
      if(!pendingManualCustomer){
        if((hasServerChanges()||serverPendingRequest||serverSaveRunning)&&!await flushServerPersistence())throw Error('Dữ liệu trước đó chưa được MySQL xác nhận. Giữ trang mở và thử lại.');
        pendingManualCustomer={requestId:makeRecordId('MANUAL'),input:structuredClone(input||{})};
      }
      try{
        const response=await fetch(`${webhookApiBase()}/api/customers/manual`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${serverSyncToken}`},body:JSON.stringify({...pendingManualCustomer.input,requestId:pendingManualCustomer.requestId})});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(payload.error||`Không lưu được khách hàng (HTTP ${response.status}).`);
        applyServerSnapshot(payload);
        const result={id:payload.customerId,duplicate:payload.duplicate===true};
        pendingManualCustomer=null;
        return result;
      }catch(error){
        if(error instanceof TypeError)throw Error('Không kết nối được máy chủ. Giữ form mở và bấm Lưu lại để gửi đúng một lần.');
        throw error;
      }
    },
    async deleteCustomer(id) {
      requireRole(['ADMIN','MANAGER']);
      return persist(() => {
        const customer = state.customers.find(item => item.id === id);
        if (permissionRole()==='MANAGER' && !scopedCustomers().some(item=>item.id===id)) throw Error('Data is outside the Manager scope.');
        if (!customer) throw Error('Data không còn tồn tại trên máy chủ.');
        state.customers = state.customers.filter(item => item.id !== id);
        state.dataOffers = state.dataOffers.filter(item => item.customerId !== id);
        state.tasks = state.tasks.filter(item => item.customerId !== id);
        state.resubmissions = state.resubmissions.filter(item => item.customerId !== id);
        audit('DELETE_CUSTOMER', id, customer.name);
        return {ok:true};
      },'delete-customer:'+id);
    },
    async deleteOrder(id) {
      requireRole(['ADMIN','MANAGER','LEADER','SALE']);
      return persist(() => {
        const order = state.orders.find(item => item.id === id);
        if (!order) throw Error('Order no longer exists on server.');
        if (permissionRole() !== 'ADMIN') {
          const raw = String(order.createdAt || '').trim();
          const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
          const created = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+07:00`);
          if (!Number.isFinite(created) || Date.now() - created >= 3 * 24 * 60 * 60 * 1000) {
            throw Error('Đơn hàng chỉ được xóa trong 3 ngày đầu.');
          }
          if (!canViewCustomer(customerById(order.customerId))) throw Error('Đơn hàng nằm ngoài phạm vi được giao.');
        }
        state.orders = state.orders.filter(item => item.id !== id);
        audit('DELETE_ORDER', id, order.code || id);
        return {ok:true};
      },'delete-order:'+id);
    },
    async createCare(input) {
      requireRole(['ADMIN']);
      return persist(()=>{
        const field=state.customFieldDefinitions.find(f=>f.id===input.fieldId&&f.active!==false);
        if (!field || !input.name.trim() || !input.values.length || input.values.some(v=>!field.options.some(o=>o.value===v))) throw Error('Tên mục hoặc lựa chọn không hợp lệ.');
        if ((state.careGroups||[]).some(g=>normalize(g.name)===normalize(input.name))) throw Error('Tên mục đã tồn tại.');
        const group={id:makeRecordId('CARE'),name:input.name.trim(),fieldId:input.fieldId,values:input.values};
        state.careGroups=[...(state.careGroups||[]),group];return group;
      },'care');
    },
    async createOrder(input) {
      requireRole(['ADMIN','MANAGER','LEADER','SALE','ACCOUNTING']);
      if (input?.source === 'accounting-iframe') {
        return persist(() => {
          const payload = input || {};
          const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
          const phone = text(payload.phone, 20).replace(/[^0-9+]/g, '');
          const name = text(payload.customerName, 160);
          if (!name || phone.replace(/\D/g, '').length < 9) throw Error('\u0054\u00ean v\u00e0 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i kh\u00e1ch h\u00e0ng kh\u00f4ng h\u1ee3p l\u1ec7.');
          const directory=state.orderAssignees||state.members;
          const active=member=>member&&member.active!==false&&member.active!==0&&member.active!=='0';
          const sale=directory.find(member=>String(member.id)===String(payload.saleId)&&active(member)&&['MANAGER','LEADER','SALE'].includes(member.role));
          if(!sale)throw Error('Người phụ trách không còn hoạt động. Hãy tải lại danh sách.');
          // Một SĐT có thể mua nhiều lần. Chỉ dùng lại hồ sơ của đúng người
          // phụ trách; không đổi chủ data của người khác hoặc data chưa phân.
          const phoneKey=value=>String(value||'').replace(/\D/g,'').replace(/^84(?=\d{9,10}$)/,'0');
          let customer=state.customers.find(item=>phoneKey(item.phone)===phoneKey(phone)&&String(item.saleId||'')===String(sale.id));
          const leader=sale.role==='LEADER'?sale:directory.find(member=>member.role==='LEADER'&&String(member.id)===String(sale.leaderId||''));
          const manager=sale.role==='MANAGER'?sale:directory.find(member=>member.role==='MANAGER'&&String(member.id)===String(sale.managerId||leader?.managerId||sale.leaderId||''));
          const assignment={saleId:sale.id,leaderId:sale.role==='LEADER'?sale.id:(sale.leaderId||null),managerId:sale.role==='MANAGER'?sale.id:(manager?.id||null),teamId:sale.teamId||leader?.teamId||manager?.teamId||''};
          const product = state.products.find(item => String(item.id) === String(payload.productId) && item.active !== false);
          if (!product) throw Error('S\u1ea3n ph\u1ea9m kh\u00f4ng c\u00f2n ho\u1ea1t \u0111\u1ed9ng trong danh m\u1ee5c CRM.');
          const images=OrderPayments.billImages(payload);
          const breakdown=OrderPayments.amounts(payload),requestedSubtotal=breakdown.subtotal,requestedPaid=Number(payload.amountPaid??payload.collected??0);
          if(!Number.isFinite(requestedSubtotal)||requestedSubtotal<=0||!Number.isFinite(requestedPaid)||requestedPaid<=0||requestedPaid>breakdown.total)throw Error('Số tiền đơn hàng hoặc thực thu không hợp lệ.');
          if (!customer) {
            customer={id:makeRecordId('CUS'),name,phone,email:text(payload.email,254),cccd:text(payload.cccd,20),address:text(payload.address,240),...assignment,createdVia:'ORDER',createdBy:currentAccount.id,source:text(payload.sourceLabel,160)||'Nh\u1eadp \u0111\u01a1n h\u00e0ng',sourceUrl:text(payload.sourceUrl,500),websiteId:payload.websiteId||null,status:'NEW',active:true,createdAt:stamp(),saleAcceptedAt:stamp(),customFields:{}};
            state.customers.unshift(customer);
          }
          const qty=Math.max(1,Math.min(10,Math.floor(Number(payload.qty)||1))),subtotal=breakdown.subtotal; if(!Number.isFinite(subtotal)||subtotal<=0)throw Error('Doanh thu \u0111\u01a1n h\u00e0ng kh\u00f4ng h\u1ee3p l\u1ec7.');
          const {vatRate,vatAmount,total}=breakdown,amountPaid=Number(payload.amountPaid??payload.collected??0),status=amountPaid>=total?'PAID':amountPaid>0?'DEPOSIT':'PENDING',createdAt=stamp(),id=makeRecordId('ORD');
          const order={id,code:`NVT-${id.slice(4)}`,customerId:customer.id,customerName:name,customerPhone:phone,createdBy:currentAccount.id,saleId:sale.id,saleName:sale.name,leaderId:assignment.leaderId,managerId:assignment.managerId,teamId:assignment.teamId,source:customer.source||'Nh\u1eadp \u0111\u01a1n h\u00e0ng',sourceUrl:customer.sourceUrl||'',websiteId:customer.websiteId||null,productId:product.id,productName:product.name,sku:product.sku||'',courseCode:text(payload.courseCode,160),qty,unitPrice:Number(product.price||0),subtotal,vatRate,vatAmount,discount:0,total,paymentMode:amountPaid>=total?'FULL':'DEPOSIT',depositAmount:amountPaid,amountPaid,balanceDue:Math.max(0,total-amountPaid),paymentMethod:text(payload.paymentMethod,40)||'BANK_TRANSFER',bankReference:text(payload.bankReference,160),billing:{name:text(payload.billing?.name)||name,phone:text(payload.billing?.phone)||phone,email:text(payload.billing?.email||payload.email,254),cccd:text(payload.billing?.cccd||payload.cccd,20),address:text(payload.billing?.address||payload.address,240),taxId:text(payload.billing?.taxId||payload.taxCode,20)},requireVat:payload.requireVat===true,paymentReference:text(name.replace(/\s+/g,' ').trim()+' '+phone,200),taxCode:text(payload.taxCode,20),companyName:text(payload.companyName,200),saleNote:text(payload.saleNote,1000),billImage:images[0].imageData,rentalMonths:product.type==='RENTAL'?Number(product.rentalMonths)||null:null,rentalEndsAt:null,refund:0,status,createdAt,depositAt:amountPaid>0?createdAt:null,paidAt:status==='PAID'?createdAt:null,refundedAt:null,paymentReconciled:false,refundReconciled:null,vatIssued:false,vatIssuedAt:null,vatInvoiceNumber:''};
          images.forEach(image=>{if(!image.note)image.note=OrderPayments.billLabel(status==='PAID'?'FULL':'DEPOSIT');});
          if(amountPaid>0){if(!order.billImage)throw Error('Đính kèm bill chuyển khoản.');order.receiptsVersion=1;order.paymentReceipts=[{id:makeRecordId('PAY'),amount:amountPaid,kind:status==='PAID'?'FULL':'DEPOSIT',at:createdAt,billImage:order.billImage,images,bankReference:order.bankReference,createdBy:currentAccount.id}];order.billImage='';}
          state.orders.unshift(order); audit('CREATE_ORDER',id,`${order.code} \u00b7 ${order.productName}`); return {id:order.id,code:order.code,order,customer};
        },'accounting-order',JSON.stringify(input));
      }
      requireRole(['ADMIN','LEADER','SALE']);
      // Gọi đúng form nghiệp vụ hiện có trong frame để giữ kiểm tra giá, VAT và phân quyền.
      if(pendingResult) return persist(()=>{},'order');
      if(!await flushServerPersistence())throw Error('Dữ liệu trước đó chưa được lưu.');
      const customer=customerById(input.customerId),product=productById(input.productId);
      if(!customer||!canViewCustomer(customer)||!customer.saleId||!product||product.active===false)throw Error('Chọn khách đã phân Sale và sản phẩm đang hoạt động.');
      newOrderModal(customer.id);
      const values={newOrderCustomer:customer.id,newOrderProduct:product.id,newOrderQty:1,newOrderPaymentMode:input.paymentMode,newOrderPaymentMethod:input.paymentMethod,newOrderDeposit:input.depositAmount??Math.round(product.price*1.1/2),newOrderBillingName:input.billing?.name||customer.name,newOrderBillingPhone:input.billing?.phone||customer.phone,newOrderBillingEmail:input.billing?.email||customer.email||'',newOrderBillingCccd:input.billing?.cccd||'',newOrderBillingAddress:input.billing?.address||'',newOrderBillingTaxId:input.billing?.taxId||'',newOrderCourse:input.courseCode||'',newOrderBankReference:input.bankReference||''};
      Object.entries(values).forEach(([id,value])=>$('#'+id).value=value);
      const before=new Set(state.orders.map(o=>o.id)); lastNotice='';
      await $('#newOrderForm').onsubmit({preventDefault(){}});
      const order=state.orders.find(o=>!before.has(o.id));
      if(!order)throw Error(lastNotice||'Không tạo được đơn hàng.');
      if(serverPendingRequest||serverConflict||hasServerChanges()){pendingResult={kind:'order',result:{id:order.id,code:order.code}};throw Error('Chưa xác nhận lưu đơn. Giữ form mở để thử lại.');}
      return {id:order.id,code:order.code};
    },
    // Lưu danh mục qua hàng đợi giao dịch chung; thử lại không tạo sản phẩm thứ hai.
    async saveProduct(id, input) {
      requireRole(['ADMIN']);
      return persist(()=>{
        const existing=id?state.products.find(p=>p.id===id):null;
        if(id&&!existing)throw Error('Sản phẩm không còn tồn tại.');
        const vatPercent= input.vatRate===''||input.vatRate==null ? 10 : Number(input.vatRate);
        const imageData=Object.hasOwn(input,'imageData')?String(input.imageData||''):String(existing?.imageData||'');
        if(imageData&&(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)||imageData.length>2_800_000))throw Error('\u1ea2nh s\u1ea3n ph\u1ea9m kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c qu\u00e1 l\u1edbn.');
        const kind=['COURSE','INDICATOR','VIP','OTHER'].includes(input.kind)?input.kind:(existing?.kind||(input.type==='RENTAL'?'INDICATOR':'OTHER'));
        const kindCategory={COURSE:'Khóa học',INDICATOR:'Chỉ báo',VIP:'Nhóm VIP'}[kind];
        const requestedCourseKeys=input.courseKeys??(input.courseKey!==undefined?[input.courseKey]:(existing?.courseKeys??(existing?.courseKey?[existing.courseKey]:[])));
        if(!Array.isArray(requestedCourseKeys)||requestedCourseKeys.length>200||requestedCourseKeys.some(key=>typeof key!=='string'||key.length>120))throw Error('Danh sách khóa không hợp lệ.');
        const courseKeys=kind==='COURSE'?[...new Set(requestedCourseKeys.map(key=>key.trim()).filter(Boolean))]:[];
        const courseKey=courseKeys.length===1?courseKeys[0]:'';
        const values={name:String(input.name||'').trim(),sku:String(input.sku||'').trim(),category:String(input.category||kindCategory||'').trim(),kind,courseKey,courseKeys,price:Number(input.price),type:input.type,rentalMonths:input.type==='RENTAL'?Number(input.rentalMonths):null,vatRate:vatPercent/100,active:input.active!==false,imageData};
        if(!Number.isFinite(vatPercent)||vatPercent<0||vatPercent>100)throw Error('VAT phải từ 0 đến 100%.');
        if(!values.name||values.name.length>200||!values.category||values.category.length>100||values.sku.length>60||input.price===''||!Number.isFinite(values.price)||values.price<0)throw Error('Kiểm tra tên, danh mục và đơn giá sản phẩm.');
        if(!['SALE','RENTAL'].includes(values.type)||values.type==='RENTAL'&&![1,3,6,12].includes(values.rentalMonths))throw Error('Sản phẩm thuê phải chọn gói 1, 3, 6 hoặc 12 tháng.');
        if(values.sku&&state.products.some(p=>p.id!==id&&p.sku&&normalize(p.sku)===normalize(values.sku)))throw Error('Mã SKU đã tồn tại.');
        const product=existing||{id:makeRecordId('PRD')};
        Object.assign(product,values);
        if(!existing)state.products.unshift(product);
        PRODUCTS=state.products;
        if(!state.productCategories.includes(values.category))state.productCategories.push(values.category);
        audit(existing?'EDIT_PRODUCT':'CREATE_PRODUCT',product.id,product.name);
        return {id:product.id};
      },'product:'+ (id||'new'));
    },
    // Các thao tác quản trị dùng chung giao dịch và kiểm tra quyền của runtime.
    async updateField(customerId, fieldId, value) {
      return persist(()=>{
        const field=state.customFieldDefinitions.find(f=>f.id===fieldId&&f.active!==false);
        if(!field)throw Error('Cột không còn hoạt động.');
        if(['SELECT','MULTI_SELECT'].includes(field.type)&&[].concat(value).some(v=>v!==''&&!field.options.some(o=>o.value===v||field.id==='customerLevel'&&o.label===v)))throw Error('Lựa chọn không hợp lệ.');
        const result=setCustomerCustomFields(customerId,{[fieldId]:value});
        if(result.error)throw Error(result.error);return result;
      },'customer-field:'+customerId+':'+fieldId);
    },
    async saveField(id,input) {
      requireRole(['ADMIN']);
      return persist(()=>{
        const existing=state.customFieldDefinitions.find(f=>f.id===id);
        if(id&&!existing)throw Error('Cột không còn tồn tại.');
        const label=String(input.label||'').trim(),type=id==='customerLevel'?'SELECT':input.type;
        if(!label||label.length>160||!['TEXT','NOTE','SELECT','MULTI_SELECT','CHECKBOX','NOTIFICATION'].includes(type))throw Error('Tên hoặc kiểu cột không hợp lệ.');
         const notificationWebhookId=String(input.notificationWebhookId||'').trim();
         if(type==='NOTIFICATION'&&!notificationWebhookId)throw Error('Hãy chọn webhook nhận thông báo.');
         if(notificationWebhookId&&!state.websites.some(website=>website.id===notificationWebhookId&&website.provider==='NOTIFICATION'))throw Error('Webhook Thông Báo không hợp lệ.');
        if(state.customFieldDefinitions.some(f=>f.id!==id&&normalize(f.label)===normalize(label)))throw Error('Tên cột đã tồn tại.');
        const options=['SELECT','MULTI_SELECT'].includes(type)?(input.options||[]).map(o=>({value:String(o.value||o.label||'').trim(),label:String(o.label||'').trim(),color:/^#[a-f0-9]{6}$/i.test(o.color)?o.color:'#64748b'})):[];
        if(['SELECT','MULTI_SELECT'].includes(type)&&(!options.length||options.some(o=>!o.value||!o.label||o.value.length>160||o.label.length>200)||new Set(options.map(o=>o.value)).size!==options.length))throw Error('Nhập các lựa chọn khác nhau, không để trống.');
        if(id&&(state.careGroups||[]).some(g=>g.fieldId===id&&(!['SELECT','MULTI_SELECT'].includes(type)||g.values.some(v=>!options.some(o=>o.value===v)))))throw Error('Lựa chọn đang dùng trong mục chăm sóc. Hãy cập nhật mục chăm sóc trước.');
        const next={id:id||makeRecordId('field'),label,type,options,notificationWebhookId,active:existing?.active!==false,showInTable:true,required:existing?.required===true};
        if(existing){
          const previous=structuredClone(existing);Object.assign(existing,next);
          state.customers.forEach(c=>{c.customFields||={};const before=c.customFields[id]??defaultCustomFieldValue(previous),after=sanitizeCustomFieldValue(before,existing);if(JSON.stringify(before)!==JSON.stringify(after))recordFieldChange(c,previous,before,after,'SYSTEM');c.customFields[id]=after;});
        }else{state.customFieldDefinitions.push(next);state.customers.forEach(c=>{c.customFields||={};c.customFields[next.id]=defaultCustomFieldValue(next);});}
        audit(existing?'UPDATE_CUSTOM_FIELD':'CREATE_CUSTOM_FIELD',next.id,label);return {id:next.id};
      },'field:'+ (id||'new'));
    },
    async removeField(id) {
      requireRole(['ADMIN']);return persist(()=>{
        if(id==='customerLevel')throw Error('Không thể xóa cột Level khách hàng.');
        const field=state.customFieldDefinitions.find(f=>f.id===id);if(!field)throw Error('Cột không tồn tại.');
        if((state.careGroups||[]).some(g=>g.fieldId===id))throw Error('Cột đang dùng trong mục chăm sóc. Hãy đổi cột của mục đó trước.');
        state.customFieldDefinitions=state.customFieldDefinitions.filter(f=>f.id!==id);
        state.customers.forEach(c=>{if(c.customFields)delete c.customFields[id];});
        // Giữ lịch sử đã ghi nhận để tra cứu sau khi xóa định nghĩa cột.
        audit('DELETE_CUSTOM_FIELD',id,field.label);return {ok:true};
      },'remove-field:'+id);
    },
    async saveCare(id,input) {
      requireRole(['ADMIN']);return persist(()=>{
        const existing=(state.careGroups||[]).find(g=>g.id===id),field=state.customFieldDefinitions.find(f=>f.id===input.fieldId&&f.active!==false&&['SELECT','MULTI_SELECT'].includes(f.type));
        if(id&&!existing)throw Error('Mục chăm sóc không còn tồn tại.');
        const name=String(input.name||'').trim();
        if(!name||name.length>100||!field||!Array.isArray(input.values)||!input.values.length||input.values.some(v=>!field.options.some(o=>o.value===v)))throw Error('Nhập tên mục và chọn ít nhất một giá trị hợp lệ.');
        if((state.careGroups||[]).some(g=>g.id!==id&&normalize(g.name)===normalize(name)))throw Error('Tên mục đã tồn tại.');
        const group={id:id||makeRecordId('CARE'),name,fieldId:field.id,values:[...new Set(input.values)],color:/^#[a-f0-9]{6}$/i.test(input.color)?input.color:'#2563eb'};
        state.careGroups=(state.careGroups||[]).filter(g=>g.id!==group.id).concat(group);return {id:group.id};
      },'care:'+ (id||'new'));
    },
    async saveFeedback(id,input) {
      requireRole(['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED']);
      return persist(()=>{
        const existing=(state.feedbacks||[]).find(item=>item.id===id);
        if(id&&!existing)throw Error('Feedback không còn tồn tại.');
        if(existing&&permissionRole()!=='ADMIN'&&existing.authorId!==currentAccount.id)throw Error('Bạn chỉ được sửa feedback do mình tạo.');
        const category=['COURSE','SUPPORT','GROUP_SIGNAL'].includes(String(input.category||''))?String(input.category):'';
        const note=String(input.note||'').trim();
        const imageData=String(input.imageData||'');
        if(!category||note.length>2000)throw Error('Chọn loại feedback và nhập ghi chú hợp lệ.');
        if(imageData&&(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)||imageData.length>2_800_000))throw Error('Ảnh feedback không hợp lệ hoặc quá lớn.');
        const item=existing||{id:makeRecordId('FDB'),authorId:currentAccount.id,authorName:currentAccount.name};
        Object.assign(item,{category,note,imageData,authorId:item.authorId||currentAccount.id,authorName:item.authorName||currentAccount.name,createdAt:existing?.createdAt||stamp(),updatedAt:stamp()});
        if(existing){const index=state.feedbacks.findIndex(row=>row.id===id);state.feedbacks[index]=item;}else state.feedbacks.unshift(item);
        audit(existing?'UPDATE_FEEDBACK':'CREATE_FEEDBACK',item.id,item.category);return {id:item.id};
      },'feedback:'+(id||'new'));
    },
    async removeFeedback(id) {
      requireRole(['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED']);
      return persist(()=>{
        const item=(state.feedbacks||[]).find(row=>row.id===id);
        if(!item)throw Error('Feedback không còn tồn tại.');
        if(permissionRole()!=='ADMIN'&&item.authorId!==currentAccount.id)throw Error('Bạn chỉ được xóa feedback do mình tạo.');
        state.feedbacks=state.feedbacks.filter(row=>row.id!==id);audit('DELETE_FEEDBACK',id,item.category);return {ok:true};
      },'remove-feedback:'+id);
    },
    async saveProcess(id,input) {
      requireRole(['ADMIN']);
      return persist(()=>{
        const existing=(state.processes||[]).find(item=>item.id===id);
        if(id&&!existing)throw Error('Quy trinh khong con ton tai.');
        const title=String(input.title||'').trim(),summary=String(input.summary||'').trim(),content=String(input.content||'').trim(),link=String(input.link||'').trim();
        const imageData=Array.isArray(input.imageData)?input.imageData.map(value=>String(value||'')).filter(Boolean):String(input.imageData||'').trim()?[String(input.imageData).trim()]:[];
        if(!title||title.length>200||summary.length>500||!content||content.length>20000)throw Error('Kiem tra tieu de, mo ta va noi dung quy trinh.');
        if(link&&!/^https?:\/\/[^\s]+$/i.test(link))throw Error('Link quy trinh phai bat dau bang http:// hoac https://.');
        if(imageData.length>10||imageData.some(value=>!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>2_800_000))throw Error('Anh quy trinh khong hop le, qua lon hoac vuot qua 10 anh.');
        const item=existing||{id:makeRecordId('PROC'),createdAt:stamp()};Object.assign(item,{title,summary,content,link,imageData,updatedAt:stamp(),authorId:currentAccount.id});
        if(existing){const index=state.processes.findIndex(row=>row.id===id);state.processes[index]=item;}else state.processes.unshift(item);
        audit(existing?'UPDATE_PROCESS':'CREATE_PROCESS',item.id,title);return {id:item.id};
      },'process:'+(id||'new'));
    },
    async removeProcess(id) {
      requireRole(['ADMIN']);
      return persist(()=>{const item=(state.processes||[]).find(row=>row.id===id);if(!item)throw Error('Quy trình không còn tồn tại.');state.processes=state.processes.filter(row=>row.id!==id);audit('DELETE_PROCESS',id,item.title);return {ok:true};},'remove-process:'+id);
    },
    async reorderCare(orderIds) {
      requireRole(['ADMIN']);return persist(()=>{
        const groups=[...(state.careGroups||[])], ids=Array.isArray(orderIds)?orderIds.map(String):[];
        if(ids.length!==groups.length||new Set(ids).size!==groups.length||groups.some(group=>!ids.includes(String(group.id)))) throw Error('Thứ tự mục chăm sóc không hợp lệ.');
        const byId=new Map(groups.map(group=>[String(group.id),group]));
        state.careGroups=ids.map(id=>byId.get(id));
        audit('REORDER_CARE_GROUPS','order',state.careGroups.map(group=>group.name).join(' '));
        return {ok:true};
      },'care-reorder');
    },
    async removeCare(id) {requireRole(['ADMIN']);return persist(()=>{state.careGroups=(state.careGroups||[]).filter(g=>g.id!==id);return {ok:true};},'remove-care:'+id);},
    async saveWebsite(id,input) {
      requireRole(['ADMIN']);return persist(()=>{
        const existing=state.websites.find(w=>w.id===id);if(id&&!existing)throw Error('Website không còn tồn tại.');
        const name=String(input.name||'').trim(),sourceUrl=cleanSourceUrl(input.sourceUrl),requestedProvider=String(input.provider||'').trim();let domain='';try{domain=new URL(sourceUrl).hostname.toLowerCase();}catch{}
        const provider=['LANDING_API','NOTIFICATION'].includes(requestedProvider)?requestedProvider:['FACEBOOK_FORMS','TIKTOK_FORMS','CUSTOM_WEBHOOK'].includes(requestedProvider)?'LANDING_API':'';
        if(!name||name.length>200||!sourceUrl||!domain||!provider)throw Error('Tên, URL nguồn hoặc loại webhook không hợp lệ.');
        if(state.websites.some(w=>w.id!==id&&w.sourceUrl===sourceUrl))throw Error('URL nguồn đã tồn tại.');
        const website=existing||normalizeWebsiteRecord({id:makeRecordId('WEB'),name,sourceUrl,provider,webhookSlug:generateWebhookSlug()});
        Object.assign(website,{name,sourceUrl,domain,provider});
        if(!existing)state.websites.unshift(website);
        audit(existing?'UPDATE_SOURCE_URL':'CREATE_WEBSITE',website.id,sourceUrl);return {id:website.id};
      },'website:'+ (id||'new'));
    },
    async syncWebsites() {requireRole(['ADMIN']);await pullWebhookInbox(true);await syncServerState();if(!await flushServerPersistence())throw Error('Chưa lưu xong dữ liệu đồng bộ.');},
    async resolveSource(id,websiteId) {
      requireRole(['ADMIN']);return persist(()=>{
        const item=webhookPending.find(r=>r.id===id),website=websiteById(websiteId);
        if(!item||!website)throw Error('Chọn bản ghi và website hợp lệ.');
        const result=ingestCustomer(webhookIngestFields(item.customer,website),WEBHOOK_INTAKE_CONTEXT);
        if(!result.created&&!result.duplicate)throw Error(result.error||'Không tạo được khách hàng.');
        webhookPending=webhookPending.filter(r=>r.id!==id);state.webhookPending=webhookPending;
        audit('ASSIGN_WEBSITE_SOURCE',websiteId,result.customer.id);return {id:result.customer.id};
      },'resolve-source:'+id);
    },
    async removeWebsite(id) {
      requireRole(['ADMIN']);return persist(()=>{
        if(state.customers.some(c=>c.websiteId===id)||state.orders.some(o=>o.websiteId===id)||(state.webhookPending||[]).some(w=>w.websiteId===id))throw Error('Website đã có dữ liệu. Giữ website để bảo toàn nguồn khách; có thể sửa tên hoặc URL.');
        state.websites=state.websites.filter(w=>w.id!==id);audit('DELETE_WEBSITE',id,'Xóa website chưa có dữ liệu');return {ok:true};
      },'remove-website:'+id);
    },
    async saveMember(id,input) {
      requireRole(['ADMIN']);return persist(()=>{
        const member=state.members.find(m=>m.id===id),pending=state.registeredAccounts.find(m=>m.id===id);
        if(id&&!member&&!pending)throw Error('Tài khoản không còn tồn tại.');
        const name=String(input.name||'').trim(),accountId=String(input.accountId||'').trim().toUpperCase(),email=String(input.email||'').trim().toLowerCase(),phone=String(input.phone||'').trim(),role=input.role,leader=state.members.find(m=>m.id===input.leaderId&&['LEADER','MANAGER'].includes(m.role)&&m.active!==false);
        const requestedTeamId=String(input.teamId||'').trim().toUpperCase();
        let teamId=requestedTeamId;
        // Sale dùng Team của Leader trực tiếp; nếu form gửi Team khác thì báo lỗi thay vì âm thầm đổi dữ liệu.
        if(role==='SALE'&&leader?.role==='LEADER'){
          const leaderTeamId=String(leader.teamId||'').trim().toUpperCase();
          if(requestedTeamId&&requestedTeamId!==leaderTeamId)throw Error('Sale phải thuộc đúng Team của Leader.');
          teamId=leaderTeamId;
        }
        if(!name||name.length>160||(accountId&&!/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(accountId))||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Họ tên, ID tài khoản hoặc email không hợp lệ.');
        if(state.members.concat(state.registeredAccounts).some(m=>m.id!==id&&((accountId&&String(m.accountId||'').toUpperCase()===accountId)||(email&&m.email?.toLowerCase()===email)||(phone&&m.phone===phone))))throw Error('ID tài khoản, email hoặc số điện thoại đã tồn tại.');
        if(member&&!['SALE','LEADER','MANAGER'].includes(member.role)){
          if(role!==member.role)throw Error('Không đổi quyền tài khoản quản trị tại form này.');
          Object.assign(member,{name,accountId,email,phone,initials:memberInitials(name)});audit('UPDATE_MEMBER',id,name);return {id};
        }
        if(!['SALE','LEADER','MANAGER','HRM'].includes(role)||(role!=='MANAGER'&&role!=='HRM'&&!/^[A-Z0-9_-]{1,20}$/.test(teamId)))throw Error('Chọn chức vụ và Team hợp lệ.');
        if(role==='SALE'&&(!leader||leader.id===id||leader.role==='LEADER'&&leader.teamId!==teamId))throw Error('Sale phải thuộc đúng Team của Leader hoặc Manager.');
        // Leader có thể được nâng lên Manager mà không cần chuyển Sale.
        // Sale vẫn giữ nguyên leaderId/teamId; Manager chỉ nhận thêm phạm vi quản lý.
        if(member?.role==='LEADER'&&role!=='LEADER'&&role!=='MANAGER'&&state.members.some(m=>m.active!==false&&m.leaderId===id))throw Error('Chuyển Sale trực thuộc trước khi đổi Leader.');
        const managerId=role==='LEADER'?String(input.managerId||''):role==='SALE'&&leader?.role==='MANAGER'?leader.id:null;
        if(role==='HRM'){
          if(member&&state.members.some(item=>item.active!==false&&(item.leaderId===id||item.managerId===id)))throw Error('Chuyển nhân sự trực thuộc trước khi gán quyền HRM.');
          const source=member||pending||{};
          const next={...source,id:id||makeRecordId('HRM'),name,accountId,email,phone,role,teamId:'',leaderId:null,managerId:null,active:true,initials:memberInitials(name)};
          if(member)Object.assign(member,next);else state.members.push(next);
          state.registeredAccounts=state.registeredAccounts.filter(item=>item.id!==id);
          STAFF=state.members.filter(item=>item.active!==false);
          audit('ASSIGN_HRM_ACCOUNT',next.id,name);
          return {id:next.id};
        }
        if(managerId&&!state.members.some(m=>m.id===managerId&&m.role==='MANAGER'&&m.active!==false))throw Error('Manager không hoạt động.');
        if(member?.role==='MANAGER'&&role!=='MANAGER'&&state.members.some(m=>m.managerId===id))throw Error('Bỏ phân công các Leader trước khi đổi chức Manager.');
        if(role==='MANAGER'){
          const source=member||pending||{};
          const next={...source,id:id||makeRecordId('MANAGER'),name,accountId,email,phone,role,teamId:'',leaderId:null,managerId:null,active:true,initials:memberInitials(name)};
          if(member)Object.assign(member,next);else state.members.push(next);
          const inheritedSales=state.members.filter(item=>item.active!==false&&item.role==='SALE'&&item.leaderId===id);
          inheritedSales.forEach(sale=>{sale.managerId=id;});
          state.customers.filter(customer=>customer.managerId===id||customer.ownerId===id||customer.leaderId===id||customer.saleId===id||inheritedSales.some(sale=>sale.id===customer.saleId)).forEach(customer=>{customer.managerId=id;});
          state.registeredAccounts=state.registeredAccounts.filter(m=>m.id!==id);STAFF=state.members.filter(m=>m.active!==false);audit('UPDATE_MANAGER',next.id,name);return {id:next.id};
        }
        if(pending){const next={...pending,name,accountId,email,phone,role,teamId,managerId,leaderId:role==='SALE'?leader.id:null,managerId,active:true,initials:memberInitials(name)};state.members.push(next);state.registeredAccounts=state.registeredAccounts.filter(m=>m.id!==id);STAFF=state.members.filter(m=>m.active!==false);audit('ASSIGN_REGISTERED_ACCOUNT',id,name);return {id};}
        // Gọi nghiệp vụ cũ để chuyển khách và công việc đúng khi đổi Team/Leader.
        const before=new Set(state.members.map(m=>m.id));teamMemberModal(id);
        Object.entries({memberName:name,memberEmail:email,memberRole:role,memberTeam:teamId,memberLeader:input.leaderId||''}).forEach(([key,value])=>$('#'+key).value=value);
        saveTeamMember(id);const saved=id?state.members.find(m=>m.id===id):state.members.find(m=>!before.has(m.id));
        if(!saved)throw Error('Chưa tạo được thành viên.');saved.accountId=accountId;saved.phone=phone;saved.managerId=managerId;return {id:saved.id};
      },'member:'+(id||'new'));
    },
    async removeMember(id) {
      requireRole(['ADMIN']);return persist(()=>{
        const member=state.members.find(m=>m.id===id);
        if(!member||!['SALE','LEADER'].includes(member.role)||id===currentAccount.id)throw Error('Không thể xóa tài khoản quản trị hoặc tài khoản hiện tại.');
        if(state.members.some(m=>m.active!==false&&m.leaderId===id))throw Error('Chuyển Sale trực thuộc sang Leader khác trước.');
        const previous=window.confirm;try{window.confirm=()=>true;deleteTeamMember(id);}finally{window.confirm=previous;}return {id};
      },'remove-member:'+id);
    },
    async resetPassword(id,password,confirmation) {
      requireRole(['ADMIN']);if(password.length<8||password!==confirmation)throw Error('Mật khẩu cần ít nhất 8 ký tự và xác nhận trùng nhau.');
      if(!state.members.some(m=>m.id===id&&m.loginEnabled))throw Error('Nhân sự chưa có tài khoản đăng nhập.');
      if(!await saveAccountPassword({userId:id,password}))throw Error(lastNotice||'Chưa đổi được mật khẩu.');return {ok:true};
    },
    async announce(input) {
      requireRole(['ADMIN']);return persist(()=>{
        const title=String(input.title||'').trim(),text=String(input.text||'').trim();
        if(!title||title.length>200||!text||text.length>1000)throw Error('Nhập tiêu đề và nội dung thông báo hợp lệ.');
        const item={id:makeRecordId('NT'),title,text,role:'ALL',at:stamp(),readBy:[]};state.notifications.unshift(item);audit('CREATE_ANNOUNCEMENT','NOTIFICATIONS',title);return {id:item.id};
      },'announcement');
    },
    async readNotice(id) {return persist(()=>{const item=visibleNotifications().find(n=>n.id===id);if(!item)throw Error('Không tìm thấy thông báo.');item.readBy=Array.from(new Set([...(item.readBy||[]),currentAccount.id]));return {ok:true};},'read-notice:'+id);},
    async deleteNotice(id) {return persist(()=>{const item=visibleNotifications().find(n=>n.id===id);if(!item)throw Error('Không tìm thấy thông báo.');item.deletedBy=Array.from(new Set([...(item.deletedBy||[]),currentAccount.id]));return {ok:true};},'delete-notice:'+id);},
    async telegramBroadcast(input) {
      requireRole(['ADMIN']);
      const target=String(input.target||'ALL').toUpperCase();
      const payload={type:String(input.type||'CUSTOM').toUpperCase(),target:['ALL','SALE','MANAGERS'].includes(target)?target:'ALL',title:String(input.title||'').trim(),content:String(input.content||'').trim(),host:String(input.host||'').trim(),meeting_time:input.meeting_time||null,meeting_link:String(input.meeting_link||'').trim()||null,remind_minutes:Number.isFinite(Number(input.remind_minutes))?Number(input.remind_minutes):15,effective_date:input.effective_date||null};
      if(!payload.title||payload.title.length>200||!payload.content||payload.content.length>4000)throw Error('Nhập tiêu đề và nội dung hợp lệ.');
      const response=await fetch(`${webhookApiBase()}/api/broadcast`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${serverSyncToken}`},body:JSON.stringify(payload)});
      let result={};try{result=await response.json();}catch{}
      if(!response.ok||!result.ok)throw Error(result.error||`Không gửi được thông báo (HTTP ${response.status}).`);
      state.notifications.unshift({id:makeRecordId('NT'),title:payload.title,text:`Telegram - ${payload.content}`,role:'ALL',at:stamp(),readBy:[]});
      audit('TELEGRAM_BROADCAST','NOTIFICATIONS',`${payload.title} - ${result.sent||0} nguoi nhan`);saveState();
      if(!await flushServerPersistence())throw Error('Telegram da gui nhung chua luu duoc lich su CRM.');
      return {ok:true,sent:Number(result.sent||0)};
    },
    newWebhookSlug(){requireRole(['ADMIN']);return generateWebhookSlug();},
    async saveWebhook(id,input) {
      requireRole(['ADMIN']);return persist(()=>{
        const w=websiteById(id),slug=cleanWebhookSlug(input.slug),override=String(input.override||'').trim(),base=String(input.base||'').trim();
        if(!w||!slug)throw Error('Mã webhook sai định dạng.');
        if(state.websites.some(w=>w.id!==id&&w.webhookSlug?.toUpperCase()===slug.toUpperCase()))throw Error('Mã webhook đã thuộc website khác.');
        if(override&&!cleanWebhookOverride(override))throw Error('URL ghi đè phải dùng HTTPS.');
        if(base&&!/^https?:\/\/[^\s]+$/.test(base))throw Error('Domain công khai không hợp lệ.');
        w.webhookSlug=slug;w.webhookUrlOverride=cleanWebhookOverride(override);state.settings.webhookPublicBase=cleanWebhookBase(base,DEFAULT_WEBHOOK_BASE);audit('UPDATE_WEBHOOK',id,w.domain);return {id};
      },'webhook:'+id);
    },
    async settings(input) { requireRole(['ADMIN','ACCOUNTING']);if(permissionRole()==='ACCOUNTING'&&Object.keys(input||{}).some(key=>!['accountingLotConfig','brokeragePublishedPeriods'].includes(key)))throw Error('Kế toán chỉ được sửa cấu hình kế toán và hoa hồng.'); return persist(()=>{state.settings={...state.settings,...input};return {ok:true};},'settings'); },
    async readNotifications() {return persist(()=>{visibleNotifications().forEach(item=>{item.readBy=Array.from(new Set([...(item.readBy||[]),currentAccount.id]));});return {ok:true};},'read-all-notices');},
    async distribution(enabled,mode) {
      requireRole(['ADMIN']);
      if(mode)await setAssignmentMode(mode);
      if(state.leaderDistribution.enabled!==enabled)await toggleLeaderDistribution();
      if(!await flushServerPersistence())throw Error('Chưa lưu cấu hình chia data.');
    },
    // Luu ty trong va trang thai nhan data cua Leader/Sale vao state phan phoi.
    async distributionWeight(kind,id,value) {
      if(!serverStateLoaded||!['ADMIN','MANAGER'].includes(effectivePermissionRole()))throw Error('Khong co quyen chinh ty trong.');
      const normalizedKind=String(kind||'').toUpperCase();
      const member=state.members.find(item=>item.id===id&&item.active!==false);
      if(!member||!['LEADER','SALE','MANAGER'].includes(normalizedKind)||member.role!==normalizedKind)throw Error('Nhan su khong hop le de cai ty trong.');
      if(effectivePermissionRole()==='MANAGER'){
        const scope=managerScope();
        if(!(member.id===scope.manager?.id||scope.leaderIds.has(member.id)||scope.saleIds.has(member.id)))throw Error('Manager chi duoc chinh ty trong trong tuyen cua minh.');
      }
      const rawWeight=Number(value),weight=Number.isFinite(rawWeight)?Math.max(0,Math.min(100,Math.round(rawWeight))):1;
      const config=state.saleDistributionByLeader['$'] ||= {globalCycle:true,enabledSaleIds:[],weights:{}};
      config.globalCycle=true;config.weights||={};if(config.weights[id]===undefined)config.enabledSaleIds=Array.from(new Set([...(config.enabledSaleIds||[]),id]));config.weights[id]=weight;
      if(Array.isArray(config.rounds)&&config.rounds[0]){config.rounds[0].weights||={};config.rounds[0].weights[id]=weight;config.rounds[0].enabledSaleIds=Array.from(new Set(config.rounds[0].enabledSaleIds||[]));if(!config.rounds[0].enabledSaleIds.includes(id))config.rounds[0].enabledSaleIds.push(id);}
      const legacyKeys=member.role==='MANAGER'
        ? ['manager:'+member.id,...state.members.filter(item=>item.role==='LEADER'&&item.managerId===member.id).map(item=>item.id)]
        : [member.role==='SALE'?(member.managerId?'manager:'+member.managerId:(member.leaderId||null)):member.id];
      legacyKeys.filter(Boolean).forEach(legacyKey=>{const legacy=state.saleDistributionByLeader[legacyKey] ||= {globalCycle:true,enabledSaleIds:[],weights:{}};legacy.weights||={};if(legacy.weights[id]===undefined)legacy.enabledSaleIds=Array.from(new Set([...(legacy.enabledSaleIds||[]),id]));legacy.weights[id]=weight;});
      if(effectivePermissionRole()==='ADMIN')resetDistributionCursor();
      audit('UPDATE_DISTRIBUTION_WEIGHT',id,normalizedKind+' - ty trong '+weight);
      if(!await flushServerPersistence())throw Error('Chua luu ty trong phan data.');
      return {ok:true};
    },
    async distributionRoundSkip(input){
      requireRole(['ADMIN']);
      const kind='skip-round:'+String(input?.roundId)+':'+String(input?.token)+':'+String(input?.position);
      return persist(()=>{
        const roster=CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
        const config=state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights};
        const store=state.settings.assignmentCursor ||= {};
        const result=CrmDistributionRounds.skip(config,CrmDistributionRounds.cursorFrom(store),roster.people,state.settings.assignmentMode,input||{});
        state.saleDistributionByLeader.$=result.config;
        if(input.roundId===distributionRoundViews()[0].roundId){store.global=result.cursor;if(store.salesByTeam)delete store.salesByTeam.global;}
        audit('SKIP_DISTRIBUTION_SLOT',input.memberId,'Skipped an unassigned slot in round '+input.roundId);
        return {ok:true};
      },kind);
    },
    async distributionRoundAddExtraTurn(input){
      requireRole(['ADMIN']);
      const kind='add-extra-round-turn:'+String(input?.roundId)+':'+String(input?.token)+':'+String(input?.memberId);
      return persist(()=>{
        const roster=CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
        const config=state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(person=>person.id),weights:roster.weights};
        const store=state.settings.assignmentCursor||{};
        const result=CrmDistributionRounds.addExtraTurn(config,CrmDistributionRounds.cursorFrom(store),roster.people,state.settings.assignmentMode,input||{});
        state.saleDistributionByLeader.$=result.config;
        state.settings.assignmentCursor||={};
        state.settings.assignmentCursor.global=result.cursor;
        if(state.settings.assignmentCursor.salesByTeam)delete state.settings.assignmentCursor.salesByTeam.global;
        audit('ADD_DISTRIBUTION_EXTRA_TURN',input.memberId,'Append one extra turn to active round '+input.roundId);
        return {ok:true};
      },kind);
    },
    async distributionRoundRemoveMember(input){
      if(!serverStateLoaded||!['ADMIN','MANAGER'].includes(effectivePermissionRole()))throw Error('Khong co quyen chinh thanh vien vong ty trong.');
      if(effectivePermissionRole()==='MANAGER'){
        const scope=managerScope(),allowed=new Set([scope.manager?.id,...scope.leaderIds,...scope.saleIds].filter(Boolean));
        if(!allowed.has(String(input?.memberId||'')))throw Error('Manager chi duoc loai nhan su trong tuyen cua minh.');
      }
      const kind='remove-round-member:'+String(input?.roundId)+':'+String(input?.memberId);
      return persist(()=>{
        const roster=CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
        const config=state.saleDistributionByLeader.$;
        if(!config)throw Error('Khong tim thay vong ty trong.');
        const store=state.settings.assignmentCursor ||= {};
        const result=CrmDistributionRounds.removeMember(config,CrmDistributionRounds.cursorFrom(store),roster.people,state.settings.assignmentMode,input||{});
        state.saleDistributionByLeader.$=result.config;
        if(input.roundId===distributionRoundViews()[0]?.roundId){store.global=result.cursor;if(store.salesByTeam)delete store.salesByTeam.global;}
        audit('REMOVE_DISTRIBUTION_ROUND_MEMBER',input.memberId,'Loai khoi vong '+input.roundId+'; giu nguyen data da phan');
        return {ok:true};
      },kind);
    },
    async distributionRoundSave(input) {
      if(!serverStateLoaded||!['ADMIN','MANAGER'].includes(effectivePermissionRole()))throw Error('Khong co quyen luu vong ty trong.');
      const source=input&&typeof input==='object'?input:{};
      const config=state.saleDistributionByLeader['$'] ||= {globalCycle:true,enabledSaleIds:[],weights:{},rounds:[]};
      const members=state.members.filter(item=>item.active!==false&&['MANAGER','LEADER','SALE'].includes(item.role));
      const scope=effectivePermissionRole()==='MANAGER'?managerScope():null;
      const allowed=effectivePermissionRole()==='MANAGER'?new Set([scope.manager?.id,...scope.leaderIds,...scope.saleIds].filter(Boolean)):new Set(members.map(item=>item.id));
      if(source.roundId){
        const rounds=Array.isArray(config.rounds)?config.rounds:[];
        const index=rounds.findIndex(round=>round.id===String(source.roundId));
        if(index<1)throw Error('Chi co the sua vong dang cho; vong dang chay duoc giu nguyen.');
        const round=rounds[index],weights={...(round.weights||{})},enabled=new Set(Array.isArray(round.enabledSaleIds)?round.enabledSaleIds:[]);
        for(const member of members){
          if(!allowed.has(member.id))continue;
          const raw=source.weights?.[member.id];
          if(raw!==undefined)weights[member.id]=Number.isFinite(Number(raw))?Math.max(0,Math.min(100,Math.round(Number(raw)))):1;
          if(Array.isArray(source.enabledIds)&&source.enabledIds.includes(member.id))enabled.add(member.id);
          if(Array.isArray(source.enabledIds)&&!source.enabledIds.includes(member.id))enabled.delete(member.id);
        }
        const enabledIds=Array.from(enabled).filter(id=>members.some(member=>member.id===id));
        if(!enabledIds.some(id=>Number(weights[id])>0))throw Error('Vong can it nhat mot nhan su dang bat va co ty trong lon hon 0.');
        rounds[index]={...round,omittedSlots:[],enabledSaleIds:enabledIds,weights:Object.fromEntries(members.map(member=>[member.id,Number.isFinite(Number(weights[member.id]))?Math.max(0,Math.min(100,Math.round(Number(weights[member.id])))):1]))};
        audit('UPDATE_DISTRIBUTION_ROUND',round.id,`Cap nhat ${enabledIds.length} nhan su trong vong cho`);
        saveState();
        return {ok:true,round:rounds[index]};
      }
      const current=config.rounds?.[0]||config;
      const weights={...(current.weights||{})};
      const enabled=new Set(Array.isArray(current.enabledSaleIds)?current.enabledSaleIds:members.map(item=>item.id));
      for(const member of members){
        if(!allowed.has(member.id))continue;
        const raw=source.weights?.[member.id];
        if(raw!==undefined)weights[member.id]=Number.isFinite(Number(raw))?Math.max(0,Math.min(100,Math.round(Number(raw)))):1;
        if(Array.isArray(source.enabledIds)&&source.enabledIds.includes(member.id))enabled.add(member.id);
        if(Array.isArray(source.enabledIds)&&!source.enabledIds.includes(member.id))enabled.delete(member.id);
      }
      const round={id:`ROUND-${Date.now()}`,createdAt:stamp(),enabledSaleIds:Array.from(enabled).filter(id=>members.some(member=>member.id===id)),weights:Object.fromEntries(members.map(member=>[member.id,Number.isFinite(Number(weights[member.id]))?Math.max(0,Math.min(100,Math.round(Number(weights[member.id])))):1]))};
      config.globalCycle=true;config.rounds=Array.isArray(config.rounds)&&config.rounds.length?config.rounds:[{id:'ROUND-1',createdAt:stamp(),enabledSaleIds:config.enabledSaleIds||members.map(item=>item.id),weights:config.weights||{}}];config.rounds.push(round);config.weights=config.rounds[0].weights;config.enabledSaleIds=config.rounds[0].enabledSaleIds;
      audit('CREATE_DISTRIBUTION_ROUND',round.id,`Vong tiep theo ${round.enabledSaleIds.length} nguoi`);
      saveState();
      return {ok:true,round};
    },
    async distributionRoundDelete(id) {
      if(!currentAccount)throw Error('Phien dang nhap khong con hieu luc. Hay dang nhap lai.');
      if(!serverStateLoaded&&!await syncServerState())throw Error('Du lieu CRM chua dong bo voi may chu. Hay tai lai trang va thu lai.');
      if(!serverStateLoaded)throw Error('Du lieu CRM chua dong bo voi may chu. Hay tai lai trang va thu lai.');
      const role=permissionRole();
      if(!['ADMIN','MANAGER'].includes(role))throw Error('Tai khoan '+(role||'chua xac dinh')+' khong co quyen xoa vong ty trong.');
      const config=state.saleDistributionByLeader['$'];
      if(!config||!Array.isArray(config.rounds)||!config.rounds.length)throw Error('Khong co vong de xoa.');
      const target=String(id||'');
      const deletingActive=target===config.rounds[0].id;
      if(role==='MANAGER'){
        if(deletingActive)throw Error('Chi Admin duoc xoa Vong 1 toan he thong.');
        const round=config.rounds.find(item=>item.id===target),scope=managerScope();
        const allowed=new Set([scope.manager?.id,...scope.leaderIds,...scope.saleIds].filter(Boolean));
        if(!round||!(round.enabledSaleIds||[]).every(memberId=>allowed.has(memberId)))throw Error('Manager chi duoc xoa vong nam trong tuyen cua minh.');
      }
      if(deletingActive&&config.rounds.length<2)throw Error('Can co vong ke tiep truoc khi xoa Vong 1.');
      const before=config.rounds.length;config.rounds=config.rounds.filter(round=>round.id!==target);if(config.rounds.length===before)throw Error('Khong tim thay vong cho.');
      config.weights=config.rounds[0].weights;config.enabledSaleIds=config.rounds[0].enabledSaleIds;audit('DELETE_DISTRIBUTION_ROUND',target,'Xoa vong cho');
      if(deletingActive){
        const roster=CrmDistributionRounds.recipients(state.members,state.leaderDistribution,state.saleDistributionByLeader);
        const nextView=CrmDistributionRounds.preview(config,null,roster.people,state.settings.assignmentMode)[0];
        state.settings.assignmentCursor||={};state.settings.assignmentCursor.global={index:0,ids:nextView.ids,cycleId:String(Date.now())};
        if(state.settings.assignmentCursor.salesByTeam)delete state.settings.assignmentCursor.salesByTeam.global;
        audit('PROMOTE_DISTRIBUTION_ROUND',config.rounds[0].id,'Dua vong ke tiep len Vong 1');
      }
      saveState();
      if(!await flushServerPersistence())throw Error('Chua luu duoc thao tac xoa vong. Vui long giu trang mo va thu lai.');
      return {ok:true};
    },
    async bulkAssignWaitingSales(mode) {
      requireRole(['ADMIN']);
      const selectedMode=['EQUAL','ROUND_ROBIN','BALANCED','SALE_EMPTY','LEADER_EQUAL'].includes(mode)?mode:(state.settings.assignmentMode==='EQUAL'||state.settings.assignmentMode==='ROUND_ROBIN'?state.settings.assignmentMode:'BALANCED');
      const count=bulkAssignWaitingSales(selectedMode);
      if(!await flushServerPersistence())throw Error('Chua luu ket qua chia data cho Sale.');
      return {ok:true,count};
    },
    async distributionMember(kind,id,enabled) {
      if(!serverStateLoaded||!['ADMIN','MANAGER'].includes(effectivePermissionRole()))throw Error('Khong co quyen chinh ty trong.');
      const normalizedKind=String(kind||'').toUpperCase();
      const member=state.members.find(item=>item.id===id&&item.active!==false);
      if(!member||!['LEADER','SALE','MANAGER'].includes(normalizedKind)||member.role!==normalizedKind)throw Error('Nhan su khong hop le de bat nhan data.');
      if(effectivePermissionRole()==='MANAGER'){
        const scope=managerScope();
        if(!(member.id===scope.manager?.id||scope.leaderIds.has(member.id)||scope.saleIds.has(member.id)))throw Error('Manager chi duoc chinh nguoi trong tuyen cua minh.');
      }
      const config=state.saleDistributionByLeader['$'] ||= {globalCycle:true,enabledSaleIds:[],weights:{}};
      config.globalCycle=true;config.weights||={};const ids=new Set(config.enabledSaleIds||[]);enabled?ids.add(id):ids.delete(id);config.enabledSaleIds=Array.from(ids);if(config.weights[id]===undefined)config.weights[id]=1;
      if(Array.isArray(config.rounds)&&config.rounds[0]){config.rounds[0].weights||={};if(config.rounds[0].weights[id]===undefined)config.rounds[0].weights[id]=1;const roundIds=new Set(config.rounds[0].enabledSaleIds||[]);enabled?roundIds.add(id):roundIds.delete(id);config.rounds[0].enabledSaleIds=Array.from(roundIds);}
      const legacyKeys=member.role==='MANAGER'
        ? ['manager:'+member.id,...state.members.filter(item=>item.role==='LEADER'&&item.managerId===member.id).map(item=>item.id)]
        : [member.role==='SALE'?(member.managerId?'manager:'+member.managerId:(member.leaderId||null)):member.id];
      legacyKeys.filter(Boolean).forEach(legacyKey=>{const legacy=state.saleDistributionByLeader[legacyKey] ||= {globalCycle:true,enabledSaleIds:[],weights:{}};legacy.weights||={};const legacyIds=new Set(legacy.enabledSaleIds||[]);enabled?legacyIds.add(id):legacyIds.delete(id);legacy.enabledSaleIds=Array.from(legacyIds);if(legacy.weights[id]===undefined)legacy.weights[id]=1;});
      if(effectivePermissionRole()==='ADMIN')resetDistributionCursor();
      audit('UPDATE_DISTRIBUTION_MEMBER',id,normalizedKind+' - '+(enabled?'bat':'tat'));
      if(!await flushServerPersistence())throw Error('Chua luu trang thai nhan data.');
      return {ok:true};
    },
    notify:message=>toast(message)
  };
})();
