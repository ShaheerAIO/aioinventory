/**
 * ui/stock-list.js — Stock Holding view: per-product breakdown + serial table
 */
(() => {
  const { showAlert, _dlCSV, esc, _conditionLabel } = UI._;

  // ── Stock Breakdown (by product, with condition columns) ─────────────
  let _invProductFilter = ''; // product name filter set by clicking a breakdown row
  const _invSelected = new Set(); // serials ticked in the serial table (for transfers)

  function renderStockBreakdown() {
    const tbody   = document.getElementById('inv-breakdown-body');
    const footer  = document.getElementById('inv-breakdown-footer');
    if (!tbody) return;

    const allInStock = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock');
    const byProduct  = {};
    allInStock.forEach(r => {
      if (!byProduct[r.product]) byProduct[r.product] = { product: r.product, category: r.category, total: 0, working: 0, testing: 0, faulty: 0, rma: 0, tl: 0 };
      byProduct[r.product].total++;
      const c = r.condition || '';
      if (!c)                    byProduct[r.product].working++;
      else if (c === 'needs-testing') byProduct[r.product].testing++;
      else if (c === 'faulty')   byProduct[r.product].faulty++;
      else if (c === 'rma')      byProduct[r.product].rma++;
      else if (c === 'fail-tl')  byProduct[r.product].tl++;
    });

    const rows = Object.values(byProduct).sort((a, b) => a.product.localeCompare(b.product));

    function cell(n, cls) {
      return n > 0
        ? `<td class="bd-nonzero ${cls}">${n}</td>`
        : `<td class="bd-zero">—</td>`;
    }

    tbody.innerHTML = rows.map(p => `
      <tr data-product="${esc(p.product)}" class="${_invProductFilter === p.product ? 'bd-row-active' : ''}">
        <td style="font-weight:500">${esc(p.product)}</td>
        <td><span class="cat-badge">${esc(p.category||'—')}</span></td>
        <td class="bd-total">${p.total}</td>
        <td class="bd-working">${p.working}</td>
        ${cell(p.testing, 'bd-testing')}
        ${cell(p.faulty,  'bd-faulty')}
        ${cell(p.rma,     'bd-rma')}
        ${cell(p.tl,      'bd-tl')}
        <td><button class="bd-filter-btn" data-product="${esc(p.product)}" title="Show serials for this product">${_invProductFilter === p.product ? "▲" : "▼"}</button></td>
      </tr>`).join('');

    // Totals row
    const tot = rows.reduce((a,p) => ({ total: a.total+p.total, working: a.working+p.working, testing: a.testing+p.testing, faulty: a.faulty+p.faulty, rma: a.rma+p.rma, tl: a.tl+p.tl }), { total:0, working:0, testing:0, faulty:0, rma:0, tl:0 });
    const tfoot = tbody.parentNode.querySelector('tfoot') || (() => { const tf = document.createElement('tfoot'); tbody.parentNode.appendChild(tf); return tf; })();
    tfoot.innerHTML = `<tr class="bd-tfoot">
      <td colspan="2" style="padding:9px 12px;">Total</td>
      <td class="bd-total">${tot.total}</td>
      <td class="bd-working">${tot.working}</td>
      ${cell(tot.testing,'bd-testing')}${cell(tot.faulty,'bd-faulty')}${cell(tot.rma,'bd-rma')}${cell(tot.tl,'bd-tl')}
      <td></td>
    </tr>`;

    if (footer) footer.textContent = `${rows.length} product line${rows.length!==1?'s':''} · ${tot.total} units in stock · ${tot.working} working`;

    // Row click → filter serial table
    tbody.querySelectorAll('tr[data-product]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.classList.contains('bd-filter-btn')) return; // let button handle
        _invProductFilter = _invProductFilter === tr.dataset.product ? '' : tr.dataset.product;
        renderStockBreakdown();
        renderStockList();
        if (_invProductFilter) {
          setTimeout(() => {
            const serialPanel = document.getElementById('inv-serial-panel');
            if (serialPanel) serialPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      });
    });
    tbody.querySelectorAll('.bd-filter-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _invProductFilter = _invProductFilter === btn.dataset.product ? '' : btn.dataset.product;
        renderStockBreakdown();
        renderStockList();
        // Scroll to serial panel so user sees the filtered results
        if (_invProductFilter) {
          setTimeout(() => {
            const serialPanel = document.getElementById('inv-serial-panel');
            if (serialPanel) serialPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      });
    });

    // Show/hide clear button
    const clearBtn = document.getElementById('btn-clear-product-filter');
    if (clearBtn) {
      clearBtn.style.display = _invProductFilter ? '' : 'none';
      clearBtn.onclick = () => { _invProductFilter = ''; renderStockBreakdown(); renderStockList(); };
    }
    // Update serial panel title
    const titleEl = document.getElementById('inv-serial-title');
    if (titleEl) titleEl.textContent = _invProductFilter ? `Serials — ${_invProductFilter}` : 'All serials';
  }

  // Serial rows matching the search/category/location/status filters and the breakdown product pick
  function _filteredStockRows() {
    const search  = (document.getElementById('inv-search').value || '').trim().toLowerCase();
    const catF    = document.getElementById('inv-cat-filter').value;
    const locF    = document.getElementById('inv-loc-filter').value;
    const statusF = document.getElementById('inv-status-filter').value;
    return Inventory.getAllSerialRows().filter(r => {
      const ms = !search || r.serial.toLowerCase().includes(search) || r.product.toLowerCase().includes(search) || r.location.toLowerCase().includes(search);
      const mc = !catF   || r.category === catF;
      const ml = !locF   || r.location === locF;
      const mp = !_invProductFilter || r.product === _invProductFilter;
      // Status filter handles both stock status and condition/used flags
      let mst = true;
      if (statusF) {
        if (statusF === 'working') {
          mst = r.status === 'in-stock' && !r.condition;
        } else if (statusF === 'cond-used') {
          mst = r.used === true;
        } else if (statusF.startsWith('cond-')) {
          mst = r.condition === statusF.replace('cond-', '');
        } else {
          mst = r.status === statusF;
        }
      }
      return ms && mc && ml && mst && mp;
    });
  }

  function renderStockList() {
    const locF    = document.getElementById('inv-loc-filter').value;
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    const canEdit = typeof Auth !== 'undefined' && Auth.canEdit();
    // Serials staged for pending deployment (show badge in stock list)
    const _pendingDeploySerials = typeof Inventory !== 'undefined' && Inventory.getPendingDeploymentSerials
      ? Inventory.getPendingDeploymentSerials() : new Set();

    let rows = _filteredStockRows();

    const totalCost   = rows.filter(r => r.cost != null).reduce((a, r) => a + r.cost, 0);
    const costedCount = rows.filter(r => r.cost != null).length;

    // Editors and admins get an action column (edit serial / delete)
    const showActions = isAdmin || canEdit;
    // ...and a select column, for transferring stock between locations
    const showSelect  = canEdit;

    // Drop any selection that has since left stock (deployed, deleted, moved)
    const availableNow = Inventory.getAvailableSerials();
    [..._invSelected].forEach(sn => { if (!availableNow.has(sn)) _invSelected.delete(sn); });

    // Update table header to show/hide the select + action columns
    const thead = document.querySelector('#inv-serial-table thead tr');
    if (thead) {
      const existingSelectTh = thead.querySelector('.th-select');
      if (showSelect && !existingSelectTh) {
        const th = document.createElement('th');
        th.className = 'th-select';
        th.style.width = '30px';
        th.innerHTML = '<input type="checkbox" id="inv-select-all" title="Select everything shown" />';
        thead.insertBefore(th, thead.firstChild);
      } else if (!showSelect && existingSelectTh) {
        existingSelectTh.remove();
      }
      const existingAdminTh = thead.querySelector('.th-admin');
      if (showActions && !existingAdminTh) {
        const th = document.createElement('th');
        th.className = 'th-admin';
        th.style.width = '70px';
        thead.appendChild(th);
      } else if (!showActions && existingAdminTh) {
        existingAdminTh.remove();
      }
    }
    const colCount = 6 + (showSelect ? 1 : 0) + (showActions ? 1 : 0);

    // Serials the current filters expose that could be transferred (for select-all)
    const visibleInStock = rows.filter(r => r.status === 'in-stock').map(r => r.serial);

    const tbody = document.getElementById('inv-body');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty">No items found</div></td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const isPOLocked = !!r.poNumber;
        const canEditSerial = isAdmin || (canEdit && Inventory.isSerialEditable(r.product));
        return `<tr data-serial="${esc(r.serial)}">
          ${showSelect ? `<td>${r.status === 'in-stock'
            ? `<input type="checkbox" class="inv-sel-chk" data-serial="${esc(r.serial)}"${_invSelected.has(r.serial) ? ' checked' : ''} title="Select for transfer" />`
            : ''}</td>` : ''}
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${
            r.serial.startsWith('NS-')
              ? (canEdit && r.status === 'in-stock'
                  ? `<span class="add-serial-cell" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" style="font-family:var(--font);color:var(--aio-purple);font-size:11px;cursor:pointer;" title="Assign a serial number to this item">+ Add serial</span>`
                  : `<span style="font-family:var(--font);color:var(--text-hint);font-style:italic;font-size:11px;">No serial</span>`)
              : esc(r.serial)
          }</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
          <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
          <td>
            <span class="badge ${r.status==='in-stock'?'b-ok':'b-transit'}">${r.status==='in-stock'?'In stock':'In transit'}</span>
            ${r.used ? '<span class="badge b-used" style="margin-left:4px;">USED</span>' : ''}
            ${r.condition ? `<span class="badge b-condition b-cond-${r.condition}" style="margin-left:4px;">${_conditionLabel(r.condition)}</span>` : ''}
            ${_pendingDeploySerials.has(r.serial.toUpperCase()) ? '<span class="badge-pending-deploy" style="margin-left:4px;">📋 Pending Deploy</span>' : ''}
          </td>
          <td class="${isPOLocked ? 'cost-cell-locked' : 'cost-cell'}"
            data-product="${esc(r.product)}" data-serial="${esc(r.serial)}"
            style="cursor:${isPOLocked ? 'default' : 'pointer'};"
            ${isPOLocked ? '' : `title="Click to edit — updates all ${esc(r.product)} units"`}>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${r.cost != null
                ? `<span class="cost-val">$${r.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`
                : `<span style="color:var(--text-hint);font-size:11px">${isPOLocked ? '—' : '+ Add cost'}</span>`}
              ${isPOLocked ? `<span class="po-lock-badge" title="Price locked to PO: ${esc(r.poNumber)}">🔒 ${esc(r.poNumber)}</span>` : ''}
            </div>
          </td>
          ${showActions ? `<td style="white-space:nowrap;text-align:right;">
            ${canEditSerial ? `<button class="btn-icon-edit" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" title="Edit serial number">✎</button>` : ''}
            ${isAdmin ? `<button class="btn-icon-del"  data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" title="Delete this item" style="margin-left:4px;">✕</button>` : ''}
          </td>` : ''}
        </tr>`;
      }).join('');

      // Cost cell inline editor
      tbody.querySelectorAll('.cost-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          if (cell.querySelector('input')) return;
          const product = cell.dataset.product;
          const serial  = cell.dataset.serial;
          const cur = DB.getSerialCost(serial);
          cell.innerHTML = `<div style="display:flex;align-items:center;gap:4px;">
            <input class="serial-cost-input" type="number" min="0" step="0.01"
              value="${cur != null ? cur : ''}" placeholder="0.00" style="width:85px;" />
            <span style="font-size:10px;color:var(--aio-purple);white-space:nowrap">all ${esc(product)}</span>
          </div>`;
          const inp = cell.querySelector('input');
          inp.focus(); inp.select();
          const save = () => {
            const cost = inp.value !== '' ? parseFloat(inp.value) : null;
            DB.setProductCost(product, cost, Inventory.getInventoryMap());
            renderStockList();
          };
          inp.addEventListener('blur', save);
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
            if (e.key === 'Escape') { inp.removeEventListener('blur', save); renderStockList(); }
          });
        });
      });

      // Add serial to a no-serial (placeholder) item
      tbody.querySelectorAll('.add-serial-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          UI._._showEditSerialModal(cell.dataset.serial, cell.dataset.product, true);
        });
      });

      // Admin: edit serial
      tbody.querySelectorAll('.btn-icon-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const oldSerial = btn.dataset.serial;
          const product   = btn.dataset.product;
          UI._._showEditSerialModal(oldSerial, product);
        });
      });

      // Tick / untick a row for transfer
      tbody.querySelectorAll('.inv-sel-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          if (chk.checked) _invSelected.add(chk.dataset.serial);
          else             _invSelected.delete(chk.dataset.serial);
          UI._._syncTransferBar(visibleInStock, locF, showSelect);
        });
      });

      // Admin: delete serial
      tbody.querySelectorAll('.btn-icon-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const serial  = btn.dataset.serial;
          const product = btn.dataset.product;
          if (!confirm(`Delete serial "${serial}" (${product})?\n\nThis will remove it from stock permanently.`)) return;
          DB.deleteSerial(serial);
          renderStockList();
          showAlert(`Serial ${serial} deleted`, 'success');
        });
      });
    }

    UI._._syncTransferBar(visibleInStock, locF, showSelect);
    UI._._syncRenameLocationButton(canEdit, locF);

    const footer = document.getElementById('inv-footer');
    footer.textContent = rows.length
      ? `${rows.length} serial${rows.length!==1?'s':''} shown${costedCount > 0 ? ` · Total cost: $${totalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${costedCount} priced)` : ' · Click any cost cell to add/edit price'}`
      : '';


  }

  // ── Populate category dropdowns from CATEGORIES constant ─────────────
  function populateCategoryFilters() {
    const cats = CATEGORIES;
    ['inv-cat-filter','dep-cat-filter','hist-cat-filter'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">All categories</option>' +
        cats.map(c => `<option value="${esc(c)}"${c===cur?' selected':''}>${esc(c)}</option>`).join('');
    });
  }

  function populateStockListFilters() {
    populateCategoryFilters();
    const locs = Inventory.getLocations();
    const sel  = document.getElementById('inv-loc-filter');
    const cur  = sel.value;
    sel.innerHTML = '<option value="">All locations</option>' + locs.map(l => `<option value="${esc(l)}"${l===cur?' selected':''}>${esc(l)}</option>`).join('');
  }

  // ── CSV exports ───────────────────────────────────────────────────────
  function exportInventoryCSV() {
    const rows = [['Serial Number','Product','Category','Location','Status','Cost','PO Number']];
    _filteredStockRows().forEach(r => {
      rows.push([r.serial, r.product, r.category, r.location, r.status, r.cost != null ? r.cost : '', r.poNumber || '']);
    });
    _dlCSV(rows, 'aio_stock.csv');
  }

  Object.assign(UI, { renderStockBreakdown, renderStockList, populateStockListFilters, populateCategoryFilters, exportInventoryCSV });
  Object.assign(UI._, { _invSelected });
})();
