/**
 * ui/core.js — The UI namespace plus helpers shared by every file in js/ui/: alerts, escaping/date
 * formatting, datalists, CSV download, backup, and SmartSelect.
 * Load this first. Each view file attaches its public renderers to UI and any helper another
 * view file needs to UI._ (looked up at call time, so view files can load in any order).
 */
const UI = { _: {} };
(() => {
  let _alertTimer = null;

  function showAlert(msg, type = 'success') {
    const b = document.getElementById('alert-box');
    b.textContent = msg;
    b.className = 'alert ' + (type === 'error' ? 'alert-error' : 'alert-success');
    b.classList.add('show');
    clearTimeout(_alertTimer);
    _alertTimer = setTimeout(() => b.classList.remove('show'), 5000);
  }
  function hideAlert() { document.getElementById('alert-box').classList.remove('show'); }

  // ── Datalists ─────────────────────────────────────────────────────────
  function populateDataLists() {
    const set = (id, items) => { const el = document.getElementById(id); if (el) el.innerHTML = items.map(v => `<option value="${esc(v)}">`).join(''); };
    set('loc-list',      Inventory.getLocations());
    set('tr-loc-list',   Inventory.getLocations());
    set('customer-list', Inventory.getCustomers());
    // PO number autocomplete — both forms share the same PO list
    const poNums = DB.getPONumbers();
    set('po-list',    poNums);
    set('po-list-in', poNums);
  }

  function _dlCSV(rows, name) {
    const csv = rows.map(r => r.map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function downloadBackup() {
    const json = DB.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'aio_inventory_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDate(iso)     { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
  function fmtDateFull(iso) { return new Date(iso).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }
  function fmtDateTimeISO(iso) { const d=new Date(iso), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

  // ── Condition flag helpers ─────────────────────────────────────────────
  function _conditionLabel(c) {
    return { 'used': 'USED', 'faulty': '⚠ FAULTY', 'needs-testing': '🔬 TESTING', 'rma': '⛔ RMA', 'fail-tl': '🗑 TL' }[c] || c.toUpperCase();
  }

  // ── SmartSelect ────────────────────────────────────────────────────────
  // Replaces a plain <input> with a styled dropdown of known values + "Add new"
  function SmartSelect(inputId, getOptions, saveNew) {
    const input = document.getElementById(inputId);
    if (!input || input._ssInit) return;
    input._ssInit = true;

    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.display = 'none';

    const select = document.createElement('select');
    select.className = 'fi ss-select';
    wrap.appendChild(select);

    const addRow = document.createElement('div');
    addRow.className = 'ss-add-row';
    addRow.innerHTML = `
      <input class="fi ss-new-input" placeholder="Type new value..." autocomplete="off" />
      <button class="btn btn-primary btn-sm ss-confirm-btn">Add</button>
      <button class="btn btn-ghost btn-sm ss-cancel-btn">✕</button>`;
    wrap.appendChild(addRow);
    hideAddRow();

    function hideAddRow() { addRow.style.display = 'none'; }
    function showAddRow() {
      addRow.style.display = 'flex';
      addRow.querySelector('.ss-new-input').value = '';
      addRow.querySelector('.ss-new-input').focus();
    }

    function refresh(selectVal) {
      const opts = getOptions();
      const cur  = selectVal !== undefined ? selectVal : (input.value || '');
      select.innerHTML =
        `<option value="">— Select —</option>` +
        opts.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('') +
        `<option value="__add__">＋ Add new...</option>`;
      if (cur && opts.includes(cur)) {
        select.value = cur;
        input.value  = cur;
      }
    }

    refresh();

    select.addEventListener('change', () => {
      if (select.value === '__add__') {
        showAddRow();
      } else {
        hideAddRow();
        input.value = select.value;
      }
    });

    addRow.querySelector('.ss-confirm-btn').addEventListener('click', () => {
      const val = addRow.querySelector('.ss-new-input').value.trim();
      if (!val) return;
      saveNew(val);
      hideAddRow();
      refresh(val);
      input.value = val;
    });

    addRow.querySelector('.ss-cancel-btn').addEventListener('click', () => {
      hideAddRow();
      refresh(input.value);
    });

    addRow.querySelector('.ss-new-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') addRow.querySelector('.ss-confirm-btn').click();
      if (e.key === 'Escape') addRow.querySelector('.ss-cancel-btn').click();
    });

    return { refresh: () => refresh() };
  }

  // Init all smart selects — called once after DB is ready
  function initSmartSelects() {
    SmartSelect('in-supplier',  Inventory.getSuppliers,  DB.addCustomSupplier);
    SmartSelect('tr-supplier',  Inventory.getSuppliers,  DB.addCustomSupplier);
    SmartSelect('ord-supplier', Inventory.getSuppliers,  DB.addCustomSupplier);
    SmartSelect('prod-supplier',Inventory.getSuppliers,  DB.addCustomSupplier);

    // Products form — category select and product name datalist
    const prodCat = document.getElementById('prod-category');
    if (prodCat && prodCat.options.length <= 1) {
      Inventory.CATEGORIES.forEach(c => {
        const opt = document.createElement('option'); opt.value = c; opt.textContent = c; prodCat.appendChild(opt);
      });
    }
    const prodNameList = document.getElementById('prod-name-list');
    if (prodNameList) {
      prodNameList.innerHTML = Inventory.PRODUCTS.filter(p => p.name !== 'Other')
        .map(p => `<option value="${p.name}">`).join('');
    }
    SmartSelect('in-loc',       Inventory.getLocations,  DB.addCustomLocation);
    SmartSelect('tr-loc',       Inventory.getLocations,  DB.addCustomLocation);
  }

  // Refresh all smart selects (called after stock in/transit so new values appear)
  function refreshSmartSelects() {
    ['in-supplier','tr-supplier','ord-supplier','prod-supplier','in-loc','tr-loc'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input._ssInit) {
        const wrap = input.parentNode;
        const select = wrap.querySelector('.ss-select');
        if (select) {
          const opts = id.includes('supplier') ? Inventory.getSuppliers() : Inventory.getLocations();
          const cur = input.value;
          select.innerHTML =
            `<option value="">— Select —</option>` +
            opts.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('') +
            `<option value="__add__">＋ Add new...</option>`;
          if (cur) select.value = cur;
        }
      }
    });
  }

  Object.assign(UI, { showAlert, hideAlert, populateDataLists, downloadBackup, initSmartSelects, refreshSmartSelects });
  Object.assign(UI._, { showAlert, populateDataLists, _dlCSV, esc, fmtDate, fmtDateFull, fmtDateTimeISO, _conditionLabel, SmartSelect, refreshSmartSelects });
})();
