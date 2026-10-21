/**
 * ui/transfers.js — Warehouse Transfers view (in-flight transfers)
 */
(() => {
  const { showAlert, esc, fmtDate } = UI._;

  // ── In-flight warehouse transfers (Warehouse Transfers view) ───────────
  // Nav badge, kept in sync from the dashboard too so the count is visible
  // before anyone opens the view.
  function _syncTransferBadge() {
    const badge = document.getElementById('transfer-count-badge');
    if (!badge) return;
    const n = Inventory.getInFlightTransfers().length;
    badge.textContent = n > 0 ? `(${n})` : '';
  }

  function renderTransferList() {
    const container = document.getElementById('transfer-list');
    if (!container) return;
    const canEdit = typeof Auth !== 'undefined' && Auth.canEdit();
    const active  = [...Inventory.getInFlightTransfers()].reverse();

    _syncTransferBadge();
    const pasteBtn = document.getElementById('btn-transfer-paste');
    if (pasteBtn) {
      pasteBtn.style.display = canEdit ? '' : 'none';
      pasteBtn.onclick = () => UI._._showPasteSerialsModal();
    }
    const countEl = document.getElementById('transfer-count');
    if (countEl) countEl.textContent = active.length ? `(${active.length})` : '';

    if (!active.length) {
      container.innerHTML = '<div class="empty">No warehouse transfers in flight — dispatch stock from Stock Holding</div>';
      return;
    }

    container.innerHTML = active.map(t => {
      const total    = (t.products || []).reduce((a, p) => a + p.serials.length, 0);
      const landed   = (t.receivedSerials || []).length;
      const inFlight = total - landed;
      const expected = t.expectedBy
        ? ` · Expected ${new Date(t.expectedBy + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`
        : '';
      const received = new Set((t.receivedSerials || []).map(x => x.toUpperCase()));
      const tags = (t.products || []).map(p => {
        const left = p.serials.filter(sn => !received.has(sn.toUpperCase())).length;
        return left ? `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${left} unit${left !== 1 ? 's' : ''}</span>` : '';
      }).join('');
      return `<div class="shipment-card">
        <div class="shipment-card-header">
          <div>
            <div class="shipment-card-title">
              <span class="loc-badge">${esc(t.from || '?')}</span> → <span class="loc-badge">${esc(t.to || '?')}</span>
              <span class="badge b-transfer" style="margin-left:6px;">⇄ In flight</span>
            </div>
            <div class="shipment-card-meta">
              ${inFlight} unit${inFlight !== 1 ? 's' : ''} in flight${landed ? ` · ${landed} of ${total} already received` : ''}
              · Dispatched ${fmtDate(t.dispatchedAt)}${t.by ? ' by ' + esc(t.by) : ''}${expected}${t.ref ? ' · ' + esc(t.ref) : ''}
            </div>
          </div>
          ${canEdit ? `<div class="shipment-actions">
            <button class="btn btn-success btn-xs" data-recv-all="${esc(t.id)}" title="Receive everything still in flight">✓ Receive all</button>
            <button class="btn btn-ghost btn-xs" data-recv-part="${esc(t.id)}" title="Receive only some of the load">Receive part…</button>
            <button class="btn btn-ghost btn-xs" data-cancel-transfer="${esc(t.id)}" title="Send the remaining units back to ${esc(t.from || 'the source')}">✕ Cancel</button>
          </div>` : ''}
        </div>
        <div class="shipment-products">${tags}</div>
      </div>`;
    }).join('');

    const by = () => (typeof Auth !== 'undefined' && Auth.getName ? Auth.getName() : '') || '';

    container.querySelectorAll('[data-recv-all]').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const res = Inventory.receiveTransfer(btn.dataset.recvAll, { by: by() });
          UI._._refreshAfterTransfer();
          showAlert(`${res.received} unit${res.received !== 1 ? 's' : ''} received into stock at ${res.to}`, 'success');
        } catch (e) { showAlert(e.message, 'error'); }
      });
    });

    container.querySelectorAll('[data-recv-part]').forEach(btn => {
      btn.addEventListener('click', () => _showReceiveTransferModal(btn.dataset.recvPart));
    });

    container.querySelectorAll('[data-cancel-transfer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = Inventory.getInFlightTransfers().find(x => String(x.id) === btn.dataset.cancelTransfer);
        if (!t) return;
        const left = (t.products || []).reduce((a, p) => a + p.serials.length, 0) - (t.receivedSerials || []).length;
        if (!confirm(`Cancel this transfer?\n\n${left} unit${left !== 1 ? 's' : ''} still in flight will go back into stock at ${t.from}.`)) return;
        try {
          const res = Inventory.cancelTransfer(t.id, { by: by() });
          UI._._refreshAfterTransfer();
          showAlert(`${res.returned} unit${res.returned !== 1 ? 's' : ''} returned to stock at ${res.to}`, 'success');
        } catch (e) { showAlert(e.message, 'error'); }
      });
    });
  }

  // Receive part of a load — tick the units that actually turned up.
  function _showReceiveTransferModal(transferId) {
    const t = Inventory.getInFlightTransfers().find(x => String(x.id) === String(transferId));
    if (!t) { showAlert('Transfer not found.', 'error'); return; }

    const existing = document.getElementById('recv-transfer-modal');
    if (existing) existing.remove();

    const received = new Set((t.receivedSerials || []).map(x => x.toUpperCase()));
    const groups = (t.products || []).map(p => ({
      product: p.product,
      serials: p.serials.filter(sn => !received.has(sn.toUpperCase())),
    })).filter(g => g.serials.length);
    const total  = groups.reduce((a, g) => a + g.serials.length, 0);
    const byName = (typeof Auth !== 'undefined' && Auth.getName ? Auth.getName() : '') || '';

    const modal = document.createElement('div');
    modal.id = 'recv-transfer-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:520px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>Receive from ${esc(t.from || '?')}</span>
          <button class="btn-remove-row" id="recv-transfer-close">×</button>
        </div>
        <div style="margin-bottom:1rem;font-size:13px;color:var(--text-muted);">
          Tick the units that arrived at <span class="loc-badge">${esc(t.to || '?')}</span>.
          Anything left unticked stays in flight.
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Received by</label>
          <input class="fi" id="recv-transfer-by" value="${esc(byName)}" placeholder="e.g. Peter Roberts" />
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="recv-transfer-all" checked /> Select all ${total} unit${total !== 1 ? 's' : ''}
        </label>
        <div style="max-height:230px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:1.25rem;">
          ${groups.map(g => `<div style="margin-bottom:10px;">
            <div style="font-weight:600;font-size:12px;margin-bottom:4px;">${esc(g.product)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${g.serials.map(sn => `<label class="dep-serial-chk" style="font-size:12px;color:var(--text-muted);font-family:var(--mono);">
                <input type="checkbox" class="recv-transfer-chk" data-serial="${esc(sn)}" checked />${esc(sn)}
              </label>`).join('')}
            </div>
          </div>`).join('')}
        </div>
        <div id="recv-transfer-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="recv-transfer-cancel">Cancel</button>
          <button class="btn btn-primary" id="recv-transfer-confirm">Receive selected</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById('recv-transfer-close').addEventListener('click', close);
    document.getElementById('recv-transfer-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    const chks     = () => Array.from(modal.querySelectorAll('.recv-transfer-chk'));
    const checked  = () => chks().filter(c => c.checked).map(c => c.dataset.serial);
    const confirmB = document.getElementById('recv-transfer-confirm');
    const syncBtn  = () => { const n = checked().length; confirmB.textContent = `Receive ${n} unit${n !== 1 ? 's' : ''}`; confirmB.disabled = n === 0; };
    document.getElementById('recv-transfer-all').addEventListener('change', e => {
      chks().forEach(c => { c.checked = e.target.checked; });
      syncBtn();
    });
    chks().forEach(c => c.addEventListener('change', syncBtn));
    syncBtn();

    confirmB.addEventListener('click', () => {
      const errEl = document.getElementById('recv-transfer-error');
      try {
        const res = Inventory.receiveTransfer(t.id, {
          serials: checked(),
          by: document.getElementById('recv-transfer-by').value.trim(),
        });
        close();
        UI._._refreshAfterTransfer();
        showAlert(
          `${res.received} unit${res.received !== 1 ? 's' : ''} received at ${res.to}` +
          (res.remaining ? ` · ${res.remaining} still in flight` : ''),
          'success'
        );
      } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    });
  }

  Object.assign(UI, { renderTransferList });
  Object.assign(UI._, { _syncTransferBadge });
})();
