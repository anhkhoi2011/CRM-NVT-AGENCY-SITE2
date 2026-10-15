'use strict';
// Giữ HTML/CSS tham chiếu. Chỉ thay nguồn dữ liệu và handler của các ô có sẵn.
(() => {
  const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
  const ACTIVE_TAB_KEY='nvt-crm-active-tab-v1';
  const SESSION_KEY='nvt-crm-session-v1';
  const CACHED_SNAPSHOT_KEY='nvt_crm_cached_snapshot_v1';
  const frame=q('#crmRuntimeFrame');
  const bootScreen=q('#crmBootScreen');
  let api=null, data=null, signature='', working=false, refreshTimer=null, bootFallbackTimer=null, selectedCustomer='', careKey='', dataQueuePage=1, dataQueuePageSize=20, dataQueueDateFrom='', dataQueueDateTo='', userActivitySnapshot=null, userActivityLoading=false, userActivityRequestedAt=0, lastReportedActivity='';
  const snapshotRole=snapshot=>String(snapshot?.user?.actualRole||snapshot?.user?.role||'').trim().toUpperCase();
  function storedSession(){
    try{
      let session=null;
      for(const storage of [sessionStorage,localStorage]){
        if(session?.token)break;
        try{session=JSON.parse(storage.getItem(SESSION_KEY)||'null');}catch{}
      }
      const token=String(session?.token||session?.accessToken||'').trim();
      if(!token)return null;
      return {token,accountId:String(session?.accountId||'').trim(),role:String(session?.role||'').trim().toUpperCase()};
    }catch{return null;}
  }
  function validCachedSnapshot(snapshot){
    return Boolean(snapshot&&typeof snapshot==='object'&&snapshot.user?.id&&snapshotRole(snapshot)&&Array.isArray(snapshot.navigation)&&Array.isArray(snapshot.customers));
  }
  function clearCachedSnapshot(){try{localStorage.removeItem(CACHED_SNAPSHOT_KEY);}catch{}}
  async function lazyAsset(path){const session=storedSession();const headers=session?.token?{Authorization:'Bearer '+session.token}:{};const response=await fetch(path,{headers,cache:'no-store'});const payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||'\u0054h\u00f4ng tin anh chua san sang.');return payload;}
  const lazyAssetUrl=(kind,id,child)=>kind==='process'?'/api/process-image/'+encodeURIComponent(id):kind==='feedback'?'/api/feedback-image/'+encodeURIComponent(id):'/api/order-receipt-image/'+encodeURIComponent(id)+'/'+encodeURIComponent(child);
  function readCachedSnapshot(){
    const session=storedSession();
    if(!session){clearCachedSnapshot();return null;}
    try{
      const cached=JSON.parse(localStorage.getItem(CACHED_SNAPSHOT_KEY)||'null');
      const snapshot=cached?.snapshot;
      const accountId=String(cached?.accountId||'').trim();
      const role=String(cached?.role||'').trim().toUpperCase();
      const snapshotAccountId=String(snapshot?.user?.id||'').trim();
      if(cached?.version!==1||!validCachedSnapshot(snapshot)||!accountId||!role||snapshotAccountId!==accountId||snapshotRole(snapshot)!==role){
        clearCachedSnapshot();
        return null;
      }
      // Cache chỉ được hiện khi metadata phiên xác nhận đúng tài khoản và vai trò.
      // Phiên cũ thiếu metadata phải chờ máy chủ, không suy đoán danh tính từ cache.
      if(!session.accountId||!session.role)return null;
      if(session.accountId!==accountId||session.role!==role){clearCachedSnapshot();return null;}
      return snapshot;
    }catch{
      clearCachedSnapshot();
      return null;
    }
  }
  function saveCachedSnapshot(snapshot){
    if(!validCachedSnapshot(snapshot))return;
    const session=storedSession(),accountId=String(snapshot.user?.id||'').trim(),role=snapshotRole(snapshot);
    if(!session||!accountId||!role)return;
    if(session.accountId&&session.accountId!==accountId)return;
    if(session.accountId!==accountId||session.role!==role){
      session.accountId=accountId;
      session.role=role;
      const payload=JSON.stringify(session);
      try{sessionStorage.setItem(SESSION_KEY,payload);}catch{}
      try{localStorage.setItem(SESSION_KEY,payload);}catch{}
    }
    try{
      const pruned = {
        ...snapshot,
        audit: Array.isArray(snapshot.audit) ? snapshot.audit.slice(-50) : [],
        assignmentHistory: Array.isArray(snapshot.assignmentHistory) ? snapshot.assignmentHistory.slice(-100) : [],
        attendance: Array.isArray(snapshot.attendance) ? snapshot.attendance.slice(-100) : [],
        customerFieldHistory: Array.isArray(snapshot.customerFieldHistory) ? snapshot.customerFieldHistory.slice(-200) : [],
        processes: Array.isArray(snapshot.processes) ? snapshot.processes.map(item=>{const next={...item};delete next.imageData;return next;}) : [],
        feedbacks: Array.isArray(snapshot.feedbacks) ? snapshot.feedbacks.map(item=>{const next={...item};delete next.imageData;return next;}) : [],
        orders: Array.isArray(snapshot.orders) ? snapshot.orders.map(order=>{const next={...order};delete next.billImage;next.paymentReceipts=Array.isArray(next.paymentReceipts)?next.paymentReceipts.map(receipt=>{const r={...receipt};delete r.billImage;delete r.imageData;delete r.images;return r;}):[];return next;}) : []
      };
      localStorage.setItem(CACHED_SNAPSHOT_KEY,JSON.stringify({version:1,savedAt:Date.now(),accountId,role,snapshot:pruned}));
    }catch(error){
      if(error?.name!=='QuotaExceededError')console.warn('[crm-cache]',error);
    }
  }
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));  function referenceNotice(message,type='success') {
    let host=document.getElementById('referenceNoticeHost');
    if(!host){
      host=document.createElement('div');host.id='referenceNoticeHost';host.setAttribute('role','status');host.setAttribute('aria-live','polite');
      host.style.cssText='position:fixed;top:18px;right:18px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:min(360px,calc(100vw - 36px));';
      document.body.appendChild(host);
    }
    const item=document.createElement('div');
    item.textContent=String(message||'');
    item.style.cssText='pointer-events:auto;padding:12px 14px;border-radius:8px;border:1px solid '+(type==='error'?'#fecaca':'#bbf7d0')+';background:'+(type==='error'?'#fef2f2':'#f0fdf4')+';color:'+(type==='error'?'#b91c1c':'#166534')+';box-shadow:0 8px 24px rgba(15,23,42,.16);font-size:13px;font-weight:700;line-height:1.4;';
    host.appendChild(item);setTimeout(()=>item.remove(),3600);
  }
  function referenceConfirmDelete(name) {
    return new Promise(resolve=>{
      const modal=document.createElement('div');
      modal.className='modal-overlay open';
      modal.innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="referenceDeleteTitle" style="width:min(440px,calc(100vw - 28px));"><div class="modal-header"><h3 id="referenceDeleteTitle">Xóa khỏi danh sách Data</h3><button type="button" class="modal-close-btn" data-reference-delete-cancel aria-label="Đóng">×</button></div><div class="modal-body"><p style="margin:0;color:var(--text-main);line-height:1.55;">Bạn có chắc muốn xóa data <b>'+esc(name)+'</b> khỏi danh sách không?</p></div><div class="modal-footer"><button type="button" class="btn-action btn-secondary" data-reference-delete-cancel>Hủy</button><button type="button" class="btn-action btn-danger" data-reference-delete-confirm>Xóa data</button></div></div>';
      document.body.appendChild(modal);
      const close=value=>{modal.remove();resolve(value);};
      modal.querySelectorAll('[data-reference-delete-cancel]').forEach(button=>button.onclick=()=>close(false));
      modal.querySelector('[data-reference-delete-confirm]').onclick=()=>close(true);
    });
  }  const money=v=>Number(v||0).toLocaleString('vi-VN')+' VND';
  const text=(id,v)=>{const n=document.getElementById(id);if(n)n.textContent=v;};
  // Hien thi ten kem ID tai khoan, fallback ve id noi bo neu chua co accountId.
  const personWithId=id=>{const member=data?.members.find(m=>m.id===id);return member?`${member.name||'Chua dat ten'} - ID: ${member.accountId||member.id}`:'—';};
  const opt=(value,label,selected)=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
  const fieldOptions=id=>(data?.fields.find(f=>f.id===id)?.options||[]);
  function renderDataQueuePagination(table,total){
    const host=table?.closest('.table-responsive')||table?.parentElement;if(!host)return;
    if(!q('#referenceDataPaginationStyles')){const style=document.createElement('style');style.id='referenceDataPaginationStyles';style.textContent='.data-pagination{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding:12px 14px;border-top:1px solid var(--border-light);color:var(--text-muted);font-size:11px}.data-pagination-summary{margin-right:auto}.data-pagination-size{display:inline-flex;align-items:center;gap:6px}.data-pagination select{padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);color:var(--text-main);font:inherit}.data-pagination-button{display:inline-grid;place-items:center;width:30px;height:30px;border:1px solid var(--border);border-radius:7px;background:var(--bg-surface);color:var(--text-main);font-size:18px;line-height:1;cursor:pointer}.data-pagination-button:hover{background:var(--bg-subtle)}.data-pagination-current{min-width:42px;text-align:center;font-weight:700;color:var(--text-main)}@media(max-width:860px){#tab-data{max-width:100%;overflow-x:hidden}#tab-data #dataSubViewQueue{display:block!important;width:100%;min-width:0!important}#tab-data #dataSubViewQueue>.table-container{width:100%;min-width:0;max-width:100%;overflow:hidden}#tab-data #dataSubViewQueue>.table-container .table-responsive{width:100%;max-width:100%;overflow-x:auto!important;border-radius:8px}#tab-data #dataSubViewQueue>.table-container .modern-table{min-width:720px}.data-pagination{justify-content:flex-start;padding:10px 4px}.data-pagination-summary{width:100%;margin-right:0}.data-pagination-size{margin-right:auto}}';document.head.appendChild(style);}
    let pager=host.nextElementSibling;
    if(!pager?.classList.contains('data-pagination')){pager=document.createElement('div');pager.className='data-pagination';host.parentElement?.insertBefore(pager,host.nextSibling);}
    const rows=Array.from(table.tBodies?.[0]?.rows||[]),pages=Math.max(1,Math.ceil(total/dataQueuePageSize));
    dataQueuePage=Math.min(dataQueuePage,pages);
    const start=(dataQueuePage-1)*dataQueuePageSize;
    rows.forEach((row,index)=>{row.hidden=total>0&&(index<start||index>=start+dataQueuePageSize);});
    if(!total){pager.hidden=true;pager.innerHTML='';return;}
    pager.hidden=false;
    const from=start+1,to=Math.min(start+dataQueuePageSize,total);
    pager.innerHTML='<span class="data-pagination-summary">Hiển thị '+from+'–'+to+' / '+total+' data</span><label class="data-pagination-size">Số dòng <select aria-label="Số data mỗi trang">'+[10,20,50,100,200].map(size=>'<option value="'+size+'" '+(size===dataQueuePageSize?'selected':'')+'>'+size+'</option>').join('')+'</select></label><button type="button" class="data-pagination-button" data-data-page-prev aria-label="Trang trước">‹</button><span class="data-pagination-current">'+dataQueuePage+' / '+pages+'</span><button type="button" class="data-pagination-button" data-data-page-next aria-label="Trang sau">›</button>';
    pager.querySelector('select').onchange=event=>{dataQueuePageSize=Number(event.target.value)||20;dataQueuePage=1;renderDataQueuePagination(table,total);};
    pager.querySelector('[data-data-page-prev]').onclick=()=>{if(dataQueuePage>1){dataQueuePage--;renderDataQueuePagination(table,total);}};
    pager.querySelector('[data-data-page-next]').onclick=()=>{if(dataQueuePage<pages){dataQueuePage++;renderDataQueuePagination(table,total);}};
  }
  const restrictedAdminTabs=new Set(['websites','products','audit','settings','accounting','blacklist']);
  const sharedOrganizationTabs=new Set(['feedback','processes']);
  let roleVisibilityObserver=null;
  function installCustomerJourney(){
    const tab=q('#tab-customers');
    if(!tab||q('#customerJourneyBanner'))return;
    const heading=tab.querySelector('.headline-row');
    const firstTable=tab.querySelector('.table-container');
    if(!heading||!firstTable)return;
    if(!q('#customerJourneyStyles')){
      const style=document.createElement('style');
      style.id='customerJourneyStyles';
      style.textContent='.customer-journey-banner{width:100%;margin:0 0 16px;padding:10px 14px;background:#fff;border:1px solid var(--border,#e2e8f0);border-radius:12px;overflow:hidden;box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,.03)}.customer-journey-banner img{display:block;width:100%;max-width:100%;min-width:0;height:auto;max-height:180px;margin:0 auto;object-fit:contain}@media(max-width:980px){.customer-journey-banner{width:100%;padding:5px;overflow:hidden}.customer-journey-banner img{display:block;width:100%;min-width:0;max-width:100%;height:auto;max-height:none;margin:0}}';
      document.head.appendChild(style);
    }
    const banner=document.createElement('div');
    banner.id='customerJourneyBanner';
    banner.className='customer-journey-banner';
    banner.innerHTML='<img src="./customer-journey.svg?v=20260917-panorama" alt="Hành trình khách hàng NVT Agency">';
    firstTable.before(banner);
  }
    // Nhóm KẾ TOÁN & HOA HỒNG gồm đúng 4 mục trên sidebar theo mẫu chuẩn
  function normalizeAccountingMenu() {
    const accountingList = q('#accountingNavList') || q('.accounting-nav-link')?.closest('ul') || q('[data-tab="tab-accounting"]')?.closest('ul');
    if (!accountingList) return;
    const accountingGroup = accountingList.closest('.nav-group') || accountingList.parentElement;
    const title = accountingGroup?.querySelector('.nav-group-title');
    if (title) {
      title.classList.add('accounting-nav-toggle');
      title.setAttribute('role','button');
      title.setAttribute('tabindex','0');
      const titleText = '\u004b\u1ebe TO\u00c1N & HOA H\u1ed2NG';
      title.innerHTML = '<span>'+titleText+'</span><span class="accounting-nav-chevron" aria-hidden="true">&#x2304;</span>';
    }

    // Remove the retired standalone business report entry from every cached/static menu.
    const reportLink = q('[data-tab="tab-businessReport"]');
    if(!reportLink?.closest('#hrmNavGroup'))reportLink?.closest('li')?.remove();

    // 4 mục chuẩn trên Sidebar của nhóm KẾ TOÁN & HOA HỒNG (giống hệt bản demo)
    const items = [
      ['mindmap', 'Cây Mindmap (Lv1-Lv3)', '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v6m0 6v6M3 12h6m6 0h6"></path>'],
      ['report', 'Báo cáo Doanh thu', '<path d="M18 20V10M12 20V4M6 20v-6"></path>'],
      ['orders', 'Kiểm Tra Đơn & Xuất VAT', '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10M7 12h10M7 16h6"></path>'],
      ['expenses', 'Kế toán & Chi phí Admin', '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M17 10a5 5 0 0 0-10 0c0 5 10 3 10 8a5 5 0 0 1-10 0"></path>']
    ];

    const currentSub = window.accountingSubView || accountingSubView || 'mindmap';
    const outerTab = q('section.tab-section.active[id^=\"tab-\"]')?.id;
    const accountingIsActive = outerTab === 'tab-accounting';
    // Mở sẵn nhóm khi CRM khởi tạo lần đầu. Trước đây trạng thái undefined bị
    // hiểu là đóng, làm 4 mục kế toán nhấp nháy hoặc biến mất sau F5.
    if (accountingGroup && !['true', 'false'].includes(accountingGroup.dataset.expanded || '')) {
      accountingGroup.dataset.expanded = 'true';
    }
    const expanded = accountingGroup?.dataset.expanded !== 'false';
    accountingList.hidden = !expanded;
    if (title) {
      title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const chevron = title.querySelector('.accounting-nav-chevron');
      if (chevron) chevron.textContent = expanded ? '\u2303' : '\u2304';
      const toggle = () => {
        const next = title.getAttribute('aria-expanded') !== 'true';
        accountingGroup.dataset.expanded = next ? 'true' : 'false';
        accountingList.hidden = !next;
        title.setAttribute('aria-expanded', next ? 'true' : 'false');
        if (chevron) chevron.textContent = next ? '\u2303' : '\u2304';
      };
      title.onclick = toggle;
      title.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
    }

    accountingList.innerHTML = items.map(([view, label, icon]) =>
      `<li><button type="button" class="nav-link accounting-nav-link ${accountingIsActive && currentSub === view ? 'active' : ''}" data-accounting-view="${view}"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">${icon}</svg><span>${label}</span></button></li>`
    ).join('');

    accountingList.querySelectorAll('[data-accounting-view]').forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const view = button.dataset.accountingView;
        accountingSubView = view;
        window.accountingSubView = view;
        accountingGroup.dataset.expanded = 'true';
        accountingList.hidden = false;
        title?.setAttribute('aria-expanded','true');
        title?.querySelector('.accounting-nav-chevron')?.replaceChildren(document.createTextNode('\u2303'));
        rememberActiveTab('tab-accounting');

        qa('.nav-link').forEach(item => item.classList.remove('active'));
        button.classList.add('active');

        renders.switchTab('tab-accounting');
        accountingReport(view);
      };
    });
  }
  function applyRoleVisibility() {
    const role=data?.user?.actualRole||data?.user?.role||'';
    const isAdmin=role==='ADMIN',isAccountant=role==='ACCOUNTING',canAccount=isAdmin||isAccountant;
    qa('#tab-orders .headline-row button').forEach(button=>{if(role==='HRM'&&/Tạo|Thêm/.test(button.textContent)){button.hidden=true;button.setAttribute('aria-hidden','true');button.style.setProperty('display','none','important');button.removeAttribute('onclick');}});
    ensureHrmMenu(role);
    ensureMarketingMenu(role);
    document.documentElement.classList.toggle('role-hrm',role==='HRM');
    document.documentElement.classList.toggle('role-accounting',isAccountant);
    if(!q('#accountingWorkspaceStyles')){const style=document.createElement('style');style.id='accountingWorkspaceStyles';style.textContent='.role-accounting .nav-group:not(#accountingNavGroup),.role-accounting .nav-link[data-tab]:not([data-tab="tab-notifications"]):not([data-tab="tab-audit"]),.role-accounting section.tab-section:not(#tab-accounting):not(#tab-notifications):not(#tab-audit){display:none!important}.role-accounting #accountingNavGroup{display:block!important}.role-accounting .nav-group:not(#accountingNavGroup) .nav-link[data-tab="tab-audit"]{display:none!important}';document.head.appendChild(style);}
    const accountingGroup=q('#accountingNavGroup');
    if(accountingGroup){
      accountingGroup.hidden=!canAccount;
      accountingGroup.setAttribute('aria-hidden',String(!canAccount));
      accountingGroup.style.setProperty('display',canAccount?'':'none','important');
      if(isAccountant&&!q('#accountingNoticeLink')){
        const button=document.createElement('button');button.id='accountingNoticeLink';button.className='nav-link';button.type='button';button.dataset.tab='tab-notifications';button.textContent='Thông báo';button.onclick=()=>switchTab('tab-notifications');accountingGroup.appendChild(button);
      }
      if(q('#accountingNoticeLink'))q('#accountingNoticeLink').hidden=!isAccountant;
      if(isAccountant&&!q('#accountingAuditLink')){const button=document.createElement('button');button.id='accountingAuditLink';button.className='nav-link';button.type='button';button.dataset.tab='tab-audit';button.textContent='User log';button.onclick=()=>switchTab('tab-audit');accountingGroup.appendChild(button);}
      if(q('#accountingAuditLink'))q('#accountingAuditLink').hidden=!isAccountant;
    }

    const restrictedOperations=['SALE','LEADER','MANAGER'].includes(role);
    const importHistory=q('#customerImportHistory');
    if(importHistory){importHistory.hidden=!isAdmin;importHistory.style.setProperty('display',isAdmin?'':'none','important');}
    const dataFilters=q('#dataQueueFilters');
    if(dataFilters){dataFilters.hidden=restrictedOperations;dataFilters.style.setProperty('display',restrictedOperations?'none':'flex','important');}
    const organizationLabel=qa('.nav-group-title').find(node=>node.textContent.trim()==='TỔ CHỨC');
    if(organizationLabel){
      const hideOrganization=false;
      organizationLabel.hidden=hideOrganization;
      organizationLabel.style.setProperty('display',hideOrganization?'none':'','important');
    }
    qa('.nvt-avatar-fallback,.auth-logo-image').forEach(node=>{node.style.setProperty('background-image','url(./logo.jpg?v=20260917-logo)','important');node.style.setProperty('background-size','cover','important');node.style.setProperty('background-position','center','important');node.style.setProperty('background-repeat','no-repeat','important');node.style.setProperty('color','transparent','important');node.style.textIndent='-9999px';});
    document.documentElement.classList.toggle('role-admin',isAdmin);
    document.documentElement.classList.toggle('role-restricted',!isAdmin);
    qa('.brand-avatar').forEach(node=>{node.style.setProperty('background-image',"url('./logo.jpg?v=20260917-logo')",'important');node.style.setProperty('background-size','cover','important');node.style.setProperty('background-position','center','important');node.style.setProperty('color','transparent','important');});
    if(!q('#referenceProfileCompactStyles')){const style=document.createElement('style');style.id='referenceProfileCompactStyles';style.textContent='.profile-modal-card .modal-body{padding:0!important}.profile-modal-card .profile-panel-body{padding:14px 16px 16px!important}.profile-modal-card .profile-hero{gap:12px!important;padding:0 0 12px!important;margin-bottom:12px!important}.profile-modal-card .profile-avatar-large{width:64px!important;height:64px!important;border-radius:12px!important}.profile-modal-card .profile-fields{gap:10px!important}.profile-modal-card .profile-actions{margin-top:12px!important;padding-top:12px!important}.reference-profile-avatar{background-image:url(./logo.jpg?v=20260917-logo)!important;background-size:cover!important;background-position:center!important;color:transparent!important}@media(max-width:560px){.profile-modal-card .profile-panel-body{padding:12px!important}.profile-modal-card .profile-fields{grid-template-columns:1fr!important}.profile-modal-card .profile-hero{align-items:flex-start!important}}';document.head.appendChild(style);}

    // Leader va Manager khong su dung diem danh; an ca nut menu, section va duong dan cu.
    const attendanceAllowed=['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED','HRM'].includes(role);
    qa('.nav-link[data-tab="tab-attendance"],[data-view-link="attendance"],#tab-attendance').forEach(node=>{
      const target=node.matches('#tab-attendance')?node:(node.closest('li')||node);
      target.hidden=!attendanceAllowed;
      target.setAttribute('aria-hidden',String(!attendanceAllowed));
      target.style.setProperty('display',attendanceAllowed?'':'none','important');
    });
    if(!attendanceAllowed&&q('section.active[id="tab-attendance"]')) renders.switchTab('tab-customers');

    // Sale khong quan ly doi ngu; an menu va tab doi ngu theo vai tro.
    const teamAllowed=['ADMIN','MANAGER','LEADER','HRM'].includes(role);
    qa('.nav-link[data-tab="tab-team"],[data-view-link="team"],#tab-team').forEach(node=>{
      const target=node.matches('#tab-team')?node:(node.closest('li')||node);
      target.hidden=!teamAllowed;
      target.setAttribute('aria-hidden',String(!teamAllowed));
      target.style.setProperty('display',teamAllowed?'':'none','important');
    });
    if(!teamAllowed&&q('section.active[id="tab-team"]')) renders.switchTab('tab-customers');

    // Giao diện tham chiếu có thể dựng lại menu sau khi đồng bộ dữ liệu.
    // Ẩn cả nút, thẻ li cha và section để không còn khoảng trống hoặc đường dẫn sót.
    restrictedAdminTabs.forEach(tab=>{
      const selectors=[
        `.nav-link[data-tab="tab-${tab}"]`,
        `[data-view-link="${tab}"]`,
        `#tab-${tab}`
      ];
      qa(selectors.join(',')).forEach(node=>{
        const target=node.matches(`#tab-${tab}`)?node:(node.closest('li')||node);
        if(!isAdmin&&!(['accounting','audit'].includes(tab)&&isAccountant)){
          if(!target.hidden)target.hidden=true;
          if(target.getAttribute('aria-hidden')!=='true')target.setAttribute('aria-hidden','true');
          if(target.style.getPropertyValue('display')!=='none')target.style.setProperty('display','none','important');
        }else{
          if(target.hidden)target.hidden=false;
          if(target.hasAttribute('aria-hidden'))target.removeAttribute('aria-hidden');
          if(target.style.getPropertyValue('display'))target.style.removeProperty('display');
        }
      });
    });

    // Các link Chi tiết trên dashboard cũng không được mở trang Admin-only.
    qa('[onclick*="tab-websites"],[onclick*="tab-products"],[onclick*="tab-audit"],[onclick*="tab-settings"]').forEach(node=>{
      if(!isAdmin&&!(isAccountant&&node.id==='accountingAuditLink')){
        if(!node.hidden)node.hidden=true;
        if(node.style.getPropertyValue('display')!=='none')node.style.setProperty('display','none','important');
      }else{
        if(node.hidden)node.hidden=false;
        if(node.style.getPropertyValue('display'))node.style.removeProperty('display');
      }
    });

    const active=q('section.active[id^="tab-"]')?.id?.replace('tab-','');
    if(isAccountant&&!['accounting','audit','notifications'].includes(active))renders.switchTab('tab-accounting');
    else if(role==='MARKETING'&&!['marketing'].includes(active))renders.switchTab('tab-marketing');
    else if(!isAdmin&&!isAccountant&&role!=='MARKETING'&&restrictedAdminTabs.has(active)) renders.switchTab('tab-customers');

    // Admin xem tong quan data theo pham vi; Sale xem rieng data dang cho nhan.
    const pendingOverview=q('#tab-dashboard .goal-progress-box');
    if(pendingOverview){
      const canViewPendingOverview=isAdmin||role==='SALE';
      pendingOverview.hidden=!canViewPendingOverview;
      pendingOverview.style.setProperty('display',canViewPendingOverview?'':'none','important');
    }
  }
  function installRoleVisibilityObserver(){
    if(roleVisibilityObserver||!document.body)return;
    roleVisibilityObserver=new MutationObserver(()=>{
      if(data)applyRoleVisibility();
    });
    roleVisibilityObserver.observe(document.body,{childList:true,subtree:true});
  }
  function installPendingDataStyles(){
    if(q('#pendingDataStyles'))return;
    const style=document.createElement('style');
    style.id='pendingDataStyles';
    style.textContent=`
      .pending-data-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
      .pending-data-head>div{display:grid;gap:3px;min-width:0}
      .pending-data-head b{font-size:13.5px;color:var(--text-main)}
      .pending-data-head small{color:var(--text-muted);font-size:11px}
      .pending-data-table-wrap{max-height:340px;overflow:auto;border:1px solid var(--border-light);border-radius:8px}
      .pending-data-table{min-width:820px}
      .pending-data-table td:first-child b,.pending-data-table td:first-child small{display:block}
      .pending-data-table td:first-child small{margin-top:3px;color:var(--text-muted);font-size:10.5px;white-space:nowrap}
      .pending-team-row td{padding:8px 12px!important;background:var(--bg-subtle);color:var(--text-main);border-top:1px solid var(--border)}
      .pending-team-row td b{margin-right:10px}.pending-team-row td span{color:var(--text-muted);font-size:11px}
      .pending-data-empty{display:grid;justify-items:center;gap:4px;padding:24px;color:var(--text-muted);text-align:center}
      .pending-data-empty b{color:var(--text-main)}
      .pending-hierarchy-list{display:grid;gap:7px;padding:8px 0}
      .pending-leader-group{border:1px solid var(--border-light);border-radius:8px;background:var(--bg-card)}
      .pending-leader-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;background:transparent;padding:12px 14px;text-align:left;color:var(--text-main);cursor:pointer}
      .pending-leader-toggle>span:first-child{display:grid;gap:3px;min-width:0}.pending-leader-toggle b{font-size:12px}.pending-leader-toggle small{color:var(--text-muted);font-size:10.5px}.pending-leader-chevron{font-size:18px;color:var(--text-muted)}
      .pending-leader-detail{padding:0 10px 10px;border-top:1px solid var(--border-light)}
      .pending-sale-group{padding:8px 0;border-bottom:1px solid var(--border-light)}.pending-sale-group:last-child{border-bottom:0}.pending-sale-head{display:flex;justify-content:space-between;padding:3px 4px 6px;color:var(--text-main);font-size:11px}.pending-sale-head span{color:var(--text-muted);font-size:10px}
      .pending-customer-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;border-radius:6px;background:transparent;padding:8px 6px;text-align:left;color:var(--text-main);cursor:pointer}.pending-customer-row:hover{background:var(--bg-subtle)}.pending-customer-row>span:first-child{display:grid;gap:2px;min-width:0}.pending-customer-row small{color:var(--text-muted);font-size:10px}.pending-customer-row .chip{flex:0 0 auto}
      @media(max-width:980px){.pending-data-head{align-items:flex-start}.pending-data-head small{white-space:normal}.pending-data-table-wrap{max-height:360px;margin:0 -4px}.pending-data-table{min-width:760px}}
    `;
    document.head.appendChild(style);
  }
  const person=id=>data?.members.find(m=>m.id===id)?.name||'— Chưa phân Sale —';
  const teamLabel=(teamId,leaderId)=>{const leader=data?.members.find(m=>m.id===leaderId&&m.role==='LEADER');return leader?.name?'Team '+leader.name:(teamId?'Team '+teamId:'Ch\u01b0a ph\u00e2n Team');};
  const teamIdFromName=name=>{const slug=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0110/g,'D').replace(/\u0111/g,'d').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,15);return 'TEAM-'+(slug||Date.now().toString().slice(-6));};
  const internalCode=(value)=>((data?.user?.actualRole||data?.user?.role)==='ADMIN'?shortOrderCode(value):'Đơn hàng');
  // Chỉ rút gọn mã ở lớp hiển thị; mã đầy đủ trong API/MySQL vẫn được giữ nguyên.
  const shortOrderCode=value=>CrmNotifications.shortOrderCode(value);
  const fmtDate=v=>{const d=String(v||'');const m=d.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);return m?`${m[3]}/${m[2]}/${m[1]}${m[4]}`:d;};
  const fromDay=days=>{const d=new Date(data.today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days+1);return d.toISOString().slice(0,10);};
  const renders={customers:renderCustomerTable,care:renderCareView,queue:renderDataQueue,orders:renderOrdersTable,drawer:openDrawerForCust,careOpen:openCareGroupModal,careOptions:updateCareGroupOptions,switchTab};
  let customerDraftOwner='';
  let customerDraftsRestoredFor='';
  const customerDraftValues=new Map();
  const customerNoteDrafts=new Map();
  const customerNoteSaveTimers=new Map();
  const draftStorageKey=()=> 'nvt-crm-customer-edits-v1:'+customerDraftOwner;
  const noteDraftStorageKey=()=> 'nvt-crm-customer-note-drafts-v1:'+customerDraftOwner;
  // Bản nháp ghi cả sessionStorage (theo tab) lẫn localStorage: đóng tab, trình duyệt treo
  // hay mất mạng rồi mở lại vẫn còn để gửi tiếp. Đọc ưu tiên bản của tab hiện tại.
  const draftStore={
    get(key){let raw=null;try{raw=sessionStorage.getItem(key);}catch{}if(raw===null)try{raw=localStorage.getItem(key);}catch{}return raw;},
    set(key,value){sessionStorage.setItem(key,value);try{localStorage.setItem(key,value);}catch{}},
    remove(key){try{sessionStorage.removeItem(key);}catch{}try{localStorage.removeItem(key);}catch{}}
  };
  const selectionKey=p=>p.kind+':'+p.id+(p.kind==='field'?':'+p.fieldId:'');
  function persistCustomerNoteDrafts(){
    if(!customerDraftOwner)return;
    try{
      const records=Array.from(customerNoteDrafts.values());
      if(records.length)draftStore.set(noteDraftStorageKey(),JSON.stringify(records));
      else draftStore.remove(noteDraftStorageKey());
    }catch(error){referenceNotice('Khong the luu ban nhap ghi chu tren trinh duyet.','error');}
  }
  let customerEditReady=false;
  function selectionAction(payload,restored=false){return async(currentPayload=payload)=>{
    payload=currentPayload;
    const session=api?.sessionIdentity();
    if(!session||session.id!==payload.accountId)throw Error('Phiên đăng nhập đã thay đổi. Bản nháp vẫn được giữ theo tài khoản.');
    // Xung đột cũ: tải bản mới và gộp lại phần mình sửa, không khóa hàng đợi đến khi F5.
    if(session.conflict&&!await api.resolveConflict?.())throw Error('Lần lưu trước đang xung đột. Bản nháp được giữ lại để kiểm tra.');
    if(restored){
      // Ô đã có đúng giá trị thì bỏ qua. Ô người khác vừa đổi: lượt lưu sau thắng như máy chủ,
      // thay vì báo lỗi mãi và chặn mọi lựa chọn phía sau trong hàng đợi.
      const value=api.customerSelection(payload.id,payload.kind,payload.fieldId);
      if(JSON.stringify(value)===JSON.stringify(payload.value))return;
    }
    return payload.kind==='field'?api.updateField(payload.id,payload.fieldId,payload.value):payload.kind==='leader'?api.assignLeader(payload.id,payload.value):api.assign(payload.id,payload.value);
  };}
  function restoreCustomerSelections(){
    if(!api?.sessionIdentity()||api.sessionIdentity().id!==data.user.id)return;
    // Cờ riêng: trước đây gõ phím trước khi khôi phục đã gán customerDraftOwner nên
    // hàm thoát sớm, rồi checkpoint mới ghi đè bản nháp cũ → mất ghi chú sau F5.
    if(customerDraftsRestoredFor===data.user.id)return;
    customerDraftsRestoredFor=data.user.id;
    if(customerDraftOwner!==data.user.id){customerNoteSaveTimers.forEach(timer=>clearTimeout(timer));customerNoteSaveTimers.clear();customerNoteDrafts.clear();customerDraftValues.clear();}
    customerDraftOwner=data.user.id;
    try{
      const records=JSON.parse(draftStore.get(draftStorageKey())||'[]');
      if(!Array.isArray(records)||records.some(r=>!r.payload||r.payload.accountId!==customerDraftOwner||!['field','leader','sale'].includes(r.payload.kind)))throw Error('Bản nháp không hợp lệ.');
      const noteRecords=JSON.parse(draftStore.get(noteDraftStorageKey())||'[]');
      if(!Array.isArray(noteRecords)||noteRecords.some(r=>!r.payload||r.payload.accountId!==customerDraftOwner||r.payload.kind!=='field'))throw Error('Bản nháp ghi chú không hợp lệ.');
      // The debounce draft is newer than an already queued value for the same
      // cell. Restore it last by key before the queue deduplicates records.
      const combined=Array.from(new Map([...records,...noteRecords].map(record=>[record.key,record])).values());
      for(const {payload} of combined)customerDraftValues.set(selectionKey(payload),payload.value);
      customerSaveQueue.restore(combined,payload=>selectionAction(payload,true));
      if(noteRecords.length)draftStore.remove(noteDraftStorageKey());
      if(combined.length&&q('#tab-customers.active'))fillCustomerOptions();
    }catch(error){referenceNotice(error.message,'error');}
  }

  const customerSaveQueue=createCustomerSaveQueue({
    isBusy:()=>working||workflowBusy,
    persist:records=>{
      if(!customerDraftOwner)return;
      if(records.length)draftStore.set(draftStorageKey(),JSON.stringify(records));
      else draftStore.remove(draftStorageKey());
    },
    setBusy:value=>{working=value;},
    onChange:({pending,error,running,retrying})=>{
      if(!error&&!pending&&!running){
        q('#customerSaveStatus')?.remove();
        if(!pending&&!running){customerDraftValues.clear();customerNoteDrafts.forEach(record=>customerDraftValues.set(record.key,record.payload.value));refresh();}
        return;
      }
      let status=q('#customerSaveStatus');
      if(!status){
        status=document.createElement('div');status.id='customerSaveStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
        status.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:calc(100vw - 32px);padding:9px 14px;border-radius:10px;background:#fff;border:1px solid #dbe3ed;box-shadow:0 4px 18px #0f172a18;font-size:13px;color:#334155;';
        document.body.appendChild(status);
      }
      status.hidden=false;status.replaceChildren();
      const label=document.createElement('span');
      label.textContent=error?(retrying?'Máy chủ đang bận, đang tự lưu lại… Lựa chọn vẫn được giữ.':'Chưa lưu được. Lựa chọn đang được giữ lại.'):'Đang lưu thay đổi lên máy chủ…';status.appendChild(label);
      if(error){
        status.title=error.message||'Không kết nối được máy chủ';
        const retry=document.createElement('button');retry.type='button';retry.textContent='Thử lưu lại';retry.style.cssText='margin-left:10px;cursor:pointer;';retry.onclick=()=>customerSaveQueue.retry();status.appendChild(retry);
      }else status.removeAttribute('title');

    }
  });
  function saveCustomerSelection(kind,id,value,fieldId){
    if(!data?.user?.id)return;
    restoreCustomerSelections();
    const payload={kind,id,fieldId,value:structuredClone(value),accountId:data.user.id};
    customerDraftOwner=data.user.id;
    const key=selectionKey(payload);
    payload.base=structuredClone(customerDraftValues.has(key)?customerDraftValues.get(key):api.customerSelection(id,kind,fieldId));
    customerDraftValues.set(key,payload.value);
    customerSaveQueue.enqueue(key,selectionAction(payload),payload);
  }
  function stageCustomerNoteSelection(id,fieldId,value,immediate=false){
    if(!data?.user?.id)return;
    restoreCustomerSelections();
    customerDraftOwner=data.user.id;
    const payload={kind:'field',id,fieldId,value:String(value||'').slice(0,4000),accountId:data.user.id};
    const key=selectionKey(payload),existing=customerNoteDrafts.get(key);
    const current=api.customerSelection(id,'field',fieldId);
    if(!existing&&String(current??'')===payload.value)return;
    payload.base=structuredClone(existing?.payload?.base??current);
    customerDraftValues.set(key,payload.value);
    customerNoteDrafts.set(key,{key,payload});persistCustomerNoteDrafts();
    if(customerNoteSaveTimers.has(key))clearTimeout(customerNoteSaveTimers.get(key));
    const flush=()=>{
      customerNoteSaveTimers.delete(key);
      const record=customerNoteDrafts.get(key);if(!record)return;
      customerSaveQueue.enqueue(key,selectionAction(record.payload),record.payload);
      customerNoteDrafts.delete(key);persistCustomerNoteDrafts();
    };
    if(immediate)flush();else customerNoteSaveTimers.set(key,setTimeout(flush,600));
  }
  window.addEventListener('beforeunload',event=>{if(customerSaveQueue.pending||customerNoteDrafts.size){event.preventDefault();event.returnValue='';}});
  // Có mạng lại: gửi ngay phần đang chờ, không đợi hết lượt chờ thử lại.
  window.addEventListener('online',()=>{if(customerSaveQueue.pending)customerSaveQueue.retry();});
  // Không cho hai lần bấm tạo cùng lúc. Runtime giữ requestId nếu mất phản hồi server.
  let blacklistSearch='', blacklistStatus='PENDING', blacklistPage=1, blacklistView='entries';
  function renderBlacklistEntries() {
    const body=q('#blacklistEntryBody');if(!body)return;
    const search=blacklistSearch.toLocaleLowerCase('vi-VN');
    const entries=(data.blacklistEntries||[]).filter(row=>(blacklistStatus==='ALL'||row.status===blacklistStatus)&&[row.ip,row.customer?.name,row.customer?.phone,row.customer?.email,row.source?.landingPageName].join(' ').toLocaleLowerCase('vi-VN').includes(search)).sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt))||b.id.localeCompare(a.id));
    const pages=Math.max(1,Math.ceil(entries.length/20));blacklistPage=Math.min(blacklistPage,pages);
    body.innerHTML=entries.slice((blacklistPage-1)*20,blacklistPage*20).map(row=>{
      const name=row.customer?.name||'—',initials=String(name).trim().split(/\s+/).slice(-2).map(part=>part[0]).join('').toUpperCase();
      const accepted=row.status==='ACCEPTED',invalid=!accepted&&row.record?.status!=='NEW';
      return '<tr><td><div class="bl-customer"><span class="bl-avatar" aria-hidden="true">'+esc(initials)+'</span><b>'+esc(name)+'</b></div></td><td><div class="bl-contact"><span>'+esc(row.customer?.phone||'—')+'</span>'+(row.customer?.email?'<small>'+esc(row.customer.email)+'</small>':'')+'</div></td><td><code class="bl-ip">'+esc(row.ip)+'</code></td><td><span class="bl-source">'+esc(row.source?.landingPageName||'Landing page')+'</span></td><td><span class="bl-time">'+esc(fmtDate(row.receivedAt))+'</span></td><td><span class="bl-status '+(accepted?'is-accepted':invalid?'is-invalid':'')+'">'+(accepted?'Đã chấp nhận':invalid?'Không hợp lệ':'Chờ duyệt')+'</span></td><td>'+(accepted?'—':'<button type="button" class="btn-action bl-accept" data-blacklist-accept="'+esc(row.id)+'" '+(invalid?'disabled':'')+'>Chấp nhận</button>')+'</td></tr>';
    }).join('')||'<tr><td colspan="7"><div class="bl-empty">Không có data</div></td></tr>';
    qa('[data-blacklist-accept]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await run(()=>api.acceptBlacklistEntry(button.dataset.blacklistAccept),()=>referenceNotice('Đã chấp nhận.'));}finally{button.disabled=false;}});
    text('blacklistDataCount',(data.blacklistEntries||[]).length);
    const pager=q('#blacklistPagination');pager.innerHTML='<span class="bl-pagination-summary">'+entries.length+' data</span><button type="button" class="bl-page-button" data-blacklist-prev aria-label="Trang trước" '+(blacklistPage===1?'disabled':'')+'>‹</button><span class="bl-page-current">'+blacklistPage+' / '+pages+'</span><button type="button" class="bl-page-button" data-blacklist-next aria-label="Trang sau" '+(blacklistPage===pages?'disabled':'')+'>›</button>';
    pager.querySelector('[data-blacklist-prev]').onclick=()=>{blacklistPage--;renderBlacklistEntries();};pager.querySelector('[data-blacklist-next]').onclick=()=>{blacklistPage++;renderBlacklistEntries();};
  }
  function renderBlacklistIps() {
    const search=blacklistSearch.toLocaleLowerCase('vi-VN');
    const ips=(data.blacklistIps||[]).filter(row=>row.active!==false).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    q('#blacklistIpBody').innerHTML=ips.filter(row=>row.ip.toLocaleLowerCase('vi-VN').includes(search)).map(row=>'<tr><td><code class="bl-ip">'+esc(row.ip)+'</code></td><td><span class="bl-time">'+esc(fmtDate(row.createdAt))+'</span></td><td><button type="button" class="btn-action bl-unblock" data-blacklist-unblock="'+esc(row.id)+'">Bỏ chặn</button></td></tr>').join('')||'<tr><td colspan="3"><div class="bl-empty">Không có IP</div></td></tr>';
    text('blacklistIpCount',ips.length);
    qa('[data-blacklist-unblock]').forEach(button=>button.onclick=async()=>{if(!window.confirm('Bỏ chặn IP này?'))return;button.disabled=true;try{await run(()=>api.removeBlacklistIp(button.dataset.blacklistUnblock),()=>referenceNotice('Đã bỏ chặn.'));}finally{button.disabled=false;}});
  }
  function applyBlacklistView() {
    q('#blacklistDataPanel').hidden=blacklistView!=='entries';q('#blacklistIpsPanel').hidden=blacklistView!=='ips';q('#blacklistStatus').hidden=blacklistView==='ips';
    qa('[data-blacklist-view]').forEach(button=>{const selected=button.dataset.blacklistView===blacklistView;button.classList.toggle('is-active',selected);button.setAttribute('aria-selected',String(selected));});
  }
  function renderBlacklist() {
    if((data.user.actualRole||data.user.role)!=='ADMIN')return;
    q('#blacklistAddIp').onclick=()=>editor('Chặn IP',formField('Địa chỉ IP','<input id="blacklistIpInput" required maxlength="64" autocomplete="off">'),()=>api.saveBlacklistIp({ip:q('#blacklistIpInput').value}));
    const search=q('#blacklistSearch'),status=q('#blacklistStatus');search.value=blacklistSearch;status.value=blacklistStatus;
    search.oninput=()=>{blacklistSearch=search.value.trim();blacklistPage=1;renderBlacklistEntries();renderBlacklistIps();};status.onchange=()=>{blacklistStatus=status.value;blacklistPage=1;renderBlacklistEntries();};
    qa('[data-blacklist-view]').forEach(button=>button.onclick=()=>{blacklistView=button.dataset.blacklistView;blacklistSearch='';blacklistPage=1;search.value='';applyBlacklistView();renderBlacklistEntries();renderBlacklistIps();});
    applyBlacklistView();renderBlacklistEntries();renderBlacklistIps();
  }
  async function run(action,done) {
    if(working||customerSaveQueue.pending){referenceNotice('Đang lưu lựa chọn. Bạn có thể tiếp tục chọn trong bảng.');return null;} if(!api||!data||!api.sessionIdentity())return;
    working=true;
    // refresh() bỏ qua lượt vẽ khi working=true (coi như đang sửa), nên phải nhả cờ
    // trước rồi mới vẽ lại. Trước đây vẽ lại trong try nên bị bỏ qua: xóa/sửa xong
    // phải chờ chu kỳ làm mới 15 giây mới thấy thay đổi.
    let result=null;
    try { result=await action(); }
    catch(e){working=false;window.alert(e.message||'Không lưu được dữ liệu.');refresh(true);return null;}
    finally{working=false;}
    if(done)done(result);
    refresh(true);
    return result;
  }
  function project() {
    const customersById = new Map(data.customers.map(c => [c.id,c]));
    appState={members:data.members,offers:Array.isArray(data.offers)?data.offers:[],pendingOffers:Array.isArray(data.pendingOffers)?data.pendingOffers:[],customers:data.customers.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||a.id.localeCompare(b.id)).map(c=>({
      id:c.id,saleAcceptedAt:c.saleAcceptedAt||null,ownerId:c.ownerId||null,saleId:c.saleId||null,leaderId:c.leaderId||null,managerId:c.managerId||null,name:esc(c.name),phone:esc(c.phone),email:esc(c.email),createdAt:fmtDate(c.createdAt),source:esc(data.websites.find(w=>w.id===c.websiteId)?.name||c.landingPageName||c.source||''),leader:esc(person(c.leaderId)),sale:esc(person(c.saleId)),level:esc(fieldOptions('customerLevel').find(o=>o.value===c.customFields?.customerLevel)?.label||c.customFields?.customerLevel||''),customerClass:esc(c.customFields?.customerClass||''),customerLevel:esc(c.customFields?.customerLevel||''),documentStatus:esc(c.customFields?.documentStatus||''),result:esc(c.customFields?.result||''),callStatus:esc(c.customFields?.callStatus||''),docStatus:esc(c.customFields?.documentStatus||''),careResult:esc(c.customFields?.result||''),status:c.status,note:esc(c.note),...Object.fromEntries(data.fields.filter(f=>!['customerClass','customerLevel','callStatus','documentStatus','result'].includes(f.id)).map(f=>[f.id,Array.isArray(c.customFields?.[f.id])?c.customFields[f.id].map(esc):esc(c.customFields?.[f.id]||'')]))
    })),orders:data.orders.map(o=>({id:o.id,code:esc(o.code),customerName:esc(o.customerName),phone:esc(customersById.get(o.customerId)?.phone||''),product:esc(o.productName),sale:esc(person(o.saleId)),leader:esc(person(o.leaderId)),total:o.total,status:o.status,rentalExpiry:o.rentalMonths?fmtDate(o.rentalEndsAt):'Vĩnh viễn'})),careGroups:(data.careGroups||[]).map(g=>({...g,name:esc(g.name),field:g.fieldId,values:g.values.map(esc)}))};
    appState.customers.forEach(c=>{const original=customersById.get(c.id);data.fields.forEach(f=>{const value=original.customFields?.[f.id];c[f.id]=Array.isArray(value)?value.map(esc):esc(value||'');});});
  }
  // Modal dùng đúng thành phần và màu sắc của giao diện tham chiếu.
  function editor(title, body, onSave, background=false) {
    q('#referenceEditor')?.remove();const modal=document.createElement('div');modal.id='referenceEditor';modal.className='modal-overlay open';ensureReferenceEditorStyles();
    modal.innerHTML=`<form class="modal-card reference-editor-card" role="dialog" aria-modal="true" aria-labelledby="refEditorTitle"><div class="modal-header"><h3 id="refEditorTitle">${esc(title)}</h3><button type="button" class="modal-close-btn" data-editor-close aria-label="Đóng">×</button></div><div class="modal-body reference-editor-body">${body}<p data-editor-error role="alert"></p></div><div class="modal-footer"><button type="button" class="btn-action btn-secondary" data-editor-close>Đóng</button>${onSave?'<button class="btn-action btn-primary" type="submit">Lưu</button>':''}</div></form>`;
    document.body.appendChild(modal);modal.querySelectorAll('[data-editor-close]').forEach(n=>n.onclick=()=>{if(background||!working){modal.remove();refresh(true);}});
    modal.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!onSave||(!background&&working))return;if(!background)working=true;const controls=Array.from(e.currentTarget.elements),disabled=controls.map(n=>n.disabled);modal.querySelector('[data-editor-error]').textContent='';
      let saved=false;
      try{const operation=onSave();controls.forEach(n=>n.disabled=true);const result=await operation;if(result!==false){modal.remove();saved=true;}}catch(error){modal.querySelector('[data-editor-error]').textContent=error.message;}finally{if(!background)working=false;controls.forEach((n,i)=>n.disabled=disabled[i]);}
      // Vẽ lại sau khi đã nhả cờ working, nếu không refresh() bỏ qua lượt này.
      if(saved)refresh(true);
    };return modal;
  }
  function ensureReferenceEditorStyles(){
    if(q('#referenceEditorStyles'))return;
    const style=document.createElement('style');style.id='referenceEditorStyles';style.textContent=`
      .reference-editor-card{width:min(720px,calc(100vw - 28px))!important;max-height:min(720px,92dvh)!important;border:1px solid #dbe3ec;border-radius:14px!important;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.24)!important}
      .reference-editor-card .modal-header{padding:17px 22px!important;background:#f8fafc;border-bottom:1px solid #e2e8f0!important}
      .reference-editor-card .modal-header h3{font-size:16px!important;letter-spacing:0!important;color:#0f172a}
      .reference-editor-card .modal-close-btn{width:30px;height:30px;border-radius:7px;color:#64748b!important}
      .reference-editor-card .modal-close-btn:hover{background:#e2e8f0;color:#0f172a!important}
      .reference-editor-body{display:block!important;padding:22px!important;background:#fff;overflow-y:auto!important}
      .reference-editor-body>[data-editor-error]{min-height:18px;margin:12px 0 0;font-size:12px;font-weight:700;color:#dc2626}
      .crm-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
      .crm-field{display:grid;gap:7px;min-width:0;margin:0!important}
      .crm-field>span{display:flex;align-items:center;gap:5px;color:#334155;font-size:12px;font-weight:800;line-height:1.35}
      .crm-field>span em{color:#dc2626;font-style:normal}
      .crm-field>span small{margin-left:auto;color:#94a3b8;font-size:10px;font-weight:600}
      .crm-field input:not([type=file]),.crm-field select,.crm-field textarea{width:100%;box-sizing:border-box;min-height:40px;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font:500 13px Arial,sans-serif;outline:none;transition:border-color .15s,box-shadow .15s}
      .crm-field textarea{min-height:118px;line-height:1.5;resize:vertical}
      .crm-field input:not([type=file]):focus,.crm-field select:focus,.crm-field textarea:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
      .crm-field-full{grid-column:1/-1}
      .crm-file-picker{display:flex;align-items:center;gap:9px;min-height:40px;min-width:0;padding:4px 8px;border:1px dashed #b8c5d6;border-radius:8px;background:#f8fafc}
      .crm-file-picker input[type=file]{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;clip-path:inset(50%)}
      .crm-file-button{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:0 10px;border-radius:6px;background:#e8f0ff;color:#1d4ed8;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}
      .crm-file-button:hover{background:#dbeafe}
      .crm-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px}
      .crm-image-preview{min-height:10px;margin-top:2px}
      .crm-image-preview:empty{display:none}
      .crm-image-preview img{display:block;max-width:100%;max-height:190px;border:1px solid #dbe3ec;border-radius:9px;background:#f8fafc;object-fit:contain}
      .reference-editor-card .modal-footer{padding:13px 22px!important;border-top:1px solid #e2e8f0!important;background:#f8fafc}
      .reference-editor-card .modal-footer .btn-action{min-height:38px;padding:0 16px;border-radius:8px;font-weight:800}
      @media(max-width:600px){.reference-editor-card{width:min(100% - 20px,720px)!important}.reference-editor-body{padding:17px!important}.crm-form-grid{grid-template-columns:1fr;gap:13px}.crm-field-full{grid-column:auto}.crm-field>span small{margin-left:0}.reference-editor-card .modal-header{padding:15px 17px!important}.reference-editor-card .modal-footer{padding:11px 17px!important}}
    `;document.head.appendChild(style);
  }
  const formField=(label,html)=>`<div class="form-group" style="margin-bottom:14px"><label for="${html.match(/id="([^"]+)"/)?.[1]||''}" style="display:block">${esc(label)}${/\brequired(?:\s|>|=)/i.test(html)&&!label.includes("*")?'<em aria-hidden="true" style="color:#dc2626;font-style:normal;margin-left:4px">*</em>':""}</label>${html}</div>`;
  const validColor=color=>/^#[a-f0-9]{6}$/i.test(color)?color:'#64748b';
  function fieldControl(cell,field,customer) {
    let value=customerDraftValues.has('field:'+customer.id+':'+field.id)?customerDraftValues.get('field:'+customer.id+':'+field.id):(customer.customFields?.[field.id]??'');if(field.id==='customerLevel'){const legacy=field.options?.find(option=>option.label===value);if(legacy)value=legacy.value;}const editable=api?.sessionIdentity()?.id===data.user.id&&['ADMIN','MANAGER','LEADER','SALE'].includes(data.user.actualRole||data.user.role);
    const control=document.createElement(field.type==='SELECT'?'select':field.type==='NOTE'?'textarea':field.type==='MULTI_SELECT'?'button':'input');
    control.className='chip';control.style.cssText='width:210px;max-width:210px;padding:5px 8px;border-radius:6px;font:inherit;font-size:11px;font-weight:700;border:1px solid var(--border);';
    const applyOptionColor=next=>{const color=validColor(field.options?.find(o=>o.value===next)?.color);control.style.color=color;control.style.backgroundColor=color+'18';};
    applyOptionColor(value);
    const save=next=>{value=next;control.blur();return saveCustomerSelection('field',customer.id,next,field.id);};
    if(field.type==='SELECT'){
      const coloredOption=o=>{const color=validColor(o.color);return '<option value="'+esc(o.value)+'" '+(o.value===value?'selected ':'')+'style="color:'+color+';background-color:'+color+'18;font-weight:700">'+esc(o.label)+'</option>';};
      control.innerHTML=opt('','— Chưa chọn —',value)+(field.options||[]).map(coloredOption).join('');
      control.onchange=()=>{applyOptionColor(control.value);return save(control.value);};
    }
    else if(field.type==='MULTI_SELECT'){
      control.type='button';control.textContent=(field.options||[]).filter(o=>[].concat(value).includes(o.value)).map(o=>o.label).join(', ')||'— Chọn —';
      control.onclick=()=>{const modal=editor(field.label,`<div style="display:flex;flex-wrap:wrap;gap:12px">${field.options.map(o=>`<label class="chip" style="color:${validColor(o.color)};background:${validColor(o.color)}18"><input type="checkbox" value="${esc(o.value)}" ${[].concat(value).includes(o.value)?'checked':''}> ${esc(o.label)}</label>`).join('')}</div>`,()=>{const next=Array.from(modal.querySelectorAll('input:checked'),n=>n.value);value=next;control.textContent=(field.options||[]).filter(o=>next.includes(o.value)).map(o=>o.label).join(', ')||'— Chọn —';saveCustomerSelection('field',customer.id,next,field.id);},true);};
    }else if(field.type==='CHECKBOX'){control.type='checkbox';control.checked=value===true;control.onchange=()=>save(control.checked);}
    else if(field.type==='NOTE'){
      control.value=value;control.maxLength=4000;control.rows=2;control.wrap='soft';control.className='customer-note-editor';
      control.style.cssText='display:block;width:250px;min-width:250px;max-width:250px;height:58px;min-height:58px;max-height:140px;padding:8px 10px;border:1px solid #d7e0ea;border-radius:7px;background:#f8fafc;color:var(--text-main);font:500 11.5px/1.45 var(--font-sans,Arial,sans-serif);white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:hidden;overflow-y:auto;resize:vertical;box-sizing:border-box;transition:height .15s ease,box-shadow .15s ease;';
      const collapse=()=>{control.style.height='58px';control.dataset.noteExpanded='false';};
      const expand=()=>{control.style.height='auto';control.style.height=Math.min(140,Math.max(58,control.scrollHeight))+'px';control.dataset.noteExpanded='true';};
      control.onfocus=expand;
      control.onmouseenter=()=>{if(document.activeElement!==control)expand();};
      control.onmouseleave=()=>{if(document.activeElement!==control)collapse();};
      control.oninput=()=>{value=control.value;expand();stageCustomerNoteSelection(customer.id,field.id,value,false);};
      control.onblur=()=>{stageCustomerNoteSelection(customer.id,field.id,control.value,true);collapse();};
      collapse();
    }
    else{control.value=value;control.maxLength=500;control.onchange=()=>save(control.value);}
    control.disabled=!editable;control.dataset.customerField=field.id;control.setAttribute('aria-label',field.label+' · '+customer.name);cell.replaceChildren(control);
  }
  const baseFields=['customerLevel','customerClass','callStatus','documentStatus','result'];
  function applyCustomerSourceVisibility(){
    const isAdmin=(data?.user?.actualRole||data?.user?.role)==='ADMIN';
    const body=q('#customerTableBody'),head=body?.closest('table')?.querySelector('thead tr');
    if(!body||!head)return;
    const sourceIndex=Array.from(head.cells).findIndex(cell=>/LANDING|NGU\u1ed2N/i.test(cell.textContent||''));
    if(sourceIndex<0)return;
    head.cells[sourceIndex].hidden=!isAdmin;
    Array.from(body.rows).forEach(row=>{if(row.cells[sourceIndex])row.cells[sourceIndex].hidden=!isAdmin;});
  }
  function positionCustomerAssignmentColumns(head,body,atEnd){
    const keys=['source','leader','sale'];
    const actionIndex=Array.from(head.cells).findIndex(cell=>/THAO T\u00c1C|H\u1ed2 S\u01a0|X\u00d3A DATA/i.test(cell.textContent||''));
    const position=row=>{
      if(atEnd){
        const cells=Array.from(row.cells);if(cells.length<6)return;
        const anchor=actionIndex>=0?cells[actionIndex]:null;
        keys.forEach((key,index)=>{const cell=cells[3+index];cell.dataset.customerAssignmentColumn=key;row.insertBefore(cell,anchor);});
      }else{
        const cells=keys.map(key=>Array.from(row.cells).find(cell=>cell.dataset.customerAssignmentColumn===key));
        if(cells.some(cell=>!cell))return;
        const anchor=row.cells[3];cells.forEach(cell=>{row.insertBefore(cell,anchor);delete cell.dataset.customerAssignmentColumn;});
      }
    };
    position(head);Array.from(body.rows).forEach(position);
  }
  function fillCustomerOptions() {
    const body=q('#customerTableBody'),head=body.closest('table').querySelector('thead tr');
    positionCustomerAssignmentColumns(head,body,false);
    head.querySelectorAll('[data-extra-field]').forEach(n=>n.remove());
    head.querySelectorAll('[data-reference-amount-column]').forEach(n=>n.remove());
    const fields=data.fields.filter(f=>f.active!==false),extra=fields.filter(f=>!baseFields.includes(f.id)&&f.showInTable);
    const phoneHeader=head.querySelector('[data-phone-column]')||Array.from(head.cells).find(cell=>cell.textContent.trim()==='SỐ ĐIỆN THOẠI');
    if(phoneHeader)phoneHeader.dataset.phoneColumn='1';
    else{const th=document.createElement('th');th.dataset.phoneColumn='1';th.textContent='SỐ ĐIỆN THOẠI';head.insertBefore(th,head.cells[2]);}
    baseFields.forEach((id,i)=>{const f=fields.find(f=>f.id===id);head.cells[6+i].hidden=!f;if(f)head.cells[6+i].textContent=f.label;});
    extra.forEach(f=>{const th=document.createElement('th');th.dataset.extraField=f.id;th.textContent=f.label;head.insertBefore(th,head.cells[head.cells.length-3]);});
    head.querySelectorAll('[data-customer-filter-key]').forEach(cell=>delete cell.dataset.customerFilterKey);
    // Attach filter keys after the phone column is inserted.
    const setFilterKey=(cell,key)=>{if(!cell)return;cell.dataset ||= {};cell.dataset.customerFilterKey=key;};
    [['source',3],['leader',4],['sale',5]].forEach(([key,index])=>setFilterKey(head.cells[index],key));
    const referenceHeader=document.createElement('th');
    referenceHeader.dataset.referenceAmountColumn='1';
    referenceHeader.textContent='DỮ LIỆU KHÁCH THAM KHẢO';
    head.insertBefore(referenceHeader,head.lastElementChild);
    const legacyNoteIndex=Array.from(head.cells).findIndex(cell=>/GHI CHÚ MỚI NHẤT/i.test(String(cell.textContent||'').trim()));
    if(legacyNoteIndex>=0){head.cells[legacyNoteIndex].hidden=true;head.cells[legacyNoteIndex].setAttribute('aria-hidden','true');}
    Array.from(body.rows).forEach(row=>{
      const code=row.querySelector('button[onclick]')?.getAttribute('onclick'),id=code?.match(/'([^']+)'/)?.[1],c=data.customers.find(c=>c.id===id);
      if(!c){if(row.cells.length===1)row.cells[0].colSpan=head.cells.length;return;}
      row.dataset.customerId=c.id;
      row.querySelectorAll('[data-reference-amount-column]').forEach(n=>n.remove());
      if(!row.dataset.phoneColumnAdded){
        const nameCell=row.cells[1];
        nameCell?.querySelectorAll('div,small').forEach(node=>node.remove());
        const phoneCell=document.createElement('td');
        phoneCell.dataset.phoneColumn='1';
        phoneCell.innerHTML='<span class="customer-phone-cell">'+esc(c.phone||'—')+'</span>';
        row.insertBefore(phoneCell,row.cells[2]);
        row.dataset.phoneColumnAdded='1';
      }
      const nameCell=row.cells[1];
      if(nameCell&&!nameCell.dataset.customerMetaAdded){
        const meta=document.createElement('div');
        meta.className='customer-name-meta';
        meta.style.cssText='display:flex;align-items:center;gap:4px;margin-top:2px;font-size:10.5px;color:var(--text-muted);';
        const eye=document.createElement('button');
        eye.type='button';eye.className='customer-eye';eye.title='Xem hồ sơ '+c.name;eye.setAttribute('aria-label','Xem hồ sơ '+c.name);
        eye.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        eye.dataset.viewOnly='1';
        eye.onclick=()=>workflow('customer',c.id);
        const saleName=document.createElement('span');
        const saleId=assignedSaleIdForCustomer(c);
        const assignedSale=(data.members||[]).find(m=>m.id!=null&&saleId!=null&&String(m.id)===String(saleId));
        saleName.textContent=assignedSale?.name||'Chưa phân Sale';
        if(!assignedSale){saleName.style.fontStyle='italic';}
        meta.append(eye,saleName);nameCell.append(meta);nameCell.dataset.customerMetaAdded='1';
      }
      // Dùng ID để lưu; tên và số điện thoại chỉ dùng để hiển thị.
      const selectOwner=(cell,kind,people,value,editable)=>{
        if(customerDraftValues.has(kind+':'+c.id))value=customerDraftValues.get(kind+':'+c.id);
        const select=document.createElement('select');select.className='chip';select.style.cssText='width:210px;max-width:210px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);font:inherit;font-size:11px';
        select.dataset.assignment=kind;select.setAttribute('aria-label',(kind==='leader'?'Team / Leader':'Sale phụ trách')+' · '+c.name);
        select.innerHTML=opt('',kind==='leader'?'\u2014 Ch\u01b0a ch\u1ecdn Leader \u2014':'\u2014 Ch\u01b0a ph\u00e2n Sale \u2014',value)+people.map(m=>{
          const label=m.name+(m.role==='MANAGER'?' (Manager)':kind==='leader'?' - '+(m.teamId||''):m.role==='LEADER'?' (Leader)':'')+(m.phone?' - '+m.phone:'');
          return '<option value="'+esc(m.id)+'" '+(m.id===value?'selected ':'')+'>'+esc(label)+'</option>';
        }).join('');
        select.disabled=!editable;if(kind==='leader')select.options[0].disabled=true;
        select.onchange=()=>{const next=select.value;select.blur();saveCustomerSelection(kind,c.id,next);};cell.replaceChildren(select);
      };
      const pending=(data.offers||[]).find(o=>o.customerId===c.id&&o.status==='PENDING');
      const staff=data.members.filter(m=>m.active!==false),managers=staff.filter(m=>m.role==='MANAGER'),leaders=staff.filter(m=>m.role==='LEADER');
      const role=data.user.actualRole||data.user.role,currentId=data.user.id,currentLeaderId=data.user.leaderId||currentId;
      const visibleManagers=role==='ADMIN'?managers:role==='MANAGER'?managers.filter(m=>m.id===currentId):[];
      const visibleLeaders=role==='ADMIN'?leaders:role==='MANAGER'?leaders.filter(m=>m.managerId===currentId):leaders.filter(m=>m.id===currentLeaderId);
      const visibleLeaderIds=new Set(visibleLeaders.map(m=>m.id));
      const visibleSales=role==='ADMIN'
        ? staff.filter(m=>m.role==='SALE')
        : role==='MANAGER'
          ? staff.filter(m=>m.role==='SALE'&&(m.managerId===currentId||m.leaderId===currentId||visibleLeaderIds.has(m.leaderId)))
          : staff.filter(m=>m.role==='SALE'&&m.leaderId===currentLeaderId);
      const recipientPool=[...visibleManagers,...visibleLeaders,...visibleSales];
      const assignedMember=staff.find(m=>m.id===c.saleId)||staff.find(m=>m.id===pending?.saleId)||staff.find(m=>m.id===c.managerId)||staff.find(m=>m.id===c.leaderId);
      if(assignedMember&&!recipientPool.some(m=>m.id===assignedMember.id))recipientPool.push(assignedMember);
      const recipients=recipientPool.filter((m,index,list)=>list.findIndex(item=>item.id===m.id)===index).sort((a,b)=>({MANAGER:0,LEADER:1,SALE:2}[a.role]||9)-({MANAGER:0,LEADER:1,SALE:2}[b.role]||9)||String(a.name||'').localeCompare(String(b.name||''),'vi'));
      const assignment=staff.find(m=>m.id===c.saleId)||staff.find(m=>m.id===pending?.saleId);
      const leaderValue=c.leaderId||(assignment?.role==='LEADER'?assignment.id:'')||(!c.leaderId&&assignment?.role==='MANAGER'?assignment.id:'')||(!c.leaderId&&c.managerId&&!c.saleId?c.managerId:'');
      const leaderOptions=[...visibleManagers,...visibleLeaders].filter((m,index,list)=>list.findIndex(item=>item.id===m.id)===index).sort((a,b)=>({MANAGER:0,LEADER:1}[a.role]??9)-({MANAGER:0,LEADER:1}[b.role]??9)||String(a.name||'').localeCompare(String(b.name||''),'vi'));
      const canEditLeader=role==='ADMIN';
      const canEditSale=role==='ADMIN'||role==='MANAGER'&&data.customers.some(item=>item.id===c.id)||role==='LEADER'&&c.teamId===data.user.teamId&&c.leaderId===currentLeaderId;
      selectOwner(row.cells[4],'leader',leaderOptions,leaderValue,canEditLeader);
      selectOwner(row.cells[5],'sale',recipients,c.saleId||pending?.saleId||c.managerId||(!c.saleId&&!c.managerId&&assignment?.role==='LEADER'?assignment.id:''),canEditSale);
      baseFields.forEach((id,i)=>{const f=fields.find(f=>f.id===id);row.cells[6+i].hidden=!f;if(f)fieldControl(row.cells[6+i],f,c);});
      extra.forEach(f=>{const cell=document.createElement('td');row.insertBefore(cell,row.cells[row.cells.length-3]);fieldControl(cell,f,c);});
      const referenceValue=c.referenceAmount??c.customFields?.referenceAmount??c.customFields?.customerReferenceAmount;
      const referenceDigits=String(referenceValue??'').replace(/[^0-9]/g,'');
      const referenceCell=document.createElement('td');
      referenceCell.dataset.referenceAmountColumn='1';
      referenceCell.innerHTML='<span class="customer-reference-amount">'+(referenceDigits?money(Number(referenceDigits)):'—')+'</span>';
      row.insertBefore(referenceCell,row.lastElementChild);
      if(legacyNoteIndex>=0&&row.cells[legacyNoteIndex]){row.cells[legacyNoteIndex].hidden=true;row.cells[legacyNoteIndex].setAttribute('aria-hidden','true');}
    });
    applyCustomerSourceVisibility();
    installCustomerColumnFilters(head);
    positionCustomerAssignmentColumns(head,body,true);
  }
  if(!q('#referenceCustomerPhoneStyles')){const style=document.createElement('style');style.id='referenceCustomerPhoneStyles';style.textContent='.customer-phone-cell{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--text-main);font-weight:600;font-size:12px}.customer-reference-amount{white-space:nowrap;color:#059669;font-weight:800;font-variant-numeric:tabular-nums}#tab-customers .table-responsive{overflow-x:auto!important;overflow-y:visible!important;position:relative}#tab-customers .customer-data-table,#tab-customers .table-responsive>table{min-width:1420px}#tab-customers .table-responsive>table>thead>tr>th:nth-child(1),#tab-customers .table-responsive>table>tbody>tr>td:nth-child(1){position:sticky;left:0;width:154px;min-width:154px;max-width:154px;background:#fff;z-index:4;box-shadow:1px 0 0 #e2e8f0}#tab-customers .table-responsive>table>thead>tr>th:nth-child(2),#tab-customers .table-responsive>table>tbody>tr>td:nth-child(2){position:sticky;left:154px;width:190px;min-width:190px;max-width:190px;background:#fff;z-index:4;box-shadow:1px 0 0 #e2e8f0}#tab-customers .table-responsive>table>thead>tr>th:nth-child(3),#tab-customers .table-responsive>table>tbody>tr>td:nth-child(3){position:sticky;left:344px;width:142px;min-width:142px;max-width:142px;background:#fff;z-index:4;box-shadow:2px 0 0 #cbd5e1}#tab-customers .table-responsive>table>thead>tr>th:nth-child(-n+3){background:#f1f5f9;z-index:6}#tab-customers .table-responsive>table>tbody>tr:hover>td:nth-child(-n+3){background:#f8fbff}#tab-customers .table-responsive>table>tbody>tr>td:nth-child(-n+3){background:#fff}#tab-customers .table-responsive>table>tbody>tr>td:nth-child(1){font-variant-numeric:tabular-nums;white-space:nowrap}#tab-customers .table-responsive>table>tbody>tr>td:nth-child(2) b{display:block;white-space:normal;overflow-wrap:anywhere}';document.head.appendChild(style);}
  function fieldManager() {
    if(data.user.role!=='ADMIN')return;
    const modal=editor('Quản lý cột khách hàng',`<button type="button" class="btn-action btn-primary" id="refAddField">+ Thêm cột</button><div style="display:grid;gap:12px;margin-top:16px">${data.fields.map(f=>`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px;border:1px solid var(--border);border-radius:8px"><b style="flex:1">${esc(f.label)}</b><span class="chip">${f.options?.length||0} lựa chọn</span><button type="button" class="btn-action btn-secondary" data-edit-field="${esc(f.id)}">Sửa</button>${f.id==='customerLevel'?'':`<button type="button" class="btn-action btn-secondary" data-remove-field="${esc(f.id)}">Xóa</button>`}</div>`).join('')}</div>`);
    q('#refAddField').onclick=()=>fieldEditor();modal.querySelectorAll('[data-edit-field]').forEach(n=>n.onclick=()=>fieldEditor(n.dataset.editField));
    modal.querySelectorAll('[data-remove-field]').forEach(n=>n.onclick=()=>{if(confirm('Xóa cột này khỏi hồ sơ khách hàng? Lịch sử thay đổi đã ghi vẫn được giữ.'))run(()=>api.removeField(n.dataset.removeField),()=>{data=api.snapshot();fieldManager();});});
  }
  function fieldEditor(id=null) {
    const f=data.fields.find(item=>item.id===id)||{label:'',type:'SELECT',options:[],notificationWebhookId:''};
    const fieldType=f.type==='NOTIFICATION'?'NOTIFICATION':f.type;
    const notificationWebhooks=(data.websites||[]).filter(website=>website.provider==='NOTIFICATION');
    const modal=editor(id?'Sửa cột khách hàng':'Thêm cột khách hàng',
      formField('Tên cột',`<input id="refFieldLabel" required maxlength="160" value="${esc(f.label)}">`)+
      formField('Kiểu dữ liệu',`<select id="refFieldType" ${id==='customerLevel'?'disabled':''}>${Object.entries({SELECT:'Chọn một',MULTI_SELECT:'Chọn nhiều',TEXT:'Nhập nội dung',NOTE:'Ghi chú',CHECKBOX:'Tích chọn',NOTIFICATION:'Nhận thông báo'}).map(([k,v])=>opt(k,v,fieldType)).join('')}</select>`)+
      formField('Webhook nhận thông báo',`<select id="refFieldNotificationWebhook">${opt('',notificationWebhooks.length?'— Chọn webhook —':'Chưa có webhook Thông Báo',f.notificationWebhookId)+notificationWebhooks.map(website=>opt(website.id,website.name, f.notificationWebhookId)).join('')}</select>`)+
      `<div id="refOptionsArea"><div id="refFieldOptions"></div><button type="button" class="btn-action btn-secondary" id="refAddOption">+ Thêm lựa chọn</button></div>`,
      ()=>api.saveField(id,{label:q('#refFieldLabel').value,type:q('#refFieldType').value,notificationWebhookId:q('#refFieldType').value==='NOTIFICATION'?q('#refFieldNotificationWebhook').value:'',options:qa('#refFieldOptions > div').map(row=>({value:row.dataset.value||row.querySelector('input').value,label:row.querySelector('input').value,color:row.querySelector('input[type=color]').value}))}));
    const add=o=>{const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:10px';row.dataset.value=o?.value||'';row.innerHTML=`<input aria-label="Tên lựa chọn" required maxlength="200" placeholder="Tên lựa chọn" value="${esc(o?.label||'')}" style="min-width:0;flex:1;padding:9px;border:1px solid var(--border);border-radius:6px"><input aria-label="Màu lựa chọn" type="color" value="${validColor(o?.color)}" style="width:40px;flex-shrink:0"><button type="button" class="btn-action btn-secondary">Xóa</button>`;row.querySelector('button').onclick=()=>row.remove();q('#refFieldOptions').appendChild(row);};
    (f.options||[]).forEach(add);q('#refAddOption').onclick=()=>add();
    const sync=()=>{const type=q('#refFieldType').value,show=['SELECT','MULTI_SELECT'].includes(type),notification=type==='NOTIFICATION',webhookField=q('#refFieldNotificationWebhook')?.closest('.form-group');q('#refOptionsArea').hidden=!show;q('#refOptionsArea').style.display=show?'':'none';qa('#refFieldOptions input').forEach(node=>node.disabled=!show);if(webhookField){webhookField.hidden=!notification;webhookField.style.setProperty('display',notification?'':'none','important');}q('#refFieldNotificationWebhook').required=notification;};
    q('#refFieldType').onchange=sync;sync();
  }
  let editingCareId=null;
  const defaultCareFallback=[
    {id:'g-conv',title:'Khách đã chuyển đổi',tag:'Premium Whale',color:'#10b981'},
    {id:'g-hot',title:'Khách đang quan tâm nóng',tag:'Nóng',color:'#ef4444'},
    {id:'g-warm',title:'Khách đang theo dõi ấm',tag:'Ấm',color:'#f59e0b'},
    {id:'g-cold',title:'Khách chưa kết nối được lạnh',tag:'Lạnh',color:'#3b82f6'}
  ];
  function defaultCareGroups(){
    const saved=new Map((data?.settings?.careDefaultGroups||[]).map(group=>[String(group.id),group]));
    const savedOrder=(data?.settings?.careDefaultGroups||[]).map(group=>String(group.id)).filter(id=>defaultCareFallback.some(group=>group.id===id));
    const order=[...new Set([...savedOrder,...defaultCareFallback.map(group=>group.id)])];
    return order.map(id=>{const group=defaultCareFallback.find(item=>item.id===id),stored=saved.get(id)||{};return {...group,...stored,id,active:stored.active!==false};});
  }
  function saveDefaultCareGroups(groups,notice='Đã cập nhật mục chăm sóc.'){
    return run(()=>api.settings({careDefaultGroups:groups.map(group=>({id:group.id,title:group.title,tag:group.tag,color:group.color,active:group.active!==false}))}),()=>referenceNotice(notice));
  }
  function openDefaultCareEditor(id){
    if(data.user.role!=='ADMIN')return;
    const group=defaultCareGroups().find(item=>item.id===id);if(!group)return;
    editor('Sửa mục chăm sóc mặc định',formField('Tên mục',`<input id="refDefaultCareTitle" maxlength="160" required value="${esc(group.title)}">`)+formField('Nhãn phân loại',`<input id="refDefaultCareTag" maxlength="100" required value="${esc(group.tag)}">`)+formField('Màu mục','<input id="refDefaultCareColor" type="color" value="'+validColor(group.color)+'" style="width:64px;height:36px">'),()=>{
      const next=defaultCareGroups().map(item=>item.id===id?{...item,title:q('#refDefaultCareTitle').value.trim(),tag:q('#refDefaultCareTag').value.trim(),color:q('#refDefaultCareColor').value}:item);
      return saveDefaultCareGroups(next,'Đã cập nhật mục chăm sóc.');
    });
  }
  function reorderDefaultCare(id,direction){
    if(data.user.role!=='ADMIN')return;
    const groups=defaultCareGroups(),index=groups.findIndex(group=>group.id===id),next=index+(direction==='up'?-1:1);if(index<0||next<0||next>=groups.length)return;
    [groups[index],groups[next]]=[groups[next],groups[index]];
    // The settings sanitizer preserves the canonical four IDs while this order
    // is applied to the rendered cards immediately below.
    const order=groups.map(group=>group.id),byId=new Map(groups.map(group=>[group.id,group]));
    saveDefaultCareGroups(order.map(groupId=>byId.get(groupId))).then(()=>{});
  }
  function deleteDefaultCare(id){
    if(data.user.role!=='ADMIN')return;
    const groups=defaultCareGroups().map(group=>group.id===id?{...group,active:false}:group);
    saveDefaultCareGroups(groups,'Đã ẩn mục chăm sóc.');
  }
  function addDefaultCareAdminControls(host,group,index,groups){
    if(data.user.role!=='ADMIN'||!host||host.querySelector('[data-default-care-admin-controls]'))return;
    const controls=document.createElement('span');controls.dataset.defaultCareAdminControls='1';controls.style.cssText='display:inline-flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0;';
    controls.append(careAdminButton('↑','Đưa mục lên',()=>reorderDefaultCare(group.id,'up'),index===0),careAdminButton('↓','Đưa mục xuống',()=>reorderDefaultCare(group.id,'down'),index===groups.length-1),careAdminButton('Sửa','Sửa mục chăm sóc',()=>openDefaultCareEditor(group.id)),careAdminButton('Xóa','Ẩn mục chăm sóc',()=>{if(confirm('Ẩn mục chăm sóc này? Dữ liệu khách hàng vẫn được giữ nguyên.'))deleteDefaultCare(group.id);},false,true));
    host.appendChild(controls);
  }
  function applyDefaultCareGroups(){
    const groups=defaultCareGroups(),active=groups.filter(group=>group.active!==false),grid=q('#tab-care .analytics-grid'),cards=qa('#tab-care .analytics-grid>div');if(!grid)return;
    cards.slice(0,4).forEach((card,index)=>{if(!card.dataset.careGroup)card.dataset.careGroup=defaultCareFallback[index].id;});
    const cardById=new Map(cards.slice(0,4).map(card=>[card.dataset.careGroup,card]));
    active.forEach((group,index)=>{const card=cardById.get(group.id);if(!card)return;card.hidden=false;card.dataset.careGroup=group.id;card.style.borderTopColor=validColor(group.color);const title=card.querySelector(':scope > div:first-child > span:first-child');if(title)title.textContent=group.title;const tag=card.querySelector(':scope > div:last-child span');if(tag)tag.textContent=group.tag;addDefaultCareAdminControls(card.querySelector(':scope > div:first-child'),group,index,active);grid.appendChild(card);});
    groups.filter(group=>group.active===false).forEach(group=>{const card=cardById.get(group.id);if(card){card.hidden=true;card.dataset.careGroup=group.id;}});

    // Giữ phần danh sách chi tiết bên dưới khớp với 4 ô thống kê: cùng tên,
    // màu, trạng thái hiển thị và thứ tự sau khi Admin chỉnh sửa.
    const panelContainer=q('#carePanelsContainer');
    if(!panelContainer)return;
    const panels=new Map(qa('#carePanelsContainer > [data-care-group]').map(panel=>[panel.dataset.careGroup,panel]));
    active.forEach(group=>{
      const panel=panels.get(group.id);if(!panel)return;
      panel.hidden=false;
      panel.style.borderTopColor=validColor(group.color);
      const title=panel.querySelector('[data-care-toggle] > div:first-child > span:first-child');
      if(title)title.textContent=group.title;
      const tag=panel.querySelector('[data-care-toggle] > div:first-child .chip');
      if(tag){tag.textContent=group.tag;tag.style.color=validColor(group.color);tag.style.background=`${validColor(group.color)}15`;}
      panelContainer.appendChild(panel);
    });
    groups.filter(group=>group.active===false).forEach(group=>{const panel=panels.get(group.id);if(panel)panel.hidden=true;});
  }
  function openCareEditor(id=null) {
    if(data.user.role!=='ADMIN')return;editingCareId=id;
    const group=data.careGroups.find(g=>g.id===id),modal=q('#careGroupModal');
    q('#careGroupFieldSelect').innerHTML=data.fields.filter(f=>f.active!==false&&['SELECT','MULTI_SELECT'].includes(f.type)).map(f=>opt(f.id,f.label,group?.fieldId||'customerClass')).join('');
    q('#careGroupNameInput').value=group?.name||'';modal.querySelector('h3').textContent=id?'Sua muc cham soc':'Tao muc cham soc';
    if(!q('#refCareColor'))q('#careGroupNameInput').parentElement.insertAdjacentHTML('afterend',formField('Mau muc','<input id="refCareColor" type="color" value="#2563eb" style="width:64px;height:36px">'));
    q('#refCareColor').value=validColor(group?.color||'#2563eb');updateCareGroupOptions();qa('.care-value-checkbox').forEach(n=>n.checked=group?.values.includes(n.value)||false);updateCareSelectionSummary();
    modal.style.display='flex';modal.classList.add('open');modal.firstElementChild.style.maxHeight='92dvh';modal.firstElementChild.style.overflowY='auto';q('#careGroupNameInput').focus();
  }
  function careAdminButton(label,title,action,disabled=false,danger=false){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.className='btn-secondary';button.disabled=disabled;
    button.style.cssText='padding:4px 8px;font-size:11px;line-height:1;border-radius:6px;min-width:28px;'+(danger?'color:#b91c1c;border-color:#fecaca;background:#fef2f2;':'');
    button.onclick=event=>{event.preventDefault();event.stopPropagation();action();};return button;
  }
  function reorderCareGroup(id,direction){
    if(data.user.role!=='ADMIN')return;
    const groups=data.careGroups||[],index=groups.findIndex(group=>group.id===id),next=index+(direction==='up'?-1:1);if(index<0||next<0||next>=groups.length)return;
    const ids=groups.map(group=>group.id);[ids[index],ids[next]]=[ids[next],ids[index]];
    run(()=>api.reorderCare(ids),()=>referenceNotice('Đã cập nhật thứ tự mục chăm sóc.'));
  }
  function addCareAdminControls(host,group,index){
    if(data.user.role!=='ADMIN'||host.querySelector('[data-care-admin-controls]'))return;
    const controls=document.createElement('span');controls.dataset.careAdminControls='1';controls.style.cssText='display:inline-flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0;';
    controls.append(careAdminButton('↑','Đưa mục lên',()=>reorderCareGroup(group.id,'up'),index===0),careAdminButton('↓','Đưa mục xuống',()=>reorderCareGroup(group.id,'down'),index===data.careGroups.length-1),careAdminButton('Sửa','Sửa mục chăm sóc',()=>openCareEditor(group.id)),careAdminButton('Xóa','Xóa mục chăm sóc',()=>{if(confirm('Xóa mục chăm sóc? Khách hàng vẫn được giữ nguyên.'))run(()=>api.removeCare(group.id),()=>referenceNotice('Đã xóa mục chăm sóc.'));},false,true));
    host.appendChild(controls);
  }
  function decorateCare(){
    qa('#carePanelsContainer > div').slice(4).forEach((panel,i)=>{const group=data.careGroups[i];if(!group)return;const bar=panel.firstElementChild.lastElementChild;addCareAdminControls(bar,group,i);panel.firstElementChild.style.borderLeft='4px solid '+validColor(group.color);});
  }
  const websiteCard=q('#tab-websites input[readonly]')?.closest('.widget-box'),websiteTemplate=websiteCard?.cloneNode(true),websiteContainer=websiteCard?.parentElement;
  function websiteSalePicker(w){
    const ids=new Set(w.designatedSaleIds||[]),roleLabel={MANAGER:'Manager',LEADER:'Leader',SALE:'Sale'},sales=data.members.filter(p=>['SALE','LEADER','MANAGER'].includes(p.role)).sort((a,b)=>(a.name||'').localeCompare(b.name||'','vi'));
    const options=sales.map(p=>`<label class="webhook-sale-option" data-sale-search="${esc([p.name,roleLabel[p.role],p.accountId,p.teamId,p.phone].filter(Boolean).join(' ').toLocaleLowerCase('vi'))}"><input type="checkbox" data-webhook-sale="${esc(p.id)}" ${ids.has(p.id)?'checked':''} ${p.active===false?'disabled':''}><span><b>${esc(p.name)}</b><small>${esc([roleLabel[p.role]||p.role,p.accountId||p.id,p.teamId,p.active===false?'Ngừng hoạt động':null].filter(Boolean).join(' · '))}</small></span></label>`).join('');
    return `<section class="webhook-sale-routing">
      <div class="webhook-routing-head"><b>Cách chia data</b><small>Chọn cách phân data đến từ link webhook này.</small></div>
      <div id="refRoutingState" class="webhook-route-state ${w.designatedSalesEnabled?'is-designated':''}"></div>
      <label class="webhook-route-toggle"><input id="refDesignatedSales" type="checkbox" ${w.designatedSalesEnabled?'checked':''}><span class="webhook-route-switch" aria-hidden="true"></span><span class="webhook-route-toggle-text"><b>Chia đều cho người được chọn</b></span></label>
      <div id="refDesignatedSalePanel" ${w.designatedSalesEnabled?'':'hidden'}>
        <input id="refSaleSearch" type="search" placeholder="Tìm Sale theo tên, mã hoặc team…" aria-label="Tìm Sale">
        <div class="webhook-sale-toolbar"><span id="refSaleSelectedCount"></span><button type="button" class="btn-action btn-secondary" id="refSelectAllSales">Chọn tất cả</button></div>
        <div class="webhook-sale-list">${options||'<p class="webhook-routing-hint">Chưa có người nhận phù hợp. Thêm Sale/Leader/Manager tại mục Đội ngũ.</p>'}</div>
        <p id="refSaleSearchEmpty" class="webhook-routing-hint" hidden>Không tìm thấy người nhận phù hợp.</p>
      </div>
    </section>`;
  }
  function bindWebsiteSalePicker(modal,provider){
    const toggle=modal.querySelector('#refDesignatedSales'),panel=modal.querySelector('#refDesignatedSalePanel'),state=modal.querySelector('#refRoutingState');
    const controls=()=>[...modal.querySelectorAll('[data-webhook-sale]')];
    const selected=()=>controls().filter(p=>p.checked&&!p.disabled).length;
    const render=()=>{
      const n=selected();
      modal.querySelector('#refSaleSelectedCount').textContent=`Đã chọn ${n} người nhận`;
      const on=toggle.checked;
      state.classList.toggle('is-designated',on);
      state.innerHTML=on
        ?`<span class="webhook-route-dot"></span><div><b>Chia đều · ${n} người nhận</b></div>`
        :`<span class="webhook-route-dot"></span><div><b>Vòng tỷ trọng hệ thống</b></div>`;
    };
    const update=()=>{const notification=provider?.value==='NOTIFICATION';toggle.closest('section').hidden=notification;panel.hidden=!toggle.checked;render();};
    toggle.onchange=update;if(provider)provider.addEventListener('change',update);
    controls().forEach(p=>p.onchange=render);
    modal.querySelector('#refSelectAllSales').onclick=()=>{const inputs=controls().filter(p=>!p.disabled&&!p.closest('label').hidden),all=inputs.length&&inputs.every(p=>p.checked);inputs.forEach(p=>p.checked=!all);render();};
    modal.querySelector('#refSaleSearch').oninput=e=>{const term=e.target.value.trim().toLocaleLowerCase('vi');controls().forEach(p=>p.closest('label').hidden=!p.closest('label').dataset.saleSearch.includes(term));modal.querySelector('#refSaleSearchEmpty').hidden=controls().some(p=>!p.closest('label').hidden);};
    update();
  }
  function websiteSalePickerValue(){return {designatedSalesEnabled:q('#refDesignatedSales').checked,designatedSaleIds:qa('[data-webhook-sale]').filter(p=>p.checked&&!p.disabled).map(p=>p.dataset.webhookSale)};}
  function websiteEditor(id=null) {
    if(data.user.role!=='ADMIN')return;const w=data.websites.find(w=>w.id===id)||{name:'',sourceUrl:'',provider:'LANDING_API'};
    const modal=editor(id?'Sửa website / landing page':'Thêm website / landing page',formField('Tên tài sản',`<input id="refWebsiteName" required maxlength="200" value="${esc(w.name)}">`)+formField('URL nguồn / Landing page',`<input id="refWebsiteUrl" type="url" required maxlength="500" placeholder="https://www.hoangphucacademy.vn/" value="${esc(w.sourceUrl)}">`)+formField('Nguồn nhận data',`<select id="refWebsiteProvider">${Object.entries({LANDING_API:'Landing API',NOTIFICATION:'Thông Báo'}).map(([k,v])=>opt(k,v,w.provider)).join('')}</select>`)+websiteSalePicker(w),()=>api.saveWebsite(id,{name:q('#refWebsiteName').value,sourceUrl:q('#refWebsiteUrl').value,provider:q('#refWebsiteProvider').value,...websiteSalePickerValue()}));
    bindWebsiteSalePicker(modal,q('#refWebsiteProvider'));
  }
  function pendingSources() {
    const items=data.webhookPending||[];
    const modal=editor('Data chờ quy nguồn',items.length?items.map(r=>'<div data-pending-id="'+esc(r.id)+'" style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px"><b>'+esc(r.customer?.name||'Chưa có tên')+'</b><p>'+esc(r.customer?.phone||'')+' · '+esc(r.reason||'Chưa gắn nguồn')+'</p><div class="form-group"><select aria-label="Chọn website">'+data.websites.map(w=>opt(w.id,w.name)).join('')+'</select></div><button type="button" class="btn-action btn-primary" style="margin-top:10px">Quy nguồn</button></div>').join(''):'<p>Không có data chờ quy nguồn.</p>');
    modal.querySelectorAll('[data-pending-id]').forEach(row=>row.querySelector('button').onclick=()=>run(()=>api.resolveSource(row.dataset.pendingId,row.querySelector('select').value),()=>{data=api.snapshot();pendingSources();}));
  }
  function websites() {
    if(!websiteContainer||!websiteTemplate)return;websiteContainer.replaceChildren();
    const sourceFilter=q('#funnelLpSelect'),previous=sourceFilter?.value;if(sourceFilter){sourceFilter.innerHTML=opt('all','Tất cả Landing page',previous)+data.websites.map(w=>opt(w.id,w.name,previous)).join('');renderFunnelChart();}
    data.websites.forEach(w=>{const card=websiteTemplate.cloneNode(true),pool=data.customers.filter(c=>c.websiteId===w.id);card.dataset.websiteId=w.id;
      card.querySelector('b').textContent=w.name;const details=card.firstElementChild.firstElementChild.lastElementChild;details.textContent=w.sourceUrl+' · '+w.provider;details.style.overflowWrap='anywhere';
      card.querySelector('.chip')?.remove();
      if(w.provider!=='NOTIFICATION'){const routing=document.createElement('div');routing.className='webhook-routing-summary'+(w.designatedSalesEnabled?' is-designated':'');routing.textContent=w.designatedSalesEnabled?'Chia đều · '+(w.designatedSaleIds||[]).map(id=>data.members.find(p=>p.id===id)?.name||id).join(', '):'Vòng tỷ trọng hệ thống';details.after(routing);}
      card.children[1].querySelectorAll('b').forEach((n,i)=>n.textContent=i?pool.length:pool.filter(c=>c.createdAt?.slice(0,10)===data.today).length);
      const remove=card.querySelector('button');remove.removeAttribute('onclick');remove.disabled=data.user.role!=='ADMIN';remove.onclick=()=>{if(confirm('Xóa website chưa có dữ liệu này?'))run(()=>api.removeWebsite(w.id));};
      const edit=remove.cloneNode(true);edit.textContent='Sửa website / URL';edit.style.color='var(--text-main)';edit.style.marginRight='8px';edit.onclick=()=>websiteEditor(w.id);remove.before(edit);const config=edit.cloneNode(true);config.textContent='Cấu hình webhook';config.onclick=()=>webhookEditor(w.id);remove.before(config);
      const input=card.querySelector('input');input.value=w.publicWebhookUrl||'';input.onclick=async()=>{input.select();try{await navigator.clipboard.writeText(input.value);}catch{document.execCommand('copy');}};
      websiteContainer.appendChild(card);
    });
    const add=q('#tab-websites .headline-row button');if(add){add.removeAttribute('onclick');add.onclick=()=>websiteEditor();add.disabled=data.user.role!=='ADMIN';}
    qa('#tab-websites button').filter(b=>b.textContent.trim()==='Đồng bộ ngay').forEach(b=>{b.removeAttribute('onclick');b.onclick=()=>run(()=>api.syncWebsites());});
    const banner=q('#tab-websites .widget-box');
    if(banner&&!banner.dataset.websiteId){primaryText(banner.firstElementChild.lastElementChild,data.webhookTransport?.label||'Chưa kết nối');banner.children[1].textContent=data.webhookTransport?.detail||'Chưa có thông tin đồng bộ.';const pendingButton=banner.querySelectorAll('button')[1];if(pendingButton){pendingButton.textContent='Data chờ quy nguồn ('+(data.webhookPending||[]).length+')';pendingButton.onclick=pendingSources;}}
    const total=data.customers.length,newCount=data.customers.filter(c=>!c.saleId).length;
    const kpi=q('#tab-websites .analytics-grid');if(kpi){const chip=kpi.querySelector('.chip');if(chip)chip.textContent='+'+data.customers.filter(c=>c.createdAt?.slice(0,10)===data.today).length+' hôm nay';const waiting=kpi.querySelector('[style*="font-size: 32px"] span');if(waiting)waiting.textContent='/ '+newCount+' chờ Sale';if(kpi.children[1])kpi.children[1].firstElementChild.lastElementChild.textContent='Khách chưa phân Sale';}
    qa('#tab-websites .analytics-grid').at(0)?.querySelectorAll('[style*="font-size: 32px"]').forEach((n,i)=>primaryText(n,String([total,newCount,total-newCount][i])));
  }
  function bindReferenceDeleteButtons() {
    const isAdmin=(data?.user?.actualRole||data?.user?.role)==='ADMIN';
    qa('[data-delete-customer]').forEach(button=>{
      button.hidden=!isAdmin;
      if(!isAdmin)return;
      button.onclick=()=>{
        if(!confirm('Xóa data này? Dữ liệu sẽ được lưu lịch sử và không hiển thị lại.'))return;
        const customer=data?.customers.find(item=>item.id===button.dataset.deleteCustomer),name=customer?.name||'data';
        run(()=>api.deleteCustomer(button.dataset.deleteCustomer),()=>referenceNotice('Đã xóa data '+name+' thành công.'));
      };
    });
  }

  let closeCustomerColumnMenu=()=>{};
  function prepareCustomerColumnFilters(){
    if(customerFilterState.sale && customerFilterState.sale!=='ALL' && customerFilterState.columns.sale===undefined)customerFilterState.columns.sale=customerFilterState.sale;
    customerFilterState.sale='ALL';
    const raw=new Map(data.customers.map(customer=>[customer.id,customer]));
    const value=(key)=>customer=>raw.get(customer.id)?.[key];
    const staffLabel=id=>data.members.find(member=>String(member.id)===String(id))?.name||id||'Chưa phân công';
    const activeFields=data.fields.filter(field=>field.active!==false);
    const isNoteField=field=>field.type==='NOTE'||String(field.label||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()==='ghi chu';
    const fieldColumn=field=>{const noteField=isNoteField(field);return {key:'field:'+field.id,label:field.label,presenceFilter:noteField,value:customer=>{const fieldValue=raw.get(customer.id)?.customFields?.[field.id];return noteField?(String(fieldValue||'').trim()?'HAS_CONTENT':'EMPTY'):fieldValue;},labelFor:filterValue=>noteField?(filterValue==='HAS_CONTENT'?'Có ghi chú':'Không ghi chú'):field.type==='CHECKBOX'?(filterValue==='true'?'Có':filterValue==='false'?'Không':'Trống'):(field.options||[]).find(option=>String(option.value)===filterValue)?.label||filterValue||'Trống'};};
    customerColumnDefinitions=[
      ...((data.user.actualRole||data.user.role)==='ADMIN'?[{key:'source',label:'Nguồn / Landing Page',value:customer=>{const row=raw.get(customer.id);return data.websites.find(site=>site.id===row?.websiteId)?.name||row?.landingPageName||row?.source;}}]:[]),
      {key:'leader',label:'Team / Leader',value:customer=>{const row=raw.get(customer.id);return row?.leaderId||row?.managerId||'';},labelFor:staffLabel},
      {key:'sale',label:'Sale phụ trách',value:customer=>assignedSaleIdForCustomer(customer),labelFor:id=>{const member=data.members.find(item=>String(item.id)===String(id));return member?`${member.name||'Chưa đặt tên'} · ${member.accountId||member.phone||member.id}`:(id||'Chưa phân công');}},
      ...activeFields.filter(field=>baseFields.includes(field.id)||field.showInTable).map(fieldColumn),
      {key:'status',label:'Trạng thái',value:value('status'),labelFor:value=>({NEW:'Data mới',CONTACTED:'Đã liên hệ',PAID:'Đã thanh toán',ARCHIVED:'Đã lưu trữ'}[value]||value||'Trống')},
      {key:'referenceAmount',label:'Dữ liệu khách tham khảo',value:customer=>{const row=raw.get(customer.id);return row?.referenceAmount??row?.customFields?.referenceAmount??row?.customFields?.customerReferenceAmount;}}
    ];
    const keys=new Set(customerColumnDefinitions.map(column=>column.key));
    Object.keys(customerFilterState.columns).forEach(key=>{if(!keys.has(key))delete customerFilterState.columns[key];});
  }
  function installCustomerColumnFilters(head){
    head.querySelectorAll('[data-column-filter]').forEach(button=>button.remove());
    head.querySelectorAll('[data-customer-filter-key]').forEach(cell=>delete cell.dataset.customerFilterKey);
    const setFilterKey=(cell,key)=>{if(!cell)return;cell.dataset ||= {};cell.dataset.customerFilterKey=key;};
    [['source',3],['leader',4],['sale',5]].forEach(([key,index])=>setFilterKey(head.cells[index],key));
    baseFields.forEach((id,index)=>{const cell=head.cells[6+index];if(cell&&!cell.hidden)setFilterKey(cell,'field:'+id);});
    head.querySelectorAll('[data-extra-field]').forEach(cell=>setFilterKey(cell,'field:'+cell.dataset.extraField));
    const statusCell=head.cells[head.cells.length-4],noteCell=head.cells[head.cells.length-3],referenceCell=head.cells[head.cells.length-2];
    setFilterKey(statusCell,'status');
    setFilterKey(noteCell,'note');
    setFilterKey(referenceCell,'referenceAmount');
    Array.from(head.cells).forEach(cell=>{
      const resolvedKey=cell.dataset?.customerFilterKey,column=customerColumnDefinitions.find(item=>item.key===resolvedKey);
      if(!column||cell.hidden)return;
      const selected=customerFilterState.columns[resolvedKey],button=document.createElement('button');
      button.type='button';button.dataset.columnFilter=resolvedKey;button.textContent='\u25be';
      button.className='customer-column-filter'+(selected!==undefined?' is-active':'');
      button.setAttribute('aria-label','L\u1ecdc '+column.label);button.setAttribute('aria-expanded','false');
      button.title=selected===undefined?'L\u1ecdc '+column.label:'\u0110ang l\u1ecdc: '+(column.labelFor?.(selected)||selected||'Tr\u1ed1ng');
      button.onclick=event=>{event.stopPropagation();openCustomerColumnMenu(button,column);};cell.appendChild(button);
    });
  }
  function orderCustomerColumnFilterValues(column,values,label){
    const empty=value=>value===undefined||value===null||value==='';
    const fallback=(a,b)=>label(a).localeCompare(label(b),'vi',{numeric:true});
    if(column.key!=='field:customerLevel')return values.slice().sort(fallback);
    const positions=new Map(fieldOptions('customerLevel').map((option,index)=>[String(option.value),index]));
    return values.slice().sort((a,b)=>{
      if(empty(a)||empty(b))return empty(a)===empty(b)?0:(empty(a)?-1:1);
      const left=positions.get(String(a)),right=positions.get(String(b));
      if(left!==undefined||right!==undefined){
        if(left===undefined)return 1;
        if(right===undefined)return -1;
        return left-right;
      }
      return fallback(a,b);
    });
  }
  function openCustomerColumnMenu(button,column){
    closeCustomerColumnMenu();
    const popup=document.createElement('div');popup.className='customer-column-menu';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Lọc '+column.label);
    popup.innerHTML='<div class="customer-column-menu-title"></div><input type="search" placeholder="Tìm giá trị…" aria-label="Tìm giá trị lọc"><div class="customer-column-options"></div>';
    popup.querySelector('.customer-column-menu-title').textContent=column.label;
    document.body.appendChild(popup);button.setAttribute('aria-expanded','true');
    const rect=button.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(rect.right-280,window.innerWidth-288))+'px';
    if(rect.bottom+380>window.innerHeight&&rect.top>380)popup.style.bottom=(window.innerHeight-rect.top+6)+'px';else popup.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-380))+'px';
    const label=value=>String(column.labelFor?.(value)||value||'Trống');
    const counts=new Map();appState.customers.forEach(customer=>new Set(customerColumnValues(column.value(customer))).forEach(value=>counts.set(value,(counts.get(value)||0)+1)));
    const values=column.presenceFilter?['HAS_CONTENT','EMPTY']:orderCustomerColumnFilterValues(column,[...counts.keys()],label);
    const search=popup.querySelector('input'),list=popup.querySelector('.customer-column-options');
    if(column.presenceFilter)search.hidden=true;
    const draw=()=>{
      list.replaceChildren();
      const add=(value,text)=>{const item=document.createElement('button');item.type='button';item.textContent=text;item.setAttribute('aria-pressed',String(customerFilterState.columns[column.key]===value));item.onclick=()=>{if(value===undefined)delete customerFilterState.columns[column.key];else customerFilterState.columns[column.key]=value;closeCustomerColumnMenu();customerPage=1;renderCustomerTable();};list.appendChild(item);};
      add(undefined,'Tất cả · Xóa lọc cột này');
      const query=search.value.trim().toLocaleLowerCase('vi');
      const filtered=values.filter(value=>label(value).toLocaleLowerCase('vi').includes(query));
      filtered.forEach(value=>add(value,label(value)+' ('+(counts.get(value)||0)+')'));
      if(!filtered.length){const empty=document.createElement('p');empty.textContent='Không có giá trị phù hợp';list.appendChild(empty);}
    };
    const outside=event=>{if(!popup.contains(event.target)&&event.target!==button)closeCustomerColumnMenu();};
    const keydown=event=>{if(event.key==='Escape'){closeCustomerColumnMenu();button.focus();}};
    const scroll=event=>{if(!popup.contains(event.target))closeCustomerColumnMenu();};
    closeCustomerColumnMenu=()=>{popup.remove();button.setAttribute('aria-expanded','false');document.removeEventListener('click',outside);document.removeEventListener('keydown',keydown);window.removeEventListener('resize',closeCustomerColumnMenu);window.removeEventListener('scroll',scroll,true);closeCustomerColumnMenu=()=>{};};
    document.addEventListener('click',outside);document.addEventListener('keydown',keydown);window.addEventListener('resize',closeCustomerColumnMenu);window.addEventListener('scroll',scroll,true);
    search.oninput=draw;draw();search.focus();
  }
  const columnFilterStyle=document.createElement('style');
  columnFilterStyle.textContent='.customer-column-filter{margin-left:6px;width:20px;height:20px;border:0;border-radius:5px;background:#eaf2ff;color:#2563eb;cursor:pointer}.customer-column-filter.is-active{background:#2563eb;color:white}.customer-column-menu{position:fixed;z-index:2147483647;width:280px;max-width:calc(100vw - 16px);max-height:370px;display:flex;flex-direction:column;padding:10px;box-sizing:border-box;border:1px solid #dbe3ec;border-radius:12px;background:var(--bg-surface,#fff);color:var(--text-main,#0f172a);box-shadow:0 12px 32px #0f172a24;font-size:12px}.customer-column-menu-title{font-weight:700;padding:4px 4px 10px}.customer-column-menu input{width:100%;box-sizing:border-box;padding:9px 10px;margin-bottom:8px;border:1px solid #dbe3ec;border-radius:7px;background:var(--bg-surface,#fff);color:inherit}.customer-column-options{overflow:auto;min-height:0;max-height:280px}.customer-column-options button{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;text-align:left;background:transparent;color:inherit;cursor:pointer;overflow-wrap:anywhere;font:inherit}.customer-column-options button:hover,.customer-column-options button[aria-pressed=true]{background:#eff6ff;color:#1d4ed8}.customer-column-options p{padding:8px;color:#64748b}';
  document.head.appendChild(columnFilterStyle);
  function syncCustomerOwnerFilter(){
    const select=q('#custOwnerFilter');
    if(!select||!data)return;
    const role=data.user?.actualRole||data.user?.role,currentId=data.user.id,active=m=>m&&m.active!==false&&m.active!==0&&m.active!=='0',all=(data.members||[]).filter(active);
    const leaders=role==='ADMIN'?all.filter(m=>m.role==='LEADER'):role==='MANAGER'?all.filter(m=>m.role==='LEADER'&&m.managerId===currentId):role==='LEADER'?all.filter(m=>m.role==='LEADER'&&m.id===currentId):[];
    const leaderIds=new Set(leaders.map(m=>m.id));
    const managers=role==='ADMIN'?all.filter(m=>m.role==='MANAGER'):role==='MANAGER'?all.filter(m=>m.role==='MANAGER'&&m.id===currentId):[];
    if(role==='MANAGER'&&!managers.some(m=>m.id===currentId)&&data.user?.role==='MANAGER')managers.push({...data.user,role:'MANAGER',active:true});
    const sales=all.filter(m=>m.role==='SALE'&&(role==='ADMIN'||role==='MANAGER'&&(m.managerId===currentId||m.leaderId===currentId||leaderIds.has(m.leaderId))||role==='LEADER'&&leaderIds.has(m.leaderId)||role==='SALE'&&m.id===currentId));
    const previous=customerFilterState.owner||select.value||'ALL';
    const option=(value,label)=>'<option value="'+esc(value)+'">'+esc(label)+'</option>';
    const group=(label,items)=>items.length?'<optgroup label="'+esc(label)+'">'+items.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'vi')).map(m=>option(m.id,(m.name||'Chua dat ten')+' - '+(m.accountId||m.phone||m.id))).join('')+'</optgroup>':'';
    select.innerHTML=option('ALL','Tất cả nhân sự trong phạm vi')+option('UNASSIGNED','Chưa có người phụ trách')+group('Manager',managers)+group('Leader',leaders)+group('Sale',sales);
    customerFilterState.owner=[...select.options].some(item=>item.value===previous)?previous:'ALL';
    select.value=customerFilterState.owner;
    select.onchange=event=>{customerFilterState.owner=event.target.value||'ALL';customerPage=1;renderCustomerTable();};
  }
  renderCustomerTable=function(){
    if(!data)return;
    // Lưu cả cuộn ngang của bảng và cuộn dọc của trang trước khi thay các dòng.
    const parents=[];for(let node=q('#customerTableBody')?.parentElement;node;node=node.parentElement)parents.push([node,node.scrollLeft,node.scrollTop]);
    prepareCustomerColumnFilters();syncCustomerOwnerFilter();renders.customers();fillCustomerOptions();window.crmMobile?.prepareCustomerTable();dashboard();
    parents.forEach(([node,left,top])=>{node.scrollLeft=left;node.scrollTop=top;});
    bindReferenceDeleteButtons();
  };
  if(!q('#referenceCustomerFilterStyles')){const style=document.createElement('style');style.id='referenceCustomerFilterStyles';style.textContent='#tab-customers .table-head-bar{display:flex!important;align-items:center!important;gap:12px!important;padding:12px 14px!important;background:#f8fafc!important;border-bottom:1px solid #e2e8f0!important}#tab-customers .table-head-bar>div:first-child{display:grid!important;grid-template-columns:minmax(220px,1.4fr) repeat(3,minmax(148px,.7fr))!important;gap:8px!important;align-items:center!important;min-width:0!important}#tab-customers #custSearchInput,#tab-customers #custStatusFilter,#tab-customers #custAssignFilter,#tab-customers #custOwnerFilter{width:100%!important;min-width:0!important;height:36px!important;border:1px solid #d7e0ea!important;border-radius:8px!important;background:#fff!important;color:#0f172a!important;box-shadow:0 1px 2px rgba(15,23,42,.03)!important;box-sizing:border-box!important}#tab-customers #custSearchInput{padding:0 12px!important;outline:none!important}#tab-customers #custSearchInput:focus,#tab-customers #custStatusFilter:focus,#tab-customers #custAssignFilter:focus,#tab-customers #custOwnerFilter:focus{border-color:#60a5fa!important;box-shadow:0 0 0 3px rgba(37,99,235,.1)!important}#tab-customers .table-head-bar>div:last-child{flex:0 0 auto!important;white-space:nowrap!important;padding:7px 10px!important;border:1px solid #dbe4ee!important;border-radius:8px!important;background:#fff!important;font-size:11.5px!important}#tab-customers .modern-table thead th{height:42px!important;padding:0 12px!important;white-space:nowrap!important;letter-spacing:.035em!important;font-size:10.5px!important}@media(max-width:1100px){#tab-customers .table-head-bar{align-items:stretch!important;flex-direction:column!important}#tab-customers .table-head-bar>div:first-child{grid-template-columns:minmax(220px,1fr) repeat(3,minmax(140px,1fr))!important;width:100%!important}#tab-customers .table-head-bar>div:last-child{align-self:flex-start!important}}@media(max-width:700px){#tab-customers .table-head-bar>div:first-child{grid-template-columns:1fr 1fr!important}#tab-customers #custSearchInput{grid-column:1/-1!important}}';document.head.appendChild(style);}
  if(!q('#referenceCareCompactStyles')){const style=document.createElement('style');style.id='referenceCareCompactStyles';style.textContent=`
    #tab-care .analytics-grid{grid-template-columns:1fr!important;gap:8px!important;margin-bottom:14px!important;align-items:stretch!important}
    #tab-care .analytics-grid>div{display:grid!important;grid-template-columns:minmax(0,1.6fr) auto minmax(190px,.8fr)!important;align-items:center!important;column-gap:18px!important;min-width:0!important;min-height:68px!important;padding:11px 16px!important;border-radius:9px!important;box-shadow:0 2px 8px rgba(15,23,42,.04)!important;box-sizing:border-box!important}
    #tab-care .analytics-grid>div>div:first-child{min-width:0!important;margin:0!important}
    #tab-care .analytics-grid>div>div:nth-child(2){margin:0!important;line-height:1!important}
    #tab-care .analytics-grid>div>div:nth-child(3){margin:0!important;text-align:right!important;white-space:nowrap!important}
    #tab-care .analytics-grid>div>div:first-child>span:first-child{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    #tab-care .analytics-grid>div:hover{transform:translateY(-1px);box-shadow:0 7px 16px rgba(15,23,42,.08)!important}
    #carePanelsContainer{gap:9px!important}
    #carePanelsContainer>[data-care-group][hidden]{display:none!important}
    #carePanelsContainer>[data-care-group] [data-care-list][hidden]{display:none!important}
    #carePanelsContainer>[data-care-group] [data-care-toggle]{transition:background .15s ease,border-color .15s ease}
    #carePanelsContainer>[data-care-group] [data-care-toggle]:hover{background:#f8fbff!important}
    #carePanelsContainer>[data-care-group].is-open{border-color:#93c5fd!important;box-shadow:0 5px 16px rgba(37,99,235,.08)!important}
    #carePanelsContainer>[data-care-group].is-open [data-care-toggle]{background:#eff6ff!important;border-bottom-color:#bfdbfe!important}
    #carePanelsContainer>[data-care-group] [data-care-chevron]{transition:transform .15s ease,background .15s ease}
    #carePanelsContainer>[data-care-group].is-open [data-care-chevron]{transform:rotate(180deg);background:#dbeafe;color:#1d4ed8!important}
    @media(max-width:640px){#tab-care .analytics-grid>div{grid-template-columns:minmax(0,1fr) auto!important;column-gap:10px!important;min-height:62px!important;padding:10px 12px!important}#tab-care .analytics-grid>div>div:nth-child(3){grid-column:1/-1;text-align:left!important;white-space:normal!important;font-size:10.5px!important;margin-top:-2px!important}}
  `;document.head.appendChild(style);}
  function renderCustomCareCards(){
    const grid=q('#tab-care .analytics-grid');if(!grid||!data)return;qa('[data-custom-care-card]').forEach(card=>card.remove());
    const groups=data.careGroups||[];groups.forEach((group,index)=>{
      const list=data.customers.filter(customer=>{const values=customer.customFields?.[group.fieldId];return [].concat(values||'').some(value=>(group.values||[]).includes(value));});
      const card=document.createElement('div');card.dataset.customCareCard='1';card.dataset.careGroup=group.id;card.style.cssText='background:var(--bg-surface);border:1px solid var(--border);border-top:3px solid '+validColor(group.color||'#64748b')+';border-radius:10px;padding:16px 18px;box-shadow:var(--shadow-sm);cursor:pointer;';
      card.innerHTML='<div data-care-card-head style="display:flex;align-items:flex-start;gap:8px"><span style="font-size:13px;font-weight:600;color:var(--text-main);min-width:0"></span><span style="color:'+validColor(group.color||'#64748b')+';font-size:15px">●</span></div><div style="font-size:30px;font-weight:800;font-family:var(--font-mono);color:var(--text-main);margin:6px 0 2px"></div><div style="font-size:11px;color:var(--text-muted)"></div>';
      card.querySelector('span').textContent=group.name||'Mục chăm sóc';card.querySelectorAll('div')[1].textContent=String(list.length);card.querySelectorAll('div')[2].textContent='Phân loại: '+(group.values||[]).join(', ');
      addCareAdminControls(card.querySelector('[data-care-card-head]'),group,index);grid.appendChild(card);
    });
  }
  function mountInlineCareLists(){
    const grid=q('#tab-care .analytics-grid'),container=q('#carePanelsContainer');
    if(!grid||!container)return;
    qa('[data-care-inline-list]').forEach(list=>list.remove());
    const defaultKeys=defaultCareGroups().map(group=>group.id);
    qa('#tab-care .analytics-grid>div').forEach((card,index)=>{if(!card.dataset.careGroup&&defaultKeys[index])card.dataset.careGroup=defaultKeys[index];});
    const panels=new Map(qa('#carePanelsContainer>[data-care-group]').map(panel=>[panel.dataset.careGroup,panel]));
    qa('#carePanelsContainer>[data-care-group]').forEach(panel=>{panel.hidden=true;});
    qa('#tab-care .analytics-grid>div[data-care-group]').forEach(card=>{
      const key=card.dataset.careGroup,panel=panels.get(key),list=panel?.querySelector('[data-care-list]');
      if(!list)return;
      card.onclick=event=>{if(event.target.closest('[data-care-inline-list]'))return;window.filterCareGroup(key);};
      if(careKey===key){
        list.hidden=false;
        list.dataset.careInlineList='1';
        list.style.cssText='display:block;border-top:1px solid #dbe4ee;background:#fff;padding:0;margin:12px -16px -11px;';
        card.appendChild(list);
        card.classList.add('is-care-open');
      }else card.classList.remove('is-care-open');
    });
  }
  renderCareView=function(){if(!data)return;renders.care();applyDefaultCareGroups();renderCustomCareCards();decorateCare();const panels=qa('#carePanelsContainer > [data-care-group]');panels.forEach(panel=>{const key=panel.dataset.careGroup,open=Boolean(careKey&&key===careKey);panel.hidden=!open;panel.classList.toggle('is-open',open);const toggle=panel.querySelector('[data-care-toggle]');const list=panel.querySelector('[data-care-list]');if(toggle)toggle.setAttribute('aria-expanded',String(open));if(list)list.hidden=!open;});mountInlineCareLists();};
  window.filterCareGroup=function(key){
    const raw=String(key||'').trim();
    const aliases={converted:'g-conv',conversion:'g-conv',conv:'g-conv',hot:'g-hot',warm:'g-warm',cold:'g-cold'};
    const normalized=aliases[raw]||(raw.startsWith('g-')?raw:'g-'+raw);
    careKey=careKey===normalized?'':normalized;
    renderCareView();
  };
  function dashboard() {
    const total=data.customers.length,connected=data.customers.filter(c=>!['NEW','LOST'].includes(c.status)).length;
    const today=data.customers.filter(c=>c.createdAt?.slice(0,10)===data.today).length;
    const revenue=data.financialEvents.reduce((sum,e)=>sum+Number(e.amount||0),0);
    const rentals=data.orders.filter(o=>o.status==='PAID'&&o.rentalMonths&&o.rentalEndsAt?.slice(0,10)>=data.today);
    text('dashTotalCust',total);text('dashCustConnected',`${connected} (${total?(connected/total*100).toFixed(1):0}%)`);text('dashCustPending',`${total-connected} (${total?((total-connected)/total*100).toFixed(1):0}%)`);
    text('dashNewCustToday',today);text('dashCustTodayFoot','+'+today+' mới');text('dashCustWeekFoot',data.customers.filter(c=>c.createdAt?.slice(0,10)>=fromDay(7)).length+' data');text('dashPaidRevenue',money(revenue));text('dashFirstBuyCust',rentals.length);
    if(q('#meterTotalCust'))q('#meterTotalCust').style.width=(total?connected/total*100:0)+'%';
  }

  function dashboardCohortStats(customers, orders, field) {
    const groups = new Map();
    const group = key => {if(!groups.has(key))groups.set(key,{key,webhook:new Set(),buyers:new Set(),webhookBuyers:new Set()});return groups.get(key);};
    for(const option of field?.options||[]){const key=String(typeof option==='string'?option:option.value||'').trim();if(key)group(key);}
    group('');
    const buyers = new Set((orders||[]).filter(order=>!['CANCELLED','REFUNDED'].includes(order.status)&&OrderPayments.paid(order)-Math.max(0,Number(order.refund)||0)>0).map(order=>String(order.customerId||'')).filter(Boolean));
    const totals={webhook:new Set(),buyers:new Set(),webhookBuyers:new Set()};
    for(const customer of customers||[]){
      if(!customer?.id)continue;
      const id=String(customer.id),raw=field?customer.customFields?.[field.id]:null;
      const keys=[...new Set((Array.isArray(raw)?raw:[raw]).map(value=>String(value??'').trim()).filter(Boolean))];
      const webhook=isWebhookDataCustomer(customer),bought=buyers.has(id);
      if(webhook)totals.webhook.add(id);if(bought)totals.buyers.add(id);if(webhook&&bought)totals.webhookBuyers.add(id);
      for(const key of keys.length?keys:['']){const row=group(key);if(webhook)row.webhook.add(id);if(bought)row.buyers.add(id);if(webhook&&bought)row.webhookBuyers.add(id);}
    }
    const counts=row=>({key:row.key,webhook:row.webhook.size,buyers:row.buyers.size,webhookBuyers:row.webhookBuyers.size});
    return {rows:[...groups.values()].sort((a,b)=>a.key===''?1:b.key===''?-1:a.key.localeCompare(b.key,'vi',{numeric:true})).map(counts),totals:counts(totals)};
  }
  function renderDashboardCohortStats(){
    const dashboard=q('#tab-dashboard');if(!dashboard)return;
    let host=q('#dashboardCohortStats');
    if(!host){host=document.createElement('section');host.id='dashboardCohortStats';host.className='table-container';const anchor=dashboard.querySelector('.kpi-bento-grid');if(anchor)anchor.after(host);else dashboard.appendChild(host);}
    const stats=dashboardCohortStats(data.customers,data.orders,courseField());
    const cells=row=>'<td><b>'+row.webhook+'</b></td><td><b>'+row.buyers+'</b></td><td>'+row.webhookBuyers+'</td>';
    host.innerHTML='<div class="table-head-bar"><div><b>Data và khách mua hàng theo khóa</b><div class="cohort-stats-note">Toàn bộ dữ liệu trong phạm vi tài khoản. Khách đã mua gồm khách đã cọc hoặc thanh toán; mỗi khách chỉ tính một lần trong mỗi khóa.</div></div></div><div class="table-responsive"><table class="modern-table"><thead><tr><th>KHÓA</th><th>DATA TỪ WEBHOOK</th><th>KHÁCH ĐÃ MUA · TẤT CẢ NGUỒN</th><th>TRONG ĐÓ TỪ WEBHOOK</th></tr></thead><tbody>'+stats.rows.map(row=>'<tr><td><span class="chip '+(row.key?'chip-cold':'chip-warm')+'">'+esc(row.key||'Chưa chọn khóa')+'</span></td>'+cells(row)+'</tr>').join('')+'</tbody><tfoot><tr><td><b>Tổng khách không trùng</b></td>'+cells(stats.totals)+'</tr></tfoot></table></div>';
    if(!q('#dashboardCohortStatsStyles')){const style=document.createElement('style');style.id='dashboardCohortStatsStyles';style.textContent='#dashboardCohortStats{margin:18px 0;overflow:hidden}#dashboardCohortStats .cohort-stats-note{margin-top:5px;font-size:12px;line-height:1.5;color:var(--text-muted)}#dashboardCohortStats th:not(:first-child),#dashboardCohortStats td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}#dashboardCohortStats table{min-width:630px}#dashboardCohortStats tfoot{background:#f8fafc}';document.head.appendChild(style);}
  }

  function primaryText(node,value){if(!node)return;const first=Array.from(node.childNodes).find(n=>n.nodeType===3&&n.textContent.trim());if(first)first.textContent=value;else node.textContent=value;}
  function dashboardExtras(){
    renderDashboardCohortStats();
    const paid=data.orders.filter(o=>o.status==='PAID'),rentals=paid.filter(o=>o.rentalMonths&&o.rentalEndsAt?.slice(0,10)>=data.today);
    const cards=qa('#tab-dashboard .kpi-bento-card');
    const setFoot=(i,values)=>cards[i]?.querySelectorAll('.kpi-foot-stat .value').forEach((n,k)=>n.textContent=values[k]||'0');
    setFoot(2,[paid.length+' đã chốt',money(paid.reduce((s,o)=>s+Number(o.vatAmount||0),0))]);
    setFoot(3,[rentals.length+' gói',rentals.filter(o=>(Date.parse(o.rentalEndsAt)-Date.parse(data.today))/86400000<=2).length+' gói']);
    const month=data.today.slice(0,7),revenue=data.financialEvents.filter(e=>e.occurredAt?.startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);
    const goal=q('#tab-dashboard .goal-progress-box');
    // Bảng điều hành data chỉ dành cho tuyến quản lý và luôn giới hạn đúng phạm vi.
    if(goal){
      const role=String(data.user.actualRole||data.user.role||'').toUpperCase();
      goal.hidden=!['ADMIN','SALE'].includes(role);
      if(goal.hidden)goal.style.setProperty('display','none','important');
      else goal.style.removeProperty('display');
      if(role==='SALE'){
        goal.classList.add('sale-dashboard-panel');
        const safeOffers=data.pendingOffers||[],fallbackOffers=safeOffers.length?safeOffers:(data.offers||[]).filter(offer=>offer.status==='PENDING'&&String(offer.saleId||'')===String(data.user.saleId||data.user.id||'')).map(offer=>({id:offer.id,name:(data.customers||[]).find(customer=>customer.id===offer.customerId)?.name||'Chưa có tên',offeredAt:offer.offeredAt,minutesLeft:Math.max(0,1440-Math.floor((Date.now()-Date.parse(String(offer.offeredAt||'').replace(' ','T')))/60000))}));
        const items=fallbackOffers.slice().sort((a,b)=>String(a.offeredAt||'').localeCompare(String(b.offeredAt||'')));
        const body=items.map((offer,index)=>{
          const minutes=Math.max(0,Number(offer.minutesLeft)||0);
          const countdown=Math.floor(minutes/60)+' giờ '+(minutes%60)+' phút';
          return '<tr><td><b>#'+(index+1)+'</b></td><td><b>'+esc(fmtDate(String(offer.offeredAt||'').slice(0,10)))+'</b><small>'+esc(String(offer.offeredAt||'').slice(11,16))+'</small></td><td><b>'+esc(offer.name||'Chưa có tên')+'</b></td><td><span class="sale-dashboard-countdown">'+esc(countdown)+'</span></td><td><button type="button" class="btn-action sale-dashboard-accept" data-dashboard-accept-offer="'+esc(offer.id)+'">Nhận data</button></td></tr>';
        }).join('');
        goal.innerHTML='<div class="pending-data-head"><div><b>Data chưa nhận</b><small>Data được phân cho bạn đang chờ xác nhận</small></div><span class="chip">'+items.length+' data</span></div><div class="table-responsive pending-data-table-wrap"><table class="modern-table sale-dashboard-table"><thead><tr><th>THỨ TỰ</th><th>NGÀY DATA</th><th>KHÁCH HÀNG</th><th>THỜI GIAN NHẬN</th><th>THAO TÁC</th></tr></thead><tbody>'+(body||'<tr><td colspan="5"><div class="pending-data-empty"><b>Không có data chờ nhận</b><span>Data mới được phân sẽ hiển thị tại đây.</span></div></td></tr>')+'</tbody></table></div>';
        if(!q('#saleDashboardAcceptStyles')){
          const style=document.createElement('style');style.id='saleDashboardAcceptStyles';style.textContent='.sale-dashboard-panel{border-color:#fed7aa!important;box-shadow:0 4px 14px rgba(234,88,12,.12)!important}.sale-dashboard-panel .pending-data-head b{color:#c2410c}.sale-dashboard-table{min-width:760px}.sale-dashboard-table td:nth-child(2) small{display:block;margin-top:3px;color:var(--text-muted);font-size:10.5px;white-space:nowrap}.sale-dashboard-countdown{display:inline-flex;align-items:center;min-height:28px;padding:5px 10px;border-radius:7px;background:#fff7ed;color:#c2410c;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.sale-dashboard-accept{justify-content:center;background:#059669;color:#fff;border:1px solid #059669;box-shadow:0 3px 10px rgba(5,150,105,.2)}.sale-dashboard-accept:hover{background:#047857;border-color:#047857}.sale-dashboard-accept:disabled{opacity:.6;cursor:wait}';document.head.appendChild(style);
        }
        goal.querySelectorAll('[data-dashboard-accept-offer]').forEach(button=>button.onclick=async()=>{
          if(button.dataset.busy==='1')return;
          const label=button.textContent;
          button.dataset.busy='1';button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='\u0110ang nh\u1eadn...';
          try{await run(()=>api.acceptOffer(button.dataset.dashboardAcceptOffer));}
          finally{button.dataset.busy='';button.disabled=false;button.removeAttribute('aria-busy');button.textContent=label;}
        });
      }else if(!goal.hidden){
        goal.classList.remove('sale-dashboard-panel');
        const allCustomers=data.managerHierarchy?.customers||data.customers;
        const pendingOffers=(data.offers||[]).filter(o=>o.status==='PENDING');
        const hierarchyMembers=data.managerHierarchy?.members||data.members||[];
        const assignedLeaderIds=role==='MANAGER'
          ? new Set(hierarchyMembers.filter(m=>m.role==='LEADER'&&m.active!==false&&m.managerId===data.user.id).map(m=>m.id))
          : null;
        const assignedDirectSaleIds=role==='MANAGER'
          ? new Set(hierarchyMembers.filter(m=>m.role==='SALE'&&m.active!==false&&m.managerId===data.user.id&&(!m.leaderId||!hierarchyMembers.some(l=>l.id===m.leaderId&&l.role==='LEADER'))).map(m=>m.id))
          : null;
        const source=role==='MANAGER'
          ? allCustomers.filter(c=>assignedLeaderIds.has(c.leaderId)||assignedDirectSaleIds.has(c.saleId||pendingOffers.find(o=>o.customerId===c.id)?.saleId))
          : data.customers;
        const rows=source.filter(c=>{
          if(['ARCHIVED','LOST','PAID'].includes(c.status))return false;
          // Chỉ báo khách mà nhân viên chưa chọn Level khách hàng ở Khách hàng tổng.
          // A non-empty Level value means the Sale has processed the customer.
          return !String(c.customFields?.customerLevel||'').trim();
        }).sort((a,b)=>String(a.teamId||'').localeCompare(String(b.teamId||''),'vi')||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
        const groupKey=c=>c.teamId||'Chưa phân Team';
        const teams=[...new Set(rows.map(groupKey))];
        const scopeLabel=role==='ADMIN'?'Toàn hệ thống':role==='MANAGER'?'Các Team được Admin giao':`Team ${data.user.teamId||''}`;
        const body=teams.map(team=>{
          const teamRows=rows.filter(c=>groupKey(c)===team);
          const groupHeader=(role==='ADMIN'||role==='MANAGER')?'<tr class="pending-team-row"><td colspan="6"><b>'+esc(team)+'</b><span>'+teamRows.length+' data chưa xử lý</span></td></tr>':'';
          return groupHeader+teamRows.map(c=>{
            const offer=pendingOffers.find(o=>o.customerId===c.id),saleId=c.saleId||offer?.saleId;
            const state=!c.leaderId?'Chưa phân Team / Leader':offer?'Chờ Sale nhận':!c.saleId?'Chưa phân Sale':!c.saleAcceptedAt?'Chờ nhận data':'Chưa chọn Level';
            return '<tr><td><b>'+esc(c.name)+'</b><small>'+esc(fmtDate(c.createdAt))+'</small></td><td>'+esc(groupKey(c))+'</td><td>'+esc(c.leaderId?person(c.leaderId):'Chưa phân Leader')+'</td><td>'+esc(saleId?person(saleId):'Chưa phân Sale')+'</td><td><span class="chip chip-warm">'+esc(state)+'</span></td><td><button class="btn-action btn-secondary" data-pending-customer="'+esc(c.id)+'">Xem</button></td></tr>';
          }).join('');
        }).join('');
        goal.innerHTML='<div class="pending-data-head"><div><b>Data chưa xử lý</b><small>'+esc(scopeLabel)+' · khách chưa được chọn Level</small></div><span class="chip">'+rows.length+' khách</span></div><div class="table-responsive pending-data-table-wrap"><table class="modern-table pending-data-table"><thead><tr><th>Khách hàng</th><th>Team</th><th>Leader</th><th>Sale phụ trách</th><th>Tình trạng</th><th></th></tr></thead><tbody id="pendingDataBody">'+(body||'<tr><td colspan="6"><div class="pending-data-empty"><b>Không có data chưa xử lý</b><span>Tất cả khách trong phạm vi đã được tiếp nhận hoặc hoàn tất.</span></div></td></tr>')+'</tbody></table></div>';
        renderPendingHierarchyV2(goal, source, rows, pendingOffers);
        goal.querySelector('.pending-data-head small')?.remove();
        goal.querySelectorAll('.pending-root-toggle b').forEach(label=>{const value=label.textContent.trim();if(value.startsWith('Manager: '))label.textContent='Team '+value.slice(9)+' (manager)';else if(value.startsWith('Team ')&&!value.endsWith('(leader)'))label.textContent=value+' (leader)';});
      }
    }
    const roleForDashboard=data.user.actualRole||data.user.role;
    const landingTable=q('#recentOrdersOverview')||qa('#tab-dashboard .table-container').find(node=>/Hi[^<]*Landing Page/i.test(node.textContent||''));
    if(landingTable){
      landingTable.id='recentOrdersOverview';
      landingTable.classList.add('recent-orders-overview');
      landingTable.hidden=roleForDashboard!=='ADMIN';landingTable.style.setProperty('display',roleForDashboard==='ADMIN'?'':'none','important');
      const head=landingTable.querySelector('.table-head-bar');
      const title=head?.querySelector('b');if(title)title.textContent='Các đơn hàng gần đây';
      const subtitle=head?.querySelector('div > div');if(subtitle)subtitle.textContent='10 đơn mới nhất lấy trực tiếp từ mục Đơn hàng.';
      const action=head?.querySelector('button');if(action){action.textContent='Xem tất cả đơn hàng';action.removeAttribute('onclick');action.onclick=()=>renders.switchTab('tab-orders');}
      const table=landingTable.querySelector('table'),body=table?.querySelector('tbody');
      if(table){
        table.classList.remove('landing-performance-table');
        table.classList.add('recent-orders-table');
        const row=table.querySelector('thead tr');
        if(row)row.innerHTML='<th>MÃ ĐƠN</th><th>PHÂN LOẠI</th><th>KHÁCH HÀNG</th><th>SẢN PHẨM / DỊCH VỤ</th><th>GÓI / THỜI HẠN</th><th>SALE PHỤ TRÁCH</th><th>TIỀN CẦN THU (TRƯỚC VAT)</th><th>VAT</th><th>THỰC THU</th><th>TRẠNG THÁI</th>';
      }
      const orders=(data.orders||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id||'').localeCompare(String(a.id||''))).slice(0,10);
      if(body){
        const statusLabel={PAID:'Đã thanh toán',COURSE_GRANTED:'Đã cấp khóa học',DEPOSIT:'Đã đặt cọc',PENDING:'Chờ thanh toán',REFUNDED:'Đã hoàn tiền',CANCELLED:'Đã hủy'};
        const statusClass={PAID:'chip-green',COURSE_GRANTED:'chip-green',DEPOSIT:'chip-warm',PENDING:'chip-orange',REFUNDED:'chip-cold',CANCELLED:'chip-cold'};
        body.innerHTML=orders.map(order=>{
          const customer=(data.customers||[]).find(item=>item.id===order.customerId);
          const product=(data.products||[]).find(item=>item.id===order.productId);
          const sale=(data.members||[]).find(item=>item.id===order.saleId);
          const isRental=Boolean(order.rentalMonths)||product?.type==='RENTAL';
          const classification=isRental?'CHO THUÊ CHỈ BÁO':'BÊN BÁN';
          const term=order.rentalMonths?`${order.rentalMonths} tháng${order.rentalEndsAt?' · đến '+fmtDate(order.rentalEndsAt):''}`:'Vĩnh viễn';
          const revenue=Number(order.subtotal??order.total??0);
          const vat=Number(order.vatAmount??0);
          const totalAmount=Math.max(0,Number(order.total||0)),paid=Number(order.amountPaid),subtotalAmount=Math.max(0,Number(order.subtotal||0)),vatAmountForReceipt=Math.max(0,Number(order.vatAmount||0)); const grossCollected=order.status==='DEPOSIT'?Math.min(totalAmount,Math.max(0,Number(order.depositAmount||0))):Number.isFinite(paid)&&paid>0?Math.min(totalAmount,paid+(['PAID','COURSE_GRANTED','REFUNDED'].includes(order.status)&&!order.depositAt&&subtotalAmount>0&&paid<subtotalAmount?vatAmountForReceipt:0)):['PAID','COURSE_GRANTED','REFUNDED'].includes(order.status)?Math.min(totalAmount,Math.max(0,Number(order.refund||0))||totalAmount):0; const received=Math.max(0,grossCollected-Math.max(0,Number(order.refund||0)));
           const status=OrderPayments.status(order,money);
          return '<tr><td><b class="recent-order-code">'+esc(order.code||order.id||'—')+'</b></td><td><span class="chip '+(isRental?'chip-warm':'chip-orange')+'">'+classification+'</span></td><td><b>'+esc(order.customerName||customer?.name||'—')+'</b><div class="recent-order-sub">'+esc(customer?.phone||'')+'</div></td><td><b>'+esc(order.productName||product?.name||'—')+'</b><div class="recent-order-sub">'+esc(order.sku||product?.sku||'')+'</div></td><td><span class="chip chip-warm">'+esc(term)+'</span></td><td>'+esc(sale?.name||'Chưa phân Sale')+'</td><td><b class="recent-order-money">'+money(revenue)+'</b></td><td><b class="recent-order-vat">'+money(vat)+'</b></td><td><b class="recent-order-received">'+money(received)+'</b></td><td><span class="chip '+(statusClass[order.status]||'chip-cold')+'">'+esc(status)+'</span></td></tr>';
        }).join('')||'<tr><td colspan="10"><div class="pending-data-empty"><b>Chưa có đơn hàng</b><span>Đơn mới sẽ xuất hiện tại đây sau khi được tạo trong mục Đơn hàng.</span></div></td></tr>';
      }
      const recentHead=table.querySelector('thead tr');
      if(recentHead&&!recentHead.querySelector('[data-order-phone-column]')){
        const customerHeader=Array.from(recentHead.cells).find(cell=>/KHÁCH HÀNG|KHÁCH HÀNG/i.test(cell.textContent||''));
        if(customerHeader){const phoneHeader=document.createElement('th');phoneHeader.dataset.orderPhoneColumn='1';phoneHeader.textContent='SĐT KH';customerHeader.after(phoneHeader);}
      }
      Array.from(body.rows).forEach((row,index)=>{
        const order=orders[index];
        if(!order||row.querySelector('[data-order-phone-cell]'))return;
        const customer=(data.customers||[]).find(item=>item.id===order.customerId);
        const code=row.cells[0]?.querySelector('.recent-order-code');
        if(code)code.textContent=shortOrderCode(order.code||order.id);
        const customerCell=row.cells[2];
        if(customerCell){const phoneCell=document.createElement('td');phoneCell.dataset.orderPhoneCell='1';phoneCell.textContent=customer?.phone||'—';customerCell.querySelector('.recent-order-sub')?.remove();customerCell.after(phoneCell);}
      });
      const recentEmpty=body.querySelector('tr td[colspan]');
      if(recentEmpty)recentEmpty.colSpan=11;
      if(!q('#recentOrdersStyles')){const style=document.createElement('style');style.id='recentOrdersStyles';style.textContent='.recent-orders-overview{overflow:hidden}.recent-orders-table{min-width:1420px}.recent-orders-table th,.recent-orders-table td{white-space:nowrap;vertical-align:middle}.recent-order-code{font:700 11px var(--font-mono);color:#2563eb}.recent-order-money,.recent-order-vat,.recent-order-received{font:800 12px var(--font-mono)}.recent-order-money{color:#0f172a}.recent-order-vat{color:#d97706}.recent-order-received{color:#059669}.recent-order-sub{font-size:10.5px;color:var(--text-muted);margin-top:3px}.recent-orders-overview .table-responsive{overflow-x:auto}@media(max-width:980px){.recent-orders-table{min-width:1420px}}';document.head.appendChild(style)}
    }
    const charts=qa('#tab-dashboard .chart-panel');
    const days=Array.from({length:7},(_,i)=>fromDay(7-i));
    charts[0]?.querySelectorAll('.chart-svg-container + div span').forEach((node,i)=>node.textContent=new Date(days[i]+'T00:00:00Z').toLocaleDateString('vi-VN',{weekday:'short',timeZone:'UTC'})+(i===6?' (Hôm nay)':''));charts[1]?.querySelectorAll('.chart-svg-container + div span').forEach((node,i)=>node.textContent='Kỳ '+(i+1));
    const counts=days.map(day=>data.customers.filter(c=>c.createdAt?.slice(0,10)===day).length);
    primaryText(charts[0]?.querySelector('.chart-metric-num'),counts.reduce((a,b)=>a+b,0)+' ');
    primaryText(charts[1]?.querySelector('.chart-metric-num'),money(revenue)+' ');
    charts.forEach(c=>c.querySelectorAll('.metric-growth').forEach(n=>n.textContent=''));
    const svg=charts[0]?.querySelector('.chart-svg-container svg');
    if(svg){const max=Math.max(1,...counts),points=counts.map((n,i)=>[20+i*460/6,190-n/max*160]);const path=points.map(([x,y],i)=>(i?'L':'M')+' '+x+' '+y).join(' ');const paths=svg.querySelectorAll('path');paths[0]?.setAttribute('d',path+' L 480 190 L 20 190 Z');paths[1]?.setAttribute('d',path);svg.querySelectorAll('circle').forEach((n,i)=>{const p=points[Math.min(6,i*2)];n.setAttribute('cx',p[0]);n.setAttribute('cy',p[1]);});svg.querySelectorAll('text').forEach((n,i)=>{const idx=Math.min(6,i*2);n.textContent=counts[idx];n.setAttribute('x',points[idx][0]);n.setAttribute('y',points[idx][1]-10);});}
    const bars=charts[1]?.querySelectorAll('svg g rect')||[];
    const series=Array.from(bars,(_,i)=>data.financialEvents.filter(e=>e.occurredAt?.slice(0,10)>=fromDay((bars.length-i)*3)&&e.occurredAt?.slice(0,10)<=(i===bars.length-1?data.today:fromDay((bars.length-i-1)*3+1))).reduce((sum,e)=>sum+Number(e.amount||0),0));
    const max=Math.max(1,...series);bars.forEach((n,i)=>{const height=Math.max(0,series[i]/max*150);n.setAttribute('height',height);n.setAttribute('y',180-height);});charts[1]?.querySelectorAll('svg g text').forEach((n,i)=>{n.textContent=(series[i]/1e6).toFixed(1)+'Tr';n.setAttribute('y',170-Math.max(0,series[i]/max*150));});
    const ranked=data.products.map(p=>({...p,count:paid.filter(o=>o.productId===p.id).length})).sort((a,b)=>b.count-a.count);
    qa('#tab-dashboard .product-item').forEach((node,i)=>{const p=ranked[i];node.querySelector('.product-name').textContent=p?.name||'Chưa có sản phẩm';node.querySelector('.product-sku').textContent=p?p.sku+' · '+money(p.price)+' ('+p.count+' đơn)':'—';});
    const rentBox=q('#tab-dashboard .side-widgets-column .widget-box:last-child');
    if(rentBox){const upcoming=rentals.filter(o=>(Date.parse(o.rentalEndsAt)-Date.parse(data.today))/86400000<=7);rentBox.querySelector('.widget-box-head span:last-child').textContent=upcoming.length+' Gói';Array.from(rentBox.children[1]?.children||[]).forEach((row,i)=>{const o=upcoming[i];row.querySelector('b').textContent=o?.customerName||'Chưa có gói cần gia hạn';row.querySelector('b + div').textContent=o?.productName||'—';row.querySelector('span').textContent=o?fmtDate(o.rentalEndsAt):'—';});}
    const todayNewCustomers=data.customers.filter(c=>c.createdAt?.slice(0,10)===data.today);
    const monthOrders=paid.filter(o=>String(o.paidAt||o.createdAt||'').slice(0,7)===data.today.slice(0,7));
    const customerById=new Map(data.customers.map(c=>[c.id,c]));
    const productCountByAge=monthOrders.reduce((sum,o)=>{const c=customerById.get(o.customerId);const created=Date.parse(String(c?.createdAt||'').replace(' ','T'));const at=Date.parse(String(o.paidAt||o.createdAt||'').replace(' ','T'));const ageDays=Number.isFinite(created)&&Number.isFinite(at)?Math.floor((at-created)/86400000):31;const qty=Math.max(1,Number(o.qty||1));if(ageDays<30)sum.new+=qty;else sum.old+=qty;return sum;},{new:0,old:0});
    const subCards=qa('#tab-dashboard .sub-grid-2 .chart-panel');
    if(subCards[0]){const title=subCards[0].querySelector('.chart-metric-title');if(title)title.textContent='Số lượng khách hàng mới hôm nay';primaryText(subCards[0].querySelector('.chart-metric-num'),todayNewCustomers.length+' khách');subCards[0].querySelector('.chart-detail-link')?.remove();}
    if(subCards[1]){const title=subCards[1].querySelector('.chart-metric-title');if(title)title.textContent='Số lượng sản phẩm theo loại khách hàng';primaryText(subCards[1].querySelector('.chart-metric-num'),(productCountByAge.new+productCountByAge.old)+' sản phẩm');const detail=subCards[1].querySelector('.chart-detail-link');if(detail)detail.textContent='Reset ngày 1 hàng tháng';const note=subCards[1].querySelector('div[style*="display: flex"]');if(note)note.textContent=productCountByAge.old+' sản phẩm khách cũ · '+productCountByAge.new+' sản phẩm khách mới';const bar=subCards[1].querySelector('.segment-bar');if(bar){const total=productCountByAge.new+productCountByAge.old;const oldPart=bar.children[0],newPart=bar.children[1];if(oldPart)oldPart.style.width=(total?productCountByAge.old/total*100:0)+'%';if(newPart){newPart.style.width=(total?productCountByAge.new/total*100:0)+'%';newPart.style.background='#f97316';}}}
    qa('#tab-dashboard .sub-grid-2 b').forEach(n=>{if(/^\d/.test(n.textContent))n.textContent='—';});
  }

  // Cây data theo đúng cấp: Manager -> Leader -> Sale. Leader chưa có Manager
  // được hiển thị cùng cấp Manager dưới tên Team của chính Leader.
  function renderPendingHierarchyV2(goal, source, rows, pendingOffers) {
    const members=data.members.filter(m=>m.active!==false),byId=id=>members.find(m=>m.id===id);
    const saleIdFor=c=>c.saleId||pendingOffers.find(o=>o.customerId===c.id)?.saleId||'UNASSIGNED';
    const managerFor=c=>{
      const manager=byId(c.managerId);if(manager?.role==='MANAGER')return manager;
      const leader=byId(c.leaderId);if(leader?.role==='LEADER')return byId(leader.managerId);
      const owner=byId(saleIdFor(c));
      if(owner?.role==='MANAGER')return owner;
      if(owner?.role==='SALE'&&(!byId(owner.leaderId)||byId(owner.leaderId)?.role!=='LEADER'))return byId(owner.managerId)||(byId(owner.leaderId)?.role==='MANAGER'?byId(owner.leaderId):null);
      return null;
    };
    const hasLeader=c=>byId(c.leaderId)?.role==='LEADER';
    const stateFor=c=>pendingOffers.some(o=>o.customerId===c.id)?'Chờ Sale nhận':!hasLeader(c)&&!managerFor(c)?'Chưa phân Leader':!c.saleId?'Chưa phân Sale':!c.saleAcceptedAt?'Chờ nhận data':'Chưa chọn Level';
    const rowsForLeader=leader=>rows.filter(c=>c.leaderId===leader?.id);
    const saleGroups=leaderRows=>[...new Set(leaderRows.map(saleIdFor))].map(id=>({id,sale:byId(id),rows:leaderRows.filter(c=>saleIdFor(c)===id)}));
    const saleGroupMarkup=(sale,saleRows)=>'<div class="pending-sale-group"><div class="pending-sale-head"><b>'+esc(sale?.name||'Ch\u01b0a ph\u00e2n Sale')+'</b><span>'+saleRows.length+' kh\u00e1ch</span></div>'+(saleRows.map(c=>'<button type="button" class="pending-customer-row" data-pending-customer="'+esc(c.id)+'"><span><b>'+esc(c.name)+'</b><small>'+esc(fmtDate(c.createdAt))+'</small></span><span class="chip chip-warm">'+esc(stateFor(c))+'</span></button>').join('')||'<div class="pending-data-empty">Ch\u01b0a c\u00f3 data ch\u01b0a x\u1eed l\u00fd</div>')+'</div>';
    const salesMarkup=leaderRows=>saleGroups(leaderRows).map(group=>saleGroupMarkup(group.sale,group.rows)).join('')||'<div class="pending-data-empty">Ch\u01b0a c\u00f3 Sale ho\u1eb7c kh\u00e1ch trong nh\u00f3m</div>';
    const managerSaleMarkup=(manager,sale)=>{const key=manager.id+'-'+sale.id,saleRows=directSaleRows(manager,sale);return '<div class="pending-nested-sale"><button type="button" class="pending-manager-sale-toggle" data-pending-manager-sale="'+esc(key)+'" aria-expanded="false"><span><b>'+esc(sale.name||'Sale')+'</b><small>Sale \u00b7 '+saleRows.length+' kh\u00e1ch ch\u01b0a x\u1eed l\u00fd</small></span><span class="pending-manager-sale-chevron">+</span></button><div class="pending-manager-sale-detail" data-pending-manager-sale-detail="'+esc(key)+'" hidden>'+saleGroupMarkup(sale,saleRows)+'</div></div>';};
    const leaderMarkup=leader=>{const leaderRows=rowsForLeader(leader);return '<div class="pending-nested-leader"><button type="button" class="pending-leader-toggle" data-pending-leader-v2="'+esc(leader.id)+'" aria-expanded="false"><span><b>'+esc(leader.name||'Chưa phân Leader')+'</b><small>Leader · '+esc(teamLabel(leader.teamId,leader.id))+' · '+leaderRows.length+' khách</small></span><span class="pending-leader-chevron">+</span></button><div class="pending-leader-detail" data-pending-detail-v2="'+esc(leader.id)+'" hidden>'+salesMarkup(leaderRows)+'</div></div>';};
    const managerIds=new Set(rows.map(c=>managerFor(c)?.id||byId(c.leaderId)?.managerId).filter(Boolean));
    const directSalesForManager=manager=>members.filter(m=>m.role==='SALE'&&(m.managerId===manager.id||m.leaderId===manager.id)&&(!byId(m.leaderId)||byId(m.leaderId).role!=='LEADER'));
    const directSaleRows=(manager,sale)=>rows.filter(c=>saleIdFor(c)===sale.id&&(!byId(c.leaderId)||byId(c.leaderId).role!=='LEADER')&&(c.leaderId===manager.id||!c.leaderId||c.saleId===sale.id));
    const managerRows=manager=>rows.filter(c=>managerFor(c)?.id===manager.id||byId(c.leaderId)?.managerId===manager.id);
    members.filter(m=>m.role==='MANAGER').forEach(manager=>{if(managerRows(manager).length)managerIds.add(manager.id);});
    const assignedManagers=members.filter(m=>m.role==='MANAGER'&&managerIds.has(m.id));
    const directManagerSaleIds=new Set(assignedManagers.flatMap(directSalesForManager).map(sale=>sale.id));
    const assignedLeaders=members.filter(m=>m.role==='LEADER'&&rows.some(c=>c.leaderId===m.id));
    const roots=assignedManagers.map(manager=>{const ownSales=directSalesForManager(manager),ownSaleNodes=ownSales.map(sale=>managerSaleMarkup(manager,sale)).join(''),directRows=rows.filter(c=>managerFor(c)?.id===manager.id&&(!c.saleId||byId(c.saleId)?.role==='MANAGER')),directManagerNode=directRows.length?saleGroupMarkup(manager,directRows):'',children=directManagerNode+ownSaleNodes+assignedLeaders.filter(l=>l.managerId===manager.id).map(leaderMarkup).join(''),visibleRows=managerRows(manager);return '<div class="pending-root-group"><button type="button" class="pending-root-toggle" data-pending-root="'+esc(manager.id)+'" aria-expanded="false"><span><b>Manager: '+esc(manager.name)+'</b><small>'+visibleRows.length+' kh\u00e1ch \u00b7 '+ownSales.length+' Sale \u00b7 '+assignedLeaders.filter(l=>l.managerId===manager.id).length+' Leader</small></span><span class="pending-root-chevron">+</span></button><div class="pending-root-detail" data-pending-root-detail="'+esc(manager.id)+'" hidden>'+children+'</div></div>';});
    const unassignedLeaders=assignedLeaders.filter(l=>!l.managerId);
    unassignedLeaders.forEach(leader=>roots.push('<div class="pending-root-group"><button type="button" class="pending-root-toggle" data-pending-root="leader-'+esc(leader.id)+'" aria-expanded="false"><span><b>'+esc('Team '+leader.name)+'</b><small>Leader · '+rowsForLeader(leader).length+' khách</small></span><span class="pending-root-chevron">+</span></button><div class="pending-root-detail" data-pending-root-detail="leader-'+esc(leader.id)+'" hidden>'+salesMarkup(rowsForLeader(leader))+'</div></div>'));
    const orphanRows=rows.filter(c=>!hasLeader(c)&&!managerFor(c)&&!directManagerSaleIds.has(saleIdFor(c))); if(orphanRows.length)roots.push('<div class="pending-root-group"><button type="button" class="pending-root-toggle" data-pending-root="unassigned" aria-expanded="false"><span><b>Chưa phân Leader</b><small>'+orphanRows.length+' khách</small></span><span class="pending-root-chevron">+</span></button><div class="pending-root-detail" data-pending-root-detail="unassigned" hidden>'+salesMarkup(orphanRows)+'</div></div>');
    if(!q('#pendingHierarchyV2Styles')){const style=document.createElement('style');style.id='pendingHierarchyV2Styles';style.textContent='.pending-root-group{border:1px solid #cbd5e1;border-radius:9px;background:#fff;box-shadow:0 2px 7px rgba(15,23,42,.06);overflow:hidden}.pending-root-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;border-left:4px solid #2563eb;background:#f8fafc;padding:13px 14px 13px 12px;text-align:left;color:#0f172a;cursor:pointer;outline:0}.pending-root-toggle:hover{background:#eff6ff}.pending-root-toggle[aria-expanded=true]{background:#eff6ff;border-bottom:1px solid #bfdbfe}.pending-root-toggle:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}.pending-root-toggle>span:first-child{display:grid;gap:3px}.pending-root-toggle b{font-size:12.5px}.pending-root-toggle small{color:#475569;font-size:10.5px}.pending-root-chevron{font-size:18px;font-weight:800;color:#1d4ed8}.pending-root-detail{padding:10px 10px 11px;border-top:1px solid #cbd5e1;background:#fff}.pending-nested-sale{margin:6px 0;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;overflow:hidden}.pending-manager-sale-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border:0;border-left:3px solid #16a34a;background:#f0fdf4;text-align:left;color:#14532d;cursor:pointer}.pending-manager-sale-toggle:hover{background:#dcfce7}.pending-manager-sale-toggle[aria-expanded=true]{border-bottom:1px solid #bbf7d0}.pending-manager-sale-toggle>span:first-child{display:grid;gap:3px}.pending-manager-sale-toggle b{font-size:12px}.pending-manager-sale-toggle small{font-size:10px;color:#4b7c56}.pending-manager-sale-chevron{font-size:17px;font-weight:800;color:#15803d}.pending-manager-sale-detail{padding:5px 9px 9px;background:#fff}.pending-nested-leader{border:1px solid #c7d2fe;border-radius:8px;margin:6px 0;background:#fafaff;overflow:hidden}.pending-nested-leader .pending-leader-toggle{padding:10px 11px;border-left:3px solid #7c3aed;background:#f5f3ff}.pending-nested-leader .pending-leader-toggle:hover{background:#ede9fe}.pending-nested-leader .pending-leader-toggle[aria-expanded=true]{border-bottom:1px solid #ddd6fe}.pending-nested-leader .pending-leader-detail{padding:5px 9px 9px;border-top:0;background:#fff}.pending-root-detail>.pending-sale-group{padding:7px 8px;border-left:3px solid #f59e0b;border-bottom:1px solid #fde68a;background:#fffbeb}.pending-root-detail>.pending-sale-group:last-child{border-bottom:0}.pending-sale-group{padding:8px;border:1px solid #fde68a;border-radius:7px;margin:6px 0;background:#fffbeb}.pending-sale-head{padding:2px 2px 7px;color:#92400e}.pending-sale-head span{color:#a16207}.pending-customer-row{border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:9px 8px;margin:5px 0}.pending-customer-row:hover{background:#f8fafc;border-color:#94a3b8}.pending-customer-row:focus-visible{outline:2px solid #2563eb;outline-offset:1px}.pending-customer-row .chip{border:1px solid #fbbf24;background:#fef3c7!important;color:#92400e!important}';document.head.appendChild(style)}
    goal.innerHTML='<div class="pending-data-head"><div><b>Data chưa xử lý</b><small>Chọn Manager hoặc Leader để xem cấp dưới và khách phụ trách</small></div><span class="chip">'+rows.length+' khách</span></div><div class="pending-hierarchy-list">'+(roots.join('')||'<div class="pending-data-empty"><b>Không có data chưa xử lý</b></div>')+'</div>';
    goal.querySelectorAll('[data-pending-root]').forEach(button=>button.onclick=()=>{const detail=goal.querySelector('[data-pending-root-detail="'+CSS.escape(button.dataset.pendingRoot)+'"]');if(!detail)return;const open=detail.hidden;detail.hidden=!open;button.setAttribute('aria-expanded',String(open));button.querySelector('.pending-root-chevron').textContent=open?'−':'+';});
    goal.querySelectorAll('[data-pending-manager-sale]').forEach(button=>button.onclick=()=>{const detail=goal.querySelector('[data-pending-manager-sale-detail="'+CSS.escape(button.dataset.pendingManagerSale)+'"]');if(!detail)return;const open=detail.hidden;detail.hidden=!open;button.setAttribute('aria-expanded',String(open));button.querySelector('.pending-manager-sale-chevron').textContent=open?'\u2212':'+';});
    goal.querySelectorAll('[data-pending-leader-v2]').forEach(button=>button.onclick=()=>{const detail=goal.querySelector('[data-pending-detail-v2="'+CSS.escape(button.dataset.pendingLeaderV2)+'"]');if(!detail)return;const open=detail.hidden;detail.hidden=!open;button.setAttribute('aria-expanded',String(open));button.querySelector('.pending-leader-chevron').textContent=open?'−':'+';});
    goal.querySelectorAll('[data-pending-customer]').forEach(button=>button.onclick=()=>workflow('customer',button.dataset.pendingCustomer));
  }
  const rowTemplates=new Map();
  qa('tbody').forEach(body=>{if(body.querySelector('tr'))rowTemplates.set(body,body.querySelector('tr').cloneNode(true));});
  function table(body,rows) {
    if(!body)return;const template=rowTemplates.get(body);body.replaceChildren();
    rows.forEach(values=>{const row=template?template.cloneNode(true):document.createElement('tr');
      if(!template)values.forEach(()=>row.appendChild(document.createElement('td')));
      row.querySelectorAll('td').forEach((cell,i)=>{const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);const texts=[];let node;while(node=walker.nextNode())if(node.textContent.trim()&&!node.parentElement.closest('button,svg,a'))texts.push(node);const value=values[i],teamMember=body.closest('#tab-team')&&i===0&&typeof value==='string'?data?.members.find(member=>value.startsWith(member.name)):null,relatedMember=body.closest('#tab-team')&&i===3&&typeof value==='string'?data?.members.find(member=>member.name===value):null,displayValue=teamMember?{primary:`${teamMember.name||'Chua dat ten'} - ID: ${teamMember.accountId||teamMember.id}`,secondary:teamMember.phone||'Chua co so dien thoai'}:relatedMember?personWithId(relatedMember.id):value;if(texts.length){if(displayValue&&typeof displayValue==='object'){texts[0].textContent=displayValue.primary??'';if(texts[1])texts[1].textContent=displayValue.secondary??'';texts.slice(2).forEach(n=>n.textContent='');}else{texts[0].textContent=displayValue??'';texts.slice(1).forEach(n=>n.textContent='');}}else if(!cell.querySelector('button,input,svg'))cell.textContent=displayValue??'';cell.querySelectorAll('[title]').forEach(n=>n.removeAttribute('title'));});row.removeAttribute('onclick');body.appendChild(row);
    });
  }
  function orderDeleteAllowed(order) {
    const role=data?.user?.actualRole||data?.user?.role;
    if(role==='ADMIN')return true;
    if(!['MANAGER','LEADER','SALE'].includes(role))return false;
    const raw=String(order?.createdAt||'').trim();
    const iso=raw.includes('T')?raw:raw.replace(' ','T');
    const created=Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)?iso:`${iso}+07:00`);
    return Number.isFinite(created)&&Date.now()-created<3*24*60*60*1000;
  }
  function drawOrders() {
    const grossCollected=o=>OrderPayments.paid(o);
    const netCollected=o=>Math.max(0,grossCollected(o)-Math.max(0,Number(o.refund||0)));
    const paymentStatus=o=>['PAID','COURSE_GRANTED'].includes(o.status)?'Thanh toán đủ':o.status==='DEPOSIT'?'Đã đặt cọc':o.status==='REFUNDED'?'Đã hoàn tiền':o.status==='CANCELLED'?'Đã hủy':'Chờ thanh toán';
    const isRental=o=>Boolean(o.rentalMonths)||(data.products||[]).find(product=>product.id===o.productId)?.type==='RENTAL';
    const statusFilter=q('#orderStatusFilterSelect');
    if(statusFilter)statusFilter.innerHTML='<option value="all">Tất cả trạng thái</option><option value="Thanh toán đủ">Thanh toán đủ</option><option value="Đã đặt cọc">Đã đặt cọc</option><option value="Chờ thanh toán">Chờ thanh toán</option><option value="Đã hoàn tiền">Đã hoàn tiền</option><option value="Đã hủy">Đã hủy</option>';
    const saleTab=q('#btnOrderTabSale'),rentTab=q('#btnOrderTabRent');
    if(saleTab)saleTab.textContent='Bên Bán (Khóa học & SP)';
    if(rentTab)rentTab.textContent='Cho thuê chỉ báo';
    if((data.user.actualRole||data.user.role)==='HRM')qa('#tab-orders .headline-row button').forEach(button=>{if(/Tạo|Thêm/.test(button.textContent)){button.hidden=true;button.setAttribute('aria-hidden','true');button.style.setProperty('display','none','important');button.removeAttribute('onclick');}});
    const start=q('#orderStartDate')?.value,end=q('#orderEndDate')?.value;
    const rows=(data.orders||[]).filter(order=>(!start||order.createdAt?.slice(0,10)>=start)&&(!end||order.createdAt?.slice(0,10)<=end));
    const saleRows=rows.filter(order=>!isRental(order)),rentRows=rows.filter(isRental),collectedRows=rows.filter(order=>netCollected(order)>0);
    text('orderKpiTotalCount',rows.length+' đơn');
    text('orderKpiTotalValue',money(rows.reduce((sum,order)=>sum+Number(order.total||0),0)));
    text('orderKpiSaleCount',saleRows.length+' đơn');
    text('orderKpiSaleValue',money(saleRows.reduce((sum,order)=>sum+Number(order.total||0),0)));
    text('orderKpiRentCount',rentRows.length+' gói thuê');
    text('orderKpiRentValue',money(rentRows.reduce((sum,order)=>sum+Number(order.total||0),0)));
    text('orderKpiCollectedCount',collectedRows.length+' đơn');
    text('orderKpiCollectedValue',money(collectedRows.reduce((sum,order)=>sum+netCollected(order),0)));
    text('orderAllCountBadge',rows.length);
    const body=q('#ordersMainTableBody');
    if(!body)return;
    body.innerHTML=rows.map(order=>{
      const customer=(data.customers||[]).find(item=>item.id===order.customerId),rental=isRental(order),term=rental?(Number(order.rentalMonths||0)+' tháng'+(order.rentalEndsAt?' · đến '+fmtDate(order.rentalEndsAt):'')):'Vĩnh viễn';
      const col=netCollected(order);
      const rem=OrderPayments.balance(order);
      const isPaid=['PAID','COURSE_GRANTED'].includes(order.status)||rem<=0;
      const remHtml=rem<=0?'<span class="chip chip-green" style="font-size:10px;">0 đ (Đủ)</span>':'<b style="color:#dc2626;font-family:var(--font-mono);font-size:12px;">'+money(rem)+'</b>';

      return '<tr data-order-group="'+(rental?'rent':'sale')+'" data-order-status="'+esc(paymentStatus(order))+'"><td><b style="font-family:var(--font-mono);color:#2563eb">'+esc(internalCode(order.code||order.id))+'</b>'+'</td><td><span class="chip '+(rental?'chip-warm':'chip-orange')+'">'+(rental?'CHO THUÊ CHỈ BÁO':'BÊN BÁN')+'</span></td><td><b>'+esc(order.customerName||customer?.name||'—')+'</b><small>'+esc(customer?.phone||'')+'</small></td><td><b>'+esc(order.productName||'—')+'</b></td><td><span class="chip chip-warm">'+esc(term)+'</span></td><td>'+esc(person(order.saleId))+'</td><td><b>'+money(order.subtotal)+'</b></td><td>'+money(order.vatAmount)+'</td><td><b style="color:#059669">'+money(col)+'</b></td><td>'+remHtml+'</td><td><span class="chip '+(isPaid?'chip-green':'chip-warm')+'">'+esc(OrderPayments.status(order,money))+'</span></td><td style="text-align:right"><button type="button" class="btn-action btn-secondary" data-order-detail="'+esc(order.id)+'">Chi tiết</button>'+(['ADMIN','ACCOUNTING','SALE','LEADER','MANAGER'].includes(data.user.actualRole||data.user.role)&&!order.paymentReconciled&&!order.vatIssued&&!['REFUNDED','CANCELLED','COURSE_GRANTED'].includes(order.status)?' <button type="button" class="btn-action btn-secondary" data-order-edit="'+esc(order.id)+'">Sửa đơn</button>':'')+(orderDeleteAllowed(order)?' <button type="button" class="btn-action btn-danger" data-order-delete="'+esc(order.id)+'">Xóa</button>':'')+'</td></tr>';
    }).join('')||'<tr><td colspan="12"><div class="empty"><b>Chưa có đơn hàng</b></div></td></tr>';
    // Tách SĐT khách thành một cột riêng và chỉ hiển thị mã đơn rút gọn.
    const orderTable=body.closest('table');
    const orderHead=orderTable?.querySelector('thead tr');
    if(orderHead&&!orderHead.querySelector('[data-order-phone-column]')){
      const customerHeader=Array.from(orderHead.cells).find(cell=>/KHÁCH HÀNG|KHÁCH HÀNG/i.test(cell.textContent||''));
      if(customerHeader){const phoneHeader=document.createElement('th');phoneHeader.dataset.orderPhoneColumn='1';phoneHeader.textContent='SĐT KH';customerHeader.after(phoneHeader);}
    }
    if(orderHead&&!orderHead.querySelector('[data-order-remaining-column]')){
      const collectedHeader=Array.from(orderHead.cells).find(cell=>/THỰC THU/i.test(cell.textContent||''));
      if(collectedHeader){const remHeader=document.createElement('th');remHeader.dataset.orderRemainingColumn='1';remHeader.textContent='SỐ TIỀN CẦN THU';remHeader.style.color='#dc2626';collectedHeader.after(remHeader);}
    }
    body.querySelectorAll('tr').forEach(row=>{
      const detail=row.querySelector('[data-order-detail]');
      const order=detail?data.orders.find(item=>item.id===detail.dataset.orderDetail):null;
      const code=row.cells[0]?.querySelector('b');
      if(order&&code)code.textContent=shortOrderCode(order.code||order.id);
      if(!order||row.querySelector('[data-order-phone-cell]'))return;
      const customer=data.customers.find(item=>item.id===order.customerId);
      const customerCell=row.cells[2];
      if(!customerCell)return;
      const phoneCell=document.createElement('td');phoneCell.dataset.orderPhoneCell='1';phoneCell.textContent=customer?.phone||'—';
      const phoneDetail=customerCell.querySelector('small');
      if(phoneDetail)phoneDetail.remove();
      customerCell.after(phoneCell);
    });
    const emptyCell=body.querySelector('tr td[colspan]');
    if(emptyCell)emptyCell.colSpan=12;
    body.querySelectorAll('[data-order-edit]').forEach(button=>button.onclick=()=>{const order=data.orders.find(o=>o.id===button.dataset.orderEdit);if(order)openAccountingOrderForm(order.customerId,order);});
    body.querySelectorAll('[data-order-detail]').forEach(button=>button.onclick=()=>((data.user.actualRole||data.user.role)==='HRM'?openReceiptOrderDetail(button.dataset.orderDetail,false,false):workflow('order',button.dataset.orderDetail)));
    body.querySelectorAll('[data-order-delete]').forEach(button=>button.onclick=()=>{const order=data.orders.find(item=>item.id===button.dataset.orderDelete);if(!order||!orderDeleteAllowed(order)){referenceNotice('Đơn hàng chỉ được xóa trong 3 ngày đầu.','error');return;}if(!confirm('Xóa đơn '+(order.code||order.id)+'?'))return;run(()=>api.deleteOrder(order.id),()=>referenceNotice('Đã xóa đơn '+(order.code||order.id)+' thành công.'));});
    if(rows.length)filterOrdersCombined();else text('orderCountSummary','0 đơn hàng');
  }
  renderOrdersTable=drawOrders;
  filterOrdersDate=()=>drawOrders();
  async function prepareProductImage(file) {
    if(!file)return '';
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('\u1ea2nh s\u1ea3n ph\u1ea9m ph\u1ea3i l\u00e0 JPG, PNG ho\u1eb7c WEBP.');
    if(file.size>2*1024*1024)throw Error('\u1ea2nh s\u1ea3n ph\u1ea9m kh\u00f4ng \u0111\u01b0\u1ee3c v\u01b0\u1ee3t qu\u00e1 2 MB.');
    const source=await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Kh\u00f4ng th\u1ec3 \u0111\u1ecdc \u1ea3nh s\u1ea3n ph\u1ea9m.'));};
      image.src=url;
    });
    const longest=Math.max(source.naturalWidth||source.width,source.naturalHeight||source.height),scale=longest>960?960/longest:1;
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round((source.naturalWidth||source.width)*scale));
    canvas.height=Math.max(1,Math.round((source.naturalHeight||source.height)*scale));
    const context=canvas.getContext('2d');context.drawImage(source,0,0,canvas.width,canvas.height);
    const imageData=canvas.toDataURL('image/webp',0.82);
    if(imageData.length>2_800_000)throw Error('\u1ea2nh sau khi n\u00e9n v\u1eabn qu\u00e1 l\u1edbn. H\u00e3y ch\u1ecdn \u1ea3nh nh\u1ecf h\u01a1n.');
    return imageData;
  }
  // Dùng các lớp của mẫu cho form mới, giữ nguyên bố cục trang sản phẩm.
  function ensureProductImageStyles() {
    if(document.getElementById('referenceProductImageStyles'))return;
    const style=document.createElement('style');style.id='referenceProductImageStyles';style.textContent=`
      .reference-product-image-picker{display:flex;align-items:center;gap:14px;padding:12px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc}.reference-product-image-preview{width:88px;height:88px;flex:0 0 88px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#e2e8f0;color:#64748b;font-size:11px;font-weight:700;text-align:center}.reference-product-image-preview img{display:block;width:100%;height:100%;object-fit:cover}.reference-product-image-actions{display:flex;min-width:0;flex:1;flex-direction:column;align-items:flex-start;gap:7px}.reference-product-image-actions input{max-width:100%;font:inherit;font-size:12px}.reference-product-image-actions small{color:#64748b}.reference-product-image-actions .btn-action{min-height:32px;padding:6px 11px}.reference-product-name{display:flex;align-items:center;gap:9px;min-width:0}.reference-product-name>span:last-child{overflow:hidden;text-overflow:ellipsis}.reference-product-thumb{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;overflow:hidden;border-radius:8px;background:#dbeafe;color:#1d4ed8;font-size:13px;font-weight:800;object-fit:cover}@media(max-width:520px){.reference-product-image-picker{align-items:flex-start}.reference-product-image-actions{gap:8px}}
    `;document.head.appendChild(style);
  }
  // Loại sản phẩm dùng chung cho form sản phẩm và báo cáo doanh thu Kế toán.
  const PRODUCT_KINDS=[['COURSE','Khóa học'],['INDICATOR','Chỉ báo'],['VIP','Nhóm VIP'],['OTHER','Khác']];
  function productKind(product){
    if(['COURSE','INDICATOR','VIP','OTHER'].includes(product?.kind))return product.kind;
    const label=String(product?.category||product?.name||'').toLowerCase();
    if(label.includes('vip'))return 'VIP';
    if(product?.type==='RENTAL'||label.includes('chỉ báo')||label.includes('indicator')||label.includes('tín hiệu'))return 'INDICATOR';
    if(label.includes('khóa học')||label.includes('khoá học')||label.includes('khoa hoc')||label.includes('course'))return 'COURSE';
    return 'OTHER';
  }
  // Cột "Khoá" của Khách hàng tổng / Chăm sóc khách: giá trị K03, K05... là lớp của báo cáo.
  function courseField(){
    const fields=(data.fields||[]).filter(field=>field.active!==false);
    const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim();
    return fields.find(field=>normalize(field.label)==='khoa')
      ||fields.find(field=>['cohort','coursebatch','course_batch','batch','khoa'].includes(normalize(field.id)))
      ||null;
  }
  function courseKeys(){
    const field=courseField();if(!field)return [];
    const values=new Set((field.options||[]).map(option=>String(typeof option==='string'?option:(option.value||'')).trim()).filter(Boolean));
    for(const customer of data.customers||[]){const value=customer.customFields?.[field.id];for(const item of Array.isArray(value)?value:[value])if(String(item||'').trim())values.add(String(item).trim());}
    return [...values].sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
  }
  function productModal(id=null) {
    if(data.user.role!=='ADMIN')return;
    ensureProductImageStyles();
    const p=data.products.find(p=>p.id===id)||{name:'',sku:'',category:'Khóa học',price:0,type:'SALE',kind:'COURSE',courseKey:'',vatRate:0.1,active:true};
    const kind=id?productKind(p):'COURSE';
    q('#referenceProductModal')?.remove();
    const modal=document.createElement('div');modal.id='referenceProductModal';modal.className='modal-overlay open';
    modal.innerHTML=`<form id="referenceProductForm" class="modal-card" role="dialog" aria-modal="true" aria-labelledby="referenceProductTitle" style="max-height:92dvh;overflow-y:auto;width:min(600px,calc(100vw - 24px))">
      <div class="modal-header"><h3 id="referenceProductTitle">${id?'Sửa':'Thêm'} sản phẩm</h3><button type="button" class="modal-close-btn" data-product-close aria-label="Đóng">×</button></div>
      <div class="modal-body"><div class="grid-2-col" style="grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:16px">
      <div class="form-group"><label for="refProductName">Tên sản phẩm *</label><input id="refProductName" name="name" required maxlength="200" value="${esc(p.name)}"></div>
      <div class="form-group"><label for="refProductSku">Mã SKU</label><input id="refProductSku" name="sku" maxlength="60" value="${esc(p.sku)}"></div>
      <div class="form-group"><label for="refProductKind">Nhóm sản phẩm *</label><select id="refProductKind" name="kind" required aria-describedby="refProductKindHelp">${PRODUCT_KINDS.map(([value,label])=>opt(value,label,kind)).join('')}</select><small id="refProductKindHelp">Quyết định mục doanh thu trong Báo cáo doanh thu.</small></div>
      <div class="form-group"><label for="refProductType">Hình thức *</label><select id="refProductType" name="type">${opt('SALE','Bán',p.type)+opt('RENTAL','Cho thuê',p.type)}</select></div>
      <div class="form-group"><label for="refProductMonths">Gói thuê</label><select id="refProductMonths" name="rentalMonths">${opt('','Chọn gói')+[1,3,6,12].map(n=>opt(String(n),n+' tháng',String(p.rentalMonths))).join('')}</select></div>
      <div class="form-group"><label for="refProductCategory">Danh mục *</label><input id="refProductCategory" name="category" list="refProductCategories" required maxlength="100" value="${esc(p.category)}"><datalist id="refProductCategories">${(data.productCategories||[]).map(c=>opt(c,c)).join('')}</datalist></div>
      <div class="form-group"><label for="refProductPrice">Đơn giá chưa VAT *</label><input id="refProductPrice" name="price" type="number" required min="0" step="1" value="${esc(p.price)}"></div>
      <div class="form-group"><label for="refProductVat">VAT (%)</label><input id="refProductVat" name="vatRate" type="number" required min="0" max="100" step="0.01" value="${esc(Number(p.vatRate ?? 0.1)*100)}" placeholder="10"></div>
      <div class="form-group"><label for="refProductActive">Trạng thái</label><select id="refProductActive" name="active">${opt('true','Hoạt động',String(p.active!==false))+opt('false','Tạm dừng',String(p.active!==false))}</select></div>
      <div class="form-group" style="grid-column:1/-1"><label for="refProductImage">\u1ea2nh s\u1ea3n ph\u1ea9m</label><div class="reference-product-image-picker"><div class="reference-product-image-preview" id="refProductImagePreview">${p.imageData?`<img src="${esc(p.imageData)}" alt="\u1ea2nh s\u1ea3n ph\u1ea9m">`:'<span>Ch\u01b0a c\u00f3 \u1ea3nh</span>'}</div><div class="reference-product-image-actions"><input id="refProductImage" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="refProductImageHelp"><small id="refProductImageHelp">JPG, PNG ho\u1eb7c WEBP. T\u1ed1i \u0111a 2 MB.</small><button type="button" class="btn-action btn-secondary" id="refProductImageRemove" ${p.imageData?'':'hidden'}>X\u00f3a \u1ea3nh</button></div></div></div>
      </div><p id="refProductError" role="alert" style="color:var(--red,#dc2626)"></p></div>
      <div class="modal-footer"><button type="button" class="btn-action btn-secondary" data-product-close>Hủy</button><button type="submit" class="btn-action btn-primary">Lưu sản phẩm</button></div></form>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-product-close]').forEach(n=>n.onclick=()=>{if(!working){modal.remove();refresh(true);}});
    const kindCategory={COURSE:'Khóa học',INDICATOR:'Chỉ báo',VIP:'Nhóm VIP'};
    let lastKind=q('#refProductKind').value;
    const sync=()=>{
      const kindValue=q('#refProductKind').value,category=q('#refProductCategory');
      q('#refProductMonths').disabled=q('#refProductType').value!=='RENTAL';q('#refProductMonths').required=!q('#refProductMonths').disabled;
      // Danh mục đi theo nhóm khi người dùng chưa tự đặt tên khác.
      if(kindValue!==lastKind&&(!category.value.trim()||category.value===kindCategory[lastKind]))category.value=kindCategory[kindValue]||'';
      lastKind=kindValue;
    };
    q('#refProductType').onchange=sync;
    q('#refProductKind').onchange=()=>{const value=q('#refProductKind').value;if(value==='INDICATOR'||value==='VIP')q('#refProductType').value='RENTAL';else if(value==='COURSE')q('#refProductType').value='SALE';sync();};
    sync();
    let selectedImageData='',removeImage=false;
    const imageInput=q('#refProductImage'),imagePreview=q('#refProductImagePreview'),removeImageButton=q('#refProductImageRemove');
    const renderImagePreview=imageData=>{imagePreview.replaceChildren();if(imageData){const image=document.createElement('img');image.src=imageData;image.alt='\u1ea2nh s\u1ea3n ph\u1ea9m xem tr\u01b0\u1edbc';imagePreview.appendChild(image);}else imagePreview.innerHTML='<span>Ch\u01b0a c\u00f3 \u1ea3nh</span>';removeImageButton.hidden=!imageData;};
    imageInput.onchange=async()=>{const file=imageInput.files?.[0];if(!file)return;try{selectedImageData=await prepareProductImage(file);removeImage=false;renderImagePreview(selectedImageData);text('refProductError','');}catch(error){imageInput.value='';text('refProductError',error.message||'Kh\u00f4ng th\u1ec3 d\u00f9ng \u1ea3nh n\u00e0y.');}};
    removeImageButton.onclick=()=>{selectedImageData='';removeImage=true;imageInput.value='';renderImagePreview('');};
    q('#referenceProductForm').onsubmit=async event=>{
      event.preventDefault();if(working)return;working=true;
      const form=event.currentTarget,input=Object.fromEntries(new FormData(form));input.active=input.active==='true';input.kind=q('#refProductKind').value;
      input.imageData=selectedImageData||(removeImage?'':String(p.imageData||''));
      const controls=Array.from(form.elements);controls.forEach(n=>n.disabled=true);text('refProductError','');
      let saved=false;
      try{await api.saveProduct(id,input);modal.remove();saved=true;}
      catch(error){text('refProductError',error.message||'Chưa lưu được sản phẩm.');}
      finally{working=false;controls.forEach(n=>n.disabled=false);if(modal.isConnected)sync();}
      if(saved)refresh(true);
    };
    q('#refProductName').focus();
  }
  function catalog(){
    ensureProductImageStyles();
    const body=q('#tab-products tbody');
    table(body,data.products.map(p=>[p.name,p.sku,PRODUCT_KINDS.find(([kind])=>kind===productKind(p))?.[1]||'Khác',p.type==='RENTAL'?p.rentalMonths+' tháng':'Vĩnh viễn',money(p.price),(Number(p.vatRate??.1)*100).toFixed(2).replace(/\.00$/,'')+'% ('+money(Math.round(p.price*Number(p.vatRate??.1)))+')',p.active===false?'Tạm dừng':p.type==='RENTAL'?'Đang cho thuê':'Đang bán','']));
    Array.from(body.rows).forEach((row,i)=>{
      const p=data.products[i],actions=row.cells[7];
      if(row.cells[1])row.cells[1].hidden=true;
      if(actions){
        actions.replaceChildren();actions.style.whiteSpace='nowrap';
        const edit=document.createElement('button');edit.type='button';edit.className='btn-action btn-secondary';edit.textContent='Sửa';edit.disabled=data.user.role!=='ADMIN';edit.onclick=()=>productModal(p.id);
        const remove=document.createElement('button');remove.type='button';remove.className='btn-action btn-danger';remove.textContent='Xóa';remove.dataset.productDelete=p.id;remove.style.cssText='margin-left:8px;color:#b91c1c;border:1px solid #fecaca;background:#fff;padding:5px 12px;border-radius:6px';remove.disabled=data.user.role!=='ADMIN';remove.onclick=()=>{if(confirm('Xóa sản phẩm "'+p.name+'"? Các đơn hàng cũ vẫn giữ nguyên thông tin đã ghi nhận.'))run(()=>api.removeProduct(p.id),()=>referenceNotice('Đã xóa sản phẩm.'));};
        actions.append(edit,remove);
      }
      const chip=row.cells[6]?.querySelector('.chip');if(chip)chip.className='chip '+(p.active===false?'chip-warm':'chip-green');
    });
    Array.from(body.rows).forEach((row,i)=>{const p=data.products[i],productCell=row.cells[0],nameHost=productCell?.querySelector('.cell-main')||productCell,heading=nameHost?.querySelector('b')||nameHost?.querySelector('strong')||nameHost;if(!p||!heading||heading.querySelector('.reference-product-thumb'))return;const label=document.createElement('span');label.textContent=p.name||'';const thumb=document.createElement(p.imageData?'img':'span');thumb.className='reference-product-thumb';if(p.imageData){thumb.src=p.imageData;thumb.alt='';}else thumb.textContent=String(p.name||'?').trim().slice(0,1).toUpperCase()||'?';const entry=document.createElement('div');entry.className='reference-product-name';entry.append(thumb,label);if(heading===nameHost)nameHost.replaceChildren(entry);else heading.replaceWith(entry);});
    const buttons=qa('#tab-products .headline-row button');buttons.forEach(n=>n.removeAttribute('onclick'));
    buttons[1].onclick=()=>productModal();buttons[1].disabled=data.user.role!=='ADMIN';
    buttons[0].onclick=()=>{q('#referencePriceModal')?.remove();const modal=document.createElement('div');modal.id='referencePriceModal';modal.className='modal-overlay open';modal.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-label="Biểu giá" style="max-height:92dvh;overflow:auto;width:min(800px,calc(100vw - 24px))"><div class="modal-header"><h3>Biểu giá sản phẩm</h3><button class="modal-close-btn" aria-label="Đóng">×</button></div><div class="modal-body table-responsive"><table class="modern-table"><thead><tr><th>Sản phẩm</th><th>Gói</th><th>Chưa VAT</th><th>Gồm VAT</th></tr></thead><tbody>${data.products.filter(p=>p.active!==false).map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+(p.type==='RENTAL'?p.rentalMonths+' tháng':'Vĩnh viễn')+'</td><td>'+money(p.price)+'</td><td>'+money(Number(p.price)+Math.round(p.price*Number(p.vatRate??.1)))+'</td></tr>').join('')}</tbody></table></div></div>`;document.body.appendChild(modal);modal.querySelector('button').onclick=()=>{modal.remove();refresh(true);};};
    const cards=qa('#tab-products .bento-card'),sale=data.products.filter(p=>p.type!=='RENTAL'),rental=data.products.filter(p=>p.type==='RENTAL');
    const stats=[['TỔNG SẢN PHẨM',data.products.length+' sản phẩm','Danh mục hiện tại'],['BÊN BÁN',sale.length+' sản phẩm','Khóa học & sản phẩm bán'],['BÊN THUÊ',rental.length+' sản phẩm','Chỉ báo & công cụ cho thuê'],['ĐANG HOẠT ĐỘNG',data.products.filter(p=>p.active!==false).length+' sản phẩm',data.products.filter(p=>p.active===false).length+' tạm dừng']];
    cards.forEach((card,i)=>Array.from(card.children).forEach((n,j)=>n.textContent=stats[i]?.[j]||''));
  }
  function memberEditor(id=null) {
    if(data.user.role!=='ADMIN')return;const m=data.members.concat(data.registeredAccounts).find(m=>m.id===id)||{name:'',email:'',phone:'',role:'LEADER',teamId:''};
    const protectedRole=!['SALE','LEADER','MANAGER','UNASSIGNED'].includes(m.role),role=m.role==='UNASSIGNED'?'SALE':m.role;
    const roleOptions=protectedRole?[role]:['MANAGER','LEADER','SALE','HRM'];
    const roleLabels={MANAGER:'Manager',LEADER:'Leader',SALE:'Sale',HRM:'Quản trị nhân sự'};
    const modal=editor(id?'Cập nhật thành viên':'Thêm thành viên',formField('Họ tên',`<input id="refMemberName" required maxlength="160" value="${esc(m.name)}">`)+formField('ID tài khoản',`<input id="refMemberAccountId" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" value="${esc(m.accountId||'')}">`)+formField('Số điện thoại',`<input id="refMemberPhone" type="tel" maxlength="20" value="${esc(m.phone)}">`)+formField('Email',`<input id="refMemberEmail" type="email" maxlength="254" value="${esc(m.email)}">`)+formField('Chức vụ',`<select id="refMemberRole" ${protectedRole?'disabled':''}>${roleOptions.map(r=>opt(r,roleLabels[r]||r,role)).join('')}</select>`)+formField('Team (tự động theo Leader)',`<input id="refMemberTeam" maxlength="20" readonly ${protectedRole?'disabled':''} value="${esc(m.teamId)}">`)+formField('Leader trực tiếp',`<select id="refMemberLeader">${opt('','Không áp dụng')+data.members.filter(l=>['LEADER','MANAGER'].includes(l.role)&&l.active!==false&&l.id!==id).map(l=>opt(l.id,l.name+' · '+(l.role==='MANAGER'?'MANAGER':l.teamId),m.leaderId)).join('')}</select>`)+formField('Manager quản lý',`<select id="refMemberManager">${opt('','Chưa giao Manager')+data.members.filter(m=>m.role==='MANAGER'&&m.active!==false&&m.id!==id).map(x=>opt(x.id,x.name,m.managerId)).join('')}</select>`),()=>api.saveMember(id,{name:q('#refMemberName').value,accountId:q('#refMemberAccountId').value,phone:q('#refMemberPhone').value,email:q('#refMemberEmail').value,role:q('#refMemberRole').value,teamId:q('#refMemberTeam').value,leaderId:q('#refMemberLeader').value,managerId:q('#refMemberManager').value}));
    const memberModal=modal.querySelector('.modal-card'),memberBody=modal.querySelector('.modal-body');
    memberModal?.classList.add('member-editor-modal');memberBody?.classList.add('member-editor-body');
    if(memberBody){
      const style=document.createElement('style');style.textContent='.member-editor-modal{width:min(620px,calc(100vw - 24px))!important;max-height:92dvh!important}.member-editor-body{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px!important;padding:16px!important}.member-editor-body .form-group{margin:0!important;min-width:0}.member-editor-body>[data-editor-error]{grid-column:1/-1;margin:0}.member-editor-body input,.member-editor-body select{min-height:40px;padding:9px 11px}.member-editor-body .form-group label{font-size:11px}.member-editor-modal .modal-footer{padding:12px 16px}@media(max-width:560px){.member-editor-body{grid-template-columns:1fr!important;padding:13px!important;gap:10px!important}}';memberBody.appendChild(style);
      const field=id=>document.getElementById(id)?.closest('.form-group');
      if(role==='MANAGER')field('refMemberTeam')?.setAttribute('hidden','');
      if(role!=='SALE')field('refMemberLeader')?.setAttribute('hidden','');
      if(role!=='LEADER')field('refMemberManager')?.setAttribute('hidden','');
    }
    const sync=()=>{
      const memberRole=q('#refMemberRole').value,sale=memberRole==='SALE',leader=memberRole==='LEADER',chosenLeader=q('#refMemberLeader').value;
      const assignedLeader=data.members.find(member=>member.id===chosenLeader&&member.role==='LEADER');
      if(sale&&assignedLeader){q('#refMemberTeam').value=assignedLeader.teamId;q('#refMemberTeam').dataset.manual='leader';}
      q('#refMemberLeader').disabled=!sale;q('#refMemberLeader').required=false;
      q('#refMemberTeam').required=!protectedRole&&memberRole!=='MANAGER';q('#refMemberTeam').disabled=protectedRole||memberRole==='MANAGER';q('#refMemberTeam').readOnly=memberRole!=='MANAGER';
      if((leader||sale)&&!q('#refMemberTeam').value.trim())q('#refMemberTeam').value=teamIdFromName(q('#refMemberName').value);
      q('#refMemberManager').disabled=!(leader||sale&&!chosenLeader);
      q('#refMemberTeam').closest('.form-group').hidden=memberRole==='MANAGER';q('#refMemberLeader').closest('.form-group').hidden=!sale;
      q('#refMemberManager').closest('.form-group').hidden=!(leader||sale&&!chosenLeader);
    };
    q('#refMemberRole').onchange=sync;
    q('#refMemberName').oninput=()=>{if(['LEADER','SALE'].includes(q('#refMemberRole').value)&&!q('#refMemberTeam').dataset.manual)q('#refMemberTeam').value=teamIdFromName(q('#refMemberName').value);};
    q('#refMemberLeader').onchange=()=>{const l=data.members.find(m=>m.id===q('#refMemberLeader').value);if(l){if(l.role==='LEADER')q('#refMemberTeam').value=l.teamId;q('#refMemberTeam').dataset.manual='leader';}sync();};sync();
  }
  function passwordEditor(id){editor('Đặt lại mật khẩu',formField('Mật khẩu mới','<input id="refPassword" type="password" required minlength="8" autocomplete="new-password">')+formField('Nhập lại mật khẩu','<input id="refPasswordConfirm" type="password" required autocomplete="new-password">'),()=>api.resetPassword(id,q('#refPassword').value,q('#refPasswordConfirm').value));}
  function teamHierarchyRelations(members){
    const byId=id=>id==null||id===''?null:members.find(member=>String(member.id)===String(id));
    const leaderOf=member=>{const candidate=member?.role==='LEADER'?member:byId(member?.leaderId);return candidate?.role==='LEADER'?candidate:null;};
    const managerOf=member=>{
      if(!member)return null;if(member.role==='MANAGER')return member;
      const direct=byId(member.managerId),leader=leaderOf(member),inherited=byId(leader?.managerId),supervisor=byId(member.leaderId);
      return direct?.role==='MANAGER'?direct:inherited?.role==='MANAGER'?inherited:supervisor?.role==='MANAGER'?supervisor:null;
    };
    const supervisorOf=member=>member?.role==='SALE'?leaderOf(member)||managerOf(member):member?.role==='LEADER'?managerOf(member):null;
    return {leaderOf,managerOf,supervisorOf};
  }

  // Render cay doi ngu theo thu tu Manager -> Leader -> Sale.
  // Khoi nay chi thay phan hien thi, khong thay doi du lieu hay quyen truy cap.
  // Trạng thái mở/đóng của cây đội ngũ, giữ lại qua mỗi lần refresh 15s. Mặc định thu gọn.
  const teamTreeState={open:new Map()};
  function renderTeamHierarchyV6(){
    const host=q('#teamHierarchyOverview');if(!host||!data?.user)return;
    const role=data.user.actualRole||data.user.role,all=(data.managerHierarchy?.members||data.members||[]).filter(m=>m&&![false,0,'0'].includes(m.active)&&['MANAGER','LEADER','SALE'].includes(m.role)),current=(all.find(m=>String(m.id)===String(data.user.id))||data.user),byId=id=>all.find(m=>String(m.id)===String(id)),members=all,visibleCustomers=data.managerHierarchy?.customers||data.customers||[];
    const same=(a,b)=>String(a??'')===String(b??'');
    const {leaderOf,managerOf,supervisorOf}=teamHierarchyRelations(members);
    const managerLeaders=manager=>members.filter(m=>m.role==='LEADER'&&same(managerOf(m)?.id,manager.id));
    const leaderSales=leader=>members.filter(m=>m.role==='SALE'&&same(leaderOf(m)?.id,leader.id));
    const directManagerSales=manager=>members.filter(m=>m.role==='SALE'&&same(managerOf(m)?.id,manager.id)&&!leaderOf(m));
    const saleCustomers=sale=>visibleCustomers.filter(c=>same(c.saleId,sale.id));
    const managerOwn=manager=>visibleCustomers.filter(c=>same(c.saleId,manager.id)||(!c.saleId&&byId(c.leaderId)?.role!=='LEADER'&&(same(c.managerId,manager.id)||same(c.leaderId,manager.id)||same(c.ownerId,manager.id))));
    const visibleLeaders=role==='ADMIN'||role==='HRM'?members.filter(m=>m.role==='LEADER'):role==='MANAGER'?managerLeaders(current):role==='LEADER'?[current]:leaderOf(current)?[leaderOf(current)]:[];
    const visibleSales=role==='ADMIN'||role==='HRM'?members.filter(m=>m.role==='SALE'):role==='MANAGER'?members.filter(m=>m.role==='SALE'&&managerOf(m)?.id===current.id):role==='LEADER'?leaderSales(current):[current].filter(m=>m.role==='SALE');
    const visibleSaleIds=new Set(visibleSales.map(s=>String(s.id)));
    const shownLeaderSales=leader=>leaderSales(leader).filter(s=>visibleSaleIds.has(String(s.id)));
    // Khách riêng của Leader: Leader tự phụ trách, hoặc gắn Leader mà chưa thuộc Sale nào đang hiển thị trong nhóm.
    const leaderOwn=leader=>{const saleIds=new Set(shownLeaderSales(leader).map(s=>String(s.id)));return visibleCustomers.filter(c=>same(c.saleId,leader.id)||(same(c.leaderId,leader.id)&&!saleIds.has(String(c.saleId||''))));};
    const leaderTotal=leader=>{const ids=new Set(leaderOwn(leader).map(c=>c.id));shownLeaderSales(leader).forEach(s=>saleCustomers(s).forEach(c=>ids.add(c.id)));return ids.size;};
    const initials=name=>String(name||'?').trim().split(/\s+/).slice(-2).map(part=>part[0]||'').join('').toUpperCase()||'?';
    const isOpen=key=>teamTreeState.open.get(key)===true;
    const pill=kind=>'<span class="tt-pill '+kind+'">'+kind.toUpperCase()+'</span>';
    const count=n=>'<span class="tt-count">'+n+' khách</span>';
    const avatar=(kind,label)=>'<span class="tt-avatar '+kind+'" aria-hidden="true">'+esc(label)+'</span>';
    const copy=(title,kind,subtitle)=>'<span class="tt-copy"><span class="tt-title"><b>'+esc(title)+'</b>'+(kind?pill(kind):'')+'</span><small>'+esc(subtitle)+'</small></span>';
    // Cả hàng đầu mục là một nút mở/thu gọn.
    const head=(key,open,inner)=>'<button type="button" class="tt-head" data-tt-toggle="'+esc(key)+'" aria-expanded="'+open+'">'+inner+'<span class="tt-chevron" aria-hidden="true">'+(open?'−':'+')+'</span></button>';
    // Một người: chỉ tên, vai trò và số khách đang phụ trách.
    const personRow=(member,kind,n,subtitle)=>'<div class="tt-card tt-person"><div class="tt-head">'+avatar(kind,initials(member.name))+copy(member.name||'Chưa đặt tên',kind,subtitle)+count(n)+'</div></div>';
    const saleRow=(sale,parentName)=>personRow(sale,'sale',saleCustomers(sale).length,parentName?'Trực thuộc '+parentName:'Sale');
    const leaderGroup=leader=>{
      const key='g:'+leader.id,open=isOpen(key),sales=shownLeaderSales(leader),own=leaderOwn(leader);
      const body=open?'<div class="tt-branch">'+personRow(leader,'leader',own.length,'Leader · khách tự phụ trách')+sales.map(s=>saleRow(s,leader.name)).join('')+'</div>':'';
      return '<section class="tt-card tt-group">'+head(key,open,avatar('leader',initials(leader.name))+copy('Team '+(leader.name||'Chưa đặt tên'),'leader','1 Leader · '+sales.length+' Sale')+count(leaderTotal(leader)))+body+'</section>';
    };
    const managerTeam=manager=>{
      const key='t:'+manager.id,open=isOpen(key),leaders=managerLeaders(manager).filter(l=>visibleLeaders.some(v=>v.id===l.id)),direct=directManagerSales(manager).filter(s=>visibleSaleIds.has(String(s.id))),own=managerOwn(manager);
      const ids=new Set(own.map(c=>c.id));direct.forEach(s=>saleCustomers(s).forEach(c=>ids.add(c.id)));leaders.forEach(l=>{leaderOwn(l).forEach(c=>ids.add(c.id));shownLeaderSales(l).forEach(s=>saleCustomers(s).forEach(c=>ids.add(c.id)));});
      const saleCount=direct.length+leaders.reduce((sum,l)=>sum+shownLeaderSales(l).length,0);
      const body=open?'<div class="tt-branch">'+personRow(manager,'manager',own.length,'Manager · khách tự phụ trách')+direct.map(s=>saleRow(s,manager.name)).join('')+leaders.map(leaderGroup).join('')+'</div>':'';
      return '<section class="tt-team">'+head(key,open,avatar('manager',initials(manager.name))+copy('Team '+(manager.name||'Chưa đặt tên'),'manager',leaders.length+' Leader · '+saleCount+' Sale')+count(ids.size))+body+'</section>';
    };
    const salesTeam=sales=>{const key='o:sales',open=isOpen(key),total=new Set(sales.flatMap(s=>saleCustomers(s).map(c=>c.id))).size;return '<section class="tt-team">'+head(key,open,avatar('sale','S')+copy('Sale độc lập','',sales.length+' Sale')+count(total))+(open?'<div class="tt-branch">'+sales.map(s=>saleRow(s,supervisorOf(s)?.name||'')).join('')+'</div>':'')+'</section>';};
    const roots=[];
    if(role==='ADMIN'||role==='HRM'||role==='MANAGER'){
      const managerRoots=role==='ADMIN'||role==='HRM'?members.filter(m=>m.role==='MANAGER'):[current].filter(m=>m?.role==='MANAGER');
      roots.push(...managerRoots.map(managerTeam));
      // Leader chưa có Manager vẫn hiện như một Team riêng mang tên Leader.
      const assigned=new Set(managerRoots.flatMap(m=>managerLeaders(m).map(l=>l.id)));
      roots.push(...visibleLeaders.filter(l=>!assigned.has(l.id)).map(leaderGroup));
      const shown=new Set([...managerRoots.flatMap(directManagerSales),...visibleLeaders.flatMap(leaderSales)].map(m=>m.id)),orphanSales=visibleSales.filter(s=>!shown.has(s.id));
      if(orphanSales.length)roots.push(salesTeam(orphanSales));
    }else{
      roots.push(...visibleLeaders.map(leaderGroup));
      const shown=new Set(visibleLeaders.flatMap(leaderSales).map(m=>m.id));
      roots.push(...visibleSales.filter(s=>!shown.has(s.id)).map(s=>saleRow(s,supervisorOf(s)?.name||'')));
    }
    const focusKey=document.activeElement?.closest?.('#teamHierarchyOverview')?document.activeElement.dataset?.ttToggle:null;
    host.innerHTML='<div class="team-hierarchy-head"><div><div class="team-hierarchy-title">Sơ đồ phân cấp đội ngũ</div><div class="team-hierarchy-subtitle">Manager → Leader → Sale hoặc Manager → Sale · Bấm vào Team để xem thành viên và số khách</div></div></div><div class="tt-root">'+(roots.join('')||'<div class="tt-empty">Chưa có dữ liệu đội ngũ</div>')+'</div>';
    if(focusKey)host.querySelector('[data-tt-toggle="'+CSS.escape(focusKey)+'"]')?.focus();
    host.onclick=event=>{
      const t=event.target.closest('[data-tt-toggle]');if(!t||!host.contains(t))return;
      teamTreeState.open.set(t.dataset.ttToggle,t.getAttribute('aria-expanded')!=='true');
      renderTeamHierarchyV6();
    };
    const memberCardKpi=qa('#tab-team .kpi-bento-card')[0];if(memberCardKpi){primaryText(memberCardKpi.querySelector('.kpi-hero-num'),members.length);memberCardKpi.querySelectorAll('.kpi-foot-stat .value').forEach((node,index)=>{node.textContent=index===0?members.filter(m=>m.role==='LEADER').length+' người':index===1?members.filter(m=>m.role==='SALE').length+' người':members.length?'100%':'0%';});const online=memberCardKpi.querySelector('.kpi-trend-pill');if(online)online.textContent=members.length+' hoạt động';}
  }

  const hrmUi={search:'',role:'',status:'active',columns:null,lotPeriod:'',attendanceMonth:'',attendanceMember:''};
  const hrmRoleLabel=role=>({ADMIN:'Admin',HRM:'Quản trị nhân sự',MANAGER:'Manager',LEADER:'Leader',SALE:'Sale',MARKETING:'Marketing',ACCOUNTING:'Kế toán',UNASSIGNED:'Chờ phân quyền'})[role]||role;
  const hrmActive=member=>![false,0,'0'].includes(member.active);
  const hrmRoster=()=>data.hrRoster?.length?data.hrRoster:(data.members||[]);
  function ensureHrmMenu(role){
    if(!q('#hrmWorkspaceStyles')){
      const style=document.createElement('style');style.id='hrmWorkspaceStyles';
      style.textContent=`.role-hrm .sidebar nav>div:not(#hrmNavGroup){display:none!important}.role-hrm section.tab-section:not(#tab-hrProfiles):not(#tab-team):not(#tab-attendance):not(#tab-orders):not(#tab-businessReport){display:none!important}.role-hrm .mobile-app-bottom-bar{display:none!important}.hrm-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:15px 18px;border-bottom:1px solid var(--border-light)}.hrm-toolbar input,.hrm-toolbar select{padding:9px 11px;border:1px solid var(--border-light);border-radius:7px;background:var(--bg-surface);color:var(--text-main);max-width:100%}.hrm-toolbar input[type=search]{flex:1;min-width:180px}.hrm-summary{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 18px}.hrm-summary>div{padding:14px 18px;min-width:145px;flex:1;border:1px solid var(--border-light);border-radius:10px;background:var(--bg-surface)}.hrm-summary b{font-size:23px;display:block}.hrm-summary span{font-size:12px;color:var(--text-muted)}.hrm-table th{white-space:nowrap}.hrm-table td{max-width:260px;white-space:normal;overflow-wrap:anywhere}.hrm-table small{display:block;color:var(--text-muted);margin-top:4px}.hrm-table td:first-child{min-width:190px;position:sticky;left:0;background:var(--bg-surface);z-index:1}.hrm-table .hrm-actions{min-width:105px}.hrm-file-row{display:grid;grid-template-columns:1fr 2fr;gap:10px;padding:12px;border:1px solid #dbe3ec;border-radius:9px;margin-top:10px}.hrm-file-row .hrm-file-actions{display:flex;gap:8px;align-items:end}.hrm-file-row input{min-width:0}.hrm-section{padding:15px 0;border-bottom:1px solid #e2e8f0}.hrm-section:first-child{padding-top:0}.hrm-section h4{margin:0 0 13px;color:#0f172a;font-size:14px}.hrm-section p{font-size:12px;color:#64748b;line-height:1.6}.hrm-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hrm-columns label{display:flex;gap:7px;align-items:center}.hrm-table button[data-hrm-sort]{border:0;background:none;font:inherit;color:inherit;font-weight:700;cursor:pointer}@media(max-width:600px){.hrm-file-row,.hrm-columns{grid-template-columns:1fr}.hrm-summary>div{min-width:100px}.hrm-toolbar{padding:12px}.hrm-toolbar input[type=search]{width:100%}}`;
      document.head.appendChild(style);
    }
    let group=q('#hrmNavGroup');
    if(!group){group=document.createElement('div');group.id='hrmNavGroup';group.className='nav-group';q('.sidebar nav')?.appendChild(group);}
    const signature=role==='HRM'?'hrm':'admin';
    if(group.dataset.role!==signature){
      const items=role==='HRM'?[['hrProfiles','Quản trị nhân sự'],['team','Đội ngũ'],['attendance','Điểm danh'],['orders','Đơn hàng'],['businessReport','Nhập lot']]:[['hrProfiles','Quản trị nhân sự']];
      group.innerHTML='<div class="nav-group-title">NHÂN SỰ</div><ul class="nav-list">'+items.map(([id,label])=>'<li><button type="button" class="nav-link" data-tab="tab-'+id+'"><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"></circle><path d="M4 22v-3a8 8 0 0 1 16 0v3"></path></svg><span>'+label+'</span></button></li>').join('')+'</ul>';
      group.dataset.role=signature;
      group.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>switchTab(button.dataset.tab));
    }
    group.hidden=role!=='HRM';
    const profile=q('#tab-hrProfiles');if(profile)profile.hidden=!['ADMIN','HRM'].includes(role);
  }
  function renderMarketingHub() {
    if (!window.MarketingHub || !data) return;
    const host = q('#marketingHost');
    if (!host) return;
    window.MarketingHub.render(host, {
      customers: data.customers || [],
      orders: data.orders || [],
      websites: data.websites || [],
      traffic: data.traffic || [],
      notes: data.notes || [],
      customerFieldHistory: data.customerFieldHistory || [],
      assignmentHistory: data.assignmentHistory || [],
      members: data.members || []
    }, {
      onRefresh: async () => { await api?.refresh(); refresh(true); },
      accountId: data.user?.id,
      demo: data.marketingDemo === true
    });
  }
  function ensureMarketingMenu(role) {
    const isMarketing = role === 'MARKETING';
    const showMenu = isMarketing;
    const marketingGroup = q('#marketingNavGroup');
    if (marketingGroup) {
      marketingGroup.hidden = !showMenu;
      marketingGroup.style.setProperty('display', showMenu ? 'block' : 'none', 'important');
      const btn = marketingGroup.querySelector('[data-tab="tab-marketing"]');
      if (btn && !btn.dataset.wired) {
        btn.dataset.wired = 'true';
        btn.onclick = (e) => {
          e.preventDefault();
          switchTab('tab-marketing');
        };
      }
    }
    document.documentElement.classList.toggle('role-marketing', isMarketing);
    if (isMarketing && !q('#marketingWorkspaceStyles')) {
      const style = document.createElement('style');
      style.id = 'marketingWorkspaceStyles';
      style.textContent = `
        .role-marketing .sidebar-nav > div:not(#marketingNavGroup) { display: none !important; }
        .role-marketing section.tab-section:not(#tab-marketing) {
          display: none !important;
        }
        .role-marketing #marketingNavGroup { display: block !important; }
        .role-marketing .mobile-app-bottom-bar { display: none !important; }
        .role-marketing #topbarBellBtn { display: none !important; }
        .role-marketing #tab-orders .headline-row button,
        .role-marketing #customerTableBody button:not([data-view-only]),
        .role-marketing [data-role-action="create"],
        .role-marketing [data-role-action="edit"] {
          pointer-events: none;
          opacity: 0.6;
        }
      `;
      document.head.appendChild(style);
    }
  }
  function hrmProfileFor(id){return (data.hrProfiles||[]).find(row=>String(row.employeeId)===String(id))||{id,employeeId:id,fields:{},columns:{},driveFiles:[]};}
  function hrmColumns(){return {...HrProfiles.labels,...Object.assign({},...(data.hrProfiles||[]).map(row=>row.columns||{})),...Object.fromEntries((data.hrProfiles||[]).flatMap(row=>Object.keys(row.fields||{})).filter(key=>!HrProfiles.labels[key]).map(key=>[key,(data.hrProfiles||[]).find(row=>row.columns?.[key])?.columns[key]||key]))};}
  function hrmPersonnel(){
    if(!['ADMIN','HRM'].includes(data.user.actualRole||data.user.role))return;
    const host=q('#tab-hrProfiles');if(!host)return;
    const all=hrmRoster().filter(member=>member.role!=='UNASSIGNED'),columns=hrmColumns();
    const visibleKeys=hrmUi.columns||['cccd','address','birthDate','department','startDate','contract'];
    const members=all.filter(member=>(hrmUi.status==='all'||(hrmUi.status==='active'?hrmActive(member):!hrmActive(member)))&&(!hrmUi.role||member.role===hrmUi.role));
    const active=all.filter(hrmActive).length,complete=all.filter(member=>Object.values(hrmProfileFor(member.id).fields||{}).some(Boolean)).length,files=all.reduce((n,member)=>n+(hrmProfileFor(member.id).driveFiles||[]).length,0);
    host.innerHTML='<div class="headline-row"><div><h1>Quản trị nhân sự</h1></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-action btn-secondary" id="hrmDownloadTemplate">Tải mẫu CSV</button><button class="btn-action btn-primary" id="hrmImportCsv">Nhập hồ sơ</button></div></div><div class="hrm-summary"><div><b>'+active+'</b><span>Nhân sự đang hoạt động</span></div><div><b>'+complete+'/'+all.length+'</b><span>Đã bổ sung hồ sơ</span></div><div><b>'+files+'</b><span>Tài liệu đã liên kết</span></div></div><section class="table-container"><div class="hrm-toolbar"><input id="hrmSearch" type="search" aria-label="Tìm nhân sự" placeholder="Tìm tên, ID, SĐT hoặc thông tin hồ sơ" value="'+esc(hrmUi.search)+'"><select id="hrmRoleFilter" aria-label="Vai trò">'+opt('','Tất cả vai trò',hrmUi.role)+[...new Set(all.map(m=>m.role))].map(role=>opt(role,hrmRoleLabel(role),hrmUi.role)).join('')+'</select><select id="hrmStatusFilter" aria-label="Trạng thái">'+[['active','Đang hoạt động'],['inactive','Đã ngừng hoạt động'],['all','Tất cả nhân sự']].map(([v,l])=>opt(v,l,hrmUi.status)).join('')+'</select><button class="btn-action btn-secondary" id="hrmColumnPicker">Chọn cột</button><span id="hrmCount"></span></div><div class="table-responsive"><table class="modern-table hrm-table"><thead><tr><th>Nhân sự</th><th>Chức vụ / Team</th><th>Liên hệ</th>'+visibleKeys.filter(key=>columns[key]).map(key=>'<th>'+esc(columns[key])+'</th>').join('')+'<th>Tài liệu</th><th>Cập nhật</th><th></th></tr></thead><tbody>'+members.map(member=>{const profile=hrmProfileFor(member.id),fields=profile.fields||{};return '<tr data-hrm-person="'+esc(member.id)+'"><td><b>'+esc(member.name||'—')+'</b><small>'+esc(member.accountId||member.id)+(hrmActive(member)?'':' · Đã ngừng hoạt động')+'</small></td><td>'+esc(hrmRoleLabel(member.role))+'<small>'+esc(member.teamId||'—')+'</small></td><td>'+esc(member.phone||'—')+'<small>'+esc(member.email||'—')+'</small></td>'+visibleKeys.filter(key=>columns[key]).map(key=>'<td>'+esc(fields[key]||'—')+'</td>').join('')+'<td>'+((profile.driveFiles||[]).slice(0,2).map(file=>'<a href="'+esc(file.url)+'" target="_blank" rel="noopener noreferrer">'+esc(file.label)+'</a>').join('<br>')||'—')+((profile.driveFiles||[]).length>2?'<small>+'+((profile.driveFiles||[]).length-2)+' tài liệu</small>':'')+'</td><td>'+esc(profile.updatedAt?fmtDate(profile.updatedAt):'Chưa bổ sung')+'</td><td class="hrm-actions"><button type="button" class="btn-action btn-secondary" data-hrm-profile="'+esc(member.id)+'">Mở hồ sơ</button></td></tr>';}).join('')+'</tbody></table><div id="hrmEmpty" class="empty" hidden><b>Không có nhân sự phù hợp</b></div></div></section>';
    const search=()=>{const term=HrProfiles.normalize(hrmUi.search);let count=0;host.querySelectorAll('[data-hrm-person]').forEach(row=>{const member=all.find(m=>m.id===row.dataset.hrmPerson),profile=hrmProfileFor(member.id);row.hidden=Boolean(term&&!HrProfiles.normalize([member.name,member.accountId,member.email,member.phone,...Object.values(profile.fields||{})].join(' ')).includes(term));if(!row.hidden)count++;});text('hrmCount',count+' nhân sự');q('#hrmEmpty').hidden=count>0;};
    q('#hrmSearch').oninput=e=>{hrmUi.search=e.target.value;search();};search();
    q('#hrmRoleFilter').onchange=e=>{hrmUi.role=e.target.value;hrmPersonnel();};q('#hrmStatusFilter').onchange=e=>{hrmUi.status=e.target.value;hrmPersonnel();};
    q('#hrmColumnPicker').onclick=()=>{const modal=editor('Chọn cột hồ sơ','<div class="hrm-columns">'+Object.entries(columns).map(([key,label])=>'<label><input type="checkbox" data-hrm-column="'+esc(key)+'" '+(visibleKeys.includes(key)?'checked':'')+'> '+esc(label)+'</label>').join('')+'</div>',()=>{hrmUi.columns=Array.from(modal.querySelectorAll('[data-hrm-column]:checked'),input=>input.dataset.hrmColumn);hrmPersonnel();});};
    q('#hrmDownloadTemplate').onclick=()=>{const rows=[['ID tài khoản','Họ và tên','Email','CCCD','Địa chỉ thường trú','Ngày sinh','Số tài khoản ngân hàng','Link Drive'],...all.map(member=>[member.accountId||member.id,member.name,member.email||'','','','','',''])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value||'').replace(/^[=+@-]/,"'").replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mau-ho-so-nhan-su.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    q('#hrmImportCsv').onclick=hrmImportDialog;
    host.querySelectorAll('[data-hrm-profile]').forEach(button=>button.onclick=()=>hrmProfileEditor(button.dataset.hrmProfile));
  }
  function hrmImportDialog(){
    let records=[];
    const modal=editor('Nhập hồ sơ từ Lark / Google Sheets','<p>Xuất bảng trên Lark hoặc Google Sheets thành <b>CSV UTF-8</b>, rồi chọn file bên dưới. Dùng ID tài khoản, email hoặc SĐT để ghép đúng nhân viên. Các cột khác tự tạo thành thông tin hồ sơ; ô trống trong file giữ dữ liệu hiện có.</p><label class="crm-field"><span>File CSV · tối đa 2 MB, 500 nhân sự</span><input id="hrmCsvFile" type="file" accept=".csv,text/csv" required></label><div id="hrmCsvPreview" style="margin-top:16px"></div>',async()=>{if(!records.length)throw Error('Chọn file và kiểm tra bảng xem trước.');await api.saveHrProfiles(records);referenceNotice('Đã nhập '+records.length+' hồ sơ.');});
    const save=modal.querySelector('[type=submit]');save.textContent='Xác nhận nhập hồ sơ';save.disabled=true;
    modal.querySelector('#hrmCsvFile').onchange=async e=>{records=[];save.disabled=true;const file=e.target.files?.[0];if(!file)return;const preview=modal.querySelector('#hrmCsvPreview');try{if(file.size>2*1024*1024)throw Error('File CSV tối đa 2 MB.');const parsed=HrProfiles.parseCsv(await file.text());records=HrProfiles.importRecords(parsed,hrmRoster().filter(m=>m.role!=='UNASSIGNED'));preview.innerHTML='<b>'+records.length+' nhân sự đã ghép thành công</b><p>Các ô có dữ liệu sẽ cập nhật hồ sơ hiện tại. Chưa có dữ liệu nào được lưu cho tới khi bấm xác nhận.</p><div class="table-responsive"><table class="modern-table"><thead><tr><th>Nhân sự</th><th>Cột cập nhật</th><th>Tài liệu</th></tr></thead><tbody>'+records.slice(0,10).map(row=>'<tr><td>'+esc(row.displayName)+'</td><td>'+esc(Object.values(row.columns).join(', ')||'—')+'</td><td>'+(row.importDriveUrl?'1 link':'—')+'</td></tr>').join('')+'</tbody></table></div>'+(records.length>10?'<p>Hiển thị 10/'+records.length+' dòng xem trước.</p>':'');save.disabled=false;}catch(error){records=[];preview.textContent=error.message;}};
  }
  function hrmProfileEditor(memberId){
    const member=hrmRoster().find(row=>String(row.id)===String(memberId));if(!member)return;
    const profile=hrmProfileFor(memberId),fields={...profile.fields},columns={...hrmColumns()},keys=[...new Set([...Object.keys(HrProfiles.labels),...Object.keys(fields),...Object.keys(profile.columns||{})])];
    const fieldRow=key=>'<label class="crm-field"><span>'+esc(columns[key]||key)+'</span><'+(key==='note'?'textarea':'input')+' data-hrm-field="'+esc(key)+'" maxlength="4000" '+(key==='note'?'>'+esc(fields[key]||'')+'</textarea>':'value="'+esc(fields[key]||'')+'">')+'</label>';
    const sections=[['Thông tin cá nhân',['cccd','cccdIssuedDate','cccdIssuedPlace','birthDate','gender','address','currentAddress','personalTaxCode']],['Công việc & hợp đồng',['department','position','startDate','contract','contractNumber','contractStart','contractEnd']],['Ngân hàng & liên hệ khẩn cấp',['bankName','bankAccount','bankHolder','emergencyContact','emergencyPhone']],['Thông tin bổ sung',keys.filter(key=>!Object.keys(HrProfiles.labels).filter(k=>k!=='note').includes(key))]];
    const fileRow=file=>'<div class="hrm-file-row" data-hrm-file-row="'+esc(file.id)+'"><label class="crm-field"><span>Tên tài liệu</span><input data-file-label maxlength="160" required value="'+esc(file.label||'')+'" placeholder="Ví dụ: CCCD, hợp đồng"></label><label class="crm-field"><span>Link Drive / tài liệu</span><input data-file-url type="url" maxlength="2000" required value="'+esc(file.url||'')+'" placeholder="https://drive.google.com/..."></label><label class="crm-field"><span>Ghi chú tài liệu</span><input data-file-note maxlength="500" value="'+esc(file.note||'')+'"></label><div class="hrm-file-actions">'+(HrProfiles.safeUrl(file.url||'')?'<a class="btn-action btn-secondary" href="'+esc(file.url)+'" target="_blank" rel="noopener noreferrer">Mở file</a>':'')+'<button type="button" class="btn-action btn-danger" data-file-remove>Xóa link</button></div></div>';
    const modal=editor('Hồ sơ nhân sự · '+member.name,'<div class="hrm-section"><b>'+esc(member.accountId||member.id)+' · '+esc(hrmRoleLabel(member.role))+'</b><p>'+esc(member.phone||'—')+' · '+esc(member.email||'—')+'</p></div>'+sections.map(([title,list])=>'<section class="hrm-section"><h4>'+title+'</h4><div class="crm-form-grid" '+(title==='Thông tin bổ sung'?'id="hrmCustomFields"':'')+'>'+list.map(fieldRow).join('')+'</div>'+(title==='Thông tin bổ sung'?'<div class="hrm-toolbar" style="padding:12px 0;border:0"><input id="hrmNewColumnName" placeholder="Tên cột mới" maxlength="160"><button type="button" class="btn-action btn-secondary" id="hrmAddColumn">+ Thêm cột</button></div><p id="hrmColumnError" role="status"></p>':'')+'</section>').join('')+'<section class="hrm-section"><h4>Tài liệu Drive</h4><p>Upload tài liệu trên Drive rồi dán link vào hồ sơ. Có thể thêm nhiều file, mỗi file có tên và ghi chú riêng.</p><div id="hrmDriveFiles">'+(profile.driveFiles||[]).map(fileRow).join('')+'</div><button type="button" class="btn-action btn-secondary" id="hrmAddDrive" style="margin-top:12px">+ Thêm tài liệu Drive</button></section>',()=>{
      const nextFields=Object.fromEntries(Array.from(modal.querySelectorAll('[data-hrm-field]'),input=>[input.dataset.hrmField,input.value.trim()]));
      const driveFiles=Array.from(modal.querySelectorAll('[data-hrm-file-row]'),row=>({id:row.dataset.hrmFileRow,label:row.querySelector('[data-file-label]').value.trim(),url:row.querySelector('[data-file-url]').value.trim(),note:row.querySelector('[data-file-note]').value.trim()}));
      return api.saveHrProfiles([{employeeId:memberId,fields:nextFields,columns:Object.fromEntries(Object.keys(nextFields).map(key=>[key,columns[key]||key])),driveFiles}]);
    });
    modal.querySelector('.modal-card').style.width='min(900px,calc(100vw - 24px))';
    modal.querySelector('[type=submit]').textContent='Lưu hồ sơ';
    modal.querySelector('#hrmAddColumn').onclick=()=>{const input=modal.querySelector('#hrmNewColumnName'),label=input.value.trim(),key=HrProfiles.columnKey(label);if(!label||keys.length>=200||keys.includes(key)||Object.values(columns).some(value=>HrProfiles.normalize(value)===HrProfiles.normalize(label))){text('hrmColumnError','Nhập tên cột mới, không trùng với cột hiện có.');return;}columns[key]=label;keys.push(key);modal.querySelector('#hrmCustomFields').insertAdjacentHTML('beforeend',fieldRow(key));input.value='';text('hrmColumnError','');};
    modal.querySelector('#hrmAddDrive').onclick=()=>{modal.querySelector('#hrmDriveFiles').insertAdjacentHTML('beforeend',fileRow({id:'HRFILE-'+crypto.randomUUID()}));};
    modal.addEventListener('click',e=>{const button=e.target.closest('[data-file-remove]');if(button)button.closest('[data-hrm-file-row]').remove();});
  }
  function hrmAttendance(){
    const host=q('#tab-attendance');if(!host)return;
    const members=hrmRoster().filter(row=>row.role!=='UNASSIGNED'),month=hrmUi.attendanceMonth||data.today.slice(0,7),memberId=hrmUi.attendanceMember;
    const rows=(data.attendance||[]).filter(row=>(!month||String(row.date||'').startsWith(month))&&(!memberId||row.accountId===memberId)).slice().sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
    const todayRows=new Map((data.attendance||[]).filter(row=>row.date===data.today).map(row=>[row.accountId,row]));
    host.innerHTML='<div class="headline-row"><h1>Điểm danh toàn công ty</h1><span class="chip chip-info">Chỉ xem</span></div><div class="hrm-summary"><div><b>'+members.filter(m=>hrmActive(m)&&todayRows.has(m.id)).length+'/'+members.filter(hrmActive).length+'</b><span>Đã điểm danh hôm nay</span></div><div><b>'+rows.length+'</b><span>Lượt điểm danh trong bộ lọc</span></div><div><b>'+rows.filter(row=>row.late).length+'</b><span>Lượt đi muộn</span></div></div><section class="table-container"><div class="hrm-toolbar"><label>Tháng <input id="hrmAttendanceMonth" type="month" value="'+esc(month)+'"></label><select id="hrmAttendanceMember" aria-label="Chọn nhân sự">'+opt('','Tất cả nhân sự',memberId)+members.map(m=>opt(m.id,m.name+' · '+hrmRoleLabel(m.role),memberId)).join('')+'</select></div><div class="table-responsive"><table class="modern-table hrm-table"><thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Ngày</th><th>Giờ</th><th>Kết quả</th><th>Ghi chú</th><th></th></tr></thead><tbody>'+(rows.map(row=>{const member=members.find(item=>String(item.id)===String(row.accountId));return '<tr><td><b>'+esc(member?.name||row.name||row.accountId)+'</b></td><td>'+esc(hrmRoleLabel(member?.role||''))+'</td><td>'+esc(row.date||'—')+'</td><td>'+esc(String(row.at||'').slice(11,16))+'</td><td><span class="chip '+(row.late?'chip-warm':'chip-green')+'">'+(row.late?'Muộn '+Number(row.lateMinutes||0)+' phút':'Đúng giờ')+'</span></td><td>'+esc(row.note||'—')+'</td><td><button class="btn-action btn-secondary" data-hrm-attendance="'+esc(row.accountId)+'">Lịch sử</button></td></tr>';}).join('')||'<tr><td colspan="7"><div class="empty"><b>Chưa có điểm danh trong bộ lọc</b></div></td></tr>')+'</tbody></table></div></section>';
    q('#hrmAttendanceMonth').onchange=e=>{hrmUi.attendanceMonth=e.target.value;hrmAttendance();};q('#hrmAttendanceMember').onchange=e=>{hrmUi.attendanceMember=e.target.value;hrmAttendance();};host.querySelectorAll('[data-hrm-attendance]').forEach(button=>button.onclick=()=>attendanceDetailModal(button.dataset.hrmAttendance));
  }
  function hrmLots(){
    const host=q('#tab-businessReport');if(!host)return;
    const period=hrmUi.lotPeriod||data.today.slice(0,7),members=hrmRoster().filter(row=>hrmActive(row)&&['MANAGER','LEADER','SALE'].includes(row.role)),rows=members.map(member=>({member,metric:(data.brokerageMetrics||[]).find(row=>row.memberId===member.id&&row.period===period)||{basicLots:0,miniLots:0,microLots:0}}));
    host.innerHTML='<div class="headline-row"><h1>Nhập lot</h1><label>Tháng <input id="hrmLotPeriod" type="month" value="'+esc(period)+'"></label></div><section class="table-container"><div class="table-responsive"><table class="modern-table"><thead><tr><th>Nhân sự</th><th>Vai trò / Team</th><th>Basic lot</th><th>Mini lot</th><th>Micro lot</th><th>Cập nhật</th><th></th></tr></thead><tbody>'+rows.map(row=>'<tr><td><b>'+esc(row.member.name)+'</b><small>'+esc(row.member.accountId||row.member.id)+'</small></td><td>'+esc(hrmRoleLabel(row.member.role))+' · '+esc(row.member.teamId||'—')+'</td><td>'+Number(row.metric.basicLots||0)+'</td><td>'+Number(row.metric.miniLots||0)+'</td><td>'+Number(row.metric.microLots||0)+'</td><td>'+esc(row.metric.updatedAt?fmtDate(row.metric.updatedAt):'Chưa nhập')+'</td><td><button class="btn-action btn-secondary" data-hrm-lot="'+esc(row.member.id)+'">Nhập / sửa lot</button></td></tr>').join('')+'</tbody></table></div></section>';
    q('#hrmLotPeriod').onchange=e=>{hrmUi.lotPeriod=e.target.value;hrmLots();};host.querySelectorAll('[data-hrm-lot]').forEach(button=>button.onclick=()=>{const {member,metric}=rows.find(row=>row.member.id===button.dataset.hrmLot);editor('Nhập lot · '+member.name+' · '+period,'<div class="crm-form-grid">'+['basic','mini','micro'].map(key=>'<label class="crm-field"><span>'+key[0].toUpperCase()+key.slice(1)+' lot</span><input id="hrmLot-'+key+'" type="number" required min="0" step="any" value="'+Number(metric[key+'Lots']||0)+'"></label>').join('')+'</div>',()=>api.saveBrokerageMetric({memberId:member.id,period,basicLots:q('#hrmLot-basic').value,miniLots:q('#hrmLot-mini').value,microLots:q('#hrmLot-micro').value}));});
  }

  function team(){
    const bodies=qa('#tab-team tbody'),role=data.user.actualRole||data.user.role;
    const pendingPanel=bodies[0]?.closest('.table-container');
    if(pendingPanel){
      const isAdmin=role==='ADMIN';
      pendingPanel.hidden=!isAdmin;
      pendingPanel.style.setProperty('display',isAdmin?'':'none','important');
    }
    const pending=role==='ADMIN'?data.registeredAccounts.filter(m=>m.role==='UNASSIGNED'):[];
    const availableMembers=(role==='HRM'?(data.hrRoster||data.members||[]):(data.managerHierarchy?.members||data.members||[])).filter(m=>m&&m.active!==false&&m.active!==0&&m.active!=='0');
    const memberById=id=>availableMembers.find(member=>String(member.id)===String(id));
    const {leaderOf:leaderForMember,managerOf:managerForMember,supervisorOf:supervisorForMember}=teamHierarchyRelations(availableMembers);
    const scopedMembers=role==='ADMIN'||role==='HRM'
      ?availableMembers.filter(member=>role==='HRM'?member.role!=='UNASSIGNED':['MANAGER','LEADER','SALE'].includes(member.role))
      :role==='MANAGER'
        ?availableMembers.filter(member=>member.id===data.user.id||managerForMember(member)?.id===data.user.id)
        :role==='LEADER'
          ?availableMembers.filter(member=>member.id===data.user.id||leaderForMember(member)?.id===data.user.id)
          :availableMembers.filter(member=>member.id===data.user.id);
    const members=scopedMembers.sort((a,b)=>({ADMIN:0,MANAGER:1,LEADER:2,SALE:3}[a.role]??3)-({ADMIN:0,MANAGER:1,LEADER:2,SALE:3}[b.role]??3)||String(a.name||'').localeCompare(String(b.name||''),'vi'));
    const managerTeamLabel=m=>{const teams=[...new Set(availableMembers.filter(x=>x.active!==false&&x.role==='LEADER'&&managerForMember(x)?.id===m.id).map(x=>String(x.teamId||'').trim()).filter(Boolean))];return teams.length?teams.join(', '):String(m.teamId||'').trim()||'Chua gan Team';};
    renderTeamHierarchyV6();

    const start=q('#teamStartDate')?.value,end=q('#teamEndDate')?.value;
    const revenue=m=>(data.managerHierarchy?.financialEvents||data.financialEvents).filter(e=>(!start||e.occurredAt?.slice(0,10)>=start)&&(!end||e.occurredAt?.slice(0,10)<=end)&&(data.managerHierarchy?.orders||data.orders).some(o=>o.id===e.orderId&&(m.role==='LEADER'?o.leaderId===m.id:o.saleId===m.id))).reduce((s,e)=>s+Number(e.amount||0),0);
    const customers=m=>(data.managerHierarchy?.customers||data.customers).filter(c=>m.role==='MANAGER'?(c.ownerId===m.id||c.saleId===m.id):m.role==='LEADER'?(c.saleId===m.id||(c.leaderId===m.id&&!c.saleId)):c.saleId===m.id).length;
    table(bodies[0],pending.map(m=>[m.name,m.phone,m.email,'Chờ phân chức vụ','']));
    Array.from(bodies[0]?.rows||[]).forEach((r,i)=>{const b=r.querySelector('button');if(b){b.removeAttribute('onclick');b.onclick=()=>memberEditor(pending[i].id);b.disabled=data.user.role!=='ADMIN';}});
    const teamColumnName=m=>{
      if(m.role==='MANAGER')return 'Team '+managerTeamLabel(m)+' (manager)';
      const leader=leaderForMember(m),manager=managerForMember(m);
      return leader?'Team '+(leader.name||'Chưa đặt tên')+' (leader)':manager?'Team '+(manager.name||'Chưa đặt tên')+' (manager)':m.role==='SALE'?'Sale độc lập':m.teamId?'Team '+m.teamId:'Chưa phân Team';
    };
    table(bodies[1],members.map(m=>[m.name+(m.phone?' · '+m.phone:''),m.role,teamColumnName(m),supervisorForMember(m)?person(supervisorForMember(m).id):'—',customers(m),money(revenue(m)),'']));
    Array.from(bodies[1]?.rows||[]).forEach((r,i)=>{const m=members[i],buttons=r.querySelectorAll('button');buttons.forEach(b=>{b.removeAttribute('onclick');b.disabled=data.user.role!=='ADMIN';});if(buttons[0])buttons[0].onclick=()=>memberEditor(m.id);if(buttons[1]){buttons[1].onclick=()=>passwordEditor(m.id);buttons[1].disabled=data.user.role!=='ADMIN'||!m.loginEnabled;}if(buttons[2]){buttons[2].disabled=data.user.role!=='ADMIN'||!['SALE','LEADER'].includes(m.role)||m.id===data.user.id;buttons[2].onclick=()=>{if(confirm('Xóa thành viên khỏi đội ngũ và thu hồi khách theo quy trình hiện có?'))run(()=>api.removeMember(m.id));};}});
    if(role==='HRM'){Array.from(bodies[1]?.rows||[]).forEach(row=>row.querySelectorAll('button').forEach(button=>button.hidden=true));qa('#tab-team .kpi-bento-card').slice(1).forEach(card=>card.hidden=true);}
    const add=q('#tab-team .headline-row button');if(add){add.removeAttribute('onclick');add.onclick=()=>memberEditor();add.disabled=data.user.role!=='ADMIN';}
    const description=bodies[0]?.closest('.table-container')?.querySelector('.table-head-bar > div > div');if(description)description.textContent='Admin phân chức vụ trước khi tài khoản được sử dụng.';
    const cards=qa('#tab-team .kpi-bento-card');
    const scopedCustomers=data.managerHierarchy?.customers||data.customers||[];
    const scopedOrders=data.managerHierarchy?.orders||data.orders||[];
    const scopedEvents=data.managerHierarchy?.financialEvents||data.financialEvents||[];
    const scopedTasks=data.managerHierarchy?.tasks||data.tasks||[];
    const inRange=value=>(!start||String(value||'').slice(0,10)>=start)&&(!end||String(value||'').slice(0,10)<=end);
    const eventOrderIds=new Set(scopedOrders.map(order=>order.id));
    const teamRevenueValue=money(scopedEvents.filter(event=>eventOrderIds.has(event.orderId)&&inRange(event.occurredAt)).reduce((sum,event)=>sum+Number(event.amount||0),0));
    const activeTasks=scopedTasks.filter(task=>task.status!=='DONE');
    const parseDate=value=>{const raw=String(value||'').trim();if(!raw)return NaN;const normalized=raw.includes('T')?raw:raw.replace(' ','T');return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)?normalized:normalized+'+07:00');};
    const isOverdue=task=>task.status==='OVERDUE'||(task.status!=='DONE'&&Number.isFinite(parseDate(task.dueAt))&&parseDate(task.dueAt)<Date.now());
    const overdueTasks=activeTasks.filter(task=>inRange(task.dueAt||task.createdAt)&&isOverdue(task));
    const assignedCustomers=scopedCustomers.filter(customer=>[customer.saleId,customer.leaderId,customer.managerId,customer.ownerId,customer.teamId].some(Boolean));
    const calledCustomers=assignedCustomers.filter(customer=>['Đã gọi được','Đã gọi','Đã kết nối'].includes(customer.customFields?.callStatus)||customer.customFields?.callStatus==='Đã gọi được');
    const paidOrders=scopedOrders.filter(order=>inRange(order.paidAt||order.createdAt)&&['PAID','COURSE_GRANTED'].includes(order.status));
    const target=members.filter(member=>member.role==='SALE').reduce((sum,member)=>sum+Number(member.target||0),0);
    const progress=target?Math.min(100,scopedEvents.filter(event=>eventOrderIds.has(event.orderId)&&inRange(event.occurredAt)).reduce((sum,event)=>sum+Number(event.amount||0),0)/target*100):0;
    const metrics=[members.length,teamRevenueValue,assignedCustomers.length,overdueTasks.length];
    cards.forEach((card,i)=>{primaryText(card.querySelector('.kpi-hero-num'),metrics[i]);});
    cards[0]?.querySelectorAll('.kpi-foot-stat .value').forEach((node,i)=>{if(i===0)node.textContent=members.filter(member=>member.role==='LEADER').length+' người';else if(i===1)node.textContent=members.filter(member=>member.role==='SALE').length+' người';else node.textContent=members.length?'100%':'0%';});
    const online=cards[0]?.querySelector('.kpi-trend-pill');if(online)online.textContent=members.length+' hoạt động';
    const foot=(i,values)=>cards[i]?.querySelectorAll('.kpi-foot-stat .value').forEach((n,j)=>n.textContent=values[j]);
    foot(1,[paidOrders.length+' đơn',target?money(target):'Chưa đặt',target?progress.toFixed(1)+'%':'—']);
    foot(2,[assignedCustomers.length+' khách',(scopedCustomers.length-assignedCustomers.length)+' khách',assignedCustomers.length?(calledCustomers.length/assignedCustomers.length*100).toFixed(1)+'%':'—']);
    const overdueAge=task=>{const due=parseDate(task.dueAt);return Number.isFinite(due)?Math.max(0,Date.now()-due):0;};
    foot(3,[overdueTasks.filter(task=>overdueAge(task)>=86400000).length,overdueTasks.filter(task=>overdueAge(task)>=172800000).length,activeTasks.length?((activeTasks.length-overdueTasks.length)/activeTasks.length*100).toFixed(1)+'%':'—']);
    const exportButton=qa('#tab-team button').find(b=>b.textContent.trim()==='Xuất CSV');if(exportButton){exportButton.removeAttribute('onclick');exportButton.onclick=()=>{const rows=[['Họ tên','SĐT','Email','Chức vụ','Team','Khách hàng','Doanh thu'],...members.map(m=>[m.name,m.phone,m.email,m.role,m.teamId,customers(m),revenue(m)])];const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'").replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='doi-ngu.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};}
    const hierarchyStats=(data.managerHierarchy?.members||data.members||[]).filter(member=>member.active!==false&&['MANAGER','LEADER','SALE'].includes(member.role));
    const memberCard=qa('#tab-team .kpi-bento-card')[0];
    if(memberCard){
      primaryText(memberCard.querySelector('.kpi-hero-num'),hierarchyStats.length);
      memberCard.querySelectorAll('.kpi-foot-stat .value').forEach((node,index)=>{node.textContent=index===0?hierarchyStats.filter(member=>member.role==='LEADER').length+' người':index===1?hierarchyStats.filter(member=>member.role==='SALE').length+' người':hierarchyStats.length?'100%':'0%';});
      const online=memberCard.querySelector('.kpi-trend-pill');if(online)online.textContent=hierarchyStats.length+' Online';
    }
  }
  function announcementEditor(){
    styleTelegramStudio();
    q('#referenceEditor')?.remove();
    const modal=document.createElement('div');
    modal.id='referenceEditor';
    modal.className='modal-overlay open';
    modal.innerHTML=`
      <div class="modal-card telegram-admin-studio" role="dialog" aria-modal="true" aria-labelledby="refEditorTitle">
        <div class="telegram-studio-head">
          <div class="telegram-studio-head-main">
            <span class="telegram-studio-icon">📢</span>
            <div>
              <h3 id="refEditorTitle">Tạo thông báo Telegram</h3>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button type="button" class="modal-close-btn" data-editor-close aria-label="Đóng">&times;</button>
          </div>
        </div>
        <div class="telegram-studio-body">
          <div class="telegram-presets-heading">
            <span>Mẫu thông báo</span>
            <button type="button" data-telegram-reset>Tự soạn</button>
          </div>
          <div data-telegram-presets></div>
          <form data-telegram-form>
            <input type="hidden" data-telegram-type value="MEETING">
            <div class="telegram-form-top">
              <div style="display:flex;align-items:center;gap:8px">
                <span data-telegram-active-badge class="telegram-active-badge" data-tone="blue"><span>📅</span> <span>Họp tổng tuần</span></span>
              </div>
              <label style="font-size:12px;font-weight:700;color:#334155;display:flex;align-items:center;gap:8px;margin:0">
                <span>Người nhận</span>
                <select data-telegram-target style="min-height:36px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-weight:700;color:#1e293b;width:auto">
                  <option value="ALL">🌐 Toàn bộ Agency (Sale + Leader + Manager)</option>
                  <option value="SALE">💼 Chỉ Đội ngũ Sales / Tư vấn</option>
                  <option value="MANAGERS">🎖️ Chỉ Ban Quản Lý (Leader & Manager)</option>
                </select>
              </label>
            </div>
            <label style="display:block;margin-top:12px;font-size:12.5px;font-weight:800;color:#1e335f">Tiêu đề</label>
            <input required maxlength="200" data-telegram-title placeholder="Nhập tiêu đề">
            <div data-telegram-meeting class="telegram-meeting-box">
              <label style="font-size:12px;font-weight:700;color:#1e3a8a">
                Thời gian họp
                <input data-telegram-time placeholder="VD: 16:30 chiều nay">
              </label>
              <label style="font-size:12px;font-weight:700;color:#1e3a8a">
                Link họp
                <input data-telegram-link placeholder="meet.google.com/...">
              </label>
              <div class="telegram-meeting-reminder">
                <div class="telegram-meeting-reminder-copy">
                  <span><strong>Nhắc lịch</strong></span>
                </div>
                <select data-telegram-remind>
                  <option value="15">⏰ Nhắc trước 15 phút (Khuyên dùng)</option>
                  <option value="30">⏰ Nhắc trước 30 phút</option>
                  <option value="45">⏰ Nhắc trước 45 phút</option>
                  <option value="60">⏰ Nhắc trước 1 tiếng</option>
                  <option value="120">⏰ Nhắc trước 2 tiếng</option>
                  <option value="0">❌ Không nhắc</option>
                </select>
              </div>
            </div>
            <label style="display:block;margin-top:12px;font-size:12.5px;font-weight:800;color:#1e335f">
              Người gửi
              <input data-telegram-host value="Ban Quản Trị NVT Agency">
            </label>
            <label style="display:block;margin-top:12px;font-size:12.5px;font-weight:800;color:#1e335f">
              Nội dung
              <textarea required maxlength="4000" rows="4" data-telegram-content></textarea>
            </label>
            <div class="telegram-send-row"><div style="display:flex;justify-content:flex-end;gap:8px;width:100%">
                <button type="button" class="btn-secondary" data-editor-close>Đóng</button>
                <button type="submit" class="btn-primary" data-telegram-send>Gửi thông báo</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-editor-close]').forEach(btn=>btn.onclick=()=>modal.remove());
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    const form=modal.querySelector('[data-telegram-form]');
    const presetsContainer=modal.querySelector('[data-telegram-presets]');
    Object.entries(telegramTemplates).forEach(([key,item])=>{
      const b=document.createElement('button');
      b.type='button';
      b.dataset.telegramPreset=key;
      b.dataset.tone=item.tone;
      b.innerHTML='<div class="preset-top"><span class="preset-icon">'+item.icon+'</span><span class="preset-badge">'+item.badge+'</span></div><strong class="preset-title">'+item.title+'</strong><span class="preset-desc">'+item.desc+'</span>';
      b.onclick=()=>{
        modal.querySelectorAll('[data-telegram-preset]').forEach(n=>n.classList.remove('is-selected'));
        b.classList.add('is-selected');
        const typeInput=modal.querySelector('[data-telegram-type]');
        if(typeInput)typeInput.value=item.type;
        modal.querySelector('[data-telegram-target]').value=item.target;
        modal.querySelector('[data-telegram-title]').value=item.title;
        modal.querySelector('[data-telegram-content]').value=item.content;
        const timeInput=modal.querySelector('[data-telegram-time]');if(timeInput)timeInput.value=item.time||'';
        const linkInput=modal.querySelector('[data-telegram-link]');if(linkInput)linkInput.value=item.link||'';
        const hostInput=modal.querySelector('[data-telegram-host]');if(hostInput)hostInput.value=item.host||'Ban Quản Trị NVT Agency';
        toggleTelegramMeeting(modal);
      };
      presetsContainer.appendChild(b);
    });
    modal.querySelector('[data-telegram-reset]').onclick=()=>{
      modal.querySelectorAll('[data-telegram-preset]').forEach(n=>n.classList.remove('is-selected'));
      const typeInput=modal.querySelector('[data-telegram-type]');
      if(typeInput)typeInput.value='CUSTOM';
      modal.querySelector('[data-telegram-title]').value='';
      modal.querySelector('[data-telegram-content]').value='';
      const timeInput=modal.querySelector('[data-telegram-time]');if(timeInput)timeInput.value='';
      const linkInput=modal.querySelector('[data-telegram-link]');if(linkInput)linkInput.value='';
      toggleTelegramMeeting(modal);
      modal.querySelector('[data-telegram-title]')?.focus();
    };
    presetsContainer.querySelector('[data-telegram-preset="meeting_weekly"]')?.click();
    form.onsubmit=e=>{
      e.preventDefault();
      const get=s=>modal.querySelector(s)?.value?.trim()||'';
      const remindSelect=modal.querySelector('[data-telegram-remind]');
      const title=get('[data-telegram-title]'), content=get('[data-telegram-content]');
      run(async ()=>{
        const res=await api.telegramBroadcast({
          type:get('[data-telegram-type]'),target:get('[data-telegram-target]'),title:title,content:content,host:get('[data-telegram-host]'),
          meeting_time:modal.querySelector('[data-telegram-time]')?.value||null,meeting_link:get('[data-telegram-link]'),remind_minutes:remindSelect?Number(remindSelect.value):0
        });
        try{await api.announce({title:title,text:content});}catch(_){}
        return res;
      },(result)=>{
        referenceNotice(`Đã bắn thông báo Telegram và lưu hệ thống CRM tới ${result?.sent||0} tài khoản.`);
        modal.remove();refresh(true);
      });
    };
  }
  function notificationSettings(){
    const keys={dataBotToken:'Bot báo data · Token',dataBotChatId:'Bot báo data · Chat ID',memberBotToken:'Bot báo thành viên · Token',memberBotChatId:'Bot báo thành viên · Chat ID'};
    editor('Cài đặt thông báo',Object.entries(keys).map(([key,label])=>formField(label,`<input id="ref-${key}" type="${key.endsWith('Token')?'password':'text'}" autocomplete="off" value="${esc(data.settings[key]||'')}">`)).join(''),()=>api.settings(Object.fromEntries(Object.keys(keys).map(k=>[k,q('#ref-'+k).value.trim()]))));
  }
  const telegramTemplates={
    meeting_weekly:{type:'MEETING',title:'Họp tổng kết tuần & Trao thưởng Top 1 Doanh số',content:'Toàn bộ nhân sự Sale và Leader có mặt đúng giờ để tổng kết kết quả kinh doanh tuần qua, phổ biến mục tiêu tuần mới và trao thưởng nóng cho các cá nhân xuất sắc.',time:'16:30 chiều nay',link:'meet.google.com/nvt-agency-meet',host:'Ban Giám Đốc NVT Agency',target:'ALL',icon:'📅',badge:'Lịch họp',desc:'Tổng kết số & trao thưởng',tone:'blue'},
    reward_fast:{type:'REWARD',title:'Chính sách thưởng nóng: Chốt cọc trong vòng 2 giờ!',content:'Từ hôm nay, bất kỳ đơn hàng nào được Sale tiếp nhận và chốt cọc thành công trong vòng 2 tiếng sẽ được nhận THƯỞNG NÓNG 500.000 VNĐ + cộng thêm 5% hoa hồng trực tiếp!',time:'',link:'',host:'Ban Quản Trị NVT Agency',target:'SALE',icon:'⚡',badge:'Thưởng nóng',desc:'+5% hoa hồng trong 2h',tone:'green'},
    honor_bestseller:{type:'REWARD',title:'VINH DANH BEST SELLER TUẦN: BÙNG NỔ 120 TRIỆU DOANH SỐ!',content:'Nhiệt liệt biểu dương chiến binh xuất sắc đã cán mốc doanh số ấn tượng nhất tuần qua. Tinh thần kỷ luật và bám sát khách hàng của bạn là tấm gương cho toàn Agency noi theo! 🔥',time:'',link:'',host:'Ban Giám Đốc & Khối Kinh Doanh',target:'ALL',icon:'🏆',badge:'Vinh danh',desc:'Khen thưởng bão đơn tuần',tone:'amber'},
    stale_warning:{type:'WARNING',title:'CẢNH BÁO: XỬ LÝ DỨT ĐIỂM DATA NÓNG TỒN ĐỌNG TRƯỚC 18H00',content:'Hiện tại hệ thống phát hiện vẫn còn một số data nhận từ sáng chưa được cập nhật cuộc gọi hoặc ghi chú. Yêu cầu toàn bộ Sale liên hệ ngay trước 18h00 để tránh hệ thống tự động thu hồi về hàng chờ.',time:'Trước 18:00 hôm nay',link:'',host:'Bộ Phận Vận Hành & Trưởng Nhóm Sale',target:'SALE',icon:'⚠️',badge:'Cảnh báo',desc:'Yêu cầu dứt điểm trước 18h',tone:'red'},
    morning_motivation:{type:'MOTIVATION',title:'CHÚC TOÀN THỂ NVT AGENCY TUẦN MỚI BÃO ĐƠN & BỨT PHÁ!',content:'Thị trường đang có những tín hiệu rất đẹp, data khách hàng quan tâm khóa học và chỉ báo đang đổ về liên tục. Chúc anh em Sale tuần này bội thu doanh số và đạt mốc thưởng cao nhất! 🚀',time:'',link:'',host:'Ban Lãnh Đạo Agency',target:'ALL',icon:'🚀',badge:'Động viên',desc:'Khí thế bứt phá đầu tuần',tone:'purple'},
    emergency_meet:{type:'MEETING',title:'HỌP KHẨN CẤP: TRIỂN KHAI CHIẾN DỊCH QUẢNG CÁO MỚI',content:'Họp khẩn toàn bộ Leader và Sale để cập nhật kịch bản chốt đơn cho luồng data mới từ TikTok và Google Ads.',time:'14:00 hôm nay (Bắt buộc)',link:'meet.google.com/nvt-khan-cap',host:'CEO & Marketing Director',target:'MANAGERS',icon:'🚨',badge:'Khẩn cấp',desc:'Họp Leader & Sale gấp',tone:'red'}
  };
  function toggleTelegramMeeting(root){
    if(!root)root=q('#adminTelegramStudio');
    if(!root)return;
    const type=root.querySelector('[data-telegram-type]')?.value||'CUSTOM';
    const isMeeting=type==='MEETING';
    const meetingBox=root.querySelector('[data-telegram-meeting]');
    if(meetingBox){
      meetingBox.classList.toggle('is-hidden',!isMeeting);
      meetingBox.style.setProperty('display',isMeeting?'grid':'none','important');
    }
    const form=root.querySelector('[data-telegram-form]');
    const activePreset=root.querySelector('[data-telegram-preset].is-selected');
    const tone=activePreset?.dataset?.tone||(isMeeting?'blue':'default');
    if(form)form.dataset.tone=tone;
    const activeBadge=root.querySelector('[data-telegram-active-badge]');
    if(activeBadge){
      if(activePreset){
        const icon=activePreset.querySelector('.preset-icon')?.textContent||'📢';
        const title=activePreset.querySelector('.preset-title')?.textContent||'';
        activeBadge.innerHTML='<span>'+icon+'</span> <span>'+esc(title)+'</span>';
        activeBadge.dataset.tone=tone;
      }else{
        activeBadge.innerHTML='<span>✏️</span> <span>Tự soạn nội dung</span>';
        activeBadge.dataset.tone='default';
      }
    }
  }
  function styleTelegramStudio(root){
    if(!q('#telegramAdminStudioStyles')){const style=document.createElement('style');style.id='telegramAdminStudioStyles';style.textContent=`
      .telegram-admin-studio{font-family:Arial,"Segoe UI",sans-serif!important;font-size:13px!important;margin:0 0 24px!important;padding:0!important;border:1.5px solid #c7d2fe!important;border-radius:18px!important;background:#f8fafc!important;overflow:hidden;box-shadow:0 8px 24px rgba(37,99,235,.06)!important;color:#13224f}
      #referenceEditor .modal-card.telegram-admin-studio{width:min(780px,calc(100vw - 28px))!important;max-height:92dvh!important;overflow-y:auto!important;border-radius:20px!important;box-shadow:0 20px 50px rgba(15,23,42,.22),0 0 0 1px rgba(99,102,241,.1)!important;background:#fff!important}
      .telegram-admin-studio .telegram-studio-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;flex-wrap:wrap!important;padding:14px 18px!important;background:linear-gradient(120deg,#f5f3ff,#eef4ff)!important;border-bottom:1px solid #e2e8f0!important}
      .telegram-admin-studio .telegram-studio-head-main{display:flex!important;align-items:center!important;gap:12px!important}
      .telegram-admin-studio .telegram-studio-icon{width:38px!important;height:38px!important;display:grid!important;place-items:center!important;border-radius:10px!important;background:linear-gradient(145deg,#8b1eea,#5b22d8)!important;color:#fff!important;font-size:20px!important;box-shadow:0 6px 14px rgba(99,42,216,.25)!important;flex-shrink:0!important}
      .telegram-admin-studio h2,.telegram-admin-studio h3{margin:0!important;color:#111b3f!important;font-size:18px!important;font-family:Arial,"Segoe UI",sans-serif!important;font-weight:800!important;line-height:1.25!important}
      .telegram-admin-studio .telegram-subtitle,.telegram-admin-studio .telegram-admin-tag{display:none!important}
      .telegram-admin-studio .telegram-admin-tag{padding:6px 12px!important;border:1px solid #dfc8fa!important;border-radius:8px!important;background:#f2e7ff!important;color:#6d2bb1!important;font-size:11px!important;font-weight:900!important;letter-spacing:.3px!important}
      .telegram-admin-studio .modal-close-btn{width:32px!important;height:32px!important;display:grid!important;place-items:center!important;border-radius:8px!important;background:transparent!important;border:none!important;font-size:24px!important;color:#64748b!important;cursor:pointer!important;line-height:1!important;transition:all .15s ease!important}
      .telegram-admin-studio .modal-close-btn:hover{background:#e2e8f0!important;color:#0f172a!important}
      .telegram-admin-studio .telegram-studio-body{padding:14px 18px 18px!important;background:#f8fafc!important}
      .telegram-admin-studio .telegram-presets-heading{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin-bottom:8px!important;color:#334155!important;font-size:13px!important;font-weight:800!important;text-transform:none!important;letter-spacing:0!important}
      .telegram-admin-studio [data-telegram-reset]{border:0!important;background:none!important;color:#6d28d9!important;font:700 12px inherit!important;cursor:pointer!important;padding:4px 6px!important;border-radius:6px!important;display:inline-flex!important;align-items:center!important;gap:4px!important;transition:background .15s ease!important}
      .telegram-admin-studio [data-telegram-reset]:hover{background:#ede9fe!important}
      .telegram-admin-studio [data-telegram-presets]{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;margin:0 0 12px!important}
      @media(max-width:680px){.telegram-admin-studio [data-telegram-presets]{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media(max-width:440px){.telegram-admin-studio [data-telegram-presets]{grid-template-columns:1fr!important}}
      .telegram-admin-studio [data-telegram-preset]{position:relative!important;display:flex!important;flex-direction:column!important;justify-content:space-between!important;min-height:78px!important;padding:9px 11px!important;border:1.5px solid #e2e8f0!important;border-radius:10px!important;background:#fff!important;cursor:pointer!important;text-align:left!important;transition:all .16s ease!important;box-shadow:0 1px 3px rgba(0,0,0,.04)!important;color:#1e293b!important;font-family:inherit!important}
      .telegram-admin-studio [data-telegram-preset]:hover{transform:translateY(-2px)!important;box-shadow:0 6px 14px rgba(15,23,42,.08)!important}
      .telegram-admin-studio [data-telegram-preset] .preset-top{display:flex!important;align-items:center!important;justify-content:space-between!important;width:100%!important;margin-bottom:6px!important}
      .telegram-admin-studio [data-telegram-preset] .preset-icon{font-size:18px!important;line-height:1!important}
      .telegram-admin-studio [data-telegram-preset] .preset-badge{display:inline-block!important;padding:2.5px 7px!important;border-radius:6px!important;font-size:10.5px!important;font-weight:800!important;line-height:1.2!important}
      .telegram-admin-studio [data-telegram-preset] .preset-title{display:-webkit-box!important;-webkit-line-clamp:2!important;-webkit-box-orient:vertical!important;overflow:hidden!important;font-size:12px!important;font-weight:800!important;line-height:1.35!important;color:inherit!important;margin:0 0 3px!important}
      .telegram-admin-studio [data-telegram-preset] .preset-desc{display:none!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=blue] .preset-badge{background:#eff6ff!important;color:#1d4ed8!important;border:1px solid #dbeafe!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=blue]:hover{border-color:#93c5fd!important;background:#fbfdff!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=blue].is-selected{border-color:#2563eb!important;background:#f0f7ff!important;box-shadow:0 0 0 3px rgba(37,99,235,.2),0 6px 14px rgba(37,99,235,.12)!important;transform:translateY(-2px)!important;color:#1d4ed8!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=green] .preset-badge{background:#ecfdf5!important;color:#047857!important;border:1px solid #d1fae5!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=green]:hover{border-color:#86efac!important;background:#fbfefc!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=green].is-selected{border-color:#10b981!important;background:#f0fdf4!important;box-shadow:0 0 0 3px rgba(16,185,129,.2),0 6px 14px rgba(16,185,129,.12)!important;transform:translateY(-2px)!important;color:#047857!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=amber] .preset-badge{background:#fffbeb!important;color:#b45309!important;border:1px solid #fef3c7!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=amber]:hover{border-color:#fde047!important;background:#fffefb!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=amber].is-selected{border-color:#f59e0b!important;background:#fffbeb!important;box-shadow:0 0 0 3px rgba(245,158,11,.2),0 6px 14px rgba(245,158,11,.12)!important;transform:translateY(-2px)!important;color:#b45309!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=red] .preset-badge{background:#fef2f2!important;color:#dc2626!important;border:1px solid #fee2e2!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=red]:hover{border-color:#fca5a5!important;background:#fffbfb!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=red].is-selected{border-color:#ef4444!important;background:#fef2f2!important;box-shadow:0 0 0 3px rgba(239,68,68,.2),0 6px 14px rgba(239,68,68,.12)!important;transform:translateY(-2px)!important;color:#dc2626!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=purple] .preset-badge{background:#faf5ff!important;color:#7c3aed!important;border:1px solid #ede9fe!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=purple]:hover{border-color:#d8b4fe!important;background:#fdfbff!important}
      .telegram-admin-studio [data-telegram-preset][data-tone=purple].is-selected{border-color:#8b5cf6!important;background:#faf5ff!important;box-shadow:0 0 0 3px rgba(139,92,246,.2),0 6px 14px rgba(139,92,246,.12)!important;transform:translateY(-2px)!important;color:#7c3aed!important}
      .telegram-admin-studio [data-telegram-form]{padding:15px 16px!important;border:1.5px solid #3b82f6!important;border-radius:13px!important;background:#fff!important;box-shadow:0 4px 14px rgba(59,130,246,.08)!important;transition:border-color .2s ease,box-shadow .2s ease!important}
      .telegram-admin-studio [data-telegram-form][data-tone=blue]{border-color:#3b82f6!important;box-shadow:0 4px 18px rgba(59,130,246,.12)!important}
      .telegram-admin-studio [data-telegram-form][data-tone=green]{border-color:#10b981!important;box-shadow:0 4px 18px rgba(16,185,129,.12)!important}
      .telegram-admin-studio [data-telegram-form][data-tone=amber]{border-color:#f59e0b!important;box-shadow:0 4px 18px rgba(245,158,11,.12)!important}
      .telegram-admin-studio [data-telegram-form][data-tone=red]{border-color:#ef4444!important;box-shadow:0 4px 18px rgba(239,68,68,.15)!important}
      .telegram-admin-studio [data-telegram-form][data-tone=purple]{border-color:#8b5cf6!important;box-shadow:0 4px 18px rgba(139,92,246,.12)!important}
      .telegram-admin-studio [data-telegram-form][data-tone=default]{border-color:#cbd5e1!important;box-shadow:0 3px 12px rgba(15,23,42,.05)!important}
      .telegram-admin-studio .telegram-form-top{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important;padding-bottom:10px!important;border-bottom:1px solid #f1f5f9!important}
      .telegram-admin-studio .telegram-form-top>label{display:flex!important;align-items:center!important;gap:8px!important;min-width:min(100%,300px)!important;flex:1 1 300px!important}
      .telegram-admin-studio .telegram-active-badge{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:5px 10px!important;border-radius:8px!important;font-size:11.5px!important;font-weight:700!important;border:1px solid transparent!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=blue]{background:#eff6ff!important;color:#1d4ed8!important;border-color:#bfdbfe!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=green]{background:#ecfdf5!important;color:#047857!important;border-color:#a7f3d0!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=amber]{background:#fffbeb!important;color:#b45309!important;border-color:#fde68a!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=red]{background:#fef2f2!important;color:#dc2626!important;border-color:#fecaca!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=purple]{background:#faf5ff!important;color:#7c3aed!important;border-color:#ddd6fe!important}
      .telegram-admin-studio .telegram-active-badge[data-tone=default]{background:#f1f5f9!important;color:#475569!important;border-color:#cbd5e1!important}
      .telegram-admin-studio label{display:block!important;color:#1e335f!important;font-size:13px!important;font-weight:700!important;line-height:1.35!important}
      .telegram-admin-studio input,.telegram-admin-studio select,.telegram-admin-studio textarea{width:100%!important;box-sizing:border-box!important;margin-top:5px!important;padding:8px 12px!important;border:1px solid #cbd5e1!important;border-radius:8px!important;background:#fff!important;color:#0f172a!important;font:500 13px/1.35 Arial,"Segoe UI",sans-serif!important;outline:none!important;transition:border-color .15s ease,box-shadow .15s ease!important}
      .telegram-admin-studio input:focus,.telegram-admin-studio select:focus,.telegram-admin-studio textarea:focus{border-color:#6366f1!important;box-shadow:0 0 0 3px rgba(99,102,241,.12)!important}
      .telegram-admin-studio textarea{min-height:86px!important;resize:vertical!important;line-height:1.45!important}
      .telegram-admin-studio .telegram-meeting-box{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;margin-top:12px!important;padding:12px 14px!important;border:1.5px solid #bfdbfe!important;border-radius:12px!important;background:#f0f7ff!important}
      .telegram-admin-studio .telegram-meeting-box.is-hidden{display:none!important}
      .telegram-admin-studio .telegram-meeting-reminder{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;grid-column:1/-1!important;padding-top:10px!important;border-top:1px solid #dbeafe!important;flex-wrap:wrap!important}
      .telegram-admin-studio .telegram-meeting-reminder-copy{display:flex!important;align-items:center!important;gap:8px!important;font-size:11px!important;color:#1e40af!important}
      .telegram-admin-studio .telegram-meeting-reminder select{min-height:38px!important;padding:6px 10px!important;border:1.5px solid #93c5fd!important;border-radius:8px!important;font-weight:700!important;color:#1e40af!important;background:#fff!important;max-width:320px!important}
      .telegram-admin-studio .telegram-send-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin-top:14px!important;padding-top:12px!important;border-top:1px solid #f1f5f9!important;flex-wrap:wrap!important}
      .telegram-admin-studio .telegram-send-row span{color:#64748b!important;font-size:11.5px!important}
      .telegram-admin-studio .telegram-send-row .btn-secondary{padding:9px 18px!important;border:1px solid #cbd5e1!important;border-radius:8px!important;background:#fff!important;color:#475569!important;font-weight:700!important;font-size:13px!important;cursor:pointer!important;transition:all .15s ease!important}
      .telegram-admin-studio .telegram-send-row .btn-secondary:hover{background:#f1f5f9!important;color:#0f172a!important}
      .telegram-admin-studio .telegram-send-row .btn-primary,.telegram-admin-studio [data-telegram-send]{padding:10px 22px!important;border:0!important;border-radius:10px!important;background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)!important;color:#fff!important;font-size:13px!important;font-weight:800!important;box-shadow:0 6px 18px rgba(124,58,237,.28)!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;gap:8px!important;transition:transform .15s ease,box-shadow .15s ease!important}
      .telegram-admin-studio .telegram-send-row .btn-primary:hover,.telegram-admin-studio [data-telegram-send]:hover{transform:translateY(-1px)!important;box-shadow:0 8px 24px rgba(124,58,237,.38)!important}
      .telegram-admin-studio .telegram-send-row .btn-primary:active,.telegram-admin-studio [data-telegram-send]:active{transform:scale(0.98)!important}
      @media(max-width:560px){
        #referenceEditor .modal-card.telegram-admin-studio{width:calc(100vw - 16px)!important;border-radius:14px!important}
        .telegram-admin-studio .telegram-studio-head{padding:12px 14px!important}
        .telegram-admin-studio .telegram-studio-body{padding:11px 12px 14px!important}
        .telegram-admin-studio [data-telegram-form]{padding:12px!important}
        .telegram-admin-studio .telegram-meeting-box{grid-template-columns:1fr!important;padding:10px!important}
        .telegram-admin-studio .telegram-meeting-reminder{align-items:stretch!important}
        .telegram-admin-studio .telegram-meeting-reminder select{max-width:none!important}
        .telegram-admin-studio .telegram-send-row>div{width:100%!important}
        .telegram-admin-studio .telegram-send-row button{flex:1 1 0!important;justify-content:center!important}
      }
    `;document.head.appendChild(style);}
    if(root)root.className='telegram-admin-studio';
  }
  let noticeFilter=0;
  const userActivityToken=()=>{try{const session=JSON.parse(sessionStorage.getItem('nvt-crm-session-v1')||'{}');const stored=String(session.token||session.accessToken||'').trim();if(stored)return stored;}catch{}try{return typeof serverSyncToken!=='undefined'?String(serverSyncToken||'').trim():'';}catch{return '';}};
  const userActivityTime=value=>{const raw=String(value||'').replace('T',' ').replace(/\.\d+Z?$/,'');return raw&&raw!=='null'?raw.slice(0,19):'Chưa ghi nhận';};
  const userRoleLabel=role=>({ADMIN:'Admin',MANAGER:'Manager',LEADER:'Leader',SALE:'Sale',MARKETING:'Marketing',ACCOUNTING:'Kế toán',UNASSIGNED:'Chờ phân quyền'})[role]||role||'Chưa xác định';
  const userEventLabel=event=>({LOGIN:'Đăng nhập',LOGOUT:'Đăng xuất',OPEN_SCREEN:'Mở màn hình'})[event]||event||'Hoạt động hệ thống';
  let orderAuditSnapshot=null,orderAuditPage=1,orderAuditSearch='',orderAuditOrder='',orderAuditAction='',orderAuditLoading=false,orderAuditError='',orderAuditUser='';
  const orderAuditLabels={CREATE_ORDER:'Tạo đơn hàng',CREATE_BILL:'Tạo bill / ghi nhận tiền thu',UPDATE_BILL:'Cập nhật bill',DELETE_BILL:'Xóa bill / lần thu',UPDATE_ORDER:'Sửa thông tin đơn',ORDER_STATUS:'Đổi trạng thái',RECONCILE_ORDER:'Xác nhận đối soát',ISSUE_VAT:'Xuất hóa đơn VAT',ORDER_REFUNDED:'Hoàn tiền',DELETE_ORDER:'Xóa đơn hàng'};
  function orderAuditTime(value){
    const raw=String(value||'');if(!raw)return 'Chưa ghi nhận';
    const date=new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)?raw.replace(' ','T')+'+07:00':raw);
    return Number.isFinite(date.getTime())?date.toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour12:false}):raw;
  }
  function orderAuditRows(items){
    const value=v=>v==null||v===''?'—':typeof v==='boolean'?(v?'Có':'Không'):typeof v==='object'?JSON.stringify(v):String(v);
    return items.map(item=>`<tr><td class="user-log-time">${esc(orderAuditTime(item.at))}</td><td><b>${esc(item.orderCode||item.entity)}</b><small style="display:block">${esc(item.customerName||'')}</small></td><td><b>${esc(item.actor||item.actorId||'Chưa ghi nhận')}</b><small style="display:block">${esc(item.actorId||'')}</small></td><td><span class="user-log-role">${esc(userRoleLabel(item.role))}</span></td><td>${esc(orderAuditLabels[item.action]||item.action)}${item.source==='ORDER_SQL'?'':'<small style="display:block">Log cũ</small>'}</td><td>${esc(item.detail||'')}${item.receiptId?'<small style="display:block">Lần thu: '+esc(item.receiptId)+'</small>':''}${(item.changes||[]).map(change=>'<div style="margin-top:5px;overflow-wrap:anywhere"><b>'+esc(change.label||change.field)+'</b> · '+esc(value(change.before))+' → '+esc(value(change.after))+'</div>').join('')}</td></tr>`).join('')||'<tr><td colspan="6" class="user-log-empty">Chưa có lịch sử được ghi nhận cho bộ lọc này.</td></tr>';
  }
  const orderAuditTable=items=>'<div class="table-responsive"><table class="modern-table user-log-table"><thead><tr><th>NGÀY GIỜ (GMT+7)</th><th>ĐƠN HÀNG</th><th>NGƯỜI THỰC HIỆN</th><th>VAI TRÒ</th><th>THAO TÁC</th><th>CHI TIẾT THAY ĐỔI</th></tr></thead><tbody>'+orderAuditRows(items)+'</tbody></table></div>';
  function renderOrderAudit(){
    const panel=q('#orderAuditPanel');if(!panel)return;
    if(orderAuditUser!==data?.user?.id){orderAuditUser=data?.user?.id;orderAuditSnapshot=null;orderAuditPage=1;orderAuditSearch='';orderAuditOrder='';orderAuditAction='';orderAuditError='';}
    const result=orderAuditSnapshot;
    panel.innerHTML=`<div class="user-log-table-title"><b>Lịch sử đơn hàng</b><button type="button" id="orderAuditReload" class="btn-action btn-secondary">Làm mới</button></div><form id="orderAuditFilters" style="display:flex;gap:10px;flex-wrap:wrap;padding:12px 16px"><input name="search" class="search-input" aria-label="Tìm đơn hoặc người thực hiện" placeholder="Tìm đơn, khách, nhân sự..." value="${esc(orderAuditSearch)}"><select name="orderId" aria-label="Đơn hàng" style="max-width:320px"><option value="">Tất cả đơn</option>${(data.orders||[]).map(order=>'<option value="'+esc(order.id)+'"'+(orderAuditOrder===order.id?' selected':'')+'>'+esc((order.code||order.id)+' · '+(order.customerName||''))+'</option>').join('')}</select><select name="action" aria-label="Thao tác"><option value="">Tất cả thao tác</option>${Object.entries(orderAuditLabels).map(([action,label])=>'<option value="'+action+'"'+(orderAuditAction===action?' selected':'')+'>'+esc(label)+'</option>').join('')}</select><button type="submit" class="btn-action btn-primary">Lọc</button></form><p role="status" style="padding:0 16px;overflow-wrap:anywhere">${esc(orderAuditError||(orderAuditLoading?'Đang tải lịch sử...':result?result.total+' sự kiện':'Chưa tải lịch sử'))}</p>${orderAuditTable(result?.items||[])}<div style="display:flex;align-items:center;gap:12px;padding:12px 16px"><button type="button" id="orderAuditPrev" class="btn-action btn-secondary" ${orderAuditPage<=1||orderAuditLoading?'disabled':''}>Trang trước</button><span>Trang ${orderAuditPage}</span><button type="button" id="orderAuditNext" class="btn-action btn-secondary" ${!result?.hasMore||orderAuditLoading?'disabled':''}>Trang sau</button></div>`;
    q('#orderAuditFilters').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;orderAuditSearch=form.elements.search.value.trim();orderAuditOrder=form.elements.orderId.value;orderAuditAction=form.elements.action.value;orderAuditPage=1;loadOrderAudit();};
    q('#orderAuditReload').onclick=()=>loadOrderAudit();
    q('#orderAuditPrev').onclick=()=>{orderAuditPage--;loadOrderAudit();};q('#orderAuditNext').onclick=()=>{orderAuditPage++;loadOrderAudit();};
  }
  async function loadOrderAudit(){
    if(!['ADMIN','ACCOUNTING'].includes(data?.user?.actualRole||data?.user?.role)||orderAuditLoading)return;
    const userId=data.user.id;orderAuditLoading=true;orderAuditError='';renderOrderAudit();
    try{const params=new URLSearchParams({ordersOnly:'1',page:String(orderAuditPage),limit:'50',search:orderAuditSearch,orderId:orderAuditOrder,action:orderAuditAction});const result=await lazyAsset('/api/audit?'+params);if(data?.user?.id===userId)orderAuditSnapshot=result;}
    catch(error){orderAuditError=error.message||'Không tải được lịch sử đơn';}
    finally{orderAuditLoading=false;if(data?.user?.id===userId)renderOrderAudit();}
  }
  function openOrderAudit(id){
    if(!['ADMIN','ACCOUNTING'].includes(data?.user?.actualRole||data?.user?.role))return;
    installUserActivityStyles();const order=data.orders.find(item=>item.id===id),userId=data.user.id;
    const modal=editor('LỊCH SỬ ĐƠN · '+(order?.code||id),'<div id="orderHistoryContent" role="status">Đang tải lịch sử...</div><div style="display:flex;gap:12px;align-items:center;margin-top:12px"><button type="button" class="btn-action btn-secondary" id="orderHistoryPrev" disabled>Trang trước</button><span id="orderHistoryPage">Trang 1</span><button type="button" class="btn-action btn-secondary" id="orderHistoryNext" disabled>Trang sau</button><button type="button" class="btn-action btn-secondary" id="orderHistoryRetry">Làm mới</button></div>');
    modal.style.zIndex='12000';let page=1,loading=false;
    const load=async()=>{if(loading)return;loading=true;modal.querySelector('#orderHistoryPrev').disabled=true;modal.querySelector('#orderHistoryNext').disabled=true;
      try{const result=await lazyAsset('/api/audit?ordersOnly=1&limit=50&orderId='+encodeURIComponent(id)+'&page='+page);if(!modal.isConnected||data?.user?.id!==userId)return;modal.querySelector('#orderHistoryContent').innerHTML=orderAuditTable(result.items);modal.querySelector('#orderHistoryPage').textContent='Trang '+page+' · '+result.total+' sự kiện';modal.querySelector('#orderHistoryPrev').disabled=page<=1;modal.querySelector('#orderHistoryNext').disabled=!result.hasMore;}
      catch(error){if(modal.isConnected)modal.querySelector('#orderHistoryContent').textContent=error.message||'Không tải được lịch sử';}
      finally{loading=false;}
    };
    modal.querySelector('#orderHistoryPrev').onclick=()=>{page--;load();};modal.querySelector('#orderHistoryNext').onclick=()=>{page++;load();};modal.querySelector('#orderHistoryRetry').onclick=load;load();
  }
  async function loadUserActivity(force=false){
    if((data?.user?.actualRole||data?.user?.role)!=='ADMIN'||userActivityLoading)return userActivitySnapshot;
    if(!force&&Date.now()-userActivityRequestedAt<12000)return userActivitySnapshot;
    const token=userActivityToken();if(!token)return null;
    userActivityLoading=true;
    try{
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      let response;
      try{response=await fetch('/api/admin/user-activity',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal});}
      finally{clearTimeout(timeout);}
      const payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||'Không tải được User log.');
      userActivitySnapshot=payload;userActivityRequestedAt=Date.now();
      renderUserLog();
      return payload;
    }catch(error){
      renderUserLog();
      const status=q('#userActivityStatus');if(status)status.textContent=error.message||'Không tải được User log.';
      return null;
    }
    finally{userActivityLoading=false;}
  }
  async function reportUserActivity(tabId,force=false){
    if(!data||!api||document.hidden)return;
    const token=userActivityToken(),view=String(tabId||'tab-dashboard').replace(/^tab-/,'');
    if(!token||(!force&&view===lastReportedActivity))return;
    lastReportedActivity=view;
    try{await fetch('/api/user-activity',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({view}),keepalive:true});}catch{}
  }
  function installUserActivityStyles(){
    if(q('#userActivityStyles'))return;
    const style=document.createElement('style');style.id='userActivityStyles';style.textContent=`
      #tab-audit{min-width:0}.user-log-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}.user-log-heading h1{margin:0}.user-log-heading p{margin:5px 0 0;color:var(--text-muted);font-size:12px}.user-log-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}.user-log-kpi{min-height:88px;padding:15px 16px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);box-shadow:0 2px 8px rgba(15,23,42,.04)}.user-log-kpi small{display:block;color:var(--text-muted);font-size:10px;font-weight:800;text-transform:uppercase}.user-log-kpi b{display:block;margin-top:7px;color:var(--text-main);font-size:24px;line-height:1}.user-log-kpi span{display:block;margin-top:7px;color:var(--text-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.user-log-table-title{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px 10px}.user-log-table-title b{font-size:13px;color:var(--text-main)}.user-log-table-title small{display:block;margin-top:3px;color:var(--text-muted);font-size:11px}.user-log-table-title button{padding:7px 10px;font-size:11px}.user-log-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:11px;font-weight:800}.user-log-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8}.user-log-status.online{color:#047857}.user-log-status.online .user-log-dot{background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.13)}.user-log-status.offline{color:#64748b}.user-log-role{display:inline-flex;align-items:center;padding:4px 7px;border-radius:5px;background:#eef2ff;color:#3730a3;font-size:10px;font-weight:800}.user-log-activity{font-weight:700;color:#334155}.user-log-ip,.user-log-time{font-family:var(--font-mono);font-size:11px;white-space:nowrap}.user-log-event{font-size:11px;font-weight:800;color:#2563eb}.user-log-empty{padding:22px;text-align:center;color:var(--text-muted);font-size:12px}@media(max-width:900px){.user-log-summary{grid-template-columns:1fr}.user-log-table-title{align-items:flex-start}.user-log-table-title button{flex:0 0 auto}.user-log-table{min-width:860px}}
    `;document.head.appendChild(style);
  }
  function renderUserLog(){
    const tab=q('#tab-audit');if(!tab)return;installUserActivityStyles();
    if((data?.user?.actualRole||data?.user?.role)==='ACCOUNTING'){tab.innerHTML='<div class="user-log-heading"><h1>User log</h1></div><section id="orderAuditPanel" class="table-container"></section>';renderOrderAudit();return;}
    const snapshot=userActivitySnapshot,users=Array.isArray(snapshot?.users)?snapshot.users:[],events=Array.isArray(snapshot?.events)?snapshot.events:[];
    const online=users.filter(item=>item.online).length,lastLogin=events.find(item=>item.action==='LOGIN');
    const roleOrder={ADMIN:0,MANAGER:1,LEADER:2,SALE:3,MARKETING:4,ACCOUNTING:5,UNASSIGNED:6};
    const orderedUsers=users.slice().sort((a,b)=>{
      const roleA=String(a.role||'').toUpperCase(),roleB=String(b.role||'').toUpperCase();
      if((roleA==='ADMIN')!==(roleB==='ADMIN'))return roleA==='ADMIN'?-1:1;
      if(Boolean(a.online)!==Boolean(b.online))return a.online?-1:1;
      return (roleOrder[roleA]??99)-(roleOrder[roleB]??99)||String(a.name||'').localeCompare(String(b.name||''),'vi')||String(a.id||'').localeCompare(String(b.id||''));
    });
    const people=orderedUsers.map(item=>`<tr><td><b>${esc(item.name||'Chưa đặt tên')}</b><small style='display:block;margin-top:3px;color:var(--text-muted);font-size:10px'>${esc(item.accountId||item.id)}</small></td><td><span class='user-log-role'>${esc(userRoleLabel(item.role))}</span></td><td><span class='user-log-status ${item.online?'online':'offline'}'><i class='user-log-dot'></i>${item.online?'Đang trực tuyến':'Ngoại tuyến'}</span></td><td class='user-log-activity'>${esc(item.activity||'Chưa ghi nhận')}</td><td class='user-log-ip'>${esc(item.ip||'Chưa ghi nhận')}</td><td class='user-log-time'>${esc(userActivityTime(item.lastSeen||item.lastEvent?.at))}</td></tr>`).join('')||`<tr><td colspan='6'><div class='user-log-empty'>Chưa có tài khoản hoạt động.</div></td></tr>`;
    const history=events.map(item=>`<tr><td class='user-log-time'>${esc(userActivityTime(item.at))}</td><td><b>${esc(item.name||'Chưa đặt tên')}</b></td><td><span class='user-log-role'>${esc(userRoleLabel(item.role))}</span></td><td class='user-log-ip'>${esc(item.ip||'Chưa ghi nhận')}</td><td class='user-log-event'>${esc(userEventLabel(item.action))}</td><td>${esc(item.detail||'Không có mô tả')}</td></tr>`).join('')||`<tr><td colspan='6'><div class='user-log-empty'>Chưa có lịch sử đăng nhập hoặc hoạt động.</div></td></tr>`;
    tab.innerHTML=`<div class='user-log-heading'><div><h1>User log</h1><p>Theo dõi phiên đăng nhập, IP và màn hình đang mở của toàn bộ nhân sự.</p></div><span id='userActivityStatus' class='chip'>${snapshot?`Cập nhật ${esc(userActivityTime(snapshot.generatedAt))}`:'Đang tải dữ liệu...'}</span></div><div class='user-log-summary'><div class='user-log-kpi'><small>Đang trực tuyến</small><b>${online}</b><span>Hoạt động trong 2 phút gần nhất</span></div><div class='user-log-kpi'><small>Tổng tài khoản</small><b>${users.length}</b><span>Tài khoản đang hoạt động trong CRM</span></div><div class='user-log-kpi'><small>Đăng nhập gần nhất</small><b style='font-size:14px;line-height:1.35'>${esc(lastLogin?.name||'Chưa ghi nhận')}</b><span>${esc(userActivityTime(lastLogin?.at))}</span></div></div><section class='table-container'><div class='user-log-table-title'><div><b>Trạng thái nhân sự</b><small>Danh sách hiển thị trạng thái thực tế từ phiên máy chủ.</small></div><button id='userActivityReload' class='btn-action btn-secondary' type='button'>Làm mới</button></div><div class='table-responsive'><table class='modern-table user-log-table'><thead><tr><th>NHÂN SỰ</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th>ĐANG LÀM GÌ</th><th>IP</th><th>HOẠT ĐỘNG GẦN NHẤT</th></tr></thead><tbody>${people}</tbody></table></div></section><section class='table-container' style='margin-top:16px'><div class='user-log-table-title'><div><b>Lịch sử hoạt động</b><small>Ghi nhận bởi server: đăng nhập, đăng xuất và màn hình được mở.</small></div><span class='chip'>${events.length} sự kiện</span></div><div class='table-responsive'><table class='modern-table user-log-table'><thead><tr><th>THỜI GIAN</th><th>NHÂN SỰ</th><th>VAI TRÒ</th><th>IP</th><th>SỰ KIỆN</th><th>CHI TIẾT</th></tr></thead><tbody>${history}</tbody></table></div></section>`;
    q('#userActivityReload')?.addEventListener('click',()=>loadUserActivity(true));
    const panel=document.createElement('section');panel.id='orderAuditPanel';panel.className='table-container';panel.style.marginTop='16px';tab.appendChild(panel);renderOrderAudit();
  }
  const noticeColors={DATA_ARRIVAL:'#2563eb',PAYMENT_REVIEW:'#d97706',PAYMENT_CONFIRMED:'#059669',DATA_UNRECEIVED_24H:'#dc2626'};
  const noticeIcons={DATA_ARRIVAL:'↓',PAYMENT_REVIEW:'₫',PAYMENT_CONFIRMED:'✓',DATA_UNRECEIVED_24H:'24h'};
  const noticeKind=n=>CrmNotifications.kind(n);
  function noticeRow(n){
    const kind=noticeKind(n),read=(n.readBy||[]).includes(data.user.id);
    return `<article class="notice-row ${read?'notice-read':'notice-unread'}" data-notice-id="${esc(n.id)}" style="--notice-color:${noticeColors[kind]}"><div class="notice-icon" aria-hidden="true">${noticeIcons[kind]}</div><div class="notice-content"><div class="notice-title">${read?'':'<span class="notice-dot" aria-label="Chưa đọc"></span>'}<b>${esc(CrmNotifications.displayText(n,n.title||CrmNotifications.labels[kind]))}</b></div><p>${esc(CrmNotifications.displayText(n))}</p><div class="notice-meta"><span>${esc(CrmNotifications.labels[kind])}</span><span>·</span><time>${esc(CrmNotifications.formatTime(n.at||n.createdAt))}</time><span>· ${read?'Đã đọc':'Chưa đọc'}</span></div></div><div class="notice-actions"><button type="button" class="btn-secondary" data-notice-read="${esc(n.id)}" ${read?'disabled':''}>${read?'Đã đọc':'Đánh dấu đã đọc'}</button><button type="button" class="btn-secondary notice-delete" data-notice-delete="${esc(n.id)}" aria-label="Xóa thông báo">Xóa</button></div></article>`;
  }
  function notices(){
    const tab=q('#tab-notifications'),dropdown=q('#notificationDropdown');
    const all=CrmNotifications.list(data.notifications,data.user.id),unseen=all.filter(n=>!(n.readBy||[]).includes(data.user.id)).length;
    text('topbarNotifBadge',unseen);const badge=q('.nav-link[data-tab="tab-notifications"] .nav-badge');if(badge)badge.textContent=unseen;
    if(tab){
      q('#noticeCategories').innerHTML=Object.entries(CrmNotifications.labels).map(([kind,label])=>{const items=all.filter(n=>noticeKind(n)===kind),unread=items.filter(n=>!(n.readBy||[]).includes(data.user.id)).length;return `<button type="button" class="notice-category ${noticeFilter===kind?'active':''}" data-notice-filter="${kind}" aria-pressed="${noticeFilter===kind}" style="--notice-color:${noticeColors[kind]}"><strong>${esc(label)}</strong><b>${items.length}</b><small>${unread} chưa đọc</small></button>`;}).join('');
      const items=all.filter(n=>!noticeFilter||noticeKind(n)===noticeFilter);
      q('#noticeFeed').innerHTML=items.map(noticeRow).join('')||'<div class="notice-empty">Chưa có thông báo trong mục này.</div>';
      text('noticeListCount',`${items.length} thông báo · Mới nhất ở trên`);
      const readAll=q('#markNotificationsReadButton');readAll.disabled=!unseen;readAll.onclick=()=>run(()=>api.readNotifications());
      const allButton=q('#noticeAllFilter');allButton.textContent=`Tất cả (${all.length})`;allButton.classList.toggle('btn-primary',!noticeFilter);allButton.onclick=()=>{noticeFilter=0;notices();};
      qa('[data-notice-filter]').forEach(button=>button.onclick=()=>{noticeFilter=button.dataset.noticeFilter;notices();});
    }
    if(dropdown){
      dropdown.innerHTML=`<div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)"><b>Thông báo <span class="chip">${unseen} chưa đọc</span></b><button type="button" id="noticeDropdownReadAll" class="btn-secondary" ${unseen?'':'disabled'}>Đọc tất cả</button></div><div class="notice-preview" style="max-height:420px;overflow-y:auto">${all.slice(0,8).map(noticeRow).join('')||'<div class="notice-empty">Chưa có thông báo.</div>'}</div><div style="padding:12px;text-align:center;border-top:1px solid var(--border)"><button type="button" id="noticeOpenAll" class="btn-secondary">Xem tất cả thông báo</button></div>`;
      q('#noticeDropdownReadAll').onclick=()=>run(()=>api.readNotifications());
      q('#noticeOpenAll').onclick=()=>{switchTab('tab-notifications');closeNotificationDropdown();};
    }
    qa('[data-notice-read]').forEach(button=>button.onclick=()=>run(()=>api.readNotice(button.dataset.noticeRead)));
    qa('[data-notice-delete]').forEach(button=>button.onclick=()=>run(()=>api.deleteNotice(button.dataset.noticeDelete)));
  }
  function webhookEditor(id){const w=data.websites.find(w=>w.id===id);const modal=editor('Cấu hình URL webhook',formField('Mã webhook (slug)',`<input id="refWebhookSlug" required maxlength="60" value="${esc(w.webhookSlug)}">`)+formField('URL công khai ghi đè (HTTPS, tùy chọn)',`<input id="refWebhookOverride" type="url" value="${esc(w.webhookUrlOverride||'')}">`)+formField('Domain công khai dùng chung',`<input id="refWebhookBase" type="url" value="${esc(data.settings.webhookPublicBase||'')}">`)+`<button type="button" id="refGenerateWebhook" class="btn-action btn-secondary">Tạo mã mới</button>`+(w.provider!=='NOTIFICATION'?websiteSalePicker(w):''),()=>api.saveWebhook(id,{slug:q('#refWebhookSlug').value,override:q('#refWebhookOverride').value,base:q('#refWebhookBase').value,...(w.provider!=='NOTIFICATION'?websiteSalePickerValue():{})}));if(w.provider!=='NOTIFICATION')bindWebsiteSalePicker(modal);q('#refGenerateWebhook').onclick=()=>{q('#refWebhookSlug').value=api.newWebhookSlug();q('#refWebhookOverride').value='';};}
  // Dùng form nghiệp vụ hiện có, trình bày bằng thành phần của mẫu mới.
  let workflowModal=null,workflowPairs=[],workflowMarkup='',workflowBusy=false;
  function styleWorkflow(root){
    root.querySelectorAll('*').forEach(n=>{
      n.removeAttribute('onclick');n.removeAttribute('onchange');n.removeAttribute('onsubmit');n.removeAttribute('oninput');
      if(n.id)n.id='wf-'+n.id;if(n.htmlFor)n.htmlFor='wf-'+n.htmlFor;
      const hidden=n.classList.contains('is-hidden')||n.hidden||n.style.display==='none';
      n.removeAttribute('style');if(hidden)n.hidden=true;
      if(n.matches('button'))n.className='btn-action '+(n.classList.contains('button-primary')?'btn-primary':'btn-secondary');
      if(n.matches('table'))n.className='modern-table';
      if(n.matches('input,select,textarea')){n.style.cssText='max-width:100%;min-width:0;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text-main);font:inherit';if(n.type==='checkbox'||n.type==='radio')n.style.width='auto';}
      if(n.classList.contains('form-field')){n.className='form-group';n.style.marginBottom='12px';}
      if(n.classList.contains('form-grid')||n.classList.contains('api-config-grid')){n.className='grid-2-col';n.style.gridTemplateColumns='repeat(auto-fit,minmax(min(220px,100%),1fr))';}
      if(n.classList.contains('table-wrap')){n.className='table-responsive';n.style.maxWidth='100%';}
      if(n.classList.contains('modal-actions')||n.classList.contains('panel-actions')||n.classList.contains('connection-actions'))n.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:12px 0';
      if(n.classList.contains('detail-grid'))n.style.cssText='display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:10px';
      if(n.classList.contains('section-label')||n.classList.contains('panel-title'))n.style.cssText='font-weight:700;margin:16px 0 10px';
      if(n.classList.contains('panel')||n.classList.contains('info-card')||n.classList.contains('rank-row')||n.classList.contains('field-manager-row')||n.classList.contains('timeline-item'))n.style.cssText='padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow-wrap:anywhere';
      if(n.classList.contains('status')||n.classList.contains('field-pill')){n.className='chip';}
      if(n.matches('img'))n.style.cssText='max-width:100%;max-height:180px;object-fit:contain';
    });
  }
  function syncWorkflowControls(){workflowPairs.forEach(([source,clone])=>{if(source.matches('input,select,textarea')){if(source.type==='file'){if(clone.files?.length)source.files=clone.files;}else{source.value=clone.value;if('checked'in source)source.checked=clone.checked;}}});}
  function drawWorkflow(){
    if(!workflowModal)return;const source=api.workflowRoot();if(!source){workflowModal.remove();workflowModal=null;workflowPairs=[];refresh(true);return;}
    if(workflowModal.dataset.workflowKind==='customer'){
      workflowModal.querySelector('.modal-card')?.classList.add('customer-profile-modal');
      if(!q('#referenceCustomerModalStyles')){const style=document.createElement('style');style.id='referenceCustomerModalStyles';style.textContent=`
        .customer-profile-modal{width:min(980px,calc(100vw - 24px))!important;height:min(94dvh,980px)!important;max-height:94dvh!important;overflow:hidden!important;border:1px solid #dbe4ee!important;border-radius:16px!important;background:#f8fafc!important;box-shadow:0 22px 60px rgba(15,23,42,.24)!important}
        .customer-profile-modal>.modal-header{display:flex!important;align-items:center!important;min-height:58px!important;padding:14px 20px!important;background:#f1f5f9!important;border-bottom:1px solid #dbe4ee!important}
        .customer-profile-modal>.modal-header h3{margin:0!important;color:#10213f!important;font-size:18px!important;font-weight:800!important;line-height:1.25!important}
        .customer-profile-modal>.modal-body{display:block!important;min-height:0!important;padding:0!important;overflow:auto!important;background:#f8fafc!important}
        .customer-profile-modal [data-workflow-body]{padding:18px 20px 24px!important;color:#17233b!important;font-family:Arial,"Segoe UI",sans-serif!important;font-size:13px!important}
        .customer-profile-modal .section-label{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin:18px 0 8px!important;color:#10213f!important;font-size:13px!important;font-weight:800!important;line-height:1.3!important}
        .customer-profile-modal .section-label:first-child{margin-top:0!important}
        .customer-profile-modal .detail-grid{display:grid!important;grid-template-columns:minmax(150px,.8fr) minmax(0,2fr)!important;gap:0 18px!important;margin:0!important;padding:4px 16px!important;border:1px solid #dbe4ee!important;border-radius:11px!important;background:#fff!important;box-shadow:0 2px 8px rgba(15,23,42,.035)!important}
        .customer-profile-modal .detail-grid dt,.customer-profile-modal .detail-grid dd{min-width:0!important;margin:0!important;padding:9px 0!important;border-bottom:1px solid #edf1f5!important;line-height:1.35!important;overflow-wrap:anywhere!important}
        .customer-profile-modal .detail-grid dt{color:#64748b!important;font-size:11.5px!important;font-weight:700!important}
        .customer-profile-modal .detail-grid dd{color:#1e293b!important;font-size:12.5px!important;font-weight:600!important}
        .customer-profile-modal .detail-grid dt:last-of-type,.customer-profile-modal .detail-grid dd:last-of-type{border-bottom:0!important}
        .customer-profile-modal .detail-grid .status{display:inline-flex!important;align-items:center!important;padding:4px 9px!important;border-radius:999px!important;font-size:11px!important;font-weight:800!important}
        .customer-profile-modal .form-grid,.customer-profile-modal .inline-form,.customer-profile-modal form{margin:0!important}
        .customer-profile-modal .form-grid,.customer-profile-modal .custom-field-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;padding:14px 16px!important;border:1px solid #dbe4ee!important;border-radius:11px!important;background:#fff!important;box-shadow:0 2px 8px rgba(15,23,42,.035)!important}
        .customer-profile-modal .form-field{display:grid!important;gap:6px!important;min-width:0!important;margin:0!important;color:#475569!important;font-size:11.5px!important;font-weight:700!important;line-height:1.3!important}
        .customer-profile-modal .form-field input,.customer-profile-modal .form-field select,.customer-profile-modal .form-field textarea,.customer-profile-modal .inline-form select{width:100%!important;min-height:39px!important;box-sizing:border-box!important;padding:8px 10px!important;border:1px solid #cbd5e1!important;border-radius:8px!important;background:#fff!important;color:#0f172a!important;font:600 12.5px/1.35 Arial,"Segoe UI",sans-serif!important;outline:none!important}
        .customer-profile-modal .form-field textarea{min-height:82px!important;resize:vertical!important}
        .customer-profile-modal .form-field input:focus,.customer-profile-modal .form-field select:focus,.customer-profile-modal .form-field textarea:focus,.customer-profile-modal .inline-form select:focus{border-color:#2563eb!important;box-shadow:0 0 0 3px rgba(37,99,235,.12)!important}
        .customer-profile-modal .inline-form{display:flex!important;align-items:center!important;gap:10px!important;padding:12px 16px!important;border:1px solid #dbe4ee!important;border-radius:11px!important;background:#fff!important}
        .customer-profile-modal .inline-form select{width:min(260px,100%)!important;flex:1 1 220px!important}
        .customer-profile-modal .modal-actions,.customer-profile-modal .panel-actions{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;margin:12px 0 0!important;padding:0!important}
        .customer-profile-modal .button{min-height:36px!important;padding:8px 13px!important;border-radius:8px!important;font-size:12px!important;font-weight:800!important}
        .customer-profile-modal .button-primary{background:#2563eb!important;border-color:#2563eb!important;color:#fff!important;box-shadow:0 5px 12px rgba(37,99,235,.18)!important}
        .customer-profile-modal .button-danger{background:#fff1f2!important;border-color:#fecdd3!important;color:#be123c!important}
        .customer-profile-modal .custom-field-multi{grid-column:span 1!important;min-width:0!important;margin:0!important;padding:10px 12px!important;border:1px solid #bfdbfe!important;border-radius:9px!important;background:#eff6ff!important}
        .customer-profile-modal .custom-field-multi legend{padding:0 4px!important;color:#1e40af!important;font-size:11.5px!important;font-weight:800!important}
        .customer-profile-modal .custom-field-multi>div{display:flex!important;flex-wrap:wrap!important;gap:7px!important;margin-top:5px!important}
        .customer-profile-modal .custom-field-multi>div>label{display:inline-flex!important;align-items:center!important;gap:5px!important;padding:4px 7px!important;border:1px solid #dbeafe!important;border-radius:7px!important;background:#fff!important;font-size:11px!important;font-weight:700!important;color:#334155!important;cursor:pointer!important}
        .customer-profile-modal .custom-field-multi input{width:auto!important;min-height:auto!important;margin:0!important;accent-color:#2563eb!important}
        .customer-profile-modal .timeline,.customer-profile-modal .purchase-list,.customer-profile-modal .follow-up-list{display:grid!important;gap:8px!important;margin:0!important}
        .customer-profile-modal .timeline-item,.customer-profile-modal .purchase-row,.customer-profile-modal .follow-up-row,.customer-profile-modal .empty{display:block!important;width:100%!important;box-sizing:border-box!important;margin:0!important;padding:11px 13px!important;border:1px solid #dbe4ee!important;border-radius:9px!important;background:#fff!important;color:#1e293b!important;box-shadow:0 1px 5px rgba(15,23,42,.025)!important}
        .customer-profile-modal .timeline-item b,.customer-profile-modal .purchase-row b,.customer-profile-modal .follow-up-row b,.customer-profile-modal .empty b{font-size:12px!important;color:#17233b!important}
        .customer-profile-modal .timeline-item p,.customer-profile-modal .timeline-item small,.customer-profile-modal .purchase-row small,.customer-profile-modal .follow-up-row small,.customer-profile-modal .empty span{display:block!important;margin:4px 0 0!important;color:#64748b!important;font-size:11px!important;line-height:1.4!important}
        .customer-profile-modal .purchase-row,.customer-profile-modal .follow-up-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;text-align:left!important;cursor:pointer!important}
        .customer-profile-modal .purchase-row:hover{border-color:#93c5fd!important;background:#f8fbff!important}
        .customer-profile-modal .note-actions{display:flex!important;gap:6px!important;margin-top:8px!important}
        .customer-profile-modal .duplicate-alert{margin:0 0 12px!important;padding:10px 12px!important;border:1px solid #fed7aa!important;border-radius:9px!important;background:#fff7ed!important;color:#9a3412!important}
        .customer-profile-modal .duplicate-alert b,.customer-profile-modal .duplicate-alert span{display:block!important;font-size:11.5px!important;line-height:1.4!important}
        .customer-profile-modal .customer-care-shortcuts{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;margin:12px 0 16px!important}
        .customer-profile-modal .customer-care-shortcuts button{display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;min-height:38px!important;padding:8px 12px!important;border:1px solid #bfdbfe!important;border-radius:8px!important;background:#eff6ff!important;color:#1d4ed8!important;font-size:12px!important;font-weight:800!important;cursor:pointer!important}
        .customer-profile-modal .customer-care-shortcuts button:hover{background:#dbeafe!important;border-color:#93c5fd!important}
        .customer-profile-modal>.modal-footer{position:relative!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;min-height:58px!important;padding:10px 20px!important;border-top:1px solid #dbe4ee!important;background:#f1f5f9!important}
        .customer-profile-modal>.modal-footer [data-workflow-notice]{margin-right:auto!important;color:#2563eb!important;font-size:11.5px!important;font-weight:700!important}
        @media(max-width:640px){
          .customer-profile-modal{width:calc(100vw - 12px)!important;height:calc(100dvh - 12px)!important;max-height:calc(100dvh - 12px)!important;border-radius:12px!important}
          .customer-profile-modal [data-workflow-body]{padding:14px 12px 18px!important}
          .customer-profile-modal .detail-grid{grid-template-columns:1fr!important;gap:0!important;padding:4px 12px!important}
          .customer-profile-modal .detail-grid dt{padding:8px 0 2px!important;border-bottom:0!important}
          .customer-profile-modal .detail-grid dd{padding:2px 0 8px!important}
          .customer-profile-modal .form-grid,.customer-profile-modal .custom-field-grid{grid-template-columns:1fr!important;padding:12px!important}
          .customer-profile-modal .custom-field-multi{grid-column:auto!important}
          .customer-profile-modal .inline-form{align-items:stretch!important;flex-direction:column!important;padding:12px!important}
          .customer-profile-modal .inline-form select{width:100%!important;flex-basis:auto!important}
          .customer-profile-modal .customer-care-shortcuts{grid-template-columns:1fr!important}
          .customer-profile-modal>.modal-footer{padding:9px 12px!important}
          .customer-profile-modal>.modal-footer button{flex:1 1 0!important}
        }
      `;document.head.appendChild(style);}
    }
    if(workflowModal.dataset.workflowKind==='profile'&&!q('#referenceProfileModernStyles')){const style=document.createElement('style');style.id='referenceProfileModernStyles';style.textContent='.profile-modal-card .modal-body{padding:0!important}.profile-modal-card .profile-panel{border:0!important;box-shadow:none!important;background:transparent!important}.profile-modal-card .profile-panel-body{max-width:none!important;padding:22px!important}.profile-modal-card .profile-hero{display:flex!important;align-items:center!important;gap:20px!important;padding:20px!important;margin:0 0 22px!important;border:1px solid var(--border)!important;border-radius:14px!important;background:linear-gradient(135deg,#f8fafc,#f1f5f9)!important}.profile-modal-card .profile-avatar-stage{position:relative!important;width:76px!important;height:76px!important}.profile-modal-card .profile-avatar-large{width:76px!important;height:76px!important;border-radius:50%!important;object-fit:cover!important}.profile-modal-card .profile-avatar-camera{display:grid!important;position:absolute!important;right:-4px!important;bottom:-3px!important;width:26px!important;height:26px!important;padding:0!important;border-radius:50%!important;background:#fff!important;color:#2563eb!important}.profile-modal-card .profile-role-row{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important}.profile-modal-card .profile-fields{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important}.profile-modal-card .profile-fields .form-group{display:grid!important;gap:7px!important;margin:0!important;min-width:0!important;color:var(--text-muted)!important;font-size:11px!important;font-weight:700!important}.profile-modal-card .profile-fields .form-group>span{display:flex!important;align-items:center!important}.profile-modal-card .profile-input-wrap input{width:100%!important;min-height:42px!important;margin:0!important;padding:0 12px 0 34px!important}.profile-modal-card .profile-security-note{display:flex!important}.profile-modal-card .profile-actions{display:none!important}.profile-modal-card .modal-footer{justify-content:flex-end!important;gap:8px!important}.profile-modal-card .modal-footer [data-workflow-notice]{margin-right:auto!important}.profile-modal-card .modal-footer [data-workflow-profile-save]{order:2!important}@media(max-width:560px){.profile-modal-card .profile-panel-body{padding:16px!important}.profile-modal-card .profile-hero{align-items:flex-start!important;padding:16px!important;gap:14px!important}.profile-modal-card .profile-fields{grid-template-columns:1fr!important}.profile-modal-card .modal-footer{justify-content:stretch!important}.profile-modal-card .modal-footer [data-workflow-notice]{flex-basis:100%!important}.profile-modal-card .modal-footer button{flex:1!important}}';document.head.appendChild(style);}
    const body=workflowModal.querySelector('[data-workflow-body]'),copy=source.cloneNode(true);workflowMarkup=source.innerHTML;copy.className='';copy.removeAttribute('id');if(workflowModal.dataset.workflowKind==='profile'){const pageHead=copy.querySelector('.page-head');if(pageHead)pageHead.hidden=true;const innerTitle=copy.querySelector('.profile-hero-copy h2');if(innerTitle)innerTitle.hidden=true;}const title=source.ownerDocument.querySelector('#modalTitle')?.textContent||source.ownerDocument.querySelector('#drawerRoot h2')?.textContent||source.ownerDocument.querySelector('#content h1')?.textContent;if(title)workflowModal.querySelector('h3').textContent=title;
    const originals=[source,...source.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];workflowPairs=originals.map((n,i)=>[n,clones[i]]);styleWorkflow(copy);if(workflowModal.dataset.workflowKind==='profile'){copy.querySelector('.profile-panel')?.style.setProperty('padding','0','important');copy.querySelector('.profile-panel-body')?.style.setProperty('padding','22px','important');copy.querySelector('.profile-hero')?.style.setProperty('display','flex','important');copy.querySelector('.profile-hero')?.style.setProperty('align-items','center','important');copy.querySelector('.profile-fields')?.style.setProperty('display','grid','important');copy.querySelector('.profile-fields')?.style.setProperty('grid-template-columns','repeat(2,minmax(0,1fr))','important');if(window.matchMedia('(max-width:560px)').matches){copy.querySelector('.profile-panel-body')?.style.setProperty('padding','16px','important');copy.querySelector('.profile-fields')?.style.setProperty('grid-template-columns','1fr','important');copy.querySelector('.profile-hero')?.style.setProperty('align-items','flex-start','important');}copy.querySelector('.profile-avatar-status')?.remove();const upload=copy.querySelector('.profile-upload-button');if(upload){upload.hidden=false;upload.removeAttribute('style');upload.className='button button-small profile-upload-button';upload.textContent='Đổi avatar';upload.style.cssText='display:inline-flex!important;align-items:center;justify-content:center;cursor:pointer;padding:9px 14px;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;line-height:1.2';}const fileInput=copy.querySelector('#wf-profileAvatarInput');if(fileInput){fileInput.hidden=false;fileInput.classList.remove('is-hidden');fileInput.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';if(upload)upload.onclick=()=>fileInput?.click();}copy.querySelector('.profile-hero-copy')?.style.setProperty('display','block','important');copy.querySelector('.profile-hero-copy p')?.style.setProperty('margin','6px 0 12px','important');}
    if(workflowModal.dataset.workflowKind==='profile'){
      // Modal chỉ giữ tiêu đề ở modal-header, không lặp lại page header bên trong form.
      const profilePageHead=copy.querySelector('.page-head'); if(profilePageHead){profilePageHead.hidden=true;profilePageHead.setAttribute('aria-hidden','true');profilePageHead.style.setProperty('display','none','important');}
      if(!q('#referenceProfileModalFixStyles')){const style=document.createElement('style');style.id='referenceProfileModalFixStyles';style.textContent='.profile-modal-card .modal-body{padding:0!important}.profile-modal-card .profile-panel{margin:0!important;border:0!important;background:transparent!important;box-shadow:none!important}.profile-modal-card .profile-panel-body{max-width:none!important;padding:22px!important}.profile-modal-card .profile-hero{display:flex!important;align-items:center!important;gap:20px!important;margin:0 0 22px!important;padding:20px!important;border:1px solid #e2e8f0!important;border-radius:14px!important;background:linear-gradient(135deg,#f8fafc,#f1f5f9)!important}.profile-modal-card .profile-avatar-stage{position:relative!important;width:76px!important;height:76px!important;flex:0 0 76px!important}.profile-modal-card .profile-avatar-large{width:76px!important;height:76px!important;border-radius:50%!important;object-fit:cover!important}.profile-modal-card .profile-avatar-camera{position:absolute!important;right:-4px!important;bottom:-3px!important;width:26px!important;height:26px!important;display:grid!important;place-items:center!important;padding:0!important;border:1px solid #e2e8f0!important;border-radius:50%!important;background:#fff!important;color:#2563eb!important;box-shadow:0 2px 6px rgba(15,23,42,.12)!important}.profile-modal-card .profile-hero-copy{display:block!important;min-width:0!important;flex:1!important}.profile-modal-card .profile-role-row{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;margin-bottom:7px!important}.profile-modal-card .profile-fields{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important}.profile-modal-card .profile-fields .form-group{display:grid!important;gap:7px!important;min-width:0!important;margin:0!important;color:#475569!important;font-size:12px!important;font-weight:700!important}.profile-modal-card .profile-fields .form-group>span{display:flex!important;align-items:center!important;gap:4px!important;line-height:1.25!important}.profile-modal-card .profile-fields .form-group>span em{color:#ef4444!important;font-style:normal!important}.profile-modal-card .profile-input-wrap{position:relative!important;display:flex!important;align-items:center!important}.profile-modal-card .profile-input-wrap>span{position:absolute!important;left:12px!important;z-index:1!important;color:#64748b!important;font-size:14px!important;line-height:1!important;pointer-events:none!important}.profile-modal-card .profile-input-wrap input{width:100%!important;min-height:43px!important;margin:0!important;padding:0 12px 0 34px!important;border:1.5px solid #e2e8f0!important;border-radius:9px!important;background:#fff!important;color:#0f172a!important;font:600 13px/1.2 Arial,sans-serif!important}.profile-modal-card .profile-input-wrap input:focus{border-color:#2563eb!important;box-shadow:0 0 0 3px rgba(37,99,235,.12)!important;outline:none!important}.profile-modal-card .profile-security-note{display:flex!important;align-items:center!important;gap:10px!important;margin-top:18px!important;padding:12px 15px!important;border:1px dashed #e2e8f0!important;border-radius:10px!important;background:#f8fafc!important}.profile-modal-card .profile-security-note>span{flex:0 0 auto!important;color:#d97706!important;font-size:16px!important}.profile-modal-card .profile-security-note strong,.profile-modal-card .profile-security-note small{display:block!important}.profile-modal-card .profile-security-note strong{font-size:12px!important;color:#0f172a!important}.profile-modal-card .profile-security-note small{margin-top:3px!important;color:#64748b!important;font-size:10.5px!important}.profile-modal-card .profile-actions{display:none!important}.profile-modal-card .modal-footer{justify-content:flex-end!important;gap:8px!important}.profile-modal-card .modal-footer [data-workflow-notice]{margin-right:auto!important}@media(max-width:560px){.profile-modal-card .profile-panel-body{padding:16px!important}.profile-modal-card .profile-hero{align-items:flex-start!important;gap:14px!important;padding:16px!important}.profile-modal-card .profile-fields{grid-template-columns:1fr!important}.profile-modal-card .modal-footer{justify-content:stretch!important}.profile-modal-card .modal-footer button{flex:1!important}}';document.head.appendChild(style)}
    }
    workflowPairs.forEach(([n,c],i)=>{c.dataset.workflowNode=i;if(n.matches('input,select,textarea')){if(n.type!=='file')c.value=n.value;c.checked=n.checked;c.disabled=n.disabled;}});
    body.replaceChildren(copy);
    if(workflowModal.dataset.workflowKind==='customer'){
      const detailGrid=body.querySelector('.detail-grid');
      const appointmentButton=body.querySelector('#btnNewCustAppointment');
      const noteInput=body.querySelector('#customerNote');
      const shortcuts=document.createElement('div');
      shortcuts.className='customer-care-shortcuts';
      shortcuts.innerHTML='<button type="button" data-customer-care-note>✎ Thêm ghi chú Sale</button><button type="button" data-customer-care-appointment>📅 Tạo lịch hẹn</button>';
      const insertTarget=detailGrid||body.firstElementChild;
      insertTarget?.after(shortcuts);
      shortcuts.querySelector('[data-customer-care-note]').onclick=()=>{noteInput?.focus();noteInput?.scrollIntoView({behavior:'smooth',block:'center'});};
      shortcuts.querySelector('[data-customer-care-appointment]').onclick=()=>{if(appointmentButton){appointmentButton.scrollIntoView({behavior:'smooth',block:'center'});appointmentButton.focus();}};
    }
    if(workflowModal.dataset.workflowKind==='profile'){
      // Thu gon khu vuc avatar: chi giu anh vuong va nut doi avatar.
      const profileHero=body.querySelector('.profile-hero');
      if(profileHero){
        profileHero.style.setProperty('align-items','center','important');
        profileHero.style.setProperty('gap','12px','important');
        profileHero.style.setProperty('padding','0 0 18px','important');
        profileHero.style.setProperty('margin','0 0 20px','important');
        profileHero.style.setProperty('border','0','important');
        profileHero.style.setProperty('border-bottom','1px solid #e2e8f0','important');
        profileHero.style.setProperty('border-radius','0','important');
        profileHero.style.setProperty('background','transparent','important');
      }
      const profileAvatar=body.querySelector('.profile-avatar-large');
      if(profileAvatar){
        profileAvatar.style.setProperty('width','76px','important');
        profileAvatar.style.setProperty('height','76px','important');
        profileAvatar.style.setProperty('border-radius','10px','important');
        profileAvatar.style.setProperty('object-fit','cover','important');
      }
      body.querySelector('.profile-avatar-camera')?.remove();
      body.querySelector('.profile-role-row')?.remove();
      body.querySelector('.profile-display-name')?.remove();
      body.querySelector('.profile-hero-actions small')?.remove();
      const profileActions=body.querySelector('.profile-hero-actions');
      if(profileActions){profileActions.style.setProperty('margin','0','important');profileActions.style.setProperty('display','flex','important');}
      const innerPageHead=body.querySelector('.page-head');
      if(innerPageHead){
        innerPageHead.hidden=true;
        innerPageHead.setAttribute('aria-hidden','true');
        innerPageHead.style.setProperty('display','none','important');
      }
      copy.querySelector('.profile-actions')?.remove();
      const save=workflowModal.querySelector('[data-workflow-profile-save]');
      if(save)save.setAttribute('form','wf-profileForm');
    }
  }
  async function workflow(kind,id){
    if(working||workflowBusy)return;
    if(kind==='newOrder'){openAccountingOrderForm(id||'');return;}
    if(kind==='order'||kind==='editOrder'){openReceiptOrderDetail(id,kind==='editOrder');return;}
    try{const result=await api.openWorkflow(kind,id);q('#referenceWorkflow')?.remove();const modal=document.createElement('div');modal.id='referenceWorkflow';modal.className='modal-overlay open';modal.style.zIndex='11000';modal.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(result.title)}" style="width:min(1080px,calc(100vw - 24px));max-height:92dvh"><div class="modal-header"><h3>${esc(result.title)}</h3><button type="button" class="modal-close-btn" data-workflow-close aria-label="Đóng">×</button></div><div class="modal-body" data-workflow-body></div><div class="modal-footer" style="flex-wrap:wrap"><span role="status" data-workflow-notice style="flex:1;overflow-wrap:anywhere"></span><button type="button" class="btn-action btn-secondary" data-workflow-close>Đóng</button>${kind==='profile'?'<button type="submit" class="btn-action btn-primary" data-workflow-profile-save>Lưu hồ sơ</button>':''}</div></div>`;document.body.appendChild(modal);workflowModal=modal;workflowModal.dataset.workflowKind=kind;if(kind==='profile'){modal.querySelector('.modal-card').style.width='min(760px,calc(100vw - 24px))';}drawWorkflow();
      if(kind==='profile')modal.querySelector('.modal-card')?.classList.add('profile-modal-card');
      modal.querySelectorAll('[data-workflow-close]').forEach(b=>b.onclick=async()=>{if(workflowBusy)return;try{await api.closeWorkflow(true);modal.remove();workflowModal=null;refresh(true);}catch(e){modal.querySelector('[data-workflow-notice]').textContent=e.message;}});
      const invoke=async(event,type)=>{const clone=event.target.closest(type==='click'?'button,a,input[readonly]':'[data-workflow-node]');if(!clone)return;const source=workflowPairs[Number(clone.dataset.workflowNode)]?.[0];if(!source)return;
        if(type==='click'&&event.target.closest('[data-workflow-profile-save]')){event.preventDefault();event.stopPropagation();modal.querySelector('#wf-profileForm')?.requestSubmit();return;}
        if(type==='click'&&!clone.matches('button,a,input[readonly]'))return;
        if(type==='click'&&clone.matches('button')&&clone.type==='submit'&&clone.closest('form'))return;
        event.preventDefault();event.stopPropagation();if(workflowBusy)return;syncWorkflowControls();workflowBusy=true;
        let done=false;
        try{const result=await api.workflowEvent(source,type);if(type!=='input')drawWorkflow();if(workflowModal)workflowModal.querySelector('[data-workflow-notice]').textContent=result.notice||'';done=true;}
        catch(e){modal.querySelector('[data-workflow-notice]').textContent=e.message;}
        finally{workflowBusy=false;}
        if(done)refresh(true);
      };
      modal.addEventListener('click',e=>{if(kind==='profile'&&e.target.closest('[data-workflow-profile-save]')){e.preventDefault();e.stopPropagation();modal.querySelector('#wf-profileForm')?.requestSubmit();}},true);
      modal.addEventListener('click',e=>invoke(e,'click'));
      modal.addEventListener('submit',e=>invoke(e,'submit'));
      modal.addEventListener('change',e=>invoke(e,'change'));
      modal.addEventListener('input',e=>{syncWorkflowControls();const pair=workflowPairs[Number(e.target.dataset.workflowNode)];if(pair)pair[0].dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));});
    }catch(e){alert(e.message);}
  }
  // Không vẽ lại khi người dùng còn sửa dở (giá trị clone khác nguồn), tránh mất Level/Ghi chú chưa lưu.
  const workflowDirty=()=>workflowPairs.some(([source,clone])=>source.matches?.('input,select,textarea')&&source.type!=='file'&&(source.value!==clone.value||('checked'in source&&source.checked!==clone.checked)));
  setInterval(()=>{if(workflowModal&&!workflowBusy&&!workflowModal.contains(document.activeElement)&&!workflowDirty()){const source=api?.workflowRoot();if(!source||source.innerHTML!==workflowMarkup)drawWorkflow();}},500);
  // Các tác vụ chuyên sâu gom vào Cài đặt, không thêm dropdown trên từng tab.
  const featureActions=new Map();
  const roleTools={
    ADMIN:null,
    HRM:new Set(['order','orders','attendance','password','profile']),
    MANAGER:new Set(['customer','newCustomer','customers','pool','order','editOrder','newOrder','orders','attendance','revenue','reports','password','profile']),
    LEADER:new Set(['customer','newCustomer','customers','pool','order','editOrder','newOrder','orders','attendance','revenue','reports','password','profile']),
    SALE:new Set(['customer','newCustomer','customers','accept','order','editOrder','newOrder','orders','attendance','revenue','password','profile'])
  };
  function featureMenu(tab,items){
    const role=data.user.actualRole||data.user.role,allowed=roleTools[role];
    featureActions.set(tab,items.filter(([kind])=>(!allowed||allowed.has(kind))&&(!['profile','customers','pool','accept','attendance','revenue','marketing','orders'].includes(kind)||data.navigation.includes(kind)||(kind==='pool'&&role==='ADMIN'))&&(kind!=='reports'||['ADMIN','MANAGER','LEADER'].includes(role))&&(!['import','categories','fields','settings','createTeam','products','distribution','member','emailTest'].includes(kind)||role==='ADMIN')));
  }
  function removeUnusedControls(){
    q('#tab-team .headline-row button')?.remove();
    q('#referenceTools')?.remove();
    q('#tab-settings .settings-email-grid')?.closest('.settings-section')?.remove();
    q('#tab-settings .settings-attendance-toggle')?.remove();
    q('#tab-settings #leaderAttendanceRequired')?.closest('label')?.remove();
    q('#tab-settings #emailNotificationsEnabled')?.closest('label')?.remove();
    q('#tab-settings #emailTestButton')?.closest('.settings-test-field')?.remove();
    qa('#tab-settings .table-container').forEach(card=>{
      const label=card.textContent||'';
      if(/Email nội bộ|Gửi email cho Sale|Leader bắt buộc điểm danh/i.test(label))card.remove();
    });

  }
  function wireParity(){
    removeUnusedControls();
    featureActions.clear();
    featureMenu('customers',[['newCustomer','Thêm khách đầy đủ thông tin'],['customers','Quản lý đầy đủ / lọc nhân sự'],['import','Nhập khách CSV'],['fields','Cột / lưu trữ / khôi phục'],['pool','Chia khách thủ công']]);
    featureMenu('care',[['customers','Hồ sơ, ghi chú và lịch chăm sóc']]);
    featureMenu('dashboard',data.user.role==='SALE'?[['accept','Nhận data · hạn 24 giờ'],['profile','Hồ sơ của tôi']]:[['reports','Báo cáo tổng hợp']]);
    featureMenu('data',data.user.role==='SALE'?[['accept','Nhận data · hạn 24 giờ']]:[['pool','Chia đều / thủ công / tỷ trọng'],['distribution','Bật người nhận và tỷ trọng']]);
    featureMenu('orders',[['newOrder','Tạo đơn đầy đủ thông tin'],['orders','Sửa / xóa / tra cứu đơn']]);
    featureMenu('team',[['member','Thêm thành viên']]);q('#tab-team .headline-row button')?.remove();
    featureMenu('settings',[['password','Đổi mật khẩu của tôi'],['profile','Hồ sơ / avatar'],['settings','Cài đặt đầy đủ']]);
    q('#referenceTools')?.remove();toolsRole=data.user.role;
    q('.user-pill').onclick=()=>{
      if(!q('#referenceProfileStyles')){
        const style=document.createElement('style');style.id='referenceProfileStyles';style.textContent='.profile-modal-card{width:min(560px,calc(100vw - 24px))!important}.reference-profile-tools{display:grid;gap:12px}.reference-profile-summary{display:flex;align-items:center;gap:12px;padding:4px 2px 14px;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:2px}.reference-sale-calendar{margin-top:18px}.reference-sale-calendar .section-label{margin:0 0 10px;font-weight:800;color:var(--text-main,#0f172a)}.reference-sale-calendar .attendance-detail-calendar{grid-template-columns:repeat(3,minmax(0,1fr))}.reference-sale-calendar .attendance-month-grid{padding:6px;gap:3px}.reference-sale-calendar .attendance-day{min-height:42px;font-size:10px}.reference-sale-calendar .attendance-day small{font-size:8px;line-height:1.1}.reference-profile-avatar{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#eff6ff;color:#2563eb;font-size:17px;font-weight:800}.reference-profile-summary strong,.reference-profile-summary span{display:block}.reference-profile-summary strong{font-size:16px;color:var(--text-main,#0f172a)}.reference-profile-summary span{margin-top:4px;color:var(--text-muted,#64748b);font-size:11px;font-weight:700;text-transform:uppercase}.reference-profile-action{width:100%;display:grid;grid-template-columns:38px 1fr 18px;align-items:center;gap:12px;text-align:left;padding:14px 15px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg-card,#fff);color:var(--text-main,#0f172a);cursor:pointer;transition:border-color .16s,background .16s,transform .16s}.reference-profile-action:hover{border-color:#2563eb;background:#f8fbff;transform:translateY(-1px)}.reference-profile-action strong,.reference-profile-action small{display:block}.reference-profile-action strong{font-size:13px}.reference-profile-action small{margin-top:4px;color:var(--text-muted,#64748b);font-size:11px}.reference-profile-action>b{font-size:22px;font-weight:400;color:#94a3b8;text-align:right}.reference-profile-icon{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;background:#fff7ed;color:#c2410c;font-size:19px;font-weight:700}@media(max-width:560px){.profile-modal-card{width:calc(100vw - 18px)!important}.reference-profile-action{padding:13px 12px}}';
        document.head.appendChild(style);
      }
      const modal=editor('Hồ sơ cá nhân',`<div class="reference-profile-tools">
        <div class="reference-profile-summary"><div class="reference-profile-avatar">${esc((data.user.name||'NVT').split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase())}</div><div><strong>${esc(data.user.name||'Người dùng')}</strong><span>${esc(data.user.actualRole||data.user.role||'')}</span></div></div>
        <button type="button" class="reference-profile-action" data-profile-action="profile"><span class="reference-profile-icon">✎</span><span><strong>Thông tin cá nhân</strong><small>Cập nhật họ tên, ID Sale và avatar</small></span><b>›</b></button>
        <button type="button" class="reference-profile-action" data-profile-action="password"><span class="reference-profile-icon">⌁</span><span><strong>Đổi mật khẩu</strong><small>Cập nhật mật khẩu đăng nhập của bạn</small></span><b>›</b></button>
      </div>`);
      modal.querySelector('.modal-card').classList.add('profile-modal-card');
      modal.querySelector('[data-profile-action="profile"]').onclick=()=>{modal.remove();workflow('profile');};
      modal.querySelector('[data-profile-action="password"]').onclick=()=>{modal.remove();workflow('password');};
    };
    qa('#tab-customers button').filter(b=>/Nhập CSV/.test(b.textContent)).forEach(b=>{b.removeAttribute('onclick');b.onclick=()=>workflow('import');});
    qa('#tab-orders .headline-row button,#tab-revenue .headline-row button').filter(b=>/Xuất CSV/.test(b.textContent)).forEach(b=>{const role=data.user.actualRole||data.user.role;if(role==='SALE'||role==='HRM')b.remove();else{b.removeAttribute('onclick');b.onclick=()=>run(()=>api.exportData(b.closest('section').id==='tab-orders'?'orders':'revenue',q('#revStartDate').value,q('#revEndDate').value));}});
    qa('#tab-revenue .headline-row button').filter(b=>/Tạo hợp đồng/.test(b.textContent)).forEach(b=>b.remove());
    qa('#tab-settings button').filter(b=>b.textContent.trim()==='Gửi kiểm tra').forEach(b=>{b.removeAttribute('onclick');b.onclick=()=>workflow('emailTest');});
    qa('#tab-revenue .headline-row button').filter(b=>/Tạo hợp đồng/.test(b.textContent)).forEach(b=>{b.removeAttribute('onclick');b.onclick=()=>workflow('newOrder');});
  }
  function installAttendanceDetailStyles(){
    if(q('#attendanceDetailStyles'))return;
    const style=document.createElement('style');style.id='attendanceDetailStyles';style.textContent=`
      .attendance-detail{display:grid;gap:16px;color:var(--text-main)}
      .attendance-detail-toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
      .attendance-detail-intro{display:grid;gap:4px}.attendance-detail-intro strong{font-size:15px}.attendance-detail-intro span{font-size:12px;color:var(--text-muted)}
      .attendance-month-picker{display:grid;gap:5px;min-width:190px}.attendance-month-picker label{font-size:11px;font-weight:700;color:var(--text-muted)}
      .attendance-month-picker select{width:100%;min-height:38px;padding:8px 34px 8px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg-card);color:var(--text-main);font:inherit;font-size:12px}
      .attendance-detail-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .attendance-detail-kpi{border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);padding:12px 14px;min-width:0}
      .attendance-detail-kpi strong{display:block;font-size:22px;line-height:1.15;color:var(--text-main)}.attendance-detail-kpi span{display:block;margin-top:5px;color:var(--text-muted);font-size:11px;line-height:1.3}
      .attendance-detail-calendar{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card)}
      .attendance-month-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 13px;background:var(--bg-subtle);border-bottom:1px solid var(--border);font-size:12px}.attendance-month-head small{color:var(--text-muted);font-size:11px}
      .attendance-calendar-content{padding:10px 12px 12px}.attendance-calendar-legend{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 10px;color:var(--text-muted);font-size:10px}
      .attendance-calendar-legend span{display:inline-flex;align-items:center;gap:5px}.attendance-calendar-legend i{width:9px;height:9px;border-radius:3px;background:#d1fae5;border:1px solid #a7f3d0}.attendance-calendar-legend .legend-late{background:#ffedd5;border-color:#fed7aa}.attendance-calendar-legend .legend-missing{background:#fee2e2;border-color:#fecaca}.attendance-calendar-legend .legend-off{background:#f1f5f9;border-color:#e2e8f0}
      .attendance-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}.attendance-weekday{text-align:center;color:var(--text-muted);font-size:10px;font-weight:700;padding:3px 0}
      .attendance-day{min-height:48px;border:1px solid var(--border-light);border-radius:6px;padding:5px;text-align:center;background:var(--bg-card);font-size:11px}.attendance-day b{display:block;font-size:11px}.attendance-day small{display:block;margin-top:5px;font-size:9px;line-height:1.15;overflow-wrap:anywhere}
      .attendance-day.is-present{background:#ecfdf5;border-color:#a7f3d0;color:#047857}.attendance-day.is-late{background:#fff7ed;border-color:#fed7aa;color:#c2410c}.attendance-day.is-missing{background:#fef2f2;border-color:#fecaca;color:#b91c1c}.attendance-day.is-weekend,.attendance-day.is-future,.attendance-day.attendance-empty{background:var(--bg-subtle);color:var(--text-faint)}
      .attendance-detail-table{border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:360px}.attendance-detail-table table{min-width:620px;width:100%}.attendance-detail-table thead{position:sticky;top:0;z-index:1;background:var(--bg-card)}.attendance-detail-empty{padding:22px!important;text-align:center;color:var(--text-muted)}
      .attendance-action-cell{text-align:right!important;white-space:nowrap}.attendance-action-cell .btn-action{min-height:30px;padding:5px 10px;font-size:11px}#referenceAttendanceHistory th:last-child,#referenceAttendanceHistory td:last-child{white-space:nowrap;text-align:right}
      @media(max-width:700px){.attendance-detail-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.attendance-calendar-content{padding:8px}.attendance-month-grid{gap:3px}.attendance-day{min-height:42px;padding:4px 2px}.attendance-day small{font-size:8px}}
      .attendance-personal-card{display:grid;gap:16px;padding:22px;background:var(--bg-card);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.06);color:var(--text-main)}
      .attendance-personal-head,.attendance-personal-history-head,.attendance-today-card{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}.attendance-personal-head h2{margin:4px 0 3px;font-size:21px}.attendance-personal-head p,.attendance-personal-history-head span,.attendance-today-card span{display:block;margin:0;color:var(--text-muted);font-size:12px}.attendance-eyebrow{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--accent)}
      .attendance-today-card{padding:16px 18px;border:1px solid var(--border-light);border-radius:12px;background:linear-gradient(135deg,var(--bg-subtle),var(--bg-card))}.attendance-today-card b,.attendance-personal-history-head b{display:block;font-size:14px;margin-bottom:4px}.attendance-today-result{text-align:right}.attendance-today-result strong{display:block;font-size:22px;color:var(--accent)}.attendance-today-result small{color:var(--text-muted);font-size:11px}
      .attendance-personal-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.attendance-personal-kpis>div{padding:13px 14px;border:1px solid var(--border-light);border-radius:11px;background:var(--bg-subtle)}.attendance-personal-kpis strong{display:block;font-size:22px}.attendance-personal-kpis span{display:block;margin-top:3px;color:var(--text-muted);font-size:11px}.attendance-personal-history{overflow:hidden;border:1px solid var(--border);border-radius:12px}.attendance-personal-history-head{padding:14px 16px;border-bottom:1px solid var(--border);background:var(--bg-subtle)}.attendance-personal-history .table-responsive{max-height:380px;overflow:auto}.attendance-personal-history table{min-width:700px}@media(max-width:600px){.attendance-personal-card{padding:16px}.attendance-personal-kpis{grid-template-columns:1fr}.attendance-personal-head .chip{width:100%;text-align:center}}
    `;document.head.appendChild(style);
  }
  function attendanceDetailMarkup(memberId,selectedMonth=''){
    const role=data.user.actualRole||data.user.role;
    const personal=!['ADMIN','HRM'].includes(role);
    const member=(data.members||[]).find(item=>String(item.id)===String(memberId));
    if(!member)return '';
    window.__nvtAttendanceMonthChange=select=>{const body=select.closest('.modal-body');if(body)body.innerHTML=attendanceDetailMarkup(select.dataset.attendanceMember,select.value);};
    const today=String(data.today||'').slice(0,10),records=(data.attendance||[]).filter(item=>String(item.accountId)===String(memberId)&&String(item.date||'')<=today).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.at||'').localeCompare(String(a.at||'')));
    const currentMonth=today.slice(0,7),allowedMonths=Array.from({length:3},(_,offset)=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-offset);return d.toISOString().slice(0,7);}),monthValue=allowedMonths.includes(selectedMonth)?selectedMonth:currentMonth;
    const monthOptions=allowedMonths.map(value=>{const d=new Date(value+'-01T00:00:00Z'),label=d.toLocaleDateString('vi-VN',{month:'long',year:'numeric',timeZone:'UTC'});return '<option value="'+value+'" '+(value===monthValue?'selected':'')+'>'+esc(label)+'</option>';}).join('');
    const scoped=records.filter(item=>String(item.date||'').slice(0,7)===monthValue),late=scoped.filter(item=>item.late),outside=scoped.filter(item=>item.ipValid===false),weekdays=['T2','T3','T4','T5','T6','T7','CN'];
    const [year,monthNumber]=monthValue.split('-').map(Number),month=monthNumber-1,days=new Date(Date.UTC(year,month+1,0)).getUTCDate(),offsetDay=(new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7;
    let cells=weekdays.map(day=>'<div class="attendance-weekday">'+day+'</div>').join(''),present=0,lateCount=0,missing=0;
    for(let i=0;i<offsetDay;i++)cells+='<div class="attendance-day attendance-empty" aria-hidden="true"></div>';
    for(let day=1;day<=days;day++){
      const date=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'),rec=records.find(item=>item.date===date),dow=(offsetDay+day-1)%7,weekend=dow>=5,future=date>today;
      let cls='attendance-day',label='';
      if(rec){present++;if(rec.late){lateCount++;cls+=' is-late';label='Mu\u1ed9n '+Number(rec.lateMinutes||0)+'p';}else{cls+=' is-present';label='C\u00f3 m\u1eb7t';}}
      else if(future)cls+=' is-future';else if(weekend)cls+=' is-weekend';else{missing++;cls+=' is-missing';label='V\u1eafng';}
      cells+='<div class="'+cls+'" title="'+esc(date)+'"><b>'+day+'</b><small>'+esc(label)+'</small></div>';
    }
    const monthName=new Date(Date.UTC(year,month,1)).toLocaleDateString('vi-VN',{month:'long',year:'numeric',timeZone:'UTC'});
    const rows=scoped.map(item=>'<tr><td>'+esc(fmtDate(item.date))+'</td><td>'+esc(String(item.at||item.checkInAt||'').slice(11,16)||'\u2014')+'</td><td>'+(item.late?'<span class="chip chip-warm">Mu\u1ed9n '+Number(item.lateMinutes||0)+' ph\u00fat</span>':'<span class="chip chip-green">\u0110\u00fang gi\u1edd</span>')+'</td>'+(personal?'':'<td>'+(item.ipValid===false?'<span class="chip chip-warm">Ngo\u00e0i Wi-Fi</span>':'<span class="chip chip-green">\u0110\u00fang Wi-Fi</span>')+'</td><td>'+esc(item.note||'\u2014')+'</td>')+'</tr>').join('');
    const headers=personal?'<th>Ng\u00e0y</th><th>Gi\u1edd</th><th>K\u1ebft qu\u1ea3</th>':'<th>Ng\u00e0y</th><th>Gi\u1edd</th><th>K\u1ebft qu\u1ea3</th><th>Wi-Fi</th><th>Ghi ch\u00fa</th>';
    const emptyColspan=personal?3:5;
    const wifiKpi=personal?'':'<div class="attendance-detail-kpi"><strong>'+outside.length+'</strong><span>L\u01b0\u1ee3t ngo\u00e0i Wi-Fi</span></div>';
    return '<div class="attendance-detail"><div class="attendance-detail-toolbar"><div class="attendance-detail-intro"><strong>L\u1ecbch s\u1eed \u0111i\u1ec3m danh '+(personal?'c\u00e1 nh\u00e2n':'theo nh\u00e2n s\u1ef1')+'</strong><span>Xem l\u1ecbch, k\u1ebft qu\u1ea3 v\u00e0 c\u00e1c l\u01b0\u1ee3t \u0111i\u1ec3m danh c\u1ee7a '+esc(member.name)+'.</span></div><div class="attendance-month-picker"><label for="attendanceMonthSelect">Th\u00e1ng xem</label><select id="attendanceMonthSelect" data-attendance-month data-attendance-member="'+esc(memberId)+'" onchange="window.__nvtAttendanceMonthChange(this)">'+monthOptions+'</select></div></div>'+
      '<div class="attendance-detail-kpis"><div class="attendance-detail-kpi"><strong>'+scoped.length+'</strong><span>L\u01b0\u1ee3t \u0111i\u1ec3m danh trong th\u00e1ng</span></div><div class="attendance-detail-kpi"><strong>'+late.length+'</strong><span>L\u01b0\u1ee3t \u0111i mu\u1ed9n</span></div><div class="attendance-detail-kpi"><strong>'+late.reduce((sum,item)=>sum+Number(item.lateMinutes||0),0)+'p</strong><span>T\u1ed5ng th\u1eddi gian \u0111i mu\u1ed9n</span></div>'+wifiKpi+'</div>'+
      '<section class="attendance-detail-calendar"><div class="attendance-month-head"><b>'+esc(monthName)+'</b><small>'+present+' c\u00f3 m\u1eb7t \u00b7 '+lateCount+' \u0111i mu\u1ed9n \u00b7 '+missing+' ng\u00e0y ch\u01b0a \u0111i\u1ec3m danh</small></div><div class="attendance-calendar-content"><div class="attendance-calendar-legend"><span><i></i>C\u00f3 m\u1eb7t</span><span><i class="legend-late"></i>\u0110i mu\u1ed9n</span><span><i class="legend-missing"></i>Ch\u01b0a \u0111i\u1ec3m danh</span><span><i class="legend-off"></i>Cu\u1ed1i tu\u1ea7n / ch\u01b0a t\u1edbi</span></div><div class="attendance-month-grid">'+cells+'</div></div></section>'+
      '<div class="attendance-detail-table"><table class="modern-table"><thead><tr>'+headers+'</tr></thead><tbody>'+(rows||'<tr><td colspan="'+emptyColspan+'" class="attendance-detail-empty">Kh\u00f4ng c\u00f3 l\u01b0\u1ee3t \u0111i\u1ec3m danh trong th\u00e1ng n\u00e0y.</td></tr>')+'</tbody></table></div></div>';
  }
  function attendanceDetailModal(memberId){
    const role=data.user.actualRole||data.user.role;
    const ownId=data.user.saleId||data.user.leaderId||data.user.id;
    if(!['ADMIN','HRM'].includes(role)&&String(memberId)!==String(ownId))return;
    const member=(data.members||[]).find(item=>String(item.id)===String(memberId));
    if(!member)return;
    installAttendanceDetailStyles();
    const modal=editor('Chi ti\u1ebft \u0111i\u1ec3m danh \u00b7 '+member.name,attendanceDetailMarkup(memberId));
    const card=modal.querySelector('.modal-card');
    if(card){card.style.width='min(1000px,calc(100vw - 24px))';card.style.maxHeight='92dvh';}
    modal.querySelector('.modal-body')?.style.setProperty('padding','16px');
  }
  function attendanceEditor(memberId){
    if((data.user.actualRole||data.user.role)!=='ADMIN')return;
    const member=data.members.find(m=>m.id===memberId);if(!member)return;
    const modal=editor('Điểm danh bù / Sửa điểm danh · '+member.name,
      formField('Ngày điểm danh', '<input id="refAttendanceDate" type="date" required max="'+esc(data.today)+'" value="'+esc(data.today)+'">')+
      '<p id="refAttendanceStatus" role="status"></p>'+
      formField('Giờ điểm danh','<input id="refAttendanceTime" type="time" required>')+
      formField('Lý do ghi bù / điều chỉnh','<textarea id="refAttendanceNote" rows="3" required maxlength="300" placeholder="Ví dụ: nhân viên quên bấm điểm danh"></textarea>'),
      ()=>api.saveAttendance({accountId:memberId,date:modal.querySelector('#refAttendanceDate').value,time:modal.querySelector('#refAttendanceTime').value,note:modal.querySelector('#refAttendanceNote').value}));
    const load=()=>{const date=modal.querySelector('#refAttendanceDate').value,record=data.attendance.find(r=>r.accountId===memberId&&r.date===date);modal.querySelector('#refAttendanceTime').value=record?String(record.at||'').slice(11,16):data.settings.attendanceDeadline||'09:00';modal.querySelector('#refAttendanceNote').value=record?.note||'';modal.querySelector('#refAttendanceStatus').textContent=record?'Đã có điểm danh ngày này. Lưu sẽ cập nhật bản ghi hiện có.':'Chưa có điểm danh ngày này. Lưu để ghi bù.';};
    modal.querySelector('#refAttendanceDate').onchange=load;load();
  }
  function attendance(){
    const role=data.user.actualRole||data.user.role;
    const attendanceTab=q('#tab-attendance');
    if(!['ADMIN','MANAGER','LEADER','SALE','MARKETING','ACCOUNTING','UNASSIGNED','HRM'].includes(role)){attendanceTab?.classList.remove('active');return;}
    if(role==='HRM'){hrmAttendance();return;}
    installAttendanceDetailStyles();
    const panels=Array.from(attendanceTab?.querySelectorAll('.table-container')||[]);
    const today=String(data.today||'').slice(0,10);
    const ownId=data.user.saleId||data.user.leaderId||data.user.id;
    const ownMember=(data.members||[]).find(item=>String(item.id)===String(ownId));
    const allRecords=(data.attendance||[]).filter(item=>String(item.date||'')<=today);
    const recordTime=item=>{const match=String(item?.at||item?.checkInAt||'').match(/(\d{2}:\d{2})(?::\d{2})?$/);return match?match[1]:String(item?.at||item?.checkInAt||'').slice(11,16)||'?';};
    if(role!=='ADMIN'){
      panels.forEach(panel=>{panel.hidden=true;panel.style.setProperty('display','none','important');});
      let card=attendanceTab?.querySelector('#referencePersonalAttendance');
      if(!card){card=document.createElement('section');card.id='referencePersonalAttendance';card.className='table-container';attendanceTab?.appendChild(card);}
      card.hidden=false;card.style.removeProperty('display');
      const mineToday=allRecords.find(item=>String(item.accountId)===String(ownId)&&String(item.date)===today);
      const todayLabel=new Date(today+'T00:00:00+07:00').toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
      card.innerHTML='<div class="attendance-personal-card"><div class="attendance-personal-head"><div><span class="attendance-eyebrow">H\u1ed2 S\u01a0 \u0110I\u1ec2M DANH C\u00c1 NH\u00c2N</span><h2>\u0110i\u1ec3m danh c\u1ee7a t\u00f4i</h2><p>'+esc(ownMember?.name||data.user.name||'Nh\u00e2n s\u1ef1')+' \u00b7 '+esc(ownMember?.role||role)+'</p></div><span class="chip '+(mineToday?'chip-green':'chip-warm')+'">'+(mineToday?'\u0110\u00e3 \u0111i\u1ec3m danh h\u00f4m nay':'Ch\u01b0a \u0111i\u1ec3m danh h\u00f4m nay')+'</span></div><div class="attendance-today-card"><div><b>\u0110i\u1ec3m danh h\u00f4m nay</b><span>'+esc(todayLabel)+'</span></div><div class="attendance-today-result">'+(mineToday?'<strong>'+esc(recordTime(mineToday))+'</strong><small>'+(mineToday.late?'\u0110i mu\u1ed9n '+Number(mineToday.lateMinutes||0)+' ph\u00fat':'\u0110\u00fang gi\u1edd')+'</small>':'<strong>\u2014</strong><small>B\u1ea1n ch\u01b0a ghi nh\u1eadn \u0111i\u1ec3m danh</small>')+'</div></div><div class="attendance-personal-history-head"><div><b>L\u1ecbch s\u1eed \u0111i\u1ec3m danh c\u1ee7a t\u00f4i</b><span>Xem chi ti\u1ebft l\u1ecbch s\u1eed \u0111i\u1ec3m danh trong 3 th\u00e1ng g\u1ea7n nh\u1ea5t.</span></div><button type="button" class="btn-action btn-secondary" id="referencePersonalAttendanceDetail">Xem chi ti\u1ebft</button></div></div>';
      q('#referencePersonalAttendanceDetail')?.addEventListener('click',()=>attendanceDetailModal(ownId));
      let checkInButton=attendanceTab?.querySelector('#referenceCheckIn');
      if(!checkInButton){checkInButton=document.createElement('button');checkInButton.id='referenceCheckIn';checkInButton.className='btn-action btn-primary';checkInButton.textContent='\u0110i\u1ec3m danh h\u00f4m nay';attendanceTab?.querySelector('.headline-row')?.appendChild(checkInButton);}
      checkInButton.hidden=false;checkInButton.disabled=Boolean(mineToday);checkInButton.onclick=async event=>{event?.preventDefault?.();event?.stopPropagation?.();if(checkInButton.disabled||working)return;checkInButton.disabled=true;checkInButton.setAttribute('aria-busy','true');try{await run(()=>api.checkIn());}catch(error){checkInButton.disabled=false;throw error;}finally{checkInButton.removeAttribute('aria-busy');}};
      return;
    }
    panels.forEach(panel=>{panel.hidden=false;panel.style.removeProperty('display');});
    attendanceTab?.querySelector('#referencePersonalAttendance')?.remove();attendanceTab?.querySelector('#referenceCheckIn')?.remove();
    const panel=panels[0],deadline=panel?.querySelector('#referenceAttendanceDeadline'),timeout=panel?.querySelector('#referenceAttendanceTimeout');
    if(deadline&&timeout){deadline.value=data.settings.attendanceDeadline||'09:00';timeout.value=24;timeout.readOnly=true;const button=panel.querySelector('button');button.removeAttribute('onclick');button.onclick=()=>run(()=>api.attendanceSettings({deadline:deadline.value}));}
    const todayPanel=panels[1],todayBody=todayPanel?.querySelector('tbody');
    const todayMembers=data.members.filter(member=>member.active!==false);
    const todayTime=value=>{const match=String(value||'').match(/(\d{2}:\d{2})(?::\d{2})?$/);return match?match[1]:'';};
    const todayRecords=new Map((data.attendance||[]).filter(item=>item.date===data.today).map(item=>[item.accountId,item]));
    const checkedIn=todayMembers.filter(member=>todayRecords.has(member.id)).length;
    let todaySummary=todayPanel?.querySelector('#referenceAttendanceTodaySummary');
    if(!todaySummary&&todayPanel){todaySummary=document.createElement('div');todaySummary.id='referenceAttendanceTodaySummary';todaySummary.style.cssText='display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:18px 22px 14px;border-bottom:1px solid var(--border)';todayPanel.insertBefore(todaySummary,todayPanel.firstChild);}
    if(todaySummary){const label=new Date(String(data.today).slice(0,10)+'T00:00:00+07:00').toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});todaySummary.innerHTML='<div><b style="font-size:15px;color:var(--text-main)">\u0110i\u1ec3m danh h\u00f4m nay</b><div style="margin-top:4px;color:var(--text-muted);font-size:11px;text-transform:capitalize">'+esc(label)+'</div></div><span class="chip '+(checkedIn===todayMembers.length&&todayMembers.length?'chip-green':'chip-warm')+'">'+checkedIn+'/'+todayMembers.length+' \u0111\u00e3 \u0111i\u1ec3m danh</span>';}
    table(todayBody,todayMembers.map(member=>{const record=todayRecords.get(member.id);return [member.name+(member.phone?' \u00b7 '+member.phone:''),member.teamId||'\u2014',record?todayTime(record.at||record.checkInAt)||'\u0110\u00e3 \u0111i\u1ec3m danh':'Ch\u01b0a \u0111i\u1ec3m danh',record?.ip||'\u2014',record?(record.ipValid?'\u0110\u00fang Wi-Fi':'Ngo\u00e0i Wi-Fi'):'\u2014',record?(record.late?'Mu\u1ed9n '+record.lateMinutes+' ph\u00fat':'\u0110\u00fang gi\u1edd'):'\u2014',''];}));
    Array.from(todayBody?.rows||[]).forEach((row,index)=>{const cell=row.cells[row.cells.length-1];if(!cell)return;cell.classList.add('attendance-action-cell');cell.replaceChildren();const button=document.createElement('button');button.type='button';button.className='btn-action btn-secondary';button.textContent='Chi ti\u1ebft';button.setAttribute('aria-label','Xem chi ti\u1ebft \u0111i\u1ec3m danh c\u1ee7a '+(todayMembers[index]?.name||''));button.onclick=()=>attendanceDetailModal(todayMembers[index]?.id);cell.appendChild(button);const edit=document.createElement('button');edit.type='button';edit.className='btn-action btn-secondary';edit.textContent=todayRecords.has(todayMembers[index]?.id)?'Sửa / Ghi bù':'Điểm danh bù';edit.onclick=()=>attendanceEditor(todayMembers[index]?.id);cell.appendChild(edit);});
    q('#referenceAttendanceHistory')?.remove();
  }
  let brokeragePeriod='';
  function installBrokerageStyles(){
    if(q('#brokerageStyles'))return;const style=document.createElement('style');style.id='brokerageStyles';style.textContent=`
      .brokerage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.brokerage-kpi{padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card)}.brokerage-kpi b{display:block;font-size:20px;color:var(--text-main)}.brokerage-kpi small{display:block;margin-top:4px;color:var(--text-muted)}
      .brokerage-toolbar{display:flex;gap:10px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}.brokerage-toolbar label{display:grid;gap:5px;font-size:11px;font-weight:700;color:var(--text-muted)}.brokerage-toolbar input{padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card)}
      .brokerage-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:8px}.brokerage-table{min-width:1250px}.brokerage-table th,.brokerage-table td{white-space:nowrap}.brokerage-table th{text-align:right}.brokerage-table th:nth-child(-n+3),.brokerage-table td:nth-child(-n+3){text-align:left}
      .mindmap{overflow:auto;padding:18px;border:1px solid var(--border);border-radius:8px;background:#161a23;min-height:300px}.mindmap-root{display:inline-block;padding:10px 14px;border-radius:6px;background:#2563eb;color:#fff;font-weight:800}.mindmap-list{list-style:none;margin:12px 0 0 24px;padding:0 0 0 22px;border-left:2px solid #3b82f6}.mindmap-list li{position:relative;margin:10px 0;color:#e2e8f0}.mindmap-list li:before{content:'';position:absolute;left:-24px;top:14px;width:20px;border-top:2px solid #3b82f6}.mindmap-node{display:inline-block;padding:7px 10px;border-radius:6px;background:#252c38;color:#f8fafc;font-size:12px}.mindmap-node small{color:#93c5fd}.mindmap-empty{color:#94a3b8;padding:20px}
      @media(max-width:820px){.brokerage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.brokerage-toolbar{align-items:stretch}.brokerage-toolbar label{width:100%}}
    `;document.head.appendChild(style);
  }
  const brokerageMoney=value=>Number(value||0).toLocaleString('vi-VN')+' VND';
  const brokerageRate=value=>(Number(value||0)*100).toLocaleString('vi-VN',{maximumFractionDigits:2})+'%';
  const brokerageProductType=order=>{const product=data.products.find(item=>item.id===order.productId)||{};const label=(product.category||order.productName||'').toLocaleLowerCase('vi-VN');return product.type==='RENTAL'||label.includes('chỉ báo')||label.includes('indicator')?'INDICATOR':label.includes('khóa học')||label.includes('khoa hoc')?'COURSE':'OTHER';};
  function brokerageSales(){const role=data.user.actualRole||data.user.role;if(role==='ADMIN')return data.members.filter(m=>['MANAGER','LEADER','SALE'].includes(m.role)&&m.active!==false);if(role==='MANAGER')return (data.managerHierarchy?.members||[]).filter(m=>['MANAGER','LEADER','SALE'].includes(m.role)&&m.active!==false);if(role==='LEADER')return data.members.filter(m=>(m.id===data.user.id||m.leaderId===(data.user.leaderId||data.user.id))&&['LEADER','SALE'].includes(m.role)&&m.active!==false);return data.members.filter(m=>m.role==='SALE'&&(m.id===data.user.saleId||m.id===data.user.id)&&m.active!==false);}
  function brokerageRows(period){const sales=brokerageSales();return sales.map(member=>{const metric=data.brokerageMetrics?.find(item=>item.memberId===member.id&&item.period===period)||{basicLots:0,microLots:0,nanoLots:0,lotCommissionRate:0,indicatorCommissionRate:0,courseCommissionRate:0,bonus:0,vatRate:0};const paid=data.orders.filter(order=>order.saleId===member.id).map(order=>({...order,subtotal:OrderPayments.events(order).filter(event=>String(event.occurredAt||'').slice(0,7)===period).reduce((sum,event)=>sum+event.netAmount,0)})).filter(order=>order.subtotal!==0);const indicatorRevenue=paid.filter(order=>brokerageProductType(order)==='INDICATOR').reduce((sum,order)=>sum+Number(order.subtotal??order.total??0),0);const courseRevenue=paid.filter(order=>brokerageProductType(order)==='COURSE').reduce((sum,order)=>sum+Number(order.subtotal??order.total??0),0);const lots=Number(metric.basicLots||0)+Number(metric.microLots||0)*.1+Number(metric.nanoLots||0)*.01;const lotCommission=lots*Number(metric.lotCommissionRate||0),indicatorCommission=indicatorRevenue*Number(metric.indicatorCommissionRate||0),courseCommission=courseRevenue*Number(metric.courseCommissionRate||0),bonus=Number(metric.bonus||0),gross=lotCommission+indicatorCommission+courseCommission+bonus,vat=(indicatorCommission+courseCommission)*Number(metric.vatRate||0),net=gross-vat;return {member,metric,lots,indicatorRevenue,courseRevenue,lotCommission,indicatorCommission,courseCommission,bonus,gross,vat,net};}).sort((a,b)=>b.net-a.net||a.member.name.localeCompare(b.member.name,'vi'));}  function brokerageMetricEditor(row,period){const m=row.metric||{},modal=editor('Cập nhật lot, thưởng và hoa hồng · '+row.member.name,formField('Lot cơ bản',`<input id="brokerageBasic" type="number" min="0" step="0.01" value="${Number(m.basicLots||0)}">`)+formField('Micro lot',`<input id="brokerageMicro" type="number" min="0" step="0.01" value="${Number(m.microLots||0)}">`)+formField('Nano lot',`<input id="brokerageNano" type="number" min="0" step="0.01" value="${Number(m.nanoLots||0)}">`)+formField('Hoa hồng / lot chuẩn',`<input id="brokerageLotRate" type="number" min="0" step="1000" value="${Number(m.lotCommissionRate||0)}">`)+formField('Tỷ lệ HH chỉ báo',`<input id="brokerageIndicatorRate" type="number" min="0" max="100" step="0.01" value="${Number(m.indicatorCommissionRate||0)*100}">`)+formField('Tỷ lệ HH khóa học',`<input id="brokerageCourseRate" type="number" min="0" max="100" step="0.01" value="${Number(m.courseCommissionRate||0)*100}">`)+formField('Thưởng',`<input id="brokerageBonus" type="number" min="0" step="1000" value="${Number(m.bonus||0)}"><small style="display:block;margin-top:4px;color:var(--text-muted)">Nhập số tiền thưởng riêng cho Sale này</small>`)+formField('VAT chỉ báo / khóa học',`<input id="brokerageVatRate" type="number" min="0" max="100" step="0.01" value="${Number(m.vatRate||0)*100}">`),()=>api.saveBrokerageMetric({memberId:row.member.id,period,basicLots:q('#brokerageBasic').value,microLots:q('#brokerageMicro').value,nanoLots:q('#brokerageNano').value,lotCommissionRate:q('#brokerageLotRate').value,indicatorCommissionRate:Number(q('#brokerageIndicatorRate').value)/100,courseCommissionRate:Number(q('#brokerageCourseRate').value)/100,bonus:q('#brokerageBonus').value,vatRate:Number(q('#brokerageVatRate').value)/100}));modal.querySelector('.modal-card').style.width='min(760px,calc(100vw - 24px))';}  function toggleBrokeragePublication(period){const published=new Set(data.settings?.brokeragePublishedPeriods||[]);if(published.has(period))published.delete(period);else published.add(period);run(()=>api.settings({brokeragePublishedPeriods:Array.from(published).sort()}),()=>businessReport());}
  function businessReport(){
    const host=q('#businessReportHost');if(!host)return;installBrokerageStyles();const period=brokeragePeriod||data.today.slice(0,7);brokeragePeriod=period;const role=data.user.actualRole||data.user.role,rows=brokerageRows(period),published=role==='ADMIN'||(data.settings?.brokeragePublishedPeriods||[]).includes(period),visibleRows=published?rows:rows.map(row=>({...row,lots:0,indicatorRevenue:0,courseRevenue:0,lotCommission:0,indicatorCommission:0,courseCommission:0,bonus:0,gross:0,vat:0,net:0,metric:{...row.metric,basicLots:0,microLots:0,nanoLots:0}})),sum=key=>visibleRows.reduce((total,row)=>total+Number(row[key]||0),0);
    host.innerHTML=`<div class="headline-row"><div><h1>Báo cáo kinh doanh</h1></div></div><div class="brokerage-toolbar"><label>Kỳ báo cáo<input id="brokeragePeriod" type="month" value="${esc(period)}"></label>${role==='ADMIN'?`<button type="button" class="btn-action ${published?'btn-secondary':'btn-primary'}" id="brokeragePublishBtn">${published?'Ẩn kỳ báo cáo':'Công bố tháng này'}</button>`:''}</div><div class="brokerage-grid"><article class="brokerage-kpi"><small>Lot chuẩn</small><b>${sum('lots').toFixed(2)}</b></article><article class="brokerage-kpi"><small>DS chỉ báo</small><b>${brokerageMoney(sum('indicatorRevenue'))}</b></article><article class="brokerage-kpi"><small>Tổng hoa hồng</small><b>${brokerageMoney(sum('gross'))}</b></article><article class="brokerage-kpi"><small>VAT chỉ báo / khóa học</small><b>${brokerageMoney(sum('vat'))}</b></article><article class="brokerage-kpi"><small>Thực nhận</small><b>${brokerageMoney(sum('net'))}</b></article></div><div class="brokerage-table-wrap"><table class="modern-table brokerage-table"><thead><tr><th>#</th><th>Nhân sự</th><th>Team</th><th>Lot cơ bản</th><th>Micro</th><th>Nano</th><th>Lot chuẩn</th><th>DS chỉ báo</th><th>DS khóa học</th><th>HH lot</th><th>HH chỉ báo</th><th>HH khóa học</th><th>Thưởng</th><th>Tổng thu</th><th>VAT</th><th>Thực nhận</th>${role==='ADMIN'?'<th></th>':''}</tr></thead><tbody>${visibleRows.map((row,index)=>`<tr><td>${index+1}</td><td><b>${esc(row.member.name)}</b><div style="font-size:10px;color:var(--text-muted)">${esc(row.member.accountId||row.member.phone||'')}</div></td><td>${esc(row.member.teamId||'—')}</td><td>${Number(row.metric.basicLots||0)}</td><td>${Number(row.metric.microLots||0)}</td><td>${Number(row.metric.nanoLots||0)}</td><td><b>${row.lots.toFixed(2)}</b></td><td>${brokerageMoney(row.indicatorRevenue)}</td><td>${brokerageMoney(row.courseRevenue)}</td><td>${brokerageMoney(row.lotCommission)}</td><td>${brokerageMoney(row.indicatorCommission)}<div style="font-size:10px;color:var(--text-muted)">${brokerageRate(row.metric.indicatorCommissionRate)}</div></td><td>${brokerageMoney(row.courseCommission)}<div style="font-size:10px;color:var(--text-muted)">${brokerageRate(row.metric.courseCommissionRate)}</div></td><td>${brokerageMoney(row.bonus)}</td><td><b>${brokerageMoney(row.gross)}</b></td><td>${brokerageMoney(row.vat)}<div style="font-size:10px;color:var(--text-muted)">${brokerageRate(row.metric.vatRate)}</div></td><td><b>${brokerageMoney(row.net)}</b></td>${role==='ADMIN'?`<td><button class="btn-action btn-secondary" data-brokerage-edit="${esc(row.member.id)}">Lot / tỷ lệ</button></td>`:''}</tr>`).join('')||'<tr><td colspan="17"><div class="empty"><b>Chưa có Sale trong phạm vi</b></div></td></tr>'}</tbody></table></div>`;
    q('#brokeragePeriod').onchange=e=>{brokeragePeriod=e.target.value||data.today.slice(0,7);businessReport();};q('#brokeragePublishBtn')?.addEventListener('click',()=>toggleBrokeragePublication(period));host.querySelectorAll('[data-brokerage-edit]').forEach(button=>button.onclick=()=>brokerageMetricEditor(rows.find(row=>row.member.id===button.dataset.brokerageEdit),period));
  }
  // Chi phí kế toán lấy từ collection expenses đã đồng bộ SQL, không dùng localStorage.
  window.accountingSubView = 'mindmap';
  let accountingSubView = 'mindmap';

  function syncMembersToAccountingMindmap(period){
    const iframe=q('#accountingIframe');
    if(!iframe||!data)return;
    // The accounting iframe is static in index.html. During the first CRM boot,
    // postMessage can run before the iframe document has loaded, so bind a load
    // retry once and wait until the accounting DOM is available.
    if(!iframe.dataset.crmAccountingSyncBound){
      iframe.dataset.crmAccountingSyncBound='1';
      iframe.addEventListener('load',()=>syncMembersToAccountingMindmap(period),{once:false});
    }
    if(!iframe.contentWindow)return;
    try{
      if(!iframe.contentDocument||!iframe.contentDocument.querySelector('.tab-content-panel'))return;
    }catch{return;}
    const selectedPeriod=String(period||data.today||'').slice(0,7);
    const members=(data.members||[]).filter(member=>member&&member.active!==false&&member.active!==0&&member.active!=='0'&&member.role!=='ADMIN'&&['MANAGER','LEADER','SALE'].includes(member.role));
    const products=data.products||[],orders=data.orders||[],metrics=data.brokerageMetrics||[];
    const productType=order=>{
      const product=products.find(item=>String(item.id)===String(order.productId));
      return productKind(product||{name:order.productName,category:order.productCategory});
    };
    const periodOrders=orders.filter(Boolean).map(order=>({...order,subtotal:OrderPayments.events(order).filter(event=>String(event.occurredAt||'').slice(0,7)===selectedPeriod).reduce((sum,event)=>sum+event.netAmount,0)})).filter(order=>order.subtotal!==0);
    const parentFor=member=>member.role==='LEADER'?member.managerId||null:member.role==='SALE'?(member.leaderId||member.managerId||null):null;
    const lotConfig=data.settings?.accountingLotConfig||{};
    const roleMeta={MANAGER:{level:'LV1',title:'Manager',rate:Number(lotConfig.rateLv1)||90000},LEADER:{level:'LV2',title:'Leader',rate:Number(lotConfig.rateLv2)||70000},SALE:{level:'LV3',title:'Sale',rate:Number(lotConfig.rateLv3)||50000}};
    const apexFormattedList=members.map(member=>{
      const meta=roleMeta[member.role]||roleMeta.SALE,parentId=parentFor(member),parent=members.find(item=>String(item.id)===String(parentId));
      const metric=metrics.find(item=>String(item.memberId)===String(member.id)&&String(item.period||'')===selectedPeriod)||{};
      const owned=periodOrders.filter(order=>String(order.saleId||'')===String(member.id));
      const revenueOf=kind=>owned.filter(order=>productType(order)===kind).reduce((sum,order)=>sum+Number(order.subtotal??order.total??0),0);
      const indicatorRev=revenueOf('INDICATOR'),vipRev=revenueOf('VIP'),otherRev=revenueOf('OTHER');
      const courseRev=owned.filter(order=>productType(order)==='COURSE').reduce((sum,order)=>sum+Number(order.subtotal??order.total??0),0);
      const rate=Number(metric.lotCommissionRate||metric.ratePerLot||meta.rate)||meta.rate;
      const displayId=String(member.accountId||'').trim()||'—';
      const parentDisplayId=String(parent?.accountId||'').trim();
      return {id:String(member.id),displayId,name:member.name||member.accountId||member.id,phone:member.phone||'',roleLevel:meta.level,roleTitle:meta.title,team:member.teamId||'',teamId:member.teamId||'',directManager:parent?((parent.name||parent.accountId||'Quản lý')+(parentDisplayId?' - ID: '+parentDisplayId:'')):'—',parentId:parentId?String(parentId):null,managerId:member.managerId||null,leaderId:member.leaderId||null,ratePerLot:rate,customDiffRate:Math.max(0,rate-(meta.level==='LV1'?70000:meta.level==='LV2'?50000:0)),basicLot:Number(metric.basicLots??metric.basicLot??0),miniLot:Number(metric.miniLots??metric.miniLot??0),microLot:Number(metric.microLots??metric.microLot??0),indicatorRev,courseRev,vipRev,otherRev,productRate:Number(metric.productRate??lotConfig.defaultProductRate??15),bonus:Number(metric.bonus||0)};
    });
    iframe.contentWindow.postMessage({type:'SYNC_MEMBERS_DATA',members:apexFormattedList,period:selectedPeriod,lotConfig},'*');
    const field=courseField();
    iframe.contentWindow.postMessage({type:'SYNC_ORDERS_DATA',brokerageMetrics:metrics,orders:orders,customers:data.customers||[],products:products.map(product=>({...product,kind:productKind(product)})),members:data.members||[],expenses:data.expenses||[],courseField:field?{id:field.id,label:field.label,options:field.options||[]}:null,courseKeys:courseKeys(),courseConfigs:data.courseConfigs||[],period:selectedPeriod},'*');
  }
  async function createAccountingOrderFromIframe(payload, sourceWindow){
    if(!api) throw Error('CRM chưa sẵn sàng.');
    const result=await api.createOrder({...payload,source:'accounting-iframe'});
    refresh(true);
    const iframe=q('#accountingIframe');
    (sourceWindow||iframe?.contentWindow)?.postMessage({type:'ACCOUNTING_ORDER_RESULT',ok:true,order:result.order||result},'*');
    return result;
  }
  function accountingReport(view) {
    const sub = view || window.accountingSubView || accountingSubView || 'mindmap';
    accountingSubView = sub;
    window.accountingSubView = sub;

    // Highlight only the selected accounting button
    document.querySelectorAll('.accounting-nav-link').forEach(button => {
      button.classList.toggle('active', button.dataset.accountingView === sub);
    });

    const host = q('#accountingHost');
    if (!host) return;

    const tabMap = {
      'mindmap': 'tab-mindmap',
      'report': 'tab-report',
      'orders': 'tab-vat-orders',
      'expenses': 'tab-accounting'
    };
    const targetTab = tabMap[sub] || 'tab-mindmap';

    let iframe = host.querySelector('#accountingIframe');
    if (!iframe) {
      host.innerHTML = `<iframe id="accountingIframe" src="commission_tree_demo.html?embedded=1&tab=${encodeURIComponent(targetTab)}&v=20261012-revenue-commission" title="Kế toán & Hoa hồng APEX" loading="eager"></iframe>`;
      iframe = host.querySelector('#accountingIframe');
      iframe?.addEventListener('load',()=>{host.classList.add('is-ready');syncMembersToAccountingMindmap();},{once:true});
    } else {
      // Refresh/state sync must not reset the user's currently open accounting tab.
      // Only navigate the iframe when its actual view differs from the requested view.
      let currentInnerTab = '';
      try { currentInnerTab = iframe.contentDocument?.querySelector('.tab-content-panel.active')?.id || ''; } catch {}
      if (currentInnerTab !== targetTab) {
        try {
          if (iframe.contentWindow && typeof iframe.contentWindow.switchView === 'function') {
            iframe.contentWindow.switchView(targetTab);
          } else if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'SWITCH_APEX_VIEW', view: targetTab }, '*');
          }
        } catch (err) {
          if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'SWITCH_APEX_VIEW', view: targetTab }, '*');
        }
      }
    }
    syncMembersToAccountingMindmap();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const iframe=q('#accountingIframe');
    if(iframe&&!iframe.dataset.crmAccountingSyncBound){
      iframe.dataset.crmAccountingSyncBound='1';
      iframe.addEventListener('load',()=>{if(data)syncMembersToAccountingMindmap();},{once:false});
    }
  });

  window.addEventListener('message', function(event) {
    if(event.data?.type==='OPEN_CRM_ORDER'&&event.origin===location.origin&&event.source===q('#accountingIframe')?.contentWindow){if(event.data.create){openAccountingOrderForm('');return;}const id=String(event.data.orderId||'');if(event.data.collect)openReceiptPaymentForm(id,event.data.full===true,true);else openReceiptOrderDetail(id,false,true);return;}
    if (event.data && event.data.type === 'CREATE_ACCOUNTING_ORDER') {
      createAccountingOrderFromIframe(event.data.payload || {}, event.source).catch(error => {
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_ORDER_RESULT',ok:false,error:error.message||'Không tạo được đơn hàng.'},'*');
      });
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_EXPENSE_SAVE') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const result=await api.saveExpense(event.data.payload||{});
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_EXPENSE_RESULT',ok:true,action:'save',result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_EXPENSE_RESULT',ok:false,action:'save',error:error.message||'Không lưu được khoản chi.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_EXPENSE_DELETE') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const result=await api.removeExpense(event.data.id);
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_EXPENSE_RESULT',ok:true,action:'delete',id:event.data.id,result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_EXPENSE_RESULT',ok:false,action:'delete',error:error.message||'Không xóa được khoản chi.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_ORDER_ACTION') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const result=await api.updateOrderAccounting(event.data.orderId,event.data.payload||{});
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_ACTION_RESULT',ok:true,orderId:event.data.orderId,result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_ACTION_RESULT',ok:false,error:error.message||'Không lưu được thao tác kế toán.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_BROKERAGE_SAVE') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const result=await api.saveBrokerageMetric(event.data.payload||{});
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_BROKERAGE_RESULT',ok:true,result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_BROKERAGE_RESULT',ok:false,error:error.message||'Không lưu được cấu hình hoa hồng.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_LOT_CONFIG_SAVE') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const input=event.data.payload||{},clean={};
        for(const key of ['rateApex','rateLv1','rateLv2','rateLv3','miniMultiplier','microMultiplier','defaultProductRate']){const value=Number(input[key]);if(!Number.isFinite(value)||value<0)throw Error('Biến số lot hoặc định mức không hợp lệ.');clean[key]=value;}
        if(clean.defaultProductRate>15)throw Error('Hoa hồng bán sản phẩm tối đa 15%.');
        const result=await api.settings({accountingLotConfig:clean});
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_LOT_CONFIG_RESULT',ok:true,result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_LOT_CONFIG_RESULT',ok:false,error:error.message||'Không lưu được biến số lot.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'ACCOUNTING_COURSE_CONFIG_SAVE') {
      (async()=>{
        if(!api) throw Error('CRM chưa sẵn sàng.');
        const configs=Array.isArray(event.data.payload)?event.data.payload:[event.data.payload||{}];
        const result=[];
        for(const config of configs)result.push(await api.saveCourseConfig(config));
        refresh(true);
        (event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_COURSE_CONFIG_RESULT',ok:true,result},'*');
      })().catch(error=>(event.source || q('#accountingIframe')?.contentWindow)?.postMessage({type:'ACCOUNTING_COURSE_CONFIG_RESULT',ok:false,error:error.message||'Không lưu được cấu hình khóa học.'},'*'));
      return;
    }
    if (event.data && event.data.type === 'APEX_VIEW_CHANGED') {
      // Bỏ qua sự kiện khởi tạo của iframe khi một tab CRM khác đang mở.
      const accountingIframe = q('#accountingIframe');
      const outerTab = q('section.tab-section.active[id^="tab-"]')?.id;
      if (!accountingIframe || event.source !== accountingIframe.contentWindow || outerTab !== 'tab-accounting') return;
      const tabMap = {
        'tab-mindmap': 'mindmap',
        'tab-report': 'report',
        'tab-vat-orders': 'orders',
        'tab-accounting': 'expenses'
      };
      const sub = tabMap[event.data.view];
      if (sub) {
        accountingSubView = sub;
        window.accountingSubView = sub;
        rememberActiveTab('tab-accounting');
        document.querySelectorAll('.accounting-nav-link').forEach(button => {
          button.classList.toggle('active', button.dataset.accountingView === sub);
        });
        const activeBtn = document.querySelector(`.accounting-nav-link[data-accounting-view="${sub}"]`);
        const title = activeBtn?.querySelector('span')?.innerText;
        if (title && document.getElementById('topBreadcrumbTitle')) {
          document.getElementById('topBreadcrumbTitle').innerText = title;
        }
      }
    }
  });


  function renderCustomerImportHistory(){
    const panel=q('#customerImportHistory'),body=q('#customerImportHistoryBody');
    if(!panel||!body)return;
    const role=data.user.actualRole||data.user.role,isAdmin=role==='ADMIN';
    panel.hidden=!isAdmin;panel.style.setProperty('display',isAdmin?'':'none','important');
    if(!isAdmin){body.replaceChildren();return;}
    const imports=(data.imports||[]).slice(0,8);
    body.innerHTML=imports.map(item=>'<tr><td style="font-family:var(--font-mono);font-size:11.5px">'+esc(fmtDate(item.importedAt))+'</td><td><b>'+esc(item.source||'—')+'</b></td><td><code>'+esc(item.filename||'—')+'</code></td><td><b>'+Number(item.records||0).toLocaleString('vi-VN')+'</b></td><td>'+esc(item.actor||'Hệ thống')+'</td><td><span class="chip '+(item.status==='SUCCESS'?'chip-green':'chip-cold')+'">'+(item.status==='SUCCESS'?'Thành công':'Thất bại')+'</span></td></tr>').join('')||'<tr><td colspan="6"><div class="empty"><b>Chưa có lịch sử cập nhật data</b></div></td></tr>';
    const add=q('#customerImportSourceButton');if(add)add.onclick=()=>workflow('import');
  }
  function renderManagerScope(){
    // Data cua Manager hien thi chung mot bang voi Admin, khong chen panel Leader rieng.
    q('#managerScope')?.remove();
    return;
    if(data.user.actualRole!=='MANAGER'){q('#managerScope')?.remove();return;}
    let panel=q('#managerScope');if(!panel){panel=document.createElement('div');panel.id='managerScope';panel.className='widget-box';q('.content-body').prepend(panel);}
    const leaders=(data.managerHierarchy?.members||[]).filter(m=>m.role==='LEADER'&&m.managerId===data.user.id&&m.active!==false);
    const key=JSON.stringify(leaders);if(panel.dataset.signature===key)return;panel.dataset.signature=key;
    panel.innerHTML='<div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap"><div><b>Toàn bộ Leader được Admin phân công</b><small style="display:block;margin-top:4px;color:var(--text-muted)">Manager xem tổng khách hàng, doanh thu và dữ liệu của tất cả Leader trong tuyến.</small></div><span class="chip">'+leaders.length+' Leader</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+(leaders.length?leaders.map(l=>'<span class="chip chip-info">'+esc(l.name)+' · '+esc(l.teamId||'Chưa có Team')+'</span>').join(''):'<span class="chip">Chưa được Admin phân công Leader</span>')+'</div>';
  }
  function dateDefaults(){['order','rev','team'].forEach(p=>{const start=q('#'+p+'StartDate'),end=q('#'+p+'EndDate');if(start)start.value=fromDay(30);if(end)end.value=data.today;if(p==='rev'){if(start)start.dataset.revenueInitialized='true';if(end)end.dataset.revenueInitialized='true';}});}
  let toolsRole='',renderedTabs=new Map();
  const activeTabStorageKey=()=>`${ACTIVE_TAB_KEY}:${encodeURIComponent(String(data?.user?.id||data?.user?.accountId||snapshotRole(data)||'anonymous'))}`;
  const rememberActiveTab=id=>{
    if(!id)return;
    const key=activeTabStorageKey();
    try{sessionStorage.setItem(key,id);}catch{}
    try{localStorage.setItem(key,id);}catch{}
  };
  const savedActiveTab=()=>{
    const key=activeTabStorageKey();
    try{return sessionStorage.getItem(key)||localStorage.getItem(key)||'';}catch{return '';}
  };
  const tabAllowedForSnapshot=id=>{
    if(!data||!id||!q('#'+id))return false;
    const view=id.replace(/^tab-/,'');
    const role=data.user.actualRole||data.user.role;
    const alias={data:role==='LEADER'?'pool':role==='SALE'?'accept':'distribution'};
    if(role==='ACCOUNTING')return ['accounting','audit','notifications'].includes(view);
    if(role==='HRM')return ['team','attendance','orders','businessReport','hrProfiles'].includes(view);
    if(role==='MARKETING')return ['marketing','profile'].includes(view);
    return sharedOrganizationTabs.has(view)||data.navigation.includes(alias[view]||view);
  };
  function paintTab(id,force=false){
    if(!data)return;
    const jobs={
      'tab-marketing':[renderMarketingHub,[data.customers,data.orders,data.websites,data.traffic,data.notes,data.customerFieldHistory,data.members]],
      'tab-customers':[()=>{renderCustomerTable();renderCustomerImportHistory();},[data.customers,data.members,data.fields,data.offers,data.imports]],
      'tab-care':[renderCareView,[data.customers,data.fields,data.careGroups]],
      'tab-data':[renderDataQueue,[data.customers,data.pendingOffers,data.members,data.offers,data.resubmissions,data.assignmentHistory,data.settings,data.leaderDistribution,data.saleDistributionByLeader,data.today,data.assignedDataStats]],
      'tab-orders':[drawOrders,[data.orders,data.members]],
      'tab-products':[catalog,[data.products]],
      'tab-team':[team,[data.members,data.hrRoster,data.registeredAccounts,data.customers,data.orders,data.managerHierarchy]],
      'tab-hrProfiles':[hrmPersonnel,[data.hrRoster,data.hrProfiles]],
      'tab-feedback':[renderFeedbackView,[data.feedbacks,data.user,data.today]],
      'tab-processes':[renderProcessesView,[data.processes,data.user]],
      'tab-notifications':[notices,[data.notifications,data.audit]],
      'tab-audit':[renderUserLog,[userActivitySnapshot,data.user]],
      'tab-revenue':[renderRevenue,[data.orders,data.financialEvents]],
      'tab-businessReport':[(data.user.actualRole||data.user.role)==='HRM'?hrmLots:businessReport,[data.orders,data.products,data.members,data.brokerageMetrics,data.hrRoster]],
      'tab-accounting':[accountingReport,[data.orders,data.products,data.members,data.brokerageMetrics,data.expenses,data.courseConfigs,data.customers,data.fields]],
      'tab-dashboard':[()=>{dashboard();dashboardExtras();},[data.customers,data.orders,data.members,data.financialEvents,data.managerHierarchy,data.offers,data.pendingOffers,data.fields]],
      'tab-websites':[()=>{sourceAnalytics();websites();},[data.websites,data.customers,data.orders,data.webhookPending,data.webhookTransport]],
      'tab-attendance':[attendance,[data.attendance,data.members,data.settings,data.today,data.hrRoster]],
      'tab-blacklist':[renderBlacklist,[data.blacklistIps,data.blacklistEntries]],
      'tab-settings':[bindReferenceSettings,[data.settings,data.fonts]]
    };
    const job=jobs[id];if(!job)return;const key=JSON.stringify([data.user.id,...job[1]]);
    if(force||renderedTabs.get(id)!==key){
      // Lỗi vẽ một tab không được chặn cả CRM: trước đây team() lỗi làm F5 kẹt ở màn hình tải.
      try{job[0]();renderedTabs.set(id,key);}catch(error){renderedTabs.delete(id);console.error('Không vẽ được '+id,error);}
    }
  }
  // Ô nhập/ghi chú đang focus thì không vẽ đè. Select giữ focus sau khi chọn xong nên chỉ
  // chặn khi vừa thao tác; nếu không màn Leader/Manager/Admin đứng yên, không thấy Sale cập nhật.
  let lastUserInteraction=0;
  ['pointerdown','keydown','input','change'].forEach(type=>document.addEventListener(type,()=>{lastUserInteraction=Date.now();},true));
  function userEditingNow(){
    const tag=document.activeElement?.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA')return true;
    return tag==='SELECT'&&Date.now()-lastUserInteraction<4000;
  }
  function refresh(force=false,suppliedSnapshot=null) {
    const signedOut=frame.contentWindow?.crmRuntimeBooted===true&&frame.contentWindow?.crmRuntimeAuthState==='unauthenticated';
    if(customerSaveQueue.pending&&!signedOut)return;
    normalizeAccountingMenu();
    if(!signedOut&&!force&&(document.hidden||working||workflowBusy||q('.modal-overlay.open')||userEditingNow()))return;
    const runtime=frame.contentWindow;
    if(runtime?.crmApi)api=runtime.crmApi;
    const fromCache=Boolean(suppliedSnapshot);
    // crmApi is available before CRM finishes restoring a saved session. Waiting here
    // prevents the login/static index screen from flashing after F5.
    if(!fromCache&&!api)return;
    let next=fromCache?suppliedSnapshot:api.snapshot();

    // Chỉ cho thao tác trên snapshot đã xác thực và tải từ máy chủ.
    // Cho phép mở ngay khi snapshot hợp lệ đã có; cờ boot chỉ cần dùng để
    // xác nhận trạng thái đăng xuất khi snapshot đang là null.
    if(!next && runtime?.crmRuntimeBooted!==true)return;
    // A valid token can still be restoring while auth/state requests are in flight.
    // Keep the boot screen during that window instead of showing a false login form.
    if(!next && runtime?.crmRuntimeAuthState!=='unauthenticated'){
      if(!data&&runtime?.crmRuntimeRestoreError&&bootScreen){
        let notice=bootScreen.querySelector('[data-restore-error]');
        if(!notice){
          notice=document.createElement('div');notice.dataset.restoreError='true';notice.style.cssText='max-width:440px;padding:24px;text-align:center;line-height:1.6';
          const message=document.createElement('p');message.textContent=runtime.crmRuntimeRestoreError;
          const retry=document.createElement('button');retry.type='button';retry.textContent='Thử kết nối lại';retry.style.cssText='padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:white;cursor:pointer';
          retry.onclick=async()=>{retry.disabled=true;try{await runtime.crmRetrySessionRestore?.();refresh(true);}finally{retry.disabled=false;}};
          notice.append(message,retry);bootScreen.replaceChildren(notice);
        }
      }
      return;
    }
    if(!next){data=null;signature='';if(!storedSession())clearCachedSnapshot();if(bootFallbackTimer){clearTimeout(bootFallbackTimer);bootFallbackTimer=null;}bootScreen?.setAttribute('hidden','');frame.hidden=false;frame.style.display='block';frame.classList.add('is-login-visible');document.body.classList.remove('reference-ready');q('.app-shell')?.style.setProperty('visibility','hidden');q('.bg-aura')?.style.setProperty('visibility','hidden');return;}
    if(!validCachedSnapshot(next)){if(fromCache)clearCachedSnapshot();return;}
    const first=!data;
    const editing=!first&&Boolean(working||workflowBusy||q('.modal-overlay.open')||q('#careGroupModal')?.style.display==='flex'||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName));
    if(first)customerFilterState.columns={};if(bootFallbackTimer){clearTimeout(bootFallbackTimer);bootFallbackTimer=null;}data=next;frame.hidden=true;frame.style.display='none';frame.classList.remove('is-login-visible');
    const ready=Boolean(api?.sessionIdentity()?.id===data.user.id),readinessChanged=ready!==customerEditReady;
    if(!fromCache)restoreCustomerSelections();
    const sign=JSON.stringify(data)+ready;
    if(!first&&(sign===signature||editing))return;
    if(!fromCache)saveCachedSnapshot(next);
    customerEditReady=ready;signature=sign;if(first){dateDefaults();bindReferenceSettings();setupSources();installRoleVisibilityObserver();installPendingDataStyles();}
    ensureHrmMenu(data.user.actualRole||data.user.role);
    project();
    if(q('#accountingIframe'))syncMembersToAccountingMindmap();
    installCustomerJourney();
    // Chỉ dựng tab đang xem; số thông báo vẫn cập nhật độc lập.
    if(first||readinessChanged)renderedTabs.clear();
    const storedTab=savedActiveTab();
    const initialTab=tabAllowedForSnapshot(storedTab)?storedTab:((data.user.actualRole||data.user.role)==='ACCOUNTING'?'tab-accounting':(data.user.actualRole||data.user.role)==='HRM'?'tab-hrProfiles':(data.user.actualRole||data.user.role)==='MARKETING'?'tab-marketing':'tab-customers');
    paintTab('tab-notifications');
    paintTab(initialTab);wireParity();
    // Restore the outer tab after the runtime snapshot is ready. The static HTML
    // starts on Dashboard, so rendering alone would otherwise overwrite Data.
    if(first||q('section.active[id^="tab-"]')?.id!==initialTab)switchTab(initialTab);
    applySaleDataLayout();
    // Khi F5 đang mở trực tiếp tab Data, tab tĩnh có thể được dựng trước khi
    // renderer tham chiếu khởi tạo. Vẽ lại ngay để Admin luôn thấy cùng một
    // bảng đầy đủ, không cần bấm qua tab khác trước.
    if(['ADMIN','MANAGER','LEADER'].includes(data.user.actualRole||data.user.role)&&q('section.active#tab-data')){
      renderManagementDataTable(data.user.actualRole||data.user.role);
    }
    text('sidebarDataBadge',data.user.role==='SALE'?(data.pendingOffers||[]).length:data.customers.filter(c=>isWebhookDataCustomer(c)&&!c.saleId).length);
    q('#sidebarCareBadge')?.remove();
    q('#sidebarTeamBadge')?.remove();
    const alias={data:data.user.role==='LEADER'?'pool':data.user.role==='SALE'?'accept':'distribution'};
    const role=data.user.actualRole||data.user.role,visible=new Set(data.navigation);
    const adminOnlyTabs=restrictedAdminTabs;
    qa('.nav-link[data-tab]').forEach(button=>{const tab=button.dataset.tab.replace('tab-','');button.hidden=(tab==='hrProfiles'&&role==='ADMIN')?false:adminOnlyTabs.has(tab)?role!=='ADMIN':sharedOrganizationTabs.has(tab)?false:!visible.has(alias[tab]||tab);});
    // Sale khong dung muc Doi ngu, an khoi thanh dieu huong de giao dien gon hon.
    const saleAccount=(data.user.role==='SALE'||data.user.actualRole==='SALE');
    qa('.nav-link[data-tab="tab-team"],[data-view-link="team"]').forEach(node=>{node.hidden=saleAccount;node.style.setProperty('display',saleAccount?'none':'','important');});
    const teamSection=q('#tab-team');if(teamSection){teamSection.hidden=saleAccount;teamSection.style.setProperty('display',saleAccount?'none':'','important');}
    // Không để các liên kết tĩnh trong dashboard mở được mục Admin-only bằng cách click trực tiếp.
    qa('[onclick*="tab-websites"],[onclick*="tab-products"],[onclick*="tab-audit"],[onclick*="tab-settings"]').forEach(link=>{link.hidden=role!=='ADMIN';});
    adminOnlyTabs.forEach(tab=>{const section=q('#tab-'+tab);if(section)section.hidden=role!=='ADMIN';});
    if(role!=='ADMIN'&&role!=='HRM'&&role!=='ACCOUNTING'&&adminOnlyTabs.has(q('section.active[id^="tab-"]')?.id?.replace('tab-','')))renders.switchTab('tab-customers');
    applyRoleVisibility();
    // Non-admin không thấy mã đơn/mã nội bộ trên giao diện nghiệp vụ.
    if(role!=='ADMIN')qa('th').forEach(th=>{if(th.textContent.trim()==='Mã đơn')th.textContent='Đơn hàng';});
    const profile=q('.topbar .user-details');if(profile){profile.querySelector('b').textContent=data.user.name;profile.querySelector('small').textContent=data.user.actualRole||data.user.role;}
    const heading=q('#tab-dashboard .headline-row h1');if(heading)heading.textContent=data.user.actualRole==='MANAGER'?'Tổng quan hệ thống được giao':data.user.role==='LEADER'?'Tổng quan Team':data.user.role==='SALE'?'Tổng quan của tôi':'Tổng quan';
    renderManagerScope();
    q('#toggleLeaderDistribution').disabled=data.user.role!=='ADMIN';q('#assignmentModeSelect').disabled=data.user.role!=='ADMIN';q('#toggleLeaderDistribution').checked=data.leaderDistribution.enabled===true;
    q('#assignmentModeSelect').value=data.settings.assignmentMode||'MANUAL';
    text('autoStatWaiting',data.customers.filter(c=>!c.leaderId).length);text('autoStatLeaders',(data.leaderDistribution.enabledLeaderIds||[]).length);
    restoreCustomerSelections();
    // Chỉ hiện giao diện khi dữ liệu, tab và phân quyền đã dựng xong.
    document.body.classList.add('reference-ready');q('.app-shell')?.style.setProperty('visibility','visible');q('.bg-aura')?.style.setProperty('visibility','visible');
    bootScreen?.setAttribute('hidden','');
  }
  updateCustomerClass=(id,value)=>saveCustomerSelection('field',id,value,'customerClass');
  assignCustomerSale=(id,value)=>saveCustomerSelection('sale',id,value);
  openNewCustomerModal=function(){
    if(!data)return;
    const role=data.user.actualRole||data.user.role,currentId=data.user.id,all=data.members.filter(m=>m.active!==false&&m.active!==0&&m.active!=='0'&&m.active!==null&&m.active!==undefined),leaders=new Set(all.filter(m=>m.role==='LEADER'&&m.managerId===currentId).map(m=>m.id));
    const sourceOptions=[opt('SOURCE:OLD_CUSTOMER','Khách hàng cũ'),opt('SOURCE:OUTSIDE_DATA','Khách hàng ngoài data'),...data.websites.map(w=>opt(w.id,w.name||w.domain))];
    const managerSales=role==='MANAGER'?all.filter(m=>m.role==='SALE'&&(m.managerId===currentId||leaders.has(m.leaderId))):[];
    const recipients=role==='ADMIN'?all.filter(m=>['MANAGER','LEADER','SALE'].includes(m.role)):role==='MANAGER'?[...all.filter(m=>m.id===currentId),...all.filter(m=>m.role==='LEADER'&&m.managerId===currentId),...managerSales]:role==='LEADER'?[...all.filter(m=>m.id===currentId),...all.filter(m=>m.role==='SALE'&&m.leaderId===currentId)]:[];
    const uniqueRecipients=recipients.filter((m,i,list)=>list.findIndex(item=>item.id===m.id)===i);
    q('#newCustSource').innerHTML=sourceOptions.join('');q('#newCustClass').innerHTML=fieldOptions('customerClass').map(o=>opt(o.value,o.label)).join('');q('#newCustLevel').innerHTML=fieldOptions('customerLevel').map(o=>opt(o.value,o.label)).join('');q('#newCustSale').innerHTML=opt('','— Chưa phân Sale —',role==='MANAGER'?'':undefined)+uniqueRecipients.map(m=>opt(m.id,m.name+(m.role==='MANAGER'?' (Manager)':m.role==='LEADER'?' (Leader)':''),role==='MANAGER'&&m.id===currentId)).join('');
    q('#newCustomerModal').classList.add('open');
  };
  closeNewCustomerModal=function(){q('#newCustomerModal')?.classList.remove('open');};
  submitNewCustomer=()=>{const sourceValue=q('#newCustSource')?.value||'',website=data.websites.find(w=>w.id===sourceValue||w.name===sourceValue||w.domain===sourceValue),sourceLabel=sourceValue==='SOURCE:OLD_CUSTOMER'?'Khách hàng cũ':sourceValue==='SOURCE:OUTSIDE_DATA'?'Khách hàng ngoài data':website?.name||'Nhập thủ công';return run(()=>api.createCustomer({name:q('#newCustName').value.trim(),phone:q('#newCustPhone').value,email:q('#newCustEmail').value.trim(),websiteId:website?.id||null,saleId:q('#newCustSale').value==='unassigned'?'':q('#newCustSale').value,source:sourceLabel,note:'Tạo thủ công từ CRM',customFields:{customerClass:q('#newCustClass').value,customerLevel:q('#newCustLevel').value}}),()=>{closeNewCustomerModal();q('#newCustName').value='';q('#newCustPhone').value='';q('#newCustEmail').value='';});};
  openCareGroupModal=()=>openCareEditor();
  closeCareGroupModal=()=>{if(working)return;q('#careGroupModal').style.display='none';q('#careGroupModal').classList.remove('open');refresh(true);};
  updateCareGroupOptions=function(){const key=q('#careGroupFieldSelect').value;CARE_FIELD_OPTIONS[key]=fieldOptions(key).map(o=>({value:esc(o.value),label:esc(o.label)}));renders.careOptions();qa('.care-value-checkbox').forEach(n=>{const color=validColor(fieldOptions(key).find(o=>o.value===n.value)?.color);n.parentElement.style.color=color;n.parentElement.style.backgroundColor=color+'18';});};
  handleSaveCareGroup=function(event){event.preventDefault();run(()=>api.saveCare(editingCareId,{name:q('#careGroupNameInput').value,fieldId:q('#careGroupFieldSelect').value,values:qa('.care-value-checkbox:checked').map(n=>n.value),color:q('#refCareColor').value}),()=>{careKey='';q('#careGroupModal').style.display='none';q('#careGroupModal').classList.remove('open');});};
  openOrderModal=function(){const customers=data.customers.filter(c=>c.saleId);if(!customers.length){alert('Chưa có khách đã phân Sale để tạo đơn.');return;}q('#modalCustomerSelect').innerHTML=customers.map(c=>opt(c.id,c.name+' · '+c.phone,selectedCustomer)).join('');q('#prodSelect').innerHTML=data.products.filter(p=>p.active!==false).map(p=>opt(p.id,p.name+' · '+money(p.price))).join('');q('#orderModal').classList.add('open');orderAmounts();};
  function orderAmounts(){const p=data?.products.find(p=>p.id===q('#prodSelect').value);text('subText',money(p?.price));text('vatText',money(Math.round((p?.price||0)*.1)));text('totText',money(Math.round((p?.price||0)*1.1)));}
  q('#prodSelect').addEventListener('change',orderAmounts);
  q('#orderStatusFilterSelect')?.addEventListener('change',filterOrdersCombined);
  const clearAutofilledCustomerSearch=()=>{const ownEmail=String(data?.user?.email||'').trim().toLowerCase();const customerSearch=q('#custSearchInput'),globalSearch=q('#topGlobalSearch');[customerSearch,globalSearch].forEach(input=>{if(!input)return;input.setAttribute('autocomplete','off');input.setAttribute('autocapitalize','none');if(ownEmail&&String(input.value||'').trim().toLowerCase()===ownEmail)input.value='';});};
  q('#topGlobalSearch')?.addEventListener('input',event=>{q('#custSearchInput').value=event.target.value;renderCustomerTable();});
  assignStaffRole=id=>memberEditor(id);
  assignDataAction=()=>workflow(data.user.role==='SALE'?'accept':'pool');
  submitOrder=()=>run(()=>api.createOrder({customerId:q('#modalCustomerSelect').value,productId:q('#prodSelect').value,paymentMode:q('#modalPaymentType').value,paymentMethod:qa('#orderModal select')[3]?.selectedIndex===1?'CASH':'VietQR'}),result=>{closeOrderModal();alert('Đã lưu đơn '+result.code+' chờ xác nhận thanh toán.');});
  openDrawerForCust=function(id){selectedCustomer=id;renders.drawer(id);const c=data.customers.find(c=>c.id===id);if(!c)return;text('drawerName',c.name);text('drawerPhone',c.phone);text('drawerCreated','Ngày tạo: '+fmtDate(c.createdAt));text('drawerClass',c.customFields?.customerClass||'');text('drawerLevel',c.customFields?.customerLevel||'');q('#drawerCallBtn').href='tel:'+String(c.phone||'').replace(/[^\d+]/g,'');if(!q('#referenceFullCustomer')){const b=document.createElement('button');b.id='referenceFullCustomer';b.className='btn-action btn-primary';b.textContent='Hồ sơ / Ghi chú / Lịch chăm sóc';q('#drawerCallBtn').parentElement.appendChild(b);}q('#referenceFullCustomer').onclick=()=>workflow('customer',id);};
  function showOrderSuccess(result){
    q('#referenceOrderSuccess')?.remove();
    const modal=document.createElement('div');
    modal.id='referenceOrderSuccess';
    modal.className='modal-overlay open';
    modal.innerHTML='<div class="modal-card order-success-card" role="dialog" aria-modal="true" aria-labelledby="orderSuccessTitle"><div class="modal-header"><h3 id="orderSuccessTitle">Tạo đơn hàng thành công</h3><button type="button" class="modal-close-btn" data-order-success-close aria-label="Đóng">×</button></div><div class="modal-body order-success-body"><div class="order-success-icon" aria-hidden="true">✓</div><h4>Đơn hàng đã được lưu</h4><p>Mã đơn: <b data-order-success-code></b></p><p class="order-success-note">Đơn đang chờ xác nhận thanh toán.</p></div><div class="modal-footer"><button type="button" class="btn-action btn-primary" data-order-success-close>Đã hiểu</button></div></div>';
    document.body.appendChild(modal);
    const code=modal.querySelector('[data-order-success-code]');
    if(code)code.textContent=shortOrderCode(result?.code||result?.order?.code||result?.id||result?.order?.id);
    modal.querySelectorAll('[data-order-success-close]').forEach(button=>button.onclick=()=>modal.remove());
    modal.onclick=event=>{if(event.target===modal)modal.remove();};
  }
  // Ghi đè callback cũ để dùng form thành công trong giao diện, không dùng alert().
  submitOrder=()=>run(()=>api.createOrder({customerId:q('#modalCustomerSelect').value,productId:q('#prodSelect').value,paymentMode:q('#modalPaymentType').value,paymentMethod:qa('#orderModal select')[3]?.selectedIndex===1?'CASH':'VietQR'}),result=>{closeOrderModal();showOrderSuccess(result);});
  // Form tạo đơn theo mẫu "Tạo Đơn Hàng Mới (Sale / Kế Toán)". Dùng cùng luồng
  // createOrder(source:'accounting-iframe') với mục Kiểm tra đơn & Xuất VAT để
  // CCCD, địa chỉ, cọc/còn lại, bill, ghi chú và MST/công ty khớp hai phía.
  const orderSalesInScope=()=>{
    const members=data.orderAssignees||data.members||[];
    return members.filter(m=>m&&m.active!==false&&m.active!==0&&m.active!=='0'&&['MANAGER','LEADER','SALE'].includes(m.role))
      .sort((a,b)=>({MANAGER:0,LEADER:1,SALE:2}[a.role]-{MANAGER:0,LEADER:1,SALE:2}[b.role])||String(a.name||'').localeCompare(String(b.name||''),'vi'));
  };
  const phoneKey=v=>String(v||'').replace(/\D/g,'').replace(/^84/,'0');
  // Nén ảnh bill về JPEG để vừa giới hạn lưu trữ của đơn hàng.
  const compressBill=file=>new Promise((resolve,reject)=>{
    if(!file||!/^image\//.test(file.type))return reject(Error('Bill đính kèm phải là ảnh.'));
    const reader=new FileReader();reader.onerror=()=>reject(Error('Không đọc được ảnh bill.'));
    reader.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('Ảnh bill không hợp lệ.'));img.onload=()=>{
      const scale=Math.min(1,1200/Math.max(img.width,img.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      let quality=.82,out=canvas.toDataURL('image/jpeg',quality);while(out.length>900000&&quality>.4){quality-=.12;out=canvas.toDataURL('image/jpeg',quality);}
      if(out.length>2700000)reject(Error('Ảnh bill quá lớn, hãy chọn ảnh nhỏ hơn.'));else resolve(out);};img.src=reader.result;};
    reader.readAsDataURL(file);
  });
  const canChangeReceiptOrder=order=>['ADMIN','ACCOUNTING','SALE','LEADER','MANAGER'].includes(data.user.actualRole||data.user.role)&&!order.paymentReconciled&&!order.vatIssued&&!['REFUNDED','CANCELLED','COURSE_GRANTED'].includes(order.status);
  function receiptHistoryMarkup(order,editable=false){
    return '<div class="ao-receipt-list">'+(OrderPayments.receipts(order).map((receipt,index)=>'<article class="ao-receipt"><div><b>'+esc(OrderPayments.billLabel(receipt.kind))+' · '+money(receipt.amount)+'</b><p>Lần '+(index+1)+' · '+esc(fmtDate(receipt.at))+'</p><small>'+esc(receipt.bankReference||'Chuyển khoản')+'</small>'+(receipt.note?'<p>Ghi chú lần thu: '+esc(receipt.note)+'</p>':'')+(editable?'<p><button type="button" class="btn-action btn-secondary" data-receipt-manage="'+index+'">Thêm bill / Sửa bill</button></p>':'')+'</div><div class="receipt-images" data-receipt-images="'+index+'" data-receipt-editable="'+editable+'">'+receiptImageMarkup(receipt,index,editable)+'</div></article>').join('')||'<p>Chưa có thanh toán.</p>')+'</div>';
  }
  function receiptImageMarkup(receipt,index,editable=false){
    const images=OrderPayments.images(receipt);
    const count=Array.isArray(receipt.images)?images.length:images.length||Number(receipt.billCount)||((receipt.hasBill!==false&&receipt.billCount===undefined)?1:0);
    let html='';
    for(let i=0;i<count;i++){
      const image=images[i]||{};
      html+='<div><button class="ao-bill-zoom" type="button" data-receipt-image="'+index+':'+i+'"><img '+(image.imageData?'src="'+esc(image.imageData)+'"':'')+' alt="Bill" loading="lazy"><span data-bill-action>'+(image.imageData?'Xem ảnh đầy đủ':'Đang tải ảnh bill…')+'</span></button><p>'+esc(image.note||OrderPayments.billLabel(receipt.kind))+'</p>'+(editable?'<button type="button" class="btn-action btn-danger" data-receipt-delete="'+index+':'+i+'">Xóa bill</button>':'')+'</div>';
    }
    return html||'<p>Chưa có ảnh bill.</p>';
  }
  async function loadReceiptImages(order,receipt){
    if(Array.isArray(receipt.images))return receipt.images;
    const local=OrderPayments.images(receipt);
    if(local.length){receipt.images=local;return local;}
    const payload=await lazyAsset(lazyAssetUrl('order',order.id,receipt.id));
    receipt.images=Array.isArray(payload.images)?payload.images:[];
    return receipt.images;
  }
  function bindReceiptImages(modal,order,accountingContext=false){
    const receipts=OrderPayments.receipts(order),imageLoads=new Map();
    const setAction=(button,text)=>{const node=button?.querySelector('[data-bill-action]');if(node)node.textContent=text;};
    const paint=(receiptIndex,images)=>{
      const host=modal.querySelector?.('[data-receipt-images="'+receiptIndex+'"]');
      if(host){
        host.innerHTML=receiptImageMarkup(receipts[receiptIndex],receiptIndex,host.dataset.receiptEditable==='true');
        bindImageActions(host);
        return;
      }
      modal.querySelectorAll('[data-receipt-image]').forEach(button=>{
        const [index,imageIndex]=button.dataset.receiptImage.split(':').map(Number);if(index!==receiptIndex)return;
        const image=images[imageIndex];if(!image?.imageData)return;
        let thumbnail=button.querySelector('img');
        if(!thumbnail){thumbnail=document.createElement('img');thumbnail.alt='Bill';thumbnail.loading='lazy';button.insertBefore(thumbnail,button.querySelector('[data-bill-action]'));}
        thumbnail.src=image.imageData;button.querySelector('[data-bill-placeholder]')?.remove();setAction(button,'Xem ảnh đầy đủ');
      });
    };
    const load=(receiptIndex)=>{
      if(!imageLoads.has(receiptIndex))imageLoads.set(receiptIndex,loadReceiptImages(order,receipts[receiptIndex]).then(images=>{receipts[receiptIndex].images=images;paint(receiptIndex,images);return images;}).catch(error=>{imageLoads.delete(receiptIndex);throw Error('Không tải được bill của lần thu '+(receiptIndex+1)+' ('+money(receipts[receiptIndex].amount)+'): '+error.message);}));
      return imageLoads.get(receiptIndex);
    };
    modal.querySelectorAll('[data-receipt-manage]').forEach(button=>button.onclick=async()=>{const receipt=receipts[Number(button.dataset.receiptManage)];if(!receipt)return;try{const images=await load(receipts.indexOf(receipt));if((receipt.hasBill||Number(receipt.billCount)>0)&&!images.length)throw Error('Chua tai duoc bill. Vui long thu lai.');const source=(order.paymentReceipts||[]).find(item=>String(item.id)===String(receipt.id));if(source)source.images=images;openReceiptImageEditor(order.id,receipt.id,accountingContext);}catch(error){imageLoads.delete(receipts.indexOf(receipt));referenceNotice(error.message);}});
    function bindImageActions(root){
      root.querySelectorAll('[data-receipt-delete]').forEach(button=>button.onclick=async()=>{
        const [receiptIndex,imageIndex]=button.dataset.receiptDelete.split(':').map(Number),receipt=receipts[receiptIndex];
        if(!receipt)return;
        let images;try{images=await load(receiptIndex);}catch(error){imageLoads.delete(receiptIndex);referenceNotice(error.message);return;}
        if(!images[imageIndex]){referenceNotice('Khong tim thay bill de xoa. Hay tai lai chi tiet don.');return;}
        if(!confirm('Xoa anh bill '+(imageIndex+1)+' cua lan thu '+money(receipt.amount)+'? So tien da thu giu nguyen.'))return;
        images.splice(imageIndex,1);run(()=>api.updateOrderAccounting(order.id,{action:'SAVE_RECEIPT_IMAGES',receiptId:receipt.id,images}),result=>{Object.assign(order,result?.order||{});openReceiptOrderDetail(order.id,true,accountingContext);});
      });
      root.querySelectorAll('[data-receipt-image]').forEach(button=>button.onclick=async()=>{
        const [receiptIndex,imageIndex]=button.dataset.receiptImage.split(':').map(Number),receipt=receipts[receiptIndex];setAction(button,'Dang tai bill...');
        try{
          const images=await load(receiptIndex),image=images[imageIndex];if(!image?.imageData)throw Error('Bill khong co anh de hien thi.');
          const viewer=document.createElement('div');viewer.className='modal-overlay open';viewer.style.zIndex='15000';viewer.innerHTML='<div class="modal-card" style="max-width:960px;width:95vw;max-height:95vh"><div class="modal-header"><h3>Bill '+money(receipt.amount)+'</h3><button type="button" class="modal-close-btn">\u00d7</button></div><div class="modal-body"><p>'+esc(image.note||OrderPayments.billLabel(receipt.kind))+'</p><img src="'+esc(image.imageData)+'" alt="Bill chuyen khoan" style="max-width:100%;display:block;margin:auto"></div></div>';document.body.appendChild(viewer);viewer.querySelector('button').onclick=()=>viewer.remove();viewer.onclick=e=>{if(e.target===viewer)viewer.remove();};
        }catch(error){imageLoads.delete(receiptIndex);setAction(button,'Tai loi - bam de thu lai');referenceNotice(error.message);}
      });
    }
    bindImageActions(modal);
    receipts.forEach((receipt,index)=>{load(index).catch(()=>{const button=modal.querySelector('[data-receipt-image="'+index+':0"]');setAction(button,'Tải lỗi — bấm để thử lại');});});
    return {loadAll:()=>Promise.all(receipts.map((receipt,index)=>load(index))),receipts};
  }
  function openReceiptImageEditor(orderId,receiptId,accountingContext=false){
    const order=data.orders.find(o=>o.id===orderId);if(!order||!canChangeReceiptOrder(order))return;
    const receipt=OrderPayments.receipts(order).find(r=>r.id===receiptId);if(!receipt)return;
    const images=OrderPayments.images(receipt).map(image=>({...image,note:image.note||OrderPayments.billLabel(receipt.kind)})),originals=new Map(images.map(image=>[image.id,image.imageData]));let uploading=0;
    const modal=editor('Quản lý ảnh bill','<div class="ao-help"><b>'+esc(order.customerName)+' · Đã thu '+money(receipt.amount)+'</b><p>Ảnh bên dưới thuộc cùng một lần chuyển khoản. Thêm hoặc thay ảnh không ghi nhận thêm tiền.</p></div><label class="crm-field"><span>Loại bill cho ảnh thêm mới</span><select id="receiptImageType"><option value="FULL" '+(receipt.kind==='FULL'?'selected':'')+'>Bill chuyển khoản đủ</option><option value="DEPOSIT" '+(receipt.kind!=='FULL'?'selected':'')+'>Bill cọc</option></select></label><div id="receiptImageRows" class="ao-image-editor"></div><div class="ao-image-upload"><label for="receiptImageAdd" class="crm-file-button">+ Thêm ảnh cho lần thu này</label><input id="receiptImageAdd" class="ao-file" type="file" accept="image/*" multiple><p>Có thể chọn nhiều ảnh, tối đa 10 ảnh. Viết ghi chú dưới từng ảnh, rồi bấm Lưu ảnh &amp; ghi chú.</p></div><p id="receiptImageError" role="status" aria-live="polite"></p>',async()=>{
      if(uploading)throw Error('Đang xử lý ảnh, vui lòng chờ.');
      const result=await api.updateOrderAccounting(orderId,{action:'SAVE_RECEIPT_IMAGES',receiptId,images});Object.assign(order,result.order||{});referenceNotice('Đã lưu ảnh và ghi chú. Số tiền đã thu giữ nguyên.');setTimeout(()=>openReceiptOrderDetail(orderId,true,accountingContext),0);
    });modal.style.zIndex='12000';modal.querySelector('.modal-card').classList.add('ao-card');modal.querySelector('.modal-footer [type=submit]').textContent='Lưu ảnh & ghi chú';
    const draw=()=>{
      q('#receiptImageRows').innerHTML=images.map((image,index)=>'<article class="ao-image-edit"><div class="ao-image-edit-head"><b>Ảnh '+(index+1)+'</b><small>'+(!originals.has(image.id)?'Ảnh mới · chưa lưu':originals.get(image.id)!==image.imageData?'Đã thay ảnh · chưa lưu':'Ảnh đã lưu')+'</small></div><img src="'+esc(image.imageData)+'" alt="Ảnh bill '+(index+1)+'"><label class="crm-field"><span>Loại bill</span><select data-image-type="'+index+'"><option value="FULL" '+((image.note||OrderPayments.billLabel(receipt.kind))==='Bill chuyển khoản đủ'?'selected':'')+'>Bill chuyển khoản đủ</option><option value="DEPOSIT" '+((image.note||OrderPayments.billLabel(receipt.kind))!=='Bill chuyển khoản đủ'?'selected':'')+'>Bill cọc</option></select></label><label class="crm-field"><span>Ghi chú ảnh</span><textarea data-image-note="'+index+'" maxlength="500" placeholder="Ví dụ: Bill cọc 500.000đ, khách chuyển ngày 03/10">'+esc(image.note||'')+'</textarea></label><label for="receiptReplace'+index+'" class="crm-file-button">Thay ảnh '+(index+1)+'</label><input id="receiptReplace'+index+'" class="ao-file" type="file" accept="image/*" data-image-replace="'+index+'">'+('<button type="button" class="btn-action btn-danger" data-image-discard="'+index+'">Xóa bill này</button>')+'</article>').join('')||'<p>Chưa có ảnh. Bấm Thêm ảnh cho lần thu này để chọn bill.</p>';
      modal.querySelectorAll('[data-image-type]').forEach(input=>input.onchange=()=>{images[Number(input.dataset.imageType)].note=OrderPayments.billLabel(input.value);draw();});
      modal.querySelectorAll('[data-image-note]').forEach(input=>input.oninput=()=>{images[Number(input.dataset.imageNote)].note=input.value;});
      modal.querySelectorAll('[data-image-discard]').forEach(button=>button.onclick=()=>{if(uploading)return;images.splice(Number(button.dataset.imageDiscard),1);draw();});
      modal.querySelectorAll('[data-image-replace]').forEach(input=>input.onchange=async()=>{if(!input.files[0]||uploading)return;uploading++;q('#receiptImageError').textContent='Đang xử lý ảnh…';try{images[Number(input.dataset.imageReplace)].imageData=await compressBill(input.files[0]);draw();q('#receiptImageError').textContent='Đã chọn ảnh thay thế. Bấm Lưu ảnh & ghi chú để cập nhật.';}catch(e){q('#receiptImageError').textContent=e.message;}finally{uploading--;}});
    };draw();q('#receiptImageAdd').onchange=async event=>{if(uploading)return;uploading++;q('#receiptImageError').textContent='Đang xử lý ảnh…';try{for(const file of event.target.files){if(images.length>=10)throw Error('Tối đa 10 ảnh cho một lần thu.');images.push({id:'IMG-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),imageData:await compressBill(file),note:OrderPayments.billLabel(q('#receiptImageType').value)});}draw();q('#receiptImageError').textContent='Ảnh đã sẵn sàng. Bấm Lưu ảnh & ghi chú để hoàn tất.';}catch(e){q('#receiptImageError').textContent=e.message;draw();}finally{uploading--;event.target.value='';}};
  }
  async function confirmReceiptOrder(order,receiptImages){
    if(!['ADMIN','ACCOUNTING'].includes(data.user.actualRole||data.user.role))throw Error('Chỉ Kế toán hoặc Admin được xác nhận đủ.');
    if(order.paymentReconciled)throw Error('Đơn đã xác nhận đủ.');
    if(!['PAID','COURSE_GRANTED'].includes(order.status)||OrderPayments.balance(order)!==0||OrderPayments.paid(order)!==Number(order.total))throw Error('Cần ghi nhận đủ tiền trước khi xác nhận.');
    const images=await receiptImages.loadAll();
    const missing=receiptImages.receipts.map((receipt,index)=>images[index]?.length?'':'lần thu '+(index+1)+' ('+money(receipt.amount)+')').filter(Boolean);
    if(!receiptImages.receipts.length)throw Error('Cần bổ sung bill thanh toán trước khi xác nhận.');
    if(missing.length)throw Error('Cần bổ sung ảnh bill cho '+missing.join(', ')+'.');
    return api.updateOrderAccounting(order.id,{action:'RECONCILE',confirmed:true,note:order.reconciliationNote||'',receiptImages:receiptImages.receipts.map((receipt,index)=>({id:receipt.id,images:images[index]}))});
  }
  function openOrderVatForm(id){
    const order=data.orders.find(o=>o.id===id);if(!order||!['ADMIN','ACCOUNTING'].includes(data.user.actualRole||data.user.role)||!order.paymentReconciled||OrderPayments.balance(order)!==0||order.vatIssued)return;
    const billing=order.billing||{};
    const field=(label,name,value,attributes='')=>'<label class="crm-field"><span>'+esc(label)+'</span><input id="'+name+'" value="'+esc(value||'')+'" '+attributes+'></label>';
    const modal=editor('Xuất VAT · '+shortOrderCode(order.code||id),'<div class="crm-form-grid">'+field('Số hóa đơn','orderVatNumber',order.vatInvoiceNumber,'required maxlength="120"')+field('Mã số thuế','orderVatTaxCode',order.taxCode||billing.taxId,'required inputmode="numeric" pattern="[0-9]{10,13}" maxlength="13"')+field('Tên công ty / đơn vị','orderVatCompany',order.companyName,'required maxlength="200"')+field('Địa chỉ','orderVatAddress',billing.address,'maxlength="240"')+field('Email nhận hóa đơn','orderVatEmail',billing.email,'type="email" maxlength="254"')+'</div>',async()=>{
      const result=await api.updateOrderAccounting(id,{action:'ISSUE_VAT',invoiceNumber:q('#orderVatNumber').value.trim(),taxCode:q('#orderVatTaxCode').value.trim(),companyName:q('#orderVatCompany').value.trim(),address:q('#orderVatAddress').value.trim(),email:q('#orderVatEmail').value.trim()});
      Object.assign(order,result?.order||{});referenceNotice('Đã ghi nhận hóa đơn VAT.');setTimeout(()=>openReceiptOrderDetail(id,false,true),0);
    });modal.style.zIndex='12000';modal.querySelector('.modal-footer [type=submit]').textContent='Xuất VAT';
  }
  function openOrderReconciliation(id){
    const order=data.orders.find(o=>o.id===id);if(!order||!['ADMIN','ACCOUNTING'].includes(data.user.actualRole||data.user.role))return;
    const modal=editor('Kế toán kiểm tra & Đối soát', '<p><b>'+esc(order.customerName)+'</b> · '+esc(order.productName)+'</p><p>Sale đã ghi nhận: <b>'+money(OrderPayments.paid(order))+'</b> / Tổng đơn: <b>'+money(order.total)+'</b></p><p>Đối soát xác nhận bill khớp tiền vào ngân hàng. Thao tác này không cộng thêm tiền và không tạo bill mới.</p>'+receiptHistoryMarkup(order)+'<label class="crm-field"><span>Ghi chú đối soát</span><textarea id="reconcileNote" maxlength="1000"></textarea></label><label class="ao-vat-check"><input type="checkbox" id="reconcileConfirm" required> Tôi đã kiểm tra tất cả bill và xác nhận đủ tiền vào ngân hàng</label>',async()=>{
      const images=await receiptImages.loadAll();
      const missing=images.map((list,index)=>list.length?'':'lần thu '+(index+1)+' ('+money(receiptImages.receipts[index].amount)+')').filter(Boolean);
      if(missing.length)throw Error('Cần bổ sung ảnh bill cho '+missing.join(', ')+'. Mở Sửa / Xem để thêm bill cho lần thu này trước khi đối soát.');
      await api.updateOrderAccounting(id,{action:'RECONCILE',confirmed:q('#reconcileConfirm').checked,note:q('#reconcileNote').value,receiptImages:receiptImages.receipts.map((receipt,index)=>({id:receipt.id,images:images[index]}))});referenceNotice('Đã đối soát đủ. Tổng thực thu và doanh thu giữ nguyên.');
    });modal.style.zIndex='12000';const receiptImages=bindReceiptImages(modal,order);modal.querySelector('.modal-footer [type=submit]').textContent='Kế toán xác nhận đối soát đủ';
  }
  function openReceiptOrderDetail(id,editing=false,accountingContext=false){
    const order=data.orders.find(o=>o.id===id);if(!order)return;ensureAccountingOrderStyles();
    const balance=OrderPayments.balance(order),paid=OrderPayments.paid(order),canEdit=canChangeReceiptOrder(order),billing=order.billing||{};
    const canConfirm=accountingContext&&['ADMIN','ACCOUNTING'].includes(data.user.actualRole||data.user.role)&&['PAID','COURSE_GRANTED'].includes(order.status)&&paid===Number(order.total)&&balance===0;
    const detailField=(label,value,wide=false,required=false)=>{const text=String(value??'').trim(),missing=required&&!text;return '<div class="ow-data'+(wide?' ow-data-wide':'')+'"><dt>'+esc(label)+'</dt><dd'+(missing?' class="ow-missing"':'')+'>'+esc(text||(missing?'Cần bổ sung':'Chưa có thông tin'))+'</dd></div>';};
    const modal=editor('CHI TIẾT ĐƠN HÀNG · '+shortOrderCode(order.code||order.id),
      `<div class="ow-overview"><div><span class="ow-eyebrow">Hồ sơ đơn hàng</span><h2>${esc(order.customerName||'Khách hàng')}</h2><p>${esc(order.productName||'Sản phẩm / dịch vụ')}</p></div><div class="ow-statuses"><span class="ow-status ${balance===0?'ow-success':'ow-warning'}">${esc(OrderPayments.status(order,money))}</span><span class="ow-status ${order.paymentReconciled?'ow-success':'ow-neutral'}">${order.paymentReconciled?'Đã đối soát':'Chờ đối soát'}</span><span class="ow-status ow-neutral">${order.vatIssued?'Đã xuất VAT':'Chưa xuất VAT'}</span></div></div>
      <div class="ow-metrics"><div><span>Tổng giá trị đơn</span><strong>${money(order.total)}</strong><small>Trước VAT: ${money(order.subtotal)} · VAT 10%: ${money(order.vatAmount)}</small></div><div class="ow-metric-paid"><span>Đã thu</span><strong>${money(paid)}</strong><small>${OrderPayments.receipts(order).length} lần thanh toán được ghi nhận</small></div><div class="${balance>0?'ow-metric-due':'ow-metric-paid'}"><span>Còn cần thu</span><strong>${money(balance)}</strong><small>${balance>0?'Khách hàng còn khoản cần thanh toán':'Đã thu đủ giá trị đơn hàng'}</small></div></div>
      <div class="ow-detail-grid"><section class="ow-section"><div class="ow-section-head"><h3>Thông tin khách hàng</h3><span>01</span></div><dl class="ow-data-grid">${detailField('Họ và tên',order.customerName)}${detailField('Số điện thoại',order.customerPhone||billing.phone)}${detailField('CCCD / CMND',billing.cccd,false,true)}${detailField('Email',billing.email)}${detailField('Địa chỉ',billing.address,true,true)}</dl></section>
      <section class="ow-section"><div class="ow-section-head"><h3>Thông tin đơn hàng</h3><span>02</span></div><dl class="ow-data-grid">${detailField('Sản phẩm / dịch vụ',order.productName,true)}${detailField('Mã sản phẩm',order.sku)}${detailField('Người phụ trách',order.saleName||person(order.saleId))}${detailField('Nội dung chuyển khoản',order.paymentReference||order.code,true)}</dl></section>
      <section class="ow-section"><div class="ow-section-head"><h3>Thông tin hóa đơn</h3><span>03</span></div><dl class="ow-data-grid">${detailField('Yêu cầu hóa đơn VAT',order.requireVat?'Có yêu cầu':'Không yêu cầu')}${detailField('Mã số thuế',order.taxCode||billing.taxId)}${detailField('Tên công ty / đơn vị',order.companyName,true)}${detailField('Email nhận hóa đơn',billing.email,true)}</dl></section>
      <section class="ow-section"><div class="ow-section-head"><h3>Ghi chú</h3><span>04</span></div><dl class="ow-data-grid">${detailField('Ghi chú đơn hàng',order.saleNote||'Chưa có ghi chú',true)}${detailField('Ghi chú kế toán',order.reconciliationNote||'Chưa có ghi chú',true)}</dl></section></div>
      <section class="ow-section ow-history"><div class="ow-section-head"><h3>Lịch sử thanh toán &amp; bill</h3><span>${OrderPayments.receipts(order).length} lần thu</span></div><p class="ow-section-description">Mỗi lần thu gồm số tiền, thời gian và ảnh bill. Bấm vào ảnh để xem đầy đủ.${canEdit?' Dùng “Thêm bill / Sửa bill” để cập nhật ảnh của khoản đã thu.':''}</p>${receiptHistoryMarkup(order,canEdit)}</section>
      <div class="ow-action-bar"><div><b>Thao tác đơn hàng</b></div><div class="ao-detail-actions">${canEdit?'<button type="button" class="btn-action btn-secondary" id="receiptEditInfo">Sửa thông tin đơn</button>'+(balance>0?'<button type="button" class="btn-action btn-secondary" id="receiptAdd">Ghi nhận tiền thu thêm</button><button type="button" class="btn-action btn-primary" id="receiptFull">Thu hết '+money(balance)+'</button>':''):''}${canConfirm&&!order.paymentReconciled?'<button type="button" class="btn-action btn-primary" id="receiptReconcile">Xác nhận đủ</button>':''}${canConfirm?(order.vatIssued?'<span class="ow-status ow-success">Đã xuất VAT</span>':'<button type="button" class="btn-action btn-primary" id="receiptVat" '+(order.paymentReconciled?'':'disabled title="Cần xác nhận đủ trước khi xuất VAT"')+'>Xuất VAT</button>'):''}</div></div>`);
    modal.querySelector('.modal-card').classList.add('ao-card','ow-workspace','ow-detail');
    const editButton=modal.querySelector('#receiptEditInfo');if(editButton){editButton.classList.replace('btn-secondary','btn-primary');modal.querySelector('.modal-footer').appendChild(editButton);}
    modal.style.zIndex='12000';const receiptImages=bindReceiptImages(modal,order,accountingContext);
    modal.querySelector('#receiptEditInfo')?.addEventListener('click',()=>openAccountingOrderForm(order.customerId,order,accountingContext));
    modal.querySelector('#receiptAdd')?.addEventListener('click',()=>openReceiptPaymentForm(id,false,accountingContext));
    modal.querySelector('#receiptReconcile')?.addEventListener('click',async event=>{
      const button=event.currentTarget;if(button.disabled)return;button.disabled=true;button.textContent='Đang xác nhận…';
      try{await run(()=>confirmReceiptOrder(order,receiptImages),result=>{Object.assign(order,result?.order||{});referenceNotice('Xác nhận đủ thành công. Có thể xuất VAT.');openReceiptOrderDetail(id,false,accountingContext);});}
      finally{button.disabled=false;button.textContent='Xác nhận đủ';}
    });
    modal.querySelector('#receiptVat')?.addEventListener('click',()=>openOrderVatForm(id));
    modal.querySelector('#receiptFull')?.addEventListener('click',()=>openReceiptPaymentForm(id,true,accountingContext));
    const actions=modal.querySelector('.ao-detail-actions');if(actions&&['ADMIN','ACCOUNTING'].includes(data.user.actualRole||data.user.role)){const button=document.createElement('button');button.type='button';button.className='btn-action btn-secondary';button.textContent='Lịch sử đơn';button.onclick=()=>openOrderAudit(id);actions.appendChild(button);}
  }
  function bindBillPicker(modal,fileId,previewId,statusId,images,typeId){
    let uploading=false;
    const draw=()=>{
      q('#'+statusId).textContent=images.length?images.length+' ảnh bill đã chọn · bấm Lưu để hoàn tất':'Chưa có ảnh bill. Có thể chọn nhiều ảnh.';
      q('#'+previewId).innerHTML=images.map((image,index)=>'<article class="ao-image-edit"><b>Bill '+(index+1)+'</b><img src="'+esc(image.imageData)+'" alt="Bill '+(index+1)+'"><label class="crm-field"><span>Ghi chú ảnh</span><textarea maxlength="500" data-bill-note="'+index+'" placeholder="Ghi chú ảnh">'+esc(image.note||'')+'</textarea></label><button type="button" class="btn-action btn-danger" data-bill-remove="'+index+'">Xóa bill</button></article>').join('');
      modal.querySelectorAll('[data-bill-remove]').forEach(button=>button.onclick=()=>{if(uploading)return;images.splice(Number(button.dataset.billRemove),1);draw();});
      modal.querySelectorAll('[data-bill-note]').forEach(input=>input.oninput=()=>{images[Number(input.dataset.billNote)].note=input.value;});
    };
    q('#'+fileId).onchange=async event=>{if(uploading)return;uploading=true;try{const files=Array.from(event.target.files||[]);if(images.length+files.length>10)throw Error('Mỗi lần thu tối đa 10 ảnh bill.');const added=[];for(const file of files)added.push({id:'IMG-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),imageData:await compressBill(file),note:OrderPayments.billLabel(q('#'+typeId)?.value)});images.push(...added);draw();}catch(error){q('#'+statusId).textContent=error.message;}finally{uploading=false;event.target.value='';}};
    if(typeId)q('#'+typeId).onchange=()=>{images.forEach(image=>image.note=OrderPayments.billLabel(q('#'+typeId).value));draw();};
    draw();return {get uploading(){return uploading;}};
  }
  function openReceiptPaymentForm(id,full=false,accountingContext=false){
    const order=data.orders.find(o=>o.id===id);if(!order||!canChangeReceiptOrder(order))return;
    const balance=OrderPayments.balance(order),paid=OrderPayments.paid(order);if(balance<=0)return;ensureAccountingOrderStyles();
    const images=[];let picker;
    const modal=editor('THANH TOÁN TIẾP · '+shortOrderCode(order.code||order.id),
      '<div class="receipt-collection-controls ow-section"><div class="ow-section-head"><h3>Khoản thanh toán tiếp theo</h3><span>Còn '+money(balance)+'</span></div><div class="crm-form-grid">'+
      '<label class="crm-field"><span>Hình thức thanh toán <em>*</em></span><select id="receiptPayMode"><option value="FULL" '+(full?'selected':'')+'>Thu hết phần còn lại</option><option value="CUSTOM" '+(!full?'selected':'')+'>Thanh toán một phần</option></select></label>'+
      '<label class="crm-field"><span>Số tiền thanh toán lần này <em>*</em></span><input id="receiptAmount" type="number" required min="1" max="'+balance+'" step="1" value="'+(full?balance:'')+'" '+(full?'readonly':'')+' placeholder="Nhập số tiền khách thanh toán"></label></div></div>'+
      '<div id="receiptInvoice" class="receipt-collection-invoice"></div>'+
      '<section class="ow-section receipt-collection-evidence"><div class="ow-section-head"><h3>Xác nhận thanh toán</h3></div>'+
      '<input id="receiptBillType" type="hidden" value="'+(full?'FULL':'DEPOSIT')+'">'+
      '<label class="crm-field"><span>Ảnh bill của lần chuyển khoản này <em>*</em></span><input type="file" id="receiptFile" accept="image/*" multiple></label><p id="receiptFileStatus" role="status" aria-live="polite"></p><div id="receiptPreview" class="ao-image-editor"></div>'+
      '<label class="ao-vat-check"><input type="checkbox" id="receiptConfirm" required> Tôi xác nhận đã nhận khoản tiền này</label></section>',async()=>{
        const amount=Number(q('#receiptAmount').value);
        if(!Number.isSafeInteger(amount)||amount<=0||amount>balance)throw Error('Số tiền thanh toán phải lớn hơn 0 và không vượt '+money(balance)+'.');
        if(picker.uploading)throw Error('Đang xử lý ảnh bill, vui lòng chờ.');if(!images.length)throw Error('Tải ảnh bill của lần thanh toán này.');
        if(!q('#receiptConfirm').checked)throw Error('Xác nhận đã nhận tiền trước khi lưu.');
        const result=await api.updateOrderAccounting(id,{action:'COLLECT',amount,images,billImage:images[0].imageData,confirmed:true});
        Object.assign(order,result?.order||{});referenceNotice('Đã lưu khoản thanh toán và bill.');setTimeout(()=>openReceiptOrderDetail(id,false,accountingContext),0);
      });
    modal.style.zIndex='12000';modal.querySelector('.modal-card').classList.add('ao-card','ow-workspace','ow-form','ow-collection');
    const submit=modal.querySelector('.modal-footer [type=submit]');submit.textContent='Xác nhận & lưu thanh toán';
    const preview=document.createElement('button');preview.type='button';preview.className='btn-action btn-secondary';preview.id='receiptSlipPreview';preview.textContent='Xem phiếu gửi khách';preview.onclick=()=>openPaymentSlipPreview(q('#receiptInvoice'),preview);submit.before(preview);
    picker=bindBillPicker(modal,'receiptFile','receiptPreview','receiptFileStatus',images,'receiptBillType');
    const updateSlip=()=>{
      const amount=Number(q('#receiptAmount').value),valid=Number.isSafeInteger(amount)&&amount>0&&amount<=balance;
      q('#receiptConfirm').checked=false;preview.disabled=!valid;
      if(!valid){q('#receiptInvoice').innerHTML='<p class="ao-help">Nhập số tiền thanh toán từ 1 VND đến '+money(balance)+' để hiện phiếu và mã QR.</p>';return;}
      const kind=amount===balance?'FULL':'DEPOSIT';if(q('#receiptBillType').value!==kind){q('#receiptBillType').value=kind;q('#receiptBillType').onchange();}
      const total=Number(order.total),vatAmount=Number(order.vatAmount??Math.round(total/11));
      q('#receiptInvoice').innerHTML=paymentSlipMarkup({customerName:order.customerName,phone:order.customerPhone||order.billing?.phone||'',productName:order.productName||'—',paymentReference:order.paymentReference||((order.customerName||'')+' '+(order.customerPhone||order.billing?.phone||'')).trim(),subtotal:Number(order.subtotal??total-vatAmount),vatAmount,total,collected:amount,remaining:balance-amount,alreadyPaid:paid});
    };
    q('#receiptAmount').oninput=updateSlip;
    q('#receiptPayMode').onchange=()=>{const all=q('#receiptPayMode').value==='FULL';q('#receiptAmount').readOnly=all;q('#receiptAmount').value=all?balance:'';updateSlip();};
    updateSlip();if(!full)q('#receiptAmount').focus();
  }
  function openAccountingOrderForm(customerId, editing=null,accountingContext=false){
    const products=(data.products||[]).filter(p=>p.active!==false),sales=orderSalesInScope();
    if(!products.length){alert('Chưa có sản phẩm đang bán.');return;}
    if(!sales.length){alert('Chưa có Manager, Leader hoặc Sale đang hoạt động.');return;}
    const customers=data.customers||[],picked=customers.find(c=>c.id===customerId)||null;
    const preSale=sales.find(s=>String(s.id)===String(picked?.saleId))||sales.find(s=>String(s.id)===String(data.user?.saleId||data.user?.id))||sales[0];
    const body=`<p class="ao-lead">Nhập thông tin khách, chọn hình thức thanh toán (Đủ hoặc Cọc) rồi tiếp tục để tạo phiếu thanh toán.</p><div id="aoDetails" class="ow-form-layout">
      <datalist id="aoCustomerList">${customers.map(c=>`<option value="${esc(c.phone||'')}">${esc(c.name||'')}</option>`).join('')}</datalist>
      <section class="ow-section"><div class="ow-section-head"><h3>Thông tin khách hàng</h3><span>01</span></div><div class="crm-form-grid">
        <label class="crm-field"><span>Họ và tên <em>*</em></span><input id="aoName" maxlength="160" required placeholder="Ví dụ: Nguyễn Văn Hải" value="${esc(picked?.name||'')}"></label>
        <label class="crm-field"><span>Số điện thoại <em>*</em></span><input id="aoPhone" class="ao-mono" list="aoCustomerList" inputmode="tel" maxlength="15" required placeholder="Ví dụ: 0918882345" value="${esc(picked?.phone||'')}"></label>
        <label class="crm-field ow-optional"><span>CCCD / CMND </span><input id="aoCccd" class="ao-mono" inputmode="numeric" maxlength="12" placeholder="Có thể để trống" value="${esc(picked?.cccd||'')}"></label>
        <label class="crm-field ow-optional"><span>Email khách hàng / nhận hóa đơn </span><input id="aoEmail" type="email" maxlength="254" placeholder="Ví dụ: tenkhach@gmail.com" value="${esc(editing?.billing?.email||picked?.email||'')}"></label>
        <label class="crm-field crm-field-full"><span>Địa chỉ </span><input id="aoAddress" maxlength="240" placeholder="Nhập địa chỉ khách hàng" value="${esc(picked?.address||'')}"></label>
      </div></section><section class="ow-section"><div class="ow-section-head"><h3>Sản phẩm &amp; giá trị đơn</h3><span>02</span></div><div class="crm-form-grid">
        <label class="crm-field"><span>Sản phẩm / dịch vụ <em>*</em></span><select id="aoProduct">${products.map(p=>`<option value="${esc(p.id)}" data-price="${Number(p.price)||0}">${esc(p.name)} (${esc(money(Number(p.price)+Math.round(Number(p.price)*.1)))} · gồm VAT)</option>`).join('')}</select></label>
        <label class="crm-field"><span>Người phụ trách <em>*</em></span><select id="aoSale" ${sales.length===1?'disabled':''}>${sales.map(s=>`<option value="${esc(s.id)}" ${s===preSale?'selected':''}>${esc(s.name||s.accountId||s.id)} · ${esc({MANAGER:'Manager',LEADER:'Leader',SALE:'Sale'}[s.role])}</option>`).join('')}</select></label>
        <label class="crm-field" id="aoCourseField" hidden><span>Khóa <em>*</em></span><select id="aoCourseKey"></select></label>
        <label class="crm-field" id="aoTrainerField" hidden><span>Người đào tạo</span><input id="aoTrainerName" readonly aria-readonly="true"></label>
      </div>
      <div class="ao-grid-3">
        <label class="crm-field"><span>Giá sản phẩm (VNĐ, gồm VAT)</span><input id="aoTotal" class="ao-mono" type="number" min="1" step="1" readonly aria-readonly="true"></label>
        <label class="crm-field"><span>Hình thức thanh toán <em>*</em></span><select id="aoPayType" class="ao-paytype"><option value="FULL">Thanh toán đủ</option><option value="CUSTOM">Cọc</option></select></label>
        <label class="crm-field"><span class="ao-green">Số tiền thu lần này <em>*</em></span><input id="aoCollected" class="ao-mono ao-collected" type="number" min="1" step="1" required><small id="aoCollectedHint"></small></label>
      </div>
      <div class="ao-remaining" role="status" aria-live="polite"><span>Số tiền còn lại khách phải thanh toán:</span><b id="aoRemaining">0 VND</b></div>
      <p class="ao-summary" id="aoSummary"></p></section><section class="ow-section"><div class="ow-section-head"><h3>Thông tin hóa đơn</h3><span>03</span></div>
      <label class="ao-vat-check"><input type="checkbox" id="aoRequireVat"> Khách hàng yêu cầu xuất hóa đơn VAT (Nhập MST &amp; Công ty)</label>
      <div class="crm-form-grid ao-vat" id="aoVatInputs" hidden>
        <label class="crm-field"><span>Mã số thuế (MST) <em>*</em></span><input id="aoTaxCode" class="ao-mono" inputmode="numeric" maxlength="13" placeholder="10 - 13 chữ số"></label>
        <label class="crm-field"><span>Tên công ty / Đơn vị <em>*</em></span><input id="aoCompany" maxlength="200" placeholder="Tên công ty xuất hóa đơn"></label>
      </div>
      </section><section class="ow-section"><div class="ow-section-head"><h3>Ghi chú đơn hàng</h3><span>04</span></div><label class="crm-field"><textarea aria-label="Ghi chú đơn hàng" id="aoNote" maxlength="1000" placeholder="Ví dụ: Khách cọc 50%, hẹn ngày thanh toán phần còn lại..."></textarea></label></section></div><div id="aoPayment" hidden><div id="aoInvoice"></div>      <div class="ao-bill">
        <span class="ao-bill-title">Hóa Đơn / Bill Chuyển Khoản Ngân Hàng Đính Kèm <em>*</em></span>
        <div class="ao-bill-row"><select id="aoBillType" aria-label="Loại bill"><option value="FULL">Bill chuyển khoản đủ</option><option value="DEPOSIT">Bill cọc</option></select>
          <input id="aoBillFile" type="file" accept="image/*" multiple class="ao-file"><label class="crm-file-button" for="aoBillFile">+ Thêm bill</label></div>
        <span class="crm-file-name" id="aoBillName">Chưa chọn ảnh bill</span><div class="ao-image-editor" id="aoBillPreview"></div>
      </div>
<label class="ao-vat-check"><input type="checkbox" id="aoConfirmed"> Tôi xác nhận khách đã chuyển đúng số tiền thu lần này</label></div>`;
    let manageBillsAfterSave=false;
    const images=[];let picker,step=1;
    const fixedTotal=()=>{if(editing)return Number(editing.total)||0;const product=products.find(p=>String(p.id)===String(q('#aoProduct').value))||products[0],net=Number(product.price)||0;return net+Math.round(net*.1);};
    const amounts=()=>{const total=fixedTotal(),vatAmount=Math.round(total/11),subtotal=total-vatAmount,collected=Math.floor(Number(q('#aoCollected').value)||0);return {subtotal,vatAmount,total,collected,remaining:Math.max(0,total-collected)};};
    let lastPayType='';
    const modal=editor('TẠO ĐƠN HÀNG MỚI',body,async()=>{
      const v=id=>q('#'+id).value.trim(),phone=v('aoPhone').replace(/[^0-9+]/g,''),digits=phone.replace(/\D/g,''),cccd=v('aoCccd').replace(/\D/g,''),a=amounts(),vat=q('#aoRequireVat').checked;
      const taxCode=v('aoTaxCode').replace(/\D/g,''),companyName=v('aoCompany');
      if(!v('aoName'))throw Error('Nhập tên khách hàng.');
      if(digits.length<9||digits.length>13)throw Error('Số điện thoại khách hàng không hợp lệ.');
      if(cccd&&!/^(\d{9}|\d{12})$/.test(cccd))throw Error('CMND gồm 9 số hoặc CCCD gồm 12 số; có thể để trống.');
      if(!(a.subtotal>0))throw Error('Tiền cần thu phải lớn hơn 0.');
      if(!(a.collected>0)||a.collected>a.total)throw Error('Thực thu phải lớn hơn 0 và không vượt tổng đơn '+money(a.total)+'.');

      if(vat&&!/^\d{10,13}$/.test(taxCode))throw Error('MST phải có 10 đến 13 chữ số.');
      if(vat&&!companyName)throw Error('Nhập tên công ty xuất hóa đơn VAT.');
      const email=v('aoEmail');
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Gmail / Email không hợp lệ; có thể để trống.');
      if(!editing&&q('#aoPayType').value==='CUSTOM'&&a.collected>=a.total)throw Error('Tiền cọc phải nhỏ hơn tổng tiền. Chọn Thanh toán đủ nếu khách đã trả hết.');
      const payload={customerName:v('aoName'),phone,email,cccd,address:v('aoAddress'),productId:q('#aoProduct').value,saleId:q('#aoSale').value,subtotal:a.subtotal,total:a.total,vatRate:0.1,amountPaid:a.collected,paymentMethod:'BANK_TRANSFER',bankReference:'',requireVat:vat,taxCode,companyName,saleNote:v('aoNote'),images,billImage:images[0]?.imageData||'',billing:{name:v('aoName'),phone,email,cccd,address:v('aoAddress'),taxId:taxCode}};
      if(!editing){
        payload.courseKey=v('aoCourseKey');
        OrderPayments.commissionAssignment({product:products.find(product=>product.id===payload.productId),seller:sales.find(member=>member.id===payload.saleId),members:data.orderAssignees||data.members||sales,customer:picked,fields:data.fields||[],configs:data.courseConfigs||[],courseKey:payload.courseKey});
      }
      const paymentReference=payload.customerName.replace(/\s+/g,' ').trim()+' '+phone;
      payload.paymentReference=paymentReference;
      if(editing){
        const result=await api.updateOrderAccounting(editing.id,{...payload,action:'UPDATE',customerPhone:phone,customerCccd:cccd,customerAddress:payload.address,customerEmail:email,amountPaid:OrderPayments.paid(editing)});
        Object.assign(editing,result.order||{});referenceNotice('Đã cập nhật thông tin đơn. Lịch sử bill được giữ nguyên.');if(manageBillsAfterSave)setTimeout(()=>openReceiptOrderDetail(editing.id,true,accountingContext),0);return;
      }
      if(step===1){
        q('#aoInvoice').innerHTML=paymentSlipMarkup({...a,customerName:payload.customerName,phone,productName:products.find(p=>p.id===payload.productId)?.name||'—',paymentReference});

        q('#aoBillType').value=a.collected===a.total?'FULL':'DEPOSIT';q('#aoBillType').onchange();
        step=2;q('#aoDetails').hidden=true;q('#aoPayment').hidden=false;q('#aoConfirmed').checked=false;
        submit.textContent=editing?'✓ Lưu thay đổi đơn hàng':'✓ Đã chuyển khoản — Lưu đơn';back.hidden=false;preview.hidden=false;
        modal.querySelector('.modal-body').scrollTop=0;return false;
      }
      if(!q('#aoConfirmed').checked)throw Error('Xác nhận khách đã chuyển tiền trước khi lưu.');
      if(picker.uploading)throw Error('Đang xử lý ảnh bill, vui lòng chờ.');
      if(!images.length)throw Error('Đính kèm ảnh bill chuyển khoản trước khi lưu.');
      const result=editing?await api.updateOrderAccounting(editing.id,{...payload,action:'UPDATE',customerPhone:phone,customerCccd:cccd,customerAddress:payload.address,customerEmail:email}):await api.createOrder({...payload,source:'accounting-iframe'});
      showOrderSuccess(result);
      if(editing){q('#orderSuccessTitle').textContent='Cập nhật đơn hàng thành công';q('#referenceOrderSuccess h4').textContent='Đã lưu thay đổi đơn hàng';}
      const note=q('#referenceOrderSuccess .order-success-note'),order=result?.order;
      if(note&&order)note.textContent=order.status==='PAID'?'Đã ghi nhận thu đủ 100% (gồm VAT 10%). Đơn chờ Kế toán đối soát.':'Đã cọc '+money(order.amountPaid)+', còn lại '+money(order.balanceDue)+'. Xuất VAT mở khi thu đủ 100%.';
      if(note&&result?.recoveredWithDifferentInput)note.textContent+=' Đây là đơn từ lần gửi trước; thay đổi trên form sau khi lỗi chưa được lưu. Hãy kiểm tra chi tiết đơn trước khi chỉnh sửa hoặc tạo đơn mới.';
    });
    modal.querySelector('.modal-card').classList.add('ao-card','ow-workspace','ow-form');
    const submit=modal.querySelector('.modal-footer [type=submit]');if(submit)submit.textContent='Tiếp tục → Phiếu thanh toán';
    const back=document.createElement('button');back.type='button';back.className='btn-action btn-secondary';back.textContent='← Sửa thông tin';back.hidden=true;submit.before(back);back.onclick=()=>{step=1;q('#aoDetails').hidden=false;q('#aoPayment').hidden=true;back.hidden=true;preview.hidden=true;submit.textContent='Tiếp tục → Phiếu thanh toán';};
    const preview=document.createElement('button');preview.type='button';preview.id='aoPreviewSlip';preview.className='btn-action btn-secondary';preview.textContent='Xem phiếu gửi khách';preview.hidden=true;preview.onclick=()=>openPaymentSlipPreview(q('#aoInvoice'),preview);submit.before(preview);
    const close=modal.querySelector('.modal-footer [data-editor-close]');if(close)close.textContent='Hủy';
    const recalc=()=>{const a=amounts(),box=modal.querySelector('.ao-remaining');box.classList.toggle('is-paid',a.remaining<=0&&a.collected>0);
      q('#aoRemaining').textContent=a.remaining<=0?'0 VND (Đủ 100%)':money(a.remaining)+' (Còn thiếu '+Math.round(a.remaining/Math.max(1,a.total)*100)+'%)';
      q('#aoSummary').textContent='Tiền hàng '+money(a.subtotal)+' · VAT 10% '+money(a.vatAmount)+' · Tổng tiền '+money(a.total);};
    const applyPayType=()=>{const input=q('#aoCollected');if(editing){input.value=OrderPayments.paid(editing);input.readOnly=true;input.disabled=false;q('#aoCollectedHint').textContent='';recalc();return;}const mode=q('#aoPayType').value,full=mode==='FULL',a=amounts(),switched=lastPayType!==''&&lastPayType!==mode;input.disabled=false;input.readOnly=full;if(full)input.value=a.total;else if(switched&&lastPayType==='FULL')input.value='';input.placeholder=full?'':'Nhập số tiền khách cọc';q('#aoCollectedHint').textContent=full?'':'Nhập số tiền cọc thực nhận, ví dụ 500000.';lastPayType=mode;recalc();};
    const updateTrainingFields=()=>{
      const product=products.find(item=>item.id===q('#aoProduct').value)||products[0],required=OrderPayments.productKind(product)==='COURSE',select=q('#aoCourseKey');
      q('#aoCourseField').hidden=q('#aoTrainerField').hidden=!required;select.required=required&&!editing;
      const configs=(data.courseConfigs||[]).filter(config=>String(config.productId)===String(product.id)),keys=[...new Set(configs.map(config=>String(config.courseKey)).filter(Boolean))];
      const selected=select.value||editing?.commissionCourseKey||OrderPayments.customerCourseKey(picked,data.fields||[]);
      select.innerHTML='<option value="">Chọn khóa</option>'+keys.map(key=>'<option value="'+esc(key)+'">'+esc(key)+'</option>').join('');select.value=keys.includes(selected)?selected:keys.length===1?keys[0]:'';
      select.disabled=!!editing;
      const config=configs.find(item=>String(item.courseKey)===select.value),ids=config?.trainerIds||[],directory=data.orderAssignees||data.members||sales;
      const trainer=directory.find(member=>String(member.id)===String(editing?.commissionTrainerId||ids[0]));
      q('#aoTrainerName').value=ids.length===1&&trainer?trainer.name||trainer.accountId||trainer.id:'Cần chọn một người đào tạo trong Cấu hình Đào tạo';
    };
    q('#aoCourseKey').onchange=updateTrainingFields;
    const setProductPrice=()=>{q('#aoTotal').value=fixedTotal();q('#aoTotal').readOnly=true;applyPayType();updateTrainingFields();};
    q('#aoProduct').onchange=setProductPrice;
    q('#aoTotal').oninput=setProductPrice;q('#aoPayType').onchange=applyPayType;
    q('#aoCollected').oninput=recalc;
    q('#aoRequireVat').onchange=e=>{q('#aoVatInputs').hidden=!e.target.checked;q('#aoTaxCode').required=q('#aoCompany').required=e.target.checked;applyPayType();};
    // Giữ Sale đã chọn khi nhập SĐT cũ: chỉ tự điền thông tin từ khách
    // của đúng Sale đó, không lấy nhầm hồ sơ người khác cùng số điện thoại.
    q('#aoPhone').onchange=()=>{const selectedSale=q('#aoSale').value,phone=phoneKey(q('#aoPhone').value);
      const c=customers.find(item=>phone&&phoneKey(item.phone)===phone&&String(item.saleId||'')===String(selectedSale));if(!c)return;
      q('#aoName').value=c.name||q('#aoName').value;if(c.cccd)q('#aoCccd').value=c.cccd;if(c.address)q('#aoAddress').value=c.address;if(c.email&&!q('#aoEmail').value)q('#aoEmail').value=c.email;};
    picker=bindBillPicker(modal,'aoBillFile','aoBillPreview','aoBillName',images,'aoBillType');
    ensureAccountingOrderStyles();setProductPrice();
    if(editing){
      if(!products.some(p=>p.id===editing.productId)){const option=document.createElement('option');option.value=editing.productId;option.textContent=editing.productName||'Sản phẩm của đơn';q('#aoProduct').appendChild(option);}
      if(!sales.some(person=>person.id===editing.saleId)){const option=document.createElement('option');option.value=editing.saleId;option.textContent=editing.saleName||'Người phụ trách của đơn';q('#aoSale').appendChild(option);}
      const values={aoName:editing.customerName,aoPhone:editing.customerPhone||editing.billing?.phone,aoCccd:editing.billing?.cccd,aoAddress:editing.billing?.address,aoProduct:editing.productId,aoSale:editing.saleId,aoTotal:editing.total,aoCollected:editing.amountPaid,aoNote:editing.saleNote,aoTaxCode:editing.taxCode,aoCompany:editing.companyName,aoEmail:editing.billing?.email};
      Object.entries(values).forEach(([id,value])=>q('#'+id).value=value??'');
      q('#aoCollected').value=OrderPayments.paid(editing);q('#aoCollected').readOnly=true;q('#aoPayType').disabled=true;submit.textContent='Lưu thay đổi';modal.querySelector('.ao-lead').textContent='Cập nhật thông tin bên dưới rồi bấm Lưu thay đổi. Số tiền đã thu và lịch sử thanh toán được giữ nguyên.';const manageBills=document.createElement('button');manageBills.type='button';manageBills.className='btn-action btn-secondary';manageBills.textContent='Lưu & quản lý bill';manageBills.onclick=()=>{manageBillsAfterSave=true;modal.querySelector('form').requestSubmit();};submit.before(manageBills);q('#aoSale').disabled=true;q('#aoProduct').disabled=true;q('#aoRequireVat').checked=editing.requireVat===true;q('#aoVatInputs').hidden=!editing.requireVat;
      q('#aoPayType').value=editing.amountPaid===editing.total?'FULL':'CUSTOM';q('#aoBillName').textContent='Quản lý các bill đã lưu trong chi tiết đơn.';
      q('#refEditorTitle').textContent='CHỈNH SỬA ĐƠN HÀNG · '+shortOrderCode(editing.code||editing.id);q('#aoCollectedHint').textContent='';q('#aoCollected').closest('label').querySelector('span').textContent='Đã thu (giữ nguyên)';recalc();
    }q('#aoName').focus();
  }
  function openPaymentSlipPreview(invoice,trigger){
    if(!invoice?.querySelector('.ao-slip'))return;
    q('#paymentSlipPreview')?.remove();
    const overlay=document.createElement('div');overlay.id='paymentSlipPreview';overlay.className='modal-overlay open ao-slip-preview';
    overlay.innerHTML='<div class="modal-card ao-slip-preview-card" role="dialog" aria-modal="true" aria-label="Phiếu thanh toán gửi khách"><div class="ao-slip-preview-toolbar"><span>PHIẾU THANH TOÁN GỬI KHÁCH</span><button type="button" class="modal-close-btn" aria-label="Đóng phiếu">×</button></div><div class="ao-slip-preview-body">'+invoice.innerHTML+'</div></div>';
    const close=()=>{overlay.remove();document.removeEventListener('keydown',escape);trigger?.focus();};
    const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}};
    overlay.querySelector('button').onclick=close;overlay.onclick=event=>{if(event.target===overlay)close();};
    document.addEventListener('keydown',escape);document.body.appendChild(overlay);overlay.querySelector('button').focus();
  }
  function paymentSlipMarkup({customerName,phone,productName,paymentReference,alreadyPaid=0,...a}){
    const qr='https://qr.sepay.vn/img?acc=75725888888&bank=MBBank&amount='+a.collected+'&des='+encodeURIComponent(paymentReference);
    const slipDate=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
    return `<section class="ao-slip" aria-label="Phiếu thanh toán gửi khách hàng">
          <header><div class="ao-slip-heading"><h3>PHIẾU THANH TOÁN</h3><p>Ngày lập: <b>${esc(slipDate)}</b></p></div></header>
          <div class="ao-slip-customer"><div><small>KHÁCH HÀNG</small><strong>${esc(customerName)}</strong></div><div><small>SỐ ĐIỆN THOẠI</small><strong>${esc(phone)}</strong></div></div>
          <div class="ao-slip-items"><table><thead><tr><th scope="col">Sản phẩm / dịch vụ</th><th scope="col">Đơn giá</th></tr></thead><tbody><tr><td>${esc(productName)}</td><td>${money(a.subtotal)}</td></tr></tbody></table></div>
          <dl class="ao-slip-totals"><div><dt>VAT <span>(10%)</span></dt><dd>${money(a.vatAmount)}</dd></div><div class="ao-slip-total"><dt>Tổng thanh toán <small>(gồm VAT)</small></dt><dd>${money(a.total)}</dd></div></dl>
          <div class="ao-slip-payment">${alreadyPaid>0?'<div><span>Đã thanh toán trước đó</span><strong>'+money(alreadyPaid)+'</strong></div>':''}<div><span>${alreadyPaid>0?'Thanh toán tiếp lần này':a.remaining>0?'Thanh toán đặt cọc lần này':'Thanh toán lần này'}</span><strong>${money(a.collected)}</strong></div><div><span>Còn lại sau thanh toán</span><strong>${money(a.remaining)}</strong></div></div>
          <div class="ao-slip-bank"><div><h4>THÔNG TIN CHUYỂN KHOẢN</h4><p>Ngân hàng <b>MB Bank</b></p><p>Số tài khoản <strong class="ao-slip-account">75725888888</strong></p><p class="ao-slip-owner">CONG TY TNHH NVT AGENCY ACADEMY</p><div class="ao-slip-description"><small>Nội dung chuyển khoản</small><b>${esc(paymentReference)}</b></div></div><div class="ao-slip-qr"><img src="${esc(qr)}" alt="QR chuyển khoản MB theo số tiền thanh toán lần này"><span>Quét mã để thanh toán</span></div></div>
          <footer><b>Cảm ơn quý khách đã tin tưởng NVT Agency Academy!</b><span>Vui lòng chuyển đúng số tiền và nội dung bên trên.</span></footer>
        </section>`;
  }
  function ensureAccountingOrderStyles(){
    if(q('#accountingOrderStyles'))return;
    const style=document.createElement('style');style.id='accountingOrderStyles';style.textContent=`
      .reference-editor-card.ow-workspace{width:min(1120px,calc(100vw - 40px))!important;max-height:92dvh!important;font-family:Arial,system-ui,sans-serif!important;color:#172b4d;font-size:14px;line-height:1.5;border-radius:16px!important}
      .ow-workspace *{box-sizing:border-box}.ow-workspace.ao-card .modal-header{padding:20px 26px!important;background:#fff!important;border-bottom:1px solid #e2e8f0!important}.ow-workspace.ao-card .modal-header h3{color:#172b4d!important;font-family:inherit;font-size:17px!important;font-weight:700;line-height:1.4}.ow-workspace.ao-card .modal-close-btn{flex-shrink:0}
      .ow-workspace.ao-card .reference-editor-body{display:block!important;padding:24px 26px!important;background:#f5f7fb}.ow-workspace.ao-card .modal-footer{background:#fff!important;padding:16px 26px!important;display:flex;gap:10px;flex-wrap:wrap}.ow-workspace.ao-card .btn-action{font-family:inherit!important;font-size:13px!important;line-height:1.4!important;min-height:40px;border-radius:8px!important;padding:10px 15px!important}.ow-workspace.ao-card .btn-primary{background:#2355cc!important;color:#fff!important;border:1px solid #2355cc!important}.ow-workspace.ao-card .btn-secondary{background:#fff!important;border:1px solid #cbd5e1!important;color:#334155!important}.ow-workspace.ao-card .btn-action:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
      .ow-overview{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}.ow-eyebrow{color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}.ow-overview h2{margin:4px 0;font-size:23px;line-height:1.35;font-weight:700;overflow-wrap:anywhere}.ow-overview p{margin:0;color:#64748b;font-size:13px}.ow-statuses{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;max-width:45%}.ow-status{padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;white-space:normal}.ow-success{background:#e7f6ee;color:#14734b}.ow-warning{background:#fff3db;color:#946009}.ow-neutral{background:#eaf0f8;color:#526581}
      .ow-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:20px}.ow-metrics>div{background:#fff;border:1px solid #dfe5ee;border-radius:10px;padding:18px 20px;border-top:3px solid #3459b8;min-width:0}.ow-metrics span{display:block;font-size:12px;color:#64748b;font-weight:600}.ow-metrics strong{display:block;font-size:24px;line-height:1.35;margin:6px 0 8px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:#172b4d}.ow-metrics small{display:block;font-size:11px;color:#64748b}.ow-metrics>.ow-metric-paid{border-top-color:#269769}.ow-metric-paid strong{color:#14734b}.ow-metrics>.ow-metric-due{border-top-color:#d69a36}.ow-metric-due strong{color:#a46613}
      .ow-detail-grid,.ow-form-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.ow-section{background:#fff;border:1px solid #dfe5ee;border-radius:10px;padding:20px;min-width:0}.ow-detail-grid>.ow-section{height:100%}.ow-section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.ow-section-head h3{margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.65px;color:#334155;line-height:1.5}.ow-section-head>span{color:#7b8ba2;font-size:11px;white-space:nowrap}.ow-section-description{font-size:12px;color:#64748b;line-height:1.6;margin:-7px 0 16px}
      .ow-data-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 20px;margin:0}.ow-data-wide{grid-column:1/-1}.ow-data dt{font-size:12px;color:#64748b;margin:0 0 5px}.ow-data dd{margin:0;font-size:14px;font-weight:500;color:#172b4d;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.6}.ow-action-bar{background:#edf2fc;border:1px solid #d9e3f8;border-radius:10px;padding:16px 20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin:20px 0}.ow-action-bar b{font-size:13px}.ow-action-bar p{font-size:12px;color:#64748b;margin:3px 0 0}.ow-workspace.ao-card .ao-detail-actions{margin:0;gap:8px}.ow-history .ao-receipt{grid-template-columns:minmax(0,1fr) minmax(220px,.65fr);background:#fafbfd;border-color:#e2e8f0;padding:18px}.ow-history .ao-receipt b{font-size:15px}.ow-history .ao-receipt p,.ow-history .ao-receipt small{font-size:12px;color:#64748b}.ow-history .ao-bill-zoom{width:100%;border:1px solid #e2e8f0;background:#fff}.ow-history .ao-bill-zoom img{height:180px;max-height:180px}.ow-history .ao-bill-zoom span{padding-top:8px}.ow-history .ao-receipt-list{margin-top:18px}
      #aoCourseField[hidden],#aoTrainerField[hidden]{display:none!important}.ow-data dd.ow-missing{color:#dc2626;font-weight:600}.ow-workspace.ao-card .btn-action:disabled{background:#e2e8f0!important;border-color:#cbd5e1!important;color:#94a3b8!important;cursor:not-allowed;box-shadow:none}
      .ow-workspace #aoTotal{appearance:textfield;-moz-appearance:textfield}.ow-workspace #aoTotal::-webkit-inner-spin-button,.ow-workspace #aoTotal::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .ow-form .ao-lead{font-size:13px;line-height:1.7;color:#526581;margin:0 0 20px}.ow-workspace.ao-card .crm-field input:not([type=file]),.ow-workspace.ao-card .crm-field select,.ow-workspace.ao-card .crm-field textarea{font-family:Arial,system-ui,sans-serif!important;font-size:14px;min-height:44px;border-color:#cbd5e1;border-radius:7px}.ow-workspace.ao-card .crm-field>span{font-size:12px;font-weight:600;line-height:1.5;flex-wrap:wrap;gap:4px}.ow-workspace.ao-card .crm-field>span small{font-size:10px;color:#7b8ba2;margin-left:0;font-weight:400}.ow-workspace.ao-card .crm-field>small{font-size:11px;color:#64748b;line-height:1.6}.ow-form .crm-field textarea{min-height:155px}.ow-form .crm-form-grid{gap:16px}.ow-form .ao-grid-3{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}.ow-form .ao-grid-3>.crm-field:first-child{grid-column:1/-1}.ow-form .ao-paytype{color:#334155;font-weight:500}.ow-workspace input:read-only,.ow-workspace select:disabled{background:#f1f5f9!important;color:#64748b!important;cursor:default}.ow-form .ao-remaining{margin-top:16px;font-size:12px;display:flex;flex-wrap:wrap;justify-content:space-between;padding:12px;border-radius:7px}.ow-form .ao-remaining b{font-family:inherit;font-size:13px;white-space:normal}.ow-form .ao-summary{margin-top:12px;font-size:11px;line-height:1.7;color:#64748b}.ow-form .ao-vat-check{color:#334155;font-size:13px;font-weight:500;line-height:1.6;align-items:flex-start}.ow-form .ao-vat-check input{flex-shrink:0;margin-top:3px;accent-color:#2355cc}.ow-form .ao-vat{margin-top:18px}.ow-form #aoPayment{max-width:740px;margin:auto}.ow-form #aoPayment .ao-bill{margin-top:18px}.ow-form #aoPayment>.ao-vat-check{margin-top:16px}.ow-workspace [data-editor-error]:empty,.ow-workspace #aoCollectedHint:empty{display:none}
      @media(max-width:800px){.ow-workspace.ao-card .ow-metrics strong{font-size:20px}.ow-metrics>div{padding:14px}.ow-overview{align-items:flex-start}.ow-statuses{max-width:48%}.ow-detail-grid,.ow-form-layout{grid-template-columns:1fr}.ow-history .ao-receipt{grid-template-columns:1fr}.ow-workspace.ao-card .ao-grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:540px){.reference-editor-card.ow-workspace{width:calc(100vw - 16px)!important;max-height:96dvh!important;border-radius:12px!important}.ow-workspace.ao-card .modal-header,.ow-workspace.ao-card .modal-footer{padding:14px 16px!important}.ow-workspace.ao-card .reference-editor-body{padding:16px!important}.ow-workspace.ao-card .modal-header h3{font-size:14px!important}.ow-overview{display:block}.ow-overview h2{font-size:21px}.ow-statuses{max-width:100%;justify-content:flex-start;margin-top:12px}.ow-metrics{grid-template-columns:1fr;gap:10px}.ow-metrics>div{padding:14px 16px}.ow-metrics strong{font-size:22px;margin:4px 0}.ow-section{padding:16px}.ow-data-grid{gap:16px}.ow-data dd{font-size:13px}.ow-action-bar{padding:16px}.ow-detail-actions{width:100%}.ow-detail-actions .btn-action{flex:1}.ow-workspace.ao-card .modal-footer .btn-action{flex:1;padding:10px!important}.ow-form .crm-form-grid{grid-template-columns:1fr}.ow-form .ao-grid-3{grid-template-columns:1fr}.ow-form .crm-field-full{grid-column:1/-1}.ow-workspace.ao-card .ao-remaining{flex-direction:row;align-items:center}}

      .ao-receipt .btn-danger,.ao-image-edit .btn-danger{border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:7px;padding:7px 10px;font:600 12px var(--font-sans,Arial,sans-serif);cursor:pointer}.ao-receipt .btn-danger:hover,.ao-image-edit .btn-danger:hover{background:#ffe4e6}
      .ao-help{padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;line-height:1.6}.ao-help p{margin:5px 0 0}.ao-image-editor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.ao-image-edit{padding:12px;border:1px solid #dbe3ec;border-radius:10px;display:grid;gap:10px}.ao-image-edit-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px}.ao-image-edit-head small{color:#64748b}.ao-image-edit>img{width:100%;height:170px;object-fit:contain;background:#f8fafc;border-radius:6px}.ao-image-edit textarea{min-height:66px}.ao-image-upload{border:1px dashed #94a3b8;border-radius:10px;padding:16px;margin-top:14px}.ao-image-upload p{font-size:12px;line-height:1.5;color:#64748b;margin-bottom:0}@media(max-width:480px){.ao-image-editor{grid-template-columns:1fr}}
      .ao-slip{border:1px solid #dce3ed;border-radius:12px;overflow:hidden;background:#fff;color:#172b4d;font:14px/1.5 Arial,system-ui,sans-serif;box-sizing:border-box}.ao-slip *{box-sizing:border-box}.ao-slip header{padding:24px 28px 20px;background:#fff;border-bottom:1px solid #e2e8f0;border-top:5px solid #2355cc;display:flex;align-items:center;justify-content:space-between;gap:20px}.ao-slip-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;text-align:left}.ao-slip h3{margin:0;font-size:23px;letter-spacing:.3px;line-height:1.3;color:#172b4d}.ao-slip p{margin:6px 0;font-size:13px}.ao-slip-heading p{color:#64748b;font-size:12px;margin:0;white-space:nowrap}.ao-slip-heading b{font-weight:600;color:#334155}.ao-slip small{color:#64748b;font-size:11px}.ao-slip-customer{padding:10px 28px;display:grid;grid-template-columns:1.6fr 1fr;gap:18px;background:#f8fafc}.ao-slip-customer>div{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;min-width:0}.ao-slip-customer small{display:block;font-size:10px;letter-spacing:.6px}.ao-slip-customer strong{display:block;margin-top:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}.ao-slip-items{padding:18px 28px 0}.ao-slip-items table{width:100%;border-collapse:collapse;table-layout:fixed;font:inherit}.ao-slip-items th{background:#f3f6fb;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:10px 12px;text-align:left;border:0}.ao-slip-items th:last-child{width:32%;text-align:right}.ao-slip-items td{padding:16px 12px;border-bottom:1px solid #e2e8f0;border-top:0;color:#172b4d;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere}.ao-slip-items td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:13px}.ao-slip-totals{margin:0;padding:8px 40px 16px}.ao-slip-totals>div{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:8px 0}.ao-slip dd{margin:0;text-align:right;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}.ao-slip dt{font-size:13px;color:#526581}.ao-slip dt span{color:#64748b}.ao-slip-total{border-top:1px solid #e2e8f0;margin-top:4px}.ao-slip-total dt{font-weight:700;color:#172b4d}.ao-slip-total dd{font-size:22px;color:#2355cc;font-weight:700}.ao-slip-payment{margin:0 28px 20px;padding:14px 16px;background:#edf7f1;border:1px solid #d7ecdf;border-radius:8px;display:grid;gap:8px}.ao-slip-payment>div{display:flex;align-items:baseline;justify-content:space-between;gap:14px;font-size:12px;color:#526581}.ao-slip-payment strong{font-size:19px;color:#14734b;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.ao-slip-payment b{font-weight:600;white-space:nowrap}.ao-slip-bank{display:grid;grid-template-columns:minmax(0,1fr) 170px;align-items:center;gap:24px;padding:20px 28px;border-top:1px solid #e2e8f0}.ao-slip-bank h4{font-size:10px;letter-spacing:.6px;margin:0 0 12px;color:#64748b;font-weight:700}.ao-slip-bank p{color:#526581;font-size:12px;margin:5px 0}.ao-slip-bank p b{color:#172b4d}.ao-slip-account{display:block;font-size:22px;letter-spacing:1px;color:#172b4d;line-height:1.4}.ao-slip-owner{font-weight:600;font-size:10px!important;color:#334155!important;line-height:1.5}.ao-slip-description{background:#f1f5fb;border-radius:6px;padding:10px 12px;margin-top:12px;overflow-wrap:anywhere}.ao-slip-description small{font-size:10px}.ao-slip-description b{display:block;margin-top:4px;font-size:12px;font-weight:600}.ao-slip-qr{text-align:center}.ao-slip-qr img{display:block;width:170px;max-width:100%;height:auto;aspect-ratio:1;background:#fff;margin:auto}.ao-slip-qr>span{display:block;font-size:10px;color:#64748b;margin-top:6px}.ao-slip footer{padding:14px 28px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#64748b;line-height:1.6}.ao-slip footer b{display:block;font-size:11px;color:#334155;font-weight:600}.ao-slip footer span{display:block;font-size:11px;margin-top:3px}.ao-slip footer small{display:block;font-size:10px;margin-top:6px;color:#94a3b8}
      .ao-slip-preview{z-index:13000!important}.ao-slip-preview-card{width:min(800px,calc(100vw - 32px))!important;max-height:96dvh!important;border-radius:12px!important;background:#f3f6fb!important}.ao-slip-preview-toolbar{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid #e2e8f0;background:#fff;gap:16px;flex-shrink:0}.ao-slip-preview-toolbar>span{font:600 11px Arial,sans-serif;color:#64748b;letter-spacing:.4px}.ao-slip-preview-toolbar button{width:32px;height:32px;color:#64748b;font-family:Arial,sans-serif}.ao-slip-preview-body{overflow-y:auto;padding:16px}.ao-slip-preview [hidden]{display:none!important}
      @media(max-width:540px){.ao-slip header{padding:16px;gap:12px}.ao-slip-heading{flex-wrap:wrap;gap:6px 12px}.ao-slip h3{font-size:17px}.ao-slip-heading p{font-size:10px}.ao-slip-customer{padding:8px 16px;grid-template-columns:1.4fr 1fr;gap:10px}.ao-slip-customer>div{gap:2px 6px}.ao-slip-customer strong{font-size:12px}.ao-slip-items{padding:14px 16px 0}.ao-slip-items th{padding:8px;font-size:9px}.ao-slip-items th:last-child{width:38%}.ao-slip-items td{padding:12px 8px;font-size:12px}.ao-slip-items td:last-child{font-size:11px;white-space:normal}.ao-slip-totals{padding:8px 24px 12px}.ao-slip dt{font-size:11px}.ao-slip dd{font-size:12px}.ao-slip-total dd{font-size:17px}.ao-slip-total dt small{display:block;font-size:10px}.ao-slip-payment{margin:0 16px 16px;padding:12px}.ao-slip-payment>div{font-size:11px;gap:10px}.ao-slip-payment strong{font-size:15px}.ao-slip-bank{padding:16px;grid-template-columns:1fr;gap:16px}.ao-slip-qr img{width:160px}.ao-slip-account{font-size:21px}.ao-slip footer{padding:12px 16px}.ao-slip-preview-body{padding:8px}.ao-slip-preview-card{width:calc(100vw - 16px)!important}.ao-slip-preview-toolbar{padding:8px 12px}}

      .ow-workspace.ow-form .ow-form-layout{align-items:stretch;gap:16px}.ow-workspace.ow-form .ow-form-layout>.ow-section{height:100%;padding:18px}.ow-workspace.ow-form .ow-section-head{margin-bottom:12px}.ow-workspace.ow-form .ao-lead{margin-bottom:16px;font-size:12px}.ow-workspace.ow-form .crm-form-grid{align-items:start;gap:14px 16px}.ow-workspace.ow-form .crm-field{display:flex;flex-direction:column;gap:6px;align-self:start}.ow-workspace.ow-form .crm-field>span{display:block;min-height:34px;line-height:18px;font-size:12px}.ow-workspace.ow-form .crm-field>span small{display:block;margin:0;font-size:10px;line-height:14px;color:#8491a5}.ow-workspace.ow-form .crm-field input:not([type=file]),.ow-workspace.ow-form .crm-field select{height:42px!important;min-height:42px!important;max-height:42px;flex:none;padding:9px 11px!important;line-height:22px;font-size:13px!important}.ow-workspace.ow-form .crm-field textarea{height:90px;min-height:90px!important;padding:10px 12px!important;font-size:13px!important;line-height:1.6}.ow-workspace.ow-form .ao-grid-3{align-items:start;gap:14px 16px;margin-top:14px}.ow-workspace.ow-form .ao-grid-3>.crm-field:first-child>span{min-height:18px}.ow-workspace.ow-form .ao-remaining{margin-top:14px;padding:10px 12px}.ow-workspace.ow-form .ao-summary{margin-top:10px;line-height:1.6}.ow-workspace.ow-form .ow-section-description{margin-bottom:12px}.ow-workspace.ow-form .ao-vat-check{font-size:12px}.ow-workspace.ow-form .ao-vat{margin-top:14px}
      @media(max-width:800px){.ow-workspace.ow-form .ow-form-layout>.ow-section{height:auto}}
      @media(max-width:540px){.ow-workspace.ow-form .ow-form-layout>.ow-section{padding:16px}.ow-workspace.ow-form .crm-field>span{min-height:0}.ow-workspace.ow-form .crm-field>span small{display:inline;margin-left:5px}.ow-workspace.ow-form .crm-form-grid,.ow-workspace.ow-form .ao-grid-3{gap:12px}.ow-workspace.ow-form .crm-field input:not([type=file]),.ow-workspace.ow-form .crm-field select{height:44px!important;min-height:44px!important;max-height:44px}.ow-workspace.ow-form .ao-grid-3>.crm-field:first-child>span{min-height:0}}
      .ow-collection .receipt-collection-controls,.ow-collection .receipt-collection-invoice,.ow-collection .receipt-collection-evidence{max-width:740px;width:100%;margin:0 auto 18px}.ow-collection .receipt-collection-evidence{margin-bottom:0}.ow-collection .receipt-collection-evidence>.crm-form-grid{margin-top:16px}.ow-collection .receipt-collection-evidence>.ao-vat-check{margin-top:18px}.ow-collection #receiptFile{font:13px Arial,sans-serif;max-width:100%;padding:10px;border:1px dashed #b8c5d6;background:#f8fafc;border-radius:7px}.ow-collection #receiptFileStatus:empty,.ow-collection #receiptPreview:empty{display:none}.ow-collection #receiptFileStatus{font-size:12px;color:#64748b}.ow-collection #receiptPreview:not(:empty){margin:16px 0}.ow-collection #receiptAmount::-webkit-inner-spin-button,.ow-collection #receiptAmount::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .ao-detail-summary{padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px}.ao-detail-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.receipt-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}.receipt-images p{white-space:pre-wrap;overflow-wrap:anywhere}.ao-receipt-list{display:grid;gap:14px;margin-top:12px}.ao-receipt{display:grid;grid-template-columns:1fr 180px;gap:16px;padding:16px;border:1px solid #dbe3ec;border-radius:12px}.ao-receipt p{margin:8px 0}.ao-bill-zoom{border:0;background:#f8fafc;cursor:zoom-in;padding:8px;border-radius:8px}.ao-bill-zoom img{width:100%;max-height:200px;object-fit:contain}.ao-bill-zoom span{display:block;font-size:11px;color:#2563eb}@media(max-width:500px){.ao-receipt{grid-template-columns:1fr}.ao-bill-zoom{max-width:240px}}
      #aoDetails,#aoPayment{display:grid;gap:16px}#aoDetails[hidden],#aoPayment[hidden]{display:none!important}
      .ao-card{width:min(680px,calc(100vw - 28px))!important;max-height:min(880px,94dvh)!important}
      .ao-card .modal-header{background:var(--accent-soft,#eff6ff)!important;border-bottom-color:#bfdbfe!important}
      .ao-card .modal-header h3{color:var(--accent-dark,#1d4ed8)!important}
      .ao-card,.ao-card .crm-field input:not([type=file]),.ao-card .crm-field select{font-family:var(--font-sans)!important}
      .ao-card .reference-editor-body{display:grid!important;gap:14px}
      .ao-lead{margin:0;color:var(--text-muted);font-size:12px}
      .ao-card .ao-mono{font-family:var(--font-mono)!important;font-weight:700}
      .ao-manual input{border-color:#93c5fd!important;background:#eff6ff!important}
      .ao-manual>span{color:var(--accent-dark,#1d4ed8)!important}
      .ao-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
      .ao-card .ao-paytype{color:#c2410c;font-weight:700}
      .ao-green{color:#047857!important}.ao-card .ao-collected{border-color:#86efac;color:#047857}
      .ao-remaining{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;border:1px solid #fecaca;border-radius:var(--radius-sm,8px);background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:700}
      .ao-remaining b{font-family:var(--font-mono);font-size:14px;color:#dc2626;white-space:nowrap}
      .ao-remaining.is-paid{border-color:#bbf7d0;background:#f0fdf4;color:#15803d}.ao-remaining.is-paid b{color:#15803d}
      .ao-bill{display:grid;gap:8px;padding:12px;border:1px solid var(--border,#e2e8f0);border-radius:var(--radius-md,10px);background:var(--bg-subtle,#f8fafc)}
      .ao-bill-title{color:#334155;font-size:12px;font-weight:800}.ao-bill-title em,.ao-vat em{color:#dc2626;font-style:normal}
      .ao-bill-row{display:flex;gap:10px;align-items:center}
      .ao-bill-row select{flex:1;min-width:0;min-height:38px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:var(--text-main);font:500 13px var(--font-sans)}
      .ao-bill-row .crm-file-button{min-height:38px;border:1px solid #cbd5e1;background:#fff}
      .ao-file{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
      .ao-file:focus-visible+label{outline:2px solid var(--accent,#2563eb);outline-offset:2px}
      .ao-card [hidden]{display:none!important}
      .ao-vat-check{display:flex;align-items:center;gap:8px;color:#6d28d9;font-size:12px;font-weight:700;cursor:pointer}
      .ao-vat-check input{width:16px;height:16px;accent-color:#6d28d9}
      .ao-summary{margin:0;color:var(--text-muted);font-size:11.5px}
      @media(max-width:600px){.ao-grid-3{grid-template-columns:1fr;gap:13px}.ao-remaining{flex-direction:column;align-items:flex-start}.ao-bill-row{flex-direction:column;align-items:stretch}}
    `;document.head.appendChild(style);
  }
  // Nút tạo đơn ở tab Đơn hàng mở form trống; nút trong hồ sơ khách điền sẵn khách đang xem.
  openOrderModal=()=>openAccountingOrderForm('');
  openOrderModalFromDrawer=()=>{const id=selectedCustomer;closeDrawer();openAccountingOrderForm(id);};
  markAllNotificationsRead=()=>run(()=>api.readNotifications());
  // Khi bat tu dong, mac dinh dung che do ty trong cho data moi.
  toggleAutoDist=enabled=>run(()=>api.distribution(enabled,enabled?'BALANCED':data.settings.assignmentMode));
  updateAssignmentMode=mode=>run(()=>api.distribution(data.leaderDistribution.enabled,mode));
  switchTab=function(id){document.getElementById('crm-preheat-tab-style')?.remove();if(data&&(data.user.actualRole||data.user.role)==='ACCOUNTING'&&!['tab-accounting','tab-audit','tab-notifications'].includes(id))return;if(data&&(data.user.actualRole||data.user.role)==='HRM'&&!tabAllowedForSnapshot(id))return;if(data&&(data.user.actualRole||data.user.role)==='MARKETING'&&!tabAllowedForSnapshot(id))return;if(data){const view=id.replace('tab-',''),alias={data:data.user.role==='LEADER'?'pool':data.user.role==='SALE'?'accept':'distribution'},target=alias[view]||view;if(!sharedOrganizationTabs.has(view)&&!data.navigation.includes(target)&&!data.navigation.includes(view)&&!(view==='marketing'&&(data.user.actualRole||data.user.role)==='MARKETING'))return;}rememberActiveTab(id);renders.switchTab(id);if(data){if(id==='tab-customers')clearAutofilledCustomerSearch();if(id==='tab-data'&&(data.user.actualRole||data.user.role)==='SALE'){const search=q('#dataQueueSearch');if(search)search.value='';}paintTab(id,id==='tab-data'||id==='tab-marketing');if(id==='tab-audit'){renderUserLog();loadUserActivity();loadOrderAudit();}reportUserActivity(id);wireParity();}};
  qa('.nav-link[data-tab]').forEach(button=>button.addEventListener('click',()=>rememberActiveTab(button.dataset.tab),true));
  filterTeamPeriod=(period,button)=>{q('#teamStartDate').value=fromDay(parseInt(period)||30);q('#teamEndDate').value=data.today;if(button){qa('.team-period-btn').forEach(b=>b.className='btn-secondary team-period-btn');button.className='btn-primary team-period-btn';}updateTeamDateLabel();};
  updateTeamDateLabel=()=>text('teamDateRangeLabel',fmtDate(q('#teamStartDate').value)+' - '+fmtDate(q('#teamEndDate').value));
  let revenuePeriod=30;
  function revenueRangeSummary(from,to){
    const orders=new Map((data?.orders||[]).map(order=>[String(order.id),order]));
    const isRental=order=>Boolean(order.rentalMonths)||(data?.products||[]).some(product=>String(product.id)===String(order.productId)&&product.type==='RENTAL');
    const inRange=value=>{const day=String(value||'').slice(0,10);return !!day&&(!from||day>=from)&&(!to||day<=to);};
    const events=(data?.financialEvents||[]).filter(event=>orders.has(String(event.orderId))&&inRange(event.occurredAt));
    let course=0,rental=0,tax=0,net=0;
    for(const event of events){const amount=Number(event.amount)||0,vat=Number(event.vatAmount)||0;if(isRental(orders.get(String(event.orderId))))rental+=amount;else course+=amount;tax+=vat;net+=Number(event.netAmount??amount-vat)||0;}
    const courseCount=[...orders.values()].filter(order=>!isRental(order)&&['PAID','COURSE_GRANTED'].includes(order.status)&&inRange(order.paidAt||order.createdAt)).length;
    const asOf=to||data?.today;
    const rentalOrders=[...orders.values()].filter(order=>isRental(order)&&['PAID','COURSE_GRANTED'].includes(order.status)&&(!asOf||String(order.paidAt||order.createdAt||'').slice(0,10)<=asOf)&&(!order.rentalEndsAt||String(order.rentalEndsAt).slice(0,10)>=asOf));
    return {events,course,rental,total:course+rental,tax,afterTax:net,courseCount,rentalOrders,rentalCustomers:new Set(rentalOrders.map(order=>order.customerId||order.id)).size};
  }
  function renderRevenue(){
    if(!data)return;
    const validDay=value=>{const day=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const parsed=new Date(day+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day&&day<=(data.today||'9999-12-31');};
    const startInput=q('#revStartDate'),endInput=q('#revEndDate'),chosenStart=validDay(startInput?.value)?startInput.value.slice(0,10):'',chosenEnd=validDay(endInput?.value)?endInput.value.slice(0,10):'';
    const start=chosenStart&&chosenEnd&&chosenStart<=chosenEnd?chosenStart:fromDay(30),end=chosenStart&&chosenEnd&&chosenStart<=chosenEnd?chosenEnd:data.today;
    if(startInput)startInput.value=start;
    if(endInput)endInput.value=end;
    revenuePeriod=Math.max(1,Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1);
    const role=data.user.actualRole||data.user.role,subtitle=q('#tab-revenue .headline-row > div:first-child > div');
    if(subtitle)subtitle.textContent=role==='MANAGER'?'Chỉ hiển thị doanh thu Team '+(data.user.teamId||'được chọn')+' thuộc tuyến Manager':role==='LEADER'?'Chỉ hiển thị doanh thu Team '+(data.user.teamId||'')+' do bạn quản lý':role==='SALE'?'Chỉ hiển thị doanh thu từ khách hàng bạn phụ trách':'Báo cáo doanh thu toàn hệ thống';
    const current=revenueRangeSummary(start,end);
    const dayMs=86400000,parseDay=value=>Date.parse(value+'T00:00:00Z');
    const first=start||data.today,last=end||data.today,days=Math.max(1,Math.round((parseDay(last)-parseDay(first))/dayMs)+1);
    const previousEnd=new Date(parseDay(first)-dayMs).toISOString().slice(0,10),previousStart=new Date(parseDay(first)-days*dayMs).toISOString().slice(0,10),previous=revenueRangeSummary(previousStart,previousEnd);
    const change=(value,old)=>old?(value-old)/Math.abs(old)*100:value?100:0;
    const updateCard=(id,title,value,sub,delta)=>{const node=q('#'+id);if(!node)return;node.textContent=money(value);const card=node.closest('.bento-card');if(!card)return;const titleNode=card.querySelector('div:first-child span:first-child');if(titleNode)titleNode.textContent=title;const footer=card.querySelector('div[style*="margin-top: 10px"]');if(footer){const parts=footer.querySelectorAll('span,b');if(parts[0])parts[0].textContent=sub||'';if(parts[1])parts[1].textContent='';}const chip=card.querySelector('div:first-child span:last-child');if(chip){chip.textContent=(delta>=0?'+':'')+delta.toFixed(1)+'%';chip.style.background=delta>=0?'#dcfce7':'#fee2e2';chip.style.color=delta>=0?'#15803d':'#b91c1c';}};
    updateCard('revStatSoldAmount','DOANH THU KHÓA HỌC',current.course,current.courseCount+' khóa bán',change(current.course,previous.course));
    updateCard('revStatRentingCust','DOANH THU THUÊ CHỈ BÁO',current.rental,current.rentalCustomers+' khách đang thuê',change(current.rental,previous.rental));
    updateCard('revStatMrr','TỔNG DOANH THU',current.total,'',change(current.total,previous.total));
    updateCard('revStatAov','DOANH THU SAU THUẾ',current.afterTax,'',change(current.afterTax,previous.afterTax));
    const pct=current.total>0?Math.max(0,Math.min(100,current.course/current.total*100)):0,rentPct=current.total>0?100-pct:0;
    q('#revSvgSaleCircle')?.setAttribute('stroke-dasharray',pct/100*326.73+' 326.73');
    q('#revSvgRentCircle')?.setAttribute('stroke-dasharray',rentPct/100*326.73+' 326.73');
    q('#revSvgRentCircle')?.setAttribute('transform','rotate('+(-90+pct*3.6)+' 80 80)');
    for(const [id,value] of Object.entries({revSvgSaleText:pct.toFixed(1)+'%',revSvgRentText:rentPct.toFixed(1)+'%',revDonutSalePercent:pct.toFixed(1)+'%',revDonutRentPercent:rentPct.toFixed(1)+'%',revDonutCenterAmount:money(current.total),revDonutCenterPeriod:revenuePeriod+' NGÀY',revDonutTotalAmount:money(current.total),revDonutSaleDetail:money(current.course),revDonutRentDetail:money(current.rental),revDonutVatAmount:money(current.tax),revRentalCountBadge:current.rentalCustomers+' khách đang thuê',revRentalCountFooter:current.rentalCustomers+' khách',revRentalAmountFooter:money(current.rental),revTransactionCountFooter:current.events.length+' giao dịch',revNetAmountFooter:money(current.afterTax),revGrossAmountFooter:money(current.total)}))text(id,value);
    text('revLedgerRange',start&&end?'Phạm vi: '+fmtDate(start)+' – '+fmtDate(end):start?'Từ ngày '+fmtDate(start):end?'Đến ngày '+fmtDate(end):'Phạm vi: Tất cả ngày');
    table(q('#revenueSalesTableBody'),current.events.map(event=>{const order=data.orders.find(item=>String(item.id)===String(event.orderId))||{},customer=data.customers?.find(item=>item.id===order.customerId),website=data.websites?.find(item=>item.id===(order.websiteId||customer?.websiteId));return [internalCode(order.code||event.code||event.orderId),fmtDate(event.occurredAt),event.customerName,order.productName,event.label,website?.sourceUrl||customer?.landingPageUrl||order.source||'—',person(order.saleId),money(event.netAmount),money(event.vatAmount),money(event.amount),order.status,''];}));
    table(q('#rentalCustomersTableBody'),current.rentalOrders.map(order=>[order.customerName,order.productName,fmtDate(order.rentalEndsAt),money(order.total),order.status,'']));
    const bindDetails=(selector,rows)=>Array.from(q(selector)?.rows||[]).forEach((row,index)=>row.querySelectorAll('button').forEach(button=>{button.removeAttribute('onclick');button.onclick=()=>workflow('order',rows[index].orderId||rows[index].id);}));
    bindDetails('#revenueSalesTableBody',current.events);bindDetails('#rentalCustomersTableBody',current.rentalOrders);
    const heading=q('#tab-revenue h1');if(heading)heading.textContent='Doanh thu khóa học và thuê công cụ, chỉ báo';
  }
  setRevenueDonutPeriod=(period,btn)=>{revenuePeriod=parseInt(period)||30;q('#revStartDate').value=fromDay(revenuePeriod);q('#revEndDate').value=data.today;qa('#donutRevenuePeriodTabs button,#revenueTopPeriodTabs button').forEach(b=>b.classList.toggle('active',parseInt(b.textContent)===revenuePeriod));renderRevenue();};
  filterRevenuePeriod=setRevenueDonutPeriod;applyCustomRevenueDate=renderRevenue;

  // Binding rieng cho lop giao dien tham chieu. Dung id co dinh de nut Luu
  // van hoat dong du HTML bi thay doi thu tu hoac bi cache ban cu.
  function bindReferenceSettings(){
    const root=q('#tab-settings');
    if(!root||!data?.settings)return;
    const settings=data.settings;
    const colorSelect=q('#referenceThemeColorSelect');
    const fontSelect=q('#referenceFontFamilySelect');
    const navigationRange=q('#referenceNavigationFontSize');
    const contentRange=q('#referenceContentFontSize');
    const emailEnabled=q('#referenceEmailNotificationsEnabled');
    const leaderAttendance=q('#leaderAttendanceRequired');
    let colorPicker=q('#referenceAccentPicker');
    const fonts=Object.fromEntries(data.fonts||[]);

    if(!colorSelect||!fontSelect||!navigationRange||!contentRange)return;
    if(!Array.from(colorSelect.options).some(option=>option.value===(settings.customAccent||'#e8572a'))){
      colorSelect.add(new Option(settings.customAccent,settings.customAccent));
    }
    colorSelect.value=settings.customAccent||'#e8572a';
    fontSelect.innerHTML=(data.fonts||[]).map(([key,label])=>opt(key,label,settings.fontFamily||'aptos')).join('');
    fontSelect.value=settings.fontFamily||'aptos';
    navigationRange.value=settings.navigationFontSize||12;
    contentRange.value=settings.contentFontSize||14;
    if(emailEnabled)emailEnabled.checked=settings.emailNotificationsEnabled!==false;
    if(leaderAttendance)leaderAttendance.checked=settings.leaderAttendanceRequired!==false;

    if(!colorPicker){
      colorPicker=document.createElement('input');
      colorPicker.id='referenceAccentPicker';
      colorPicker.type='color';
      colorPicker.setAttribute('aria-label','Chon mau chu dao');
      colorPicker.style.cssText='width:38px;height:38px;padding:2px;border:1px solid var(--border);border-radius:8px;cursor:pointer;flex-shrink:0;';
      colorSelect.parentElement?.appendChild(colorPicker);
    }
    colorPicker.value=colorSelect.value;

    const preview=()=>{
      const accent=colorSelect.value;
      const font=fonts[fontSelect.value]||fontSelect.value||'Aptos';
      document.documentElement.style.setProperty('--accent',accent);
      document.documentElement.style.setProperty('--accent-dark',accent);
      document.documentElement.style.setProperty('--accent-soft',accent+'18');
      document.documentElement.style.setProperty('--font-sans',`'${font}', sans-serif`);
      document.documentElement.style.setProperty('--sans',`'${font}', sans-serif`);
      document.documentElement.style.setProperty('--navigation-font-size',navigationRange.value+'px');
      document.documentElement.style.setProperty('--content-font-size',contentRange.value+'px');
      qa('.nav-link').forEach(node=>node.style.fontSize=navigationRange.value+'px');
      qa('.content-body input:not([type=range]),.content-body select,.content-body td').forEach(node=>node.style.fontSize=contentRange.value+'px');
      if(colorPicker)colorPicker.value=accent;
      const swatch=colorSelect.parentElement?.querySelector('[data-settings-color-swatch]')||colorSelect.parentElement?.lastElementChild;
      if(swatch&&swatch!==colorPicker)swatch.style.background=accent;
      const values=[navigationRange,contentRange];
      values.forEach(range=>{const valueNode=range.parentElement?.previousElementSibling?.querySelector('span:last-child');if(valueNode)valueNode.textContent=range.value+'PX';});
    };
    colorSelect.onchange=preview;
    colorPicker.oninput=()=>{if(!Array.from(colorSelect.options).some(option=>option.value===colorPicker.value))colorSelect.add(new Option(colorPicker.value,colorPicker.value));colorSelect.value=colorPicker.value;preview();};
    fontSelect.onchange=preview;
    navigationRange.oninput=preview;
    contentRange.oninput=preview;
    preview();

    let save=q('#referenceSettingsSaveButton');
    if(!save){
      save=document.createElement('button');
      save.id='referenceSettingsSaveButton';
      save.type='button';
      save.className='btn-action btn-primary';
      save.textContent='L\u01b0u c\u00e0i \u0111\u1eb7t';
      (root.querySelector('.settings-actions')||root.querySelector('.table-container:last-child'))?.appendChild(save);
    }
    save.onclick=async()=>{
      if(working)return;
      const original=save.textContent;
      save.disabled=true;
      save.textContent='\u0110ang l\u01b0u...';
      const payload={
        customAccent:colorSelect.value,
        fontFamily:fontSelect.value,
        navigationFontSize:Number(navigationRange.value),
        contentFontSize:Number(contentRange.value),
        emailNotificationsEnabled:emailEnabled?emailEnabled.checked:true,
        leaderAttendanceRequired:leaderAttendance?leaderAttendance.checked:true,
        referenceAppearance:true
      };
      try{
        await run(()=>api.settings(payload),()=>window.alert('\u0110\u00e3 l\u01b0u c\u00e0i \u0111\u1eb7t giao di\u1ec7n cho to\u00e0n h\u1ec7 th\u1ed1ng.'));
      }finally{
        save.disabled=false;
        save.textContent=original;
      }
    };
  }

  function sourceAnalytics(){
    const period=q('#sourcePeriodSelect')?.value||'all';
    const since=period==='today'?data.today:period==='week'?fromDay(7):period==='month'?data.today.slice(0,7)+'-01':'';
    const pool=data.customers.filter(c=>!since||c.createdAt?.slice(0,10)>=since);
    q('#sourcePeriodSelect')?.querySelectorAll('option').forEach(n=>n.textContent=({today:'Hôm nay',week:'7 ngày qua',month:'Tháng này',all:'Tất cả thời gian'})[n.value]||n.textContent);
    const groups=data.websites.map(w=>({name:w.name||w.domain,count:pool.filter(c=>c.websiteId===w.id).length,color:'#2563eb'}));
    const unknown=pool.filter(c=>!data.websites.some(w=>w.id===c.websiteId)).length;if(unknown)groups.push({name:'Chưa gắn nguồn',count:unknown,color:'#94a3b8'});
    const wrap=q('#sourceDonutWrap');if(wrap)wrap.innerHTML=drawDonutSvg(groups.map((g,i)=>({pct:pool.length?g.count/pool.length*100:0,color:['#0284c7','#c084fc','#10b981'][i%3],label:g.count+' khách'})),String(pool.length),'DATA');
    const legend=q('#sourceLegendWrap');if(legend)legend.innerHTML=groups.map(g=>'<div style="padding:8px 10px;background:var(--bg-subtle);border-radius:7px;border-left:3px solid #0284c7"><b>'+esc(g.name)+'</b><span style="float:right">'+g.count+'</span></div>').join('');
    text('sourceFooterWrap',pool.length+' khách');
    const totals=qa('#tab-websites .analytics-grid:first-of-type [style*="font-size: 32px"]');[data.customers.length,data.customers.filter(c=>!c.saleId).length,data.customers.filter(c=>c.saleId).length].forEach((v,i)=>primaryText(totals[i],String(v)));
  }
  switchSourcePeriod=sourceAnalytics;
  renderFunnelChart=()=>{if(!data)return;const value=q('#funnelLpSelect')?.value;const pool=data.customers.filter(c=>!value||value==='all'||c.websiteId===value);const paid=new Set(data.orders.filter(o=>o.status==='PAID').map(o=>o.customerId));const count=pool.filter(c=>paid.has(c.id)).length;const pct=pool.length?count/pool.length*100:0;q('#funnelDonutWrap').innerHTML=drawDonutSvg([{pct,color:'#10b981',label:pct.toFixed(1)+'%'},{pct:pool.length?100-pct:0,color:'#94a3b8',label:'Còn lại'}],String(pool.length),'KHÁCH');text('funnelWinRateText',pct.toFixed(1)+'%');text('funnelLegendWrap','Đã mua: '+count+' · Còn lại: '+(pool.length-count));text('funnelRevenueText',money(data.orders.filter(o=>o.status==='PAID'&&pool.some(c=>c.id===o.customerId)).reduce((s,o)=>s+Number(o.total||0),0)));};
  const setupSources=()=>{q('#funnelLpSelect').innerHTML=opt('all','Tất cả Landing page')+data.websites.map(w=>opt(w.id,w.name)).join('');renderFunnelChart();};
  // Safe logout bridge for the reference UI.
  let referenceLogoutBusy=false;
  async function performReferenceLogout(){
    if(referenceLogoutBusy||!api)return;
    referenceLogoutBusy=true;
    try{
      customerNoteSaveTimers.forEach(timer=>clearTimeout(timer));
      customerNoteSaveTimers.clear();
      customerNoteDrafts.forEach(record=>customerSaveQueue.enqueue(record.key,selectionAction(record.payload),record.payload));
      customerNoteDrafts.clear();
      persistCustomerNoteDrafts();
      if(customerSaveQueue.pending||customerSaveQueue.running){
        await customerSaveQueue.flush({timeout:15000});
        referenceNotice('B\u1ea3n nh\u00e1p ch\u01b0a đ\u1ed3ng b\u1ed9 đ\u01b0\u1ee3c gi\u1eef l\u1ea1i. Đang đ\u0103ng xu\u1ea5t...');
      }
      await api.logout();
      data=null;signature='';customerDraftOwner='';customerDraftValues.clear();frame.style.display='block';
    }catch(error){
      const message=error?.name==='AbortError'||/abort|signal/i.test(error?.message||'')
        ? 'M\u00e1y ch\u1ee7 ph\u1ea3n h\u1ed3i qu\u00e1 l\u00e2u. B\u1ea3n nh\u00e1p v\u1eabn đ\u01b0\u1ee3c gi\u1eef l\u1ea1i, h\u00e3y th\u1eed đ\u0103ng xu\u1ea5t l\u1ea1i.'
        : (error?.message||'Kh\u00f4ng th\u1ec3 đ\u0103ng xu\u1ea5t l\u00fac n\u00e0y.');
      referenceNotice(message,'error');
    }finally{referenceLogoutBusy=false;}
  }
  const logoutButton=qa('button').find(button=>button.closest('.topbar')&&/(logout|xu.t|xuat)/i.test(button.textContent||''));
  if(logoutButton){logoutButton.removeAttribute('onclick');logoutButton.type='button';logoutButton.onclick=event=>{event.preventDefault();event.stopPropagation();void performReferenceLogout();};}
  document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const text=String(button.textContent||'').trim();const code=button.getAttribute('onclick')||'';
    if(button.closest('.topbar')&&/(logout|xu.t|xuat)/i.test(text)){event.preventDefault();event.stopImmediatePropagation();void performReferenceLogout();return;}
    if(code.startsWith('alert(')){event.preventDefault();event.stopImmediatePropagation();if(/dang xuat|logout/i.test(code)||/\u0111\u0103ng xu\u1ea5t/i.test(code)){void performReferenceLogout();}else if(/danh dau|da doc/i.test(code)||/\u0111\u00e1nh d\u1ea5u|\u0111\u00e3 \u0111\u0111\u1ecdc/i.test(code))markAllNotificationsRead();else alert('Chức năng này chưa có form kết nối trong giao diện mẫu.');}
  },true);
  qa('#tab-customers button').filter(b=>b.textContent.trim()==='Quản lý cột').forEach(b=>b.onclick=fieldManager);
  function renderDistributionWeights(){
    const host=q('#dataSubViewSales');
    const role=data.user?.actualRole||data.user?.role;
    if(!host||!data||!['ADMIN','MANAGER'].includes(role))return;
    const scopedMembers=role==='MANAGER'?(data.managerHierarchy?.members||data.members||[]):(data.members||[]);
    const allMembers=role==='MANAGER'
      ? [...scopedMembers.filter(m=>m.id!==data.user.id), {...data.user,role:"MANAGER"}]
      : scopedMembers;
    const managerLeaders=role==='MANAGER'
      ? allMembers.filter(m=>m.active!==false&&m.role==='LEADER'&&m.managerId===data.user.id)
      : [];
    const managerLeaderIds=new Set(managerLeaders.map(m=>m.id));
    const members=(role==='MANAGER'
      ? allMembers.filter(m=>m.active!==false&&(
          m.id===data.user.id ||
          managerLeaderIds.has(m.id) ||
          (m.role==='SALE'&&(m.managerId===data.user.id||m.leaderId===data.user.id||managerLeaderIds.has(m.leaderId)))
        ))
      : allMembers
    ).filter(m=>m.active!==false&&['MANAGER','LEADER','SALE'].includes(m.role));
    const managers=members.filter(m=>m.role==='MANAGER').sort((a,b)=>String(a.name).localeCompare(String(b.name),'vi'));
    const leaders=members.filter(m=>m.role==='LEADER').sort((a,b)=>String(a.name).localeCompare(String(b.name),'vi'));
    const sales=members.filter(m=>m.role==='SALE').sort((a,b)=>String(a.name).localeCompare(String(b.name),'vi'));
    const byManager=id=>leaders.filter(l=>l.managerId===id);
    const byLeader=id=>sales.filter(x=>x.leaderId===id);
    const directSales=id=>sales.filter(x=>(x.managerId===id&&!leaders.some(l=>l.id===x.leaderId))||x.leaderId===id);
    const enabledLeaders=new Set(data.leaderDistribution?.enabledLeaderIds||[]);
    const initials=m=>String(m.name||'?').trim().split(/\s+/).slice(-2).map(x=>x[0]).join('').toUpperCase()||'?';
    const branchCustomerCount=(member,kind)=>{
      const ids=new Set();
      (data.customers||[]).forEach(customer=>{
        const personal=kind==='SALE'
          ? customer.saleId===member.id
          : kind==='LEADER'
            ? customer.saleId===member.id
            : customer.saleId===member.id||(customer.managerId===member.id&&!customer.leaderId);
        if(personal)ids.add(customer.id);
      });
      if(kind==='SALE')(data.offers||[]).forEach(offer=>{if(offer.status==='PENDING'&&offer.saleId===member.id)ids.add(offer.customerId);});
      return ids.size;
    };
    const weightOf=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):1;};
    const cycleDetails=new Map();
    const storedGlobalRound=data.saleDistributionByLeader?.['$']?.rounds?.[0]||data.saleDistributionByLeader?.['$']||null;
    const cycleSummary=(people,configs,key)=>{
      const config=configs?.[0]||{};
      const enabledIds=new Set(Array.isArray(config.enabledSaleIds)?config.enabledSaleIds:people.map(person=>person.id));
      const active=people.filter(person=>(person.teamLeaderRecipient?config.leaderEnabled!==false:enabledIds.has(person.id))&&weightOf(config.weights?.[person.id])>0).sort((a,b)=>a.id.localeCompare(b.id));
      const next=active.flatMap(person=>Array.from({length:weightOf(config.weights?.[person.id])},()=>person));
      // Vòng toàn hệ thống dùng cursor.global; cursor.salesByTeam chỉ dành cho vòng của từng Team.
      const raw=key==='global'
        ? data.settings?.assignmentCursor?.global
        : data.settings?.assignmentCursor?.salesByTeam?.[key];
      const savedIds=raw&&typeof raw==='object'&&Array.isArray(raw.ids)?raw.ids.map(String):[];
      const saved=savedIds.map(id=>people.find(person=>person.id===id)).filter(person=>person&&active.some(item=>item.id===person.id));
      const sequence=saved.length?saved:next;
      const activeIds=new Set(active.map(person=>person.id));
      const offerRecipientByCustomer=new Map();
      (data.offers||[]).forEach(offer=>{
        if(offer.customerId&&offer.saleId&&!offerRecipientByCustomer.has(offer.customerId))offerRecipientByCustomer.set(offer.customerId,offer.saleId);
      });
      const recipientOf=item=>item.offeredSaleId||offerRecipientByCustomer.get(item.customerId)||item.toSaleId||item.toLeaderId;
      const assignments=(data.assignmentHistory||[]).filter(item=>{
        if(item.source!=='AUTO')return false;
        // Lượt chuyển tiếp từ Leader/Manager xuống Team không làm tăng lượt của vòng chung.
        if(key==='global'&&/(trong Team|tiếp cho Sale|tiep cho Sale)/i.test(String(item.reason||'')))return false;
        const recipientId=recipientOf(item);
        return activeIds.has(recipientId);
      }).sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))||String(a.id||'').localeCompare(String(b.id||'')));
      const hasCursor=raw&&typeof raw==='object'&&Number.isInteger(raw.index);
      const cursorIndex=hasCursor?Math.max(0,raw.index):0;
      const index=sequence.length?Math.min(cursorIndex,sequence.length):0;
      const received=sequence.slice(0,index);
      const upcoming=sequence.slice(index);
      return {key,length:sequence.length,index,round:key==='global'?1:sequence.length?Math.floor(cursorIndex/sequence.length)+1:0,received,upcoming:upcoming.length?upcoming:next,completed:sequence.length>0&&index===sequence.length};
    };
    const cycleMarkup=(summary)=>{
      cycleDetails.set(summary.key,summary);
      const percent=summary.length?summary.index/summary.length*100:0;
      return '<div class="distribution-cycle"><div class="distribution-cycle-ring" style="--cycle-progress:'+percent+'%" role="img" aria-label="\u0110\u00e3 ph\u00e2n '+summary.index+' trên '+summary.length+' l\u01b0\u1ee3t"><span><b>'+summary.index+'/'+summary.length+'</b><small>l\u01b0\u1ee3t</small></span></div><div class="distribution-cycle-info"><b>V\u00f2ng '+summary.round+'</b><small>'+(summary.completed?'\u0110\u00e3 h\u1ebft v\u00f2ng · l\u01b0\u1ee3t ti\u1ebfp theo b\u1eaft \u0111\u1ea7u v\u00f2ng m\u1edbi':summary.length?'\u0110\u00e3 ph\u00e2n '+summary.index+' l\u01b0\u1ee3t trong v\u00f2ng':'Ch\u01b0a c\u00f3 ng\u01b0\u1eddi nh\u1eadn')+'</small><button type="button" class="distribution-cycle-detail" data-cycle-detail="'+esc(summary.key)+'">Chi ti\u1ebft \u2192</button></div></div>';
    };
    if(!q('#distributionSkipSlotStyles')){const style=document.createElement('style');style.id='distributionSkipSlotStyles';style.textContent='.distribution-skip-slot{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;margin-left:4px;border:1px solid #fecaca;border-radius:8px;background:#fff;color:#dc2626;font-size:20px;line-height:1;cursor:pointer}.distribution-skip-slot:hover{background:#fef2f2;border-color:#ef4444}.distribution-skip-slot:focus-visible{outline:2px solid #dc2626;outline-offset:2px}.distribution-skip-slot:disabled{opacity:.5;cursor:wait}';document.head.appendChild(style);}
    const showCycleDetails=(key,trigger)=>{
      const summary=cycleDetails.get(key);if(!summary)return;
      q('#distributionCycleModal')?.remove();
      const modal=document.createElement('div');modal.id='distributionCycleModal';modal.className='modal-overlay open';modal.style.zIndex='11000';
      const list=(people,received)=>people.length?'<ol class="distribution-cycle-list">'+people.map((person,i)=>'<li><span class="distribution-cycle-position">'+(i+1)+'</span><div><b>'+esc(person.name||person.id)+'</b><small>'+esc(person.managerRecipient?'MANAGER':person.teamLeaderRecipient?'LEADER':person.role||'SALE')+'</small></div><span class="distribution-cycle-status '+(received?'is-done':'')+'">'+(received?'\u0110\u00e3 ph\u00e2n':i===0?'Ti\u1ebfp theo':'Ch\u1edd l\u01b0\u1ee3t')+'</span>'+(!received&&role==='ADMIN'&&summary.token?'<button type="button" class="distribution-skip-slot" data-skip-slot="'+person.position+'" aria-label="Bỏ lượt của '+esc(person.name||person.id)+'" title="Bỏ riêng lượt này">×</button><button type="button" class="btn-action btn-secondary" data-remove-round-member="'+esc(person.id)+'">Loại khỏi vòng</button>':'')+'</li>').join('')+'</ol>':'<p class="distribution-cycle-empty">'+(received?'Ch\u01b0a c\u00f3 l\u01b0\u1ee3t ph\u00e2n trong v\u00f2ng n\u00e0y.':'Ch\u01b0a c\u00f3 ng\u01b0\u1eddi \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n nh\u1eadn data.')+'</p>';
      modal.innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="distributionCycleTitle" style="width:min(860px,calc(100vw - 24px));max-height:90dvh;overflow:auto"><div class="modal-header"><h3 id="distributionCycleTitle">Chi ti\u1ebft v\u00f2ng ph\u00e2n data · '+summary.index+'/'+summary.length+'</h3><button type="button" class="modal-close-btn" aria-label="\u0110\u00f3ng">×</button></div><div class="modal-body"><p class="distribution-cycle-note">M\u1ed7i d\u00f2ng l\u00e0 m\u1ed9t l\u01b0\u1ee3t theo t\u1ef7 tr\u1ecdng. \u0110\u00e3 ph\u00e2n l\u00e0 \u0111\u00e3 giao data, g\u1ed3m c\u1ea3 data \u0111ang ch\u1edd nh\u00e2n s\u1ef1 b\u1ea5m nh\u1eadn.</p><div class="distribution-cycle-columns"><section><h4>\u0110\u00e3 ph\u00e2n trong v\u00f2ng n\u00e0y <span>'+summary.received.length+'</span></h4>'+list(summary.received,true)+'</section><section><h4>'+ (summary.completed?'Đã hết lượt trong vòng này':'Thứ tự chuẩn bị nhận')+'</h4>'+list(summary.upcoming,false)+'</section></div></div></div>';
      const close=()=>{modal.remove();trigger?.focus();};
      modal.querySelector('button').onclick=close;modal.onclick=event=>{if(event.target===modal)close();};
      const hint=document.createElement('p');hint.className='distribution-cycle-note';hint.textContent='Dấu × chỉ bỏ một lượt chưa phân trong vòng này, không thu hồi data đã giao và không tắt nhận data ở những vòng sau.';modal.querySelector('.distribution-cycle-note').after(hint);
      if(role==='ADMIN'&&key==='global'&&summary.token&&summary.extraTurnPeople?.length){
        const control=document.createElement('div');control.style.cssText='display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:0 0 18px;padding:12px;border:1px solid #dbeafe;border-radius:8px;background:#f8fbff';
        control.innerHTML='<label style="display:grid;gap:5px;min-width:220px;flex:1;color:#334155;font-size:12px;font-weight:700">Thêm 1 lượt cho<select data-extra-turn-member style="height:36px;padding:0 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font:inherit">'+summary.extraTurnPeople.map(member=>'<option value="'+esc(member.id)+'">'+esc(member.name||member.id)+' · '+esc(member.actualRole||member.role||'SALE')+'</option>').join('')+'</select></label><button type="button" class="btn-action btn-primary" data-add-extra-turn>Thêm lượt vào cuối vòng</button>';
        modal.querySelector('.distribution-cycle-columns').before(control);
        control.querySelector('[data-add-extra-turn]').onclick=async()=>{
          if(working)return;
          const memberId=control.querySelector('[data-extra-turn-member]').value;
          const member=summary.extraTurnPeople.find(person=>person.id===memberId);if(!member)return;
          const button=control.querySelector('[data-add-extra-turn]');button.disabled=true;
          const result=await run(()=>api.distributionRoundAddExtraTurn({roundId:summary.roundId,token:summary.token,memberId}),()=>referenceNotice('Đã thêm 1 lượt vào cuối Vòng 1.'));
          if(result){close();refresh(true);const detail=Array.from(host.querySelectorAll('[data-cycle-detail]')).find(item=>item.dataset.cycleDetail===key);detail?.click();} else button.disabled=false;
        };
      }
      modal.querySelectorAll('[data-skip-slot]').forEach(button=>button.onclick=async()=>{
        if(working)return;
        const position=Number(button.dataset.skipSlot),person=summary.upcoming.find(p=>p.position===position);
        if(!person||!window.confirm('Bỏ lượt này của '+person.name+'? Những lượt khác và data đã giao được giữ nguyên.'))return;
        modal.querySelectorAll('[data-skip-slot]').forEach(b=>b.disabled=true);
        button.textContent='…';
        const result=await run(()=>api.distributionRoundSkip({roundId:summary.roundId,token:summary.token,position,memberId:person.id}),()=>referenceNotice('Đã bỏ lượt, thứ tự chờ đã cập nhật.'));
        if(result){close();refresh(true);const detail=Array.from(host.querySelectorAll('[data-cycle-detail]')).find(b=>b.dataset.cycleDetail===key);detail?.click();}
        else {button.textContent='×';modal.querySelectorAll('[data-skip-slot]').forEach(b=>b.disabled=false);}
      });
      modal.querySelectorAll('[data-remove-round-member]').forEach(button=>button.onclick=async()=>{
        if(working)return;
        const person=summary.upcoming.find(p=>p.id===button.dataset.removeRoundMember);
        if(!person||!window.confirm('Loại '+person.name+' khỏi vòng này và các chu kỳ sau? Data đã giao sẽ được giữ nguyên.'))return;
        modal.querySelectorAll('[data-remove-round-member],[data-skip-slot]').forEach(b=>b.disabled=true);
        const result=await run(()=>api.distributionRoundRemoveMember({roundId:summary.roundId,token:summary.token,memberId:person.id}),()=>referenceNotice('Đã loại thành viên khỏi vòng. Data đã giao được giữ nguyên.'));
        if(result){close();refresh(true);const detail=Array.from(host.querySelectorAll('[data-cycle-detail]')).find(b=>b.dataset.cycleDetail===key);detail?.click();}
        else modal.querySelectorAll('[data-remove-round-member],[data-skip-slot]').forEach(b=>b.disabled=false);
      });
      modal.onkeydown=event=>{
        if(event.key==='Escape')close();
        if(event.key==='Tab'){const buttons=Array.from(modal.querySelectorAll('button:not(:disabled),select:not(:disabled)'));const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      };
      document.body.appendChild(modal);modal.querySelector('button').focus();
    };
    const row=(member,kind,level)=>{
      const isManager=kind==='MANAGER',isLeader=kind==='LEADER';
      const managerLeaders=isManager?byManager(member.id):[];
      const configIds=isManager
        ? (managerLeaders.length?managerLeaders.map(leader=>leader.id):['manager:'+member.id])
        : [isLeader?member.id:(leaders.some(l=>l.id===member.leaderId)?member.leaderId:'manager:'+(member.managerId||member.leaderId))];
      const configs=configIds.map(id=>data.saleDistributionByLeader?.[id]||{});
      const config=configs[0]||{};
      const weight=storedGlobalRound?.weights?.[member.id]===undefined?(isLeader?weightOf(data.leaderDistribution?.weights?.[member.id]):weightOf(config?.weights?.[member.id])):weightOf(storedGlobalRound.weights[member.id]);
      const enabled=isLeader
        ? (storedGlobalRound?.enabledSaleIds?storedGlobalRound.enabledSaleIds.includes(member.id):enabledLeaders.has(member.id)) && configs.every(item=>item.leaderEnabled!==false)
        : isManager
          ? (storedGlobalRound?.enabledSaleIds?storedGlobalRound.enabledSaleIds.includes(member.id):configs.every(item=>item.managerDistributionInitialized!==true||!Array.isArray(item.enabledSaleIds)||item.enabledSaleIds.includes(member.id)))
          : (storedGlobalRound?.enabledSaleIds?storedGlobalRound.enabledSaleIds.includes(member.id):(config.managerDistributionInitialized!==true||!Array.isArray(config.enabledSaleIds)||config.enabledSaleIds.includes(member.id)));
      const load=branchCustomerCount(member,kind);
      const canEdit=role==='ADMIN'||(role==='MANAGER'&&(
        (kind==='MANAGER'&&member.id===data.user.id) ||
        (kind==='LEADER'&&member.managerId===data.user.id) ||
        (kind==='SALE'&&(member.managerId===data.user.id||member.leaderId===data.user.id||managerLeaderIds.has(member.leaderId)))
      ));
      const controls=canEdit
        ? '<label>Ty trong <input type="number" min="0" max="100" value="'+weight+'" data-ref-distribution-weight="'+kind+':'+esc(member.id)+'"></label><label class="distribution-check"><input type="checkbox" '+(enabled?'checked':'')+' data-ref-distribution-member="'+kind+':'+esc(member.id)+'"><span>'+(enabled?'Dang nhan':'Tam tat')+'</span></label>'
        : '<span class="distribution-readonly">Chi xem</span>';
      return '<div class="distribution-person-row level-'+level+'"><div class="distribution-person-main"><span class="distribution-avatar">'+esc(initials(member))+'</span><span><b>'+esc(member.name||'Chua dat ten')+'</b><small>'+esc(kind)+' · '+esc(member.teamId||'Chua gan Team')+' · '+load+' khach</small></span></div><div class="distribution-person-controls">'+controls+'</div></div>';
    };
    // One shared cycle for the complete agency.
    let globalCycleSummary=null;
    const globalCycle=()=>{
      const views=data.distributionRoundViews||[];
      return '<div class="distribution-cycle-stack">'+views.map((view,i)=>{
        const people=view.ids.map((id,position)=>({...members.find(p=>p.id===id),id,position,name:members.find(p=>p.id===id)?.name||'Nhân sự không còn hoạt động'}));
        const summary={...view,key:i===0?'global':'global-round-'+view.roundId,length:people.length,round:i+1,received:people.slice(0,view.index),upcoming:people.slice(view.index),completed:people.length>0&&view.index===people.length,extraTurnPeople:i===0?(data.distributionExtraTurnPeople||[]):[]};
        if(i===0)globalCycleSummary=summary;
        return cycleMarkup(summary);
      }).join('')+'</div>';
    };
    const block=(title,sub,html,cycle='')=>'<section class="distribution-tree-block"><div class="distribution-tree-head"><div class="distribution-tree-title"><b>'+esc(title)+'</b><small>'+esc(sub)+'</small></div>'+(cycle?'<div class="distribution-tree-cycle">'+cycle+'</div>':'')+'</div>'+html+'</section>';
    let blocks=managers.map(manager=>block(manager.name||'Manager', 'MANAGER - '+(manager.teamId||'Quan ly tuyen'), row(manager,'MANAGER',0)+directSales(manager.id).map(sale=>row(sale,'SALE',1)).join('')+byManager(manager.id).map(leader=>row(leader,'LEADER',1)+byLeader(leader.id).map(sale=>row(sale,'SALE',2)).join('')).join(''),'')).join('');
    const unassignedLeaders=leaders.filter(l=>!l.managerId);
    if(unassignedLeaders.length)blocks+=block('Chua gan Manager','Leader chua duoc gan tuyen',unassignedLeaders.map(leader=>row(leader,'LEADER',1)+byLeader(leader.id).map(sale=>row(sale,'SALE',2)).join('')).join(''),'');
    const unassignedSales=sales.filter(sale=>!leaders.some(l=>l.id===sale.leaderId)&&!managers.some(m=>directSales(m.id).some(s=>s.id===sale.id)));
    if(unassignedSales.length)blocks+=block('Chua gan Leader','Sale chua duoc gan Leader',unassignedSales.map(sale=>row(sale,'SALE',2)).join(''));
    if(!q('#referenceDistributionStyles')){const style=document.createElement('style');style.id='referenceDistributionStyles';style.textContent='.distribution-global-cycle{margin:0 0 12px;padding:12px 14px;border:1px solid #bfdbfe;border-radius:10px;background:#f8fbff}.distribution-global-cycle-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}.distribution-global-cycle-title b{font-size:13px;color:#1e3a8a}.distribution-global-cycle-title small{font-size:10.5px;color:#64748b}.distribution-global-cycle .distribution-cycle{min-width:0}.distribution-global-cycle .distribution-cycle-info{flex:1}.distribution-global-cycle .distribution-cycle-info>small{white-space:normal}.distribution-global-cycle .distribution-cycle-ring{width:54px;height:54px;flex-basis:54px}.distribution-tree-list{display:grid;gap:10px}.distribution-tree-block{border:1px solid var(--border-light);border-radius:10px;overflow:hidden;background:var(--bg-surface)}.distribution-tree-head{display:flex;justify-content:space-between;gap:16px;align-items:stretch;padding:12px 16px;background:var(--bg-subtle);border-bottom:1px solid var(--border-light)}.distribution-tree-title{display:grid;align-content:center;gap:4px;min-width:180px}.distribution-tree-cycle{min-width:280px;max-width:52%;padding-left:14px;border-left:1px solid var(--border-light)}.distribution-cycle-stack{display:grid;gap:8px;max-height:180px;overflow:auto}.distribution-cycle-label{color:#475569;font-size:10px;font-weight:800}.distribution-cycle{display:flex;align-items:center;gap:10px;min-width:270px}.distribution-cycle-ring{--cycle-progress:0%;width:58px;height:58px;flex:0 0 58px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#2563eb var(--cycle-progress),#dbeafe 0);position:relative}.distribution-cycle-ring:after{content:"";position:absolute;inset:6px;border-radius:50%;background:var(--bg-subtle)}.distribution-cycle-ring span{position:relative;z-index:1;display:grid;text-align:center;line-height:1.05}.distribution-cycle-ring b{font-size:12px;color:#1d4ed8}.distribution-cycle-ring small{font-size:9px;color:var(--text-muted)}.distribution-cycle-info{display:grid;gap:2px;min-width:0}.distribution-cycle-info>b{font-size:11px;color:#1e293b}.distribution-cycle-info>small{font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.distribution-cycle-detail{width:max-content;border:0;background:transparent;color:#2563eb;padding:0;font:inherit;font-size:10.5px;font-weight:800;cursor:pointer}.distribution-cycle-detail:hover{text-decoration:underline}.distribution-cycle-top,.distribution-cycle-track{display:none}.distribution-cycle small{display:block}.distribution-cycle.is-empty small{white-space:normal}.distribution-cycle-columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.distribution-cycle-columns section{border:1px solid var(--border-light);border-radius:10px;overflow:hidden;background:var(--bg-subtle)}.distribution-cycle-columns h4{display:flex;justify-content:space-between;gap:8px;padding:12px 14px;font-size:12px;color:var(--text-main);border-bottom:1px solid var(--border-light)}.distribution-cycle-columns h4 span{color:#2563eb}.distribution-cycle-list{list-style:none;display:grid;gap:0;margin:0;padding:0}.distribution-cycle-list li{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-surface);border-bottom:1px solid var(--border-light)}.distribution-cycle-list li:last-child{border-bottom:0}.distribution-cycle-position{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#eff6ff;color:#2563eb;font-size:10px;font-weight:800;flex:0 0 auto}.distribution-cycle-list li>div{display:grid;gap:2px;min-width:0;flex:1}.distribution-cycle-list li b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.distribution-cycle-list li small{font-size:10px;color:var(--text-muted)}.distribution-cycle-status{font-size:10px;font-weight:800;color:#2563eb;white-space:nowrap}.distribution-cycle-status.is-done{color:#15803d}.distribution-cycle-empty,.distribution-cycle-note{margin:0;padding:14px;color:var(--text-muted);font-size:12px}.distribution-cycle-note{padding:0 0 14px}.distribution-tree-head b{font-size:14px}.distribution-tree-head small{color:var(--text-muted);font-size:11px}.distribution-tree-head b{font-size:14px}.distribution-tree-head small{color:var(--text-muted);font-size:11px}.distribution-person-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--border-light);flex-wrap:wrap}.distribution-person-row:last-child{border-bottom:0}.distribution-person-row.level-1{padding-left:30px}.distribution-person-row.level-2{padding-left:58px;background:#fcfdff}.distribution-person-main{display:flex;align-items:center;gap:10px;min-width:230px}.distribution-person-main>span:last-child{display:grid;gap:3px}.distribution-person-main small{color:var(--text-muted);font-size:10.5px}.distribution-avatar{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:800;flex:0 0 auto}.distribution-person-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.distribution-person-controls label{display:flex;align-items:center;gap:7px;color:var(--text-muted);font-size:11.5px}.distribution-person-controls input[type=number]{width:64px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-subtle);font:inherit;text-align:center;color:var(--text-main)}.distribution-check{color:var(--text-main)!important;font-weight:600;cursor:pointer}.distribution-check input{accent-color:#2563eb}.distribution-readonly{font-size:11px;color:var(--text-muted);font-style:italic}@media(max-width:700px){.distribution-tree-head{display:grid}.distribution-tree-cycle{max-width:none;min-width:0;padding:10px 0 0;border-left:0;border-top:1px solid var(--border-light)}.distribution-cycle{min-width:0}.distribution-cycle-columns{grid-template-columns:1fr}.distribution-cycle-info>small{max-width:180px}.distribution-person-row.level-1,.distribution-person-row.level-2{padding-left:16px}.distribution-person-controls{width:100%;padding-left:44px;justify-content:flex-start}}';document.head.appendChild(style)}
    host.innerHTML='<section class="panel" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:22px;box-shadow:var(--shadow-sm)"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;flex-wrap:wrap"><b style="font-size:15px;color:var(--text-main);display:block">Chỉnh sửa tỷ trọng</b><span class="chip">'+members.length+' nhân sự</span></div><div class="distribution-global-cycle"><div class="distribution-global-cycle-title"><b>Vòng phân data toàn hệ thống</b></div>'+globalCycle()+'</div><div class="distribution-tree-list">'+(blocks||'<div class="empty"><b>Chưa có Manager, Leader hoặc Sale</b><span>Hãy phân bổ nhân sự tại mục Đội ngũ.</span></div>')+'</div></section>';
    if(!q('#referenceDistributionRoundStyles')){const style=document.createElement('style');style.id='referenceDistributionRoundStyles';style.textContent='.distribution-cycle-stack{display:grid;gap:10px;max-height:none;overflow:visible}.distribution-cycle-next{padding-top:8px;border-top:1px solid #dbeafe}';document.head.appendChild(style);}
    if(!q('#referenceDistributionRoundEditorStyles')){const style=document.createElement('style');style.id='referenceDistributionRoundEditorStyles';style.textContent='.distribution-round-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--border-light);border-radius:8px;background:var(--bg-subtle)}.distribution-round-row>div:first-child{display:grid;gap:3px;min-width:0}.distribution-round-row small{color:var(--text-muted);font-size:10.5px}.distribution-round-actions{display:flex;gap:7px;flex-wrap:wrap}.distribution-round-modal{z-index:12000}.distribution-round-modal .modal-card{width:min(620px,calc(100vw - 24px));max-height:88dvh;display:flex;flex-direction:column;overflow:hidden;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 60px rgba(15,23,42,.22)}.distribution-round-modal header,.distribution-round-modal footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}.distribution-round-modal header{border-bottom:1px solid var(--border-light)}.distribution-round-modal header h2{margin:0;font-size:15px}.distribution-round-modal header p{margin:4px 0 0;color:var(--text-muted);font-size:11px}.distribution-round-modal header button{border:0;background:transparent;color:var(--text-muted);font-size:21px}.distribution-round-edit-help{margin:12px 16px 8px;padding:10px 12px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1e40af;font-size:11px;line-height:1.45}.distribution-round-edit-list{padding:0 16px 12px;overflow:auto}.distribution-round-edit-member{display:grid;grid-template-columns:18px minmax(0,1fr) 78px;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--border-light);cursor:pointer}.distribution-round-edit-member>input{width:16px;height:16px;accent-color:#2563eb}.distribution-round-edit-member>span:nth-child(2){display:grid;gap:2px;min-width:0}.distribution-round-edit-member b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}.distribution-round-edit-member small{color:var(--text-muted);font-size:10px}.distribution-round-weight{display:grid;grid-template-columns:1fr 42px;align-items:center;gap:5px}.distribution-round-weight input{width:42px;min-height:32px;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);text-align:center;font:700 11px var(--font-sans,Arial,sans-serif)}.distribution-round-modal footer{justify-content:flex-end;border-top:1px solid var(--border-light)}@media(max-width:600px){.distribution-round-row{align-items:flex-start;flex-direction:column}.distribution-round-actions{width:100%}.distribution-round-actions button{flex:1}.distribution-round-modal .modal-card{max-height:92dvh}}';document.head.appendChild(style);}
    const globalRounds=data.saleDistributionByLeader?.['$']?.rounds||[];
    const roundFooter=document.createElement('div');
    roundFooter.className='distribution-round-footer';
    roundFooter.style.cssText='margin-top:18px;padding-top:16px;border-top:1px solid var(--border-light);display:grid;gap:12px';
    const queued=globalRounds.slice(1);
    roundFooter.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><b style="font-size:13px;color:var(--text-main)">Các vòng chia data</b><small style="display:block;margin-top:4px;color:var(--text-muted)">Tỷ trọng là số lượt nhận trong một chu kỳ: 2 = hai lượt, 0 = không tham gia. Xóa Vòng 1 sẽ đưa vòng kế tiếp lên chạy; vòng duy nhất sẽ tự lặp đến khi tạo thêm vòng.</small></div><button type="button" class="btn-action btn-primary" data-save-distribution-round>Lưu cấu hình hiện tại · tạo vòng kế tiếp</button></div><div data-distribution-round-list style="display:grid;gap:7px"></div>';
    const roundList=roundFooter.querySelector('[data-distribution-round-list]');
    const currentRound=globalRounds[0]||{};
    if(roundList){
      const currentStats=globalCycleSummary||{index:0,length:0};const currentLabel='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800"><span>Vòng 1 · đang chạy <small style="display:block;margin-top:3px;color:#2563eb;font-weight:700">'+currentStats.index+'/'+currentStats.length+' lượt</small></span><span style="display:flex;align-items:center;gap:8px">'+((currentRound.id||'ROUND-1'))+(queued.length?'<button type="button" class="btn-action btn-secondary" data-delete-distribution-round="'+esc(currentRound.id||'ROUND-1')+'">Xóa vòng 1</button>':'')+'</span></div>';
      roundList.innerHTML=currentLabel+queued.map((round,index)=>{const enabled=new Set(Array.isArray(round.enabledSaleIds)?round.enabledSaleIds:[]);const total=(data.distributionRoundViews||[]).find(view=>view.roundId===round.id)?.ids.length??[...enabled].reduce((sum,id)=>sum+weightOf(round.weights?.[id]),0);const eligible=[...enabled].filter(id=>weightOf(round.weights?.[id])>0).length;return '<div class="distribution-round-row"><div><b>Vòng '+(index+2)+' · kế tiếp</b><small>'+eligible+' người tham gia · '+total+' lượt mỗi chu kỳ</small><small>Được kích hoạt tự động sau khi vòng trước hoàn tất.</small></div><div class="distribution-round-actions"><button type="button" class="btn-action btn-secondary" data-edit-distribution-round="'+esc(round.id)+'">Sửa thành viên</button><button type="button" class="btn-action btn-secondary" data-delete-distribution-round="'+esc(round.id)+'" aria-label="Xóa vòng '+(index+2)+'">Xóa vòng</button></div></div>';}).join('');
    }
    host.firstElementChild?.appendChild(roundFooter);
    host.querySelectorAll('[data-cycle-detail]').forEach(button=>button.onclick=()=>showCycleDetails(button.dataset.cycleDetail,button));
    host.querySelectorAll('[data-ref-distribution-weight]').forEach(input=>input.onchange=()=>{
      const [kind,id]=String(input.dataset.refDistributionWeight||'').split(':');
      if(!kind||!id)return;
      run(()=>api.distributionWeight(kind,id,input.value),()=>referenceNotice('Da luu ty trong.'));
    });
    host.querySelectorAll('[data-ref-distribution-member]').forEach(input=>input.onchange=()=>{
      const [kind,id]=String(input.dataset.refDistributionMember||'').split(':');
      if(!kind||!id)return;
      const label=input.closest('label')?.querySelector('span');
      const previous=!input.checked;
      if(label)label.textContent=input.checked?'Dang nhan':'Tam tat';
      run(()=>api.distributionMember(kind,id,input.checked),()=>referenceNotice(input.checked?'Da bat nhan data.':'Da tam tat nhan data.'));
    });
    roundFooter.querySelector('[data-save-distribution-round]')?.addEventListener('click',()=>{
      const weights={},enabledIds=[];
      host.querySelectorAll('[data-ref-distribution-weight]').forEach(input=>{const [,id]=input.dataset.refDistributionWeight.split(':');weights[id]=input.value;});
      host.querySelectorAll('[data-ref-distribution-member]:checked').forEach(input=>{const [,id]=input.dataset.refDistributionMember.split(':');enabledIds.push(id);});
      run(()=>api.distributionRoundSave({weights,enabledIds}),()=>referenceNotice('Đã lưu tỷ trọng và tạo vòng mới.'));
    });
    roundFooter.querySelectorAll('[data-edit-distribution-round]').forEach(button=>button.onclick=()=>{
      const round=globalRounds.find(item=>item.id===button.dataset.editDistributionRound);if(!round)return;
      const enabled=new Set(Array.isArray(round.enabledSaleIds)?round.enabledSaleIds:[]);
      const sorted=[...members].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'vi'));
      const modal=document.createElement('div');modal.className='modal-overlay open distribution-round-modal';
      modal.innerHTML='<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="distributionRoundEditTitle"><header><div><h2 id="distributionRoundEditTitle">Chỉnh thành viên · Vòng '+(queued.indexOf(round)+2)+'</h2><p>Bật người được nhận data và đặt số lượt của từng người trong một chu kỳ.</p></div><button type="button" data-round-close aria-label="Đóng">×</button></header><div class="distribution-round-edit-help">Ví dụ: tỷ trọng 2 nghĩa là người này xuất hiện 2 lần trong thứ tự chia. Đặt 0 hoặc bỏ chọn để loại khỏi vòng.</div><div class="distribution-round-edit-list">'+sorted.map(member=>'<div class="distribution-round-edit-member"><input type="checkbox" data-round-member="'+esc(member.id)+'" aria-label="Cho '+esc(member.name||member.id)+' nhận trong vòng này" '+(enabled.has(member.id)?'checked':'')+'><span><b>'+esc(member.name||member.id)+'</b><small>'+esc(member.role)+' · '+esc(member.teamId||'Chưa gán Team')+'</small></span><span class="distribution-round-weight"><small>Lượt</small><input type="number" min="0" max="100" value="'+weightOf(round.weights?.[member.id])+'" data-round-weight="'+esc(member.id)+'" aria-label="Số lượt của '+esc(member.name||member.id)+'"></span></div>').join('')+'</div><footer><button type="button" class="btn-action btn-secondary" data-round-close>Hủy</button><button type="button" class="btn-action btn-primary" data-round-save>Lưu vòng</button></footer></section>';
      const close=()=>modal.remove();modal.querySelectorAll('[data-round-close]').forEach(node=>node.onclick=close);modal.onclick=event=>{if(event.target===modal)close();};
      modal.querySelector('[data-round-save]').onclick=()=>{const enabledIds=[];const weights={};modal.querySelectorAll('[data-round-weight]').forEach(input=>{weights[input.dataset.roundWeight]=input.value;});modal.querySelectorAll('[data-round-member]:checked').forEach(input=>enabledIds.push(input.dataset.roundMember));if(!enabledIds.some(id=>Number(weights[id])>0)){window.alert('Chọn ít nhất một thành viên có số lượt lớn hơn 0.');return;}close();run(()=>api.distributionRoundSave({roundId:round.id,enabledIds,weights}),()=>referenceNotice('Đã cập nhật thành viên và tỷ trọng của vòng chờ.'));};
      document.body.appendChild(modal);modal.querySelector('[data-round-close]').focus();
    });
    roundFooter.querySelectorAll('[data-delete-distribution-round]').forEach(button=>button.onclick=()=>{const active=button.dataset.deleteDistributionRound===currentRound.id;const message=active?'Xóa Vòng 1 và đưa vòng kế tiếp lên Vòng 1? Data đã phân sẽ không bị thu hồi.':'Xóa vòng chờ này? Vòng đang chạy và data đã phân sẽ không bị thay đổi.';if(window.confirm(message))run(()=>api.distributionRoundDelete(button.dataset.deleteDistributionRound),()=>referenceNotice(active?'Đã xóa Vòng 1; vòng kế tiếp đã được đưa lên chạy.':'Đã xóa vòng chờ.'));});
  }
  function mountManagementDataShell(role){
    const tab=q('#tab-data');
    if(!tab)return;
    const management=['ADMIN','MANAGER','LEADER'].includes(role);
    let header=q('#dataManagementHeader');
    if(!management){header?.setAttribute('hidden','');return;}
    if(!q('#dataManagementShellStyles')){
      const style=document.createElement('style');style.id='dataManagementShellStyles';style.textContent='#tab-data.data-scope-management>.headline-row,#tab-data.data-scope-management>.sub-tabs-bar{display:none!important}#tab-data.data-scope-management .data-management-header{display:grid;gap:16px;margin:0 0 18px;padding:2px 0 0}#tab-data.data-scope-management .data-management-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}#tab-data.data-scope-management .data-management-title h1{margin:0;color:#0f172a;font-size:23px;line-height:1.2}#tab-data.data-scope-management .data-management-title p{margin:6px 0 0;color:#64748b;font-size:12px}#tab-data.data-scope-management .data-management-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}#tab-data.data-scope-management .data-management-count,#tab-data.data-scope-management .data-management-date-state{padding:8px 10px;border:1px solid #dbe3ec;border-radius:7px;background:#fff;color:#475569;font-size:11px;font-weight:800;white-space:nowrap}#tab-data.data-scope-management .data-management-date-state.is-applied{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8}#tab-data.data-scope-management .data-management-filter-button{min-height:36px;padding:8px 12px;border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;font:800 12px var(--font-sans,Arial,sans-serif);cursor:pointer}#tab-data.data-scope-management .data-management-filter-button:hover{background:#1d4ed8}#tab-data.data-scope-management .data-management-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}#tab-data.data-scope-management .data-management-stat{padding:12px 14px;border:1px solid #dbe3ec;border-radius:8px;background:#fff;display:grid;gap:4px}#tab-data.data-scope-management .data-management-stat span{color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase}#tab-data.data-scope-management .data-management-stat b{color:#0f172a;font-size:20px;line-height:1;font-variant-numeric:tabular-nums}#tab-data.data-scope-management .data-management-stat.waiting b{color:#b45309}#tab-data.data-scope-management .data-management-stat.accepted b{color:#15803d}#tab-data.data-scope-management .data-management-stat.unassigned b{color:#64748b}#tab-data.data-scope-management #dataSubViewQueue{display:block!important;width:100%!important;min-width:0!important}#tab-data.data-scope-management #dataSubViewQueue>:not(.table-container):not(#dataDateFilterPanel){display:none!important}#tab-data.data-scope-management #dataDateFilterPanel{display:none!important;position:fixed;z-index:10050;top:88px;right:28px;width:min(440px,calc(100vw - 28px));max-height:calc(100dvh - 112px);overflow:auto}#tab-data.data-scope-management #dataDateFilterPanel.is-open{display:block!important}@media(max-width:860px){#tab-data.data-scope-management .data-management-top{align-items:flex-start;flex-direction:column}#tab-data.data-scope-management .data-management-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#tab-data.data-scope-management #dataDateFilterPanel{top:70px;right:14px;width:calc(100vw - 28px)}}';document.head.appendChild(style);
    }
    if(!q('#dataManagementStatsStyles')){
      const style=document.createElement('style');style.id='dataManagementStatsStyles';style.textContent='#tab-data.data-scope-management .data-management-header{display:block!important;margin-bottom:18px!important}#tab-data.data-scope-management .data-management-top{display:block!important}#tab-data.data-scope-management .data-management-actions,#tab-data.data-scope-management .data-management-stats{display:none!important}#tab-data.data-scope-management #dataSubViewQueue{display:grid!important;grid-template-columns:minmax(0,1fr) 360px!important;gap:18px!important;align-items:start!important}#tab-data.data-scope-management #dataSubViewQueue>.table-container{grid-column:1;grid-row:1;min-width:0}#tab-data.data-scope-management #dataSubViewQueue>:not(.table-container):not(#dataDateFilterPanel):not(#dataManagementStatsPanel){display:none!important}#tab-data.data-scope-management #dataManagementStatsPanel{display:block!important;visibility:visible!important;grid-column:2;grid-row:1;align-self:start;border:1px solid #dbe3ec;border-radius:16px;background:#fff;padding:20px;box-shadow:0 10px 24px rgba(15,23,42,.05)}#tab-data.data-scope-management .data-period-title{margin:0 0 12px;color:#0f172a;font-size:14px;font-weight:800}#tab-data.data-scope-management .data-period-list{display:grid;gap:12px}#tab-data.data-scope-management .data-period-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:0 16px;border-left:3px solid #2563eb;border-radius:10px;background:#f1f5f9;color:#0f172a;font-size:12px;font-weight:800}#tab-data.data-scope-management .data-period-row b{font:800 17px var(--font-mono,monospace);color:#2563eb;white-space:nowrap}#tab-data.data-scope-management .data-period-row.days3{border-left-color:#059669}.data-period-row.days3 b{color:#059669!important}#tab-data.data-scope-management .data-period-row.days7{border-left-color:#7c3aed}.data-period-row.days7 b{color:#7c3aed!important}#tab-data.data-scope-management .data-period-row.days30{border-left-color:#ea580c}.data-period-row.days30 b{color:#ea580c!important}#tab-data.data-scope-management .data-date-trigger{display:none!important}#tab-data.data-scope-management #dataDateFilterPanel{display:block!important;position:static!important;z-index:auto!important;width:100%!important;max-height:none!important;margin-top:16px;transform:none!important;overflow:hidden!important;box-shadow:0 10px 24px rgba(15,23,42,.08)!important}#tab-data.data-scope-management #dataDateFilterPanel.is-collapsed{display:block!important}#dataDateFilterBackdrop{display:none!important}#dataDateFilterBackdrop[hidden]{display:none!important}@media(max-width:1120px){#tab-data.data-scope-management #dataSubViewQueue{grid-template-columns:1fr!important}#tab-data.data-scope-management #dataManagementStatsPanel{grid-column:1;grid-row:2;max-width:none}}';document.head.appendChild(style);
    }
    if(!q('#dataManagementTargetLayout')){
      const style=document.createElement('style');style.id='dataManagementTargetLayout';style.textContent='#tab-data.data-scope-management>.headline-row,#tab-data.data-scope-management>.sub-tabs-bar{display:block!important}#tab-data.data-scope-management>.headline-row{margin-bottom:14px!important}#tab-data.data-scope-management #dataManagementHeader{display:none!important}#tab-data.data-scope-management #dataManagementOverview{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}#tab-data.data-scope-management .data-overview-card{min-height:76px;padding:12px 14px;border:1px solid #dbe3ec;border-radius:9px;background:#fff;display:grid;align-content:center;gap:6px;box-shadow:0 2px 8px rgba(15,23,42,.035)}#tab-data.data-scope-management .data-overview-card span{color:#64748b;font-size:10px;font-weight:800;text-transform:uppercase}#tab-data.data-scope-management .data-overview-card b{color:#0f172a;font-size:21px;line-height:1;font-variant-numeric:tabular-nums}#tab-data.data-scope-management .data-overview-card.pending b{color:#b45309}#tab-data.data-scope-management .data-overview-card.accepted b{color:#15803d}#tab-data.data-scope-management .data-overview-card.unassigned b{color:#64748b}#tab-data.data-scope-management #dataManagementDateTrigger{display:block;width:100%;margin-top:12px}#tab-data.data-scope-management #dataQueueFilters #dataManagementDateTrigger{display:none!important}@media(max-width:760px){#tab-data.data-scope-management #dataManagementOverview{grid-template-columns:repeat(2,minmax(0,1fr))}}';document.head.appendChild(style);
    }
    if(!q('#dataManagementOverviewStyles')){
      const style=document.createElement('style');style.id='dataManagementOverviewStyles';style.textContent='#tab-data.data-scope-management #dataManagementOverview{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 18px}#tab-data.data-scope-management .data-overview-card{position:relative;isolation:isolate;min-height:104px;padding:17px 18px 15px;border:1px solid #dbe3ec;border-radius:14px;background:linear-gradient(135deg,#fff 0%,#f8fbff 100%);display:grid;grid-template-columns:38px minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:12px;align-items:center;overflow:hidden;box-shadow:0 5px 16px rgba(15,23,42,.055);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}#tab-data.data-scope-management .data-overview-card:before{content:"";position:absolute;inset:0 0 auto;height:3px;background:#2563eb;z-index:-1}#tab-data.data-scope-management .data-overview-card:after{content:"";position:absolute;width:92px;height:92px;right:-36px;bottom:-42px;border-radius:50%;background:rgba(37,99,235,.08);z-index:-1}#tab-data.data-scope-management .data-overview-card:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.1);border-color:#c7d5e5}#tab-data.data-scope-management .data-overview-icon{grid-row:1 / span 2;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:900;letter-spacing:.04em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.7)}#tab-data.data-scope-management .data-overview-card span:not(.data-overview-icon){align-self:end;color:#64748b;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}#tab-data.data-scope-management .data-overview-card b{align-self:start;margin-top:5px;color:#0f172a;font-size:27px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}#tab-data.data-scope-management .data-overview-card.total:before{background:#2563eb}#tab-data.data-scope-management .data-overview-card.pending:before{background:#f59e0b}#tab-data.data-scope-management .data-overview-card.accepted:before{background:#10b981}#tab-data.data-scope-management .data-overview-card.unassigned:before{background:#8b5cf6}#tab-data.data-scope-management .data-overview-card.pending{background:linear-gradient(135deg,#fff 0%,#fffaf0 100%)}#tab-data.data-scope-management .data-overview-card.pending .data-overview-icon{background:#fef3c7;color:#b45309}#tab-data.data-scope-management .data-overview-card.pending b{color:#b45309}#tab-data.data-scope-management .data-overview-card.accepted{background:linear-gradient(135deg,#fff 0%,#f2fcf7 100%)}#tab-data.data-scope-management .data-overview-card.accepted .data-overview-icon{background:#d1fae5;color:#047857}#tab-data.data-scope-management .data-overview-card.accepted b{color:#047857}#tab-data.data-scope-management .data-overview-card.unassigned{background:linear-gradient(135deg,#fff 0%,#faf7ff 100%)}#tab-data.data-scope-management .data-overview-card.unassigned .data-overview-icon{background:#ede9fe;color:#6d28d9}#tab-data.data-scope-management .data-overview-card.unassigned b{color:#6d28d9}@media(max-width:900px){#tab-data.data-scope-management #dataManagementOverview{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){#tab-data.data-scope-management #dataManagementOverview{gap:10px}.data-overview-card{min-height:92px!important;padding:13px!important;grid-template-columns:32px minmax(0,1fr)!important;column-gap:9px!important}.data-overview-icon{width:32px!important;height:32px!important;border-radius:10px!important}.data-overview-card b{font-size:22px!important}}';document.head.appendChild(style);
    }
    if(!q('#dataManagementOverviewNoCircleStyles')){
      const style=document.createElement('style');style.id='dataManagementOverviewNoCircleStyles';style.textContent='#tab-data.data-scope-management .data-overview-card:after{display:none!important;content:none!important}';document.head.appendChild(style);
    }
    if(!header){
      header=document.createElement('div');header.id='dataManagementHeader';header.className='data-management-header';
      header.innerHTML='<div class="data-management-top"><div class="data-management-title"><h1>Data khách hàng</h1><p>Theo dõi nguồn data và phân công người phụ trách.</p></div></div>';
      tab.insertBefore(header,tab.firstChild);
    }
    const queue=q('#dataSubViewQueue');let stats=q('#dataManagementStatsPanel');
    let overview=q('#dataManagementOverview');
    if(queue&&!overview){overview=document.createElement('div');overview.id='dataManagementOverview';overview.innerHTML='<div class="data-overview-card total"><span class="data-overview-icon" aria-hidden="true">ALL</span><span>Tổng data</span><b id="dataOverviewTotal">0</b></div><div class="data-overview-card pending"><span class="data-overview-icon" aria-hidden="true">NEW</span><span>Data chưa phân</span><b id="dataOverviewUnassigned">0</b></div><div class="data-overview-card accepted"><span class="data-overview-icon" aria-hidden="true">OK</span><span>Sale đã nhận</span><b id="dataOverviewAccepted">0</b></div><div class="data-overview-card unassigned"><span class="data-overview-icon" aria-hidden="true">WAIT</span><span>Chờ Sale nhận</span><b id="dataOverviewWaiting">0</b></div>';const sub=tab.querySelector('.sub-tabs-bar');(sub||tab.firstElementChild)?.after(overview);}
    if(queue&&!stats){stats=document.createElement('aside');stats.id='dataManagementStatsPanel';stats.innerHTML='<div class="data-period-title">Thống kê data mới</div><div class="data-period-list"><div class="data-period-row"><span>Hôm nay</span><b id="dataPeriodToday">0 data</b></div><div class="data-period-row days3"><span>3 ngày gần nhất</span><b id="dataPeriod3Days">0 data</b></div><div class="data-period-row days7"><span>7 ngày gần nhất</span><b id="dataPeriod7Days">0 data</b></div><div class="data-period-row days30"><span>30 ngày gần nhất</span><b id="dataPeriod30Days">0 data</b></div></div>';queue.append(stats);}
    if(stats){stats.style.setProperty('display','block','important');stats.style.setProperty('visibility','visible','important');}
    const datePanel=q('#dataDateFilterPanel');
    if(stats&&datePanel&&datePanel.parentElement!==stats)stats.append(datePanel);
    q('#dataManagementDateTrigger')?.remove();
    header.removeAttribute('hidden');
  }
  function renderAutoRecipientStats(){
    const host=q('#autoRecipientStats');if(!host||!data)return;
    const role=data.user?.actualRole||data.user?.role||'ADMIN',all=(data.members||[]).filter(member=>member&&member.active!==false&&member.active!==0&&['MANAGER','LEADER','SALE'].includes(member.role)),currentId=String(data.user?.id||'');
    const visible=role==='ADMIN'?all:role==='MANAGER'?(data.managerHierarchy?.members||all).filter(member=>member.id===currentId||member.managerId===currentId||member.leaderId===currentId):role==='LEADER'?[...all.filter(member=>member.id===currentId||member.leaderId===currentId)]:all.filter(member=>member.id===currentId);
    const people=visible.filter((member,index,list)=>member?.id&&list.findIndex(item=>item.id===member.id)===index);
    const received=new Map(people.map(member=>[member.id,[]])),seen=new Map(people.map(member=>[member.id,new Set()])),add=(memberId,customer)=>{const id=String(memberId||'');if(!id||!isWebhookDataCustomer(customer)||!received.has(id)||seen.get(id).has(customer.id))return;seen.get(id).add(customer.id);received.get(id).push(customer);};
    const customerById=new Map((data.customers||[]).map(customer=>[String(customer.id),customer]));
    const pendingIds=new Set((data.offers||[]).filter(offer=>offer?.status==='PENDING').map(offer=>String(offer.customerId)));
    const finalRecipient=customer=>customer?.saleId||customer?.leaderId||customer?.managerId||customer?.ownerId||'';
    (data.customers||[]).forEach(customer=>{const recipient=finalRecipient(customer);if(recipient&&!pendingIds.has(String(customer.id)))add(recipient,{...customer,_receivedAt:customer.saleAcceptedAt||customer.updatedAt||customer.createdAt});});
    (data.offers||[]).filter(offer=>offer?.status==='ACCEPTED').forEach(offer=>{const customer=customerById.get(String(offer.customerId));if(customer)add(offer.saleId||offer.leaderId||offer.managerId,{...customer,_receivedAt:offer.acceptedAt||offer.resolvedAt||offer.offeredAt||customer.saleAcceptedAt||customer.createdAt});});
    const roleLabel=member=>member.role==='MANAGER'?'Manager':member.role==='LEADER'?'Leader':'Sale',roleClass=member=>String(member.role||'').toLowerCase(),initials=member=>String(member.initials||member.name||'NV').split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase(),totalReceived=people.reduce((sum,member)=>sum+received.get(member.id).length,0);
    const customerRows=member=>received.get(member.id).slice().sort((a,b)=>String(b._receivedAt||b.createdAt||'').localeCompare(String(a._receivedAt||a.createdAt||''))).map(customer=>'<button type="button" class="auto-recipient-customer" data-auto-recipient-customer="'+esc(customer.id)+'"><span><b>'+esc(customer.name||'Chua dat ten')+'</b><small>'+esc(customer.phone||'')+'</small></span><small>'+esc(fmtDate(customer._receivedAt||customer.createdAt||''))+'</small></button>').join('')||'<div class="auto-recipient-empty">Nhan su nay chua co data đã nhận.</div>';
    const rows=people.slice().sort((a,b)=>{const order={MANAGER:0,LEADER:1,SALE:2};return (order[a.role]??9)-(order[b.role]??9)||String(a.name||'').localeCompare(String(b.name||''),'vi');}).map(member=>'<article class="auto-recipient-group"><button type="button" class="auto-recipient-toggle" data-auto-recipient-toggle="'+esc(member.id)+'" aria-expanded="false"><span class="auto-recipient-person"><span class="auto-recipient-avatar '+roleClass(member)+'">'+esc(initials(member))+'</span><span><b>'+esc(member.name||'Chua dat ten')+'</b><small>'+esc(roleLabel(member))+(member.teamId?' · '+esc(member.teamId):'')+'</small></span></span><span class="auto-recipient-total"><b>'+received.get(member.id).length+'</b><small>data đã nhận</small><i>+</i></span></button><div class="auto-recipient-detail" data-auto-recipient-detail="'+esc(member.id)+'" hidden>'+customerRows(member)+'</div></article>').join('');
    host.innerHTML='<div class="auto-recipient-head"><div><b>'+(role==='ADMIN'?'Data nhận theo nhân sự':'Data cá nhân của tôi')+'</b><small>'+(role==='ADMIN'?'Chỉ tính data từ webhook đã được nhân sự nhận. Bấm vào nhân sự để xem khách.':'Chỉ tính data từ webhook mà tài khoản đã nhận.')+'</small></div><span class="auto-recipient-count">'+totalReceived+' data</span></div><div class="auto-recipient-list">'+(rows||'<div class="auto-recipient-empty">Chua co nhan su hoac data đã nhận.</div>')+'</div>';
    host.querySelectorAll('[data-auto-recipient-toggle]').forEach(button=>button.onclick=()=>{const detail=host.querySelector('[data-auto-recipient-detail="'+CSS.escape(button.dataset.autoRecipientToggle)+'"]');if(!detail)return;const open=detail.hidden;detail.hidden=!open;button.setAttribute('aria-expanded',String(open));const icon=button.querySelector('i');if(icon)icon.textContent=open?'−':'+';});
    host.querySelectorAll('[data-auto-recipient-customer]').forEach(button=>button.onclick=()=>workflow('customer',button.dataset.autoRecipientCustomer));
    if(!q('#autoRecipientStatsStyles')){const style=document.createElement('style');style.id='autoRecipientStatsStyles';style.textContent='#dataSubViewAuto #autoRecipientStats{margin-top:14px;border:1px solid #dbe3ec;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 5px 16px rgba(15,23,42,.05)}#dataSubViewAuto .auto-recipient-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.auto-recipient-head>div{display:grid;gap:4px;min-width:0}.auto-recipient-head b{color:#0f172a;font-size:13px}.auto-recipient-head small{color:#64748b;font-size:11px}.auto-recipient-count{padding:6px 9px;border:1px solid #bfdbfe;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800;white-space:nowrap}.auto-recipient-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:8px;padding:12px}.auto-recipient-group{border:1px solid #e2e8f0;border-radius:9px;background:#fff;overflow:hidden}.auto-recipient-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 11px;border:0;background:#fff;color:#0f172a;text-align:left;cursor:pointer}.auto-recipient-toggle:hover{background:#f8fbff}.auto-recipient-person{display:flex;align-items:center;gap:9px;min-width:0}.auto-recipient-person>span:last-child{display:grid;gap:3px;min-width:0}.auto-recipient-person b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0f172a;font-size:12px}.auto-recipient-person small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:10.5px}.auto-recipient-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#dbeafe;color:#1d4ed8;font:800 11px var(--font-mono,monospace)}.auto-recipient-avatar.manager{background:#fef3c7;color:#a16207}.auto-recipient-avatar.leader{background:#ede9fe;color:#6d28d9}.auto-recipient-avatar.sale{background:#dcfce7;color:#15803d}.auto-recipient-total{display:grid;justify-items:end;gap:2px;min-width:92px}.auto-recipient-total b{color:#2563eb;font:800 18px var(--font-mono,monospace);line-height:1}.auto-recipient-total small{color:#64748b;font-size:9.5px;white-space:nowrap}.auto-recipient-total i{color:#2563eb;font-size:15px;font-style:normal;line-height:1}.auto-recipient-detail[hidden]{display:none!important}.auto-recipient-detail{display:grid;gap:5px;padding:8px 10px 10px;border-top:1px solid #e2e8f0;background:#f8fafc}.auto-recipient-customer{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 8px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;color:#0f172a;text-align:left;cursor:pointer}.auto-recipient-customer:hover{border-color:#93c5fd;background:#eff6ff}.auto-recipient-customer span{display:grid;gap:3px;min-width:0}.auto-recipient-customer b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.auto-recipient-customer small{color:#64748b;font-size:10px;white-space:nowrap}.auto-recipient-empty{grid-column:1/-1;padding:18px;text-align:center;color:#64748b;font-size:11px}@media(max-width:700px){#dataSubViewAuto .auto-recipient-list{grid-template-columns:1fr}#dataSubViewAuto .auto-recipient-head{align-items:flex-start;flex-direction:column}}';document.head.appendChild(style);}
  }
  function readReferenceImage(file){
    return new Promise((resolve,reject)=>{
      if(!file){resolve('');return;}
      if(file.size>2_000_000){reject(new Error('Ảnh quá lớn. Vui lòng chọn ảnh dưới 2MB.'));return;}
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('Không đọc được ảnh.'));reader.readAsDataURL(file);
    });
  }
  const feedbackLabels={COURSE:'Feedback khách khóa học',SUPPORT:'Feedback hỗ trợ',GROUP_SIGNAL:'Feedback tín hiệu nhóm'};
  const feedbackCategoryLabel=category=>feedbackLabels[category]||'Feedback khác';
  function feedbackEditor(id){
    const item=(data.feedbacks||[]).find(row=>row.id===id)||{};
    let imageData=item.imageData||'';if(!imageData&&item.hasImage)lazyAsset(lazyAssetUrl('feedback',item.id)).then(result=>{imageData=result.imageData||'';const host=q('#feedbackImagePreview');if(host&&imageData)host.innerHTML='<img src="'+esc(imageData)+'" alt="Feedback">';}).catch(()=>{});
    const body='<div class="crm-form-grid"><label class="crm-field"><span>Phân loại <em>*</em></span><select id="feedbackCategory"><option value="COURSE" '+(item.category==='COURSE'?'selected':'')+'>Feedback khách khóa học</option><option value="SUPPORT" '+(item.category==='SUPPORT'?'selected':'')+'>Feedback hỗ trợ</option><option value="GROUP_SIGNAL" '+(item.category==='GROUP_SIGNAL'?'selected':'')+'>Feedback tín hiệu nhóm</option></select></label><div class="crm-field"><span>Ảnh feedback <small>PNG, JPG, WEBP · tối đa 2 MB</small></span><div class="crm-file-picker"><input id="feedbackImage" type="file" accept="image/png,image/jpeg,image/webp"><label class="crm-file-button" for="feedbackImage">Chọn ảnh</label><span class="crm-file-name" id="feedbackImageName">'+(item.imageData?'Đã có ảnh':'Chưa chọn tệp')+'</span></div></div><label class="crm-field crm-field-full"><span>Ghi chú / nội dung <em>*</em></span><textarea id="feedbackNote" rows="5" maxlength="2000" required placeholder="Ghi lại nội dung feedback..."></textarea></label><div id="feedbackImagePreview" class="crm-image-preview crm-field-full"></div></div>';
    editor(id?'Cập nhật feedback':'Thêm feedback',body,async()=>{const image=await readReferenceImage(q('#feedbackImage')?.files?.[0]);return api.saveFeedback(id,{category:q('#feedbackCategory').value,note:q('#feedbackNote').value,imageData:image||imageData});});
    q('#feedbackNote').value=item.note||'';
    const preview=()=>{const input=q('#feedbackImage'),value=input?.files?.[0],name=q('#feedbackImageName');if(name)name.textContent=value?.name|| (item.imageData?'Đã có ảnh':'Chưa chọn tệp');if(value){readReferenceImage(value).then(image=>{imageData=image;q('#feedbackImagePreview').innerHTML=image?'<img src="'+esc(image)+'" alt="Xem trước ảnh feedback">':'';}).catch(error=>{q('#feedbackImagePreview').textContent=error.message;});}else q('#feedbackImagePreview').innerHTML=item.imageData?'<img src="'+esc(item.imageData)+'" alt="Ảnh feedback hiện tại">':'';};
    q('#feedbackImage').onchange=preview;preview();
  }
  let feedbackCategoryFilter='';
  let feedbackDateRange=false;
  function feedbackDateShift(value,days){const parts=String(value||'').slice(0,10).split('-').map(Number);if(parts.length!==3||parts.some(Number.isNaN))return data.today;const date=new Date(parts[0],parts[1]-1,parts[2]);date.setDate(date.getDate()+days);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
  function feedbackDateLabel(value){return value?String(value).split('-').reverse().join('/'):'—';}
  function renderFeedbackView(){
    const host=q('#feedbackHost');if(!host||!data)return;
    const all=(data.feedbacks||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const selected=q('#feedbackDateFilter')?.value||data.today;
    const weekStart=feedbackDateShift(selected,-6);
    const dayRows=feedbackDateRange==='all'?all.slice():feedbackDateRange?all.filter(item=>{const date=String(item.createdAt||'').slice(0,10);return date>=weekStart&&date<=selected;}):all.filter(item=>String(item.createdAt||'').slice(0,10)===selected);
    const visibleRows=dayRows.filter(item=>!feedbackCategoryFilter||item.category===feedbackCategoryFilter);
    const counts=category=>all.filter(item=>item.category===category).length;
    const role=data.user.actualRole||data.user.role;
    const isAdmin=role==='ADMIN';
    const categoryButtons=['','COURSE','SUPPORT','GROUP_SIGNAL'].map(category=>{const active=feedbackCategoryFilter===category;const label=category?feedbackCategoryLabel(category):'Tất cả';const count=category?counts(category):all.length;return '<button type="button" class="feedback-category-card'+(active?' is-active':'')+'" data-feedback-category="'+category+'"><span>'+esc(label)+'</span><b>'+count+'</b></button>';}).join('');
    const list=visibleRows.map(item=>{const own=isAdmin||item.authorId===data.user.id;return '<article class="feedback-card"><div class="feedback-card-main"><div class="feedback-card-head"><div><span class="feedback-chip feedback-'+String(item.category||'').toLowerCase()+'">'+esc(feedbackCategoryLabel(item.category))+'</span><h3>'+esc(item.authorName||'Nhân sự')+'</h3><small>'+esc(fmtDate(item.createdAt||''))+'</small></div><div class="feedback-card-actions">'+(own?'<button type="button" class="btn-action btn-secondary" data-feedback-edit="'+esc(item.id)+'">Sửa</button><button type="button" class="btn-action btn-danger" data-feedback-delete="'+esc(item.id)+'">Xóa</button>':'')+'</div></div><p>'+esc(item.note||'')+'</p></div>'+((item.imageData||item.hasImage)?'<button type="button" class="feedback-image-button" data-feedback-image="'+esc(item.id)+'"><img src="'+esc(item.imageData)+'" alt="Ảnh feedback" loading="lazy"><span>Phóng to</span></button>':'')+'</article>';}).join('')||'<div class="feedback-empty">Không có feedback trong ngày hoặc bộ lọc đã chọn.</div>';
    host.innerHTML='<div class="headline-row"><div><h1>Kho Feedback</h1><p class="page-subtitle">Tra cứu feedback theo ngày, loại và người tạo.</p></div><button type="button" class="btn-action btn-primary" id="addFeedbackButton">+ Thêm feedback</button></div><div class="feedback-kpi-grid"><article><small>Tổng feedback</small><b>'+all.length+'</b></article><article><small>'+(feedbackDateRange==='all'?'Tất cả thời gian':'Ngày '+(feedbackDateRange?feedbackDateLabel(weekStart)+' - '+feedbackDateLabel(selected):feedbackDateLabel(selected)))+'</small><b>'+dayRows.length+'</b></article><article><small>Khách khóa học</small><b>'+counts('COURSE')+'</b></article><article><small>Hỗ trợ / tín hiệu nhóm</small><b>'+(counts('SUPPORT')+counts('GROUP_SIGNAL'))+'</b></article></div><div class="feedback-toolbar"><div class="feedback-date-nav"><button type="button" class="feedback-date-arrow" data-feedback-date-shift="-1" aria-label="Ngày trước">‹</button><label>Feedback theo ngày<input id="feedbackDateFilter" type="date" value="'+esc(selected)+'"></label><button type="button" class="feedback-date-arrow" data-feedback-date-shift="1" aria-label="Ngày sau">›</button></div><div class="feedback-quick-filters"><button type="button" class="btn-action btn-secondary" data-feedback-date-preset="today">Hôm nay</button><button type="button" class="btn-action btn-secondary" data-feedback-date-preset="yesterday">Hôm qua</button><button type="button" class="btn-action btn-secondary" data-feedback-date-preset="week">7 ngày qua</button><button type="button" class="btn-action '+(feedbackDateRange==='all'?'btn-primary':'btn-secondary')+'" data-feedback-date-preset="all">Tất cả feedback</button><span>'+visibleRows.length+' feedback đang hiển thị</span></div></div><div class="feedback-category-grid">'+categoryButtons+'</div><div class="feedback-list">'+list+'</div>';
    if(!q('#feedbackStyles')){const style=document.createElement('style');style.id='feedbackStyles';style.textContent='#tab-feedback .page-subtitle{margin:5px 0 0;color:var(--text-muted);font-size:12px}.feedback-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 12px}.feedback-kpi-grid article{padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:var(--bg-surface);box-shadow:var(--shadow-sm)}.feedback-kpi-grid small{display:block;color:var(--text-muted);font-size:10.5px}.feedback-kpi-grid b{display:block;margin-top:4px;color:var(--text-main);font:800 20px var(--font-mono)}.feedback-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:9px;background:var(--bg-surface)}.feedback-date-nav,.feedback-quick-filters{display:flex;align-items:end;gap:7px;flex-wrap:wrap}.feedback-toolbar label{display:grid;gap:4px;color:var(--text-muted);font-size:10.5px;font-weight:700}.feedback-toolbar input{height:32px;padding:0 9px;border:1px solid var(--border);border-radius:7px;color:var(--text-main);background:#fff}.feedback-date-arrow{width:30px;height:32px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text-main);font-size:21px;line-height:1;cursor:pointer}.feedback-quick-filters .btn-action{padding:7px 9px;font-size:10.5px}.feedback-quick-filters span{margin-left:3px;color:var(--text-muted);font-size:10.5px}.feedback-category-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.feedback-category-card{display:flex;align-items:center;justify-content:space-between;min-height:38px;padding:8px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text-main);cursor:pointer;text-align:left}.feedback-category-card.is-active{border-color:#2563eb;background:#eff6ff}.feedback-category-card b{font:800 16px var(--font-mono);color:#2563eb}.feedback-list{display:grid;grid-template-columns:1fr;gap:9px;max-width:980px}.feedback-card{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:14px;align-items:start;border:1px solid var(--border);border-radius:9px;background:var(--bg-surface);padding:11px 12px;box-shadow:var(--shadow-sm)}.feedback-card-head{display:flex;justify-content:space-between;gap:10px}.feedback-card h3{margin:7px 0 2px;font-size:12.5px}.feedback-card small{color:var(--text-muted);font-size:10px}.feedback-card p{margin:9px 0 0;white-space:pre-wrap;color:var(--text-main);font-size:12px;line-height:1.5}.feedback-chip{display:inline-flex;padding:3px 6px;border-radius:5px;font-size:9.5px;font-weight:800;background:#eff6ff;color:#1d4ed8}.feedback-support{background:#ecfdf5;color:#047857}.feedback-group_signal{background:#fff7ed;color:#c2410c}.feedback-card-actions{display:flex;gap:5px}.feedback-card-actions .btn-action{padding:5px 7px;font-size:10px}.feedback-image-button{position:relative;width:150px;height:112px;padding:0;border:1px solid var(--border);border-radius:8px;background:#f8fafc;overflow:hidden;cursor:zoom-in}.feedback-image-button img{display:block;width:100%;height:100%;object-fit:cover}.feedback-image-button span{position:absolute;right:6px;bottom:6px;padding:4px 6px;border-radius:5px;background:rgba(15,23,42,.78);color:#fff;font-size:9px}.feedback-empty{padding:26px;text-align:center;border:1px dashed var(--border);border-radius:9px;color:var(--text-muted)}.process-image-lightbox{position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;padding:56px;background:rgba(2,6,23,.94)}.process-lightbox-image{max-width:calc(100vw - 120px);max-height:calc(100vh - 120px);object-fit:contain;box-shadow:0 12px 40px rgba(0,0,0,.4)}.process-lightbox-close,.process-lightbox-prev,.process-lightbox-next{position:absolute;border:0;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}.process-lightbox-close{top:18px;right:22px;width:40px;height:40px;border-radius:50%;font-size:28px}.process-lightbox-prev,.process-lightbox-next{top:50%;width:44px;height:56px;margin-top:-28px;border-radius:8px;font-size:38px;line-height:1}.process-lightbox-prev{left:18px}.process-lightbox-next{right:18px}.process-lightbox-counter{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);color:#cbd5e1;font-size:12px}@media(max-width:760px){.feedback-kpi-grid,.feedback-category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.feedback-toolbar{align-items:flex-start;flex-direction:column}.feedback-quick-filters{align-items:center}.feedback-card{grid-template-columns:1fr}.feedback-image-button{width:100%;height:180px}}';document.head.appendChild(style);}
    q('#addFeedbackButton').onclick=()=>feedbackEditor('');q('#feedbackDateFilter').onchange=()=>{feedbackDateRange=false;renderFeedbackView();};qa('[data-feedback-date-shift]').forEach(button=>button.onclick=()=>{if(feedbackDateRange==='all')feedbackDateRange=false;q('#feedbackDateFilter').value=feedbackDateShift(selected,Number(button.dataset.feedbackDateShift));renderFeedbackView();});qa('[data-feedback-date-preset]').forEach(button=>button.onclick=()=>{const preset=button.dataset.feedbackDatePreset;if(preset==='today'){feedbackDateRange=false;q('#feedbackDateFilter').value=data.today;renderFeedbackView();}else if(preset==='yesterday'){feedbackDateRange=false;q('#feedbackDateFilter').value=feedbackDateShift(data.today,-1);renderFeedbackView();}else if(preset==='all'){feedbackDateRange='all';feedbackCategoryFilter='';renderFeedbackView();}else{q('#feedbackDateFilter').value=data.today;feedbackDateRange=true;feedbackCategoryFilter='';renderFeedbackView();}});qa('[data-feedback-edit]').forEach(button=>button.onclick=()=>feedbackEditor(button.dataset.feedbackEdit));qa('[data-feedback-category]').forEach(button=>button.onclick=()=>{feedbackCategoryFilter=button.dataset.feedbackCategory||'';renderFeedbackView();});qa('[data-feedback-image]').forEach(button=>button.onclick=async()=>{const item=all.find(row=>row.id===button.dataset.feedbackImage);if(!item)return;const result=item.imageData?{imageData:item.imageData}:await lazyAsset(lazyAssetUrl('feedback',item.id));if(result.imageData)openProcessImageViewer([result.imageData]);});qa('[data-feedback-delete]').forEach(button=>button.onclick=()=>{if(!window.confirm('Bạn có chắc muốn xóa feedback này? Dữ liệu sẽ không hiển thị lại.'))return;run(()=>api.removeFeedback(button.dataset.feedbackDelete),()=>referenceNotice('Đã xóa feedback thành công.'));});
  }
  function processImageList(item){return Array.isArray(item?.imageData)?item.imageData.filter(Boolean):(item?.imageData?[item.imageData]:[]);}
  async function processImages(item){const local=processImageList(item);if(local.length||!item?.hasImage)return local;try{const result=await lazyAsset(lazyAssetUrl('process',item.id));return result.images||[];}catch{return [];}}
  function openProcessImageViewer(images,initialIndex=0){
    const list=images.filter(Boolean);if(!list.length)return;
    let index=Math.max(0,Math.min(initialIndex,list.length-1));
    const overlay=document.createElement('div');overlay.className='process-image-lightbox';
    overlay.innerHTML='<button type="button" class="process-lightbox-close" aria-label="Dong">&times;</button><button type="button" class="process-lightbox-prev" aria-label="Anh truoc">&#8249;</button><img class="process-lightbox-image" alt="Anh quy trinh"><button type="button" class="process-lightbox-next" aria-label="Anh tiep theo">&#8250;</button><div class="process-lightbox-counter"></div>';
    document.body.appendChild(overlay);
    const image=overlay.querySelector('.process-lightbox-image'),counter=overlay.querySelector('.process-lightbox-counter');
    const render=()=>{image.src=list[index];counter.textContent=(index+1)+' / '+list.length;};
    const close=()=>{document.removeEventListener('keydown',onKey);overlay.remove();};
    const move=step=>{index=(index+step+list.length)%list.length;render();};
    const onKey=event=>{if(event.key==='Escape')close();if(event.key==='ArrowLeft')move(-1);if(event.key==='ArrowRight')move(1);};
    overlay.querySelector('.process-lightbox-close').onclick=close;overlay.querySelector('.process-lightbox-prev').onclick=()=>move(-1);overlay.querySelector('.process-lightbox-next').onclick=()=>move(1);overlay.onclick=event=>{if(event.target===overlay)close();};document.addEventListener('keydown',onKey);render();
  }
  function ensureProcessPresentationStyles(){
    if(q('#processPresentationStyles'))return;
    const style=document.createElement('style');style.id='processPresentationStyles';style.textContent=`
      .process-workspace-overlay{z-index:2147483001!important}
      .process-image-lightbox{z-index:2147483100!important}
      .reference-editor-card.process-workspace-modal{width:min(1600px,calc(100vw - 40px))!important;height:92dvh!important;max-height:92dvh!important;display:grid!important;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden}
      .process-workspace-modal .modal-header{padding:20px 26px!important;gap:16px;flex-shrink:0}
      .process-workspace-modal .modal-header h3{font-size:22px!important;line-height:1.4;text-transform:uppercase;overflow-wrap:anywhere}
      .process-workspace-modal .reference-editor-body{min-height:0;max-height:none!important;padding:24px 26px!important;overflow:auto!important;font-size:16px;text-transform:none}
      .process-workspace-modal .modal-footer{padding:14px 26px!important}
      .process-workspace-modal .crm-field>span,.process-editor-preview-panel h4,.process-detail-section-title{text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.04em}
      .process-workspace-modal input:not([type=file]),.process-workspace-modal textarea{font:400 15px var(--font-main,Arial,sans-serif)!important;line-height:1.65!important;text-transform:none}
      .process-workspace-modal #processTitle{font-weight:700!important;text-transform:uppercase}
      .process-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:28px;align-items:start}
      .process-editor-fields{display:grid;gap:18px;min-width:0}
      .process-editor-fields textarea{min-height:300px!important}
      .process-editor-preview-panel{min-width:0;border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc}
      .process-editor-preview-panel h4{margin:0 0 14px;color:#334155}
      .process-workspace-modal .process-editor-gallery,.process-workspace-modal .process-detail-gallery{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
      .process-workspace-modal .process-detail-thumb,.process-workspace-modal .process-editor-image{display:block;width:100%;height:auto;padding:0;border:1px solid #dbe3ec;border-radius:10px;background:#fff;overflow:hidden;cursor:zoom-in}
      .process-workspace-modal .process-detail-thumb img,.process-workspace-modal .process-editor-gallery img{display:block;width:100%;height:auto;max-height:none;object-fit:contain;border:0;border-radius:0}
      .process-workspace-modal .process-detail-view{display:grid;gap:24px;min-width:0}
      .process-workspace-modal .process-detail-content,.process-workspace-modal .process-detail-summary{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:16px;font-weight:400;line-height:1.75;text-transform:none;color:#334155}
      .process-workspace-modal #processSummary,.process-workspace-modal #processContent,.process-workspace-modal .process-detail-content,.process-workspace-modal .process-detail-summary,#tab-processes .process-card p{text-transform:lowercase!important}
      .process-workspace-modal .process-detail-gallery[hidden]{display:none!important}
      .process-detail-summary{padding:14px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px}
      .process-detail-section-title{margin:0 0 10px;color:#0f172a}
      .process-preview-empty{padding:32px 12px;text-align:center;font-size:14px;line-height:1.6;color:#64748b}
      #tab-processes h1,#tab-processes .process-card h3{text-transform:uppercase}
      #tab-processes .process-card p{text-transform:none;font-weight:400;line-height:1.6}
      @media(max-width:900px){.process-editor-layout{grid-template-columns:minmax(0,1fr);gap:20px}}
      @media(max-width:560px){.reference-editor-card.process-workspace-modal{width:calc(100vw - 16px)!important;height:94dvh!important;max-height:94dvh!important}.process-workspace-modal .modal-header{padding:14px 16px!important}.process-workspace-modal .modal-header h3{font-size:18px!important}.process-workspace-modal .reference-editor-body{padding:16px!important}.process-workspace-modal .modal-footer{padding:12px 16px!important}.process-editor-preview-panel{padding:12px}.process-editor-fields textarea{min-height:220px!important}}
    `;document.head.appendChild(style);
  }
  function prepareProcessModal(modal){
    ensureProcessPresentationStyles();modal.classList.add('process-workspace-overlay');modal.querySelector('.modal-card').classList.add('process-workspace-modal');
    return modal;
  }
  function processEditor(id){
    const item=(data.processes||[]).find(row=>row.id===id)||{};let imageDataList=processImageList(item);
    const imageLoad=processImages(item).then(images=>{imageDataList=images;return images;});
    const body='<div class="process-editor-layout"><div class="process-editor-fields"><label class="crm-field"><span>Tiêu đề <em>*</em></span><input id="processTitle" maxlength="200" required value="'+esc(String(item.title||'').toLocaleUpperCase('vi-VN'))+'" placeholder="QUY TRÌNH TIẾP NHẬN DATA MỚI"></label><label class="crm-field"><span>Mô tả ngắn</span><input id="processSummary" maxlength="500" value="'+esc(item.summary||'')+'" placeholder="Tóm tắt ngắn gọn nội dung quy trình"></label><label class="crm-field"><span>Nội dung chi tiết <em>*</em></span><textarea id="processContent" rows="12" maxlength="20000" required placeholder="Mô tả từng bước thực hiện, mỗi bước một dòng…">'+esc(item.content||'')+'</textarea></label><label class="crm-field"><span>Link tham khảo</span><input id="processLink" type="url" maxlength="500" value="'+esc(item.link||'')+'" placeholder="https://..."></label><div class="crm-field"><span>Ảnh minh họa</span><div class="crm-file-picker"><input id="processImage" type="file" multiple accept="image/png,image/jpeg,image/webp"><label class="crm-file-button" for="processImage">Chọn ảnh</label><span class="crm-file-name" id="processImageName"></span></div><small>Tối đa 10 ảnh, mỗi ảnh dưới 2 MB. Bấm vào ảnh để xem lớn.</small></div></div><aside class="process-editor-preview-panel"><h4>Xem trước ảnh quy trình</h4><div id="processImagePreview" class="process-editor-gallery"></div></aside></div>';
    const modal=prepareProcessModal(editor(id?'CẬP NHẬT QUY TRÌNH':'TẠO QUY TRÌNH',body,async()=>{
      const files=Array.from(q('#processImage')?.files||[]);if(files.length>10)throw Error('Chỉ chọn tối đa 10 ảnh cho một quy trình.');
      const selected=files.length?await Promise.all(files.map(readReferenceImage)):await imageLoad;
      if(!files.length&&item.hasImage&&!selected.length)throw Error('Chưa tải được ảnh hiện có. Vui lòng mở lại quy trình để giữ đủ ảnh.');
      return api.saveProcess(id,{title:q('#processTitle').value.toLocaleUpperCase('vi-VN'),summary:q('#processSummary').value,content:q('#processContent').value,link:q('#processLink').value,imageData:selected});
    }));
    const showImages=images=>{const host=modal.querySelector('#processImagePreview');if(!modal.isConnected)return;
      host.innerHTML=images.length?images.map((src,i)=>'<button type="button" class="process-editor-image" data-process-preview-index="'+i+'" aria-label="Xem lớn ảnh '+(i+1)+'"><img src="'+esc(src)+'" alt="Ảnh quy trình '+(i+1)+'"></button>').join(''):'<p class="process-preview-empty">Chọn ảnh minh họa để xem trước tại đây.</p>';
      host.querySelectorAll('[data-process-preview-index]').forEach(button=>button.onclick=()=>openProcessImageViewer(images,Number(button.dataset.processPreviewIndex)));
    };
    const preview=async()=>{const files=Array.from(modal.querySelector('#processImage').files||[]),name=modal.querySelector('#processImageName');
      try{if(files.length>10)throw Error('Chỉ chọn tối đa 10 ảnh.');const images=files.length?await Promise.all(files.map(readReferenceImage)):await imageLoad;
        if(!modal.isConnected)return;name.textContent=images.length?images.length+' ảnh '+(files.length?'đã chọn':'hiện có'):'Chưa chọn ảnh';showImages(images);
      }catch(error){modal.querySelector('#processImagePreview').textContent=error.message;}
    };
    q('#processTitle').onchange=event=>{event.target.value=event.target.value.toLocaleUpperCase('vi-VN');};q('#processImage').onchange=preview;preview();
  }
  async function processDetail(item){
    if(!item)return;
    const modal=prepareProcessModal(editor(String(item.title||'').toLocaleUpperCase('vi-VN'),'<div class="process-detail-view">'+(item.summary?'<p class="process-detail-summary">'+esc(item.summary)+'</p>':'')+'<div class="process-detail-gallery"><p class="process-preview-empty">Đang tải ảnh quy trình…</p></div><section><h4 class="process-detail-section-title">NỘI DUNG QUY TRÌNH</h4><p class="process-detail-content">'+esc(item.content||'')+'</p></section>'+(item.link?'<a href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">Mở tài liệu tham khảo</a>':'')+'</div>'));
    const images=await processImages(item),host=modal.querySelector('.process-detail-gallery');if(!modal.isConnected)return;
    host.innerHTML=images.map((src,index)=>'<button type="button" class="process-detail-thumb" data-process-image-index="'+index+'" aria-label="Xem lớn ảnh '+(index+1)+'"><img src="'+esc(src)+'" alt="Ảnh quy trình '+(index+1)+'"></button>').join('');host.hidden=!images.length;
    host.querySelectorAll('[data-process-image-index]').forEach(button=>button.onclick=()=>openProcessImageViewer(images,Number(button.dataset.processImageIndex)||0));
  }
  function renderProcessesView(){
    const host=q('#processesHost');if(!host||!data)return;ensureProcessPresentationStyles();const role=data.user.actualRole||data.user.role,items=(data.processes||[]).slice().sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
    host.innerHTML='<div class="headline-row"><div><h1>QUY TRÌNH</h1><p class="page-subtitle">Các quy trình nội bộ để mọi người tra cứu và thực hiện.</p></div>'+(role==='ADMIN'?'<button type="button" class="btn-action btn-primary" id="addProcessButton">+ Tạo quy trình</button>':'')+'</div><div class="process-grid">'+(items.map(item=>{const images=processImageList(item),excerpt=String(item.summary||item.content||'').replace(/\s+/g,' ').trim(),shortExcerpt=excerpt.length>150?excerpt.slice(0,147)+'...':excerpt;return '<article class="process-card"><button type="button" class="process-cover" data-process-cover="'+esc(item.id)+'" aria-label="Xem ảnh quy trình">'+(images.length?'<img src="'+esc(images[0])+'" alt="">':'<span>QUY TRÌNH</span>')+(images.length>1?'<span class="process-image-count">'+images.length+' ảnh</span>':'')+'</button><div class="process-card-body"><small>'+esc(fmtDate(item.updatedAt||item.createdAt||''))+'</small><h3>'+esc(item.title)+'</h3><p>'+esc(shortExcerpt||'Xem chi tiết để theo dõi các bước thực hiện.')+'</p><div class="process-card-meta">'+(images.length?images.length+' ảnh':'Chưa có ảnh')+' · Nội dung chi tiết</div><div class="process-card-footer"><button type="button" class="btn-action btn-primary" data-process-detail="'+esc(item.id)+'">Xem chi tiết</button>'+(role==='ADMIN'?'<span><button type="button" class="btn-action btn-secondary" data-process-edit="'+esc(item.id)+'">Sửa</button><button type="button" class="btn-action btn-danger" data-process-delete="'+esc(item.id)+'">Xóa</button></span>':'')+'</div></div></article>';}).join('')||'<div class="process-empty">Chưa có quy trình nào.</div>')+'</div>';
    if(!q('#processStyles')){const style=document.createElement('style');style.id='processStyles';style.textContent='#tab-processes .page-subtitle{margin:5px 0 0;color:var(--text-muted);font-size:12px}.process-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.process-card{overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--bg-surface);box-shadow:var(--shadow-sm)}.process-cover{position:relative;width:100%;height:150px;padding:0;border:0;background:#0f172a;display:grid;place-items:center;overflow:hidden;color:#bfdbfe;font:800 12px var(--font-mono);letter-spacing:.08em;cursor:zoom-in}.process-cover img{width:100%;height:100%;object-fit:cover}.process-image-count{position:absolute;right:10px;bottom:10px;padding:5px 8px;border-radius:6px;background:rgba(15,23,42,.78);color:#fff;font-size:10px;letter-spacing:0}.process-card-body{padding:14px}.process-card-body>small{color:var(--text-muted);font-size:10.5px}.process-card h3{margin:7px 0 6px;font-size:15px}.process-card p{min-height:38px;margin:0;color:var(--text-muted);font-size:12px;line-height:1.5}.process-card-meta{margin-top:9px;color:#64748b;font-size:10.5px}.process-card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px}.process-card-footer span{display:flex;gap:5px}.process-card-footer .btn-action{padding:6px 8px;font-size:10px}.process-empty{grid-column:1/-1;padding:40px;text-align:center;border:1px dashed var(--border);border-radius:10px;color:var(--text-muted)}.process-detail-view{display:grid;gap:16px}.process-detail-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.process-detail-thumb{height:150px;padding:0;border:1px solid var(--border);border-radius:9px;background:#f8fafc;overflow:hidden;cursor:zoom-in}.process-detail-thumb img{width:100%;height:100%;object-fit:cover}.process-detail-content{white-space:pre-wrap;line-height:1.65;margin:0}.process-editor-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.process-editor-gallery img{width:100%;height:100px;border:1px solid #dbe3ec;border-radius:8px;object-fit:cover}.process-image-lightbox{position:fixed;z-index:10000;inset:0;display:flex;align-items:center;justify-content:center;padding:56px;background:rgba(2,6,23,.94)}.process-lightbox-image{max-width:calc(100vw - 120px);max-height:calc(100vh - 120px);object-fit:contain;box-shadow:0 12px 40px rgba(0,0,0,.4)}.process-lightbox-close,.process-lightbox-prev,.process-lightbox-next{position:absolute;border:0;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}.process-lightbox-close{top:18px;right:22px;width:40px;height:40px;border-radius:50%;font-size:28px}.process-lightbox-prev,.process-lightbox-next{top:50%;width:44px;height:56px;margin-top:-28px;border-radius:8px;font-size:38px;line-height:1}.process-lightbox-prev{left:18px}.process-lightbox-next{right:18px}.process-lightbox-counter{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);color:#cbd5e1;font-size:12px}@media(max-width:900px){.process-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.process-grid{grid-template-columns:1fr}.process-lightbox-image{max-width:calc(100vw - 56px);max-height:calc(100vh - 100px)}.process-lightbox-prev,.process-lightbox-next{width:36px;height:46px}.process-lightbox-prev{left:8px}.process-lightbox-next{right:8px}}';document.head.appendChild(style);}
    if(role==='ADMIN')q('#addProcessButton').onclick=()=>processEditor('');qa('[data-process-detail]').forEach(button=>button.onclick=()=>processDetail(items.find(item=>item.id===button.dataset.processDetail)));qa('[data-process-cover]').forEach(button=>button.onclick=()=>{const item=items.find(row=>row.id===button.dataset.processCover);if(item)processImages(item).then(images=>openProcessImageViewer(images));});qa('[data-process-edit]').forEach(button=>button.onclick=()=>processEditor(button.dataset.processEdit));qa('[data-process-delete]').forEach(button=>button.onclick=()=>run(()=>api.removeProcess(button.dataset.processDelete)));
  }
  function applySaleDataLayout(){
    const role=data?.user?.actualRole||data?.user?.role, tab=q('#tab-data');
    if(!tab)return;
    if(!q('#referenceScopedDataStyles')){const style=document.createElement('style');style.id='referenceScopedDataStyles';style.textContent=`
      /* Giữ bảng data và bộ lọc, chỉ ẩn nhãn hàng đợi cũ để giao diện gọn hơn. */
      #tab-data.data-scope-limited #dataTabQueueBtn,#tab-data.data-scope-limited #dataSubViewQueue>.table-container>.table-head-bar{display:none!important}
      #tab-data.data-scope-limited #dataSubViewQueue{display:block!important}
      #tab-data.data-scope-limited #dataSubViewQueue>.table-container{width:100%;border-radius:10px}
      #tab-data.data-scope-limited #dataSubViewQueue>.table-container>.table-head-bar{padding:13px 16px}
      #tab-data.data-scope-limited .data-queue-filterbar{padding:10px 16px!important;background:var(--bg-surface)}
      #tab-data.data-scope-limited .data-queue-filterbar input,#tab-data.data-scope-limited .data-queue-filterbar select{min-height:34px;padding:7px 10px!important;border-radius:7px!important}
      #tab-data.data-scope-limited #dataQueueSourceFilter{display:none!important}
      #tab-data.data-scope-limited #dataQueueTableBody td{padding:11px 14px}
      #tab-data.data-scope-limited #dataQueueTableBody td:nth-child(2),#tab-data.data-scope-limited #dataQueueTableBody td:nth-child(3){white-space:nowrap}
      #tab-data.data-scope-limited #dataQueueTableBody td small{display:block;margin-top:3px;color:var(--text-muted);font-size:10.5px}
      #tab-data.data-scope-limited .quick-sale-select{min-width:150px;max-width:190px;padding:7px 10px;border:1.5px solid #e58a00;border-radius:8px;background:#fff;color:var(--text-main);font:inherit;font-size:12px;font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.04)}#tab-data.data-scope-limited .quick-sale-select:focus{border-color:#c46f00;box-shadow:0 0 0 3px rgba(234,137,0,.14)}#tab-data.data-scope-limited .data-owner-label{display:inline-flex;align-items:center;min-height:30px;padding:6px 10px;border-radius:8px;background:#fff7ed;color:#9a3412;font-weight:700;white-space:nowrap}#tab-data.data-scope-limited .data-type-badge,#tab-data.data-scope-limited .data-status-badge{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:5px 9px;border-radius:7px;font-size:11px;font-weight:700;white-space:nowrap}#tab-data.data-scope-limited .data-type-badge:before,#tab-data.data-scope-limited .data-status-badge:before{content:\"\";width:5px;height:5px;border-radius:50%;background:currentColor}#tab-data.data-scope-limited .data-type-new{background:#fef3c7;color:#d97706}#tab-data.data-scope-limited .data-type-return{background:#fee2e2;color:#dc2626}#tab-data.data-scope-limited .data-type-retry{background:#dbeafe;color:#2563eb}#tab-data.data-scope-limited .data-status-waiting{background:#fef3c7;color:#d97706}#tab-data.data-scope-limited .data-status-accepted{background:#dcfce7;color:#15803d}#tab-data.data-scope-limited .data-status-unassigned{background:#f1f5f9;color:#64748b}#tab-data.data-scope-limited .data-status-expired{background:#fee2e2;color:#dc2626}
      @media(max-width:760px){#tab-data.data-scope-limited #dataSubViewQueue>.table-container{overflow:hidden}#tab-data.data-scope-limited .data-queue-filterbar{display:grid!important;grid-template-columns:1fr!important}#tab-data.data-scope-limited .data-queue-filterbar input,#tab-data.data-scope-limited .data-queue-filterbar select{width:100%;box-sizing:border-box}#tab-data.data-scope-limited .table-responsive{overflow-x:auto}#tab-data.data-scope-limited .modern-table{min-width:760px}}
    `;document.head.appendChild(style);}
    tab.classList.toggle('data-scope-limited',role==='SALE');
    tab.classList.toggle('data-scope-admin',['ADMIN','MANAGER','LEADER'].includes(role));
    tab.classList.toggle('data-scope-management',['ADMIN','MANAGER','LEADER'].includes(role));
    mountManagementDataShell(role);
    const filterBar=tab.querySelector('#dataSubViewQueue .table-container>div:nth-child(2)');
    filterBar?.classList.add('data-queue-filterbar');
    // Admin cần giữ lại bộ điều khiển và thống kê phân phối cũ.
    const hideAdminViews=!['ADMIN','MANAGER'].includes(role);
    ['dataTabQueueBtn','dataTabAutoBtn','dataTabSalesBtn'].forEach(id=>{const node=q('#'+id);if(node){node.hidden=hideAdminViews;node.style.setProperty('display',hideAdminViews?'none':'','important');}});
    [['dataSubViewQueue','queue'],['dataSubViewAuto','auto'],['dataSubViewSales','sales']].forEach(([id,key])=>{const node=q('#'+id);if(node){const active=tab.querySelector('.sub-tab-btn.active')?.id==='dataTabAutoBtn'?'auto':tab.querySelector('.sub-tab-btn.active')?.id==='dataTabSalesBtn'?'sales':'queue',visible=hideAdminViews?key==='queue':key===active;node.hidden=!visible;node.style.setProperty('display',visible?(key==='queue'?'grid':'block'):'none','important');}});
    const legacyLeaders=q('#dataSubViewLeaders');if(legacyLeaders){legacyLeaders.hidden=true;legacyLeaders.style.setProperty('display','none','important');}
    const salesLabel=q('#dataTabSalesBtn');if(salesLabel)salesLabel.textContent='Chỉnh sửa tỷ trọng';
    const legacyButton=q('#dataTabLeadersBtn');if(legacyButton){legacyButton.hidden=true;legacyButton.style.setProperty('display','none','important');}
    const autoLabel=q('#dataTabAutoBtn');if(autoLabel)autoLabel.textContent='Chia Data';
    if(['ADMIN','MANAGER'].includes(role))renderDistributionWeights();
    renderAutoRecipientStats();
    const title=tab.querySelector('.headline-row h1');if(title)title.textContent=role==='SALE'?'Data m\u1edbi h\u00f4m nay':role==='ADMIN'?'Data M\u1edbi':'Data';
    const queueTitle=tab.querySelector('#dataSubViewQueue .table-head-bar b');if(queueTitle)queueTitle.textContent=role==='SALE'?'Data m\u1edbi h\u00f4m nay':role==='ADMIN'?'Data M\u1edbi':'Data ch\u01b0a x\u1eed l\u00fd';
    const queueSubtitle=tab.querySelector('#dataSubViewQueue .table-head-bar b + div');if(queueSubtitle){queueSubtitle.textContent='';queueSubtitle.hidden=true;}
    const statsSubtitle=tab.querySelector('#dataSubViewQueue > div:nth-child(2) .widget-box:first-child b + div');if(statsSubtitle){statsSubtitle.textContent='';statsSubtitle.hidden=true;}
    const selectAll=tab.querySelector('#dataSubViewQueue .table-head-bar button');if(selectAll){selectAll.hidden=role!=='ADMIN';selectAll.style.setProperty('display',role==='ADMIN'?'':'none','important');}
    q('#dataDistributionStatusPanel')?.remove();

    const typeFilter=q('#dataQueueTypeFilter');if(typeFilter)typeFilter.innerHTML=opt('', '\u0054\u1ea5t c\u1ea3 lo\u1ea1i data')+['DATA M\u1edaI','DATA TR\u1ea2 V\u1ec0','DATA \u0110I\u1ec0N L\u1ea0I FORM'].map(value=>opt(value,value,typeFilter.value)).join('');
    if(role!=='SALE'){const sourceFilter=q('#dataQueueSourceFilter'),selected=sourceFilter?.value||'';if(sourceFilter)sourceFilter.innerHTML=opt('','Tất cả nguồn',selected)+(data.websites||[]).map(w=>opt(w.name||w.domain,w.name||w.domain,selected)).join('');}
    if(role!=='ADMIN'&&role!=='SALE'){const sourceFilter=q('#dataQueueSourceFilter');if(sourceFilter){sourceFilter.hidden=true;sourceFilter.setAttribute('aria-hidden','true');}}
    if(role==='SALE'&&q('#dataSubViewQueue')){
      const sourceFilter=q('#dataQueueSourceFilter'),typeFilter=q('#dataQueueTypeFilter');
      if(sourceFilter){sourceFilter.hidden=true;sourceFilter.setAttribute('aria-hidden','true');}
      if(typeFilter){typeFilter.hidden=false;typeFilter.removeAttribute('aria-hidden');}
    }
  }
  function isWebhookDataCustomer(customer){
    if(!customer)return false;
    const source=String(customer.source||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').trim().toLowerCase();
    // New order customers carry a marker; older records only have the source label.
    if(customer.createdVia==='ORDER'||customer.manualEntry===true||['nhap don hang','khach hang cu','khach hang ngoai data'].includes(source))return false;
    return Boolean(customer.webhookEventId||customer.webhookSlug||['landing page','landing page webhook','webhook'].includes(source));
  }
  function renderManagementDataTable(role){
    const body=q('#dataQueueTableBody'),table=body?.closest('table');
    if(!body||!table||!['ADMIN','MANAGER','LEADER'].includes(role))return;
    const members=data.managerHierarchy?.members||data.members||[],currentId=data.user.id;
    const leaders=role==='ADMIN'?members.filter(m=>m.active!==false&&m.role==='LEADER'):role==='MANAGER'?members.filter(m=>m.active!==false&&m.role==='LEADER'&&m.managerId===currentId):members.filter(m=>m.active!==false&&m.role==='LEADER'&&m.id===currentId);
    const leaderIds=new Set(leaders.map(m=>m.id));
    const sales=role==='ADMIN'?members.filter(m=>m.active!==false&&m.role==='SALE'):members.filter(m=>m.active!==false&&m.role==='SALE'&&(leaderIds.has(m.leaderId)||(role==='MANAGER'&&m.managerId===currentId)));
    const salesIds=new Set(sales.map(m=>m.id));
    const visible=role==='ADMIN'?data.customers.filter(c=>isWebhookDataCustomer(c)):data.customers.filter(c=>isWebhookDataCustomer(c)&&(role==='MANAGER'?(c.ownerId===currentId||c.managerId===currentId||leaderIds.has(c.leaderId)||salesIds.has(c.saleId)):(c.ownerId===currentId||c.leaderId===currentId||salesIds.has(c.saleId))));
    const websiteFor=customer=>(data.websites||[]).find(item=>item.id===customer?.websiteId||item.webhookSlug===customer?.webhookSlug||item.sourceUrl===customer?.source||item.webhookUrlOverride===customer?.source||item.publicWebhookUrl===customer?.source);
    const validUrl=value=>{try{const url=new URL(String(value||'').trim());return ['http:','https:'].includes(url.protocol)?url.toString():'';}catch{return '';}};
    const sourceUrlFor=customer=>{const website=websiteFor(customer);return validUrl(customer?.landingPageUrl)||validUrl(website?.sourceUrl)||validUrl(website?.webhookUrlOverride)||validUrl(website?.publicWebhookUrl);};
    const sourceNameFor=customer=>{const website=websiteFor(customer),name=String(website?.name||customer?.landingPageName||customer?.source||'').trim();return name&&name.toUpperCase()!=='UNATTRIBUTED'&&name.toLowerCase()!=='landing page'?name:'Chưa gắn nguồn';};
    const latestOffer=customer=>(data.offers||[]).filter(item=>item.customerId===customer.id).sort((a,b)=>(a.status==='PENDING'?0:1)-(b.status==='PENDING'?0:1)||String(b.offeredAt||'').localeCompare(String(a.offeredAt||'')))[0];
    const returns=new Map();
    (data.resubmissions||[]).forEach(item=>{
      const previous=returns.get(item.customerId);
      if(!previous||String(item.at||'')>String(previous.at||''))returns.set(item.customerId,item);
    });
    const rows=visible.map(customer=>{
      const offer=latestOffer(customer),returned=returns.get(customer.id),returnAt=String(returned?.at||''),lastIntakeAt=String(customer.lastIntakeAt||''),updatedAt=String(customer.updatedAt||'');
      const isCurrentResubmission=Boolean(returned&&returnAt&&((customer.lastIntakeType==='RESUBMISSION'&&lastIntakeAt===returnAt)||(!customer.lastIntakeType&&updatedAt===returnAt)));
      const type=isCurrentResubmission?'DATA ĐIỀN LẠI FORM':offer?.status==='EXPIRED'&&!customer.saleId?'DATA TRẢ VỀ':'DATA MỚI';
      const at=isCurrentResubmission?returnAt:(type==='DATA TRẢ VỀ'?(offer?.resolvedAt||offer?.offeredAt):customer.createdAt);
      return {customer,offer,type,at:at||customer.createdAt};
    });
    const countSince=days=>{const start=fromDay(days),end=String(data.today||'').slice(0,10);return rows.filter(row=>{const date=String(row.at||'').slice(0,10);return date>=start&&date<=end;}).length;};
    text('dataStatToday',countSince(1)+' data');text('dataStat3Days',countSince(3)+' data');text('dataStat7Days',countSince(7)+' data');text('dataStat30Days',countSince(30)+' data');
    const query=String(q('#dataQueueSearch')?.value||'').trim().toLowerCase(),sourceFilter=role==='ADMIN'?String(q('#dataQueueSourceFilter')?.value||''):'',rawType=String(q('#dataQueueTypeFilter')?.value||'');
    const dateFrom=String(dataQueueDateFrom||'').slice(0,10),dateTo=String(dataQueueDateTo||'').slice(0,10);
    const typeFilter=rawType==='Data mới'?'DATA MỚI':rawType==='Data trả về'?'DATA TRẢ VỀ':rawType==='Điền lại form'||rawType==='Data điền lại form'?'DATA ĐIỀN LẠI FORM':rawType;
    const filtered=rows.filter(row=>{const c=row.customer,name=String(c.name||'').toLowerCase(),phone=String(c.phone||'').toLowerCase(),source=sourceNameFor(c),date=String(row.at||c.createdAt||'').slice(0,10);return(!query||name.includes(query)||phone.includes(query))&&(!sourceFilter||source===sourceFilter)&&(!typeFilter||row.type===typeFilter)&&(!dateFrom&&!dateTo||(dateFrom&&dateTo?date>=dateFrom&&date<=dateTo:date===(dateFrom||dateTo)));}).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))||String(a.customer.id).localeCompare(String(b.customer.id)));
    const recipients=(role==='ADMIN'?members.filter(m=>m.active!==false&&['MANAGER','LEADER','SALE'].includes(m.role)):role==='MANAGER'?[{...data.user,role:'MANAGER',actualRole:'MANAGER'},...leaders,...sales]:[{...data.user,role:'LEADER'},...sales]).filter((member,index,list)=>member?.id&&list.findIndex(item=>item.id===member.id)===index).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'vi'));
    filtered.forEach(row=>{const assigned=row.offer?.status==='PENDING'&&row.offer?.saleId?row.offer.saleId:(row.customer.saleId||row.customer.leaderId||row.customer.managerId);if(assigned&&!recipients.some(member=>member.id===assigned)){const member=members.find(item=>item.id===assigned&&item.active!==false&&item.active!==0&&item.active!=='0');if(member)recipients.push(member);}});
    if(!q('#referenceManagementDataStyles')){const style=document.createElement('style');style.id='referenceManagementDataStyles';style.textContent='#tab-data.data-scope-management #dataSubViewQueue>.table-container{width:100%;min-width:0;border:1px solid #dbe3ec;border-radius:0;background:#fff;box-shadow:none}#tab-data.data-scope-management #dataSubViewQueue>.table-container>.table-head-bar{display:none!important}#tab-data.data-scope-management #dataQueueFilters{padding:12px 18px;border-bottom:1px solid #e2e8f0;background:#fff}#tab-data.data-scope-management #dataQueueTableBody td{padding:13px 16px;vertical-align:middle;border-bottom:1px solid #e8edf3;color:#0f172a;font-size:12px}#tab-data.data-scope-management #dataQueueTableBody tr:hover{background:#f8fafc}#tab-data.data-scope-management #dataQueueTableBody td small{display:block;margin-top:4px;color:#64748b;font-size:10.5px;line-height:1.25}#tab-data.data-scope-management .data-phone{white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700}#tab-data.data-scope-management .data-type-badge{display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border-radius:8px;font-size:11px;font-weight:800;white-space:nowrap}#tab-data.data-scope-management .data-type-badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}#tab-data.data-scope-management .data-type-new{background:#fff0bf;color:#b96900}#tab-data.data-scope-management .data-type-return{background:#fee2e2;color:#c81e1e}#tab-data.data-scope-management .data-type-retry{background:#dbeafe;color:#2563eb}#tab-data.data-scope-management .data-source{max-width:245px;line-height:1.35}#tab-data.data-scope-management .data-source a{display:block;color:#155bd7;font-weight:800;text-decoration:none;overflow-wrap:anywhere}#tab-data.data-scope-management .data-source a:hover{text-decoration:underline}#tab-data.data-scope-management .management-sale-select{display:block;width:205px;max-width:100%;min-height:38px;padding:8px 12px;border:1.5px solid #f08a00;border-radius:10px;background:#fff;color:#111827;font:700 12px var(--font-sans,Arial,sans-serif);outline:0}#tab-data.data-scope-management .management-sale-select:focus{border-color:#d97706;box-shadow:0 0 0 3px rgba(245,158,11,.16)}#tab-data.data-scope-management .management-sale-select:disabled{opacity:.65}#tab-data.data-scope-management .management-data-actions{display:flex;align-items:center;gap:7px;white-space:nowrap}#tab-data.data-scope-management .management-data-actions button{min-height:34px;padding:7px 10px;border:1px solid transparent;border-radius:7px;font:700 11px var(--font-sans,Arial,sans-serif);cursor:pointer}#tab-data.data-scope-management .management-data-actions button:disabled{opacity:.55;cursor:wait}#tab-data.data-scope-management .management-reassign-button{background:#2563eb;border-color:#2563eb;color:#fff}#tab-data.data-scope-management .management-reassign-button:hover{background:#1d4ed8}#tab-data.data-scope-management .management-delete-button{background:#dc2626;border-color:#dc2626;color:#fff}#tab-data.data-scope-management .management-delete-button:hover{background:#b91c1c}#tab-data.data-scope-management .data-status-badge{display:inline-flex;align-items:center;min-height:29px;margin-top:4px;padding:7px 11px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap}#tab-data.data-scope-management .data-status-waiting{background:#fff0bf;color:#9a6700}#tab-data.data-scope-management .data-status-accepted{background:#d9f8e4;color:#168044}#tab-data.data-scope-management .data-status-unassigned{background:#f1f5f9;color:#64748b}#tab-data.data-scope-management .data-status-expired{background:#fee2e2;color:#c81e1e}@media(max-width:860px){#tab-data.data-scope-management #dataSubViewQueue{display:block!important}#tab-data.data-scope-management #dataSubViewQueue>.table-container{overflow:hidden}#tab-data.data-scope-management #dataSubViewQueue>.table-container .table-responsive{overflow-x:auto}#tab-data.data-scope-management #dataSubViewQueue>.table-container .modern-table{min-width:1050px}}';document.head.appendChild(style);}
    const hasSource=role==='ADMIN',head=table.querySelector('thead tr');if(head)head.innerHTML=(hasSource?['THỨ TỰ','NGÀY DATA','KHÁCH HÀNG','SỐ ĐIỆN THOẠI','LOẠI DATA','NGUỒN','SALE PHỤ TRÁCH','THAO TÁC']:['THỨ TỰ','NGÀY DATA','KHÁCH HÀNG','SỐ ĐIỆN THOẠI','LOẠI DATA','SALE PHỤ TRÁCH','THAO TÁC']).map(label=>'<th>'+label+'</th>').join('');
    const typeClass=type=>type==='DATA TRẢ VỀ'?'data-type-return':type==='DATA ĐIỀN LẠI FORM'?'data-type-retry':'data-type-new';
    const statusFor=(customer,offer,type)=>offer?.status==='PENDING'?(type==='DATA TR\u1ea2 V\u1ec0'?'\u0110\u00e3 ph\u00e2n l\u1ea1i \u00b7 ch\u1edd Sale nh\u1eadn':'Ch\u1edd Sale nh\u1eadn'):offer?.status==='EXPIRED'&&!customer.saleId?'Data Sale kh\u00f4ng nh\u1eadn':customer.saleId?'Sale \u0111\u00e3 nh\u1eadn':customer.managerId?'\u0110\u00e3 ph\u00e2n Manager':customer.leaderId?'\u0110\u00e3 ph\u00e2n Leader':'Ch\u01b0a ch\u1ecdn Sale';
    const statusClass=status=>['Sale đã nhận','Đã phân Manager','Đã phân Leader'].includes(status)?'data-status-accepted':status==='Data Sale không nhận'?'data-status-expired':status==='Chưa chọn Sale'?'data-status-unassigned':'data-status-waiting';
    const recipientLabel=member=>member.role==='MANAGER'?' (Manager)':member.role==='LEADER'?' (Leader)':'';
    body.innerHTML=filtered.map((row,index)=>{const c=row.customer,offer=row.offer,assigned=c.saleId||offer?.saleId||c.leaderId||c.managerId||'',status=statusFor(c,offer,row.type),sourceUrl=sourceUrlFor(c),sourceName=sourceNameFor(c),sourceHtml=sourceUrl?'<a href="'+esc(sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(sourceUrl)+'</a>':'<span>Chưa gắn nguồn</span>',options='<option value="">— Chưa chọn —</option>'+recipients.map(member=>'<option value="'+esc(member.id)+'" '+(member.id===assigned?'selected':'')+'>'+esc(member.name||'Chưa đặt tên')+recipientLabel(member)+'</option>').join(''),sourceCell=hasSource?'<td><div class="data-source">'+sourceHtml+'<small>'+esc(sourceName)+'</small></div></td>':'',actionCell='<td><div class="management-data-actions"><button type="button" class="management-reassign-button" data-management-reassign="'+esc(c.id)+'">Phân lại</button>'+(hasSource?'<button type="button" class="management-delete-button" data-management-delete="'+esc(c.id)+'">Xóa</button>':'')+'</div></td>';return '<tr><td><b>#'+(index+1)+'</b></td><td><b>'+esc(fmtDate(String(row.at||c.createdAt||'').slice(0,10)))+'</b><small>'+esc(String(row.at||c.createdAt||'').slice(11,16))+'</small></td><td><b>'+esc(c.name||'—')+'</b></td><td><span class="data-phone">'+esc(c.phone||'—')+'</span></td><td><span class="data-type-badge '+typeClass(row.type)+'">'+esc(row.type)+'</span></td>'+sourceCell+'<td><select class="management-sale-select" data-management-sale="'+esc(c.id)+'" data-previous="'+esc(assigned)+'" aria-label="Chọn người phụ trách cho '+esc(c.name||'khách hàng')+'">'+options+'</select><small class="data-status-badge '+statusClass(status)+'">'+esc(status)+'</small></td>'+actionCell+'</tr>';}).join('')||'<tr><td colspan="'+(hasSource?8:7)+'"><div class="empty"><b>Không có data</b><span>Data mới sẽ xuất hiện ở đây.</span></div></td></tr>';
    body.querySelectorAll('[data-management-sale]').forEach(select=>select.onchange=()=>{if(!select.value)select.value=select.dataset.previous||'';});
    body.querySelectorAll('[data-management-reassign]').forEach(button=>button.onclick=async()=>{const row=button.closest('tr'),select=row?.querySelector('[data-management-sale]'),value=String(select?.value||''),previous=select?.dataset.previous||'',member=recipients.find(item=>item.id===value);if(!value){referenceNotice('Hãy chọn người phụ trách trước khi phân lại.','error');select?.focus();return;}button.disabled=true;if(select)select.disabled=true;const result=await run(()=>api.assign(button.dataset.managementReassign,value));if(result!==null){if(select)select.dataset.previous=value;referenceNotice('Đã phân lại data thành công cho '+(member?.name||'người phụ trách')+'.');}else if(select)select.value=previous;button.disabled=false;if(select)select.disabled=false;});
    body.querySelectorAll('[data-management-delete]').forEach(button=>button.onclick=async()=>{const customer=data.customers.find(item=>item.id===button.dataset.managementDelete),name=customer?.name||'data';if(!await referenceConfirmDelete(name))return;button.disabled=true;const result=await run(()=>api.deleteCustomer(button.dataset.managementDelete));if(result!==null)referenceNotice('Đã xóa data '+name+' thành công.');button.disabled=false;});
    const countPeriod=days=>rows.filter(row=>String(row.at||row.customer.createdAt||'').slice(0,10)>=fromDay(days)).length;
    const waitingCount=rows.filter(row=>row.offer?.status==='PENDING').length;
    const acceptedCount=rows.filter(row=>Boolean(row.customer.saleId)&&row.offer?.status!=='PENDING').length;
    const unassignedCount=rows.filter(row=>!row.offer?.saleId&&!row.customer.saleId&&!row.customer.leaderId&&!row.customer.managerId).length;
    renderDataQueuePagination(table,filtered.length);text('sidebarDataBadge',filtered.length);text('dataTabCountBadge',filtered.length);text('dataPeriodToday',countPeriod(1)+' data');text('dataPeriod3Days',countPeriod(3)+' data');text('dataPeriod7Days',countPeriod(7)+' data');text('dataPeriod30Days',countPeriod(30)+' data');text('dataOverviewTotal',rows.length);text('dataOverviewUnassigned',unassignedCount);text('dataOverviewAccepted',acceptedCount);text('dataOverviewWaiting',waitingCount);if(typeof updateDataDateFilterSummary==='function')updateDataDateFilterSummary(filtered.length);
  }

  const localDateValue=date=>{const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');return `${year}-${month}-${day}`;};
  const updateDataDateFilterSummary=(visibleCount=null)=>{
    const summary=q('#dataDateFilterSummary');if(!summary)return;
    const from=String(dataQueueDateFrom||'').slice(0,10),to=String(dataQueueDateTo||'').slice(0,10),applied=Boolean(from||to);
    summary.classList.toggle('is-applied',applied);
    const countText=visibleCount===null?'':' · '+visibleCount+' data';
    summary.textContent=!applied?'Chưa áp dụng bộ lọc'+countText:from&&to?'Đang áp dụng: '+fmtDate(from)+' đến '+fmtDate(to)+countText:'Đang áp dụng: '+fmtDate(from||to)+countText;
    const headerState=q('#dataManagementDateState');if(headerState){headerState.classList.toggle('is-applied',applied);headerState.textContent=!applied?'Chưa lọc theo ngày':from&&to?fmtDate(from)+' - '+fmtDate(to):fmtDate(from||to);}
  };
  const applyDataDateFilter=()=>{
    const from=String(q('#dataDateFrom')?.value||'').slice(0,10),to=String(q('#dataDateTo')?.value||'').slice(0,10);
    if(Boolean(from)!==Boolean(to)){referenceNotice('Vui lòng chọn đủ Từ ngày và Đến ngày.','error');return;}
    if(from&&to&&from>to){referenceNotice('Ngày bắt đầu không được sau ngày kết thúc.','error');return;}
    dataQueueDateFrom=from;dataQueueDateTo=to;dataQueuePage=1;updateDataDateFilterSummary();filterDataQueueTable();
  };
  const clearDataDateFilter=()=>{
    const from=q('#dataDateFrom'),to=q('#dataDateTo');if(from)from.value='';if(to)to.value='';dataQueueDateFrom='';dataQueueDateTo='';dataQueuePage=1;updateDataDateFilterSummary();filterDataQueueTable();
  };
  q('#dataDateFilterClose')?.addEventListener('click',event=>{
    const panel=q('#dataDateFilterPanel');if(!panel)return;
    if(panel.closest('#tab-data.data-scope-management')){const collapsed=panel.classList.toggle('is-collapsed');event.currentTarget.setAttribute('aria-expanded',String(!collapsed));event.currentTarget.setAttribute('aria-label',collapsed?'Mở bộ lọc':'Thu gọn bộ lọc');return;}
    const collapsed=panel.classList.toggle('is-collapsed');event.currentTarget.setAttribute('aria-expanded',String(!collapsed));event.currentTarget.setAttribute('aria-label',collapsed?'Mở bộ lọc':'Thu gọn bộ lọc');event.currentTarget.textContent=collapsed?'+':'×';
  });
  q('#dataDateApply')?.addEventListener('click',applyDataDateFilter);
  q('#dataDateClear')?.addEventListener('click',clearDataDateFilter);
  updateDataDateFilterSummary();
  const ordinaryQueue=renderDataQueue;renderDataQueue=function(){
    const role=data?.user?.actualRole||data?.user?.role;
    if(['ADMIN','MANAGER','LEADER'].includes(role)){
      renderManagementDataTable(role);
      return;
    }
    if(role!=='SALE')ordinaryQueue();
    if(role==='SALE'){
      const search=String(q('#dataQueueSearch')?.value||'').trim().toLowerCase();
      // Hiển thị toàn bộ data còn hiệu lực đang chờ Sale nhận, không giới hạn theo ngày lịch.
      // Badge đếm tất cả offer nên bảng cũng phải dùng cùng tập dữ liệu để không bị lệch số.
      const items=(data.pendingOffers||[])
        .filter(o=>String(o.name||'').toLowerCase().includes(search))
        .sort((a,b)=>String(a.offeredAt||'').localeCompare(String(b.offeredAt||'')));
      if(!q('#saleDataAcceptStyles')){const style=document.createElement('style');style.id='saleDataAcceptStyles';style.textContent='#tab-data .sale-data-countdown{display:inline-flex;align-items:center;min-height:28px;padding:5px 10px;border-radius:7px;background:#fff7ed;color:#c2410c;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}#tab-data .sale-accept-data{justify-content:center;background:#059669;color:#fff;border:1px solid #059669;box-shadow:0 3px 10px rgba(5,150,105,.2)}#tab-data .sale-accept-data:hover{background:#047857;border-color:#047857;box-shadow:0 5px 14px rgba(5,150,105,.28)}#tab-data .sale-accept-data:disabled{opacity:.6;cursor:wait}';document.head.appendChild(style);}
      const body=q('#dataQueueTableBody');
      body.innerHTML=items.map((o,index)=>{const minutes=Math.max(0,Number(o.minutesLeft)||0),countdown=Math.floor(minutes/60)+' giờ '+(minutes%60)+' phút';return '<tr><td><b>#'+(index+1)+'</b></td><td>'+esc(fmtDate(String(o.offeredAt||'').slice(0,10)))+'</td><td><b>'+esc(o.name)+'</b></td><td><span class="sale-data-countdown">'+esc(countdown)+'</span></td><td><button type="button" class="btn-action sale-accept-data" data-accept-offer="'+esc(o.id)+'">Nhận data</button></td></tr>';}).join('')||'<tr><td colspan="5"><div class="empty"><b>Không có data chờ nhận</b></div></td></tr>';
      body.querySelectorAll('[data-accept-offer]').forEach(button=>button.onclick=async()=>{
        if(button.dataset.busy==='1')return;
        const label=button.textContent;
        button.dataset.busy='1';button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='\u0110ang nh\u1eadn...';
        try{
          const result=await run(()=>api.acceptOffer(button.dataset.acceptOffer));
          if(result?.ok){
            // Giữ nguyên tab Data, bộ lọc và trang hiện tại để Sale có thể nhận tiếp data còn lại.
            // run() sẽ tải snapshot mới và dựng lại đúng tab đang mở.
          }
        }finally{button.dataset.busy='';button.disabled=false;button.removeAttribute('aria-busy');button.textContent=label;}
      });
      // Thong ke data duoc giao khong giam khi Sale bam nhan.
      const assigned=data.assignedDataStats||{today:0,threeDays:0,sevenDays:0};
      text('sidebarDataBadge',(data.pendingOffers||[]).length);
      renderDataQueuePagination(body.closest('table'),items.length);
      text('dataTabCountBadge',items.length);
      text('dataStatToday',assigned.today+' data');
      text('dataStat3Days',assigned.threeDays+' data');
      text('dataStat7Days',assigned.sevenDays+' data');
      text('dataStat30Days',(assigned.thirtyDays??data.customers.filter(c=>c.createdAt?.slice(0,10)>=fromDay(30)).length)+' data');
    }
    bindReferenceDeleteButtons();
  };
  const ordinaryQueueFilter=filterDataQueueTable;filterDataQueueTable=()=>{const role=data?.user?.actualRole||data?.user?.role;return ['ADMIN','MANAGER','LEADER','SALE'].includes(role)?renderDataQueue():ordinaryQueueFilter();};
  const originalTeamPeriod=filterTeamPeriod;filterTeamPeriod=(period,button)=>{originalTeamPeriod(period,button);if(data)team();};
  ['#teamStartDate','#teamEndDate'].forEach(id=>q(id)?.addEventListener('change',()=>team()));
  if(!q('#liveClockDisplay')){const clock=document.createElement('time');clock.id='liveClockDisplay';clock.setAttribute('aria-label','Giờ hiện tại');clock.style.cssText='font:500 11px var(--font-mono);font-variant-numeric:tabular-nums;color:var(--text-muted);white-space:nowrap';q('#themeBtn')?.before(clock);updateLiveClock();}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  // Không dùng thời gian chờ để suy luận rằng người dùng đã đăng xuất.
  const revealLoginFallback=()=>{
    if(data||!bootScreen)return;
    try{refresh(true);}catch(error){console.error('[crm-boot]',error);}
    if(!data&&!bootScreen.hidden)bootFallbackTimer=setTimeout(revealLoginFallback,500);
  };
  window.addEventListener('crm:session-changed',()=>refresh(true));
  window.addEventListener('crm:state-changed',()=>refresh());
  const cachedSnapshot=readCachedSnapshot();
  if(cachedSnapshot){
    try{refresh(true,cachedSnapshot);}catch(error){
      // Cache cũ không dựng được thì chờ snapshot thật, không lộ HTML mẫu.
      data=null;signature='';renderedTabs.clear();clearCachedSnapshot();
      console.warn('[crm-cache-render]',error);
    }
  }
  // Catch a session that became ready before this script attached its listener.
  refresh(true);
  if(!data){
    bootFallbackTimer=setTimeout(revealLoginFallback,storedSession()?.token?800:250);
  }
  refreshTimer=setInterval(()=>{if(!document.hidden){refresh();if(q('#tab-audit.active')){loadUserActivity();loadOrderAudit();}}},15000);frame.addEventListener('load',()=>refresh(true));
})();
