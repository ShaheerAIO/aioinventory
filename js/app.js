/**
 * app.js — event wiring, navigation, product row management
 */
(() => {

  // ── Shared product-row builder ────────────────────────────────────────
  function buildProductRowCard(row, idx, total, showCost) {
    const productOptions = Inventory.PRODUCTS.map(p =>
      `<option value="${esc(p.name)}"${row.product === p.name ? ' selected' : ''}>${esc(p.name)}</option>`
    ).join('');

    const isOther = row.product === 'Other' || (row.product && !Inventory.PRODUCTS.find(p => p.name === row.product));
    const autoCategory = Inventory.PRODUCTS.find(p => p.name === row.product)?.category || row.category || '';
    const noSerial = !!row.noSerial;

    return `
    <div class="product-row-card" id="rowcard-${row.id}">
      <div class="product-row-header">
        <span class="product-row-num">Product ${idx + 1}</span>  
        ${total > 1 ? `<button class="btn-remove-row" data-rowid="${row.id}">×</button>` : ''}
      </div>
      <div class="form-grid g3" style="margin-bottom:10px;">
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Product *</label>
          <select class="fi" id="${row.id}-product-select" data-rowid="${row.id}">
            <option value="">Select product...</option>
            ${productOptions}
          </select>
          <input class="fi fi-mono" id="${row.id}-product-custom" data-rowid="${row.id}"
            placeholder="Enter custom product name"
            style="margin-top:6px;display:${isOther ? 'block' : 'none'};"
            value="${isOther && row.product !== 'Other' ? esc(row.product) : ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="fi" id="${row.id}-category-display" value="${esc(autoCategory)}"
            readonly style="background:var(--bg-2);color:var(--text-muted);cursor:default;"
            placeholder="Auto-filled from product" />
        </div>
      </div>
      ${showCost ? `
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">Cost price per unit <span style="font-weight:400;color:var(--text-hint)">(applies to all units of this product)</span></label>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--text-muted);font-size:13px;">$</span>
          <input class="fi" id="${row.id}-unit-cost" type="number" min="0" step="0.01"
            style="width:140px;" placeholder="0.00"
            value="${row.unitCost != null ? row.unitCost : ''}" />
        </div>
      </div>` : `
      <div class="form-group" style="margin-bottom:10px;width:180px;">
        <label class="form-label">Low stock alert at</label>
        <input class="fi" id="${row.id}-threshold" data-rowid="${row.id}" data-field="threshold"
          type="number" min="0" value="${esc(row.threshold)}" placeholder="e.g. 5 (default 3)" />
      </div>`}

      <!-- No serial toggle -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <label class="used-toggle" id="${row.id}-noserial-label">
          <input type="checkbox" id="${row.id}-noserial" ${noSerial ? 'checked' : ''} />
          <span class="used-toggle-track"><span class="used-toggle-thumb"></span></span>
          <span class="used-toggle-label" style="font-size:12px;">No serial numbers</span>
        </label>
        <span class="hint" style="margin-top:0;">Check if this product doesn't use serial numbers</span>
      </div>

      <!-- Serial numbers section (shown when noSerial is off) -->
      <div id="${row.id}-serial-section" style="display:${noSerial ? 'none' : 'block'};">
        <div class="form-group">
          <label class="form-label">Serial numbers</label>
          <input class="fi fi-mono" id="${row.id}-serial-field" data-rowid="${row.id}"
            placeholder="Type or scan → Enter. Paste multiple lines for bulk." />
          <div class="hint">Press Enter or comma to add · Paste a list to bulk import</div>
          <div class="serial-row-list" id="${row.id}-serial-list"></div>
          <div class="hint" id="${row.id}-count">0 serials</div>
        </div>
      </div>

      <!-- Quantity section (shown when noSerial is on) -->
      <div id="${row.id}-qty-section" style="display:${noSerial ? 'block' : 'none'};">
        <div class="form-group" style="max-width:200px;">
          <label class="form-label">Quantity *</label>
          <input class="fi" id="${row.id}-qty" type="number" min="1" step="1"
            value="${row.qty || ''}" placeholder="e.g. 10" />
          <div class="hint">Number of units to ${showCost ? 'receive' : 'register'}</div>
        </div>
      </div>
    </div>`;
  }

  // ── Serial row renderer (with cost field) ─────────────────────────────
  function renderSerialRows(rowId, serials, serialCosts, showCost) {
    const container = document.getElementById(`${rowId}-serial-list`);
    if (!container) return;
    if (showCost) {
      container.innerHTML = serials.map(s => `
        <div class="serial-row-item">
          <span class="serial-row-tag">${esc(s)}</span>
          <input class="serial-cost-input" type="number" min="0" step="0.01"
            placeholder="Cost $" value="${serialCosts[s] != null ? serialCosts[s] : ''}"
            data-rowid="${rowId}" data-serial="${esc(s)}" />
          <button class="serial-row-x" data-rowid="${rowId}" data-serial="${esc(s)}">×</button>
        </div>`).join('');
      container.querySelectorAll('.serial-cost-input').forEach(inp => {
        inp.addEventListener('input', () => {
          const r = _findRow(inp.dataset.rowid);
          if (r) r.serialCosts[inp.dataset.serial] = inp.value ? parseFloat(inp.value) : null;
        });
      });
    } else {
      container.innerHTML = serials.map(s => `
        <div class="serial-row-item">
          <span class="serial-row-tag">${esc(s)}</span>
          <button class="serial-row-x" data-rowid="${rowId}" data-serial="${esc(s)}">×</button>
        </div>`).join('');
    }
    container.querySelectorAll('.serial-row-x').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = _findRow(btn.dataset.rowid);
        if (r) { r.serials = r.serials.filter(s => s !== btn.dataset.serial); delete r.serialCosts[btn.dataset.serial]; renderSerialRows(r.id, r.serials, r.serialCosts, showCost); updateCount(r.id); }
      });
    });
    updateCount(rowId);
  }

  function updateCount(rowId) {
    const r  = _findRow(rowId);
    const el = document.getElementById(`${rowId}-count`);
    if (el && r) el.textContent = `${r.serials.length} serial${r.serials.length!==1?'s':''}`;
  }

  function addSerialToRow(rowId, raw, showCost) {
    const v = raw.trim().toUpperCase();
    if (!v) return;
    const r = _findRow(rowId);
    if (!r || r.serials.includes(v)) return;
    r.serials.push(v);
    renderSerialRows(r.id, r.serials, r.serialCosts, showCost);
  }

  function wireSerialField(rowId, showCost) {
    const el = document.getElementById(`${rowId}-serial-field`);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        el.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).forEach(v => addSerialToRow(rowId, v, showCost));
        el.value = '';
      }
    });
    el.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData||window.clipboardData).getData('text');
      text.split(/[\n,\t]+/).map(v=>v.trim()).filter(Boolean).forEach(v => addSerialToRow(rowId, v, showCost));
      el.value = '';
    });
    // Attach camera scan button
    if (typeof Scanner !== 'undefined') {
      Scanner.attachToInput(el, (serial) => addSerialToRow(rowId, serial, showCost));
    }
  }

  // ── Wire product dropdown — auto-fills category, reveals Other input ─────
  function wireProductSelect(rowId, rowList) {
    const sel    = document.getElementById(`${rowId}-product-select`);
    const custom = document.getElementById(`${rowId}-product-custom`);
    const catEl  = document.getElementById(`${rowId}-category-display`);
    const costEl = document.getElementById(`${rowId}-unit-cost`);
    if (!sel) return;

    const applySelection = (val) => {
      const row = rowList.find(r => r.id === rowId);
      if (!row) return;
      const isOther = val === 'Other';
      if (custom) custom.style.display = isOther ? 'block' : 'none';
      const productDef = Inventory.PRODUCTS.find(p => p.name === val);
      const autoCategory = productDef?.category || '';
      if (catEl) catEl.value = autoCategory;
      if (!isOther) {
        row.product  = val;
        row.category = autoCategory;
        // Pre-fill unit cost from existing DB cost for this product
        if (costEl) {
          const existingSerials = Object.values(Inventory.getInventoryMap())
            .find(v => v.product === val)?.inStock;
          if (existingSerials && existingSerials.size > 0) {
            const first = [...existingSerials][0];
            const existingCost = DB.getSerialCost(first);
            if (existingCost != null && costEl.value === '') costEl.value = existingCost;
          }
        }
      } else {
        row.product  = custom?.value.trim() || 'Other';
        row.category = autoCategory;
      }
    };

    sel.addEventListener('change', () => applySelection(sel.value));
    if (custom) {
      custom.addEventListener('input', () => {
        const row = rowList.find(r => r.id === rowId);
        if (row) row.product = custom.value.trim() || 'Other';
      });
    }
    if (costEl) {
      costEl.addEventListener('change', () => {
        const row = rowList.find(r => r.id === rowId);
        if (!row) return;
        const cost = costEl.value !== '' ? parseFloat(costEl.value) : null;
        row.unitCost = cost;
      });
    }
    // Apply on initial load if product already set
    if (sel.value) applySelection(sel.value);

    // Wire no-serial toggle
    const noSerialChk = document.getElementById(`${rowId}-noserial`);
    const serialSection = document.getElementById(`${rowId}-serial-section`);
    const qtySection    = document.getElementById(`${rowId}-qty-section`);
    if (noSerialChk) {
      noSerialChk.addEventListener('change', () => {
        const row = rowList.find(r => r.id === rowId);
        if (!row) return;
        row.noSerial = noSerialChk.checked;
        row.serials  = []; // clear serials when toggling
        if (serialSection) serialSection.style.display = row.noSerial ? 'none' : 'block';
        if (qtySection)    qtySection.style.display    = row.noSerial ? 'block' : 'none';
      });
    }
    const qtyEl = document.getElementById(`${rowId}-qty`);
    if (qtyEl) {
      qtyEl.addEventListener('input', () => {
        const row = rowList.find(r => r.id === rowId);
        if (row) row.qty = parseInt(qtyEl.value) || '';
      });
    }
  }

  function syncRowFields(row) {
    const sel    = document.getElementById(`${row.id}-product-select`);
    const custom = document.getElementById(`${row.id}-product-custom`);
    const catEl  = document.getElementById(`${row.id}-category-display`);
    const costEl = document.getElementById(`${row.id}-unit-cost`);
    const thrEl  = document.getElementById(`${row.id}-threshold`);
    const nsChk  = document.getElementById(`${row.id}-noserial`);
    const qtyEl  = document.getElementById(`${row.id}-qty`);
    if (sel) {
      if (sel.value === 'Other' && custom) row.product = custom.value.trim() || 'Other';
      else if (sel.value) row.product = sel.value;
    }
    if (catEl)  row.category  = catEl.value;
    if (costEl) row.unitCost  = costEl.value !== '' ? parseFloat(costEl.value) : null;
    if (thrEl)  row.threshold = thrEl.value;
    if (nsChk)  row.noSerial  = nsChk.checked;
    if (qtyEl)  row.qty       = parseInt(qtyEl.value) || '';
  }

  // ── Stock In ──────────────────────────────────────────────────────────
  let inRows = [];
  let _inCounter = 0;
  function newInRow() { return { id: 'in' + (++_inCounter), product: '', category: '', threshold: '', serials: [], serialCosts: {}, noSerial: false, qty: '' }; }

  function renderInRows() {
    const c = document.getElementById('product-rows');
    if (!c) return;
    c.innerHTML = inRows.map((r, i) => buildProductRowCard(r, i, inRows.length, true)).join('');
    inRows.forEach(r => {
      renderSerialRows(r.id, r.serials, r.serialCosts, false); // serials don't have individual costs now
      wireSerialField(r.id);
      wireProductSelect(r.id, inRows);
    });
    c.querySelectorAll('.btn-remove-row').forEach(btn => btn.addEventListener('click', () => removeInRow(btn.dataset.rowid)));
  }

  function removeInRow(id) { if (inRows.length <= 1) return; inRows = inRows.filter(r => r.id !== id); renderInRows(); }

  function clearStockIn() {
    document.getElementById('in-supplier').value    = '';
    document.getElementById('in-loc').value         = '';
    document.getElementById('in-received-by').value = '';
    const poEl = document.getElementById('in-po'); if (poEl) poEl.value = '';
    const defaultCond = document.querySelector('input[name="in-condition"][value=""]');
    if (defaultCond) defaultCond.checked = true;
    inRows = [newInRow()]; renderInRows();
  }

  function submitStockIn() {
    inRows.forEach(syncRowFields);
    try {
      const conditionEl = document.querySelector('input[name="in-condition"]:checked');
      const condition   = conditionEl ? conditionEl.value : '';
      const poNumber    = document.getElementById('in-po')?.value.trim() || '';

      // For no-serial rows, generate placeholder serial IDs
      inRows.forEach(row => {
        if (row.noSerial) {
          const qty = parseInt(row.qty) || 0;
          if (qty < 1) throw new Error(`"${row.product || 'Product'}" has no serial numbers — enter a quantity.`);
          const ts = Date.now();
          row.serials = Array.from({length: qty}, (_, i) =>
            `NS-${(row.product||'ITEM').replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8)}-${ts}-${i+1}`
          );
          row.noSerialQty = qty;
        } else if (!row.serials || row.serials.length === 0) {
          throw new Error(`"${row.product || 'Product'}" requires serial numbers or check "No serial numbers".`);
        }
      });

      // Warn (don't block) when the same units look like they were already
      // received as non-serialised — the serial-level guards can't catch this.
      const _phLoc = document.getElementById('in-loc').value.trim();
      const _phConflicts = Inventory.getPlaceholderConflicts(inRows, _phLoc);
      if (_phConflicts.length > 0) {
        const _phMsg = _phConflicts.map(c =>
          `• ${c.product}: ${c.placeholders} non-serialised unit${c.placeholders!==1?'s':''} already in stock at ${c.location}, receiving ${c.incoming} serial${c.incoming!==1?'s':''} now`
        ).join('\n');
        if (!confirm(
          `Possible double-count:\n\n${_phMsg}\n\nIf these are the same physical units, cancel and either receive them against the shipment (In Transit → Receive) or remove the non-serialised placeholders first. Continuing will count them twice.\n\nReceive anyway?`
        )) return;
      }

      Inventory.stockIn({
        supplier:   document.getElementById('in-supplier').value.trim(),
        location:   document.getElementById('in-loc').value.trim(),
        receivedBy: document.getElementById('in-received-by').value.trim(),
        condition,
        poNumber,
        products:   inRows,
      });
      // Apply unit cost — PO items have their cost locked in inventory.js already
      // For non-PO items, propagate cost to all serials of same product
      if (!poNumber) {
        inRows.forEach(row => {
          if (row.unitCost != null) {
            row.serials.forEach(s => DB.setSerialCost(s, row.unitCost));
            if (!row.noSerial) DB.setProductCost(row.product, row.unitCost, Inventory.getInventoryMap());
          }
        });
      }
      const total = inRows.reduce((a, r) => a + r.serials.length, 0);
      const loc   = document.getElementById('in-loc').value.trim();
      clearStockIn();
      UI.refreshSmartSelects();
      UI.showAlert(`${total} unit${total!==1?'s':''} received at ${loc}`, 'success');
    } catch (err) { UI.showAlert(err.message, 'error'); }
  }

  // ── Products ─────────────────────────────────────────────────────────
  function clearProductForm() {
    ['name','category','supplier','threshold','notes'].forEach(f => {
      const el = document.getElementById('prod-' + f); if (el) el.value = '';
    });
    const serialEditable = document.getElementById('prod-serial-editable'); if (serialEditable) serialEditable.checked = false;
    const editId = document.getElementById('prod-edit-id'); if (editId) editId.value = '';
    const btn = document.getElementById('btn-submit-product'); if (btn) btn.textContent = 'Save product';
    const cancelBtn = document.getElementById('btn-cancel-product-edit'); if (cancelBtn) cancelBtn.style.display = 'none';
  }

  function submitProduct() {
    const name = document.getElementById('prod-name')?.value.trim();
    if (!name) { UI.showAlert('Product name is required.', 'error'); return; }

    const editId = document.getElementById('prod-edit-id')?.value;
    const threshold = document.getElementById('prod-threshold')?.value;
    const data = {
      name,
      category:         document.getElementById('prod-category')?.value.trim()  || '',
      supplier:         document.getElementById('prod-supplier')?.value.trim()   || '',
      defaultThreshold: threshold !== '' && threshold != null ? parseInt(threshold) : null,
      notes:            document.getElementById('prod-notes')?.value.trim()      || '',
      serialEditable:   document.getElementById('prod-serial-editable')?.checked || false,
    };

    if (editId) {
      DB.updateProductRecord(parseInt(editId), data);
      UI.showAlert(`Product "${name}" updated`, 'success');
    } else {
      const exists = DB.getProductRecords().find(r => r.name.toLowerCase() === name.toLowerCase());
      if (exists) { UI.showAlert(`Product "${name}" already has a record.`, 'error'); return; }
      DB.addProductRecord({ id: Date.now(), ...data, createdAt: new Date().toISOString() });
      UI.showAlert(`Product "${name}" saved`, 'success');
    }

    clearProductForm();
    Inventory.refreshProducts();
    UI.renderProductList();
    UI.populateCategoryFilters();
  }

  // ── Suppliers ─────────────────────────────────────────────────────────
  function clearSupplierForm() {
    ['name','contactName','email','phone','website','address','paymentTerms','leadTimeDays','currency','notes'].forEach(f => {
      const el = document.getElementById('supp-' + f); if (el) el.value = '';
    });
    const editId = document.getElementById('supp-edit-id'); if (editId) editId.value = '';
    const btn = document.getElementById('btn-submit-supplier'); if (btn) btn.textContent = 'Add supplier';
  }

  function submitSupplier() {
    const name = document.getElementById('supp-name')?.value.trim();
    if (!name) { UI.showAlert('Supplier name is required.', 'error'); return; }

    const editId = document.getElementById('supp-edit-id')?.value;
    const data = {
      name,
      contactName:  document.getElementById('supp-contactName')?.value.trim()  || '',
      email:        document.getElementById('supp-email')?.value.trim()         || '',
      phone:        document.getElementById('supp-phone')?.value.trim()         || '',
      website:      document.getElementById('supp-website')?.value.trim()       || '',
      address:      document.getElementById('supp-address')?.value.trim()       || '',
      paymentTerms: document.getElementById('supp-paymentTerms')?.value.trim()  || '',
      leadTimeDays: document.getElementById('supp-leadTimeDays')?.value.trim()  || '',
      currency:     document.getElementById('supp-currency')?.value.trim()      || '',
      notes:        document.getElementById('supp-notes')?.value.trim()         || '',
    };

    if (editId) {
      DB.updateSupplier(parseInt(editId), data);
      UI.showAlert(`Supplier "${name}" updated`, 'success');
    } else {
      // Check for duplicate name
      const exists = DB.getSupplierRecords().find(s => s.name.toLowerCase() === name.toLowerCase());
      if (exists) { UI.showAlert(`Supplier "${name}" already exists.`, 'error'); return; }
      DB.addSupplier({ id: Date.now(), ...data, createdAt: new Date().toISOString() });
      // Also register in customSuppliers so SmartSelect picks it up immediately
      DB.addCustomSupplier(name);
      UI.showAlert(`Supplier "${name}" added`, 'success');
    }

    clearSupplierForm();
    UI.renderSupplierList();
    UI.refreshSmartSelects();
  }

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
          <button class="btn btn-orange" id="arrange-confirm-btn">Register in transit</button>
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
          <td style="padding:5px 6px;text-align:right;color:var(--text-muted);">${fmt$(p.unitCost || 0)}${(p.taxPerUnit||0)>0?`<span style='color:#9c6000;font-size:10px;'> +${fmt$(p.taxPerUnit)} tax</span>`:''}</td>
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
          '<button class="btn btn-orange" id="split-confirm-btn">Register part shipment in transit</button>' +
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
      if (typeof Scanner !== 'undefined') Scanner.attachToInput(serialField, addSerial);
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

  // ── In Transit ────────────────────────────────────────────────────────
  let trRows = [];
  let _trCounter = 0;
  function newTrRow() { return { id: 'tr' + (++_trCounter), product: '', category: '', serials: [], serialCosts: {}, noSerial: false, qty: '' }; }

  function renderTrRows() {
    const c = document.getElementById('transit-product-rows');
    if (!c) return;
    c.innerHTML = trRows.map((r, i) => buildProductRowCard(r, i, trRows.length, true)).join('');
    trRows.forEach(r => {
      renderSerialRows(r.id, r.serials, r.serialCosts, false);
      wireSerialField(r.id);
      wireProductSelect(r.id, trRows);
    });
    c.querySelectorAll('.btn-remove-row').forEach(btn => btn.addEventListener('click', () => removeTrRow(btn.dataset.rowid)));
  }

  function removeTrRow(id) { if (trRows.length <= 1) return; trRows = trRows.filter(r => r.id !== id); renderTrRows(); }

  function clearTransitForm() {
    ['tr-supplier','tr-loc','tr-expected','tr-po'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    trRows = [newTrRow()]; renderTrRows();
  }

  function submitTransit() {
    trRows.forEach(syncRowFields);
    try {
      // For no-serial rows, generate placeholder serial IDs
      trRows.forEach(row => {
        if (row.noSerial) {
          const qty = parseInt(row.qty) || 0;
          if (qty < 1) throw new Error(`"${row.product || 'Product'}" has no serial numbers — enter a quantity.`);
          const ts = Date.now();
          row.serials = Array.from({length: qty}, (_, i) =>
            `NS-${(row.product||'ITEM').replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8)}-${ts}-${i+1}`
          );
          row.noSerialQty = qty;
        } else if (!row.serials || row.serials.length === 0) {
          throw new Error(`"${row.product || 'Product'}" requires serial numbers or check "No serial numbers".`);
        }
      });

      Inventory.createShipment({
        supplier:   document.getElementById('tr-supplier').value.trim(),
        location:   document.getElementById('tr-loc').value.trim(),
        expectedBy: document.getElementById('tr-expected').value,
        poNumber:   document.getElementById('tr-po')?.value.trim() || '',
        products:   trRows,
      });
      const total = trRows.reduce((a, r) => a + r.serials.length, 0);
      clearTransitForm();
      UI.renderTransitList();
      UI.renderDashboard();
      UI.refreshSmartSelects();
      UI.showAlert(`${total} unit${total!==1?'s':''} registered as in transit`, 'success');
    } catch (err) { UI.showAlert(err.message, 'error'); }
  }

  // ── Stock Out ─────────────────────────────────────────────────────────
  let outRows = [];
  let _outCounter = 0;

  function newOutRow() {
    return { id: 'out' + (++_outCounter), product: '', location: '', serials: [], serialCosts: {}, useSerials: true, qty: '' };
  }

  function buildOutRowCard(row, idx, total) {
    const map = Inventory.getInventoryMap();

    // Build product options from current stock only
    const stockedProducts = [...new Set(Object.values(map).map(v => v.product))].sort();
    const productOptions = stockedProducts.map(p =>
      `<option value="${esc(p)}"${row.product === p ? ' selected' : ''}>${esc(p)}</option>`
    ).join('');

    // Location options for selected product
    const locationsForProduct = row.product
      ? Object.values(map).filter(v => v.product === row.product && v.inStock.size > 0).map(v => v.location)
      : [];
    const locationOptions = locationsForProduct.map(l =>
      `<option value="${esc(l)}"${row.location === l ? ' selected' : ''}>${esc(l)} (${map[row.product + '||' + l]?.inStock.size || 0} in stock)</option>`
    ).join('');

    const availCount = row.product && row.location
      ? (map[row.product + '||' + row.location]?.inStock.size || 0)
      : null;

    // Detect if this product only has NS- (no-serial) stock
    const isNoSerial = row.product && row.location
      ? [...(map[row.product + '||' + row.location]?.inStock || [])].every(s => s.startsWith('NS-'))
      : false;

    return `
    <div class="product-row-card" id="out-rowcard-${row.id}">
      <div class="product-row-header">
        <span class="product-row-num">Product ${idx + 1}</span>
        ${total > 1 ? `<button class="btn-remove-row" data-outrowid="${row.id}">×</button>` : ''}
      </div>
      <div class="form-grid g3" style="margin-bottom:12px;">
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Product *</label>
          <select class="fi" id="${row.id}-out-product">
            <option value="">Select product from stock...</option>
            ${productOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Location *</label>
          <select class="fi" id="${row.id}-out-location" ${!row.product ? 'disabled' : ''}>
            <option value="">Select location...</option>
            ${locationOptions}
          </select>
        </div>
      </div>

      ${availCount !== null ? `<div class="hint" style="margin-bottom:10px;">${availCount} unit${availCount!==1?'s':''} available at this location</div>` : ''}

      ${row.product && row.location ? (isNoSerial ? `
      <!-- Qty picker for no-serial products -->
      <div class="form-group" style="max-width:200px;">
        <label class="form-label">Quantity to dispatch *</label>
        <input class="fi" id="${row.id}-out-qty" type="number" min="1" max="${availCount||999}" step="1"
          value="${row.qty || ''}" placeholder="e.g. 5" />
        <div class="hint">Max available: ${availCount}</div>
      </div>
      ` : `
      <!-- Serial number entry for serialised products -->
      <div id="${row.id}-out-serials-section">
        <div class="form-group">
          <label class="form-label">Serial numbers to dispatch *</label>
          <input class="fi fi-mono" id="${row.id}-out-serial-field"
            placeholder="Type or scan serial then Enter · validated against stock" />
          <div class="hint">Press Enter to add · scanned serials auto-add · unavailable shown in red</div>
          <div class="serial-area" id="${row.id}-out-tags"></div>
          <div class="hint" id="${row.id}-out-count">0 serials</div>
        </div>
      </div>
      `) : ''}
    </div>`;
  }

  function renderOutRows() {
    const c = document.getElementById('out-product-rows');
    if (!c) return;
    c.innerHTML = outRows.map((r, i) => buildOutRowCard(r, i, outRows.length)).join('');

    outRows.forEach(row => {
      // Re-render existing serial tags
      _renderOutTags(row.id);
      _wireOutRow(row.id);
    });
    c.querySelectorAll('.btn-remove-row').forEach(btn => {
      btn.addEventListener('click', () => {
        if (outRows.length <= 1) return;
        outRows = outRows.filter(r => r.id !== btn.dataset.outrowid);
        renderOutRows();
      });
    });
  }

  function _wireOutRow(rowId) {
    const productSel  = document.getElementById(`${rowId}-out-product`);
    const locationSel = document.getElementById(`${rowId}-out-location`);
    const serialField = document.getElementById(`${rowId}-out-serial-field`);
    const qtyField    = document.getElementById(`${rowId}-out-qty`);

    if (productSel) {
      productSel.addEventListener('change', () => {
        const row = outRows.find(r => r.id === rowId);
        if (!row) return;
        row.product  = productSel.value;
        row.location = '';
        row.serials  = [];
        row.qty      = '';
        renderOutRows();
      });
    }

    if (locationSel) {
      locationSel.addEventListener('change', () => {
        const row = outRows.find(r => r.id === rowId);
        if (!row) return;
        row.location = locationSel.value;
        row.serials  = [];
        row.qty      = '';
        renderOutRows();
      });
    }

    if (qtyField) {
      qtyField.addEventListener('input', () => {
        const row = outRows.find(r => r.id === rowId);
        if (row) row.qty = parseInt(qtyField.value) || '';
      });
    }

    if (serialField) {
      serialField.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          serialField.value.split(/[,\n]+/).map(v => v.trim()).filter(Boolean).forEach(v => _addOutSerial(rowId, v));
          serialField.value = '';
        }
      });
      serialField.addEventListener('paste', e => {
        e.preventDefault();
        (e.clipboardData||window.clipboardData).getData('text').split(/[\n,\t]+/).map(v=>v.trim()).filter(Boolean).forEach(v => _addOutSerial(rowId, v));
        serialField.value = '';
      });
      if (typeof Scanner !== 'undefined') {
        Scanner.attachToInput(serialField, (serial) => _addOutSerial(rowId, serial));
      }
    }
  }

  function _addOutSerial(rowId, raw) {
    const v = raw.trim().toUpperCase();
    if (!v) return;
    const row = outRows.find(r => r.id === rowId);
    if (!row || row.serials.includes(v)) return;
    row.serials.push(v);
    _renderOutTags(rowId);
  }

  function _renderOutTags(rowId) {
    const row   = outRows.find(r => r.id === rowId);
    const c     = document.getElementById(`${rowId}-out-tags`);
    const countEl = document.getElementById(`${rowId}-out-count`);
    if (!row || !c) return;
    const avail = Inventory.getAvailableSerials();
    c.innerHTML = row.serials.map(s => {
      const ok = avail.has(s);
      return `<span class="stag ${ok?'stag-out':'stag-err'}">${esc(s)}${ok?'':' ✗'}<span class="stag-x" data-rowid="${rowId}" data-serial="${esc(s)}">×</span></span>`;
    }).join('');
    c.querySelectorAll('.stag-x').forEach(x => {
      x.addEventListener('click', () => {
        const r = outRows.find(r => r.id === x.dataset.rowid);
        if (r) { r.serials = r.serials.filter(s => s !== x.dataset.serial); _renderOutTags(rowId); }
      });
    });
    const invalid = row.serials.filter(s => !avail.has(s)).length;

    // Product mismatch warning — serial belongs to a different product
    let mismatchMsg = '';
    if (row.product) {
      const mismatched = row.serials.filter(s => {
        if (s.toUpperCase().startsWith('NS-')) return false;
        const known = Inventory.getSerialKnownProduct ? Inventory.getSerialKnownProduct(s) : null;
        return known && known !== row.product;
      });
      if (mismatched.length > 0) {
        const known = Inventory.getSerialKnownProduct(mismatched[0]);
        mismatchMsg = ` ⚠ ${mismatched.length} serial${mismatched.length!==1?'s':''} belong to "${known}", not "${row.product}"`;
      }
    }

    if (countEl) {
      countEl.textContent = row.serials.length + ' serial' + (row.serials.length!==1?'s':'') + (invalid ? ` — ${invalid} not in stock` : '') + mismatchMsg;
      countEl.style.color = mismatchMsg ? '#c0392b' : '';
    }

    // Also highlight mismatched serial tags in red
    c.querySelectorAll('.stag-out').forEach(tag => {
      const serial = tag.childNodes[0]?.textContent;
      if (serial && row.product) {
        const known = Inventory.getSerialKnownProduct ? Inventory.getSerialKnownProduct(serial) : null;
        if (known && known !== row.product) {
          tag.classList.remove('stag-out');
          tag.classList.add('stag-err');
          tag.title = `Belongs to: ${known}`;
        }
      }
    });
  }

  function clearStockOut() {
    ['out-customer','out-by','out-ref'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    outRows = [newOutRow()];
    renderOutRows();
    autoFillUser();
  }

  function submitStockOut() {
    const customer = document.getElementById('out-customer').value.trim();
    const by       = document.getElementById('out-by').value.trim();
    const ref      = document.getElementById('out-ref').value.trim();
    const mode     = document.querySelector('input[name="out-mode"]:checked')?.value || 'stage';
    const isStage  = mode === 'stage';

    if (!customer) { UI.showAlert('Customer / account is required.', 'error'); return; }

    const map = Inventory.getInventoryMap();

    // Sync qty fields and validate
    for (const row of outRows) {
      const qtyEl = document.getElementById(`${row.id}-out-qty`);
      if (qtyEl) row.qty = parseInt(qtyEl.value) || '';

      if (!row.product)  { UI.showAlert('Select a product for each row.', 'error'); return; }
      if (!row.location) { UI.showAlert(`Select a location for "${row.product}".`, 'error'); return; }

      // Determine if this row is no-serial (all NS- stock)
      const inStock = [...(map[row.product + '||' + row.location]?.inStock || [])];
      const isNoSerial = inStock.length > 0 && inStock.every(s => s.startsWith('NS-'));

      if (isNoSerial) {
        // Always re-read qty directly from DOM at submit time — never trust row.qty alone
        const freshQty = qtyEl ? (parseInt(qtyEl.value) || 0) : 0;
        row.qty = freshQty;
        if (!row.qty || row.qty < 1) { UI.showAlert(`Enter a quantity for "${row.product}".`, 'error'); return; }
        if (row.qty > inStock.length) { UI.showAlert(`Only ${inStock.length} unit${inStock.length!==1?'s':''} of "${row.product}" available.`, 'error'); return; }
        // Exclude serials already staged for pending deployment
        const _pendingSet = new Set(
          DB.getPendingDeployments().flatMap(p => (p.serials||[]).map(s => s.toUpperCase()))
        );
        const _available = inStock.filter(s => !_pendingSet.has(s.toUpperCase()));
        if (_available.length < row.qty) {
          UI.showAlert(`Only ${_available.length} unstaged unit${_available.length!==1?'s':''} of "${row.product}" available (${inStock.length - _available.length} already staged).`, 'error');
          return;
        }
        row.serials = _available.slice(0, row.qty); // row.qty is now guaranteed to be a valid positive integer
      } else {
        if (row.serials.length === 0) { UI.showAlert(`Add at least one serial for "${row.product}".`, 'error'); return; }
      }
    }

    try {
      let totalUnits = 0;
      if (isStage) {
        // Stage for deployment — stays in Stock Holding, tagged to customer
        outRows.forEach(row => {
          Inventory.stagePendingDeployment({ customer, by, ref, serials: row.serials });
          totalUnits += row.serials.length;
        });
        clearStockOut();
        UI.renderDashboard();
        UI.showAlert(`${totalUnits} unit${totalUnits!==1?'s':''} staged for deployment to "${customer}" — confirm in Stock Deployed when ready`, 'success');
      } else {
        // Dispatch now — immediately moves to Stock Deployed
        outRows.forEach(row => {
          Inventory.stockOut({ customer, by, ref, serials: row.serials });
          totalUnits += row.serials.length;
        });
        clearStockOut();
        UI.renderDashboard();
        UI.showAlert(`${totalUnits} unit${totalUnits!==1?'s':''} dispatched to "${customer}"`, 'success');
      }
    } catch(err) { UI.showAlert(err.message, 'error'); }
  }

  // Wire mode toggle to update labels and button text
  function _wireOutModeToggle() {
    document.querySelectorAll('input[name="out-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isStage = radio.value === 'stage';
        const title    = document.getElementById('out-panel-title');
        const toolbarT = document.getElementById('out-toolbar-title');
        const byLabel  = document.getElementById('out-by-label');
        const btn      = document.getElementById('btn-submit-out');
        if (title)    title.textContent    = isStage ? 'Stage for deployment — attach to customer' : 'Dispatch details';
        if (toolbarT) toolbarT.textContent = isStage ? 'Stage for deployment' : 'Dispatch stock';
        if (byLabel)  byLabel.textContent  = isStage ? 'Staged by' : 'Dispatched by';
        if (btn) {
          btn.textContent = isStage ? 'Stage all' : 'Dispatch all';
          btn.className   = isStage ? 'btn btn-orange' : 'btn btn-danger';
        }
      });
    });
    // Set initial state
    const initial = document.querySelector('input[name="out-mode"]:checked');
    if (initial) initial.dispatchEvent(new Event('change'));
  }

  // ── Navigation ────────────────────────────────────────────────────────
  const VIEWS = ['dashboard','products','suppliers','orders','transit','transfers','shipment-history','changelog','in','out','stock-list','deployed','servicing','rma','totalloss','rmatldisp','stocktake','reports','lookup','history'];

  function showView(view) {
    VIEWS.forEach(v => { document.getElementById('v-' + v).style.display = v === view ? '' : 'none'; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.nav-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    // Keep dropdown toggle highlighted when a child view is active
    document.querySelectorAll('.nav-dropdown').forEach(dd => {
      const hasActive = dd.querySelector('.nav-dropdown-item.active');
      dd.querySelector('.nav-dropdown-toggle')?.classList.toggle('active', !!hasActive);
    });
    UI.hideAlert();
    if (view === 'dashboard')  UI.renderDashboard();
    if (view === 'products')   UI.renderProductList();
    if (view === 'suppliers')  UI.renderSupplierList();
    if (view === 'orders')     { UI.populateDataLists(); if (!ordRows.length) ordRows=[newOrdRow()]; renderOrdRows(); UI.renderOrderList(); }
    if (view === 'transit')    { UI.populateDataLists(); if (!trRows.length) trRows=[newTrRow()]; renderTrRows(); UI.renderTransitList(); }
    if (view === 'transfers')  UI.renderTransferList();
    if (view === 'stock-list') { UI.populateStockListFilters(); UI.renderStockBreakdown(); UI.renderStockList(); }
    if (view === 'deployed')   { UI.populateDeployedFilters(); UI.renderDeployed(); }
    if (view === 'servicing')  UI.renderServicing();
    if (view === 'rma')        UI.renderRMA();
    if (view === 'totalloss')  UI.renderTotalLoss();
    if (view === 'rmatldisp')  UI.renderRmaTlDispatched();
    if (view === 'reports')    { Reports.render(); Reports.renderWrittenOff(); }
    if (view === 'stocktake')  Audit.init();
    if (view === 'history')    { UI.populateCategoryFilters(); UI.renderHistory(); }
    if (view === 'shipment-history') UI.renderShipmentHistory();
    if (view === 'changelog')        renderChangelog();
    if (view === 'in')         { UI.populateDataLists(); if (!inRows.length) inRows=[newInRow()]; renderInRows(); }
    if (view === 'out')        { UI.populateDataLists(); if (!outRows.length) outRows=[newOutRow()]; renderOutRows(); _wireOutModeToggle(); }
    if (view === 'lookup')     setTimeout(() => document.getElementById('lookup-input').focus(), 50);
  }

  // Nav buttons (top-level)
  document.querySelectorAll('.nav-btn:not(.nav-dropdown-toggle)').forEach(btn => btn.addEventListener('click', () => showViewTracked(btn.dataset.view)));

  // In-page shortcuts to another view (e.g. Transfers → Stock Holding)
  document.querySelectorAll('[data-goto-view]').forEach(btn => btn.addEventListener('click', () => showViewTracked(btn.dataset.gotoView)));

  // Dropdown toggle
  document.querySelectorAll('.nav-dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = toggle.closest('.nav-dropdown');
      const isOpen = dd.classList.contains('open');
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
      if (!isOpen) dd.classList.add('open');
    });
  });

  // Dropdown items
  document.querySelectorAll('.nav-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
      showViewTracked(item.dataset.view);
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  });

  // ── Bindings ──────────────────────────────────────────────────────────
  function bind(id, ev, fn) { const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); }

  bind('btn-add-product',       'click', () => { inRows.push(newInRow()); renderInRows(); });
  bind('btn-add-order-product', 'click', () => { ordRows.push(newOrdRow()); renderOrdRows(); });
  bind('btn-add-transit-product','click',() => { trRows.push(newTrRow()); renderTrRows(); });
  bind('btn-add-out-product',   'click', () => { outRows.push(newOutRow()); renderOutRows(); });
  bind('btn-submit-in',         'click', submitStockIn);
  bind('btn-submit-product',    'click', submitProduct);
  bind('btn-cancel-product-edit','click', () => { clearProductForm(); });
  bind('btn-submit-supplier',   'click', submitSupplier);
  bind('btn-cancel-supplier-edit', 'click', () => { clearSupplierForm(); document.getElementById('btn-cancel-supplier-edit').style.display='none'; });
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
              <td style="padding:3px 6px;text-align:right;color:#9c6000">$${taxShare.toFixed(2)}</td>
              <td style="padding:3px 6px;text-align:right;color:#9c6000">$${taxPerUnit.toFixed(4)}</td>
              <td style="padding:3px 6px;text-align:right;font-weight:700;color:var(--aio-purple)">$${landed.toFixed(2)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
    }

    if (summary) {
      summary.style.display = '';
      summary.innerHTML = `
        <span style="margin-right:16px;">Subtotal: <strong>$${subtotal.toFixed(2)}</strong></span>
        <span style="margin-right:16px;color:#9c6000;">Tax: <strong>$${resolvedTax.toFixed(2)}</strong>${taxRateV > 0 ? ` (${taxRateV}%)` : ''}</span>
        <span style="color:var(--aio-purple);font-weight:700;">Total inc. tax: $${(subtotal + resolvedTax).toFixed(2)}</span>`;
    }
  }

  bind('btn-submit-order',      'click', submitOrder);
  bind('btn-submit-transit',    'click', submitTransit);
  bind('btn-submit-out',        'click', submitStockOut);
  bind('btn-export-inv',        'click', UI.exportInventoryCSV);
  bind('btn-export-deployed',   'click', UI.exportDeployedCSV);
  bind('btn-export-deployed-xlsx', 'click', UI.exportDeployedXLSX);
  bind('btn-export-hist',       'click', UI.exportHistoryCSV);

  bind('btn-rpt-run',      'click', Reports.render);
  bind('btn-rpt-export',   'click', Reports.exportAll);
  bind('btn-rpt-backup',   'click', UI.downloadBackup);

  bind('dep-pending-toggle',  'click', UI.togglePendingCollapse);
  bind('dep-pending-chevron', 'click', UI.togglePendingCollapse);
  bind('dep-search',         'input',  () => UI.renderDeployed());
  bind('dep-cat-filter',     'change', () => UI.renderDeployed());
  bind('dep-customer-filter','change', () => UI.renderDeployed());
  bind('dep-tab-unit',       'click',  () => UI.setDeployedTab('unit'));
  bind('dep-tab-restaurant', 'click',  () => UI.setDeployedTab('restaurant'));
  bind('dep-detail-back',    'click',  UI.closeRestaurantDetail);
  bind('dep-bucket-search',  'input',  () => UI.renderDeployed());
  bind('btn-lookup',            'click', () => UI.renderLookup(document.getElementById('lookup-input').value));

  bind('inv-search',       'input',  () => UI.renderStockList());
  bind('inv-cat-filter',   'change', () => UI.renderStockList());
  bind('inv-loc-filter',   'change', () => UI.renderStockList());
  bind('inv-status-filter','change', () => UI.renderStockList());

  bind('svc-search',      'input',  () => UI.renderServicing());
  bind('svc-flag-filter', 'change', () => UI.renderServicing());
  bind('rma-search',        'input',  () => UI.renderRMA());
  bind('rma-status-filter', 'change', () => UI.renderRMA());

  bind('tl-search',         'input',  () => UI.renderTotalLoss());
  bind('tl-status-filter',  'change', () => UI.renderTotalLoss());

  bind('rmatldisp-search',       'input',  () => UI.renderRmaTlDispatched());
  bind('rmatldisp-type-filter',  'change', () => UI.renderRmaTlDispatched());

  bind('hist-search',      'input',  () => UI.renderHistory());
  bind('hist-type-filter', 'change', () => UI.renderHistory());
  bind('hist-cat-filter',  'change', () => UI.renderHistory());
  bind('hist-date-from',   'change', () => UI.renderHistory());
  bind('hist-date-to',     'change', () => UI.renderHistory());

  const outField = document.getElementById('out-serial-field');
  if (outField) {
    outField.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===',') { e.preventDefault(); outField.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerialOut); outField.value=''; }});
    outField.addEventListener('paste', e => { e.preventDefault(); (e.clipboardData||window.clipboardData).getData('text').split(/[\n,\t]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerialOut); outField.value=''; });
    if (typeof Scanner !== 'undefined') Scanner.attachToInput(outField, addSerialOut);
  }

  const lookupField = document.getElementById('lookup-input');
  if (lookupField && typeof Scanner !== 'undefined') {
    Scanner.attachToInput(lookupField, (serial) => {
      lookupField.value = serial;
      UI.renderLookup(serial);
    });
  }
  bind('rpt-run',         'click', Reports.renderAll);
  bind('rpt-clear-dates', 'click', () => {
    document.getElementById('rpt-date-from').value = '';
    document.getElementById('rpt-date-to').value   = '';
    Reports.renderAll();
  });
  // Export buttons on each report section
  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => Reports.exportReport(btn.dataset.export));
  });

  bind('lookup-input','keydown', e => { if(e.key==='Enter') UI.renderLookup(document.getElementById('lookup-input').value); });

  // ── Helpers ───────────────────────────────────────────────────────────
  function _findRow(id) { return [...inRows, ...trRows].find(r => r.id === id); }
  function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── Auto-fill logged-in user into received-by / dispatched-by ─────────
  function autoFillUser() {
    const name = Auth.getName();
    if (!name) return;
    const fields = ['in-received-by', 'out-by', 'tr-received-by'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = name;
    });
  }

  // ── Track current view for real-time refresh ──────────────────────────
  function showViewTracked(view) {
    _currentView = view;
    showView(view);
    autoFillUser();
  }

  // ── Boot: gate everything behind Firebase Auth ────────────────────────
  document.getElementById('alert-box').textContent = '⏳ Loading...';
  document.getElementById('alert-box').className   = 'alert alert-success show';

  inRows = [newInRow()];
  trRows = [newTrRow()];
  outRows = [newOutRow()];

  Auth.onReady((isLoggedIn) => {
    document.getElementById('alert-box').classList.remove('show');

    if (!isLoggedIn) {
      // Show login screen — replaces entire page
      AuthUI.showLoginScreen();
      // When auth state changes to logged in, reload
      return;
    }

    // User is logged in — inject user bar into header
    AuthUI.injectUserBar();

    // Wait for DB then render
    DB.onReady(() => {
      // Apply view-only restrictions if not editor/admin
      AuthUI.applyRoleRestrictions();
      UI.initSmartSelects();
      showViewTracked('dashboard');
    });
  });

})();
