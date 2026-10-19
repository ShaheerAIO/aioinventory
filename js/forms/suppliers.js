/**
 * forms/suppliers.js — Suppliers form (add / edit a supplier)
 */
(() => {
  const { bind } = Forms._;

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

  bind('btn-submit-supplier',   'click', submitSupplier);
  bind('btn-cancel-supplier-edit', 'click', () => { clearSupplierForm(); document.getElementById('btn-cancel-supplier-edit').style.display='none'; });
})();
