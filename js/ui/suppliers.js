/**
 * ui/suppliers.js — Suppliers view
 */
(() => {
  const { esc } = UI._;

  // ── Suppliers ──────────────────────────────────────────────────────────
  function renderSupplierList() {
    const records   = DB.getSupplierRecords();
    const orders    = DB.getOrders();
    const container = document.getElementById('supplier-list');
    if (!container) return;

    // Merge full records with historical supplier names that have no record yet
    const EXCLUDE = ['recalled from deployment'];
    const recordNames = new Set(records.map(s => s.name.toLowerCase()));
    const historical  = Inventory.getSuppliers()
      .filter(name => !recordNames.has(name.toLowerCase()) && !EXCLUDE.includes(name.toLowerCase()))
      .map(name => ({ id: null, name, _stub: true }));

    const allSuppliers = [
      ...records.map(s => ({ ...s, _stub: false })),
      ...historical,
    ].sort((a, b) => a.name.localeCompare(b.name));

    const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';

    if (!allSuppliers.length) {
      container.innerHTML = '<div class="empty" style="padding:1.5rem">No suppliers yet</div>';
      return;
    }

    const fillForm = (name, sup) => {
      const fields = ['name','contactName','email','phone','website','address','paymentTerms','leadTimeDays','currency','notes'];
      fields.forEach(f => { const el = document.getElementById('supp-' + f); if (el) el.value = (sup && sup[f]) || ''; });
      document.getElementById('supp-name').value = name;
      document.getElementById('supp-edit-id').value = sup?.id || '';
      document.getElementById('btn-submit-supplier').textContent = sup?.id ? 'Update supplier' : 'Add supplier';
      const cancelBtn = document.getElementById('btn-cancel-supplier-edit');
      if (cancelBtn) cancelBtn.style.display = sup?.id ? 'inline-flex' : 'none';
      document.getElementById('supp-name').focus();
      const scrollTarget = document.getElementById('supplier-form-panel');
      if (scrollTarget) scrollTarget.scrollIntoView({ behavior: 'smooth' });
    };

    container.innerHTML = allSuppliers.map(s => {
      const supplierOrders = orders.filter(o => o.supplier === s.name);
      const orderCount     = supplierOrders.length;
      const totalSpend     = supplierOrders.reduce((a, o) =>
        a + o.products.reduce((b, p) => b + (p.qty * (p.unitCost || 0)), 0), 0);

      if (s._stub) {
        return `<div class="supplier-card supplier-card-stub" id="supp-card-stub-${esc(s.name)}">
          <div class="supplier-card-header">
            <div>
              <div class="supplier-card-name">${esc(s.name)}</div>
              <div style="font-size:11px;color:var(--text-hint);margin-top:2px;">No details added yet</div>
            </div>
            <div class="supplier-card-actions">
              <button class="btn btn-orange btn-xs" data-add-details="${esc(s.name)}">+ Add details</button>
            </div>
          </div>
          <div class="supplier-card-stats">
            <div class="supplier-stat"><div class="supplier-stat-label">Total orders</div><div class="supplier-stat-val">${orderCount}</div></div>
            <div class="supplier-stat"><div class="supplier-stat-label">Total spend</div><div class="supplier-stat-val">${fmt$(totalSpend)}</div></div>
          </div>
        </div>`;
      }

      return `<div class="supplier-card" id="supp-card-${s.id}">
        <div class="supplier-card-header">
          <div class="supplier-card-name">${esc(s.name)}</div>
          <div class="supplier-card-actions">
            <button class="btn btn-ghost btn-xs" data-edit-supplier="${s.id}">Edit</button>
            <button class="btn btn-ghost btn-xs btn-danger-ghost" data-delete-supplier="${s.id}">Remove</button>
          </div>
        </div>
        <div class="supplier-card-meta">
          ${s.contactName ? `<span>👤 ${esc(s.contactName)}</span>` : ''}
          ${s.email       ? `<span>✉ <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></span>` : ''}
          ${s.phone       ? `<span>📞 ${esc(s.phone)}</span>` : ''}
          ${s.website     ? `<span>🌐 <a href="${esc(s.website)}" target="_blank">${esc(s.website)}</a></span>` : ''}
        </div>
        ${s.address ? `<div class="supplier-card-address">📍 ${esc(s.address)}</div>` : ''}
        ${s.notes   ? `<div class="supplier-card-notes">${esc(s.notes)}</div>` : ''}
        <div class="supplier-card-stats">
          <div class="supplier-stat"><div class="supplier-stat-label">Total orders</div><div class="supplier-stat-val">${orderCount}</div></div>
          <div class="supplier-stat"><div class="supplier-stat-label">Total spend</div><div class="supplier-stat-val">${fmt$(totalSpend)}</div></div>
          ${s.paymentTerms ? `<div class="supplier-stat"><div class="supplier-stat-label">Payment terms</div><div class="supplier-stat-val">${esc(s.paymentTerms)}</div></div>` : ''}
          ${s.leadTimeDays ? `<div class="supplier-stat"><div class="supplier-stat-label">Lead time</div><div class="supplier-stat-val">${esc(s.leadTimeDays)} days</div></div>` : ''}
          ${s.currency     ? `<div class="supplier-stat"><div class="supplier-stat-label">Currency</div><div class="supplier-stat-val">${esc(s.currency)}</div></div>` : ''}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-add-details]').forEach(btn => {
      btn.addEventListener('click', () => fillForm(btn.dataset.addDetails, null));
    });
    container.querySelectorAll('[data-edit-supplier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sup = DB.getSupplierRecords().find(s => s.id == btn.dataset.editSupplier);
        if (sup) fillForm(sup.name, sup);
      });
    });
    container.querySelectorAll('[data-delete-supplier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sup = DB.getSupplierRecords().find(s => s.id == btn.dataset.deleteSupplier);
        if (sup && confirm(`Remove supplier "${sup.name}"?`)) {
          DB.removeSupplier(sup.id);
          renderSupplierList();
          UI.refreshSmartSelects();
        }
      });
    });
  }

  Object.assign(UI, { renderSupplierList });
})();
