/**
 * forms/orders.js — Purchase Orders form, tax preview, and Arrange / Split Shipment from an order
 */
(() => {
  const { esc, bind } = Forms._;

  // ── Orders ────────────────────────────────────────────────────────────
  let ordRows = [];
  let _ordCounter = 0;
  function newOrdRow() { return { id: 'ord' + (++_ordCounter), product: '', category: '', qty: '', unitCost: null }; }

  function buildOrderRowCard(row, idx, total) {
    const productOptions = Inventory.PRODUCTS.map(p =>
      `<option value="${esc(p.name)}"${row.product === p.name ? ' selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    const isOther = row.product === 'Other' || (row.product && !Inventory.PRODUCTS.find(p => p.name === row.product));
    const autoCategory = Inventory.PRODUCTS.find(p => p.name === row.product)?.category || row.category || '';
    return `
    <div class="product-row-card" id="ord-rowcard-${row.id}">
      <div class="product-row-header">
        <span class="product-row-num">Product ${idx + 1}</span>
        ${total > 1 ? `<button class="btn-remove-row" data-ordrowid="${row.id}">×</button>` : ''}
      </div>
      <div class="form-grid g3" style="margin-bottom:10px;">
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Product *</label>
          <select class="fi" id="${row.id}-ord-product">
            <option value="">Select product...</option>
            ${productOptions}
          </select>
          <input class="fi fi-mono" id="${row.id}-ord-product-custom"
            placeholder="Enter custom product name"
            style="margin-top:6px;display:${isOther ? 'block' : 'none'};"
            value="${isOther && row.product !== 'Other' ? esc(row.product) : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="fi" id="${row.id}-ord-category" value="${esc(autoCategory)}"
            readonly style="background:var(--bg-2);color:var(--text-muted);cursor:default;"
            placeholder="Auto-filled from product" />
        </div>
      </div>
      <div class="form-grid g3">
        <div class="form-group">
          <label class="form-label">Quantity *</label>
          <input class="fi" id="${row.id}-ord-qty" type="number" min="1" step="1"
            value="${row.qty || ''}" placeholder="e.g. 50" />
        </div>
        <div class="form-group">
          <label class="form-label">Unit cost <span style="font-weight:400;color:var(--text-hint)">(locked at order time)</span></label>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:var(--text-muted);font-size:13px;">$</span>
            <input class="fi" id="${row.id}-ord-cost" type="number" min="0" step="0.01"
              style="width:140px;" placeholder="0.00"
              value="${row.unitCost != null ? row.unitCost : ''}" />
          </div>
        </div>
      </div>
    </div>`;
  }

  function wireOrdRow(rowId) {
    const sel    = document.getElementById(`${rowId}-ord-product`);
    const custom = document.getElementById(`${rowId}-ord-product-custom`);
    const catEl  = document.getElementById(`${rowId}-ord-category`);
    const qtyEl  = document.getElementById(`${rowId}-ord-qty`);
    const costEl = document.getElementById(`${rowId}-ord-cost`);
    if (sel) {
      sel.addEventListener('change', () => {
        const row = ordRows.find(r => r.id === rowId);
        if (!row) return;
        const isOther = sel.value === 'Other';
        if (custom) custom.style.display = isOther ? 'block' : 'none';
        const def = Inventory.PRODUCTS.find(p => p.name === sel.value);
        if (catEl) catEl.value = def?.category || '';
        if (!isOther) { row.product = sel.value; row.category = def?.category || ''; }
        else row.product = custom?.value.trim() || 'Other';
      });
    }
    if (custom) custom.addEventListener('input', () => { const row = ordRows.find(r=>r.id===rowId); if(row) row.product=custom.value.trim()||'Other'; });
    if (qtyEl)  qtyEl.addEventListener('input',  () => { const row = ordRows.find(r=>r.id===rowId); if(row) row.qty=parseInt(qtyEl.value)||''; });
    if (costEl) costEl.addEventListener('input',  () => { const row = ordRows.find(r=>r.id===rowId); if(row) row.unitCost=costEl.value!==''?parseFloat(costEl.value):null; });
  }

  function renderOrdRows() {
    const c = document.getElementById('order-product-rows');
    if (!c) return;
    c.innerHTML = ordRows.map((r, i) => buildOrderRowCard(r, i, ordRows.length)).join('');
    ordRows.forEach(r => wireOrdRow(r.id));
    c.querySelectorAll('.btn-remove-row').forEach(btn => btn.addEventListener('click', () => {
      if (ordRows.length <= 1) return;
      ordRows = ordRows.filter(r => r.id !== btn.dataset.ordrowid);
      renderOrdRows();
    }));
  }

  function clearOrderForm() {
    ['ord-supplier','ord-po','ord-expected'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    ordRows = [newOrdRow()]; renderOrdRows();
  }

  function submitOrder() {
    // Sync fields from DOM
    ordRows.forEach(row => {
      const qtyEl    = document.getElementById(`${row.id}-ord-qty`);
      const costEl   = document.getElementById(`${row.id}-ord-cost`);
      const selEl    = document.getElementById(`${row.id}-ord-product`);
      const customEl = document.getElementById(`${row.id}-ord-product-custom`);
      if (selEl)   row.product  = selEl.value === 'Other' ? (customEl?.value.trim()||'Other') : selEl.value;
      if (qtyEl)   row.qty      = parseInt(qtyEl.value) || '';
      if (costEl)  row.unitCost = costEl.value !== '' ? parseFloat(costEl.value) : null;
    });

    // Read tax fields
    const taxRateRaw   = document.getElementById('ord-tax-rate')?.value.trim();
    const taxAmountRaw = document.getElementById('ord-tax-amount')?.value.trim();
    const taxRef       = document.getElementById('ord-tax-ref')?.value.trim() || '';
    const taxRate      = taxRateRaw   && taxRateRaw   !== '' ? parseFloat(taxRateRaw)   : null;
    const taxAmount    = taxAmountRaw && taxAmountRaw !== '' ? parseFloat(taxAmountRaw) : null;

    try {
      const order = Inventory.createOrder({
        supplier:   document.getElementById('ord-supplier').value.trim(),
        poNumber:   document.getElementById('ord-po').value.trim(),
        expectedBy: document.getElementById('ord-expected').value,
        products:   ordRows,
        taxRate, taxAmount, taxRef,
      });
      clearOrderForm();
      UI.renderOrderList();
      UI.refreshSmartSelects();
      const total  = order.products.reduce((a, p) => a + p.qty, 0);
      const taxMsg = (order.taxAmount||0) > 0 ? ` · Tax $${order.taxAmount.toFixed(2)} · Total $${order.totalWithTax.toFixed(2)}` : '';
      UI.showAlert(`Order placed — ${total} unit${total!==1?'s':''} on PO ${order.poNumber}${taxMsg}`, 'success');
    } catch(err) { UI.showAlert(err.message, 'error'); }
  }

  // Called by renderOrderList "Arrange Shipment" button
  window.arrangeShipmentFromOrder = function(orderId) {
    const order = DB.getOrders().find(o => o.id === orderId);
    if (!order) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const knownLocations = Inventory.getLocations();
    const locationOpts   = knownLocations.map(l => `<option value="${l}">${l}</option>`).join('');
    const totalOrderValue = order.products.reduce((a, p) => a + p.qty * (p.landedUnitCost || p.unitCost || 0), 0);
    const totalUnits      = order.products.reduce((a, p) => a + p.qty, 0);

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:520px;">
        <div class="modal-title">Register shipment</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem;">
          ${totalUnits} units &middot; ${esc(order.supplier)} &middot; PO ${esc(order.poNumber)}
          &middot; Order value $${totalOrderValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}${(order.taxAmount||0)>0 ? ` (inc. tax $${order.taxAmount.toFixed(2)})` : ''}
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;">Destination</div>
        <div class="form-grid g2" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">Destination location *</label>
            <select class="fi" id="arrange-loc">
              <option value="">Select location...</option>
              ${locationOpts}
              <option value="__new__">＋ Enter new location...</option>
            </select>
            <input class="fi" id="arrange-loc-custom" placeholder="Type new location name" style="margin-top:6px;display:none;" />
          </div>
          <div class="form-group">
            <label class="form-label">Expected by</label>
            <input class="fi" id="arrange-expected" type="date" value="${order.expectedBy || ''}" />
          </div>
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:6px;padding-top:10px;border-top:1px solid var(--border);">Freight / Shipping</div>
        <div style="font-size:11px;color:var(--text-hint);margin-bottom:10px;">Freight cost is split across product lines proportionally by value and added to each unit's landed cost.</div>
        <div class="form-grid g3" style="margin-bottom:12px;">
          <div class="form-group">
            <label class="form-label">Freight supplier</label>
            <input class="fi" id="arrange-freight-supplier" placeholder="e.g. DHL, FedEx" />
          </div>
          <div class="form-group">
            <label class="form-label">Freight PO / ref</label>
            <input class="fi" id="arrange-freight-po" placeholder="e.g. FREIGHT-2026-001" />
          </div>
          <div class="form-group">
            <label class="form-label">Total freight cost ($)</label>
            <input class="fi" id="arrange-freight-cost" type="number" min="0" step="0.01" placeholder="0.00" />
          </div>
        </div>
        <div id="arrange-landed-preview" style="margin-bottom:14px;display:none;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:6px;">Landed cost preview</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse;">
            <thead><tr>
              <th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-weight:600;">Product</th>
              <th style="text-align:right;padding:4px 6px;color:var(--text-muted);font-weight:600;">Qty</th>
              <th style="text-align:right;padding:4px 6px;color:var(--text-muted);font-weight:600;">Unit cost</th>
              <th style="text-align:right;padding:4px 6px;color:var(--text-muted);font-weight:600;">Freight/unit</th>
              <th style="text-align:right;padding:4px 6px;color:var(--aio-purple);font-weight:700;">Landed/unit</th>
            </tr></thead>
            <tbody id="arrange-preview-rows"></tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="arrange-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="arrange-confirm-btn">Register in transit</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    const fmt$ = n => '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

    const locSel    = document.getElementById('arrange-loc');
    const locCustom = document.getElementById('arrange-loc-custom');
    locSel.addEventListener('change', () => {
      const isNew = locSel.value === '__new__';
      locCustom.style.display = isNew ? 'block' : 'none';
      if (isNew) locCustom.focus();
    });

    function updatePreview() {
      const freightCost = parseFloat(document.getElementById('arrange-freight-cost').value) || 0;
      const preview     = document.getElementById('arrange-landed-preview');
      const tbody       = document.getElementById('arrange-preview-rows');
      if (freightCost <= 0 || totalOrderValue <= 0) { preview.style.display = 'none'; return; }
      preview.style.display = 'block';
      tbody.innerHTML = order.products.map(p => {
        const baseCost       = p.landedUnitCost || p.unitCost || 0; // includes tax/unit
        const lineValue      = p.qty * baseCost;
        const freightShare   = (lineValue / totalOrderValue) * freightCost;
        const freightPerUnit = p.qty > 0 ? freightShare / p.qty : 0;
        const finalLanded    = baseCost + freightPerUnit;
        return `<tr style="border-top:1px solid var(--border);">
          <td style="padding:5px 6px;font-weight:500;">${esc(p.product)}</td>
          <td style="padding:5px 6px;text-align:right;color:var(--text-muted);">${p.qty}</td>
          <td style="padding:5px 6px;text-align:right;color:var(--text-muted);">${fmt$(p.unitCost || 0)}${(p.taxPerUnit||0)>0?`<span style='color:#8A5200;font-size:10px;'> +${fmt$(p.taxPerUnit)} tax</span>`:''}</td>
          <td style="padding:5px 6px;text-align:right;color:var(--text-muted);">${fmt$(freightPerUnit)}</td>
          <td style="padding:5px 6px;text-align:right;font-weight:700;color:var(--aio-purple);">${fmt$(finalLanded)}</td>
        </tr>`;
      }).join('');
    }
    document.getElementById('arrange-freight-cost').addEventListener('input', updatePreview);

    document.getElementById('arrange-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('arrange-confirm-btn').addEventListener('click', () => {
      const loc = locSel.value === '__new__'
        ? locCustom.value.trim()
        : locSel.value;
      const expected        = document.getElementById('arrange-expected').value;
      const freightSupplier = document.getElementById('arrange-freight-supplier').value.trim();
      const freightPO       = document.getElementById('arrange-freight-po').value.trim();
      const freightCost     = parseFloat(document.getElementById('arrange-freight-cost').value) || 0;

      if (!loc) { UI.showAlert('Destination location is required.', 'error'); return; }

      const ts = Date.now();
      const shipmentProducts = order.products.map((p, pi) => {
        const baseCost       = p.landedUnitCost || p.unitCost || 0; // unit cost already inc. tax
        const lineValue      = p.qty * baseCost;
        const freightShare   = totalOrderValue > 0 ? (lineValue / totalOrderValue) * freightCost : 0;
        const freightPerUnit = p.qty > 0 ? freightShare / p.qty : 0;
        const landedPerUnit  = parseFloat((baseCost + freightPerUnit).toFixed(4));

        const tag     = (p.product || 'ITEM').replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8);
        const serials = Array.from({ length: p.qty }, (_, i) => `NS-${tag}-${ts + pi}-${i + 1}`);

        // Stamp landed cost on every serial right now
        serials.forEach(s => DB.setSerialCost(s, landedPerUnit));

        return {
          product:        p.product,
          category:       p.category,
          serials,
          unitCost:       p.unitCost || 0,
          freightPerUnit: parseFloat(freightPerUnit.toFixed(4)),
          landedPerUnit,
        };
      });

      DB.addShipment({
        id:              ts,
        supplier:        order.supplier,
        location:        loc,
        expectedBy:      expected,
        poNumber:        order.poNumber,
        status:          'in-transit',
        createdAt:       new Date().toISOString(),
        products:        shipmentProducts,
        freightSupplier: freightSupplier,
        freightPO:       freightPO,
        freightCost:     freightCost,
        orderId:         orderId,
      });
      DB.updateOrder(orderId, { status: 'in-transit', freightCost, freightSupplier, freightPO });
      if (loc) DB.addCustomLocation(loc);

      overlay.remove();
      UI.renderOrderList();
      UI.renderTransitList();
      UI.renderDashboard();
      UI.showAlert(
        `Shipment registered — ${totalUnits} units en route to ${loc}` +
        (freightCost > 0 ? ` · Freight ${fmt$(freightCost)} split across ${order.products.length} product line${order.products.length!==1?'s':''}` : ''),
        'success'
      );
    });
  };


  // Called by renderOrderList "Split Shipment" / "Split Again" button — v95
  window.splitShipmentFromOrder = function(orderId) {
    const order = DB.getOrders().find(o => o.id === orderId);
    if (!order) return;

    function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    const fmt$ = n => '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

    const allShipments = DB.getData().shipments.filter(s => s.orderId === orderId);
    const shippedQty = {};
    allShipments.forEach(s => { s.products.forEach(p => { shippedQty[p.product] = (shippedQty[p.product] || 0) + p.serials.length; }); });
    const remainingProducts = order.products.map(p => ({ ...p, remaining: Math.max(0, p.qty - (shippedQty[p.product] || 0)) })).filter(p => p.remaining > 0);

    if (!remainingProducts.length) { UI.showAlert('All units for this order have already been shipped.', 'error'); return; }

    const knownLocations = Inventory.getLocations();
    const locationOpts = knownLocations.map(l => '<option value="' + esc(l) + '">' + esc(l) + '</option>').join('');
    const rowSerials = {};
    remainingProducts.forEach((p, i) => { rowSerials[i] = []; });

    function _usesNS(p) {
      for (const s of allShipments) {
        const sp = s.products.find(x => x.product === p.product);
        if (sp && sp.serials.some(x => x.startsWith('NS-'))) return true;
      }
      return false;
    }

    const rowExcluded = {};  // tracks which product rows are excluded from this shipment

    function _buildProductRows() {
      return remainingProducts.map((p, i) => {
        const serials = rowSerials[i] || [];
        const usesNS = _usesNS(p);
        const serialTags = serials.map(s =>
          '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:11px;font-family:var(--mono);">' +
          esc(s) + '<button class="split-serial-x" data-rowidx="' + i + '" data-serial="' + esc(s) + '" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:13px;line-height:1;padding:0 2px;">×</button></span>'
        ).join('');
        return '<div class="product-row-card" id="split-row-' + i + '" style="margin-bottom:10px;transition:opacity .2s;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div><span style="font-weight:600;font-size:13px;">' + esc(p.product) + '</span>' +
            '<span class="cat-badge" style="margin-left:8px;">' + esc(p.category||'') + '</span>' +
            '<span style="font-size:11px;color:var(--text-muted);margin-left:10px;">' + p.remaining + ' remaining</span></div>' +
            '<button class="btn btn-ghost btn-xs split-toggle-btn" data-rowidx="' + i + '" style="font-size:11px;">✕ Not in this shipment</button>' +
          '</div>' +
          '<div id="split-body-' + i + '">' +
          '<div class="form-grid g2" style="margin-bottom:10px;">' +
            '<div class="form-group"><label class="form-label">Units in this shipment</label>' +
            '<input class="fi" type="number" id="split-qty-' + i + '" min="1" max="' + p.remaining + '" value="' + p.remaining + '" />' +
            '<div class="hint">Max: ' + p.remaining + '</div></div>' +
          '</div>' +
          (usesNS ? '<div class="hint" style="margin-bottom:4px;">No serial numbers required — placeholder IDs will be generated.</div>' :
            '<div class="form-group">' +
              '<label class="form-label">Scan / enter serial numbers <span style="font-weight:400;color:var(--text-hint)">(optional — leave blank for placeholder IDs)</span></label>' +
              '<input class="fi fi-mono" id="split-serial-' + i + '" placeholder="Type or scan, then Enter · paste list to bulk import" style="margin-bottom:6px;" />' +
              '<div class="hint" style="margin-bottom:6px;">Press Enter or comma to add · quantity auto-adjusts to match scanned count</div>' +
              '<div id="split-tags-' + i + '" style="display:flex;flex-wrap:wrap;gap:5px;min-height:20px;">' + serialTags + '</div>' +
              '<div class="hint" id="split-count-' + i + '">' + serials.length + ' serial' + (serials.length!==1?'s':'') + ' entered</div>' +
            '</div>'
          ) +
          '</div>' +
        '</div>';
      }).join('');
    }

    function _updateSerialTags(rowIdx) {
      const serials = rowSerials[rowIdx] || [];
      const tagsEl = overlay.querySelector('#split-tags-' + rowIdx);
      const countEl = overlay.querySelector('#split-count-' + rowIdx);
      if (tagsEl) {
        tagsEl.innerHTML = serials.map(s =>
          '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:11px;font-family:var(--mono);">' +
          esc(s) + '<button class="split-serial-x" data-rowidx="' + rowIdx + '" data-serial="' + esc(s) + '" style="background:none;border:none;cursor:pointer;color:var(--text-hint);font-size:13px;line-height:1;padding:0 2px;">×</button></span>'
        ).join('');
      }
      if (countEl) countEl.textContent = serials.length + ' serial' + (serials.length!==1?'s':'') + (serials.length > 0 ? ' scanned — qty auto-set' : ' entered');
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box" style="max-width:560px;max-height:90vh;overflow-y:auto;">' +
        '<div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span>&#9988; Split Shipment &#8212; Partial Despatch</span>' +
          '<button class="btn-remove-row" id="split-close-btn">&#215;</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem;">' +
          esc(order.supplier) + ' &#183; PO ' + esc(order.poNumber) + ' &#183; Register units being sent in this partial shipment. Remaining units stay on the order.' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;">Destination</div>' +
        '<div class="form-grid g2" style="margin-bottom:14px;">' +
          '<div class="form-group"><label class="form-label">Destination location *</label>' +
            '<select class="fi" id="split-loc"><option value="">Select location...</option>' + locationOpts + '<option value="__new__">+ Enter new location...</option></select>' +
            '<input class="fi" id="split-loc-custom" placeholder="Type new location name" style="margin-top:6px;display:none;" />' +
          '</div>' +
          '<div class="form-group"><label class="form-label">Expected by</label>' +
            '<input class="fi" id="split-expected" type="date" value="' + (order.expectedBy || '') + '" />' +
          '</div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:6px;padding-top:10px;border-top:1px solid var(--border);">Freight / Shipping (optional)</div>' +
        '<div class="form-grid g3" style="margin-bottom:14px;">' +
          '<div class="form-group"><label class="form-label">Freight supplier</label><input class="fi" id="split-freight-supplier" placeholder="e.g. DHL, FedEx" /></div>' +
          '<div class="form-group"><label class="form-label">Freight PO / ref</label><input class="fi" id="split-freight-po" placeholder="e.g. FREIGHT-001" /></div>' +
          '<div class="form-group"><label class="form-label">Freight cost ($)</label><input class="fi" id="split-freight-cost" type="number" min="0" step="0.01" placeholder="0.00" /></div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;padding-top:10px;border-top:1px solid var(--border);">Products in this shipment</div>' +
        '<div id="split-product-rows">' + _buildProductRows() + '</div>' +
        '<div id="split-error" style="display:none;color:var(--danger-text);font-size:12px;padding:8px 12px;background:var(--bg-2);border-radius:var(--r-md);margin-top:10px;"></div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="split-cancel-btn">Cancel</button>' +
          '<button class="btn btn-primary" id="split-confirm-btn">Register part shipment in transit</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const locSel = overlay.querySelector('#split-loc');
    const locCustom = overlay.querySelector('#split-loc-custom');
    locSel.addEventListener('change', () => { locCustom.style.display = locSel.value === '__new__' ? 'block' : 'none'; if (locSel.value === '__new__') locCustom.focus(); });
    overlay.querySelector('#split-close-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#split-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    remainingProducts.forEach((p, i) => {
      if (_usesNS(p)) return;
      const serialField = overlay.querySelector('#split-serial-' + i);
      if (!serialField) return;
      const addSerial = (raw) => {
        const v = raw.trim().toUpperCase();
        if (!v || (rowSerials[i] && rowSerials[i].includes(v))) return;
        if (!rowSerials[i]) rowSerials[i] = [];
        rowSerials[i].push(v);
        _updateSerialTags(i);
        const qtyEl = overlay.querySelector('#split-qty-' + i);
        if (qtyEl) qtyEl.value = rowSerials[i].length;
      };
      serialField.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); serialField.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerial); serialField.value = ''; } });
      serialField.addEventListener('paste', e => { e.preventDefault(); (e.clipboardData||window.clipboardData).getData('text').split(/[\n,	]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerial); serialField.value = ''; });
    });

    // Wire include/exclude toggle buttons
    overlay.querySelector('#split-product-rows').addEventListener('click', e => {
      const toggleBtn = e.target.closest('.split-toggle-btn');
      if (toggleBtn) {
        const idx = parseInt(toggleBtn.dataset.rowidx);
        const row  = overlay.querySelector('#split-row-' + idx);
        const body = overlay.querySelector('#split-body-' + idx);
        rowExcluded[idx] = !rowExcluded[idx];
        row.style.opacity        = rowExcluded[idx] ? '0.35' : '1';
        body.style.pointerEvents = rowExcluded[idx] ? 'none' : '';
        body.style.userSelect    = rowExcluded[idx] ? 'none' : '';
        toggleBtn.textContent    = rowExcluded[idx] ? '✓ Include in shipment' : '✕ Not in this shipment';
        toggleBtn.style.color    = rowExcluded[idx] ? 'var(--aio-purple)' : '';
        return;
      }
      if (e.target.classList.contains('split-serial-x')) {
        const idx = parseInt(e.target.dataset.rowidx);
        const serial = e.target.dataset.serial;
        if (!isNaN(idx)) {
          rowSerials[idx] = (rowSerials[idx] || []).filter(s => s !== serial);
          _updateSerialTags(idx);
          const qtyEl = overlay.querySelector('#split-qty-' + idx);
          if (qtyEl && rowSerials[idx].length > 0) qtyEl.value = rowSerials[idx].length;
        }
      }
    });

    overlay.querySelector('#split-confirm-btn').addEventListener('click', () => {
      const errEl = overlay.querySelector('#split-error');
      errEl.style.display = 'none';
      const loc = locSel.value === '__new__' ? locCustom.value.trim() : locSel.value;
      if (!loc) { errEl.textContent = 'Destination location is required.'; errEl.style.display = 'block'; return; }
      const expected = overlay.querySelector('#split-expected').value;
      const freightSupplier = overlay.querySelector('#split-freight-supplier').value.trim();
      const freightPO = overlay.querySelector('#split-freight-po').value.trim();
      const freightCost = parseFloat(overlay.querySelector('#split-freight-cost').value) || 0;
      const ts = Date.now();
      let totalUnitsInShipment = 0;
      const shipmentProducts = [];
      const anyIncluded = remainingProducts.some((p, i) => !rowExcluded[i] && (parseInt(overlay.querySelector('#split-qty-' + i)?.value) || 0) > 0);
      if (!anyIncluded) { errEl.textContent = 'Include at least one product in this shipment.'; errEl.style.display = 'block'; return; }
      for (let i = 0; i < remainingProducts.length; i++) {
        const p = remainingProducts[i];
        const qtyEl = overlay.querySelector('#split-qty-' + i);
        const qty = parseInt(qtyEl?.value) || 0;
        if (qty < 1) { errEl.textContent = 'Enter a quantity >= 1 for "' + p.product + '".'; errEl.style.display = 'block'; return; }
        if (qty > p.remaining) { errEl.textContent = 'Quantity for "' + p.product + '" exceeds remaining (' + p.remaining + ').'; errEl.style.display = 'block'; return; }
        if (rowExcluded[i] || qty === 0) continue; // excluded from this shipment
        const usesNS = _usesNS(p);
        let serials;
        if (usesNS || !rowSerials[i] || rowSerials[i].length === 0) {
          const tag = (p.product || 'ITEM').replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8);
          serials = Array.from({ length: qty }, (_, j) => 'NS-' + tag + '-' + (ts + i) + '-' + (j + 1));
        } else {
          serials = rowSerials[i].slice(0, qty);
          if (serials.length < qty) {
            const tag = (p.product || 'ITEM').replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8);
            serials = [...serials, ...Array.from({ length: qty - serials.length }, (_, j) => 'NS-' + tag + '-' + (ts + i) + '-' + (j + 1))];
          }
        }
        totalUnitsInShipment += qty;
        const baseCost = p.landedUnitCost || p.unitCost || 0;
        shipmentProducts.push({ product: p.product, category: p.category, serials, _qty: qty, _baseCost: baseCost, unitCost: p.unitCost || 0 });
      }
      const totalBaseValue = shipmentProducts.reduce((a, p) => a + p._baseCost * p._qty, 0);
      shipmentProducts.forEach(p => {
        const lineValue = p._baseCost * p._qty;
        const freightShare = totalBaseValue > 0 ? (lineValue / totalBaseValue) * freightCost : 0;
        const freightPerUnit = p._qty > 0 ? freightShare / p._qty : 0;
        p.landedPerUnit = parseFloat((p._baseCost + freightPerUnit).toFixed(4));
        p.freightPerUnit = parseFloat(freightPerUnit.toFixed(4));
        p.serials.forEach(s => DB.setSerialCost(s, p.landedPerUnit));
        delete p._qty; delete p._baseCost;
      });
      DB.addShipment({ id: ts, supplier: order.supplier, location: loc, expectedBy: expected, poNumber: order.poNumber, status: 'in-transit', createdAt: new Date().toISOString(), products: shipmentProducts, freightSupplier, freightPO, freightCost, orderId: orderId, isPartialShipment: true });
      if (loc) DB.addCustomLocation(loc);
      const updatedShippedQty = {};
      DB.getData().shipments.filter(s => s.orderId === orderId).forEach(s => { s.products.forEach(p => { updatedShippedQty[p.product] = (updatedShippedQty[p.product] || 0) + p.serials.length; }); });
      const allFullyShipped = order.products.every(p => (updatedShippedQty[p.product] || 0) >= p.qty);
      DB.updateOrder(orderId, { status: allFullyShipped ? 'in-transit' : 'partial' });
      overlay.remove();
      UI.renderOrderList();
      UI.renderTransitList();
      UI.renderDashboard();
      const stillRemaining = order.products.reduce((a, p) => a + Math.max(0, p.qty - (updatedShippedQty[p.product] || 0)), 0);
      UI.showAlert(
        'Part shipment registered — ' + totalUnitsInShipment + ' unit' + (totalUnitsInShipment!==1?'s':'') + ' en route to ' + loc +
        (stillRemaining > 0 ? ' · ' + stillRemaining + ' unit' + (stillRemaining!==1?'s':'') + ' still outstanding on the order' : ' · Order fully shipped') +
        (freightCost > 0 ? ' · Freight ' + fmt$(freightCost) : ''),
        'success'
      );
    });
  };

  function _wireOrderTaxPreview() {
    ['ord-tax-rate','ord-tax-amount','ord-tax-ref'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._taxWired) { el._taxWired = true; el.addEventListener('input', _updateOrderTaxPreview); }
    });
    // Also wire qty/cost changes to update preview
    ordRows.forEach(r => {
      ['ord-qty','ord-cost'].forEach(suffix => {
        const el = document.getElementById(`${r.id}-${suffix}`);
        if (el && !el._taxWired) { el._taxWired = true; el.addEventListener('input', _updateOrderTaxPreview); }
      });
    });
    _updateOrderTaxPreview();
  }

  function _updateOrderTaxPreview() {
    // Sync current rows
    ordRows.forEach(row => {
      const qtyEl  = document.getElementById(`${row.id}-ord-qty`);
      const costEl = document.getElementById(`${row.id}-ord-cost`);
      if (qtyEl)  row.qty      = parseInt(qtyEl.value)   || 0;
      if (costEl) row.unitCost = costEl.value !== '' ? parseFloat(costEl.value) : null;
    });

    const subtotal   = ordRows.reduce((a, r) => a + (parseFloat(r.unitCost)||0) * (parseInt(r.qty)||0), 0);
    const taxRateV   = parseFloat(document.getElementById('ord-tax-rate')?.value)  || 0;
    const taxAmtV    = parseFloat(document.getElementById('ord-tax-amount')?.value) || 0;
    const resolvedTax = taxAmtV > 0 ? taxAmtV : (taxRateV > 0 && subtotal > 0 ? subtotal * taxRateV / 100 : 0);
    const preview     = document.getElementById('ord-tax-preview');
    const summary     = document.getElementById('ord-total-summary');

    if (resolvedTax <= 0 || subtotal <= 0) {
      if (preview) preview.style.display = 'none';
      if (summary) { summary.style.display = ''; summary.innerHTML = subtotal > 0 ? `<span style="color:var(--aio-purple);font-weight:700;">Subtotal: $${subtotal.toFixed(2)}</span>` : ''; }
      return;
    }

    const rows = ordRows.filter(r => r.product && (parseFloat(r.unitCost)||0) > 0 && (parseInt(r.qty)||0) > 0);
    if (preview && rows.length) {
      preview.style.display = '';
      preview.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Tax split preview</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr>
            <th style="text-align:left;padding:3px 6px;color:var(--text-hint);">Product</th>
            <th style="text-align:right;padding:3px 6px;color:var(--text-hint);">Subtotal</th>
            <th style="text-align:right;padding:3px 6px;color:var(--text-hint);">Tax share</th>
            <th style="text-align:right;padding:3px 6px;color:var(--text-hint);">Tax/unit</th>
            <th style="text-align:right;padding:3px 6px;color:var(--aio-purple);">Landed/unit</th>
          </tr></thead>
          <tbody>${rows.map(r => {
            const lineVal    = (parseFloat(r.unitCost)||0) * (parseInt(r.qty)||0);
            const taxShare   = (lineVal / subtotal) * resolvedTax;
            const taxPerUnit = parseInt(r.qty) > 0 ? taxShare / parseInt(r.qty) : 0;
            const landed     = (parseFloat(r.unitCost)||0) + taxPerUnit;
            return `<tr>
              <td style="padding:3px 6px;font-weight:500">${r.product||'—'}</td>
              <td style="padding:3px 6px;text-align:right">$${lineVal.toFixed(2)}</td>
              <td style="padding:3px 6px;text-align:right;color:#8A5200">$${taxShare.toFixed(2)}</td>
              <td style="padding:3px 6px;text-align:right;color:#8A5200">$${taxPerUnit.toFixed(4)}</td>
              <td style="padding:3px 6px;text-align:right;font-weight:700;color:var(--aio-purple)">$${landed.toFixed(2)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
    }

    if (summary) {
      summary.style.display = '';
      summary.innerHTML = `
        <span style="margin-right:16px;">Subtotal: <strong>$${subtotal.toFixed(2)}</strong></span>
        <span style="margin-right:16px;color:#8A5200;">Tax: <strong>$${resolvedTax.toFixed(2)}</strong>${taxRateV > 0 ? ` (${taxRateV}%)` : ''}</span>
        <span style="color:var(--aio-purple);font-weight:700;">Total inc. tax: $${(subtotal + resolvedTax).toFixed(2)}</span>`;
    }
  }

  function showOrderForm() { if (!ordRows.length) ordRows=[newOrdRow()]; renderOrdRows(); }

  bind('btn-add-order-product', 'click', () => { ordRows.push(newOrdRow()); renderOrdRows(); });
  bind('btn-submit-order',      'click', submitOrder);

  Object.assign(Forms, { showOrderForm });
})();
