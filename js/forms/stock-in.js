/**
 * forms/stock-in.js — Stock In form
 */
(() => {
  const { buildProductRowCard, renderSerialRows, wireSerialField, wireProductSelect, syncRowFields, bind } = Forms._;

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

  function showStockIn() { if (!inRows.length) inRows=[newInRow()]; renderInRows(); }

  bind('btn-add-product',       'click', () => { inRows.push(newInRow()); renderInRows(); });
  bind('btn-submit-in',         'click', submitStockIn);

  inRows = [newInRow()];

  Object.assign(Forms, { showStockIn });
  Object.assign(Forms._, { getInRows: () => inRows });
})();
