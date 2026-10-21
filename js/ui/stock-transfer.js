/**
 * ui/stock-transfer.js — Stock Holding actions: transfer units between locations, rename a location
 */
(() => {
  const { showAlert, populateDataLists, esc, SmartSelect, refreshSmartSelects } = UI._;

  // ── Transfer between locations ─────────────────────────────────────────
  // Toolbar above the serial table: transfer the ticked rows, or everything at
  // the location currently filtered on (a whole-warehouse move).
  function _syncTransferBar(visibleInStock, locF, canEdit) {
    const bar = document.getElementById('inv-transfer-bar');
    if (!bar) return;
    bar.style.display = canEdit ? 'flex' : 'none';
    if (!canEdit) return;

    const selBtn = document.getElementById('btn-transfer-selected');
    const locBtn = document.getElementById('btn-transfer-location');
    const hint   = document.getElementById('inv-transfer-hint');
    const n      = UI._._invSelected.size;

    selBtn.textContent   = n ? `⇄ Dispatch selected (${n})` : '⇄ Dispatch selected';
    selBtn.disabled      = n === 0;
    selBtn.style.opacity = n === 0 ? '0.5' : '';
    selBtn.onclick       = () => { if (UI._._invSelected.size) _showTransferModal([...UI._._invSelected]); };

    // Whole-location move — only offered once the location filter narrows to one
    const atLoc = locF
      ? Inventory.getAllSerialRows().filter(r => r.status === 'in-stock' && r.location === locF).map(r => r.serial)
      : [];
    if (atLoc.length) {
      locBtn.style.display = '';
      locBtn.textContent   = `⇄ Dispatch all ${atLoc.length} unit${atLoc.length !== 1 ? 's' : ''} at ${locF}`;
      locBtn.onclick       = () => _showTransferModal(atLoc);
    } else {
      locBtn.style.display = 'none';
      locBtn.onclick       = null;
    }

    const selectAll = document.getElementById('inv-select-all');
    if (selectAll) {
      selectAll.checked = visibleInStock.length > 0 && visibleInStock.every(sn => UI._._invSelected.has(sn));
      selectAll.onclick = () => {
        if (selectAll.checked) visibleInStock.forEach(sn => UI._._invSelected.add(sn));
        else                   visibleInStock.forEach(sn => UI._._invSelected.delete(sn));
        UI.renderStockList();
      };
    }

    if (hint) hint.textContent = n
      ? ''
      : (locF ? '' : 'Tick items to send them to another warehouse, or filter by location to move a whole warehouse');
  }

  // Paste a list of serials (one per line, or comma/tab/space separated) instead
  // of ticking rows one at a time. Serials not in stock are listed and skipped.
  function _showPasteSerialsModal() {
    const existing = document.getElementById('transfer-paste-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'transfer-paste-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:480px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>⇄ Paste serials to dispatch</span>
          <button class="btn-remove-row" id="transfer-paste-close">×</button>
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Serial numbers</label>
          <textarea class="fi fi-mono" id="transfer-paste-input" rows="10" style="resize:vertical;"
            placeholder="One per line, or separated by commas, tabs or spaces"></textarea>
          <div class="hint" id="transfer-paste-count">0 serials</div>
        </div>
        <div id="transfer-paste-missing" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;max-height:90px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="transfer-paste-cancel">Cancel</button>
          <button class="btn btn-primary" id="transfer-paste-continue" disabled>Continue</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const input   = document.getElementById('transfer-paste-input');
    const countEl = document.getElementById('transfer-paste-count');
    const missEl  = document.getElementById('transfer-paste-missing');
    const contBtn = document.getElementById('transfer-paste-continue');
    const close   = () => modal.remove();

    document.getElementById('transfer-paste-close').addEventListener('click', close);
    document.getElementById('transfer-paste-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    setTimeout(() => input.focus(), 50);

    const inStock = new Set(Inventory.getAllSerialRows().filter(r => r.status === 'in-stock').map(r => r.serial.toUpperCase()));
    let found = [];

    input.addEventListener('input', () => {
      const pasted  = [...new Set(input.value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
      found         = pasted.filter(s => inStock.has(s));
      const missing = pasted.filter(s => !inStock.has(s));

      countEl.textContent = `${pasted.length} serial${pasted.length !== 1 ? 's' : ''} · ${found.length} in stock`;
      missEl.style.display = missing.length ? 'block' : 'none';
      missEl.innerHTML = missing.length
        ? `${missing.length} not in stock — will be skipped: <span style="font-family:var(--mono)">${missing.map(esc).join(', ')}</span>`
        : '';
      contBtn.disabled    = found.length === 0;
      contBtn.textContent = found.length ? `Continue with ${found.length} unit${found.length !== 1 ? 's' : ''}` : 'Continue';
    });

    contBtn.addEventListener('click', () => {
      if (!found.length) return;
      close();
      _showTransferModal(found);
    });
  }

  function _showTransferModal(serials) {
    const existing = document.getElementById('transfer-modal');
    if (existing) existing.remove();

    const set  = new Set(serials.map(s => s.toUpperCase()));
    const rows = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock' && set.has(r.serial.toUpperCase()));
    if (!rows.length) { showAlert('Nothing to dispatch — those items are no longer in stock.', 'error'); return; }

    // One summary line per source location + product
    const groups = {};
    rows.forEach(r => {
      const k = (r.location || '—') + '||' + r.product;
      if (!groups[k]) groups[k] = { location: r.location || '—', product: r.product, units: 0 };
      groups[k].units++;
    });
    const lines   = Object.values(groups).sort((a, b) => a.location.localeCompare(b.location) || a.product.localeCompare(b.product));
    const sources = [...new Set(rows.map(r => r.location || '—'))];
    const byName  = (typeof Auth !== 'undefined' && Auth.getName ? Auth.getName() : '') || '';

    const modal = document.createElement('div');
    modal.id = 'transfer-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:540px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>⇄ Dispatch to Another Warehouse</span>
          <button class="btn-remove-row" id="transfer-modal-close">×</button>
        </div>
        <div style="margin-bottom:1rem;font-size:13px;color:var(--text-muted);">
          Sending <strong style="color:var(--text);">${rows.length} unit${rows.length !== 1 ? 's' : ''}</strong>
          out of ${sources.map(l => `<span class="loc-badge">${esc(l)}</span>`).join(' ')}.
          They leave stock now and land when you receive them in <strong style="color:var(--text);">In Transit</strong>.
          Condition, cost, PO link and received date travel with them.
        </div>
        <div class="table-wrap" style="max-height:170px;overflow-y:auto;margin-bottom:1.25rem;border:1px solid var(--border);border-radius:var(--r-md);">
          <table style="table-layout:auto;">
            <thead><tr><th>From</th><th>Product</th><th style="text-align:right;">Units</th></tr></thead>
            <tbody>${lines.map(l => `<tr>
              <td><span class="loc-badge">${esc(l.location)}</span></td>
              <td style="font-weight:500">${esc(l.product)}</td>
              <td style="text-align:right;font-weight:600">${l.units}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="form-grid g2" style="margin-bottom:1rem;">
          <div class="form-group">
            <label class="form-label">Send to warehouse *</label>
            <input class="fi" id="transfer-location" placeholder="e.g. Los Angeles" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Expected arrival</label>
            <input class="fi" type="date" id="transfer-expected" />
          </div>
        </div>
        <div class="form-grid g2" style="margin-bottom:1rem;">
          <div class="form-group">
            <label class="form-label">Dispatched by</label>
            <input class="fi" id="transfer-by" value="${esc(byName)}" placeholder="e.g. Peter Roberts" />
          </div>
          <div class="form-group">
            <label class="form-label">Reference / note</label>
            <input class="fi" id="transfer-ref" placeholder="e.g. Truck 4" />
          </div>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:1.25rem;cursor:pointer;">
          <input type="checkbox" id="transfer-receive-now" style="margin-top:2px;" />
          <span>Already arrived — receive at the destination straight away
            <span style="display:block;color:var(--text-hint);">For a move that happened before you got to record it. Both legs are still logged.</span>
          </span>
        </label>
        <div id="transfer-modal-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="transfer-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="transfer-modal-confirm">Dispatch ${rows.length} unit${rows.length !== 1 ? 's' : ''}</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    SmartSelect('transfer-location', Inventory.getLocations, DB.addCustomLocation);

    const close = () => modal.remove();
    document.getElementById('transfer-modal-close').addEventListener('click', close);
    document.getElementById('transfer-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Reflect the shortcut in the button, so it never lies about what happens
    const confirmBtn = document.getElementById('transfer-modal-confirm');
    const nowChk     = document.getElementById('transfer-receive-now');
    const unitLabel  = `${rows.length} unit${rows.length !== 1 ? 's' : ''}`;
    nowChk.addEventListener('change', () => {
      confirmBtn.textContent = nowChk.checked ? `Move ${unitLabel} now` : `Dispatch ${unitLabel}`;
      document.getElementById('transfer-expected').disabled = nowChk.checked;
    });

    confirmBtn.addEventListener('click', () => {
      const dest  = document.getElementById('transfer-location').value.trim();
      const by    = document.getElementById('transfer-by').value.trim();
      const ref   = document.getElementById('transfer-ref').value.trim();
      const exp   = document.getElementById('transfer-expected').value;
      const errEl = document.getElementById('transfer-modal-error');
      const fail  = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

      if (!dest) { fail('Destination warehouse is required.'); return; }

      try {
        const res = Inventory.dispatchTransfer({
          serials: rows.map(r => r.serial), toLocation: dest, by, ref,
          expectedBy: nowChk.checked ? '' : exp,
          receiveNow: nowChk.checked,
        });
        close();
        UI._._invSelected.clear();
        _refreshAfterTransfer();
        showAlert(
          res.received
            ? `${res.units} unit${res.units !== 1 ? 's' : ''} moved from ${res.from.join(', ')} to ${res.to}`
            : `${res.units} unit${res.units !== 1 ? 's' : ''} dispatched from ${res.from.join(', ')} to ${res.to} — receive them in In Transit on arrival`,
          'success'
        );
      } catch (e) { fail(e.message); }
    });
  }

  // Everything a transfer can change: stock lists, the In Transit panels and the
  // dashboard counters.
  function _refreshAfterTransfer() {
    UI.populateStockListFilters();
    populateDataLists();
    refreshSmartSelects();
    UI.renderStockBreakdown();
    UI.renderStockList();
    UI.renderTransferList();
    UI.renderTransitList();
    UI.renderDashboard();
  }

  // ── Rename a location ────────────────────────────────────────────────
  // A location is just a string on movements/shipments/transfers — DB.renameLocation
  // rewrites every occurrence so a typo or a warehouse renaming doesn't require
  // touching each historical record by hand.
  function _syncRenameLocationButton(canEdit, locF) {
    const btn = document.getElementById('btn-rename-location');
    if (!btn) return;
    btn.style.display = canEdit && Inventory.getLocations().length ? '' : 'none';
    btn.onclick = canEdit ? () => _showRenameLocationModal(locF) : null;
  }

  function _showRenameLocationModal(preselect) {
    const existing = document.getElementById('rename-location-modal');
    if (existing) existing.remove();

    const locations = Inventory.getLocations();
    if (!locations.length) return;

    const modal = document.createElement('div');
    modal.id = 'rename-location-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:420px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>✎ Rename location</span>
          <button class="btn-remove-row" id="rename-loc-close">×</button>
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Location *</label>
          <select class="fi" id="rename-loc-select">
            ${locations.map(l => `<option value="${esc(l)}"${l === preselect ? ' selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:1.25rem;">
          <label class="form-label">New name *</label>
          <input class="fi" id="rename-loc-input" placeholder="e.g. Los Angeles" autocomplete="off" list="rename-loc-existing" />
          <datalist id="rename-loc-existing">${locations.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
          <div class="hint">Applies to every movement, shipment and transfer at this location — past and present.</div>
        </div>
        <div id="rename-loc-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="rename-loc-cancel">Cancel</button>
          <button class="btn btn-primary" id="rename-loc-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const select = document.getElementById('rename-loc-select');
    const input  = document.getElementById('rename-loc-input');
    const errEl  = document.getElementById('rename-loc-error');
    const close  = () => modal.remove();

    document.getElementById('rename-loc-close').addEventListener('click', close);
    document.getElementById('rename-loc-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    setTimeout(() => input.focus(), 50);

    document.getElementById('rename-loc-save').addEventListener('click', () => {
      const oldLoc = select.value;
      const newLoc = input.value.trim();
      errEl.style.display = 'none';

      if (!newLoc) { errEl.textContent = 'New name is required.'; errEl.style.display = 'block'; return; }
      if (newLoc === oldLoc) { close(); return; }

      const merging = locations.some(l => l === newLoc);
      if (merging && !confirm(`"${newLoc}" already exists as a location. Merge "${oldLoc}" into it?\n\nEvery unit currently at "${oldLoc}" will show as being at "${newLoc}" instead.`)) return;

      DB.renameLocation(oldLoc, newLoc);
      close();
      _refreshAfterTransfer();
      showAlert(`Location renamed: ${oldLoc} → ${newLoc}`, 'success');
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('rename-loc-save').click(); }
      if (e.key === 'Escape') close();
    });
  }

  Object.assign(UI._, { _syncTransferBar, _showPasteSerialsModal, _refreshAfterTransfer, _syncRenameLocationButton });
})();
