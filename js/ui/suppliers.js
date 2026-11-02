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

    const q = (document.getElementById('supp-search')?.value || '').trim().toLowerCase();
    const canEdit = Auth.canEdit();
    const addBtn = document.getElementById('btn-add-supplier');
    if (addBtn) addBtn.style.display = canEdit ? '' : 'none';

    const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
    const stats = s => {
      const so = orders.filter(o => o.supplier === s.name);
      return { count: so.length, spend: so.reduce((a, o) => a + o.products.reduce((b, p) => b + (p.qty * (p.unitCost || 0)), 0), 0) };
    };
    const lead = s => s.leadTimeDays ? `${s.leadTimeDays} days` : '';
    const rows = allSuppliers.filter(s => !q ||
      [s.name, s.contactName, s.email, s.phone, s.currency, s.paymentTerms, lead(s)].join(' ').toLowerCase().includes(q));

    const count = document.getElementById('supp-count');
    if (count) count.textContent = q ? `${rows.length} of ${allSuppliers.length}` : String(allSuppliers.length);

    if (!rows.length) {
      container.innerHTML = `<tr><td colspan="10" class="cat-empty">${q ? `No suppliers match "${esc(q)}"` : 'No suppliers yet'}</td></tr>`;
      return;
    }

    container.innerHTML = rows.map(s => `<tr>
      <td>${esc(s.name)}${s._stub ? '<span class="cat-default">No details yet</span>' : ''}</td>
      <td>${esc(s.contactName || '—')}</td>
      <td>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '—'}</td>
      <td>${esc(s.phone || '—')}</td>
      <td>${esc(s.currency || '—')}</td>
      <td>${esc(s.paymentTerms || '—')}</td>
      <td>${esc(lead(s) || '—')}</td>
      <td class="cat-num">${stats(s).count}</td>
      <td class="cat-num">${fmt$(stats(s).spend)}</td>
      <td class="cat-actions">${canEdit ? (s._stub
        ? `<button class="btn btn-ghost btn-xs" data-add-details="${esc(s.name)}">Add details</button>`
        : `<button class="btn btn-ghost btn-xs" data-edit-supplier="${s.id}">Edit</button>
           <button class="btn btn-ghost btn-xs btn-danger-ghost" data-delete-supplier="${s.id}">Remove</button>`) : ''}</td>
    </tr>`).join('');

    container.querySelectorAll('[data-add-details]').forEach(btn => {
      btn.addEventListener('click', () => openSupplierForm({ name: btn.dataset.addDetails }));
    });
    container.querySelectorAll('[data-edit-supplier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sup = DB.getSupplierRecords().find(s => s.id == btn.dataset.editSupplier);
        if (sup) openSupplierForm(sup);
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

  // Show the form panel, filled for sup (or blank for a new supplier)
  function openSupplierForm(sup) {
    ['name','contactName','email','phone','website','address','paymentTerms','leadTimeDays','currency','notes'].forEach(f => {
      const el = document.getElementById('supp-' + f); if (el) el.value = (sup && sup[f]) || '';
    });
    document.getElementById('supp-edit-id').value = sup?.id || '';
    document.getElementById('btn-submit-supplier').textContent = sup?.id ? 'Update supplier' : 'Add supplier';
    const panel = document.getElementById('supplier-form-panel');
    panel.style.display = '';
    document.getElementById('supp-name').focus();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeSupplierForm() {
    const panel = document.getElementById('supplier-form-panel');
    if (panel) panel.style.display = 'none';
  }

  // Start closed on every visit: close when the view is hidden (re-renders after a save don't touch it)
  const suppView = document.getElementById('v-suppliers');
  if (suppView) new MutationObserver(() => { if (suppView.style.display === 'none') closeSupplierForm(); })
    .observe(suppView, { attributes: true, attributeFilter: ['style', 'class'] });
  document.getElementById('supp-search')?.addEventListener('input', renderSupplierList);
  document.getElementById('btn-add-supplier')?.addEventListener('click', () => openSupplierForm(null));

  Object.assign(UI, { renderSupplierList, openSupplierForm, closeSupplierForm });
})();
