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

    const q = (document.getElementById('prod-search')?.value || '').trim().toLowerCase();
    const canEdit = Auth.canEdit();
    const addBtn = document.getElementById('btn-add-product');
    if (addBtn) addBtn.style.display = canEdit ? '' : 'none';

    const rows = allProducts.map(p => ({
      p,
      threshold: p.defaultThreshold != null ? p.defaultThreshold : DB.getThreshold(p.name + '||'),
    })).filter(({ p, threshold }) =>
      !q || [p.name, p.category, p.supplier, threshold, p.notes].join(' ').toLowerCase().includes(q));

    const count = document.getElementById('prod-count');
    if (count) count.textContent = q ? `${rows.length} of ${allProducts.length}` : String(allProducts.length);

    if (!rows.length) {
      container.innerHTML = `<tr><td colspan="7" class="cat-empty">${q ? `No products match "${esc(q)}"` : 'No products yet'}</td></tr>`;
      return;
    }

    container.innerHTML = rows.map(({ p, threshold }) => `<tr>
      <td>${esc(p.name)}${p._stub ? '<span class="cat-default">Default</span>' : ''}</td>
      <td>${p.category ? `<span class="cat-badge">${esc(p.category)}</span>` : '—'}</td>
      <td>${esc(p.supplier || '—')}</td>
      <td>${threshold}</td>
      <td>${p.serialEditable ? 'Yes' : '—'}</td>
      <td class="cat-notes" title="${esc(p.notes)}">${esc(p.notes || '—')}</td>
      <td class="cat-actions">${canEdit ? (p._stub
        ? `<button class="btn btn-ghost btn-xs" data-edit-product="${esc(p.name)}">Edit</button>`
        : `<button class="btn btn-ghost btn-xs" data-edit-product-id="${p.id}">Edit</button>
           <button class="btn btn-ghost btn-xs btn-danger-ghost" data-delete-product="${p.id}">Remove</button>`) : ''}</td>
    </tr>`).join('');

    container.querySelectorAll('[data-edit-product]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = allProducts.find(x => x.name === btn.dataset.editProduct);
        if (p) openProductForm(p);
      });
    });
    container.querySelectorAll('[data-edit-product-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rec = DB.getProductRecords().find(r => r.id == btn.dataset.editProductId);
        if (rec) openProductForm({ ...rec, _stub: false });
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

  // Show the form panel, filled for p (or blank for a new product)
  function openProductForm(p) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('prod-name', p?.name || '');
    set('prod-category', p?.category || '');
    set('prod-supplier', p?.supplier || '');
    set('prod-threshold', p?.defaultThreshold ?? '');
    set('prod-notes', p?.notes || '');
    set('prod-edit-id', p?.id || '');
    document.getElementById('prod-serial-editable').checked = !!p?.serialEditable;
    document.getElementById('btn-submit-product').textContent = p?.id ? 'Update product' : 'Save product';
    const panel = document.getElementById('product-form-panel');
    panel.style.display = '';
    document.getElementById('prod-name').focus();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeProductForm() {
    const panel = document.getElementById('product-form-panel');
    if (panel) panel.style.display = 'none';
  }

  // Start closed on every visit: close when the view is hidden (re-renders after a save don't touch it)
  const prodView = document.getElementById('v-products');
  if (prodView) new MutationObserver(() => { if (prodView.style.display === 'none') closeProductForm(); })
    .observe(prodView, { attributes: true, attributeFilter: ['style', 'class'] });
  document.getElementById('prod-search')?.addEventListener('input', renderProductList);
  document.getElementById('btn-add-product')?.addEventListener('click', () => openProductForm(null));

  Object.assign(UI, { renderProductList, openProductForm, closeProductForm });
})();
