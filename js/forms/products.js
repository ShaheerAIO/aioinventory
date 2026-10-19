/**
 * forms/products.js — Products form (add / edit a product record)
 */
(() => {
  const { bind } = Forms._;

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

  bind('btn-submit-product',    'click', submitProduct);
  bind('btn-cancel-product-edit','click', () => { clearProductForm(); });
})();
