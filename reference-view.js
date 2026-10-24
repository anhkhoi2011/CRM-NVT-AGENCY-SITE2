// Các hàm trình bày lấy nguyên từ giao diện tham chiếu. Adapter thay thao tác mô phỏng bằng CRM.
let appState = { customers: [], orders: [], careGroups: [] };
const CARE_PAGE_SIZE = 20;
const carePageByGroup = Object.create(null);
let customerPage = 1;
let customerPageSize = 10;
let customerFilterSignature = '';

// Keep table filters outside the DOM. The reference renderer rebuilds the
// select elements after every snapshot, so DOM-only state can be lost.
const customerFilterState = window.nvtCustomerFilterState || (window.nvtCustomerFilterState = { owner: 'ALL', sale: 'ALL' });

customerFilterState.columns ||= {};
let customerColumnDefinitions = [];
function customerColumnValues(value) {
  const values=Array.isArray(value)?value:[value];
  return values.length?values.map(item=>item==null?'':String(item)):[''];
}
function matchesCustomerColumnFilters(customer) {
  return customerColumnDefinitions.every(column=>{
    const selected=customerFilterState.columns[column.key];
    return selected===undefined || customerColumnValues(column.value(customer)).includes(selected);
  });
}

function normalizeCustomerFilterPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = digits.slice(2);
  if (digits.startsWith('84') && digits.length >= 11) digits = '0' + digits.slice(2);
  return digits;
}

function sameCustomerFilterId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function pendingOfferForCustomer(customer) {
  const customerId = customer?.id;
  if (!customerId) return null;
  const offers = Array.isArray(appState.offers) ? appState.offers : [];
  return offers
    .filter(offer => offer && offer.customerId === customerId && offer.status === 'PENDING' && offer.saleId)
    .sort((a, b) => String(b.offeredAt || '').localeCompare(String(a.offeredAt || '')))[0] || null;
}

function assignedSaleIdForCustomer(customer) {
  const pending = pendingOfferForCustomer(customer);
  const members = Array.isArray(appState.members) ? appState.members : [];
  const owner = members.find(member => sameCustomerFilterId(member.id, customer?.ownerId));
  // Explicit assignment wins; hierarchy IDs only represent a direct recipient
  // when acceptance is recorded and no sale/owner is assigned.
  if (pending?.saleId) return pending.saleId;
  if (customer?.saleId) return customer.saleId;
  if (owner && ['SALE','LEADER','MANAGER'].includes(owner.role)) return owner.id;
  if (customer?.saleAcceptedAt) return customer.managerId || customer.leaderId || null;
  return null;
}

function ensureCustomerPaginationStyles() {
  if (document.getElementById('customerPaginationStyles')) return;
  const style = document.createElement('style');
  style.id = 'customerPaginationStyles';
  style.textContent = '#customerPagination{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-height:68px;padding:12px 16px;border-top:1px solid #dbe3ec;background:#fff;color:#64748b;font-size:12px;box-sizing:border-box}#customerPagination[hidden]{display:none}.customer-pagination-summary{margin-right:auto}.customer-pagination-size{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}.customer-pagination-size select{height:34px;min-width:70px;padding:0 9px;border:1px solid #dbe3ec;border-radius:7px;background:#fff;color:#0f172a;font:inherit}.customer-pagination-button{display:grid;place-items:center;width:38px;height:38px;border:1px solid #dbe3ec;border-radius:8px;background:#fff;color:#1e293b;font-size:22px;line-height:1;cursor:pointer}.customer-pagination-button:hover:not(:disabled){border-color:#93c5fd;background:#eff6ff;color:#2563eb}.customer-pagination-button:disabled{cursor:not-allowed;opacity:.45}.customer-pagination-current{min-width:46px;text-align:center;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums}@media(max-width:680px){#customerPagination{justify-content:flex-start;gap:8px;flex-wrap:wrap;padding:10px 12px}.customer-pagination-summary{width:100%;margin-right:0}.customer-pagination-size{margin-right:auto}}';
  document.head.appendChild(style);
}

function renderCustomerPagination(total) {
  const host = document.getElementById('customerPagination');
  if (!host) return;
  ensureCustomerPaginationStyles();
  const pages = Math.max(1, Math.ceil(total / customerPageSize));
  customerPage = Math.min(customerPage, pages);
  if (!total) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const from = (customerPage - 1) * customerPageSize + 1;
  const to = Math.min(customerPage * customerPageSize, total);
  host.hidden = false;
  host.innerHTML = '<span class="customer-pagination-summary">Hiển thị ' + from + '–' + to + ' / ' + total + ' data</span><label class="customer-pagination-size">Số dòng <select aria-label="Số khách hàng mỗi trang">' + [10, 20, 50, 100, 200].map(size => '<option value="' + size + '" ' + (size === customerPageSize ? 'selected' : '') + '>' + size + '</option>').join('') + '</select></label><button type="button" class="customer-pagination-button" data-customer-page="prev" aria-label="Trang trước" ' + (customerPage === 1 ? 'disabled' : '') + '>‹</button><span class="customer-pagination-current">' + customerPage + ' / ' + pages + '</span><button type="button" class="customer-pagination-button" data-customer-page="next" aria-label="Trang sau" ' + (customerPage === pages ? 'disabled' : '') + '>›</button>';
  host.querySelector('select').onchange = event => {
    customerPageSize = Number(event.target.value) || 10;
    customerPage = 1;
    renderCustomerTable();
  };
  host.querySelector('[data-customer-page="prev"]').onclick = () => {
    if (customerPage > 1) {
      customerPage--;
      renderCustomerTable();
    }
  };
  host.querySelector('[data-customer-page="next"]').onclick = () => {
    if (customerPage < pages) {
      customerPage++;
      renderCustomerTable();
    }
  };
}
function setCarePage(groupId, page) {
  carePageByGroup[groupId] = Math.max(1, Number(page) || 1);
  if (typeof window.renderCareView === 'function') window.renderCareView();
}
window.setCarePage = setCarePage;
  function matchesPersonnelCustomer(customer, ownerId, members) {
    if (!ownerId || ownerId === 'ALL') return true;
    const sameId=(left,right)=>left!=null&&right!=null&&String(left)===String(right);
    const pendingOffer = (typeof appState !== 'undefined' ? appState.offers || [] : [])
      .filter(offer => offer && offer.customerId === customer.id && offer.status === 'PENDING' && offer.saleId)
      .sort((a, b) => String(b.offeredAt || '').localeCompare(String(a.offeredAt || '')))[0];
    const ownerMember=members.find(member=>sameId(member.id,customer.ownerId));
    const assignedSaleId=pendingOffer?.saleId||customer.saleId||(ownerMember?.role==='SALE'?ownerMember.id:null);
    if (ownerId === 'UNASSIGNED') return !assignedSaleId && !customer.leaderId && !customer.managerId && !customer.ownerId;
    const member = members.find(m => sameId(m.id, ownerId));
    if (!member) return false;
    const ids = new Set([String(ownerId)]);
    if (member.role === 'MANAGER') {
      members.filter(m => m.role === 'LEADER' && sameId(m.managerId, ownerId)).forEach(m => ids.add(String(m.id)));
      members.filter(m => m.role === 'SALE' && (sameId(m.managerId, ownerId) || ids.has(String(m.leaderId)))).forEach(m => ids.add(String(m.id)));
      return sameId(customer.managerId, ownerId) || ids.has(String(customer.ownerId)) || ids.has(String(customer.leaderId)) || ids.has(String(assignedSaleId));
    }
    if (member.role === 'LEADER') {
      members.filter(m => m.role === 'SALE' && sameId(m.leaderId, ownerId)).forEach(m => ids.add(String(m.id)));
      return sameId(customer.leaderId, ownerId) || ids.has(String(assignedSaleId)) || ids.has(String(customer.ownerId));
    }
    return sameId(assignedSaleId, ownerId) || sameId(customer.ownerId, ownerId);
  }
  // Đồng hồ chạy thời gian thực
  const escapeCustomerLabel=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function customerPersonnelLabels(customer) {
    const assignedSaleId=assignedSaleIdForCustomer(customer),members=appState.members||[],byId=id=>members.find(member=>member.id===id),assigned=byId(assignedSaleId),directLeader=byId(customer.leaderId),directManager=byId(customer.managerId);
    let sale=assigned,leader=directLeader,manager=directManager;
    if(sale?.role==='MANAGER'){manager=sale;leader=null;}
    else if(sale?.role==='LEADER'){leader=sale;manager=byId(sale.managerId)||manager;}
    if(!leader&&sale?.leaderId)leader=byId(sale.leaderId);
    if(!manager&&leader?.managerId)manager=byId(leader.managerId);
    if(!manager&&sale?.managerId)manager=byId(sale.managerId);
    const teamLeader=sale?.role==='LEADER'||sale?.role==='MANAGER'?manager:leader||manager;
    return {teamLeader:teamLeader?.name||'',sale:sale?.name||''};
  }
  function updateLiveClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
    const dateStr = now.toLocaleDateString('vi-VN');
    const el = document.getElementById('liveClockDisplay');
    if (el) el.innerText = `${timeStr} · ${dateStr}`;
  }
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // ── 2. RENDER KHÁCH HÀNG TỔNG (ẢNH 1) ──
  function renderCustomerTable() {
    const tbody = document.getElementById('customerTableBody');
    const rawSearchVal = document.getElementById('custSearchInput')?.value || '';
    const searchVal = rawSearchVal.toLowerCase().trim();
    const statusVal = document.getElementById('custStatusFilter')?.value || 'ALL';
    const assignVal = document.getElementById('custAssignFilter')?.value || 'ALL';
    const ownerSelect = document.getElementById('custOwnerFilter');
    const ownerVal = customerFilterState.owner || ownerSelect?.value || 'ALL';
        const filterSignature = [searchVal, statusVal, assignVal, ownerVal, JSON.stringify(customerFilterState.columns)].join('\u0001');
    if (filterSignature !== customerFilterSignature) {
      customerFilterSignature = filterSignature;
      customerPage = 1;
    }

    const normalizedSearchPhone = normalizeCustomerFilterPhone(rawSearchVal);
    const filtered = appState.customers.filter(c => {
      const phone = String(c.phone || '');
      const searchableText = (c.name + ' ' + phone + ' ' + normalizeCustomerFilterPhone(phone) + ' ' + c.email + ' ' + c.level + ' ' + c.note).toLowerCase();
      const matchText = !searchVal || searchableText.includes(searchVal) || (normalizedSearchPhone && searchableText.includes(normalizedSearchPhone));
      const matchStatus = statusVal === 'ALL' || c.status === statusVal;
      const assignedSaleId = assignedSaleIdForCustomer(c);
      const matchAssign = assignVal === 'ALL' || (assignVal === 'UNASSIGNED' ? !assignedSaleId : Boolean(assignedSaleId));
      const matchOwner = matchesPersonnelCustomer(c, ownerVal, appState.members || []);
      return matchText && matchStatus && matchAssign && matchOwner && matchesCustomerColumnFilters(c);
    });

    
    const totalCust = appState.customers.length;
    const connectedCust = appState.customers.filter(c => c.callStatus === 'Đã gọi được' || c.status === 'PAID' || c.status === 'CONTACTED').length;
    const pendingCust = totalCust - connectedCust;
    const paidCust = appState.customers.filter(c => c.status === 'PAID').length;
    const assignedSaleCust = appState.customers.filter(c => !c.sale.includes('Chưa phân')).length;
    const todayCust = appState.customers.filter(c => c.createdAt.includes('14/09/2026')).length;
    const totalRev = appState.orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const totalRevStr = (totalRev || 26000000).toLocaleString('vi-VN') + ' ₫';

    if (document.getElementById('dashTotalCust')) document.getElementById('dashTotalCust').innerText = totalCust;
    if (document.getElementById('dashCustConnected')) document.getElementById('dashCustConnected').innerText = `${connectedCust} (${((connectedCust/totalCust)*100).toFixed(1)}%)`;
    if (document.getElementById('dashCustPending')) document.getElementById('dashCustPending').innerText = `${pendingCust} (${((pendingCust/totalCust)*100).toFixed(1)}%)`;
    if (document.getElementById('dashNewCustToday')) document.getElementById('dashNewCustToday').innerText = todayCust;
    if (document.getElementById('dashCustTodayFoot')) document.getElementById('dashCustTodayFoot').innerText = `+${todayCust} mới`;
    if (document.getElementById('dashCustWeekFoot')) document.getElementById('dashCustWeekFoot').innerText = `${totalCust} data`;
    if (document.getElementById('dashPaidRevenue')) document.getElementById('dashPaidRevenue').innerText = totalRevStr;
    if (document.getElementById('dashFirstBuyCust')) document.getElementById('dashFirstBuyCust').innerText = '2';
    if (document.getElementById('dashAssignedSale')) document.getElementById('dashAssignedSale').innerText = `${assignedSaleCust}/${totalCust} (${((assignedSaleCust/totalCust)*100).toFixed(0)}%)`;
    if (document.getElementById('meterTotalCust')) document.getElementById('meterTotalCust').style.width = `${((connectedCust/totalCust)*100).toFixed(1)}%`;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--text-muted);"><b>Không tìm thấy khách hàng</b><div style="font-size: 11px; margin-top: 4px;">Hãy thử từ khóa hoặc bộ lọc khác.</div></td></tr>`;
      renderCustomerPagination(0);
      return;
    }

    const pages = Math.max(1, Math.ceil(filtered.length / customerPageSize));
    customerPage = Math.min(customerPage, pages);
    const pageRows = filtered.slice((customerPage - 1) * customerPageSize, customerPage * customerPageSize);
    tbody.innerHTML = pageRows.map(c => {
      const classChip = c.customerClass === 'Nóng' ? '<span class="chip chip-hot">Khách Nóng</span>' :
                        c.customerClass === 'Ấm' ? '<span class="chip chip-warm">Khách Ấm</span>' :
                        c.customerClass === 'Premium' ? '<span class="chip chip-vip">Premium Whale</span>' :
                        '<span class="chip chip-cold">Khách Lạnh</span>';
      
      const statusChip = c.status === 'PAID' ? '<span class="chip chip-green">Đã thanh toán</span>' :
                         c.status === 'CONTACTED' ? '<span class="chip chip-warm">Đã liên hệ</span>' :
                         '<span class="chip chip-cold">Data mới</span>';

      const personnel = customerPersonnelLabels(c);
      const saleLabel = personnel.sale
        ? escapeCustomerLabel(personnel.sale)
        : '<span style="color: var(--text-muted); font-style: italic;">Chưa phân Sale</span>';
      const profileLabel = escapeCustomerLabel(`Xem hồ sơ ${c.name}`);
      const referenceAmount = c.referenceAmount ?? c.customFields?.referenceAmount ?? c.customFields?.customerReferenceAmount;

      return `<tr>
        <td style="font-family: var(--font-mono); font-size: 11px; white-space: nowrap;">${c.createdAt}</td>
        <td><b>${c.name}</b><div style="display: flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 10.5px; color: var(--text-muted);">
          <button class="customer-eye" type="button" onclick="openDrawerForCust('${c.id}')" title="${profileLabel}" aria-label="${profileLabel}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <span>${saleLabel}</span>
        </div></td>
        <td data-phone-column="1"><span style="font-family: var(--font-mono); font-weight: 700;">${escapeCustomerLabel(c.phone || "\u2014")}</span></td>
        <td><span style="color: #2563eb; font-weight: 700;">${c.source}</span></td>
        <td>${personnel.teamLeader ? escapeCustomerLabel(personnel.teamLeader) : '<span style="color: var(--text-muted); font-style: italic;">Chưa phân Team / Leader</span>'}</td>
        <td>${saleLabel}</td>
        <td><span style="font-family: var(--font-mono); font-weight: 700;">${c.level}</span></td>
        <td>
          <select onchange="updateCustomerClass('${c.id}', this.value)" style="padding: 4px 8px; border-radius: 6px; font-size: 11px; border: 1px solid var(--border); background: var(--bg-surface); font-weight: 700;">
            <option value="Lạnh" ${c.customerClass === 'Lạnh' ? 'selected' : ''}>Lạnh</option>
            <option value="Ấm" ${c.customerClass === 'Ấm' ? 'selected' : ''}>Ấm</option>
            <option value="Nóng" ${c.customerClass === 'Nóng' ? 'selected' : ''}>Nóng</option>
            <option value="Premium" ${c.customerClass === 'Premium' ? 'selected' : ''}>Premium</option>
          </select>
        </td>
        <td>${c.callStatus}</td>
        <td>${c.docStatus}</td>
        <td><span style="font-weight: 600;">${c.careResult}</span></td>
        <td>${statusChip}</td>
        <td data-reference-amount-column="1"><span style="font-family: var(--font-mono); font-weight: 700;">${referenceAmount == null || referenceAmount === "" ? "\u2014" : Number(referenceAmount).toLocaleString("vi-VN")}</span></td>
        <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${c.note}">${c.note}</td>
        <td style="white-space: nowrap;">
          <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; border-radius: 6px;" onclick="openDrawerForCust('${c.id}')">Hồ sơ</button>
          <button class="btn-secondary data-delete-customer" data-delete-customer="${c.id}" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; color: #b91c1c;">Xóa data</button>
        </td>
      </tr>`;
    }).join('');
    renderCustomerPagination(filtered.length);
  }

  // ── 3. RENDER CHĂM SÓC KHÁCH (CHUẨN ẢNH 1 & 2) ──
  function renderCareView() {
    const hotList = appState.customers.filter(c => c.customerClass === 'Nóng');
    const warmList = appState.customers.filter(c => c.customerClass === 'Ấm');
    const coldList = appState.customers.filter(c => c.customerClass === 'Lạnh');
    const convertedList = appState.customers.filter(c => c.customerClass === 'Premium' || c.customerClass === 'Whale' || c.customerClass === 'Premium Whale');

    if (document.getElementById('careCountHot')) document.getElementById('careCountHot').innerText = hotList.length;
    if (document.getElementById('careCountWarm')) document.getElementById('careCountWarm').innerText = warmList.length;
    if (document.getElementById('careCountCold')) document.getElementById('careCountCold').innerText = coldList.length;
    if (document.getElementById('careCountConverted')) document.getElementById('careCountConverted').innerText = convertedList.length;

    if (document.getElementById('careToolbarInfo')) {
      document.getElementById('careToolbarInfo').innerText = `Phân loại khách (cột hệ thống) · 4 mục chăm sóc mặc định`;
    }
    if (document.getElementById('sidebarCareBadge')) {
      document.getElementById('sidebarCareBadge').innerText = hotList.length;
    }

    const container = document.getElementById('carePanelsContainer');
    if (!container) return;

    const GROUPS = [
      { id: 'g-conv', title: '★ Khách đã chuyển đổi', color: '#10b981', tag: 'Premium Whale', list: convertedList, emptyText: 'Chưa có khách nào trong nhóm này.' },
      { id: 'g-hot', title: '♨ Khách đang quan tâm nóng', color: '#ef4444', tag: 'Nóng', list: hotList, emptyText: 'Chưa có khách nào trong nhóm này.' },
      { id: 'g-warm', title: '● Khách đang theo dõi ấm', color: '#f59e0b', tag: 'Ấm', list: warmList, emptyText: 'Chưa có khách nào trong nhóm này.' },
      { id: 'g-cold', title: '❄ Khách chưa kết nối được lạnh', color: '#3b82f6', tag: 'Lạnh', list: coldList, emptyText: 'Chưa có khách nào trong nhóm này.' }
    ];

    // Thêm các mục chăm sóc tùy chỉnh nếu người dùng tạo
    if (appState.careGroups && appState.careGroups.length) {
      appState.careGroups.forEach(cg => {
        const customList = appState.customers.filter(c => [].concat(c[cg.field] || '').some(value => cg.values.includes(value)));
        GROUPS.push({
          id: cg.id,
          title: '📁 ' + cg.name,
          color: '#e05326',
          tag: cg.values.join(', '),
          list: customList,
          emptyText: 'Chưa có khách nào trong mục này.'
        });
      });
    }

    container.innerHTML = GROUPS.map(g => {
      const totalPages = Math.max(1, Math.ceil(g.list.length / CARE_PAGE_SIZE));
      const currentPage = Math.min(totalPages, Math.max(1, carePageByGroup[g.id] || 1));
      carePageByGroup[g.id] = currentPage;
      const pageStart = (currentPage - 1) * CARE_PAGE_SIZE;
      const visibleList = g.list.slice(pageStart, pageStart + CARE_PAGE_SIZE);
      const rows = visibleList.map(c => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--border-light); background: var(--bg-surface);">
          <div>
            <b style="font-size: 13px; color: var(--text-main);">${c.name}</b> 
            <span style="color: var(--text-muted); font-size: 11.5px; font-family: var(--font-mono); margin-left: 4px;">· ${c.phone}</span>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Data ${c.createdAt} · ${c.sale || 'Chưa phân Sale'}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="chip" style="background: ${g.color}15; color: ${g.color}; font-weight: 700; font-size: 11px;">${c.customerClass || g.tag}</span>
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px; border-radius: 6px;" onclick="openDrawerForCust('${c.id}')">Chi tiết</button>
          </div>
        </div>
      `).join('');

      return `
        <div data-care-group="${g.id}" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; box-shadow: var(--shadow-sm);">
          <div data-care-toggle="${g.id}" role="button" tabindex="0" aria-expanded="false" onclick="filterCareGroup('${g.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterCareGroup('${g.id}');}" style="padding: 12px 16px; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; gap: 12px; background: var(--bg-surface); cursor: pointer;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 700; font-size: 14px; color: var(--text-main);">${g.title}</span>
              <span style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">(${g.list.length})</span>
              ${g.tag ? `<span class="chip" style="background: ${g.color}15; color: ${g.color}; font-size: 11px; font-weight: 700;">${g.tag}</span>` : ''}
            </div>
            <div style="display: flex; gap: 6px;">
              <span data-care-chevron style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--border);border-radius:7px;color:var(--text-muted);font-size:16px;line-height:1;">⌄</span>
            </div>
          </div>
          <div data-care-list hidden>
            ${g.list.length ? rows : `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">${g.emptyText}</div>`}
            ${totalPages > 1 ? `<div data-care-pagination style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--border-light);background:var(--bg-subtle);">
              <button type="button" class="btn-secondary" ${currentPage<=1?'disabled':''} onclick="event.stopPropagation();setCarePage('${g.id}',${currentPage-1})">← Trước</button>
              <span style="font-size:11.5px;color:var(--text-muted);font-weight:700;">Trang ${currentPage}/${totalPages} · ${g.list.length} khách</span>
              <button type="button" class="btn-secondary" ${currentPage>=totalPages?'disabled':''} onclick="event.stopPropagation();setCarePage('${g.id}',${currentPage+1})">Sau →</button>
            </div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ── 4. RENDER DATA QUEUE (CHUẨN ẢNH 3) ──
  function renderDataQueue() {
    const tbody = document.getElementById('dataQueueTableBody');
    if (!tbody) return;
    const queueList = appState.customers;

    if (document.getElementById('sidebarDataBadge')) {
      document.getElementById('sidebarDataBadge').innerText = queueList.length;
    }
    if (document.getElementById('dataTabCountBadge')) {
      document.getElementById('dataTabCountBadge').innerText = queueList.length;
    }

    const todayCount = queueList.filter(c => c.createdAt.includes('14/09/2026')).length;
    if (document.getElementById('dataStatToday')) document.getElementById('dataStatToday').innerText = `${todayCount} data`;
    if (document.getElementById('dataStat3Days')) document.getElementById('dataStat3Days').innerText = `${queueList.length} data`;
    if (document.getElementById('dataStat7Days')) document.getElementById('dataStat7Days').innerText = `${queueList.length} data`;
    if (document.getElementById('dataStat30Days')) document.getElementById('dataStat30Days').innerText = `${queueList.length} data`;

    if (!queueList.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 13px;">Không có data mới nào đang chờ xử lý</td></tr>`;
      return;
    }

    tbody.innerHTML = queueList.map((c, idx) => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted);"><input type="checkbox" class="data-queue-check" value="${c.id}"> #${idx + 1}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${c.createdAt}</td>
        <td><b>${c.name}</b><div style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${c.phone}</div></td>
        <td><span class="chip chip-warm">• Data mới</span></td>
        <td><b style="color: #2563eb;">${c.source}</b></td>
        <td><button class="btn-secondary data-delete-customer" data-delete-customer="${c.id}" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; color: #b91c1c;">Xóa data</button></td>
      </tr>
    `).join('');
  }

  // ── 5. RENDER ORDERS (ẢNH TỔNG QUAN & ĐƠN HÀNG) ──
  function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    tbody.innerHTML = appState.orders.map(o => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 700; color: #2563eb;">${o.code}</td>
        <td><b>${o.customerName}</b><div style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${o.phone}</div></td>
        <td><b>${o.product}</b></td>
        <td>${o.sale}</td>
        <td>${o.leader}</td>
        <td style="font-family: var(--font-mono); font-weight: 800;">${o.total.toLocaleString('vi-VN')} ₫</td>
        <td><span class="chip chip-green">Đã thanh toán</span></td>
        <td><span class="chip chip-warm">${o.rentalExpiry}</span></td>
        <td style="text-align: right;"><button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;">Xem hóa đơn</button></td>
      </tr>
    `).join('');
  }

  // ── CÁC HÀM XỬ LÝ SỰ KIỆN ──
  function updateCustomerClass(id, newCls) {
    const cust = appState.customers.find(c => c.id === id);
    if (cust) {
      cust.customerClass = newCls;
      saveState();
      renderCustomerTable();
      renderCareView();
    }
  }

  function assignCustomerSale(id, saleName) {
    const cust = appState.customers.find(c => c.id === id);
    if (cust) {
      cust.sale = saleName;
      saveState();
      renderCustomerTable();
      renderDataQueue();
    }
  }


  function assignDataAction() {
    const checked = Array.from(document.querySelectorAll('.data-queue-check:checked')).map(ck => ck.value);
    if (!checked.length) {
      alert('Vui lòng chọn ít nhất 1 data để phân công!');
      return;
    }
    checked.forEach(id => {
      const cust = appState.customers.find(c => c.id === id);
      if (cust) cust.sale = 'Nguyễn Thị Mai';
    });
    saveState();
    renderCustomerTable();
    renderDataQueue();
    alert(`Đã phân công thành công ${checked.length} data cho Leader Phạm Thu Hà!`);
  }

  function assignStaffRole(phone) {
    alert(`Đã duyệt tài khoản ${phone} vào Đội ngũ Sale NVT Agency!`);
  }

  function exportCustomersCSV() {
    let csv = 'Họ tên,SĐT,Nguồn,Phân loại,Level,Sale,Trạng thái\n';
    appState.customers.forEach(c => {
      csv += `"${c.name}","${c.phone}","${c.source}","${c.customerClass}","${c.level}","${c.sale}","${c.status}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Khach_Hang_NVT_Agency.csv';
    a.click();
  }

  // Modal tạo đơn hàng
  const orderModal = document.getElementById('orderModal');
  function openOrderModal() {
    const sel = document.getElementById('modalCustomerSelect');
    sel.innerHTML = appState.customers.map(c => `<option value="${c.id}">${c.name} · ${c.phone}</option>`).join('');
    orderModal.classList.add('open');
  }
  function closeOrderModal() { orderModal.classList.remove('open'); }
  function submitOrder() {
    const sel = document.getElementById('modalCustomerSelect');
    const cust = appState.customers.find(c => c.id === sel.value);
    const prodSel = document.getElementById('prodSelect');
    const price = Number(prodSel.value) || 0;
    const prodName = prodSel.options[prodSel.selectedIndex].getAttribute('data-name');

    const newOrd = {
      id: 'ord-' + Date.now(),
      code: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
      customerName: cust ? cust.name : 'Khách vãng lai',
      phone: cust ? cust.phone : '',
      product: prodName,
      sale: cust ? (cust.sale.includes('Chưa phân') ? 'Nguyễn Thị Mai' : cust.sale) : 'Nguyễn Thị Mai',
      leader: 'Phạm Thu Hà',
      total: price,
      vat: Math.round(price * 0.1),
      status: 'PAID',
      rentalExpiry: prodName.includes('Chỉ báo') ? 'Hạn 3 tháng' : 'Vĩnh viễn',
      createdAt: '14/09/2026'
    };

    appState.orders.unshift(newOrd);
    if (cust) {
      cust.status = 'PAID';
      cust.customerClass = 'Premium';
    }
    saveState();
    renderOrdersTable();
    renderCustomerTable();
    renderCareView();
    closeOrderModal();
    alert('Tạo đơn hàng thành công! Doanh thu đã được cập nhật.');
  }

  // ── MODAL TẠO MỤC CHĂM SÓC (CHUẨN ẢNH 2 & CARE-UI.JS) ──
  const careGroupModal = document.getElementById('careGroupModal');
  const CARE_FIELD_OPTIONS = {
    customerClass: [
      { value: 'Chưa có', label: 'Chưa có' },
      { value: 'Lạnh', label: 'Lạnh' },
      { value: 'Ấm', label: 'Ấm' },
      { value: 'Nóng', label: 'Nóng' },
      { value: 'Premium Whale', label: 'Premium Whale' }
    ],
    callStatus: [
      { value: 'Chưa gọi được', label: 'Chưa gọi được' },
      { value: 'Đã gọi được', label: 'Đã gọi được' },
      { value: 'Máy bận', label: 'Máy bận' },
      { value: 'Thuê bao', label: 'Thuê bao' }
    ],
    source: [
      { value: 'Landing Page', label: 'Landing Page' },
      { value: 'Facebook Ads', label: 'Facebook Ads' },
      { value: 'TikTok Ads', label: 'TikTok Ads' },
      { value: 'Google Search', label: 'Google Search' }
    ],
    level: [
      { value: 'L0: Chưa liên hệ được', label: 'L0: Chưa liên hệ được' },
      { value: 'L1: Đã kết nối được Zalo/Tele', label: 'L1: Đã kết nối được Zalo/Tele' },
      { value: 'L4.1: Hẹn nạp vốn', label: 'L4.1: Hẹn nạp vốn' },
      { value: 'L7: Trading', label: 'L7: Trading' }
    ]
  };

  function openCareGroupModal() {
    if (careGroupModal) {
      careGroupModal.style.display = 'flex';
      const nameInput = document.getElementById('careGroupNameInput');
      if (nameInput) nameInput.value = '';
      updateCareGroupOptions();
    }
  }

  function closeCareGroupModal() {
    if (careGroupModal) {
      careGroupModal.style.display = 'none';
    }
  }

  function updateCareGroupOptions() {
    const fieldKey = document.getElementById('careGroupFieldSelect')?.value || 'customerClass';
    const opts = CARE_FIELD_OPTIONS[fieldKey] || CARE_FIELD_OPTIONS.customerClass;
    const hint = document.getElementById('careGroupFieldHint');
    const fieldText = document.getElementById('careGroupFieldSelect')?.selectedOptions[0]?.text || 'Phân loại khách';
    if (hint) hint.innerText = `${fieldText} · ${opts.length} lựa chọn`;

    const container = document.getElementById('careGroupValuesContainer');
    if (container) {
      container.innerHTML = opts.map(opt => `
        <label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 20px; font-size: 12px; cursor: pointer; user-select: none;">
          <input type="checkbox" class="care-value-checkbox" value="${opt.value}" onchange="updateCareSelectionSummary()">
          <span>${opt.label}</span>
        </label>
      `).join('');
    }
    updateCareSelectionSummary();
  }

  function selectAllCareValues() {
    document.querySelectorAll('.care-value-checkbox').forEach(ck => ck.checked = true);
    updateCareSelectionSummary();
  }

  function clearAllCareValues() {
    document.querySelectorAll('.care-value-checkbox').forEach(ck => ck.checked = false);
    updateCareSelectionSummary();
  }

  function updateCareSelectionSummary() {
    const checked = document.querySelectorAll('.care-value-checkbox:checked');
    const summaryEl = document.getElementById('careSelectionSummary');
    if (summaryEl) {
      summaryEl.innerText = checked.length ? `${checked.length} giá trị đã chọn` : 'Chưa chọn giá trị';
      summaryEl.style.color = checked.length ? '#10b981' : 'var(--text-muted)';
    }
  }

  function handleSaveCareGroup(e) {
    e.preventDefault();
    const name = document.getElementById('careGroupNameInput')?.value.trim();
    const checkedValues = Array.from(document.querySelectorAll('.care-value-checkbox:checked')).map(ck => ck.value);
    if (!name) {
      alert('Vui lòng nhập tên mục chăm sóc');
      return;
    }
    if (!checkedValues.length) {
      alert('Vui lòng chọn ít nhất một giá trị');
      return;
    }

    if (!appState.careGroups) appState.careGroups = [];
    appState.careGroups.push({
      id: 'CARE-' + Date.now(),
      name: name,
      field: document.getElementById('careGroupFieldSelect').value,
      values: checkedValues
    });
    saveState();
    closeCareGroupModal();
    renderCareView();
    alert(`Đã lưu mục chăm sóc "${name}" thành công!`);
  }

  // ── NOTIFICATION DROPDOWN (ẢNH 4) ──
  function toggleNotificationDropdown(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('notificationDropdown');
    if (!dd) return;
    const isShown = dd.style.display === 'block';
    dd.style.display = isShown ? 'none' : 'block';
  }

  function closeNotificationDropdown() {
    const dd = document.getElementById('notificationDropdown');
    if (dd) dd.style.display = 'none';
  }

  function markAllNotificationsRead() {
    const badge = document.getElementById('topbarNotifBadge');
    if (badge) badge.style.display = 'none';
    alert('Đã đánh dấu tất cả thông báo là đã đọc!');
  }

  window.addEventListener('click', function(e) {
    const dd = document.getElementById('notificationDropdown');
    const btn = document.getElementById('topbarBellBtn');
    if (dd && dd.style.display === 'block' && !dd.contains(e.target) && !btn?.contains(e.target)) {
      dd.style.display = 'none';
    }
  });

  // ── DATA SUBTAB & FILTER (ẢNH 1, 2, 3) ──
  function switchDataSubTab(tabKey, btn) {
    // Danh sach Leader da gop vao tab Chinh sua ty trong; giu alias cu de tuong thich nguoc.
    if (tabKey === 'leaders') tabKey = 'sales';
    const tabBar = btn?.parentElement || document.querySelector('#tab-data .sub-tabs-bar');
    const activeButton = btn || tabBar?.querySelector('#dataTab' + (tabKey === 'queue' ? 'Queue' : tabKey === 'auto' ? 'Auto' : 'Sales') + 'Btn');
    if (tabBar) {
      tabBar.querySelectorAll('.sub-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
        b.style.boxShadow = 'none';
        b.setAttribute('aria-selected', 'false');
      });
      if (activeButton) {
        activeButton.classList.add('active');
        activeButton.style.background = '#e05326';
        activeButton.style.color = '#ffffff';
        activeButton.style.boxShadow = '0 2px 8px rgba(224, 83, 38, 0.25)';
        activeButton.setAttribute('aria-selected', 'true');
      }
    }

    const views = {
      queue: document.getElementById('dataSubViewQueue'),
      auto: document.getElementById('dataSubViewAuto'),
      leaders: document.getElementById('dataSubViewLeaders'),
      sales: document.getElementById('dataSubViewSales')
    };

    Object.keys(views).forEach(k => {
      if (views[k]) {
        const visible = k === tabKey;
        views[k].hidden = !visible;
        views[k].style.setProperty('display', visible ? (k === 'queue' ? 'grid' : 'block') : 'none', 'important');
      }
    });
  }

  function toggleAutoDist(isOn) {
    const bg = document.getElementById('autoDistToggleBg');
    const knob = document.getElementById('autoDistToggleKnob');
    if (bg && knob) {
      if (isOn) {
        bg.style.backgroundColor = '#065f46';
        knob.style.right = '3px';
        knob.style.left = 'auto';
      } else {
        bg.style.backgroundColor = '#94a3b8';
        knob.style.right = 'auto';
        knob.style.left = '3px';
      }
    }
  }

  function updateAssignmentMode(mode) {
    const el = document.getElementById('autoStatCurrentMode');
    if (el) {
      el.innerText = mode === 'MANUAL' ? 'Thủ công' : mode === 'BALANCED' ? 'Theo tỷ trọng' : 'Chia đều';
    }
  }

  function filterDataQueueTable() {
    const searchVal = (document.getElementById('dataQueueSearch')?.value || '').toLowerCase();
    const sourceVal = document.getElementById('dataQueueSourceFilter')?.value || '';
    const typeVal = document.getElementById('dataQueueTypeFilter')?.value || '';

    const tbody = document.getElementById('dataQueueTableBody');
    if (!tbody) return;

    const filtered = appState.customers.filter(c => {
      const matchSearch = (c.name + ' ' + c.phone).toLowerCase().includes(searchVal);
      const matchSource = !sourceVal || c.source === sourceVal;
      return matchSearch && matchSource;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 13px;">Không có data mới nào đang chờ xử lý</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((c, idx) => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted);"><input type="checkbox" class="data-queue-check" value="${c.id}"> #${idx + 1}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${c.createdAt}</td>
        <td><b>${c.name}</b><div style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${c.phone}</div></td>
        <td><span class="chip chip-warm">• Data mới</span></td>
        <td><b style="color: #2563eb;">${c.source}</b></td>
      </tr>
    `).join('');
  }

  // Modal thêm khách mới
  const newCustModal = document.getElementById('newCustomerModal');
  function openNewCustomerModal() { newCustModal.classList.add('open'); }
  function closeNewCustomerModal() { newCustModal.classList.remove('open'); }

  // Modal chi tiết điểm danh (Lịch 3 tháng)
  const attendanceModal = document.getElementById('attendanceModal');
  function closeAttendanceModal() {
    if (attendanceModal) attendanceModal.classList.remove('open');
  }

  function submitNewCustomer() {
    const name = document.getElementById('newCustName').value.trim();
    const phone = document.getElementById('newCustPhone').value.trim();
    if (!name || !phone) {
      alert('Vui lòng nhập tên và số điện thoại khách hàng!');
      return;
    }

    const newC = {
      id: 'c-' + Date.now(),
      name: name,
      phone: phone,
      createdAt: '14/09/2026 14:30',
      source: document.getElementById('newCustSource').value,
      leader: 'Phạm Thu Hà',
      sale: document.getElementById('newCustSale').value === 's1' ? 'Nguyễn Thị Mai' : '— Chưa phân Sale —',
      level: document.getElementById('newCustLevel').value,
      customerClass: document.getElementById('newCustClass').value,
      callStatus: 'Chưa gọi được',
      docStatus: 'Chưa gửi',
      careResult: 'Data mới',
      status: 'NEW',
      note: 'Tạo thủ công từ CRM'
    };

    appState.customers.unshift(newC);
    saveState();
    renderCustomerTable();
    renderCareView();
    renderDataQueue();
    closeNewCustomerModal();
    alert('Thêm khách hàng mới thành công!');
  }

  // Drawer hồ sơ
  const sideDrawer = document.getElementById('sideDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  function openDrawerForCust(id) {
    const c = appState.customers.find(item => item.id === id);
    if (!c) return;
    const personnel = customerPersonnelLabels(c);
    const members = appState.members || [];
    const memberName = memberId => members.find(member => String(member.id) === String(memberId))?.name || '';
    const setText = (elementId, value, fallback = '—') => {
      const element = document.getElementById(elementId);
      if (element) element.textContent = value || fallback;
    };
    const phone = c.phone || '';
    const email = c.email || '';
    const note = c.note || '';

    setText('drawerName', c.name, 'Khách hàng');
    setText('drawerCreated', c.createdAt ? `Ngày tạo: ${c.createdAt}` : 'Ngày tạo: —');
    setText('drawerStatus', c.status === 'PAID' ? 'Đã thanh toán' : c.status === 'CONTACTED' ? 'Đã liên hệ' : 'Data mới');
    setText('drawerPhone', phone);
    setText('drawerEmail', email, 'Chưa có email');
    setText('drawerSale', personnel.sale, 'Chưa phân Sale');
    setText('drawerLeader', personnel.teamLeader, 'Chưa phân Team / Leader');
    setText('drawerManager', memberName(c.managerId), 'Chưa phân Manager');
    setText('drawerSource', c.source, 'Chưa rõ nguồn');
    setText('drawerClass', c.customerClass, 'Chưa phân loại');
    setText('drawerLevel', c.level, 'Chưa cập nhật');
    setText('drawerCallStatus', c.callStatus, 'Chưa cập nhật');
    setText('drawerDocStatus', c.docStatus, 'Chưa cập nhật');
    setText('drawerCareResult', c.careResult, 'Chưa cập nhật');
    setText('drawerCustomerStatus', c.status === 'PAID' ? 'Đã thanh toán' : c.status === 'CONTACTED' ? 'Đã liên hệ' : 'Data mới');
    const noteElement = document.getElementById('drawerNote');
    if (noteElement) {
      noteElement.textContent = note || 'Chưa có ghi chú.';
      noteElement.classList.toggle('drawer-empty', !note);
    }
    ['drawerCallBtn', 'drawerCallAction'].forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) element.setAttribute('href', phone ? `tel:${phone}` : 'tel:');
    });
    const emailButton = document.getElementById('drawerEmailBtn');
    if (emailButton) emailButton.setAttribute('href', email ? `mailto:${email}` : 'mailto:');
    sideDrawer.classList.add('open');
    drawerOverlay.classList.add('open');
  }
  function closeDrawer() {
    sideDrawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sideDrawer.classList.contains('open')) closeDrawer();
  });
  function openOrderModalFromDrawer() {
    closeDrawer();
    openOrderModal();
  }

  // Chuyển Tab
  function switchTab(tabId) {
    document.getElementById('crm-preheat-tab-style')?.remove();
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(l => {
      if (l.classList.contains('accounting-nav-link')) {
        const isActive = (tabId === 'tab-accounting') && (l.dataset.accountingView === (window.accountingSubView || 'mindmap'));
        l.classList.toggle('active', isActive);
        if (isActive) {
          const text = l.querySelector('span')?.innerText;
          if (text) document.getElementById('topBreadcrumbTitle').innerText = text;
        }
        return;
      }
      if (l.getAttribute('data-tab') === tabId) {
        l.classList.add('active');
        const text = l.querySelector('span')?.innerText;
        if (text) document.getElementById('topBreadcrumbTitle').innerText = text;
      } else {
        l.classList.remove('active');
      }
    });

    document.querySelectorAll('.bar-nav-tab').forEach(b => {
      const fn = b.getAttribute('onclick');
      if (fn && fn.includes(tabId)) b.classList.add('active');
      else b.classList.remove('active');
    });

    // Đóng sidebar & backdrop trên mobile
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('active');
    document.body.style.overflow = '';

    // Đồng bộ nút active trên bottom bar mobile
    document.querySelectorAll('.bar-nav-tab').forEach(b => {
      b.classList.remove('active');
      const onclickAttr = b.getAttribute('onclick') || '';
      if (onclickAttr.includes(tabId)) {
        b.classList.add('active');
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-link').forEach(l => {
    l.addEventListener('click', () => {
      const tab = l.getAttribute('data-tab');
      if (tab) {
        const runtimeSwitchTab = window.switchTab;
        if (typeof runtimeSwitchTab === 'function' && runtimeSwitchTab !== switchTab) runtimeSwitchTab(tab);
        else switchTab(tab);
      }
    });
  });

  // Mobile drawer toggle & backdrop click
  function toggleMobileSidebar() {
    const sb = document.getElementById('sidebar');
    const bd = document.getElementById('sidebarBackdrop');
    if (!sb) return;
    const isOpen = sb.classList.toggle('open');
    if (bd) {
      if (isOpen) bd.classList.add('active');
      else bd.classList.remove('active');
    }
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  document.getElementById('toggleMobileNav')?.addEventListener('click', toggleMobileSidebar);
  document.getElementById('mobileMenuMore')?.addEventListener('click', toggleMobileSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('active');
    document.body.style.overflow = '';
  });

  // Theme switch (Chuyển đổi giữa Cyber Onyx & Vivid Orange với Light Luxury)
  // Theme switch (Chuyển đổi Sáng / Tối tối giản dịu mắt)
  document.getElementById('themeBtn')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const nextTheme = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
  });

  // Tìm kiếm & Lọc bảng khách hàng
  document.getElementById('custSearchInput')?.addEventListener('input', event => renderCustomerTable(event));
  document.getElementById('custStatusFilter')?.addEventListener('change', event => renderCustomerTable(event));
  document.getElementById('custAssignFilter')?.addEventListener('change', renderCustomerTable);

  // Tính tiền VAT
  const prodSelect = document.getElementById('prodSelect');
  prodSelect?.addEventListener('change', () => {
    const p = Number(prodSelect.value) || 0;
    const v = Math.round(p * 0.1);
    const t = p + v;
    document.getElementById('subText').innerText = p.toLocaleString('vi-VN') + ' ₫';
    document.getElementById('vatText').innerText = v.toLocaleString('vi-VN') + ' ₫';
    document.getElementById('totText').innerText = t.toLocaleString('vi-VN') + ' ₫';
  });

  // Phím tắt Ctrl+K để focus tìm kiếm
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('topGlobalSearch')?.focus();
    }
  });

  // ── VẼ BIỂU ĐỒ TRÒN DONUT CHUẨN ẢNH MẪU (IN SỐ % TRÊN LÁT CẮT) ──
  function drawDonutSvg(segments, centerMain, centerSub) {
    const size = 160;
    const center = 80;
    const radius = 52;
    const strokeWidth = 26; // Bề dày múi tròn dày dặn chuẩn ảnh
    const circumference = 2 * Math.PI * radius; // ~326.73

    let accumulatedAngle = -90; // Bắt đầu từ 12h
    let paths = '';
    let labels = '';

    segments.forEach(seg => {
      if (seg.pct <= 0) return;
      const arcLength = (seg.pct / 100) * circumference;
      const sweepAngle = (seg.pct / 100) * 360;
      const midAngle = accumulatedAngle + (sweepAngle / 2);

      paths += `
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
          stroke="${seg.color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${arcLength.toFixed(2)} ${circumference.toFixed(2)}"
          transform="rotate(${accumulatedAngle.toFixed(2)} ${center} ${center})"
          style="transition: all 0.4s ease;" />
      `;

      if (seg.pct >= 7) {
        const rad = midAngle * (Math.PI / 180);
        const tx = center + radius * Math.cos(rad);
        const ty = center + radius * Math.sin(rad);
        const textVal = seg.label || (seg.pct.toFixed(1) + '%');
        labels += `
          <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="#ffffff" font-size="9.5" font-weight="900" font-family="var(--font-mono)" text-anchor="middle" dominant-baseline="central" style="pointer-events: none; text-shadow: 0 1px 3px rgba(0,0,0,0.5);">${textVal}</text>
        `;
      }

      accumulatedAngle += sweepAngle;
    });

    return `
      <svg viewBox="0 0 ${size} ${size}" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.08));">
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--bg-subtle, #f1f5f9)" stroke-width="${strokeWidth}" />
        ${paths}
        ${labels}
      </svg>
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none;">
        <span style="font-size: 24px; font-weight: 900; font-family: var(--font-mono); color: var(--text-main); line-height: 1;">${centerMain}</span>
        <span style="font-size: 9.5px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-top: 3px;">${centerSub}</span>
      </div>
    `;
  }

  // 1. Thống kê nguồn Data (Hôm nay / Tuần này / Tháng này / Tất cả)
  let currentSourcePeriod = 'today';
  function switchSourcePeriod(period) {
    currentSourcePeriod = period;
    const selectEl = document.getElementById('sourcePeriodSelect');
    if (selectEl && selectEl.value !== period) selectEl.value = period;

    const donutWrap = document.getElementById('sourceDonutWrap');
    const legendWrap = document.getElementById('sourceLegendWrap');
    const footerWrap = document.getElementById('sourceFooterWrap');

    if (period === 'today') {
      const segs = [
        { pct: 100, color: '#0284c7', label: '100%' }
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '+2', 'Hôm nay');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Khóa học RSI MA</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #0284c7; font-size: 12px;">+2 (100%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/rsi-ma · 2 data mới vừa đổ về</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #c084fc; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Chỉ báo Breakout</b>
              <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted); font-size: 12px;">0 (0%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/chi-bao-breakout · 1 khách tích lũy</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #cbd5e1; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Coaching 1-1 VIP</b>
              <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted); font-size: 12px;">0 (0%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/vip-coaching · Chờ data phát sinh</div>
          </div>
        `;
      }
      if (footerWrap) {
        footerWrap.innerHTML = `
          <span>Data mới tiếp nhận: <b style="color: var(--text-main); font-family: var(--font-mono);">+2 khách hôm nay</b></span>
          <span>Nguồn dẫn đầu: <b style="color: #0284c7;">LP Khóa học RSI MA</b></span>
        `;
      }
    } else if (period === 'week') {
      // Tuần này: 5 RSI (83.3%), 1 Breakout (16.7%)
      const segs = [
        { pct: 83.33, color: '#0284c7', label: '83.3%' },
        { pct: 16.67, color: '#c084fc', label: '16.7%' }
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '6', 'Tuần này');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Khóa học RSI MA</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #0284c7; font-size: 12px;">5 (83.3%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/rsi-ma · 1 khách mua hàng</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #c084fc;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Chỉ báo Breakout</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #7c3aed; font-size: 12px;">1 (16.7%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/chi-bao-breakout · 1 khách tiềm năng</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #cbd5e1; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Coaching 1-1 VIP</b>
              <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted); font-size: 12px;">0 (0%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/vip-coaching · Chưa có data</div>
          </div>
        `;
      }
      if (footerWrap) {
        footerWrap.innerHTML = `
          <span>Tổng data tuần này: <b style="color: var(--text-main); font-family: var(--font-mono);">6 khách</b></span>
          <span>Tỷ trọng RSI MA: <b style="color: #0284c7; font-family: var(--font-mono);">83.3%</b></span>
        `;
      }
    } else if (period === 'month') {
      // Tháng này: 5 RSI (83.3%), 1 Breakout (16.7%)
      const segs = [
        { pct: 83.33, color: '#0284c7', label: '83.3%' },
        { pct: 16.67, color: '#c084fc', label: '16.7%' }
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '6', 'Tháng này');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Khóa học RSI MA</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #0284c7; font-size: 12px;">5 (83.3%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/rsi-ma · Đã mang về 26.000.000 ₫</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #c084fc;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Chỉ báo Breakout</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #7c3aed; font-size: 12px;">1 (16.7%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/chi-bao-breakout · Dự kiến 3.042.000 ₫</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #cbd5e1; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Coaching 1-1 VIP</b>
              <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted); font-size: 12px;">0 (0%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/vip-coaching · Đang mở đăng ký</div>
          </div>
        `;
      }
      if (footerWrap) {
        footerWrap.innerHTML = `
          <span>Tổng data tháng này: <b style="color: var(--text-main); font-family: var(--font-mono);">6 khách</b></span>
          <span>Nguồn chủ lực: <b style="color: #0284c7;">LP Khóa học RSI MA</b></span>
        `;
      }
    } else {
      // all: Tất cả thời gian
      const segs = [
        { pct: 83.33, color: '#0284c7', label: '83.3%' },
        { pct: 16.67, color: '#c084fc', label: '16.7%' }
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '6', 'Tất cả');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Khóa học RSI MA</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #0284c7; font-size: 12px;">5 (83.3%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/rsi-ma · 5 data tích lũy toàn thời gian</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #c084fc;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Chỉ báo Breakout</b>
              <span style="font-family: var(--font-mono); font-weight: 800; color: #7c3aed; font-size: 12px;">1 (16.7%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/chi-bao-breakout · 1 data tích lũy</div>
          </div>
          <div style="padding: 8px 10px; background: var(--bg-subtle); border-radius: 7px; border-left: 3px solid #cbd5e1; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <b style="font-size: 11.5px;">LP Coaching 1-1 VIP</b>
              <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-muted); font-size: 12px;">0 (0%)</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">nvtagency.top/vip-coaching · Sắp kích hoạt chiến dịch</div>
          </div>
        `;
      }
      if (footerWrap) {
        footerWrap.innerHTML = `
          <span>Tổng data tích lũy: <b style="color: var(--text-main); font-family: var(--font-mono);">6 khách</b></span>
          <span>Landing Page hoạt động: <b style="color: #0284c7;">2/3 trang</b></span>
        `;
      }
    }
  }

  // 2. Phân tích Tỷ Lệ Chốt Theo Landing Page (Chuẩn 4 loại khách)
  function renderFunnelChart(lpKey) {
    const donutWrap = document.getElementById('funnelDonutWrap');
    const legendWrap = document.getElementById('funnelLegendWrap');
    const winRateEl = document.getElementById('funnelWinRateText');
    const revEl = document.getElementById('funnelRevenueText');

    if (lpKey === 'rsi') {
      // 5 khách: 1 Khách mua hàng (20%), 1 Đồng hành (20%), 1 Tiềm năng (20%), 2 Không chốt được (40%)
      const segs = [
        { pct: 20, color: '#10b981', label: '20%' }, // Khách mua hàng
        { pct: 20, color: '#0284c7', label: '20%' }, // Khách đồng hành cùng hệ thống
        { pct: 20, color: '#8b5cf6', label: '20%' }, // Khách tiềm năng
        { pct: 40, color: '#ef4444', label: '40%' }  // Khách không chốt được
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '5', 'RSI MA');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #10b981;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #059669;">● Khách mua hàng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #059669;">1 khách (20%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Lê Hoàng Nam · Đã thanh toán 26.000.000 ₫</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #0284c7;">● Khách đồng hành cùng hệ thống</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #0284c7;">1 khách (20%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Nguyễn Văn Tâm · Kết nối Zalo/Tele, vào room hỗ trợ</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #8b5cf6;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #7c3aed;">● Khách tiềm năng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #7c3aed;">1 khách (20%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Đã tư vấn lộ trình đào tạo, hẹn thời gian học</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #ef4444;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #dc2626;">● Khách không chốt được</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #dc2626;">2 khách (40%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Data mới điền form / chưa gọi được (L0)</div>
          </div>
        `;
      }
      if (winRateEl) winRateEl.innerText = '20.0%';
      if (revEl) revEl.innerText = '26.000.000 ₫';

    } else if (lpKey === 'breakout') {
      // 1 khách: Dũng Lưu hẹn nạp vốn (100% Khách tiềm năng)
      const segs = [
        { pct: 100, color: '#8b5cf6', label: '100%' }
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '1', 'BREAKOUT');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #10b981; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #059669;">● Khách mua hàng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px;">0 khách (0%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Chưa chốt thanh toán</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #0284c7; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #0284c7;">● Khách đồng hành cùng hệ thống</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px;">0 khách (0%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Chưa tham gia room chỉ báo</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #8b5cf6;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #7c3aed;">● Khách tiềm năng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #7c3aed;">1 khách (100%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Dũng Lưu · Đã hẹn nạp tiền thuê chỉ báo L4.1</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #ef4444; opacity: 0.65;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #dc2626;">● Khách không chốt được</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px;">0 khách (0%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Không có data cháy / rơi rụng</div>
          </div>
        `;
      }
      if (winRateEl) winRateEl.innerText = '0.0% (Chờ nạp)';
      if (revEl) revEl.innerText = '3.042.000 ₫ (Dự kiến)';

    } else {
      // all: 6 khách tổng: 1 mua hàng (16.7%), 1 đồng hành (16.7%), 1 tiềm năng (16.7%), 3 không chốt được (50%)
      const segs = [
        { pct: 16.67, color: '#10b981', label: '16.7%' }, // Khách mua hàng
        { pct: 16.67, color: '#0284c7', label: '16.7%' }, // Khách đồng hành cùng hệ thống
        { pct: 16.67, color: '#8b5cf6', label: '16.7%' }, // Khách tiềm năng
        { pct: 50.00, color: '#ef4444', label: '50.0%' }  // Khách không chốt được
      ];
      if (donutWrap) donutWrap.innerHTML = drawDonutSvg(segs, '6', 'TẤT CẢ DATA');
      if (legendWrap) {
        legendWrap.innerHTML = `
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #10b981;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #059669;">● Khách mua hàng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #059669;">1 khách (16.7%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Doanh thu thực tế: 26.000.000 ₫ (Đã thanh toán)</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #0284c7;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #0284c7;">● Khách đồng hành cùng hệ thống</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #0284c7;">1 khách (16.7%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Khách kết nối vào hệ sinh thái cộng đồng trading</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #8b5cf6;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #7c3aed;">● Khách tiềm năng</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #7c3aed;">1 khách (16.7%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Hẹn lịch nạp tiền / quan tâm dịch vụ VIP</div>
          </div>
          <div style="padding: 7px 10px; background: var(--bg-subtle); border-radius: 6px; border-left: 3px solid #ef4444;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 800; color: #dc2626;">● Khách không chốt được</span>
              <b style="font-family: var(--font-mono); font-size: 11.5px; color: #dc2626;">3 khách (50.0%)</b>
            </div>
            <div style="font-size: 9.5px; color: var(--text-muted); margin-top: 1px;">Data mới điền form / chưa gọi được (L0)</div>
          </div>
        `;
      }
      if (winRateEl) winRateEl.innerText = '16.7%';
      if (revEl) revEl.innerText = '26.000.000 ₫';
    }
  }

  // 3. Dữ liệu Phân Tích Doanh Thu đa kỳ hạn: 1 ngày, 7 ngày, 15 ngày, 30 ngày
  const revenueAnalyticsData = {
    '1day': {
      label: 'Hôm nay (1 ngày)',
      shortLabel: '1 NGÀY',
      startDate: '2026-09-14',
      endDate: '2026-09-14',
      totalAmount: '4.584.000 ₫',
      vatAmount: '458.400 ₫',
      centerAmount: '4.58M',
      soldAmountTop: '4.584.000 ₫',
      salePercent: '65.4%',
      saleAmount: '3.000.000 ₫ · Bán đứt trọn đời',
      rentPercent: '34.6%',
      rentAmount: '1.584.000 ₫ · Thuê gói định kỳ',
      // Chu vi = 326.73
      // Sale: 65.4% -> 213.68
      // Rent: 34.6% -> 113.05, rotate: -90 + (0.654 * 360) = 145.4deg
      saleDash: '213.68 326.73',
      rentDash: '113.05 326.73',
      rentRotate: '145.4 80 80',
      saleLabelX: '65', saleLabelY: '35',
      rentLabelX: '120', rentLabelY: '115'
    },
    '7days': {
      label: '7 ngày gần nhất',
      shortLabel: '7 NGÀY',
      startDate: '2026-09-08',
      endDate: '2026-09-14',
      totalAmount: '13.626.000 ₫',
      vatAmount: '1.362.600 ₫',
      centerAmount: '13.62M',
      soldAmountTop: '13.626.000 ₫',
      salePercent: '73.4%',
      saleAmount: '10.000.000 ₫ · Bán đứt trọn đời',
      rentPercent: '26.6%',
      rentAmount: '3.626.000 ₫ · Thuê gói định kỳ',
      // Sale: 73.4% -> 239.82
      // Rent: 26.6% -> 86.91, rotate: -90 + (0.734 * 360) = 174.2deg
      saleDash: '239.82 326.73',
      rentDash: '86.91 326.73',
      rentRotate: '174.2 80 80',
      saleLabelX: '70', saleLabelY: '32',
      rentLabelX: '125', rentLabelY: '110'
    },
    '15days': {
      label: '15 ngày gần nhất',
      shortLabel: '15 NGÀY',
      startDate: '2026-08-31',
      endDate: '2026-09-14',
      totalAmount: '21.042.000 ₫',
      vatAmount: '2.104.200 ₫',
      centerAmount: '21.04M',
      soldAmountTop: '21.042.000 ₫',
      salePercent: '81.0%',
      saleAmount: '17.042.000 ₫ · Bán đứt trọn đời',
      rentPercent: '19.0%',
      rentAmount: '4.000.000 ₫ · Thuê gói định kỳ',
      // Sale: 81% -> 264.65
      // Rent: 19% -> 62.08, rotate: -90 + (0.81 * 360) = 201.6deg
      saleDash: '264.65 326.73',
      rentDash: '62.08 326.73',
      rentRotate: '201.6 80 80',
      saleLabelX: '72', saleLabelY: '30',
      rentLabelX: '128', rentLabelY: '108'
    },
    '30days': {
      label: '30 ngày gần nhất',
      shortLabel: '30 NGÀY',
      startDate: '2026-08-15',
      endDate: '2026-09-14',
      totalAmount: '29.042.000 ₫',
      vatAmount: '2.904.200 ₫',
      centerAmount: '29.04M',
      soldAmountTop: '29.042.000 ₫',
      salePercent: '89.5%',
      saleAmount: '26.000.000 ₫ · Bán đứt trọn đời',
      rentPercent: '10.5%',
      rentAmount: '3.042.000 ₫ · Thuê gói định kỳ',
      // Sale: 89.5% -> 292.42
      // Rent: 10.5% -> 34.31, rotate: -90 + (0.895 * 360) = 232.2deg
      saleDash: '292.42 326.73',
      rentDash: '34.31 326.73',
      rentRotate: '232.2 80 80',
      saleLabelX: '75', saleLabelY: '30',
      rentLabelX: '125', rentLabelY: '110'
    }
  };

  function setRevenueDonutPeriod(period, btn) {
    const data = revenueAnalyticsData[period] || revenueAnalyticsData['30days'];

    // Cập nhật active cho các tab tròn
    document.querySelectorAll('#donutRevenuePeriodTabs .pill-tab-item').forEach(b => {
      const matchKey = period === '1day' ? '1 ngày' : period === '7days' ? '7 ngày' : period === '15days' ? '15 ngày' : '30 ngày';
      if (b.innerText.includes(matchKey)) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    // Cập nhật active cho các tab kỳ báo cáo phía trên
    document.querySelectorAll('#revenueTopPeriodTabs .pill-tab-item').forEach(b => {
      const matchKey = period === '1day' ? '1 ngày' : period === '7days' ? '7 ngày' : period === '15days' ? '15 ngày' : '30 ngày';
      if (b.innerText.includes(matchKey)) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    // Cập nhật date picker
    const startInp = document.getElementById('revStartDate');
    const endInp = document.getElementById('revEndDate');
    if (startInp) startInp.value = data.startDate;
    if (endInp) endInp.value = data.endDate;

    // Cập nhật badge phạm vi
    const badge = document.getElementById('revFilterRangeBadge');
    if (badge) badge.innerText = `● Dữ liệu ${data.label}`;

    // Cập nhật số tiền thẻ Doanh thu đã bán
    const soldEl = document.getElementById('revStatSoldAmount');
    if (soldEl) soldEl.innerText = data.soldAmountTop;

    // Cập nhật Biểu đồ Donut SVG
    const saleCircle = document.getElementById('revSvgSaleCircle');
    const rentCircle = document.getElementById('revSvgRentCircle');
    const saleText = document.getElementById('revSvgSaleText');
    const rentText = document.getElementById('revSvgRentText');
    const centerAmt = document.getElementById('revDonutCenterAmount');
    const centerPeriod = document.getElementById('revDonutCenterPeriod');

    if (saleCircle) saleCircle.setAttribute('stroke-dasharray', data.saleDash);
    if (rentCircle) {
      rentCircle.setAttribute('stroke-dasharray', data.rentDash);
      rentCircle.setAttribute('transform', `rotate(${data.rentRotate})`);
    }
    if (saleText) {
      saleText.textContent = data.salePercent;
      saleText.setAttribute('x', data.saleLabelX);
      saleText.setAttribute('y', data.saleLabelY);
    }
    if (rentText) {
      rentText.textContent = data.rentPercent;
      rentText.setAttribute('x', data.rentLabelX);
      rentText.setAttribute('y', data.rentLabelY);
    }
    if (centerAmt) centerAmt.textContent = data.centerAmount;
    if (centerPeriod) centerPeriod.textContent = data.shortLabel;

    // Cập nhật chú thích & footer
    const salePctEl = document.getElementById('revDonutSalePercent');
    const saleAmtEl = document.getElementById('revDonutSaleDetail');
    const rentPctEl = document.getElementById('revDonutRentPercent');
    const rentAmtEl = document.getElementById('revDonutRentDetail');
    const totalAmtEl = document.getElementById('revDonutTotalAmount');
    const vatAmtEl = document.getElementById('revDonutVatAmount');

    if (salePctEl) salePctEl.textContent = data.salePercent;
    if (saleAmtEl) saleAmtEl.textContent = data.saleAmount;
    if (rentPctEl) rentPctEl.textContent = data.rentPercent;
    if (rentAmtEl) rentAmtEl.textContent = data.rentAmount;
    if (totalAmtEl) totalAmtEl.textContent = data.totalAmount;
    if (vatAmtEl) vatAmtEl.textContent = data.vatAmount;
  }

  function filterRevenuePeriod(period, btn) {
    setRevenueDonutPeriod(period, btn);
  }

  function applyCustomRevenueDate(showAlert) {
    const s = document.getElementById('revStartDate').value;
    const e = document.getElementById('revEndDate').value;
    const badge = document.getElementById('revFilterRangeBadge');
    if (badge) badge.innerText = `● Dữ liệu tùy chọn: ${s} ➔ ${e}`;
    if (showAlert) alert(`Đã áp dụng bộ lọc doanh thu từ ${s} đến ${e}!`);
  }

  // 4. Hàm lọc phân loại đơn hàng Bên Bán vs Bên Thuê
  let currentOrderTypeFilter = 'all';
  function filterOrderTypeGroup(type, btn) {
    currentOrderTypeFilter = type;
    if (btn) {
      document.querySelectorAll('#orderTypePillGroup .pill-tab-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    filterOrdersCombined();
  }

  function filterOrdersSearch() {
    filterOrdersCombined();
  }

  function filterOrdersDate(showAlert) {
    const s = document.getElementById('orderStartDate').value;
    const e = document.getElementById('orderEndDate').value;
    const badge = document.getElementById('orderDateFilterBadge');
    if (badge) badge.innerText = `${s} ➔ ${e}`;
    if (showAlert) alert(`Đã lọc đơn hàng từ ngày ${s} đến ${e}!`);
    filterOrdersCombined();
  }

  function filterOrdersCombined() {
    const q = (document.getElementById('orderSearchQueryInput')?.value || '').trim().toLowerCase();
    const st = document.getElementById('orderStatusFilterSelect')?.value || 'all';
    const rows = document.querySelectorAll('#ordersMainTableBody tr');
    let visibleCount = 0;

    rows.forEach(row => {
      const group = row.getAttribute('data-order-group');
      const status = row.getAttribute('data-order-status') || '';
      const text = row.innerText.toLowerCase();

      let matchType = (currentOrderTypeFilter === 'all' || group === currentOrderTypeFilter);
      let matchStatus = (st === 'all' || status.includes(st) || row.innerText.includes(st));
      let matchQuery = (!q || text.includes(q));

      if (matchType && matchStatus && matchQuery) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    const countEl = document.getElementById('orderCountSummary');
    if (countEl) countEl.innerText = `${visibleCount} đơn hàng hiển thị`;
  }

  // 5. Hàm lọc ngày Tab Đội ngũ
  function filterTeamPeriod(period, btn) {
    if (btn) {
      document.querySelectorAll('.team-period-btn').forEach(b => {
        b.className = 'btn-secondary team-period-btn';
      });
      btn.className = 'btn-primary team-period-btn';
    }
    const sInp = document.getElementById('teamStartDate');
    const eInp = document.getElementById('teamEndDate');
    const label = document.getElementById('teamDateRangeLabel');
    if (period === '1day') {
      if (sInp) sInp.value = '2026-09-14';
      if (eInp) eInp.value = '2026-09-14';
      if (label) label.innerText = '14/09/2026 - 14/09/2026';
    } else if (period === '7days') {
      if (sInp) sInp.value = '2026-09-08';
      if (eInp) eInp.value = '2026-09-14';
      if (label) label.innerText = '08/09/2026 - 14/09/2026';
    } else if (period === '15days') {
      if (sInp) sInp.value = '2026-08-31';
      if (eInp) eInp.value = '2026-09-14';
      if (label) label.innerText = '31/08/2026 - 14/09/2026';
    } else if (period === '30days') {
      if (sInp) sInp.value = '2026-08-15';
      if (eInp) eInp.value = '2026-09-14';
      if (label) label.innerText = '15/08/2026 - 14/09/2026';
    }
  }

  function updateTeamDateLabel(showAlert) {
    const s = document.getElementById('teamStartDate').value;
    const e = document.getElementById('teamEndDate').value;
    const label = document.getElementById('teamDateRangeLabel');
    if (label) label.innerText = `${s} - ${e}`;
    if (showAlert) alert(`Đã áp dụng bộ lọc đội ngũ từ ${s} đến ${e}!`);
  }
