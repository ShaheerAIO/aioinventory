/**
 * forms/transit.js — In Transit form (register an inbound shipment)
 */
(() => {
  const { buildProductRowCard, renderSerialRows, wireSerialField, wireProductSelect, syncRowFields, bind } = Forms._;

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

  function showTransitForm() { if (!trRows.length) trRows=[newTrRow()]; renderTrRows(); }

  bind('btn-add-transit-product','click',() => { trRows.push(newTrRow()); renderTrRows(); });
  bind('btn-submit-transit',    'click', submitTransit);

  trRows = [newTrRow()];

  Object.assign(Forms, { showTransitForm });
  Object.assign(Forms._, { getTrRows: () => trRows });
})();
