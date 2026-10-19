/**
 * ui/shipment-history.js — Shipment History view
 */
(() => {
  const { showAlert, esc, fmtDate } = UI._;

  // ── Shipment History ─────────────────────────────────────────────────
  function renderShipmentHistory() {
    const { shipments } = DB.getData();
    const received = shipments.filter(s => s.status === 'received').slice().reverse();
    const container = document.getElementById('shipment-history-list');
    if (!container) return;

    if (!received.length) {
      container.innerHTML = '<div class="empty">No received shipments yet</div>';
      return;
    }

    const fmt$ = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    container.innerHTML = received.map(s => {
      const totalUnits = s.products.reduce((a, p) => a + p.serials.length, 0);
      const freightStr = s.freightCost > 0
        ? `🚚 ${esc(s.freightSupplier || 'Freight')}${s.freightPO ? ' · ' + esc(s.freightPO) : ''} · ${fmt$(s.freightCost)} freight`
        : '';
      const receivedDate = s.receivedAt
        ? new Date(s.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const docs = s.documents || [];
      const docsHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${docs.length ? '6px' : '0'};">
          <label class="btn btn-ghost btn-xs" style="cursor:pointer;font-size:11px;" title="Attach document">
            <input type="file" data-upload-history="${s.id}" style="display:none;" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
            📎 Attach document
          </label>
          ${docs.length ? `<span style="font-size:11px;color:var(--text-muted);">${docs.length} document${docs.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${docs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${docs.map(d => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--aio-purple);background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:3px 8px;text-decoration:none;" title="${esc(d.name)}">📎 ${esc(d.name.length > 30 ? d.name.slice(0, 27) + '…' : d.name)}</a>`).join('')}
        </div>` : ''}
      </div>`;

      const productRows = s.products.map(p => {
        const landedCost = p.landedPerUnit || p.unitCost || null;
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 8px;font-weight:500;">${esc(p.product)}</td>
          <td style="padding:6px 8px;text-align:right;">${p.serials.length}</td>
          <td style="padding:6px 8px;text-align:right;">${landedCost != null ? fmt$(landedCost) : '—'}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600;">${landedCost != null ? fmt$(landedCost * p.serials.length) : '—'}</td>
        </tr>`;
      }).join('');

      return `<div class="shipment-card" id="hist-ship-${s.id}">
        <div class="shipment-card-header" style="cursor:pointer;" data-toggle-hist="${s.id}">
          <div style="flex:1;">
            <div class="shipment-card-title">
              ${esc(s.supplier || 'Shipment')} → <span class="loc-badge">${esc(s.actualLocation || s.location || '?')}</span>
              ${s.poNumber ? `<span class="po-lock-badge">🔒 ${esc(s.poNumber)}</span>` : ''}
              ${s.receivedWithoutStock
                ? `<span class="badge b-partial" style="margin-left:6px;font-size:10px;" title="Marked delivered without adding stock — the units were already in the system">✓ Delivered · no stock added</span>`
                : `<span class="badge b-in" style="margin-left:6px;font-size:10px;">✓ Received</span>`}
            </div>
            <div class="shipment-card-meta">
              ${totalUnits} unit${totalUnits !== 1 ? 's' : ''} · ${s.products.length} product${s.products.length !== 1 ? 's' : ''}
              · Received ${receivedDate}${s.receivedBy ? ' by ' + esc(s.receivedBy) : ''}
              ${s.createdAt ? ' · Registered ' + fmtDate(s.createdAt) : ''}
              <span style="font-size:11px;color:var(--text-hint);"> ▼ click to expand</span>
            </div>
            ${freightStr ? `<div class="shipment-card-meta" style="margin-top:3px;color:var(--text-muted);">${freightStr}</div>` : ''}
          </div>
          <div class="shipment-actions" style="align-self:flex-start;">
            <button class="btn btn-danger btn-xs" data-delete-hist="${s.id}" style="opacity:.7;">🗑 Delete</button>
          </div>
        </div>
        <div id="hist-detail-${s.id}" style="display:none;border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Product</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Units</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed/unit</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed total</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>
          <div class="shipment-products">
            ${s.products.map(p => `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${p.serials.length} unit${p.serials.length !== 1 ? 's' : ''}</span>`).join('')}
          </div>
          ${docsHtml}
        </div>
      </div>`;
    }).join('');

    // Toggle expand
    container.querySelectorAll('[data-toggle-hist]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('label') || e.target.closest('input')) return;
        const detail = document.getElementById(`hist-detail-${header.dataset.toggleHist}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        const arrow = header.querySelector('span[style*="text-hint"]');
        if (arrow) arrow.textContent = isOpen ? ' ▼ click to expand' : ' ▲ click to collapse';
      });
    });

    // Delete
    container.querySelectorAll('[data-delete-hist]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Delete this shipment record from history? This does NOT remove the stock — units already received remain in Stock Holding.')) return;
        DB.removeShipment(parseInt(btn.dataset.deleteHist));
        renderShipmentHistory();
      });
    });

    // Document upload
    container.querySelectorAll('[data-upload-history]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const shipId = parseInt(input.dataset.uploadHistory);
        try {
          showAlert('Uploading document…', 'info');
          const meta = await DB.uploadDocument('shipment', shipId, file);
          DB.addDocumentToShipment(shipId, meta);
          renderShipmentHistory();
          showAlert(`Document "${file.name}" attached.`, 'success');
        } catch(e) { showAlert('Upload failed: ' + e.message, 'error'); }
        input.value = '';
      });
    });
  }

  Object.assign(UI, { renderShipmentHistory });
})();
