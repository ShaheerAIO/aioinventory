/**
 * ui/products.js — Products view
 */
(() => {
  const { esc } = UI._;

  // ── Products ──────────────────────────────────────────────────────────
  function renderProductList() {
    const records   = DB.getProductRecords();
    const container = document.getElementById('product-list');
    if (!container) return;

    // Merge: all hardcoded products + any in movements + any DB records
    // Exclude "Other"
    const recordMap  = new Map(records.map(r => [r.name, r]));
    const allNames   = new Set([
      ...Inventory.PRODUCTS.map(p => p.name).filter(n => n !== 'Other'),
      ...Inventory.getProducts().filter(n => n !== 'Other'),
    ]);

    const allProducts = [...allNames].sort().map(name => {
      const hardcoded = Inventory.PRODUCTS.find(p => p.name === name);
      const record    = recordMap.get(name);
      return {
        name,
        category:         record?.category  || hardcoded?.category || '',
        supplier:         record?.supplier  || '',
        defaultThreshold: record?.defaultThreshold ?? null,
        notes:            record?.notes     || '',
        serialEditable:   record?.serialEditable ?? hardcoded?.serialEditable ?? false,
        id:               record?.id        || null,
        _stub:            !record,
      };
    });

    if (!allProducts.length) {
      container.innerHTML = '<div class="empty" style="padding:1.5rem">No products yet</div>';
      return;
    }

    const fillForm = (p) => {
      document.getElementById('prod-name').value             = p.name;
      document.getElementById('prod-category').value         = p.category || '';
      document.getElementById('prod-supplier').value         = p.supplier || '';
      document.getElementById('prod-threshold').value        = p.defaultThreshold ?? '';
      document.getElementById('prod-notes').value            = p.notes || '';
      document.getElementById('prod-serial-editable').checked = !!p.serialEditable;
      document.getElementById('prod-edit-id').value          = p.id || '';
      document.getElementById('btn-submit-product').textContent = p.id ? 'Update product' : 'Add product';
      const cancelBtn = document.getElementById('btn-cancel-product-edit');
      if (cancelBtn) cancelBtn.style.display = p.id ? 'inline-flex' : 'none';
      document.getElementById('prod-name').focus();
      document.getElementById('product-form-panel').scrollIntoView({ behavior: 'smooth' });
    };

    container.innerHTML = allProducts.map(p => {
      const threshold = p.defaultThreshold != null ? p.defaultThreshold : DB.getThreshold(p.name + '||');
      if (p._stub) {
        return `<div class="supplier-card supplier-card-stub" id="prod-card-stub-${esc(p.name)}">
          <div class="supplier-card-header">
            <div>
              <div class="supplier-card-name">${esc(p.name)}</div>
              <div style="font-size:11px;color:var(--text-hint);margin-top:2px;">
                ${p.category ? `<span class="cat-badge">${esc(p.category)}</span>` : ''} No details added yet
              </div>
            </div>
            <div class="supplier-card-actions">
              <button class="btn btn-orange btn-xs" data-edit-product="${esc(p.name)}">Edit / Add details</button>
            </div>
          </div>
          <div class="supplier-card-stats">
            <div class="supplier-stat"><div class="supplier-stat-label">Stock alert at</div><div class="supplier-stat-val">${threshold}</div></div>
          </div>
        </div>`;
      }
      return `<div class="supplier-card" id="prod-card-${p.id}">
        <div class="supplier-card-header">
          <div>
            <div class="supplier-card-name">${esc(p.name)}</div>
            <div style="margin-top:3px;">
              ${p.category ? `<span class="cat-badge">${esc(p.category)}</span>` : ''}
              ${p.supplier ? `<span style="font-size:11px;color:var(--text-muted);margin-left:6px;">from ${esc(p.supplier)}</span>` : ''}
            </div>
          </div>
          <div class="supplier-card-actions">
            <button class="btn btn-ghost btn-xs" data-edit-product-id="${p.id}">Edit</button>
            <button class="btn btn-ghost btn-xs btn-danger-ghost" data-delete-product="${p.id}">Remove</button>
          </div>
        </div>
        ${p.notes ? `<div class="supplier-card-notes">${esc(p.notes)}</div>` : ''}
        <div class="supplier-card-stats">
          <div class="supplier-stat"><div class="supplier-stat-label">Category</div><div class="supplier-stat-val" style="font-size:12px;">${esc(p.category||'—')}</div></div>
          <div class="supplier-stat"><div class="supplier-stat-label">Supplier</div><div class="supplier-stat-val" style="font-size:12px;">${esc(p.supplier||'—')}</div></div>
          <div class="supplier-stat"><div class="supplier-stat-label">Stock alert at</div><div class="supplier-stat-val">${threshold}</div></div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-edit-product]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.editProduct;
        const p    = allProducts.find(x => x.name === name);
        if (p) fillForm(p);
      });
    });
    container.querySelectorAll('[data-edit-product-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rec = DB.getProductRecords().find(r => r.id == btn.dataset.editProductId);
        if (rec) fillForm({ ...rec, _stub: false });
      });
    });
    container.querySelectorAll('[data-delete-product]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rec = DB.getProductRecords().find(r => r.id == btn.dataset.deleteProduct);
        if (rec && confirm(`Remove product record for "${rec.name}"?\nThe product will remain in historical data.`)) {
          DB.removeProductRecord(rec.id);
          Inventory.refreshProducts();
          renderProductList();
        }
      });
    });
  }

  Object.assign(UI, { renderProductList });
})();
