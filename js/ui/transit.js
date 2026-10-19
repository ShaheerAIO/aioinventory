/**
 * ui/transit.js — In Transit view
 */
(() => {
  const { showAlert, esc, fmtDate } = UI._;

  // ── In Transit ────────────────────────────────────────────────────────
  function renderTransitList() {
    const { shipments } = DB.getData();
    const active = shipments.filter(s => s.status === 'in-transit').reverse();
    const badge = document.getElementById('transit-count-badge');
    if (badge) badge.textContent = active.length > 0 ? `(${active.length})` : '';

    const container = document.getElementById('transit-list');
    if (!container) return;
    if (!active.length) { container.innerHTML = '<div class="empty">No active shipments</div>'; return; }

    container.innerHTML = active.map(s => {
      const totalUnits = s.products.reduce((a, p) => a + p.serials.length, 0);
      const expectedStr = s.expectedBy ? `Expected ${new Date(s.expectedBy).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : '';
      const fmt$ = n => '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const freightStr  = s.freightCost > 0
        ? `🚚 ${esc(s.freightSupplier || 'Freight')}${s.freightPO ? ` · ${esc(s.freightPO)}` : ''} · ${fmt$(s.freightCost)} freight`
        : '';
      const docs = s.documents || [];
      const docsHtml = docs.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;">
        ${docs.map(d => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--aio-purple);background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:3px 8px;text-decoration:none;" title="${esc(d.name)}">📎 ${esc(d.name.length>28?d.name.slice(0,25)+'…':d.name)}</a>`).join('')}
      </div>` : '';
      return `<div class="shipment-card">
        <div class="shipment-card-header">
          <div>
            <div class="shipment-card-title">${esc(s.supplier || 'Shipment')} → <span class="loc-badge">${esc(s.location || '?')}</span>${s.poNumber ? ` <span class="po-lock-badge">🔒 ${esc(s.poNumber)}</span>` : ''}</div>
            <div class="shipment-card-meta">${totalUnits} unit${totalUnits!==1?'s':''} · ${s.products.length} product${s.products.length!==1?'s':''} · Registered ${fmtDate(s.createdAt)}${expectedStr ? ' · ' + expectedStr : ''}</div>
            ${freightStr ? `<div class="shipment-card-meta" style="margin-top:3px;color:var(--text-muted);">${freightStr}</div>` : ''}
          </div>
          <div class="shipment-actions">
            <button class="btn btn-success btn-xs" data-receive="${s.id}">Receive</button>
            <button class="btn btn-orange btn-xs" data-close-ship="${s.id}" title="Mark as delivered without adding stock — for units already entered into the system">✓ Already in Stock</button>
            <label class="btn btn-ghost btn-xs" style="cursor:pointer;" title="Attach document"><input type="file" data-upload-shipment="${s.id}" style="display:none;" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />📎 Doc</label>
            <button class="btn btn-ghost btn-xs" data-cancel="${s.id}">Cancel</button>
          </div>
        </div>
        <div class="shipment-products">
          ${s.products.map(p => `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${p.serials.length} unit${p.serials.length!==1?'s':''}</span>`).join('')}
        </div>
        ${docsHtml}
      </div>`;
    }).join('');

    container.querySelectorAll('[data-receive]').forEach(btn => {
      btn.addEventListener('click', () => UI._.showReceiveModal(parseInt(btn.dataset.receive)));
    });

    container.querySelectorAll('[data-close-ship]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = DB.getData().shipments.find(x => x.id === parseInt(btn.dataset.closeShip));
        if (s) UI._.closeWithoutStock([s], `${s.supplier || 'this shipment'}${s.poNumber ? ' · ' + s.poNumber : ''}`);
      });
    });
    container.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Cancel this shipment? The serials will be removed.')) {
          DB.removeShipment(parseInt(btn.dataset.cancel));
          renderTransitList();
          UI.renderDashboard();
        }
      });
    });

    // Document upload wiring
    container.querySelectorAll('[data-upload-shipment]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const shipId = parseInt(input.dataset.uploadShipment);
        try {
          showAlert('Uploading document…', 'info');
          const meta = await DB.uploadDocument('shipment', shipId, file);
          DB.addDocumentToShipment(shipId, meta);
          renderTransitList();
          showAlert(`Document "${file.name}" attached.`, 'success');
        } catch(e) { showAlert('Upload failed: ' + e.message, 'error'); }
        input.value = '';
      });
    });
  }

  Object.assign(UI, { renderTransitList });
})();
