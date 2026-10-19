/**
 * forms/shared.js — Shared pieces of the data-entry forms (Stock In, In Transit, Orders, Stock Out):
 * the product-row card, serial rows, product dropdown wiring, and user auto-fill.
 * Defines Forms. Each form file attaches its show…() to Forms and its own button bindings;
 * helpers shared between form files live on Forms._.
 */
const Forms = { _: {} };
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

  // ── Helpers ───────────────────────────────────────────────────────────
  function _findRow(id) { return [...Forms._.getInRows(), ...Forms._.getTrRows()].find(r => r.id === id); }
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

  function bind(id, ev, fn) { const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); }

  Object.assign(Forms, { autoFillUser });
  Object.assign(Forms._, { buildProductRowCard, renderSerialRows, wireSerialField, wireProductSelect, syncRowFields, esc, bind });
})();
