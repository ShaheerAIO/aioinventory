/**
 * ui/receive-modals.js — Receive / partial-receive shipment modals (In Transit + Orders)
 */
(() => {
  const { showAlert, esc } = UI._;

  function showReceiveModal(shipmentId) {
    const { shipments } = DB.getData();
    const s = shipments.find(x => x.id === shipmentId);
    if (!s) return;

    const totalUnits = s.products.reduce((a,p) => a + p.serials.length, 0);
    // Determine which products need real serial numbers (have NS- placeholders)
    const needsSerials = s.products.map(p => p.serials.some(x => x.startsWith('NS-')));
    const anyNeedsSerials = needsSerials.some(Boolean);

    // Scanned serials per product index
    const scanned = {};
    s.products.forEach((p, i) => { scanned[i] = new Set(); });

    function serialSection() {
      if (!anyNeedsSerials) return '';
      return s.products.map((p, i) => {
        if (!needsSerials[i]) return '';
        const qty = p.serials.length;
        return `<div style="margin-bottom:12px;padding:12px;background:var(--bg-hover,rgba(0,0,0,.03));border-radius:8px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">${esc(p.product)}</strong>
            <span style="font-size:11px;color:var(--text-muted);">${qty} unit${qty!==1?'s':''} · <span id="rcv-count-${i}" style="color:var(--aio-purple);font-weight:600;">0</span> scanned</span>
          </div>
          <input class="fi fi-mono" id="rcv-serial-${i}" placeholder="Scan or type serial then Enter · paste to bulk import" style="margin-bottom:6px;" />
          <div id="rcv-tags-${i}" style="display:flex;flex-wrap:wrap;gap:4px;min-height:18px;"></div>
          <div class="hint" style="margin-top:4px;">Leave blank to use placeholder IDs for non-serialised items</div>
        </div>`;
      }).join('');
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:520px;">
        <div class="modal-title">Receive shipment</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem;">${totalUnits} unit${totalUnits!==1?'s':''} from ${esc(s.supplier||'supplier')} · PO ${esc(s.poNumber||'')}</div>
        ${anyNeedsSerials ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;">Serial Numbers</div>${serialSection()}` : ''}
        <div class="form-grid g2" style="margin-top:${anyNeedsSerials?'12px':'0'};">
          <div class="form-group">
            <label class="form-label">Confirm location *</label>
            <input class="fi" id="modal-loc" value="${esc(s.location||'')}" placeholder="e.g. SF Warehouse" list="modal-loc-list" />
            <datalist id="modal-loc-list">${Inventory.getLocations().map(l=>`<option value="${esc(l)}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Received by</label>
            <input class="fi" id="modal-by" placeholder="e.g. Peter Roberts" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
          <button class="btn btn-success" id="modal-confirm-btn">Receive into stock</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Wire serial scanners
    s.products.forEach((p, i) => {
      if (!needsSerials[i]) return;
      const inp     = document.getElementById(`rcv-serial-${i}`);
      const tagsDiv = document.getElementById(`rcv-tags-${i}`);
      const countEl = document.getElementById(`rcv-count-${i}`);
      if (!inp) return;
      function sync() {
        countEl.textContent = scanned[i].size;
        tagsDiv.innerHTML = Array.from(scanned[i]).map(sv =>
          `<span style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-family:monospace;cursor:pointer;" data-rm="${sv}">${esc(sv)}</span>`
        ).join('');
        tagsDiv.querySelectorAll('[data-rm]').forEach(t =>
          t.addEventListener('click', () => { scanned[i].delete(t.dataset.rm); sync(); })
        );
      }
      function add(raw) { const v = raw.trim().toUpperCase(); if (v) scanned[i].add(v); }
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        inp.value.split(/[,\n]+/).map(v => v.trim()).filter(Boolean).forEach(add);
        inp.value = ''; sync();
      });
      inp.addEventListener('paste', () => {
        setTimeout(() => {
          inp.value.split(/[\n,\t]+/).map(v => v.trim()).filter(Boolean).forEach(add);
          inp.value = ''; sync();
        }, 10);
      });
    });

    document.getElementById('modal-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
      const loc = document.getElementById('modal-loc').value.trim();
      const by  = document.getElementById('modal-by').value.trim();
      if (!loc) { showAlert('Location is required.', 'error'); return; }
      try {
        if (anyNeedsSerials) {
          // Build parts: use scanned serials where provided, else keep NS- placeholders (qty-based)
          const parts = s.products.map((p, i) => {
            const realSerials = Array.from(scanned[i]);
            if (realSerials.length > 0) {
              return { product: p.product, category: p.category, serials: realSerials, qty: realSerials.length };
            } else {
              // No serials scanned — use all NS- placeholders as-is
              return { product: p.product, category: p.category, serials: [], qty: p.serials.length };
            }
          });
          Inventory.receivePartialShipment(shipmentId, parts, by, loc);
        } else {
          Inventory.receiveShipment(shipmentId, by, loc);
        }
        overlay.remove();
        UI.renderTransitList();
        UI.renderOrderList();
        UI.renderDashboard();
        showAlert(`Shipment received into stock at ${loc}`, 'success');
      } catch (err) { showAlert(err.message, 'error'); }
    });
  }


  // ── Partial Receive Modal ────────────────────────────────────────────
  function showPartialReceiveModal(orderId) {
    const data = DB.getData();
    const order = DB.getOrders().find(o => o.id === orderId);
    if (!order) return;

    // Find linked in-transit shipment — try orderId first, then PO number fallback
    const activeShipments = data.shipments.filter(s =>
      s.status === 'in-transit' &&
      (s.orderId === orderId || (s.poNumber === order.poNumber && s.supplier === order.supplier))
    );
    if (!activeShipments.length) {
      showAlert('No in-transit shipment found for this order. Use "Arrange Shipment" or "Split Shipment" to register a dispatch first.', 'error');
      return;
    }

    const shipment = activeShipments[0];
    const scannedSerials = {};
    shipment.products.forEach((p, i) => { scannedSerials[i] = new Set(); });
    const skipped = {};  // products marked "not arrived"

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    function productRows() {
      return shipment.products.map((p, i) => {
        const qty = p.serials.length;
        const isNS = p.serials.every(s => s.startsWith('NS-'));
        return `<div id="pr-row-${i}" style="margin-bottom:12px;padding:12px;background:var(--bg-hover,rgba(0,0,0,.03));border-radius:8px;border:1px solid var(--border);transition:opacity .2s;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div>
              <strong style="font-size:13px;">${esc(p.product)}</strong>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${qty} unit${qty!==1?'s':''} in shipment</span>
            </div>
            <button class="btn btn-ghost btn-xs" id="pr-skip-${i}" style="font-size:11px;color:var(--text-muted);">✕ Not in this delivery</button>
          </div>
          <div class="form-grid g2">
            <div class="form-group">
              <label class="form-label">Qty receiving now</label>
              <input class="fi" type="number" min="1" max="${qty}" value="${qty}" id="pr-qty-${i}" ${isNS ? '' : 'readonly title="Auto-set by serial scan"'} />
            </div>
            <div class="form-group" style="display:flex;flex-direction:column;justify-content:flex-end;">
              ${isNS
                ? `<span style="font-size:11px;color:var(--text-hint);padding-bottom:4px;">No serial scan needed</span>`
                : `<span style="font-size:12px;color:var(--text-muted);">Serials scanned: <strong id="pr-count-${i}" style="color:var(--aio-purple);">0</strong></span>`
              }
            </div>
          </div>
          ${!isNS ? `<input class="fi fi-mono" id="pr-serial-${i}" placeholder="Type or scan serial then Enter · paste to bulk import" style="margin-top:6px;" />
          <div id="pr-tags-${i}" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;min-height:18px;"></div>` : ''}
        </div>`;
      }).join('');
    }

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:540px;">
        <div class="modal-title">✂ Receive Part Shipment</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">
          ${esc(shipment.supplier || order.supplier)} · PO ${esc(shipment.poNumber || order.poNumber)}
          ${activeShipments.length > 1 ? `<span style="margin-left:8px;background:#FEF7EA;color:#8A5200;padding:2px 7px;border-radius:8px;font-size:11px;font-weight:600;">Shipment 1 of ${activeShipments.length}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-hint);margin-bottom:12px;">Items not in this delivery — click "✕ Not in this delivery" to leave them in transit.</div>
        <div id="pr-products">${productRows()}</div>
        <div class="form-grid g2" style="margin-top:12px;">
          <div class="form-group">
            <label class="form-label">Receiving location *</label>
            <input class="fi" id="pr-loc" value="${esc(shipment.location || '')}" placeholder="e.g. SF Warehouse" list="pr-loc-list" />
            <datalist id="pr-loc-list">${Inventory.getLocations().map(l=>`<option value="${esc(l)}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Received by</label>
            <input class="fi" id="pr-by" placeholder="e.g. Peter Roberts" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pr-cancel">Cancel</button>
          <button class="btn btn-success" id="pr-confirm">Receive into stock</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Wire "not in this delivery" skip buttons
    shipment.products.forEach((p, i) => {
      const btn = document.getElementById(`pr-skip-${i}`);
      const row = document.getElementById(`pr-row-${i}`);
      btn.addEventListener('click', () => {
        skipped[i] = !skipped[i];
        row.style.opacity   = skipped[i] ? '0.35' : '1';
        row.style.pointerEvents = skipped[i] ? 'none' : '';
        btn.style.pointerEvents = 'auto';
        btn.textContent = skipped[i] ? '✓ Include' : '✕ Not in this delivery';
        btn.style.color = skipped[i] ? 'var(--aio-purple)' : 'var(--text-muted)';
      });
    });

    // Wire serial scanners
    shipment.products.forEach((p, i) => {
      if (p.serials.every(s => s.startsWith('NS-'))) return;
      const inp      = document.getElementById(`pr-serial-${i}`);
      const tagsDiv  = document.getElementById(`pr-tags-${i}`);
      const countBdg = document.getElementById(`pr-count-${i}`);
      const qtyInp   = document.getElementById(`pr-qty-${i}`);
      if (!inp) return;
      function sync() {
        countBdg.textContent = scannedSerials[i].size;
        qtyInp.value = scannedSerials[i].size;
        tagsDiv.innerHTML = Array.from(scannedSerials[i]).map(s =>
          `<span style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-family:monospace;cursor:pointer;" data-rm="${s}">${esc(s)}</span>`
        ).join('');
        tagsDiv.querySelectorAll('[data-rm]').forEach(t => {
          t.addEventListener('click', () => { scannedSerials[i].delete(t.dataset.rm); sync(); });
        });
      }
      function addSerial(raw) { const s = raw.trim().toUpperCase(); if (s) scannedSerials[i].add(s); }
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        inp.value.split(/[,\n]+/).map(v => v.trim()).filter(Boolean).forEach(addSerial);
        inp.value = ''; sync();
      });
      inp.addEventListener('paste', () => {
        setTimeout(() => {
          inp.value.split(/[\n,\t]+/).map(v => v.trim()).filter(Boolean).forEach(addSerial);
          inp.value = ''; sync();
        }, 10);
      });
    });

    document.getElementById('pr-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('pr-confirm').addEventListener('click', () => {
      const loc = document.getElementById('pr-loc').value.trim();
      const by  = document.getElementById('pr-by').value.trim();
      if (!loc) { showAlert('Location is required.', 'error'); return; }

      const parts = shipment.products.map((p, i) => {
        if (skipped[i]) return null;
        const isNS = p.serials.every(s => s.startsWith('NS-'));
        if (isNS) {
          const qty = parseInt(document.getElementById(`pr-qty-${i}`).value) || 0;
          return qty > 0 ? { product: p.product, category: p.category, serials: [], qty } : null;
        } else {
          const serials = Array.from(scannedSerials[i]);
          return serials.length > 0 ? { product: p.product, category: p.category, serials, qty: serials.length } : null;
        }
      }).filter(Boolean);

      if (!parts.length) { showAlert('Select at least one product to receive.', 'error'); return; }

      try {
        Inventory.receivePartialShipment(shipment.id, parts, by, loc);
        overlay.remove();
        UI.renderOrderList();
        UI.renderTransitList();
        UI.renderDashboard();
        const total = parts.reduce((a, p) => a + p.qty, 0);
        showAlert(`${total} unit${total!==1?'s':''} received into stock at ${loc}`, 'success');
      } catch (err) { showAlert(err.message, 'error'); }
    });
  }

  Object.assign(UI._, { showReceiveModal, showPartialReceiveModal });
})();
