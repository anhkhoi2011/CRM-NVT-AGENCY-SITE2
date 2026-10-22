'use strict';
// Presentation only: retain the existing rows, controls, event handlers and API flow.
(() => {
  const mobile = matchMedia('(max-width: 860px)');
  const expanded = new Map();
  let tableSequence = 0, updateTimer = 0;
  const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const labelFor = cell => Array.from(cell.childNodes).filter(node => node.nodeType === 3 || !node.matches?.('.customer-column-filter,[data-sort-indicator]')).map(node => node.textContent).join(' ').replace(/[▾↕↑↓]/g, '').replace(/\s+/g, ' ').trim();
  const setData = (node, key, value) => {const text = String(value); if (node.dataset[key] !== text) node.dataset[key] = text;};
  function rowKey(table, row, cells) {
    const id = row.dataset.customerId || row.dataset.orderId;
    if (id) return table.dataset.mobileTable + ':' + id;
    const control = row.querySelector('[data-order-detail],[data-customer-id],button[onclick]');
    return table.dataset.mobileTable + ':' + (row.dataset.customerId || row.dataset.orderId || control?.dataset.orderDetail || control?.dataset.customerId || control?.getAttribute('onclick') || cells.slice(0, 3).map(cell => cell.textContent.replace(/Xem thêm|Thu gọn/g, '').trim()).join('|'));
  }
  function prepareTable(table) {
    if (table.closest('.ao-slip,.mindmap-viewport') || table.hasAttribute('data-mobile-keep-table')) return;
    const header = table.tHead?.rows[table.tHead.rows.length - 1];
    if (!header || Array.from(header.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) return;
    const headers = Array.from(header.cells), labels = headers.map(labelFor), normalizedLabels = labels.map(normalize);
    const customerList = Array.from(table.tBodies).some(body => body.id === 'customerTableBody');
    if (customerList && !table.classList.contains('mobile-customer-list')) table.classList.add('mobile-customer-list');
    if (!table.classList.contains('mobile-record-table')) table.classList.add('mobile-record-table');
    table.dataset.mobileTable ||= 'table-' + (++tableSequence);
    const hasFilters = headers.some(cell => cell.querySelector('button,[data-column-filter]') || cell.hasAttribute('onclick'));
    if (hasFilters && !table.previousElementSibling?.classList.contains('mobile-table-filter-toggle')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'mobile-table-filter-toggle'; button.textContent = 'Bộ lọc / sắp xếp theo cột';
      button.setAttribute('aria-expanded', String(table.dataset.mobileFilters === 'open'));
      button.addEventListener('click', () => {const open = table.dataset.mobileFilters !== 'open'; table.dataset.mobileFilters = open ? 'open' : 'closed'; button.setAttribute('aria-expanded', String(open));});
      table.before(button);
    }
    headers.forEach(cell => {setData(cell, 'mobileFilter', Boolean(cell.querySelector('button,[data-column-filter]') || cell.hasAttribute('onclick')));});
    for (const body of table.tBodies) for (const row of body.rows) {
      const cells = Array.from(row.cells);
      if (cells.length !== headers.length || cells.some(cell => cell.colSpan > 1)) {setData(row, 'mobileEmpty', true); continue;}
      const key = rowKey(table, row, cells);
      setData(row, 'mobileExpanded', expanded.get(key) === true);
      const levelCell = customerList ? row.querySelector('[data-customer-field="customerLevel"]')?.closest('td') : null;
      let extra = false;
      cells.forEach((cell, index) => {
        const label = labels[index], normalized = normalizedLabels[index];
        const customerSlot = customerList ? (index === 1 ? 'name' : index === 2 ? 'phone' : cell === levelCell ? 'level' : '') : '';
        const action = /thao tac|hanh dong/.test(normalized) || index === cells.length - 1 && Boolean(cell.querySelector('button'));
        const summary = customerList ? Boolean(customerSlot) : index < 3 || /khach hang|ten khach|so dien thoai|sdt|trang thai|level|don gia|da thu|thuc thu|con lai|tong tien|thanh toan/.test(normalized) || Boolean(cell.querySelector('[data-customer-field="customerLevel"]'));
        setData(cell, 'mobileLabel', label || (action ? 'Thao tác' : 'Thông tin'));
        setData(cell, 'mobileAction', action);
        setData(cell, 'mobileExtra', customerList ? !summary : !action && !summary);
        if (customerList) setData(cell, 'mobileCustomerSlot', customerSlot);
        if ((!action || customerList) && !summary && !cell.hidden) extra = true;
      });
      let toggle = row.querySelector('.mobile-row-toggle');
      if (extra && !toggle) {
        toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'mobile-row-toggle';
        // A presentation control at the end of the existing cell; cell indexes never change.
        (customerList ? cells[2] : cells.find(cell => cell.dataset.mobileAction === 'true') || cells.find(cell => !cell.hidden && cell.dataset.mobileExtra !== 'true') || cells[0]).appendChild(toggle);
      }
      if (toggle) {
        if (toggle.hidden !== !extra) toggle.hidden = !extra;
        toggle.dataset.mobileKey = key;
        const open = row.dataset.mobileExpanded === 'true', text = open ? 'Thu gọn' : customerList ? 'Chi tiết' : 'Xem thêm';
        if (toggle.textContent !== text) toggle.textContent = text;
        toggle.setAttribute('aria-expanded', String(open));
        if (customerList) toggle.setAttribute('aria-label', (open ? 'Thu gọn' : 'Chi tiết') + ' · ' + cells[1].textContent.trim());
      }
      if (levelCell) {
        const select = levelCell.querySelector('select'), selected = select?.selectedOptions[0];
        let badge = levelCell.querySelector('.mobile-level-summary');
        if (!badge) {badge = document.createElement('span'); badge.className = 'mobile-level-summary'; levelCell.appendChild(badge);}
        const text = select?.value || 'Chưa chọn';
        if (badge.textContent !== text) badge.textContent = text;
        const label = selected?.textContent || text;
        if (badge.title !== label) badge.title = label;
        badge.setAttribute('aria-label', 'Level: ' + label);
        for (const property of ['color', 'backgroundColor']) if (badge.style[property] !== select.style[property]) badge.style[property] = select.style[property];
      }
    }
    if (table.tFoot) for (const row of table.tFoot.rows) {
      let index = 0;
      for (const cell of row.cells) {cell.dataset.mobileLabel = cell.colSpan > 1 ? '' : labels[index] || 'Tổng'; index += cell.colSpan;}
    }
  }
  function prepareCustomerFilters(root) {
    const header = root.querySelector('#tab-customers .table-head-bar') || (root.id === 'tab-customers' ? root.querySelector('.table-head-bar') : null);
    const group = header?.firstElementChild;
    if (!group) return;
    let button = group.querySelector('.mobile-customer-filter-toggle');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'mobile-customer-filter-toggle';
      button.addEventListener('click', () => {const open = header.dataset.mobileCustomerFilters !== 'open'; setData(header, 'mobileCustomerFilters', open ? 'open' : 'closed'); button.setAttribute('aria-expanded', String(open));});
      group.appendChild(button);
    }
    const active = Array.from(group.querySelectorAll('select')).filter(select => select.value && select.value !== 'ALL').length;
    const text = 'Bộ lọc' + (active ? ' (' + active + ')' : '');
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-expanded', String(header.dataset.mobileCustomerFilters === 'open'));
  }
  function prepareLayouts(root) {
    prepareCustomerFilters(root);
    const orderDates = root.querySelector('#orderStartDate')?.parentElement?.parentElement;
    if (orderDates && !orderDates.classList.contains('mobile-order-date-filter')) orderDates.classList.add('mobile-order-date-filter');
    for (const node of root.querySelectorAll('div[style*="grid-template-columns"]')) {
      if (node.closest('.ao-slip,.mindmap-viewport,.tree-container')) continue;
      if (!node.classList.contains('mobile-layout-grid')) node.classList.add('mobile-layout-grid');
      if (!node.classList.contains('mobile-kpi-grid') && (Array.from(node.children).every(child => child.matches('.bento-card,.kpi-bento-card,.stat-box,[data-accounting-detail]')) && node.children.length > 1 || node.children.length === 4 && node.querySelector('#kpiOrderTotalCount,#accTotalRevenue'))) node.classList.add('mobile-kpi-grid');
    }
    for (const node of root.querySelectorAll('div[style*="display:flex"],div[style*="display: flex"]')) {
      if (node.closest('table,.ao-slip,.mindmap-viewport')) continue;
      if (!node.classList.contains('mobile-toolbar') && node.querySelector(':scope > input,:scope > select,:scope > button')) node.classList.add('mobile-toolbar');
    }
  }
  function syncMenu() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const open = mobile.matches && sidebar.classList.contains('open');
    document.body.classList.toggle('mobile-menu-open', open);
    for (const id of ['toggleMobileNav','mobileMenuMore']) {
      const button = document.getElementById(id); button?.setAttribute('aria-expanded', String(open)); button?.setAttribute('aria-controls', 'sidebar');
    }
    if (!sidebar.querySelector('.mobile-sidebar-close')) {
      const close = document.createElement('button'); close.type = 'button'; close.className = 'mobile-sidebar-close'; close.textContent = '×'; close.setAttribute('aria-label','Đóng menu');
      close.onclick = closeMenu; sidebar.querySelector('.sidebar-brand')?.appendChild(close);
    }
  }
  function closeMenu() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('active');
    document.body.style.overflow = ''; syncMenu(); document.getElementById('toggleMobileNav')?.focus();
  }
  function update() {
    syncMenu();
    if (!mobile.matches) return;
    const roots = Array.from(document.querySelectorAll('.tab-section.active,.tab-content-panel.active,.modal-overlay.open,.modal-overlay.active,.modal-backdrop.active,dialog[open],.side-drawer.open'));
    for (const root of roots) {prepareLayouts(root); for (const table of root.querySelectorAll('table')) prepareTable(table);}
  }
  window.crmMobile = {prepareCustomerTable() {
    if (!mobile.matches) return;
    const root = document.getElementById('tab-customers'), table = document.getElementById('customerTableBody')?.closest('table');
    if (root && table && root.classList.contains('active')) {prepareCustomerFilters(root); prepareTable(table);}
  }};
  // Renderers can touch hundreds of nodes in one pass. A short debounce keeps the
  // mobile adapter from rescanning every table once per animation frame while a
  // tab is being rebuilt.
  function schedule() {
    if (updateTimer) return;
    updateTimer = setTimeout(() => { updateTimer = 0; update(); }, 90);
  }
  document.addEventListener('click', event => {
    const toggle = event.target.closest('.mobile-row-toggle');
    if (!toggle) return;
    event.preventDefault(); event.stopPropagation();
    const row = toggle.closest('tr'), open = row.dataset.mobileExpanded !== 'true';
    expanded.set(toggle.dataset.mobileKey, open); row.dataset.mobileExpanded = String(open);
    toggle.textContent = open ? 'Thu gọn' : row.closest('.mobile-customer-list') ? 'Chi tiết' : 'Xem thêm'; toggle.setAttribute('aria-expanded', String(open));
    if (row.closest('.mobile-customer-list')) toggle.setAttribute('aria-label', toggle.textContent + ' · ' + row.cells[1].textContent.trim());
  }, true);
  document.addEventListener('change', event => {if (event.target.matches('#custStatusFilter,#custAssignFilter,#custOwnerFilter,[data-customer-field="customerLevel"]')) schedule();});
  document.addEventListener('keydown', event => {if (event.key === 'Escape' && document.body.classList.contains('mobile-menu-open')) {event.preventDefault(); closeMenu();}});
  mobile.addEventListener('change', () => {if (!mobile.matches) closeMenu(); schedule();});
  new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target) return false;
      if (target.closest('#liveClockDisplay,#crmSupportWidget,[data-live-clock],.mobile-row-toggle,.mobile-level-summary,.mobile-customer-filter-toggle,.mobile-table-filter-toggle')) return false;
      // Class changes inside a prepared table/layout are presentation-only. The
      // renderer's child-list changes still pass through and trigger one update.
      if (record.type === 'attributes' && target.closest('.mobile-record-table,.mobile-layout-grid,.mobile-toolbar')) return false;
      if (record.type === 'characterData' && target.closest('table')) return false;
      return true;
    })) schedule();
  }).observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
  schedule();
})();
