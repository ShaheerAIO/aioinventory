/**
 * ui/lookup.js — Serial Lookup view + super admin unit editor
 */
(() => {
  const { showAlert, esc, fmtDateFull, _conditionLabel } = UI._;

  // ── Serial Lookup ─────────────────────────────────────────────────────
  function renderLookup(raw) {
    const res = document.getElementById('lookup-result');
    if (!raw || !raw.trim()) { res.innerHTML = '<div class="empty">Enter a serial number above</div>'; return; }
    let info = Inventory.getSerialInfo(raw);
    if (info.history.length === 0 && info.status === 'unknown') {
      // Not an exact serial — treat it as a fragment (e.g. the last 4 digits).
      const matches = Inventory.searchSerials(raw);
      if (!matches.length) {
        res.innerHTML = `<div class="lookup-not-found">No serial matching <code>${esc(info.serial)}</code> found in any record.</div>`;
        return;
      }
      if (matches.length > 1) { _renderLookupMatches(res, info.serial, matches); return; }
      raw  = matches[0];
      info = Inventory.getSerialInfo(raw);
    }
    const cost = DB.getSerialCost(raw);
    const costStr = cost != null ? `$${cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';
    const statusBadge = _lookupStatusBadge(info.status);
    const pendingBadge = info.pendingDeployment ? '<span class="badge-pending-deploy">📋 Pending Deploy</span>' : '';
    const condBadge = info.condition ? `<span class="badge b-condition b-cond-${info.condition}">${_conditionLabel(info.condition)}</span>` : '';
    const usedBadge = info.used ? '<span class="badge b-used">USED</span>' : '';
    const pd = info.pendingDeployment;
    res.innerHTML = `
      <div class="lookup-status-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <span style="font-family:var(--mono);font-size:15px;font-weight:600">${esc(info.serial)}</span>${statusBadge}${pendingBadge}${condBadge}${usedBadge}
          ${cost != null ? `<span style="font-size:12px;color:var(--text-muted)">Cost: <strong>${costStr}</strong></span>` : ''}
          ${Auth.isSuperAdmin() && Inventory.getEditableProperties(info.serial) ? `<button class="btn btn-ghost btn-xs" id="btn-super-edit" style="margin-left:auto;color:var(--danger-text);border-color:var(--danger-border);" title="Super admin: change any property of this unit (logged)">✎ Edit all properties</button>` : ''}
        </div>
        <div class="lookup-meta">
          <div><div class="lookup-meta-label">Product</div>${esc(info.currentProduct||'—')}</div>
          <div><div class="lookup-meta-label">Location</div><span class="loc-badge">${esc(info.currentLocation||'—')}</span></div>
          <div><div class="lookup-meta-label">Category</div>${esc(info.currentCategory||'—')}</div>
          ${info.poNumber ? `<div><div class="lookup-meta-label">PO Number</div>${esc(info.poNumber)}</div>` : ''}
        </div>
        ${pd ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">📋 Staged for: <strong>${esc(pd.customer||'—')}</strong>${pd.by?` · by ${esc(pd.by)}`:''}${pd.ref?` · ref ${esc(pd.ref)}`:''}${pd.stagedAt?` · ${fmtDateFull(pd.stagedAt)}`:''}</div>` : ''}
        ${info.testedBy ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">Tested by <strong>${esc(info.testedBy)}</strong>${info.testedAt?` on ${fmtDateFull(info.testedAt)}`:''}${info.testNotes?` — ${esc(info.testNotes)}`:''}</div>` : ''}
        ${info.status==='dispatched' ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">${info.rmaTlType?`<span class="badge b-condition b-cond-${info.rmaTlType}">${_conditionLabel(info.rmaTlType)}</span> `:''}Dispatched to: <strong>${esc(info.deployedTo||'—')}</strong>${info.deployedBy?` · by ${esc(info.deployedBy)}`:''}${info.deployedRef?` · ref ${esc(info.deployedRef)}`:''}${info.deployedDate?` · ${fmtDateFull(info.deployedDate)}`:''}</div>` : ''}
      </div>
      ${info.history.length ? `<div class="panel" style="margin-bottom:0">
        <div class="panel-title">Movement history</div>
        <table><thead><tr><th style="width:18%">Date</th><th style="width:10%">Type</th><th style="width:22%">Product</th><th style="width:18%">Location</th><th style="width:18%">Party</th><th style="width:14%">Ref</th></tr></thead>
        <tbody>${info.history.map(m=>`<tr><td style="color:var(--text-hint)">${fmtDateFull(m.date)}</td><td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span>${m.isTransfer?'<span class="badge b-transfer" style="margin-left:4px;">⇄ TRF</span>':''}</td><td>${esc(m.product)}</td><td><span class="loc-badge">${esc(m.location||'—')}</span></td><td>${esc(m.isTransfer ? (m.type==='IN' ? 'from ' + (m.transferFrom||'?') : 'to ' + (m.transferTo||'?')) : (m.type==='IN'?(m.supplier||'—'):(m.customer||'—')))}</td><td style="color:var(--text-hint)">${esc(m.ref||'—')}</td></tr>`).join('')}</tbody></table>
      </div>` : ''}`;
    const superBtn = document.getElementById('btn-super-edit');
    if (superBtn) superBtn.addEventListener('click', () => _showSuperEditModal(info.serial));
  }

  // ── Super admin: edit every property of one unit ──────────────────────
  // Everything saved here is written to the activity log with before → after
  // values and the reason (see editSerialProperties in activity.js).
  function _showSuperEditModal(serial) {
    const cur = Inventory.getEditableProperties(serial);
    if (!cur) return;
    document.getElementById('super-edit-modal')?.remove();
    const deployed = cur.status === 'dispatched';
    const p2 = n => String(n).padStart(2, '0');
    const toDay = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
    const fromDay = d => d ? d + 'T12:00:00.000Z' : '';  // noon UTC: the same calendar day across US time zones

    // field → [label, input html, read value]
    const products = Inventory.PRODUCTS.map(p => p.name);
    if (cur.product && !products.includes(cur.product)) products.unshift(cur.product);
    const conds = [['', 'Working (no flag)'], ['needs-testing', 'Needs testing'], ['faulty', 'Faulty'], ['rma', 'RMA'], ['fail-tl', 'Total loss']];
    const txt  = (id, v, extra = '') => `<input class="fi" id="se-${id}" value="${esc(v ?? '')}" ${extra} />`;
    const day  = (id, v) => `<input class="fi" type="date" id="se-${id}" value="${toDay(v)}" />`;
    // Dropdown of known values; the unit's current value is always offered even if
    // nothing else uses it. `none` adds a blank choice for optional fields.
    const sel  = (id, v, items, none) => {
      const opts = [...new Set([...(v ? [v] : []), ...items])].sort((a, b) => a.localeCompare(b));
      return `<select class="fi" id="se-${id}">${none ? `<option value=""${v ? '' : ' selected'}>${none}</option>` : ''}${opts.map(o => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    };
    const val  = id => document.getElementById('se-' + id).value.trim();
    const F = {
      serial:       ['Serial number', txt('serial', cur.serial, 'style="font-family:var(--mono)"'), () => val('serial').toUpperCase()],
      product:      ['Product', `<select class="fi" id="se-product">${products.map(p => `<option${p === cur.product ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>`, () => val('product')],
      location:     [deployed ? 'Location (dispatched from)' : 'Location', sel('location', cur.location, Inventory.getLocations()), () => val('location')],
      receivedDate: ['Received date', day('receivedDate', cur.receivedDate), () => fromDay(val('receivedDate'))],
      supplier:     ['Supplier', sel('supplier', cur.supplier, Inventory.getSuppliers(), '— None —'), () => val('supplier')],
      poNumber:     ['PO number', sel('poNumber', cur.poNumber, DB.getPONumbers(), '— None —'), () => val('poNumber')],
      cost:         ['Unit cost ($)', txt('cost', cur.cost, 'type="number" min="0" step="0.01"'), () => val('cost') === '' ? null : parseFloat(val('cost'))],
      used:         ['Used', `<label style="display:flex;gap:6px;align-items:center;padding:6px 0;"><input type="checkbox" id="se-used"${cur.used ? ' checked' : ''} /> Marked as used</label>`, () => document.getElementById('se-used').checked],
      ...(deployed ? {
        customer:     ['Customer', sel('customer', cur.customer, Inventory.getCustomers()), () => val('customer')],
        deployedDate: ['Dispatched date', day('deployedDate', cur.deployedDate), () => fromDay(val('deployedDate'))],
        ref:          ['Dispatch ref', txt('ref', cur.ref), () => val('ref')],
        by:           ['Dispatched by', txt('by', cur.by), () => val('by')],
      } : {
        condition:    ['Condition', `<select class="fi" id="se-condition">${conds.map(([v, l]) => `<option value="${v}"${v === cur.condition ? ' selected' : ''}>${l}</option>`).join('')}</select>`, () => val('condition')],
        testedBy:     ['Tested by', txt('testedBy', cur.testedBy), () => val('testedBy')],
        testedAt:     ['Tested date', day('testedAt', cur.testedAt), () => fromDay(val('testedAt'))],
        testNotes:    ['Test notes', txt('testNotes', cur.testNotes), () => val('testNotes')],
      }),
    };

    const modal = document.createElement('div');
    modal.id = 'super-edit-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:640px;max-width:calc(100vw - 32px);max-height:90vh;overflow:auto;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
          <span>Edit unit — <span style="font-family:var(--mono)">${esc(cur.serial)}</span></span>
          <button class="btn-remove-row" id="se-close">×</button>
        </div>
        <div style="font-size:12px;color:var(--danger-text);margin-bottom:1rem;">Super admin edit. Every change is recorded in the activity log with its old and new value, your account and your reason.</div>
        <div class="form-grid g2">
          ${Object.entries(F).map(([k, [label, html]]) => `<div class="form-group"><label class="form-label">${label}</label>${html}</div>`).join('')}
        </div>
        <div class="form-group" style="margin:6px 0 1rem;">
          <label class="form-label">Reason for the change *</label>
          <textarea class="fi" id="se-reason" rows="2" placeholder="e.g. Received under the wrong product on PO 1234"></textarea>
        </div>
        <div id="se-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="se-cancel">Cancel</button>
          <button class="btn btn-primary" id="se-save">Save changes</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Compare against what the form showed, not the raw values, so an untouched
    // date (shown as a day, stored with a time) doesn't count as a change
    const initial = {};
    Object.entries(F).forEach(([k, [, , read]]) => { initial[k] = read(); });

    const close = () => modal.remove();
    document.getElementById('se-close').addEventListener('click', close);
    document.getElementById('se-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    document.getElementById('se-save').addEventListener('click', async () => {
      const errEl = document.getElementById('se-error');
      errEl.style.display = 'none';
      const changes = {};
      Object.entries(F).forEach(([k, [, , read]]) => { const v = read(); if (v !== initial[k]) changes[k] = v; });
      const reason = document.getElementById('se-reason').value.trim();
      const lines = Object.keys(changes).map(k => `• ${F[k][0]}: ${initial[k] === '' || initial[k] == null ? '—' : initial[k]} → ${changes[k] === '' || changes[k] == null ? '—' : changes[k]}`);
      if (lines.length && reason && !confirm(`Apply these changes to ${cur.serial}?\n\n${lines.join('\n')}\n\nReason: ${reason}`)) return;
      try {
        await Inventory.superEditSerial(cur.serial, changes, reason);
      } catch (e) {
        errEl.textContent = e.message || String(e);
        errEl.style.display = 'block';
        return;
      }
      close();
      const now = changes.serial || cur.serial;
      document.getElementById('lookup-input').value = now;
      renderLookup(now);
      showAlert(`${now} updated — ${lines.length} change${lines.length === 1 ? '' : 's'} logged`, 'success');
    });
  }

  function _lookupStatusBadge(status) {
    return status==='in-stock' ? '<span class="badge b-ok">In stock</span>' : status==='in-transit' ? '<span class="badge b-transit">In transit</span>' : '<span class="badge b-out">Dispatched</span>';
  }

  // Several serials contain the typed fragment — list them; clicking one opens it.
  function _renderLookupMatches(res, q, matches) {
    const LIMIT = 100;
    const rows = matches.slice(0, LIMIT).map(sn => {
      const i = Inventory.getSerialInfo(sn);
      return `<tr class="lookup-match" data-serial="${esc(sn)}" style="cursor:pointer"><td style="font-family:var(--mono)">${esc(sn)}</td><td>${esc(i.currentProduct||'—')}</td><td>${_lookupStatusBadge(i.status)}</td><td>${esc(i.status==='dispatched' ? (i.deployedTo||'—') : (i.currentLocation||'—'))}</td></tr>`;
    }).join('');
    res.innerHTML = `<div class="panel" style="margin-bottom:0">
        <div class="panel-title">${matches.length} serials match <code>${esc(q)}</code>${matches.length > LIMIT ? ` — showing first ${LIMIT}, type more digits to narrow` : ''}</div>
        <table><thead><tr><th style="width:28%">Serial</th><th style="width:30%">Product</th><th style="width:14%">Status</th><th style="width:28%">Location / Customer</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
    res.querySelectorAll('.lookup-match').forEach(tr => tr.addEventListener('click', () => {
      document.getElementById('lookup-input').value = tr.dataset.serial;
      renderLookup(tr.dataset.serial);
    }));
  }

  Object.assign(UI, { renderLookup });
})();
