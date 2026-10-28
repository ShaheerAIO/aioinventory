/**
 * forms/stock-out.js — Stock Out form (dispatch / stage units to a customer)
 */
(() => {
  const { esc, bind } = Forms._;

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

    // Location options: every known warehouse, not just the ones holding this
    // product, so a warehouse with no stock of it reads as "(0 in stock)"
    // instead of going missing from the list. Empty ones are disabled — there
    // is nothing there to dispatch.
    const stockedLocations = row.product
      ? Object.values(map).filter(v => v.product === row.product && v.inStock.size > 0).map(v => v.location)
      : [];
    const locationsForProduct = row.product
      ? [...new Set([...Inventory.getLocations(), ...stockedLocations])].sort()
      : [];
    const locationOptions = locationsForProduct.map(l => {
      const n = map[row.product + '||' + l]?.inStock.size || 0;
      return `<option value="${esc(l)}"${row.location === l ? ' selected' : ''}${n === 0 ? ' disabled' : ''}>${esc(l)} (${n} in stock)</option>`;
    }).join('');

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
      countEl.style.color = mismatchMsg ? '#D5381D' : '';
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
    HubspotPicker.renderDocs(document.getElementById('out-hubspot-docs'), '');
    outRows = [newOutRow()];
    renderOutRows();
    Forms.autoFillUser();
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
      const outSerials = outRows.flatMap(r => r.serials);  // clearStockOut() empties outRows
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
      // First time we've seen this account name — get it linked to a HubSpot
      // company now, while whoever typed it still knows which one it is. The
      // stock movement is already saved at this point, so the picker repeats it
      // back: the form behind it has been cleared and the toast is covered.
      HubspotPicker.promptIfUnmapped(customer,
        `${totalUnits} unit${totalUnits!==1?'s':''} ${isStage ? 'staged for deployment to' : 'dispatched to'} "${customer}" — saved.`);
      // Offer to register the hardware in the AIO dashboard while it's fresh
      DeviceMap.nudge(customer, outSerials);
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

  function showStockOut() { if (!outRows.length) outRows=[newOutRow()]; renderOutRows(); _wireOutModeToggle(); }

  bind('btn-add-out-product',   'click', () => { outRows.push(newOutRow()); renderOutRows(); });
  bind('btn-submit-out',        'click', submitStockOut);

  // Show the customer's HubSpot quotes and invoices as soon as it's entered —
  // they say what to pick, so they need to be up before anything is scanned.
  let _docsTimer = null;
  const _showDocs = () => HubspotPicker.renderDocs(document.getElementById('out-hubspot-docs'), document.getElementById('out-customer').value);
  bind('out-customer', 'input',  () => { clearTimeout(_docsTimer); _docsTimer = setTimeout(_showDocs, 400); });
  bind('out-customer', 'change', () => { clearTimeout(_docsTimer); _showDocs(); });

  outRows = [newOutRow()];

  Object.assign(Forms, { showStockOut });
})();
