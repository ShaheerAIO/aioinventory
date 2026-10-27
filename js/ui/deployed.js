/**
 * ui/deployed.js — Stock Deployed view (By Unit / By Restaurant)
 */
(() => {
  const { _dlCSV, esc, fmtDate, fmtDateFull, fmtDateTimeISO } = UI._;

  // ── Stock Deployed ────────────────────────────────────────────────────
  // Deployed rows matching the By Unit search/category/customer filters
  function _filteredDeployedRows() {
    const search  = (document.getElementById('dep-search').value || '').trim().toLowerCase();
    const catF    = document.getElementById('dep-cat-filter').value;
    const custF   = document.getElementById('dep-customer-filter').value;
    return Inventory.getDeployedSerialRows().filter(r => {
      const ms = !search  || r.serial.toLowerCase().includes(search) || r.product.toLowerCase().includes(search) || r.customer.toLowerCase().includes(search);
      const mc = !catF    || r.category === catF;
      const mcu= !custF   || r.customer === custF;
      return ms && mc && mcu;
    });
  }

  function renderDeployed() {

    // ── Pending deployments section ─────────────────────────────────
    const pendingPanel = document.getElementById('dep-pending-panel');
    const pendingBody  = document.getElementById('dep-pending-body');
    const pendingList  = DB.getPendingDeployments();
    if (pendingPanel && pendingBody) {
      if (pendingList.length) {
        pendingPanel.style.display = '';
        const countEl = document.getElementById('dep-pending-count');
        if (countEl) {
          const n = pendingList.reduce((a, p) => a + p.serials.length, 0);
          countEl.textContent = `(${n} unit${n!==1?'s':''})`;
        }
        applyPendingCollapse();
        pendingBody.innerHTML = pendingList.map(pd => {
          const totalCost = pd.serials
            .map(s => DB.getSerialCost(s))
            .filter(c => c != null)
            .reduce((a, c) => a + c, 0);
          const costed = pd.serials.filter(s => DB.getSerialCost(s) != null).length;
          const serialChecks = pd.serials.map(s =>
            `<label class="dep-serial-chk" style="font-size:12px;color:var(--text-muted);font-family:var(--mono);"><input type="checkbox" class="dep-serial-chk-input" data-id="${pd.id}" data-serial="${esc(s)}" checked />${esc(s)}</label>`
          ).join('');
          return `<div class="dep-pending-group">
            <div class="dep-pending-group-header">
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" class="dep-group-chk" data-id="${pd.id}" title="Select this entry for batch confirm" />
                <span class="dep-pending-group-title">${esc(pd.customer)}</span>
                <span class="cat-badge">${esc(pd.product)}</span>
                ${pd.location ? `<span class="loc-badge">${esc(pd.location)}</span>` : ''}
                <span class="badge-pending-deploy">📋 Pending</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:12px;color:var(--text-muted);">${pd.serials.length} unit${pd.serials.length!==1?'s':''}${costed>0?` · $${totalCost.toFixed(2)}`:''}${pd.stagedAt ? ' · Staged '+fmtDate(pd.stagedAt) : ''}</span>
                <button class="btn btn-orange btn-sm dep-confirm-btn" data-id="${pd.id}">✓ Confirm Deployed</button>
                <button class="btn btn-ghost btn-sm dep-unstage-btn" data-id="${pd.id}" style="color:var(--danger-text);">✕ Cancel</button>
              </div>
            </div>
            <div class="dep-serial-list">${serialChecks}</div>
          </div>`;
        }).join('');

        // Returns the checked serials for a given pending id
        const checkedSerials = (id) => Array.from(
          pendingBody.querySelectorAll(`.dep-serial-chk-input[data-id="${id}"]:checked`)
        ).map(cb => cb.dataset.serial);

        // Ids of the staged entries selected (group checkbox ticked) for batch confirm
        const selectedGroupIds = () => Array.from(
          pendingBody.querySelectorAll('.dep-group-chk:checked')
        ).map(chk => chk.dataset.id);

        // Update the "Confirm Selected (N)" label — N = checked serials in selected groups
        const updateSelectedCount = () => {
          const n = selectedGroupIds().reduce((a, id) => a + checkedSerials(id).length, 0);
          const btn = document.getElementById('dep-confirm-selected');
          if (btn) btn.textContent = `✓ Confirm Selected (${n})`;
          const all = document.getElementById('dep-select-all');
          if (all) {
            const groups = pendingBody.querySelectorAll('.dep-group-chk').length;
            const checked = pendingBody.querySelectorAll('.dep-group-chk:checked').length;
            all.checked = checked > 0;
            all.indeterminate = checked > 0 && checked < groups;
          }
        };

        // Group checkbox selects the entry for batch confirm (independent of its serials)
        pendingBody.querySelectorAll('.dep-group-chk').forEach(chk => {
          chk.addEventListener('change', updateSelectedCount);
        });

        // Serial checkbox just refreshes the count
        pendingBody.querySelectorAll('.dep-serial-chk-input').forEach(cb => {
          cb.addEventListener('change', updateSelectedCount);
        });

        // Header "All" toggle — selects/deselects all staged entries
        const selectAll = document.getElementById('dep-select-all');
        if (selectAll) {
          selectAll.onchange = () => {
            pendingBody.querySelectorAll('.dep-group-chk').forEach(chk => { chk.checked = selectAll.checked; });
            updateSelectedCount();
          };
        }

        // Confirm Selected — batch confirm checked serials in the selected groups
        const confirmSelectedBtn = document.getElementById('dep-confirm-selected');
        if (confirmSelectedBtn) {
          confirmSelectedBtn.onclick = () => {
            const ids = selectedGroupIds();
            const selections = ids
              .map(id => ({ id: Number(id), serials: checkedSerials(id) }))
              .filter(sel => sel.serials.length);
            const total = selections.reduce((a, s) => a + s.serials.length, 0);
            if (!total) { UI.showAlert('Select one or more staged entries to confirm.', 'error'); return; }
            if (!confirm(`Confirm deployment of ${total} unit${total!==1?'s':''} across ${selections.length} group${selections.length!==1?'s':''}?

This will remove them from Stock Holding and add them to Stock Deployed.`)) return;
            try {
              Inventory.confirmDeployments(selections);
              UI.renderDashboard && UI.renderDashboard();
              renderDeployed();
            } catch(e) { UI.showAlert(e.message, 'error'); }
          };
        }

        // Wire per-group confirm buttons (confirms that group's checked serials)
        pendingBody.querySelectorAll('.dep-confirm-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pd = DB.getPendingDeployments().find(p => p.id == btn.dataset.id);
            if (!pd) return;
            const serials = checkedSerials(btn.dataset.id);
            if (!serials.length) { UI.showAlert('Select at least one item in this group to confirm.', 'error'); return; }
            if (!confirm(`Confirm deployment of ${serials.length} unit${serials.length!==1?'s':''} to "${pd.customer}"?

This will remove them from Stock Holding and add them to Stock Deployed.`)) return;
            try {
              Inventory.confirmDeployment(Number(btn.dataset.id), serials);
              UI.renderDashboard && UI.renderDashboard();
              renderDeployed();
            } catch(e) { UI.showAlert(e.message, 'error'); }
          });
        });

        // Wire cancel/unstage buttons
        pendingBody.querySelectorAll('.dep-unstage-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pd = DB.getPendingDeployments().find(p => p.id == btn.dataset.id);
            if (!pd) return;
            if (!confirm(`Cancel staged deployment for "${pd.customer}"?

Items will remain in Stock Holding with no customer attached.`)) return;
            DB.removePendingDeployment(Number(btn.dataset.id));
            renderDeployed();
          });
        });

        updateSelectedCount();
      } else {
        pendingPanel.style.display = 'none';
      }
    }

    // ── Tab switching (By Unit / By Restaurant) ─────────────────────
    const tab = localStorage.getItem(DEPLOYED_TAB_KEY) === 'restaurant' ? 'restaurant' : 'unit';
    const unitView = document.getElementById('dep-unit-view');
    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (detView)  detView.style.display  = 'none';
    if (unitView) unitView.style.display = tab === 'unit'       ? '' : 'none';
    if (restView) restView.style.display = tab === 'restaurant' ? '' : 'none';
    styleDeployedTabs(tab);
    if (tab === 'restaurant') { renderRestaurantBuckets(); return; }

    let rows = _filteredDeployedRows();

    const totalCost    = rows.filter(r => r.cost != null).reduce((a, r) => a + r.cost, 0);
    const costedCount  = rows.filter(r => r.cost != null).length;

    const tbody = document.getElementById('dep-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty">No deployed stock found</div></td></tr>';
    } else {
      tbody.innerHTML = rows.map(r => `<tr>
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category || '—')}</span></td>
        <td><strong>${esc(r.customer || '—')}</strong></td>
        <td style="font-size:11px;color:var(--text-muted)">${esc(r.by || '—')}</td>
        <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
        <td style="font-size:12px">${r.cost != null ? '$' + r.cost.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td><button class="btn btn-ghost btn-sm recall-btn" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" data-location="${esc(r.location||'')}">🔧 Recall</button></td>
      </tr>`).join('');

      // Wire recall buttons
      tbody.querySelectorAll('.recall-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          UI._.showRecallModal(btn.dataset.serial, btn.dataset.product, btn.dataset.location);
        });
      });
    }

    const footer = document.getElementById('dep-footer');
    footer.textContent = rows.length
      ? `${rows.length} unit${rows.length!==1?'s':''} deployed${costedCount > 0 ? ` · Total cost: $${totalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : ''}`
      : '';
  }

  function populateDeployedFilters() {
    // Customer filter
    const customers = Inventory.getCustomers();
    const custSel = document.getElementById('dep-customer-filter');
    const curCust = custSel.value;
    custSel.innerHTML = '<option value="">All customers</option>' + customers.map(c => `<option value="${esc(c)}"${c===curCust?' selected':''}>${esc(c)}</option>`).join('');
    // Category filter — also needed here, not just in UI.populateCategoryFilters
    const catSel = document.getElementById('dep-cat-filter');
    if (catSel) {
      const curCat = catSel.value;
      catSel.innerHTML = '<option value="">All categories</option>' +
        CATEGORIES.map(c => `<option value="${esc(c)}"${c===curCat?' selected':''}>${esc(c)}</option>`).join('');
    }
  }

  const PENDING_COLLAPSE_KEY = 'aio_dep_pending_collapsed';
  function applyPendingCollapse() {
    const collapsed = localStorage.getItem(PENDING_COLLAPSE_KEY) === '1';
    const body     = document.getElementById('dep-pending-body');
    const controls = document.getElementById('dep-pending-controls');
    const chevron  = document.getElementById('dep-pending-chevron');
    if (body)     body.style.display     = collapsed ? 'none' : '';
    if (controls) controls.style.display = collapsed ? 'none' : '';
    if (chevron)  chevron.textContent    = collapsed ? '▸' : '▾';
  }
  function togglePendingCollapse() {
    const collapsed = localStorage.getItem(PENDING_COLLAPSE_KEY) === '1';
    localStorage.setItem(PENDING_COLLAPSE_KEY, collapsed ? '0' : '1');
    applyPendingCollapse();
  }

  // ── Deployed: By Unit / By Restaurant tabs ───────────────────────────
  const DEPLOYED_TAB_KEY = 'aio_dep_tab';
  function _money(n) { return '$' + (n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function _pct(val, avg) {
    if (!avg) return '';
    const d = Math.round((val - avg) / avg * 100);
    const color = d > 0 ? 'var(--success-text, #4AA37B)' : (d < 0 ? 'var(--danger-text)' : 'var(--text-muted)');
    const sign = d > 0 ? '+' : '';
    return `<span style="color:${color};font-weight:600;">${sign}${d}%</span> vs avg`;
  }
  function styleDeployedTabs(tab) {
    const u = document.getElementById('dep-tab-unit');
    const r = document.getElementById('dep-tab-restaurant');
    if (u) u.className = 'btn btn-sm ' + (tab === 'unit'       ? 'btn-orange' : 'btn-ghost');
    if (r) r.className = 'btn btn-sm ' + (tab === 'restaurant' ? 'btn-orange' : 'btn-ghost');
  }
  function setDeployedTab(tab) {
    localStorage.setItem(DEPLOYED_TAB_KEY, tab === 'restaurant' ? 'restaurant' : 'unit');
    renderDeployed();
  }

  function renderRestaurantBuckets() {
    const buckets = Inventory.getDeployedByCustomer();
    const n = buckets.length;
    const totalUnits = buckets.reduce((a, b) => a + b.units, 0);
    const totalValue = buckets.reduce((a, b) => a + b.value, 0);
    const avgUnits = n ? totalUnits / n : 0;
    const avgValue = n ? totalValue / n : 0;

    const avgEl = document.getElementById('dep-bucket-avg');
    if (avgEl) {
      avgEl.textContent = n
        ? `${n} restaurant${n!==1?'s':''} · ${totalUnits} unit${totalUnits!==1?'s':''} deployed · avg ${avgUnits.toFixed(1)} units · avg ${_money(avgValue)} each`
        : '';
    }

    const search = (document.getElementById('dep-bucket-search')?.value || '').trim().toLowerCase();
    const filtered = buckets.filter(b => !search || b.customer.toLowerCase().includes(search));

    const grid = document.getElementById('dep-buckets');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty">No deployed stock found</div>';
      return;
    }
    grid.innerHTML = filtered.map(b => {
      const topProducts = Object.entries(b.products).sort((a, c) => c[1] - a[1]).slice(0, 3)
        .map(([p, c]) => `<span class="cat-badge">${esc(p)} ×${c}</span>`).join(' ');
      return `<div class="dep-bucket-card" data-customer="${esc(b.customer)}" style="border:1px solid var(--border);border-radius:8px;padding:14px;cursor:pointer;background:var(--bg-2);">
        <div style="font-weight:600;font-size:14px;margin-bottom:6px;">${esc(b.customer)}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">${b.units} unit${b.units!==1?'s':''} · ${_money(b.value)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${topProducts}</div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.dep-bucket-card').forEach(card => {
      card.addEventListener('click', () => openRestaurantDetail(card.dataset.customer));
    });
  }

  function openRestaurantDetail(customer) {
    const d = Inventory.getCustomerDetail(customer);
    const buckets = Inventory.getDeployedByCustomer();
    const n = buckets.length;
    const avgUnits = n ? buckets.reduce((a, b) => a + b.units, 0) / n : 0;
    const avgValue = n ? buckets.reduce((a, b) => a + b.value, 0) / n : 0;

    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (restView) restView.style.display = 'none';
    if (detView)  detView.style.display  = '';

    const costCell = c => c != null
      ? '$' + c.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})
      : '<span style="color:var(--text-hint)">—</span>';

    const currentRows = d.current.length
      ? d.current.map(r => `<tr>
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
          <td style="font-size:12px">${costCell(r.cost)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4"><div class="empty">No hardware currently on site</div></td></tr>';

    const pastRows = d.past.length
      ? d.past.map(r => `<tr>
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
          <td style="font-size:11px;color:var(--text-muted)">${esc(r.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4"><div class="empty">No previous hardware on record</div></td></tr>';

    const timelineRows = d.timeline.length
      ? d.timeline.map(t => `<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:11px;color:var(--text-hint);min-width:120px;">${fmtDateFull(t.date)}</span>
          <span style="font-weight:500;">${esc(t.product)}</span>
          <span class="cat-badge">${t.count} unit${t.count!==1?'s':''}</span>
          <span style="font-size:11px;color:var(--text-muted);">${esc(t.by || '—')}${t.ref ? ' · '+esc(t.ref) : ''}</span>
        </div>`).join('')
      : '<div class="empty">No deployment history</div>';

    document.getElementById('dep-detail-body').innerHTML = `
      <div style="margin-bottom:18px;">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">${esc(d.customer)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:24px;">
          <div>
            <div style="font-size:24px;font-weight:700;">${d.units}</div>
            <div style="font-size:12px;color:var(--text-muted);">unit${d.units!==1?'s':''} on site · ${_pct(d.units, avgUnits)} (${avgUnits.toFixed(1)})</div>
          </div>
          <div>
            <div style="font-size:24px;font-weight:700;">${_money(d.value)}</div>
            <div style="font-size:12px;color:var(--text-muted);">total value · ${_pct(d.value, avgValue)} (${_money(avgValue)})</div>
          </div>
        </div>
      </div>

      <div class="panel-title" style="margin-top:8px;">Current hardware on site</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:28%">Serial number</th><th style="width:40%">Product</th>
          <th style="width:20%">Date deployed</th><th style="width:12%">Cost</th>
        </tr></thead>
        <tbody>${currentRows}</tbody>
      </table></div>

      <div class="panel-title" style="margin-top:18px;">Previous hardware (no longer here)</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:28%">Serial number</th><th style="width:32%">Product</th>
          <th style="width:20%">Last deployed here</th><th style="width:20%">Status</th>
        </tr></thead>
        <tbody>${pastRows}</tbody>
      </table></div>

      <div class="panel-title" style="margin-top:18px;">Deployment history</div>
      <div>${timelineRows}</div>
    `;
  }

  function closeRestaurantDetail() {
    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (detView)  detView.style.display  = 'none';
    if (restView) restView.style.display = '';
  }

  function exportDeployedCSV() {
    const rows = [['Serial Number','Product','Category','Customer / Account','Dispatched By','Date Deployed','Reference','Cost']];
    _filteredDeployedRows().forEach(r => {
      rows.push([r.serial, r.product, r.category, r.customer, r.by, fmtDateTimeISO(r.date), r.ref, r.cost != null ? r.cost : '']);
    });
    _dlCSV(rows, 'aio_stock_deployed.csv');
  }

  function exportDeployedXLSX() {
    const header = ['Serial Number','Terminal Device Name','Customer / Account','Location','Value','Date Deployed'];
    const data = _filteredDeployedRows().map(r => [
      r.serial,
      r.product,
      r.customer || '',
      r.location || '',
      r.cost != null ? r.cost : '',
      fmtDateTimeISO(r.date),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deployed Terminals');
    XLSX.writeFile(wb, 'aio_deployed_terminals.xlsx');
  }

  Object.assign(UI, { renderDeployed, populateDeployedFilters, togglePendingCollapse, setDeployedTab, closeRestaurantDetail, exportDeployedCSV, exportDeployedXLSX });
})();
