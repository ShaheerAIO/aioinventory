/**
 * ui/servicing.js — Servicing view + test outcome modal
 */
(() => {
  const { showAlert, esc, fmtDate, _conditionLabel } = UI._;

  // ── Servicing view ─────────────────────────────────────────────────────
  const _svcSelected = new Set(); // serials ticked for bulk move to RMA
  const _canBulkRma  = r => r.condition === 'needs-testing' || r.condition === 'faulty';

  function renderServicing() {
    const search  = (document.getElementById('svc-search')?.value || '').trim().toLowerCase();
    const flagF   = document.getElementById('svc-flag-filter')?.value || '';
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    const canEdit = typeof Auth !== 'undefined' && Auth.canEdit();

    // All workshop items (any condition except 'used')
    const allWorkshopRows = Inventory.getAllSerialRows().filter(r => r.condition && r.condition !== 'used');

    // ── Stats & breakdown panels ───────────────────────────────────────
    const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
    const CONDITIONS = [
      { key: 'needs-testing', label: '🔬 Needs Testing', cls: 'svc-stat-testing' },
      { key: 'faulty',        label: '⚠ Faulty',        cls: 'svc-stat-faulty'  },
      { key: 'rma',           label: '⛔ RMA',           cls: 'svc-stat-rma'    },
      { key: 'fail-tl',       label: '🗑 Total Loss',    cls: 'svc-stat-tl'     },
    ];
    const condTotals = {};
    CONDITIONS.forEach(c => { condTotals[c.key] = { count: 0, value: 0 }; });
    allWorkshopRows.forEach(r => {
      if (condTotals[r.condition]) {
        condTotals[r.condition].count++;
        if (r.cost != null) condTotals[r.condition].value += r.cost;
      }
    });
    const totalCount = allWorkshopRows.length;
    const totalValue = allWorkshopRows.reduce((a, r) => a + (r.cost || 0), 0);

    const statsPanel = document.getElementById('svc-stats-panel');
    if (statsPanel) {
      statsPanel.innerHTML = `
        <div class="panel-title" style="margin-bottom:10px;">Workshop summary</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="svc-stat-card svc-stat-total">
            <div class="svc-stat-count">${totalCount}</div>
            <div class="svc-stat-label">Total in workshop</div>
            <div class="svc-stat-value">${fmt$(totalValue)}</div>
          </div>
          ${CONDITIONS.map(c => `
          <div class="svc-stat-card ${c.cls}">
            <div class="svc-stat-count">${condTotals[c.key].count}</div>
            <div class="svc-stat-label">${c.label}</div>
            <div class="svc-stat-value">${fmt$(condTotals[c.key].value)}</div>
          </div>`).join('')}
        </div>`;
    }

    // ── Per-product breakdown ──────────────────────────────────────────
    const prodMap = {};
    allWorkshopRows.forEach(r => {
      if (!prodMap[r.product]) prodMap[r.product] = { product: r.product, category: r.category, 'needs-testing': 0, faulty: 0, rma: 0, 'fail-tl': 0, total: 0, value: 0 };
      if (prodMap[r.product][r.condition] !== undefined) prodMap[r.product][r.condition]++;
      prodMap[r.product].total++;
      if (r.cost != null) prodMap[r.product].value += r.cost;
    });
    const prodRows = Object.values(prodMap).sort((a, b) => b.total - a.total);
    const breakdownPanel = document.getElementById('svc-breakdown-panel');
    const breakdownTable = document.getElementById('svc-breakdown-table');
    if (breakdownPanel && breakdownTable) {
      if (prodRows.length) {
        breakdownPanel.style.display = '';
        breakdownTable.innerHTML = `<table class="product-stock-table">
          <thead><tr>
            <th style="width:28%">Product</th>
            <th style="width:14%">Category</th>
            <th style="width:12%">🔬 Testing</th>
            <th style="width:10%">⚠ Faulty</th>
            <th style="width:10%">⛔ RMA</th>
            <th style="width:10%">🗑 TL</th>
            <th style="width:8%">Total</th>
            <th style="width:8%">Value</th>
          </tr></thead>
          <tbody>
            ${prodRows.map(p => `<tr>
              <td style="font-weight:500">${esc(p.product)}</td>
              <td><span class="cat-badge">${esc(p.category||'—')}</span></td>
              <td>${p['needs-testing'] > 0 ? `<span class="cond-inline cond-inline-testing">${p['needs-testing']}</span>` : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p.faulty    > 0 ? `<span class="cond-inline cond-inline-faulty">${p.faulty}</span>`         : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p.rma       > 0 ? `<span class="cond-inline cond-inline-rma">${p.rma}</span>`               : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p['fail-tl']> 0 ? `<span class="cond-inline cond-inline-tl">${p['fail-tl']}</span>`        : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td style="font-weight:600">${p.total}</td>
              <td style="font-weight:600;color:var(--aio-purple)">${fmt$(p.value)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--border-md);">
              <td colspan="2" style="font-weight:700;font-size:12px;color:var(--text-muted);padding-top:8px;">Total</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['needs-testing'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['faulty'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['rma'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['fail-tl'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${totalCount}</td>
              <td style="padding-top:8px;font-weight:700;color:var(--aio-purple)">${fmt$(totalValue)}</td>
            </tr>
          </tfoot>
        </table>`;
      } else {
        breakdownPanel.style.display = 'none';
      }
    }

    // ── Serial table (filtered) ────────────────────────────────────────
    const rows = allWorkshopRows.filter(r => {
      const mf = !flagF  || r.condition === flagF;
      const ms = !search || r.serial.toLowerCase().includes(search)
                         || r.product.toLowerCase().includes(search)
                         || (r.location||'').toLowerCase().includes(search);
      return mf && ms;
    });

    const tbody = document.getElementById('svc-body');
    const footer = document.getElementById('svc-footer');
    if (!tbody) return;

    // Drop selections that are no longer eligible (moved, passed, deleted)
    const eligibleNow = new Set(allWorkshopRows.filter(_canBulkRma).map(r => r.serial));
    [..._svcSelected].forEach(sn => { if (!eligibleNow.has(sn)) _svcSelected.delete(sn); });
    const visibleEligible = rows.filter(_canBulkRma).map(r => r.serial);
    const selectTh = document.querySelector('#v-servicing .th-select');
    if (selectTh) selectTh.style.display = canEdit ? '' : 'none';
    _syncBulkRma(visibleEligible, canEdit);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${canEdit ? 11 : 10}"><div class="empty">${flagF || search ? 'No matching items' : 'No items in servicing'}</div></td></tr>`;
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => `<tr>
      ${canEdit ? `<td>${_canBulkRma(r)
        ? `<input type="checkbox" class="svc-sel-chk" data-serial="${esc(r.serial)}"${_svcSelected.has(r.serial) ? ' checked' : ''} title="Select to move to RMA" />`
        : ''}</td>` : ''}
      <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
      <td style="font-weight:500">${esc(r.product)}</td>
      <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
      <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
      <td><span class="badge b-condition b-cond-${r.condition}">${_conditionLabel(r.condition)}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$'+r.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes)}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="text-align:right;">
        ${canEdit ? `<button class="btn btn-primary btn-xs svc-test-btn"
          data-serial="${esc(r.serial)}"
          data-product="${esc(r.product)}"
          data-condition="${esc(r.condition)}">
          Log outcome
        </button>` : ''}
      </td>
    </tr>`).join('');

    if (footer) footer.textContent = `${rows.length} item${rows.length!==1?'s':''} shown · ${totalCount} total in workshop · Value: ${fmt$(totalValue)}`;

    // Wire test outcome buttons
    tbody.querySelectorAll('.svc-test-btn').forEach(btn => {
      btn.addEventListener('click', () => _showTestOutcomeModal(btn.dataset.serial, btn.dataset.product, btn.dataset.condition));
    });

    tbody.querySelectorAll('.svc-sel-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) _svcSelected.add(chk.dataset.serial);
        else             _svcSelected.delete(chk.dataset.serial);
        _syncBulkRma(visibleEligible, canEdit);
      });
    });
  }

  // Select-all checkbox + "Move N to RMA" button state
  function _syncBulkRma(visibleEligible, canEdit) {
    const btn = document.getElementById('svc-bulk-rma');
    const all = document.getElementById('svc-select-all');
    if (btn) {
      btn.style.display = canEdit && _svcSelected.size ? '' : 'none';
      btn.textContent = `Move ${_svcSelected.size} to RMA`;
      btn.onclick = _bulkMoveToRma;
    }
    if (all) {
      const ticked = visibleEligible.filter(sn => _svcSelected.has(sn)).length;
      all.checked = visibleEligible.length > 0 && ticked === visibleEligible.length;
      all.indeterminate = ticked > 0 && ticked < visibleEligible.length;
      all.disabled = !visibleEligible.length;
      all.onchange = () => {
        visibleEligible.forEach(sn => all.checked ? _svcSelected.add(sn) : _svcSelected.delete(sn));
        renderServicing();
      };
    }
  }

  function _bulkMoveToRma() {
    const serials = [..._svcSelected];
    if (!serials.length) return;
    if (!confirm(`Move ${serials.length} item${serials.length !== 1 ? 's' : ''} to RMA?\n\n${serials.join(', ')}`)) return;
    const testedBy = typeof Auth !== 'undefined' ? Auth.getName() : '';
    DB.updateSerialConditions(serials, 'rma', testedBy, new Date().toISOString().slice(0,10));
    _svcSelected.clear();
    renderServicing();
    showAlert(`${serials.length} item${serials.length !== 1 ? 's' : ''} moved to RMA`, 'success');
  }

  // ── Test outcome modal ─────────────────────────────────────────────────
  async function _showTestOutcomeModal(serial, product, currentCondition) {
    const existing = document.getElementById('svc-modal');
    if (existing) existing.remove();

    // Load users for the "tested by" dropdown
    let users = [];
    try { users = await UserManager.listUsers(); } catch(e) {}
    const currentUser = typeof Auth !== 'undefined' ? Auth.getName() : '';
    const today = new Date().toISOString().slice(0,10);

    const modal = document.createElement('div');
    modal.id = 'svc-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:480px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>Log test outcome</span>
          <button class="btn-remove-row" id="svc-modal-close">×</button>
        </div>

        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px;margin-bottom:1.25rem;">
          <div style="font-size:11px;color:var(--text-hint);margin-bottom:3px;">Item</div>
          <div style="font-weight:600;font-size:13px;">${esc(product)}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(serial)}</div>
          <div style="margin-top:6px;"><span class="badge b-condition b-cond-${currentCondition}">${_conditionLabel(currentCondition)}</span></div>
        </div>

        <div class="form-grid g2" style="margin-bottom:1rem;">
          <div class="form-group">
            <label class="form-label">Tested by *</label>
            <select class="fi" id="svc-tested-by">
              ${users.length
                ? users.map(u => `<option value="${esc(u.name)}"${u.name===currentUser?' selected':''}>${esc(u.name)}</option>`).join('')
                : `<option value="${esc(currentUser)}">${esc(currentUser)}</option>`}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Test date *</label>
            <input class="fi" type="date" id="svc-tested-date" value="${today}" />
          </div>
        </div>

        <div class="form-group" style="margin-bottom:1.25rem;">
          <label class="form-label">Outcome notes</label>
          <textarea class="fi" id="svc-test-notes" rows="3"
            placeholder="Describe what was tested and any findings..."
            style="resize:vertical;font-size:13px;"></textarea>
        </div>

        <div class="form-group" style="margin-bottom:1.5rem;">
          <label class="form-label">Test result *</label>
          <div class="condition-flags">
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="pass" checked />
              <span style="color:var(--success-text);">✓ Pass — clear flag</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="rma" />
              <span style="color:var(--danger-text);">⛔ Fail - RMA</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="fail-tl" />
              <span style="color:var(--danger-text);">🗑 Fail - TL</span>
            </label>
          </div>
        </div>

        <div id="svc-modal-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="svc-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="svc-modal-save">Save outcome</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('svc-modal-close').addEventListener('click', close);
    document.getElementById('svc-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    document.getElementById('svc-modal-save').addEventListener('click', () => {
      const testedBy   = document.getElementById('svc-tested-by').value.trim();
      const testedDate = document.getElementById('svc-tested-date').value;
      const notes      = document.getElementById('svc-test-notes').value.trim();
      const outcome    = document.querySelector('input[name="svc-outcome"]:checked')?.value;
      const errEl      = document.getElementById('svc-modal-error');

      if (!testedBy)   { errEl.textContent = 'Please select who tested this item.'; errEl.style.display='block'; return; }
      if (!testedDate) { errEl.textContent = 'Please enter the test date.'; errEl.style.display='block'; return; }

      const newCondition = outcome === 'rma' ? 'rma' : outcome === 'fail-tl' ? 'fail-tl' : '';  // db.js preserves USED
      DB.updateSerialCondition(serial, newCondition, testedBy, testedDate, notes);

      close();
      renderServicing();
      if (outcome === 'rma') {
        showAlert(`${serial} marked as RMA`, 'success');
      } else if (outcome === 'fail-tl') {
        showAlert(`${serial} marked as Total Loss`, 'success');
      } else {
        showAlert(`${serial} passed testing — flag cleared`, 'success');
      }
    });
  }

  Object.assign(UI, { renderServicing });
})();
