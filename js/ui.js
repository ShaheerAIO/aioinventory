/**
 * ui.js — DOM rendering helpers
 */
const UI = (() => {
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

  // ── Dashboard ─────────────────────────────────────────────────────────
  function renderDashboard() {
    const stats    = Inventory.getStats();
    const lowItems = Inventory.getLowStockItems();
    const { movements } = DB.getData();
    const recent = [...movements].reverse().slice(0, 10);
    const byProduct = Inventory.getStockByProduct();

    document.getElementById('stats-row').innerHTML = `
      <div class="stat"><div class="stat-label">In stock</div><div class="stat-val green">${stats.inStock}</div></div>
      <div class="stat"><div class="stat-label">In transit</div><div class="stat-val transit">${stats.inTransit}</div></div>
      <div class="stat"><div class="stat-label">Deployed</div><div class="stat-val deployed">${stats.deployed}</div></div>
      <div class="stat"><div class="stat-label">Total received</div><div class="stat-val">${stats.totalIn}</div></div>
      <div class="stat"><div class="stat-label">Product lines</div><div class="stat-val">${stats.productLines}</div></div>
      <div class="stat"><div class="stat-label">Low stock</div><div class="stat-val amber">${stats.lowCount}</div></div>`;

    const lowBox = document.getElementById('low-alert-box');
    if (lowItems.length > 0) {
      lowBox.style.display = 'block';
      lowBox.textContent = `⚠ Low stock: ${lowItems.map(v => `${v.product} (${v.inStock.size})`).join(', ')}`;
    } else { lowBox.style.display = 'none'; }

    // Stock by product — with per-product condition breakdown
    const maxStock = Math.max(...byProduct.map(p => p.inStock), 1);
    const grandTotalCost  = byProduct.reduce((a, p) => a + p.totalCost, 0);
    const grandTotalUnits = byProduct.reduce((a, p) => a + p.inStock + p.inTransit, 0);
    const fmt$ = n => n != null && n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '<span style="color:var(--text-hint)">—</span>';

    // Build per-product condition counts from all in-stock serial rows
    const condMap = {};
    Inventory.getAllSerialRows().filter(r => r.status === 'in-stock').forEach(r => {
      if (!condMap[r.product]) condMap[r.product] = { working: 0, testing: 0, faulty: 0, rma: 0, tl: 0 };
      if      (r.condition === 'rma')           condMap[r.product].rma++;
      else if (r.condition === 'fail-tl')       condMap[r.product].tl++;
      else if (r.condition === 'needs-testing') condMap[r.product].testing++;
      else if (r.condition === 'faulty')        condMap[r.product].faulty++;
      else if (!r.condition)                    condMap[r.product].working++;
      // 'used' intentionally not counted in any bucket — informational only
    });
    const grandWorking = Object.values(condMap).reduce((a, c) => a + c.working, 0);
    const grandTesting = Object.values(condMap).reduce((a, c) => a + c.testing, 0);
    const grandFaulty  = Object.values(condMap).reduce((a, c) => a + c.faulty,  0);
    const grandRMA     = Object.values(condMap).reduce((a, c) => a + c.rma, 0);
    const grandTL      = Object.values(condMap).reduce((a, c) => a + c.tl, 0);

    document.getElementById('dash-product-stock').innerHTML = byProduct.length
      ? `<table class="product-stock-table">
          <thead><tr>
            <th style="width:20%">Product</th>
            <th style="width:11%">Category</th>
            <th style="width:7%" title="Total units in stock">Total</th>
            <th style="width:8%;color:#1a7a3c" title="Units ready to deploy">✅ Working</th>
            <th style="width:8%;color:#1a5080" title="Units in needs-testing">🔬 Testing</th>
            <th style="width:7%;color:#7a5000" title="Units flagged faulty">⚠ Faulty</th>
            <th style="width:7%;color:#9c2a00" title="Units for return">⛔ RMA</th>
            <th style="width:6%;color:#666" title="Written off">🗑 TL</th>
            <th style="width:7%">In transit</th>
            <th style="width:8%">Avg cost</th>
            <th style="width:11%">Total value</th>
          </tr></thead>
          <tbody>
            ${byProduct.map(p => {
              const c = condMap[p.product] || { working: 0, rma: 0, tl: 0 };
              return `<tr>
              <td style="font-weight:500">${esc(p.product)}</td>
              <td><span class="cat-badge">${esc(p.category || '—')}</span></td>
              <td>
                <div class="stock-bar-wrap">
                  <div class="stock-bar"><div class="stock-bar-fill" style="width:${Math.round(p.inStock / maxStock * 100)}%"></div></div>
                  <span style="font-size:13px;font-weight:600;color:var(--success-text)">${p.inStock}</span>
                </div>
              </td>
              <td><span class="cond-inline cond-inline-working">${c.working}</span></td>
              <td>${c.testing > 0 ? `<span class="cond-inline cond-inline-testing">${c.testing}</span>` : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${c.faulty  > 0 ? `<span class="cond-inline cond-inline-faulty">${c.faulty}</span>`   : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${c.rma     > 0 ? `<span class="cond-inline cond-inline-rma">${c.rma}</span>`         : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${c.tl      > 0 ? `<span class="cond-inline cond-inline-tl">${c.tl}</span>`           : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p.inTransit > 0 ? `<span class="transit-pill">✈ ${p.inTransit}</span>` : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td style="font-size:12px">${fmt$(p.avgCost)}</td>
              <td style="font-size:12px;font-weight:600;color:var(--aio-purple)">${fmt$(p.totalCost)}</td>
            </tr>`;}).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--aio-purple-light);">
              <td colspan="2" style="font-weight:700;font-size:12px;color:var(--text-muted);padding-top:10px;">Total</td>
              <td style="font-weight:700;font-size:13px;color:var(--success-text);padding-top:10px;">${grandTotalUnits}</td>
              <td style="font-weight:700;font-size:13px;color:#1a7a3c;padding-top:10px;">${grandWorking}</td>
              <td style="font-weight:700;font-size:13px;color:#1a5080;padding-top:10px;">${grandTesting > 0 ? grandTesting : '—'}</td>
              <td style="font-weight:700;font-size:13px;color:#7a5000;padding-top:10px;">${grandFaulty  > 0 ? grandFaulty  : '—'}</td>
              <td style="font-weight:700;font-size:13px;color:#9c2a00;padding-top:10px;">${grandRMA > 0 ? grandRMA : '—'}</td>
              <td style="font-weight:700;font-size:13px;color:#666;padding-top:10px;">${grandTL  > 0 ? grandTL  : '—'}</td>
              <td style="padding-top:10px;"></td>
              <td style="font-weight:700;font-size:13px;color:var(--aio-purple);padding-top:10px;">$${grandTotalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            </tr>
          </tfoot>
        </table>`
      : '<div class="empty">No stock data yet</div>';

    // ── Deployed stock by product ──────────────────────────────────────
    const deployedByProduct  = Inventory.getDeployedByProduct();
    const deployedGrandTotal = deployedByProduct.reduce((a, p) => a + p.totalCost, 0);
    const deployedGrandUnits = deployedByProduct.reduce((a, p) => a + p.units, 0);

    document.getElementById('dash-deployed-stock').innerHTML = deployedByProduct.length
      ? `<table class="product-stock-table">
          <thead><tr>
            <th style="width:28%">Product</th>
            <th style="width:16%">Category</th>
            <th style="width:12%">Units deployed</th>
            <th style="width:14%">Avg cost</th>
            <th style="width:10%">Priced</th>
            <th style="width:14%">Total value</th>
          </tr></thead>
          <tbody>
            ${deployedByProduct.map(p => `<tr>
              <td style="font-weight:500">${esc(p.product)}</td>
              <td><span class="cat-badge">${esc(p.category || '—')}</span></td>
              <td><span style="font-size:13px;font-weight:600;color:var(--aio-orange-dark)">${p.units}</span></td>
              <td style="font-size:12px">${fmt$(p.avgCost)}</td>
              <td style="font-size:12px;color:var(--text-muted)">${p.costedUnits > 0 ? p.costedUnits : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td style="font-size:12px;font-weight:600;color:var(--aio-orange-dark)">${fmt$(p.totalCost)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="font-weight:700;font-size:12px;color:var(--text-muted)">Total</td>
              <td style="font-weight:700;font-size:13px;color:var(--aio-orange-dark)">${deployedGrandUnits}</td>
              <td colspan="2"></td>
              <td style="font-weight:700;font-size:13px;color:var(--aio-orange-dark)">$${deployedGrandTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            </tr>
          </tfoot>
        </table>`
      : '<div class="empty">No stock deployed yet</div>';
    document.getElementById('dash-recent').innerHTML = recent.length
      ? `<table><thead><tr><th style="width:40%">Product</th><th style="width:13%">Type</th><th style="width:25%">Location</th><th style="width:22%">Date</th></tr></thead><tbody>
         ${recent.map(m => `<tr><td style="font-weight:500">${esc(m.product)}</td><td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span></td><td><span class="loc-badge">${esc(m.location||'—')}</span></td><td style="color:var(--text-hint)">${fmtDate(m.date)}</td></tr>`).join('')}
         </tbody></table>`
      : '<div class="empty">No movements yet</div>';

    document.getElementById('dash-low').innerHTML = lowItems.length
      ? `<table><thead><tr><th style="width:45%">Product</th><th style="width:30%">Location</th><th>Stock</th></tr></thead><tbody>
         ${lowItems.map(v => `<tr><td>${esc(v.product)}</td><td><span class="loc-badge">${esc(v.location||'—')}</span></td><td><span class="badge ${v.inStock.size===0?'b-zero':'b-low'}">${v.inStock.size}</span></td></tr>`).join('')}
         </tbody></table>`
      : '<div class="empty" style="padding:1rem">All products well stocked</div>';

    // ── Workshop summary ──────────────────────────────────────────────
    const wkshpEl = document.getElementById('dash-workshop');
    if (wkshpEl) {
      const workshopRows = Inventory.getAllSerialRows().filter(r => r.condition && r.condition !== 'used');
      const wkMap = { 'needs-testing': 0, faulty: 0, rma: 0, 'fail-tl': 0 };
      workshopRows.forEach(r => { if (wkMap[r.condition] !== undefined) wkMap[r.condition]++; });
      const wkTotal = workshopRows.length;
      const wkValue = workshopRows.reduce((a, r) => a + (r.cost || 0), 0);
      const fmtV = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
      if (wkTotal === 0) {
        wkshpEl.innerHTML = '<div class="empty" style="padding:.75rem">No items in workshop</div>';
      } else {
        wkshpEl.innerHTML = `
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div class="dash-wk-card dash-wk-total">
              <div class="dash-wk-count">${wkTotal}</div>
              <div class="dash-wk-label">Total</div>
              <div class="dash-wk-value">${fmtV(wkValue)}</div>
            </div>
            ${wkMap['needs-testing'] > 0 ? `<div class="dash-wk-card dash-wk-testing">
              <div class="dash-wk-count">${wkMap['needs-testing']}</div>
              <div class="dash-wk-label">🔬 Needs Testing</div>
            </div>` : ''}
            ${wkMap['faulty'] > 0 ? `<div class="dash-wk-card dash-wk-faulty">
              <div class="dash-wk-count">${wkMap['faulty']}</div>
              <div class="dash-wk-label">⚠ Faulty</div>
            </div>` : ''}
            ${wkMap['rma'] > 0 ? `<div class="dash-wk-card dash-wk-rma">
              <div class="dash-wk-count">${wkMap['rma']}</div>
              <div class="dash-wk-label">⛔ RMA</div>
            </div>` : ''}
            ${wkMap['fail-tl'] > 0 ? `<div class="dash-wk-card dash-wk-tl">
              <div class="dash-wk-count">${wkMap['fail-tl']}</div>
              <div class="dash-wk-label">🗑 Total Loss</div>
            </div>` : ''}
          </div>`;
      }
    }

    const map = Inventory.getInventoryMap();
    const locMap = {};
    Object.values(map).forEach(v => { const l = v.location || 'Unassigned'; locMap[l] = (locMap[l] || 0) + v.inStock.size; });
    document.getElementById('dash-locations').innerHTML = Object.keys(locMap).length
      ? `<div class="loc-grid">${Object.entries(locMap).map(([loc, qty]) => `<div class="loc-card"><div class="loc-card-label">${esc(loc)}</div><div class="loc-card-val">${qty} <span class="loc-card-sub">units</span></div></div>`).join('')}</div>`
      : '<div class="empty">No location data yet</div>';
  }

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

  // ── Orders ─────────────────────────────────────────────────────────────
  function renderOrderList() {
    const allOrders = DB.getOrders().slice().reverse();
    // Purchase Orders tab: show pending, partial, in-transit and cancelled
    const orders = allOrders.filter(o => o.status === 'pending' || o.status === 'partial' || o.status === 'in-transit' || o.status === 'cancelled');
    const badge  = document.getElementById('order-count-badge');
    const pending = allOrders.filter(o => o.status === 'pending' || o.status === 'partial').length;
    if (badge) badge.textContent = pending > 0 ? `(${pending})` : '';

    const container = document.getElementById('order-list');
    if (!container) return;
    if (!orders.length) { container.innerHTML = '<div class="empty">No orders placed yet</div>'; return; }

    const statusLabel = { pending: '⏳ Pending', partial: '⚡ Partial', 'in-transit': '✈ In Transit', received: '✓ Received', cancelled: '✗ Cancelled' };
    const statusClass = { pending: 'b-low', partial: 'b-partial', 'in-transit': 'transit', received: 'b-in', cancelled: 'b-zero' };

    container.innerHTML = orders.map(o => {
      const totalQty = o.products.reduce((a, p) => a + p.qty, 0);
      const totalVal = o.products.reduce((a, p) => a + (p.qty * (p.unitCost || 0)), 0);
      const hasTax   = (o.taxAmount || 0) > 0;
      const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

      // Expanded detail panel — full line-by-line breakdown with tax
      const detailPanel = `<div class="ord-detail" id="ord-detail-${o.id}" style="display:none;border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Product</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Qty</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Unit cost</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Line total</th>
            ${hasTax ? '<th style="text-align:right;padding:4px 8px;font-weight:600;color:#9c6000;font-size:11px;">Tax share</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:#9c6000;font-size:11px;">Tax/unit</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--aio-purple);font-size:11px;">Landed/unit</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--aio-purple);font-size:11px;">Landed total</th>' : ''}
          </tr></thead>
          <tbody>
            ${o.products.map(p => {
              const lineTotal   = p.qty * (p.unitCost || 0);
              const landedTotal = p.qty * (p.landedUnitCost || p.unitCost || 0);
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px 8px;font-weight:500">${esc(p.product)}</td>
                <td style="padding:6px 8px;text-align:right">${p.qty}</td>
                <td style="padding:6px 8px;text-align:right">${p.unitCost != null ? '$'+p.unitCost.toFixed(2) : '—'}</td>
                <td style="padding:6px 8px;text-align:right">$${lineTotal.toFixed(2)}</td>
                ${hasTax ? `
                <td style="padding:6px 8px;text-align:right;color:#9c6000;">$${(p.taxShare||0).toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;color:#9c6000;">$${(p.taxPerUnit||0).toFixed(4)}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--aio-purple);">$${(p.landedUnitCost||p.unitCost||0).toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--aio-purple);">$${landedTotal.toFixed(2)}</td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--aio-purple-light);">
              <td colspan="3" style="padding:8px;font-weight:700;font-size:12px;color:var(--text-muted);">Subtotal</td>
              <td style="padding:8px;text-align:right;font-weight:700;">$${totalVal.toFixed(2)}</td>
              ${hasTax ? `<td colspan="3" style="padding:8px;text-align:right;color:#9c6000;font-weight:700;">Tax ${fmt$(o.taxAmount)}${o.taxRate?' ('+o.taxRate+'%)':''}</td><td style="padding:8px;text-align:right;font-weight:700;color:var(--aio-purple);">$${(o.totalWithTax||totalVal).toFixed(2)}</td>` : ''}
            </tr>
            ${hasTax && o.taxRef ? `<tr><td colspan="8" style="padding:4px 8px;font-size:11px;color:var(--text-muted);">Tax ref: ${esc(o.taxRef)}</td></tr>` : ''}
          </tfoot>
        </table>
      </div>`;

      return `<div class="shipment-card">
        <div class="shipment-card-header" style="cursor:pointer;" data-toggle-order="${o.id}">
          <div style="flex:1;">
            <div class="shipment-card-title">
              ${esc(o.supplier)} <span class="po-lock-badge">🔒 ${esc(o.poNumber)}</span>
              <span class="badge ${statusClass[o.status] || 'b-low'}" style="margin-left:6px;font-size:10px;">${statusLabel[o.status] || o.status}</span>
              ${hasTax ? '<span style="margin-left:8px;font-size:10px;background:#fff8e0;color:#9c6000;padding:2px 7px;border-radius:8px;border:1px solid #f0d880;font-weight:600;">💰 Tax</span>' : ''}
            </div>
            <div class="shipment-card-meta">
              ${totalQty} unit${totalQty !== 1 ? 's' : ''} · ${o.products.length} product${o.products.length !== 1 ? 's' : ''} · Subtotal ${fmt$(totalVal)}${hasTax ? ` · <span style="color:#9c6000;">Tax ${fmt$(o.taxAmount)}${o.taxRate ? ' (' + o.taxRate + '%)' : ''}${o.taxRef ? ' — ' + esc(o.taxRef) : ''}</span> · <strong>Total ${fmt$(o.totalWithTax)}</strong>` : ''} · Ordered ${fmtDate(o.createdAt)}${o.expectedBy ? ' · Expected ' + new Date(o.expectedBy).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''} <span style="font-size:11px;color:var(--text-hint);">▼ click to expand</span>
            </div>
          </div>
          <div class="shipment-actions" style="align-self:flex-start;">
            ${o.status === 'pending' ? `<button class="btn btn-success btn-xs" data-arrange-order="${o.id}">Arrange Shipment</button>
            <button class="btn btn-orange btn-xs" data-split-order="${o.id}" title="Register a partial shipment &#8212; specify how many units are being sent now">&#9986; Split Shipment</button>
            <button class="btn btn-ghost btn-xs" data-cancel-order="${o.id}">Cancel</button>` : ''}
            ${o.status === 'partial' ? `<button class="btn btn-success btn-xs" data-arrange-order="${o.id}">Arrange Remaining</button>
            <button class="btn btn-orange btn-xs" data-split-order="${o.id}" title="Register another partial shipment for remaining units">&#9986; Split Again</button>
            <button class="btn btn-ghost btn-xs" data-cancel-order="${o.id}">Cancel</button>` : ''}
            ${o.status === 'in-transit' ? `<button class="btn btn-success btn-xs" data-part-receive-order="${o.id}" title="Receive some or all units now, scan serials on arrival">&#9986; Receive Part</button>
            <button class="btn btn-ghost btn-xs" data-full-receive-order="${o.id}" title="Receive all units from this shipment">Receive All</button>
            <button class="btn btn-orange btn-xs" data-close-order="${o.id}" title="Mark as delivered without adding stock &#8212; for units already entered into the system">&#10003; Already in Stock</button>` : ''}
          </div>
        </div>
        ${detailPanel}
      </div>`;
    }).join('');

    // Toggle expand on card header click
    container.querySelectorAll('[data-toggle-order]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('button')) return; // don't toggle on button clicks
        const detail = document.getElementById(`ord-detail-${header.dataset.toggleOrder}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        const arrow = header.querySelector('.shipment-card-meta span:last-child');
        if (arrow) arrow.textContent = isOpen ? '▼ click to expand' : '▲ click to collapse';
      });
    });

    container.querySelectorAll('[data-arrange-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.arrangeShipmentFromOrder === 'function') window.arrangeShipmentFromOrder(parseInt(btn.dataset.arrangeOrder));
      });
    });
    container.querySelectorAll('[data-split-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.splitShipmentFromOrder === 'function') window.splitShipmentFromOrder(parseInt(btn.dataset.splitOrder));
      });
    });
    container.querySelectorAll('[data-cancel-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Cancel this order?')) { DB.updateOrder(parseInt(btn.dataset.cancelOrder), { status: 'cancelled' }); renderOrderList(); }
      });
    });
    container.querySelectorAll('[data-part-receive-order]').forEach(btn => {
      btn.addEventListener('click', () => showPartialReceiveModal(parseInt(btn.dataset.partReceiveOrder)));
    });
    container.querySelectorAll('[data-full-receive-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = parseInt(btn.dataset.fullReceiveOrder);
        const { shipments } = DB.getData();
        const s = shipments.find(x => x.orderId === orderId && x.status === 'in-transit');
        if (s) showReceiveModal(s.id);
      });
    });
    container.querySelectorAll('[data-close-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = parseInt(btn.dataset.closeOrder);
        const order   = DB.getOrders().find(o => o.id === orderId);
        if (!order) return;
        const ships = DB.getData().shipments.filter(s =>
          s.status === 'in-transit' &&
          (s.orderId === orderId || (s.poNumber === order.poNumber && s.supplier === order.supplier))
        );
        if (!ships.length) { showAlert('No in-transit shipment found for this order.', 'error'); return; }
        closeWithoutStock(ships, `${order.supplier || 'this order'} · ${order.poNumber || ''}`);
      });
    });
  }

  // Mark shipments delivered without writing any stock — for units that were
  // already entered into the system by hand. Deliberately explicit, because the
  // alternative (Receive) is what double-counts them.
  function closeWithoutStock(shipments, label) {
    const units = shipments.reduce((a, s) => a + s.products.reduce((b, p) => b + p.serials.length, 0), 0);
    if (!confirm(
      `Mark ${shipments.length > 1 ? shipments.length + ' shipments' : 'this shipment'} for ${label} as delivered?\n\n` +
      `${units} unit${units!==1?'s':''} will be cleared from In Transit and NO stock will be added — use this only when the units are already in Stock Holding.\n\n` +
      `To actually receive them into stock, cancel and use Receive Part / Receive All instead.`
    )) return;
    const by = (typeof Auth !== 'undefined' && Auth.getName) ? Auth.getName() : '';
    try {
      shipments.forEach(s => Inventory.closeShipmentWithoutStock(s.id, by));
      renderOrderList();
      renderTransitList();
      renderDashboard();
      showAlert(`${units} unit${units!==1?'s':''} cleared from In Transit — no stock added`, 'success');
    } catch (err) { showAlert(err.message, 'error'); }
  }

  // ── In Transit ────────────────────────────────────────────────────────
  function renderTransitList() {
    const { shipments } = DB.getData();
    const active = shipments.filter(s => s.status === 'in-transit').reverse();
    const badge = document.getElementById('transit-count-badge');
    if (badge) badge.textContent = active.length > 0 ? `(${active.length})` : '';

    const container = document.getElementById('transit-list');
    if (!container) return;
    if (!active.length) { container.innerHTML = '<div class="empty">No active shipments</div>'; return; }

    container.innerHTML = active.map(s => {
      const totalUnits = s.products.reduce((a, p) => a + p.serials.length, 0);
      const expectedStr = s.expectedBy ? `Expected ${new Date(s.expectedBy).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : '';
      const fmt$ = n => '$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const freightStr  = s.freightCost > 0
        ? `🚚 ${esc(s.freightSupplier || 'Freight')}${s.freightPO ? ` · ${esc(s.freightPO)}` : ''} · ${fmt$(s.freightCost)} freight`
        : '';
      const docs = s.documents || [];
      const docsHtml = docs.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;">
        ${docs.map(d => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--aio-purple);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;text-decoration:none;" title="${esc(d.name)}">📎 ${esc(d.name.length>28?d.name.slice(0,25)+'…':d.name)}</a>`).join('')}
      </div>` : '';
      return `<div class="shipment-card">
        <div class="shipment-card-header">
          <div>
            <div class="shipment-card-title">${esc(s.supplier || 'Shipment')} → <span class="loc-badge">${esc(s.location || '?')}</span>${s.poNumber ? ` <span class="po-lock-badge">🔒 ${esc(s.poNumber)}</span>` : ''}</div>
            <div class="shipment-card-meta">${totalUnits} unit${totalUnits!==1?'s':''} · ${s.products.length} product${s.products.length!==1?'s':''} · Registered ${fmtDate(s.createdAt)}${expectedStr ? ' · ' + expectedStr : ''}</div>
            ${freightStr ? `<div class="shipment-card-meta" style="margin-top:3px;color:var(--text-muted);">${freightStr}</div>` : ''}
          </div>
          <div class="shipment-actions">
            <button class="btn btn-success btn-xs" data-receive="${s.id}">Receive</button>
            <button class="btn btn-orange btn-xs" data-close-ship="${s.id}" title="Mark as delivered without adding stock — for units already entered into the system">✓ Already in Stock</button>
            <label class="btn btn-ghost btn-xs" style="cursor:pointer;" title="Attach document"><input type="file" data-upload-shipment="${s.id}" style="display:none;" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />📎 Doc</label>
            <button class="btn btn-ghost btn-xs" data-cancel="${s.id}">Cancel</button>
          </div>
        </div>
        <div class="shipment-products">
          ${s.products.map(p => `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${p.serials.length} unit${p.serials.length!==1?'s':''}</span>`).join('')}
        </div>
        ${docsHtml}
      </div>`;
    }).join('');

    container.querySelectorAll('[data-receive]').forEach(btn => {
      btn.addEventListener('click', () => showReceiveModal(parseInt(btn.dataset.receive)));
    });

    container.querySelectorAll('[data-close-ship]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = DB.getData().shipments.find(x => x.id === parseInt(btn.dataset.closeShip));
        if (s) closeWithoutStock([s], `${s.supplier || 'this shipment'}${s.poNumber ? ' · ' + s.poNumber : ''}`);
      });
    });
    container.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Cancel this shipment? The serials will be removed.')) {
          DB.removeShipment(parseInt(btn.dataset.cancel));
          renderTransitList();
          renderDashboard();
        }
      });
    });

    // Document upload wiring
    container.querySelectorAll('[data-upload-shipment]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const shipId = parseInt(input.dataset.uploadShipment);
        try {
          showAlert('Uploading document…', 'info');
          const meta = await DB.uploadDocument('shipment', shipId, file);
          DB.addDocumentToShipment(shipId, meta);
          renderTransitList();
          showAlert(`Document "${file.name}" attached.`, 'success');
        } catch(e) { showAlert('Upload failed: ' + e.message, 'error'); }
        input.value = '';
      });
    });
  }

  function showReceiveModal(shipmentId) {
    const { shipments } = DB.getData();
    const s = shipments.find(x => x.id === shipmentId);
    if (!s) return;

    const totalUnits = s.products.reduce((a,p) => a + p.serials.length, 0);
    // Determine which products need real serial numbers (have NS- placeholders)
    const needsSerials = s.products.map(p => p.serials.some(x => x.startsWith('NS-')));
    const anyNeedsSerials = needsSerials.some(Boolean);

    // Scanned serials per product index
    const scanned = {};
    s.products.forEach((p, i) => { scanned[i] = new Set(); });

    function serialSection() {
      if (!anyNeedsSerials) return '';
      return s.products.map((p, i) => {
        if (!needsSerials[i]) return '';
        const qty = p.serials.length;
        return `<div style="margin-bottom:12px;padding:12px;background:var(--bg-hover,rgba(0,0,0,.03));border-radius:8px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">${esc(p.product)}</strong>
            <span style="font-size:11px;color:var(--text-muted);">${qty} unit${qty!==1?'s':''} · <span id="rcv-count-${i}" style="color:var(--aio-purple);font-weight:600;">0</span> scanned</span>
          </div>
          <input class="fi fi-mono" id="rcv-serial-${i}" placeholder="Scan or type serial then Enter · paste to bulk import" style="margin-bottom:6px;" />
          <div id="rcv-tags-${i}" style="display:flex;flex-wrap:wrap;gap:4px;min-height:18px;"></div>
          <div class="hint" style="margin-top:4px;">Leave blank to use placeholder IDs for non-serialised items</div>
        </div>`;
      }).join('');
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:520px;">
        <div class="modal-title">Receive shipment</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem;">${totalUnits} unit${totalUnits!==1?'s':''} from ${esc(s.supplier||'supplier')} · PO ${esc(s.poNumber||'')}</div>
        ${anyNeedsSerials ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-hint);margin-bottom:8px;">Serial Numbers</div>${serialSection()}` : ''}
        <div class="form-grid g2" style="margin-top:${anyNeedsSerials?'12px':'0'};">
          <div class="form-group">
            <label class="form-label">Confirm location *</label>
            <input class="fi" id="modal-loc" value="${esc(s.location||'')}" placeholder="e.g. SF Warehouse" list="modal-loc-list" />
            <datalist id="modal-loc-list">${Inventory.getLocations().map(l=>`<option value="${esc(l)}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Received by</label>
            <input class="fi" id="modal-by" placeholder="e.g. Peter Roberts" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
          <button class="btn btn-success" id="modal-confirm-btn">Receive into stock</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Wire serial scanners
    s.products.forEach((p, i) => {
      if (!needsSerials[i]) return;
      const inp     = document.getElementById(`rcv-serial-${i}`);
      const tagsDiv = document.getElementById(`rcv-tags-${i}`);
      const countEl = document.getElementById(`rcv-count-${i}`);
      if (!inp) return;
      function sync() {
        countEl.textContent = scanned[i].size;
        tagsDiv.innerHTML = Array.from(scanned[i]).map(sv =>
          `<span style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-family:monospace;cursor:pointer;" data-rm="${sv}">${esc(sv)}</span>`
        ).join('');
        tagsDiv.querySelectorAll('[data-rm]').forEach(t =>
          t.addEventListener('click', () => { scanned[i].delete(t.dataset.rm); sync(); })
        );
      }
      function add(raw) { const v = raw.trim().toUpperCase(); if (v) scanned[i].add(v); }
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        inp.value.split(/[,\n]+/).map(v => v.trim()).filter(Boolean).forEach(add);
        inp.value = ''; sync();
      });
      inp.addEventListener('paste', () => {
        setTimeout(() => {
          inp.value.split(/[\n,\t]+/).map(v => v.trim()).filter(Boolean).forEach(add);
          inp.value = ''; sync();
        }, 10);
      });
    });

    document.getElementById('modal-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
      const loc = document.getElementById('modal-loc').value.trim();
      const by  = document.getElementById('modal-by').value.trim();
      if (!loc) { showAlert('Location is required.', 'error'); return; }
      try {
        if (anyNeedsSerials) {
          // Build parts: use scanned serials where provided, else keep NS- placeholders (qty-based)
          const parts = s.products.map((p, i) => {
            const realSerials = Array.from(scanned[i]);
            if (realSerials.length > 0) {
              return { product: p.product, category: p.category, serials: realSerials, qty: realSerials.length };
            } else {
              // No serials scanned — use all NS- placeholders as-is
              return { product: p.product, category: p.category, serials: [], qty: p.serials.length };
            }
          });
          Inventory.receivePartialShipment(shipmentId, parts, by, loc);
        } else {
          Inventory.receiveShipment(shipmentId, by, loc);
        }
        overlay.remove();
        renderTransitList();
        renderOrderList();
        renderDashboard();
        showAlert(`Shipment received into stock at ${loc}`, 'success');
      } catch (err) { showAlert(err.message, 'error'); }
    });
  }


  // ── Partial Receive Modal ────────────────────────────────────────────
  function showPartialReceiveModal(orderId) {
    const data = DB.getData();
    const order = DB.getOrders().find(o => o.id === orderId);
    if (!order) return;

    // Find linked in-transit shipment — try orderId first, then PO number fallback
    const activeShipments = data.shipments.filter(s =>
      s.status === 'in-transit' &&
      (s.orderId === orderId || (s.poNumber === order.poNumber && s.supplier === order.supplier))
    );
    if (!activeShipments.length) {
      showAlert('No in-transit shipment found for this order. Use "Arrange Shipment" or "Split Shipment" to register a dispatch first.', 'error');
      return;
    }

    const shipment = activeShipments[0];
    const scannedSerials = {};
    shipment.products.forEach((p, i) => { scannedSerials[i] = new Set(); });
    const skipped = {};  // products marked "not arrived"

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    function productRows() {
      return shipment.products.map((p, i) => {
        const qty = p.serials.length;
        const isNS = p.serials.every(s => s.startsWith('NS-'));
        return `<div id="pr-row-${i}" style="margin-bottom:12px;padding:12px;background:var(--bg-hover,rgba(0,0,0,.03));border-radius:8px;border:1px solid var(--border);transition:opacity .2s;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div>
              <strong style="font-size:13px;">${esc(p.product)}</strong>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${qty} unit${qty!==1?'s':''} in shipment</span>
            </div>
            <button class="btn btn-ghost btn-xs" id="pr-skip-${i}" style="font-size:11px;color:var(--text-muted);">✕ Not in this delivery</button>
          </div>
          <div class="form-grid g2">
            <div class="form-group">
              <label class="form-label">Qty receiving now</label>
              <input class="fi" type="number" min="1" max="${qty}" value="${qty}" id="pr-qty-${i}" ${isNS ? '' : 'readonly title="Auto-set by serial scan"'} />
            </div>
            <div class="form-group" style="display:flex;flex-direction:column;justify-content:flex-end;">
              ${isNS
                ? `<span style="font-size:11px;color:var(--text-hint);padding-bottom:4px;">No serial scan needed</span>`
                : `<span style="font-size:12px;color:var(--text-muted);">Serials scanned: <strong id="pr-count-${i}" style="color:var(--aio-purple);">0</strong></span>`
              }
            </div>
          </div>
          ${!isNS ? `<input class="fi fi-mono" id="pr-serial-${i}" placeholder="Type or scan serial then Enter · paste to bulk import" style="margin-top:6px;" />
          <div id="pr-tags-${i}" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;min-height:18px;"></div>` : ''}
        </div>`;
      }).join('');
    }

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:540px;">
        <div class="modal-title">✂ Receive Part Shipment</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">
          ${esc(shipment.supplier || order.supplier)} · PO ${esc(shipment.poNumber || order.poNumber)}
          ${activeShipments.length > 1 ? `<span style="margin-left:8px;background:#fff3cd;color:#856404;padding:2px 7px;border-radius:8px;font-size:11px;font-weight:600;">Shipment 1 of ${activeShipments.length}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-hint);margin-bottom:12px;">Items not in this delivery — click "✕ Not in this delivery" to leave them in transit.</div>
        <div id="pr-products">${productRows()}</div>
        <div class="form-grid g2" style="margin-top:12px;">
          <div class="form-group">
            <label class="form-label">Receiving location *</label>
            <input class="fi" id="pr-loc" value="${esc(shipment.location || '')}" placeholder="e.g. SF Warehouse" list="pr-loc-list" />
            <datalist id="pr-loc-list">${Inventory.getLocations().map(l=>`<option value="${esc(l)}">`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Received by</label>
            <input class="fi" id="pr-by" placeholder="e.g. Peter Roberts" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pr-cancel">Cancel</button>
          <button class="btn btn-success" id="pr-confirm">Receive into stock</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Wire "not in this delivery" skip buttons
    shipment.products.forEach((p, i) => {
      const btn = document.getElementById(`pr-skip-${i}`);
      const row = document.getElementById(`pr-row-${i}`);
      btn.addEventListener('click', () => {
        skipped[i] = !skipped[i];
        row.style.opacity   = skipped[i] ? '0.35' : '1';
        row.style.pointerEvents = skipped[i] ? 'none' : '';
        btn.style.pointerEvents = 'auto';
        btn.textContent = skipped[i] ? '✓ Include' : '✕ Not in this delivery';
        btn.style.color = skipped[i] ? 'var(--aio-purple)' : 'var(--text-muted)';
      });
    });

    // Wire serial scanners
    shipment.products.forEach((p, i) => {
      if (p.serials.every(s => s.startsWith('NS-'))) return;
      const inp      = document.getElementById(`pr-serial-${i}`);
      const tagsDiv  = document.getElementById(`pr-tags-${i}`);
      const countBdg = document.getElementById(`pr-count-${i}`);
      const qtyInp   = document.getElementById(`pr-qty-${i}`);
      if (!inp) return;
      function sync() {
        countBdg.textContent = scannedSerials[i].size;
        qtyInp.value = scannedSerials[i].size;
        tagsDiv.innerHTML = Array.from(scannedSerials[i]).map(s =>
          `<span style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-family:monospace;cursor:pointer;" data-rm="${s}">${esc(s)}</span>`
        ).join('');
        tagsDiv.querySelectorAll('[data-rm]').forEach(t => {
          t.addEventListener('click', () => { scannedSerials[i].delete(t.dataset.rm); sync(); });
        });
      }
      function addSerial(raw) { const s = raw.trim().toUpperCase(); if (s) scannedSerials[i].add(s); }
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        inp.value.split(/[,\n]+/).map(v => v.trim()).filter(Boolean).forEach(addSerial);
        inp.value = ''; sync();
      });
      inp.addEventListener('paste', () => {
        setTimeout(() => {
          inp.value.split(/[\n,\t]+/).map(v => v.trim()).filter(Boolean).forEach(addSerial);
          inp.value = ''; sync();
        }, 10);
      });
    });

    document.getElementById('pr-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('pr-confirm').addEventListener('click', () => {
      const loc = document.getElementById('pr-loc').value.trim();
      const by  = document.getElementById('pr-by').value.trim();
      if (!loc) { showAlert('Location is required.', 'error'); return; }

      const parts = shipment.products.map((p, i) => {
        if (skipped[i]) return null;
        const isNS = p.serials.every(s => s.startsWith('NS-'));
        if (isNS) {
          const qty = parseInt(document.getElementById(`pr-qty-${i}`).value) || 0;
          return qty > 0 ? { product: p.product, category: p.category, serials: [], qty } : null;
        } else {
          const serials = Array.from(scannedSerials[i]);
          return serials.length > 0 ? { product: p.product, category: p.category, serials, qty: serials.length } : null;
        }
      }).filter(Boolean);

      if (!parts.length) { showAlert('Select at least one product to receive.', 'error'); return; }

      try {
        Inventory.receivePartialShipment(shipment.id, parts, by, loc);
        overlay.remove();
        renderOrderList();
        renderTransitList();
        renderDashboard();
        const total = parts.reduce((a, p) => a + p.qty, 0);
        showAlert(`${total} unit${total!==1?'s':''} received into stock at ${loc}`, 'success');
      } catch (err) { showAlert(err.message, 'error'); }
    });
  }


  // ── Shipment History ─────────────────────────────────────────────────
  function renderShipmentHistory() {
    const { shipments } = DB.getData();
    const received = shipments.filter(s => s.status === 'received').slice().reverse();
    const container = document.getElementById('shipment-history-list');
    if (!container) return;

    if (!received.length) {
      container.innerHTML = '<div class="empty">No received shipments yet</div>';
      return;
    }

    const fmt$ = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    container.innerHTML = received.map(s => {
      const totalUnits = s.products.reduce((a, p) => a + p.serials.length, 0);
      const freightStr = s.freightCost > 0
        ? `🚚 ${esc(s.freightSupplier || 'Freight')}${s.freightPO ? ' · ' + esc(s.freightPO) : ''} · ${fmt$(s.freightCost)} freight`
        : '';
      const receivedDate = s.receivedAt
        ? new Date(s.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const docs = s.documents || [];
      const docsHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${docs.length ? '6px' : '0'};">
          <label class="btn btn-ghost btn-xs" style="cursor:pointer;font-size:11px;" title="Attach document">
            <input type="file" data-upload-history="${s.id}" style="display:none;" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
            📎 Attach document
          </label>
          ${docs.length ? `<span style="font-size:11px;color:var(--text-muted);">${docs.length} document${docs.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${docs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${docs.map(d => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--aio-purple);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;text-decoration:none;" title="${esc(d.name)}">📎 ${esc(d.name.length > 30 ? d.name.slice(0, 27) + '…' : d.name)}</a>`).join('')}
        </div>` : ''}
      </div>`;

      const productRows = s.products.map(p => {
        const landedCost = p.landedPerUnit || p.unitCost || null;
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 8px;font-weight:500;">${esc(p.product)}</td>
          <td style="padding:6px 8px;text-align:right;">${p.serials.length}</td>
          <td style="padding:6px 8px;text-align:right;">${landedCost != null ? fmt$(landedCost) : '—'}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600;">${landedCost != null ? fmt$(landedCost * p.serials.length) : '—'}</td>
        </tr>`;
      }).join('');

      return `<div class="shipment-card" id="hist-ship-${s.id}">
        <div class="shipment-card-header" style="cursor:pointer;" data-toggle-hist="${s.id}">
          <div style="flex:1;">
            <div class="shipment-card-title">
              ${esc(s.supplier || 'Shipment')} → <span class="loc-badge">${esc(s.actualLocation || s.location || '?')}</span>
              ${s.poNumber ? `<span class="po-lock-badge">🔒 ${esc(s.poNumber)}</span>` : ''}
              ${s.receivedWithoutStock
                ? `<span class="badge b-partial" style="margin-left:6px;font-size:10px;" title="Marked delivered without adding stock — the units were already in the system">✓ Delivered · no stock added</span>`
                : `<span class="badge b-in" style="margin-left:6px;font-size:10px;">✓ Received</span>`}
            </div>
            <div class="shipment-card-meta">
              ${totalUnits} unit${totalUnits !== 1 ? 's' : ''} · ${s.products.length} product${s.products.length !== 1 ? 's' : ''}
              · Received ${receivedDate}${s.receivedBy ? ' by ' + esc(s.receivedBy) : ''}
              ${s.createdAt ? ' · Registered ' + fmtDate(s.createdAt) : ''}
              <span style="font-size:11px;color:var(--text-hint);"> ▼ click to expand</span>
            </div>
            ${freightStr ? `<div class="shipment-card-meta" style="margin-top:3px;color:var(--text-muted);">${freightStr}</div>` : ''}
          </div>
          <div class="shipment-actions" style="align-self:flex-start;">
            <button class="btn btn-danger btn-xs" data-delete-hist="${s.id}" style="opacity:.7;">🗑 Delete</button>
          </div>
        </div>
        <div id="hist-detail-${s.id}" style="display:none;border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Product</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Units</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed/unit</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed total</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>
          <div class="shipment-products">
            ${s.products.map(p => `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${p.serials.length} unit${p.serials.length !== 1 ? 's' : ''}</span>`).join('')}
          </div>
          ${docsHtml}
        </div>
      </div>`;
    }).join('');

    // Toggle expand
    container.querySelectorAll('[data-toggle-hist]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('label') || e.target.closest('input')) return;
        const detail = document.getElementById(`hist-detail-${header.dataset.toggleHist}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        const arrow = header.querySelector('span[style*="text-hint"]');
        if (arrow) arrow.textContent = isOpen ? ' ▼ click to expand' : ' ▲ click to collapse';
      });
    });

    // Delete
    container.querySelectorAll('[data-delete-hist]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Delete this shipment record from history? This does NOT remove the stock — units already received remain in Stock Holding.')) return;
        DB.removeShipment(parseInt(btn.dataset.deleteHist));
        renderShipmentHistory();
      });
    });

    // Document upload
    container.querySelectorAll('[data-upload-history]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const shipId = parseInt(input.dataset.uploadHistory);
        try {
          showAlert('Uploading document…', 'info');
          const meta = await DB.uploadDocument('shipment', shipId, file);
          DB.addDocumentToShipment(shipId, meta);
          renderShipmentHistory();
          showAlert(`Document "${file.name}" attached.`, 'success');
        } catch(e) { showAlert('Upload failed: ' + e.message, 'error'); }
        input.value = '';
      });
    });
  }

  // ── Stock Deployed ────────────────────────────────────────────────────
  function renderDeployed() {
    const search  = (document.getElementById('dep-search').value || '').toLowerCase();
    const catF    = document.getElementById('dep-cat-filter').value;
    const custF   = document.getElementById('dep-customer-filter').value;

    // ── Pending deployments section ─────────────────────────────────
    const pendingPanel = document.getElementById('dep-pending-panel');
    const pendingBody  = document.getElementById('dep-pending-body');
    const pendingList  = DB.getPendingDeployments();
    if (pendingPanel && pendingBody) {
      if (pendingList.length) {
        pendingPanel.style.display = '';
        const countEl = document.getElementById('dep-pending-count');
        if (countEl) {
          const n = pendingList.reduce((a, p) => a + p.serials.length, 0);
          countEl.textContent = `(${n} unit${n!==1?'s':''})`;
        }
        applyPendingCollapse();
        pendingBody.innerHTML = pendingList.map(pd => {
          const totalCost = pd.serials
            .map(s => DB.getSerialCost(s))
            .filter(c => c != null)
            .reduce((a, c) => a + c, 0);
          const costed = pd.serials.filter(s => DB.getSerialCost(s) != null).length;
          const serialChecks = pd.serials.map(s =>
            `<label class="dep-serial-chk" style="font-size:12px;color:var(--text-muted);font-family:var(--mono);"><input type="checkbox" class="dep-serial-chk-input" data-id="${pd.id}" data-serial="${esc(s)}" checked />${esc(s)}</label>`
          ).join('');
          return `<div class="dep-pending-group">
            <div class="dep-pending-group-header">
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" class="dep-group-chk" data-id="${pd.id}" title="Select this entry for batch confirm" />
                <span class="dep-pending-group-title">${esc(pd.customer)}</span>
                <span class="cat-badge">${esc(pd.product)}</span>
                ${pd.location ? `<span class="loc-badge">${esc(pd.location)}</span>` : ''}
                <span class="badge-pending-deploy">📋 Pending</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:12px;color:var(--text-muted);">${pd.serials.length} unit${pd.serials.length!==1?'s':''}${costed>0?` · $${totalCost.toFixed(2)}`:''}${pd.stagedAt ? ' · Staged '+fmtDate(pd.stagedAt) : ''}</span>
                <button class="btn btn-orange btn-sm dep-confirm-btn" data-id="${pd.id}">✓ Confirm Deployed</button>
                <button class="btn btn-ghost btn-sm dep-unstage-btn" data-id="${pd.id}" style="color:var(--danger-text);">✕ Cancel</button>
              </div>
            </div>
            <div class="dep-serial-list">${serialChecks}</div>
          </div>`;
        }).join('');

        // Returns the checked serials for a given pending id
        const checkedSerials = (id) => Array.from(
          pendingBody.querySelectorAll(`.dep-serial-chk-input[data-id="${id}"]:checked`)
        ).map(cb => cb.dataset.serial);

        // Ids of the staged entries selected (group checkbox ticked) for batch confirm
        const selectedGroupIds = () => Array.from(
          pendingBody.querySelectorAll('.dep-group-chk:checked')
        ).map(chk => chk.dataset.id);

        // Update the "Confirm Selected (N)" label — N = checked serials in selected groups
        const updateSelectedCount = () => {
          const n = selectedGroupIds().reduce((a, id) => a + checkedSerials(id).length, 0);
          const btn = document.getElementById('dep-confirm-selected');
          if (btn) btn.textContent = `✓ Confirm Selected (${n})`;
          const all = document.getElementById('dep-select-all');
          if (all) {
            const groups = pendingBody.querySelectorAll('.dep-group-chk').length;
            const checked = pendingBody.querySelectorAll('.dep-group-chk:checked').length;
            all.checked = checked > 0;
            all.indeterminate = checked > 0 && checked < groups;
          }
        };

        // Group checkbox selects the entry for batch confirm (independent of its serials)
        pendingBody.querySelectorAll('.dep-group-chk').forEach(chk => {
          chk.addEventListener('change', updateSelectedCount);
        });

        // Serial checkbox just refreshes the count
        pendingBody.querySelectorAll('.dep-serial-chk-input').forEach(cb => {
          cb.addEventListener('change', updateSelectedCount);
        });

        // Header "All" toggle — selects/deselects all staged entries
        const selectAll = document.getElementById('dep-select-all');
        if (selectAll) {
          selectAll.onchange = () => {
            pendingBody.querySelectorAll('.dep-group-chk').forEach(chk => { chk.checked = selectAll.checked; });
            updateSelectedCount();
          };
        }

        // Confirm Selected — batch confirm checked serials in the selected groups
        const confirmSelectedBtn = document.getElementById('dep-confirm-selected');
        if (confirmSelectedBtn) {
          confirmSelectedBtn.onclick = () => {
            const ids = selectedGroupIds();
            const selections = ids
              .map(id => ({ id: Number(id), serials: checkedSerials(id) }))
              .filter(sel => sel.serials.length);
            const total = selections.reduce((a, s) => a + s.serials.length, 0);
            if (!total) { UI.showAlert('Select one or more staged entries to confirm.', 'error'); return; }
            if (!confirm(`Confirm deployment of ${total} unit${total!==1?'s':''} across ${selections.length} group${selections.length!==1?'s':''}?

This will remove them from Stock Holding and add them to Stock Deployed.`)) return;
            try {
              Inventory.confirmDeployments(selections);
              UI.renderDashboard && UI.renderDashboard();
              renderDeployed();
            } catch(e) { UI.showAlert(e.message, 'error'); }
          };
        }

        // Wire per-group confirm buttons (confirms that group's checked serials)
        pendingBody.querySelectorAll('.dep-confirm-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pd = DB.getPendingDeployments().find(p => p.id == btn.dataset.id);
            if (!pd) return;
            const serials = checkedSerials(btn.dataset.id);
            if (!serials.length) { UI.showAlert('Select at least one item in this group to confirm.', 'error'); return; }
            if (!confirm(`Confirm deployment of ${serials.length} unit${serials.length!==1?'s':''} to "${pd.customer}"?

This will remove them from Stock Holding and add them to Stock Deployed.`)) return;
            try {
              Inventory.confirmDeployment(Number(btn.dataset.id), serials);
              UI.renderDashboard && UI.renderDashboard();
              renderDeployed();
            } catch(e) { UI.showAlert(e.message, 'error'); }
          });
        });

        // Wire cancel/unstage buttons
        pendingBody.querySelectorAll('.dep-unstage-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pd = DB.getPendingDeployments().find(p => p.id == btn.dataset.id);
            if (!pd) return;
            if (!confirm(`Cancel staged deployment for "${pd.customer}"?

Items will remain in Stock Holding with no customer attached.`)) return;
            DB.removePendingDeployment(Number(btn.dataset.id));
            renderDeployed();
          });
        });

        updateSelectedCount();
      } else {
        pendingPanel.style.display = 'none';
      }
    }

    // ── Tab switching (By Unit / By Restaurant) ─────────────────────
    const tab = localStorage.getItem(DEPLOYED_TAB_KEY) === 'restaurant' ? 'restaurant' : 'unit';
    const unitView = document.getElementById('dep-unit-view');
    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (detView)  detView.style.display  = 'none';
    if (unitView) unitView.style.display = tab === 'unit'       ? '' : 'none';
    if (restView) restView.style.display = tab === 'restaurant' ? '' : 'none';
    styleDeployedTabs(tab);
    if (tab === 'restaurant') { renderRestaurantBuckets(); return; }

    let rows = Inventory.getDeployedSerialRows().filter(r => {
      const ms = !search  || r.serial.toLowerCase().includes(search) || r.product.toLowerCase().includes(search) || r.customer.toLowerCase().includes(search);
      const mc = !catF    || r.category === catF;
      const mcu= !custF   || r.customer === custF;
      return ms && mc && mcu;
    });

    const totalCost    = rows.filter(r => r.cost != null).reduce((a, r) => a + r.cost, 0);
    const costedCount  = rows.filter(r => r.cost != null).length;

    const tbody = document.getElementById('dep-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty">No deployed stock found</div></td></tr>';
    } else {
      tbody.innerHTML = rows.map(r => `<tr>
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category || '—')}</span></td>
        <td><strong>${esc(r.customer || '—')}</strong></td>
        <td style="font-size:11px;color:var(--text-muted)">${esc(r.by || '—')}</td>
        <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
        <td style="font-size:12px">${r.cost != null ? '$' + r.cost.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td><button class="btn btn-ghost btn-sm recall-btn" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" data-location="${esc(r.location||'')}">🔧 Recall</button></td>
      </tr>`).join('');

      // Wire recall buttons
      tbody.querySelectorAll('.recall-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showRecallModal(btn.dataset.serial, btn.dataset.product, btn.dataset.location);
        });
      });
    }

    const footer = document.getElementById('dep-footer');
    footer.textContent = rows.length
      ? `${rows.length} unit${rows.length!==1?'s':''} deployed${costedCount > 0 ? ` · Total cost: $${totalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : ''}`
      : '';
  }

  function populateDeployedFilters() {
    // Customer filter
    const customers = Inventory.getCustomers();
    const custSel = document.getElementById('dep-customer-filter');
    const curCust = custSel.value;
    custSel.innerHTML = '<option value="">All customers</option>' + customers.map(c => `<option value="${esc(c)}"${c===curCust?' selected':''}>${esc(c)}</option>`).join('');
    // Category filter — also needed here, not just in populateCategoryFilters
    const catSel = document.getElementById('dep-cat-filter');
    if (catSel) {
      const curCat = catSel.value;
      catSel.innerHTML = '<option value="">All categories</option>' +
        CATEGORIES.map(c => `<option value="${esc(c)}"${c===curCat?' selected':''}>${esc(c)}</option>`).join('');
    }
  }

  const PENDING_COLLAPSE_KEY = 'aio_dep_pending_collapsed';
  function applyPendingCollapse() {
    const collapsed = localStorage.getItem(PENDING_COLLAPSE_KEY) === '1';
    const body     = document.getElementById('dep-pending-body');
    const controls = document.getElementById('dep-pending-controls');
    const chevron  = document.getElementById('dep-pending-chevron');
    if (body)     body.style.display     = collapsed ? 'none' : '';
    if (controls) controls.style.display = collapsed ? 'none' : '';
    if (chevron)  chevron.textContent    = collapsed ? '▸' : '▾';
  }
  function togglePendingCollapse() {
    const collapsed = localStorage.getItem(PENDING_COLLAPSE_KEY) === '1';
    localStorage.setItem(PENDING_COLLAPSE_KEY, collapsed ? '0' : '1');
    applyPendingCollapse();
  }

  // ── Deployed: By Unit / By Restaurant tabs ───────────────────────────
  const DEPLOYED_TAB_KEY = 'aio_dep_tab';
  function _money(n) { return '$' + (n || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function _pct(val, avg) {
    if (!avg) return '';
    const d = Math.round((val - avg) / avg * 100);
    const color = d > 0 ? 'var(--success-text, #2e7d32)' : (d < 0 ? 'var(--danger-text)' : 'var(--text-muted)');
    const sign = d > 0 ? '+' : '';
    return `<span style="color:${color};font-weight:600;">${sign}${d}%</span> vs avg`;
  }
  function styleDeployedTabs(tab) {
    const u = document.getElementById('dep-tab-unit');
    const r = document.getElementById('dep-tab-restaurant');
    if (u) u.className = 'btn btn-sm ' + (tab === 'unit'       ? 'btn-orange' : 'btn-ghost');
    if (r) r.className = 'btn btn-sm ' + (tab === 'restaurant' ? 'btn-orange' : 'btn-ghost');
  }
  function setDeployedTab(tab) {
    localStorage.setItem(DEPLOYED_TAB_KEY, tab === 'restaurant' ? 'restaurant' : 'unit');
    renderDeployed();
  }

  function renderRestaurantBuckets() {
    const buckets = Inventory.getDeployedByCustomer();
    const n = buckets.length;
    const totalUnits = buckets.reduce((a, b) => a + b.units, 0);
    const totalValue = buckets.reduce((a, b) => a + b.value, 0);
    const avgUnits = n ? totalUnits / n : 0;
    const avgValue = n ? totalValue / n : 0;

    const avgEl = document.getElementById('dep-bucket-avg');
    if (avgEl) {
      avgEl.textContent = n
        ? `${n} restaurant${n!==1?'s':''} · ${totalUnits} unit${totalUnits!==1?'s':''} deployed · avg ${avgUnits.toFixed(1)} units · avg ${_money(avgValue)} each`
        : '';
    }

    const search = (document.getElementById('dep-bucket-search')?.value || '').toLowerCase();
    const filtered = buckets.filter(b => !search || b.customer.toLowerCase().includes(search));

    const grid = document.getElementById('dep-buckets');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty">No deployed stock found</div>';
      return;
    }
    grid.innerHTML = filtered.map(b => {
      const topProducts = Object.entries(b.products).sort((a, c) => c[1] - a[1]).slice(0, 3)
        .map(([p, c]) => `<span class="cat-badge">${esc(p)} ×${c}</span>`).join(' ');
      return `<div class="dep-bucket-card" data-customer="${esc(b.customer)}" style="border:1px solid var(--border);border-radius:8px;padding:14px;cursor:pointer;background:var(--bg-2);">
        <div style="font-weight:600;font-size:14px;margin-bottom:6px;">${esc(b.customer)}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">${b.units} unit${b.units!==1?'s':''} · ${_money(b.value)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${topProducts}</div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.dep-bucket-card').forEach(card => {
      card.addEventListener('click', () => openRestaurantDetail(card.dataset.customer));
    });
  }

  function openRestaurantDetail(customer) {
    const d = Inventory.getCustomerDetail(customer);
    const buckets = Inventory.getDeployedByCustomer();
    const n = buckets.length;
    const avgUnits = n ? buckets.reduce((a, b) => a + b.units, 0) / n : 0;
    const avgValue = n ? buckets.reduce((a, b) => a + b.value, 0) / n : 0;

    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (restView) restView.style.display = 'none';
    if (detView)  detView.style.display  = '';

    const costCell = c => c != null
      ? '$' + c.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})
      : '<span style="color:var(--text-hint)">—</span>';

    const currentRows = d.current.length
      ? d.current.map(r => `<tr>
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
          <td style="font-size:12px">${costCell(r.cost)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4"><div class="empty">No hardware currently on site</div></td></tr>';

    const pastRows = d.past.length
      ? d.past.map(r => `<tr>
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td style="font-size:11px;color:var(--text-hint)">${fmtDateFull(r.date)}</td>
          <td style="font-size:11px;color:var(--text-muted)">${esc(r.status)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4"><div class="empty">No previous hardware on record</div></td></tr>';

    const timelineRows = d.timeline.length
      ? d.timeline.map(t => `<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:11px;color:var(--text-hint);min-width:120px;">${fmtDateFull(t.date)}</span>
          <span style="font-weight:500;">${esc(t.product)}</span>
          <span class="cat-badge">${t.count} unit${t.count!==1?'s':''}</span>
          <span style="font-size:11px;color:var(--text-muted);">${esc(t.by || '—')}${t.ref ? ' · '+esc(t.ref) : ''}</span>
        </div>`).join('')
      : '<div class="empty">No deployment history</div>';

    document.getElementById('dep-detail-body').innerHTML = `
      <div style="margin-bottom:18px;">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">${esc(d.customer)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:24px;">
          <div>
            <div style="font-size:24px;font-weight:700;">${d.units}</div>
            <div style="font-size:12px;color:var(--text-muted);">unit${d.units!==1?'s':''} on site · ${_pct(d.units, avgUnits)} (${avgUnits.toFixed(1)})</div>
          </div>
          <div>
            <div style="font-size:24px;font-weight:700;">${_money(d.value)}</div>
            <div style="font-size:12px;color:var(--text-muted);">total value · ${_pct(d.value, avgValue)} (${_money(avgValue)})</div>
          </div>
        </div>
      </div>

      <div class="panel-title" style="margin-top:8px;">Current hardware on site</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:28%">Serial number</th><th style="width:40%">Product</th>
          <th style="width:20%">Date deployed</th><th style="width:12%">Cost</th>
        </tr></thead>
        <tbody>${currentRows}</tbody>
      </table></div>

      <div class="panel-title" style="margin-top:18px;">Previous hardware (no longer here)</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th style="width:28%">Serial number</th><th style="width:32%">Product</th>
          <th style="width:20%">Last deployed here</th><th style="width:20%">Status</th>
        </tr></thead>
        <tbody>${pastRows}</tbody>
      </table></div>

      <div class="panel-title" style="margin-top:18px;">Deployment history</div>
      <div>${timelineRows}</div>
    `;
  }

  function closeRestaurantDetail() {
    const restView = document.getElementById('dep-restaurant-view');
    const detView  = document.getElementById('dep-detail-view');
    if (detView)  detView.style.display  = 'none';
    if (restView) restView.style.display = '';
  }

  function exportDeployedCSV() {
    const rows = [['Serial Number','Product','Category','Customer / Account','Dispatched By','Date Deployed','Reference','Cost']];
    Inventory.getDeployedSerialRows().forEach(r => {
      rows.push([r.serial, r.product, r.category, r.customer, r.by, fmtDateTimeISO(r.date), r.ref, r.cost != null ? r.cost : '']);
    });
    _dlCSV(rows, 'aio_stock_deployed.csv');
  }

  function exportDeployedXLSX() {
    const header = ['Serial Number','Terminal Device Name','Customer / Account','Location','Value','Date Deployed'];
    const data = Inventory.getDeployedSerialRows().map(r => [
      r.serial,
      r.product,
      r.customer || '',
      r.location || '',
      r.cost != null ? r.cost : '',
      fmtDateTimeISO(r.date),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deployed Terminals');
    XLSX.writeFile(wb, 'aio_deployed_terminals.xlsx');
  }

  // ── Shipment History ─────────────────────────────────────────────────
  function renderShipmentHistory() {
    const { shipments } = DB.getData();
    const received = shipments.filter(s => s.status === 'received').slice().reverse();
    const container = document.getElementById('shipment-history-list');
    if (!container) return;

    if (!received.length) {
      container.innerHTML = '<div class="empty">No received shipments yet</div>';
      return;
    }

    const fmt$ = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    container.innerHTML = received.map(s => {
      const totalUnits = s.products.reduce((a, p) => a + p.serials.length, 0);
      const freightStr = s.freightCost > 0
        ? `🚚 ${esc(s.freightSupplier || 'Freight')}${s.freightPO ? ' · ' + esc(s.freightPO) : ''} · ${fmt$(s.freightCost)} freight`
        : '';
      const receivedDate = s.receivedAt
        ? new Date(s.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const docs = s.documents || [];
      const docsHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${docs.length ? '6px' : '0'};">
          <label class="btn btn-ghost btn-xs" style="cursor:pointer;font-size:11px;" title="Attach document">
            <input type="file" data-upload-history="${s.id}" style="display:none;" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
            📎 Attach document
          </label>
          ${docs.length ? `<span style="font-size:11px;color:var(--text-muted);">${docs.length} document${docs.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${docs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${docs.map(d => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:11px;color:var(--aio-purple);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;text-decoration:none;" title="${esc(d.name)}">📎 ${esc(d.name.length > 30 ? d.name.slice(0, 27) + '…' : d.name)}</a>`).join('')}
        </div>` : ''}
      </div>`;

      const productRows = s.products.map(p => {
        const landedCost = p.landedPerUnit || p.unitCost || null;
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 8px;font-weight:500;">${esc(p.product)}</td>
          <td style="padding:6px 8px;text-align:right;">${p.serials.length}</td>
          <td style="padding:6px 8px;text-align:right;">${landedCost != null ? fmt$(landedCost) : '—'}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600;">${landedCost != null ? fmt$(landedCost * p.serials.length) : '—'}</td>
        </tr>`;
      }).join('');

      return `<div class="shipment-card" id="hist-ship-${s.id}">
        <div class="shipment-card-header" style="cursor:pointer;" data-toggle-hist="${s.id}">
          <div style="flex:1;">
            <div class="shipment-card-title">
              ${esc(s.supplier || 'Shipment')} → <span class="loc-badge">${esc(s.actualLocation || s.location || '?')}</span>
              ${s.poNumber ? `<span class="po-lock-badge">🔒 ${esc(s.poNumber)}</span>` : ''}
              ${s.receivedWithoutStock
                ? `<span class="badge b-partial" style="margin-left:6px;font-size:10px;" title="Marked delivered without adding stock — the units were already in the system">✓ Delivered · no stock added</span>`
                : `<span class="badge b-in" style="margin-left:6px;font-size:10px;">✓ Received</span>`}
            </div>
            <div class="shipment-card-meta">
              ${totalUnits} unit${totalUnits !== 1 ? 's' : ''} · ${s.products.length} product${s.products.length !== 1 ? 's' : ''}
              · Received ${receivedDate}${s.receivedBy ? ' by ' + esc(s.receivedBy) : ''}
              ${s.createdAt ? ' · Registered ' + fmtDate(s.createdAt) : ''}
              <span style="font-size:11px;color:var(--text-hint);"> ▼ click to expand</span>
            </div>
            ${freightStr ? `<div class="shipment-card-meta" style="margin-top:3px;color:var(--text-muted);">${freightStr}</div>` : ''}
          </div>
          <div class="shipment-actions" style="align-self:flex-start;">
            <button class="btn btn-danger btn-xs" data-delete-hist="${s.id}" style="opacity:.7;">🗑 Delete</button>
          </div>
        </div>
        <div id="hist-detail-${s.id}" style="display:none;border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Product</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Units</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed/unit</th>
              <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Landed total</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>
          <div class="shipment-products">
            ${s.products.map(p => `<span class="shipment-product-tag"><strong>${esc(p.product)}</strong> · ${p.serials.length} unit${p.serials.length !== 1 ? 's' : ''}</span>`).join('')}
          </div>
          ${docsHtml}
        </div>
      </div>`;
    }).join('');

    // Toggle expand
    container.querySelectorAll('[data-toggle-hist]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('button') || e.target.closest('label') || e.target.closest('input')) return;
        const detail = document.getElementById(`hist-detail-${header.dataset.toggleHist}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        const arrow = header.querySelector('span[style*="text-hint"]');
        if (arrow) arrow.textContent = isOpen ? ' ▼ click to expand' : ' ▲ click to collapse';
      });
    });

    // Delete
    container.querySelectorAll('[data-delete-hist]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Delete this shipment record from history? This does NOT remove the stock — units already received remain in Stock Holding.')) return;
        DB.removeShipment(parseInt(btn.dataset.deleteHist));
        renderShipmentHistory();
      });
    });

    // Document upload
    container.querySelectorAll('[data-upload-history]').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const shipId = parseInt(input.dataset.uploadHistory);
        try {
          showAlert('Uploading document…', 'info');
          const meta = await DB.uploadDocument('shipment', shipId, file);
          DB.addDocumentToShipment(shipId, meta);
          renderShipmentHistory();
          showAlert(`Document "${file.name}" attached.`, 'success');
        } catch(e) { showAlert('Upload failed: ' + e.message, 'error'); }
        input.value = '';
      });
    });
  }

  // ── Stock Deployed ────────────────────────────────────────────────────
  // ── Stock Breakdown (by product, with condition columns) ─────────────
  let _invProductFilter = ''; // product name filter set by clicking a breakdown row

  function renderStockBreakdown() {
    const tbody   = document.getElementById('inv-breakdown-body');
    const footer  = document.getElementById('inv-breakdown-footer');
    if (!tbody) return;

    const allInStock = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock');
    const byProduct  = {};
    allInStock.forEach(r => {
      if (!byProduct[r.product]) byProduct[r.product] = { product: r.product, category: r.category, total: 0, working: 0, testing: 0, faulty: 0, rma: 0, tl: 0 };
      byProduct[r.product].total++;
      const c = r.condition || '';
      if (!c)                    byProduct[r.product].working++;
      else if (c === 'needs-testing') byProduct[r.product].testing++;
      else if (c === 'faulty')   byProduct[r.product].faulty++;
      else if (c === 'rma')      byProduct[r.product].rma++;
      else if (c === 'fail-tl')  byProduct[r.product].tl++;
    });

    const rows = Object.values(byProduct).sort((a, b) => a.product.localeCompare(b.product));

    function cell(n, cls) {
      return n > 0
        ? `<td class="bd-nonzero ${cls}">${n}</td>`
        : `<td class="bd-zero">—</td>`;
    }

    tbody.innerHTML = rows.map(p => `
      <tr data-product="${esc(p.product)}" class="${_invProductFilter === p.product ? 'bd-row-active' : ''}">
        <td style="font-weight:500">${esc(p.product)}</td>
        <td><span class="cat-badge">${esc(p.category||'—')}</span></td>
        <td class="bd-total">${p.total}</td>
        <td class="bd-working">${p.working}</td>
        ${cell(p.testing, 'bd-testing')}
        ${cell(p.faulty,  'bd-faulty')}
        ${cell(p.rma,     'bd-rma')}
        ${cell(p.tl,      'bd-tl')}
        <td><button class="bd-filter-btn" data-product="${esc(p.product)}" title="Show serials for this product">${_invProductFilter === p.product ? "▲" : "▼"}</button></td>
      </tr>`).join('');

    // Totals row
    const tot = rows.reduce((a,p) => ({ total: a.total+p.total, working: a.working+p.working, testing: a.testing+p.testing, faulty: a.faulty+p.faulty, rma: a.rma+p.rma, tl: a.tl+p.tl }), { total:0, working:0, testing:0, faulty:0, rma:0, tl:0 });
    const tfoot = tbody.parentNode.querySelector('tfoot') || (() => { const tf = document.createElement('tfoot'); tbody.parentNode.appendChild(tf); return tf; })();
    tfoot.innerHTML = `<tr class="bd-tfoot">
      <td colspan="2" style="padding:9px 12px;">Total</td>
      <td class="bd-total">${tot.total}</td>
      <td class="bd-working">${tot.working}</td>
      ${cell(tot.testing,'bd-testing')}${cell(tot.faulty,'bd-faulty')}${cell(tot.rma,'bd-rma')}${cell(tot.tl,'bd-tl')}
      <td></td>
    </tr>`;

    if (footer) footer.textContent = `${rows.length} product line${rows.length!==1?'s':''} · ${tot.total} units in stock · ${tot.working} working`;

    // Row click → filter serial table
    tbody.querySelectorAll('tr[data-product]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.classList.contains('bd-filter-btn')) return; // let button handle
        _invProductFilter = _invProductFilter === tr.dataset.product ? '' : tr.dataset.product;
        renderStockBreakdown();
        renderStockList();
        if (_invProductFilter) {
          setTimeout(() => {
            const serialPanel = document.getElementById('inv-serial-panel');
            if (serialPanel) serialPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      });
    });
    tbody.querySelectorAll('.bd-filter-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _invProductFilter = _invProductFilter === btn.dataset.product ? '' : btn.dataset.product;
        renderStockBreakdown();
        renderStockList();
        // Scroll to serial panel so user sees the filtered results
        if (_invProductFilter) {
          setTimeout(() => {
            const serialPanel = document.getElementById('inv-serial-panel');
            if (serialPanel) serialPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      });
    });

    // Show/hide clear button
    const clearBtn = document.getElementById('btn-clear-product-filter');
    if (clearBtn) {
      clearBtn.style.display = _invProductFilter ? '' : 'none';
      clearBtn.onclick = () => { _invProductFilter = ''; renderStockBreakdown(); renderStockList(); };
    }
    // Update serial panel title
    const titleEl = document.getElementById('inv-serial-title');
    if (titleEl) titleEl.textContent = _invProductFilter ? `Serials — ${_invProductFilter}` : 'All serials';
  }

  function renderStockList() {
    const search  = (document.getElementById('inv-search').value || '').toLowerCase();
    const catF    = document.getElementById('inv-cat-filter').value;
    const locF    = document.getElementById('inv-loc-filter').value;
    const statusF = document.getElementById('inv-status-filter').value;
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    const canEdit = typeof Auth !== 'undefined' && Auth.canEdit();
    // Serials staged for pending deployment (show badge in stock list)
    const _pendingDeploySerials = typeof Inventory !== 'undefined' && Inventory.getPendingDeploymentSerials
      ? Inventory.getPendingDeploymentSerials() : new Set();

    let rows = Inventory.getAllSerialRows().filter(r => {
      const ms = !search || r.serial.toLowerCase().includes(search) || r.product.toLowerCase().includes(search) || r.location.toLowerCase().includes(search);
      const mc = !catF   || r.category === catF;
      const ml = !locF   || r.location === locF;
      const mp = !_invProductFilter || r.product === _invProductFilter;
      // Status filter handles both stock status and condition/used flags
      let mst = true;
      if (statusF) {
        if (statusF === 'working') {
          mst = r.status === 'in-stock' && !r.condition;
        } else if (statusF === 'cond-used') {
          mst = r.used === true;
        } else if (statusF.startsWith('cond-')) {
          mst = r.condition === statusF.replace('cond-', '');
        } else {
          mst = r.status === statusF;
        }
      }
      return ms && mc && ml && mst && mp;
    });

    const totalCost   = rows.filter(r => r.cost != null).reduce((a, r) => a + r.cost, 0);
    const costedCount = rows.filter(r => r.cost != null).length;

    // Editors and admins get an action column (edit serial / delete)
    const showActions = isAdmin || canEdit;

    // Update table header to show/hide action column
    const thead = document.querySelector('#v-stock-list table thead tr');
    if (thead) {
      const existingAdminTh = thead.querySelector('.th-admin');
      if (showActions && !existingAdminTh) {
        const th = document.createElement('th');
        th.className = 'th-admin';
        th.style.width = '70px';
        thead.appendChild(th);
      } else if (!showActions && existingAdminTh) {
        existingAdminTh.remove();
      }
    }

    const tbody = document.getElementById('inv-body');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${showActions ? 7 : 6}"><div class="empty">No items found</div></td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const isPOLocked = !!r.poNumber;
        const canEditSerial = isAdmin || (canEdit && Inventory.isSerialEditable(r.product));
        return `<tr data-serial="${esc(r.serial)}">
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${
            r.serial.startsWith('NS-')
              ? (canEdit && r.status === 'in-stock'
                  ? `<span class="add-serial-cell" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" style="font-family:var(--font);color:var(--aio-purple);font-size:11px;cursor:pointer;" title="Assign a serial number to this item">+ Add serial</span>`
                  : `<span style="font-family:var(--font);color:var(--text-hint);font-style:italic;font-size:11px;">No serial</span>`)
              : esc(r.serial)
          }</td>
          <td style="font-weight:500">${esc(r.product)}</td>
          <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
          <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
          <td>
            <span class="badge ${r.status==='in-stock'?'b-ok':'b-transit'}">${r.status==='in-stock'?'In stock':'In transit'}</span>
            ${r.used ? '<span class="badge b-used" style="margin-left:4px;">USED</span>' : ''}
            ${r.condition ? `<span class="badge b-condition b-cond-${r.condition}" style="margin-left:4px;">${_conditionLabel(r.condition)}</span>` : ''}
            ${_pendingDeploySerials.has(r.serial.toUpperCase()) ? '<span class="badge-pending-deploy" style="margin-left:4px;">📋 Pending Deploy</span>' : ''}
          </td>
          <td class="${isPOLocked ? 'cost-cell-locked' : 'cost-cell'}"
            data-product="${esc(r.product)}" data-serial="${esc(r.serial)}"
            style="cursor:${isPOLocked ? 'default' : 'pointer'};"
            ${isPOLocked ? '' : `title="Click to edit — updates all ${esc(r.product)} units"`}>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${r.cost != null
                ? `<span class="cost-val">$${r.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`
                : `<span style="color:var(--text-hint);font-size:11px">${isPOLocked ? '—' : '+ Add cost'}</span>`}
              ${isPOLocked ? `<span class="po-lock-badge" title="Price locked to PO: ${esc(r.poNumber)}">🔒 ${esc(r.poNumber)}</span>` : ''}
            </div>
          </td>
          ${showActions ? `<td style="white-space:nowrap;text-align:right;">
            ${canEditSerial ? `<button class="btn-icon-edit" data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" title="Edit serial number">✎</button>` : ''}
            ${isAdmin ? `<button class="btn-icon-del"  data-serial="${esc(r.serial)}" data-product="${esc(r.product)}" title="Delete this item" style="margin-left:4px;">✕</button>` : ''}
          </td>` : ''}
        </tr>`;
      }).join('');

      // Cost cell inline editor
      tbody.querySelectorAll('.cost-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          if (cell.querySelector('input')) return;
          const product = cell.dataset.product;
          const serial  = cell.dataset.serial;
          const cur = DB.getSerialCost(serial);
          cell.innerHTML = `<div style="display:flex;align-items:center;gap:4px;">
            <input class="serial-cost-input" type="number" min="0" step="0.01"
              value="${cur != null ? cur : ''}" placeholder="0.00" style="width:85px;" />
            <span style="font-size:10px;color:var(--aio-purple);white-space:nowrap">all ${esc(product)}</span>
          </div>`;
          const inp = cell.querySelector('input');
          inp.focus(); inp.select();
          const save = () => {
            const cost = inp.value !== '' ? parseFloat(inp.value) : null;
            DB.setProductCost(product, cost, Inventory.getInventoryMap());
            renderStockList();
          };
          inp.addEventListener('blur', save);
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
            if (e.key === 'Escape') { inp.removeEventListener('blur', save); renderStockList(); }
          });
        });
      });

      // Add serial to a no-serial (placeholder) item
      tbody.querySelectorAll('.add-serial-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          _showEditSerialModal(cell.dataset.serial, cell.dataset.product, true);
        });
      });

      // Admin: edit serial
      tbody.querySelectorAll('.btn-icon-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const oldSerial = btn.dataset.serial;
          const product   = btn.dataset.product;
          _showEditSerialModal(oldSerial, product);
        });
      });

      // Admin: delete serial
      tbody.querySelectorAll('.btn-icon-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const serial  = btn.dataset.serial;
          const product = btn.dataset.product;
          if (!confirm(`Delete serial "${serial}" (${product})?\n\nThis will remove it from stock permanently.`)) return;
          DB.deleteSerial(serial);
          renderStockList();
          showAlert(`Serial ${serial} deleted`, 'success');
        });
      });
    }

    const footer = document.getElementById('inv-footer');
    footer.textContent = rows.length
      ? `${rows.length} serial${rows.length!==1?'s':''} shown${costedCount > 0 ? ` · Total cost: $${totalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${costedCount} priced)` : ' · Click any cost cell to add/edit price'}`
      : '';


  }

  // ── Populate category dropdowns from CATEGORIES constant ─────────────
  function populateCategoryFilters() {
    const cats = CATEGORIES;
    ['inv-cat-filter','dep-cat-filter','hist-cat-filter'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">All categories</option>' +
        cats.map(c => `<option value="${esc(c)}"${c===cur?' selected':''}>${esc(c)}</option>`).join('');
    });
  }

  function populateStockListFilters() {
    populateCategoryFilters();
    const locs = Inventory.getLocations();
    const sel  = document.getElementById('inv-loc-filter');
    const cur  = sel.value;
    sel.innerHTML = '<option value="">All locations</option>' + locs.map(l => `<option value="${esc(l)}"${l===cur?' selected':''}>${esc(l)}</option>`).join('');
  }

  // ── History ───────────────────────────────────────────────────────────
  function renderHistory() {
    const search   = (document.getElementById('hist-search').value || '').toLowerCase();
    const typeF    = document.getElementById('hist-type-filter').value;
    const catF     = document.getElementById('hist-cat-filter').value;
    const dateFrom = document.getElementById('hist-date-from').value;
    const dateTo   = document.getElementById('hist-date-to').value;
    const { movements } = DB.getData();

    let rows = [...movements].reverse().filter(m => {
      const mt = !typeF  || m.type === typeF;
      const mc = !catF   || m.category === catF;
      const ms = !search || m.product.toLowerCase().includes(search) || (m.customer||'').toLowerCase().includes(search) || (m.supplier||'').toLowerCase().includes(search) || (m.ref||'').toLowerCase().includes(search) || (m.location||'').toLowerCase().includes(search) || (m.receivedBy||'').toLowerCase().includes(search) || m.serials.some(s => s.toLowerCase().includes(search));
      const mdf= !dateFrom || m.date.slice(0,10) >= dateFrom;
      const mdt= !dateTo   || m.date.slice(0,10) <= dateTo;
      return mt && mc && ms && mdf && mdt;
    });

    const totalIn  = rows.filter(m => m.type==='IN').reduce((a,m) => a+m.serials.length, 0);
    const totalOut = rows.filter(m => m.type==='OUT').reduce((a,m) => a+m.serials.length, 0);
    document.getElementById('hist-summary').textContent = rows.length
      ? `${rows.length} movement${rows.length!==1?'s':''} · ${totalIn} received · ${totalOut} dispatched`
      : '';

    const tbody = document.getElementById('hist-body');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty">No movements found</div></td></tr>'; return; }
    tbody.innerHTML = rows.map((m, i) => {
      const party   = m.type==='IN' ? (m.supplier||'—') : (m.customer||'—');
      const preview = m.serials.slice(0,3).join(', ') + (m.serials.length>3 ? ` +${m.serials.length-3}` : '');
      const actor = m.type==='IN' ? (m.receivedBy||'—') : (m.by||'—');
      const dl = m.serials.length ? `<button class="btn btn-ghost btn-sm batch-dl" data-idx="${i}" title="Download all ${m.serials.length} serial number${m.serials.length!==1?'s':''} as CSV" style="margin-left:8px;white-space:nowrap;">⬇ CSV</button>` : '';
      return `<tr title="${esc(m.serials.join(', '))}">
        <td style="color:var(--text-hint)">${fmtDateFull(m.date)}</td>
        <td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span></td>
        <td style="font-weight:500">${esc(m.product)}</td>
        <td><span class="cat-badge">${esc(m.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(m.location||'—')}</span></td>
        <td>${m.serials.length}</td>
        <td>${esc(party)}</td>
        <td style="font-size:12px;color:var(--text-muted)">${esc(actor)}</td>
        <td class="serial-mono"><span>${esc(preview)}</span>${dl}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button.batch-dl').forEach(btn => {
      btn.addEventListener('click', () => downloadBatchSerials(rows[parseInt(btn.dataset.idx, 10)]));
    });
  }

  function downloadBatchSerials(m) {
    if (!m || !m.serials.length) return;
    const csvRows = [['Serial Number'], ...m.serials.map(s => [s])];
    const safe = (m.product || 'batch').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    _dlCSV(csvRows, `serials_${safe}_${(m.date || '').slice(0,10)}.csv`);
  }

  // ── Serial Lookup ─────────────────────────────────────────────────────
  function renderLookup(raw) {
    const res = document.getElementById('lookup-result');
    if (!raw || !raw.trim()) { res.innerHTML = '<div class="empty">Enter a serial number above</div>'; return; }
    const info = Inventory.getSerialInfo(raw);
    const cost = DB.getSerialCost(raw);
    const costStr = cost != null ? `$${cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—';
    if (info.history.length === 0 && info.status === 'unknown') {
      res.innerHTML = `<div class="lookup-not-found">Serial <code>${esc(info.serial)}</code> not found in any record.</div>`;
      return;
    }
    const statusBadge = info.status==='in-stock' ? '<span class="badge b-ok">In stock</span>' : info.status==='in-transit' ? '<span class="badge b-transit">In transit</span>' : '<span class="badge b-out">Dispatched</span>';
    const pendingBadge = info.pendingDeployment ? '<span class="badge-pending-deploy">📋 Pending Deploy</span>' : '';
    const condBadge = info.condition ? `<span class="badge b-condition b-cond-${info.condition}">${_conditionLabel(info.condition)}</span>` : '';
    const usedBadge = info.used ? '<span class="badge b-used">USED</span>' : '';
    const pd = info.pendingDeployment;
    res.innerHTML = `
      <div class="lookup-status-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
          <span style="font-family:var(--mono);font-size:15px;font-weight:600">${esc(info.serial)}</span>${statusBadge}${pendingBadge}${condBadge}${usedBadge}
          ${cost != null ? `<span style="font-size:12px;color:var(--text-muted)">Cost: <strong>${costStr}</strong></span>` : ''}
        </div>
        <div class="lookup-meta">
          <div><div class="lookup-meta-label">Product</div>${esc(info.currentProduct||'—')}</div>
          <div><div class="lookup-meta-label">Location</div><span class="loc-badge">${esc(info.currentLocation||'—')}</span></div>
          <div><div class="lookup-meta-label">Category</div>${esc(info.currentCategory||'—')}</div>
          ${info.poNumber ? `<div><div class="lookup-meta-label">PO Number</div>${esc(info.poNumber)}</div>` : ''}
        </div>
        ${pd ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">📋 Staged for: <strong>${esc(pd.customer||'—')}</strong>${pd.by?` · by ${esc(pd.by)}`:''}${pd.ref?` · ref ${esc(pd.ref)}`:''}${pd.stagedAt?` · ${fmtDateFull(pd.stagedAt)}`:''}</div>` : ''}
        ${info.testedBy ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">Tested by <strong>${esc(info.testedBy)}</strong>${info.testedAt?` on ${fmtDateFull(info.testedAt)}`:''}${info.testNotes?` — ${esc(info.testNotes)}`:''}</div>` : ''}
        ${info.status==='dispatched' ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">${info.rmaTlType?`<span class="badge b-condition b-cond-${info.rmaTlType}">${_conditionLabel(info.rmaTlType)}</span> `:''}Dispatched to: <strong>${esc(info.deployedTo||'—')}</strong>${info.deployedBy?` · by ${esc(info.deployedBy)}`:''}${info.deployedRef?` · ref ${esc(info.deployedRef)}`:''}${info.deployedDate?` · ${fmtDateFull(info.deployedDate)}`:''}</div>` : ''}
      </div>
      ${info.history.length ? `<div class="panel" style="margin-bottom:0">
        <div class="panel-title">Movement history</div>
        <table><thead><tr><th style="width:18%">Date</th><th style="width:10%">Type</th><th style="width:22%">Product</th><th style="width:18%">Location</th><th style="width:18%">Party</th><th style="width:14%">Ref</th></tr></thead>
        <tbody>${info.history.map(m=>`<tr><td style="color:var(--text-hint)">${fmtDateFull(m.date)}</td><td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span></td><td>${esc(m.product)}</td><td><span class="loc-badge">${esc(m.location||'—')}</span></td><td>${esc(m.type==='IN'?(m.supplier||'—'):(m.customer||'—'))}</td><td style="color:var(--text-hint)">${esc(m.ref||'—')}</td></tr>`).join('')}</tbody></table>
      </div>` : ''}`;
  }

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

  // ── CSV exports ───────────────────────────────────────────────────────
  function exportInventoryCSV() {
    const rows = [['Serial Number','Product','Category','Location','Status','Cost','PO Number']];
    Inventory.getAllSerialRows().forEach(r => {
      rows.push([r.serial, r.product, r.category, r.location, r.status, r.cost != null ? r.cost : '', r.poNumber || '']);
    });
    _dlCSV(rows, 'aio_stock.csv');
  }

  function exportHistoryCSV() {
    const { movements } = DB.getData();
    const rows = [['Date','Type','Product','Category','Location','Qty','Supplier / Customer','Received By','Reference','Serials']];
    [...movements].reverse().forEach(m => rows.push([fmtDateFull(m.date), m.type, m.product, m.category||'', m.location||'', m.serials.length, m.type==='IN'?(m.supplier||''):(m.customer||''), m.type==='IN'?(m.receivedBy||''):(m.by||''), m.ref||'', m.serials.join(' | ')]));
    _dlCSV(rows, 'aio_history.csv');
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

  // ── Admin: edit serial modal ──────────────────────────────────────────
  function _showEditSerialModal(oldSerial, product, isAdd = false) {
    const existing = document.getElementById('edit-serial-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'edit-serial-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:420px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>${isAdd ? 'Add serial number' : 'Edit serial number'}</span>
          <button class="btn-remove-row" id="edit-serial-close">×</button>
        </div>
        <div class="form-group" style="margin-bottom:6px;">
          <label class="form-label">Product</label>
          <div style="font-size:13px;font-weight:500;color:var(--text);padding:6px 0;">${esc(product)}</div>
        </div>
        ${isAdd ? '' : `
        <div class="form-group" style="margin-bottom:6px;">
          <label class="form-label">Current serial</label>
          <div style="font-family:var(--mono);font-size:13px;color:var(--text-muted);padding:6px 0;">${esc(oldSerial)}</div>
        </div>`}
        <div class="form-group" style="margin-bottom:1.25rem;">
          <label class="form-label">${isAdd ? 'Serial number *' : 'New serial number *'}</label>
          <input class="fi fi-mono" id="edit-serial-input" value="${isAdd ? '' : esc(oldSerial)}" placeholder="Enter ${isAdd ? 'or scan the ' : 'correct '}serial number" />
          ${isAdd ? '<div class="hint">Scan or type the serial, then check it before clicking Save.</div>' : ''}
        </div>
        <div id="edit-serial-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="edit-serial-cancel">Cancel</button>
          <button class="btn btn-primary" id="edit-serial-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const input  = document.getElementById('edit-serial-input');
    const errEl  = document.getElementById('edit-serial-error');
    const close  = () => modal.remove();

    document.getElementById('edit-serial-close').addEventListener('click', close);
    document.getElementById('edit-serial-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    setTimeout(() => { input.focus(); input.select(); }, 50);

    document.getElementById('edit-serial-save').addEventListener('click', () => {
      const newSerial = input.value.trim().toUpperCase();
      errEl.style.display = 'none';

      if (!newSerial) { errEl.textContent = 'Serial number is required.'; errEl.style.display = 'block'; return; }
      if (newSerial === oldSerial) { close(); return; }

      // Check the new serial isn't already in use ANYWHERE — not just in stock.
      // A serial that is deployed / RMA / total-loss lives in an OUT movement and
      // is netted out of stock, so an in-stock-only check silently misses it and
      // renaming onto it makes the unit vanish (IN nets against the existing OUT).
      const usage = Inventory.getSerialInfo(newSerial);
      if (usage.status !== 'unknown') {
        const where =
          usage.status === 'dispatched'  ? (usage.deployedTo ? `already deployed to ${usage.deployedTo}` : 'already deployed to a customer')
        : usage.status === 'in-transit'  ? 'already in transit'
        : usage.status === 'in-stock'    ? `already in stock${usage.currentLocation ? ' at ' + usage.currentLocation : ''}`
        : 'already in use';
        errEl.textContent = `Serial "${newSerial}" is ${where}. Every serial must be unique — pick a different one.`;
        errEl.style.display = 'block';
        return;
      }

      DB.renameSerial(oldSerial, newSerial);
      close();
      renderStockList();
      showAlert(isAdd ? `Serial added: ${newSerial}` : `Serial updated: ${oldSerial} → ${newSerial}`, 'success');
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // In add mode a scanner appends Enter after the serial — don't auto-submit
        // so the user can verify the captured value before clicking Save.
        if (!isAdd) document.getElementById('edit-serial-save').click();
      }
      if (e.key === 'Escape') close();
    });
  }

  // ── Condition flag helpers ─────────────────────────────────────────────
  function _conditionLabel(c) {
    return { 'used': 'USED', 'faulty': '⚠ FAULTY', 'needs-testing': '🔬 TESTING', 'rma': '⛔ RMA', 'fail-tl': '🗑 TL' }[c] || c.toUpperCase();
  }

  // ── Servicing view ─────────────────────────────────────────────────────
  function renderServicing() {
    const search  = (document.getElementById('svc-search')?.value || '').toLowerCase();
    const flagF   = document.getElementById('svc-flag-filter')?.value || '';
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    const canEdit = typeof Auth !== 'undefined' && Auth.canEdit();

    // All workshop items (any condition except 'used')
    const allWorkshopRows = Inventory.getAllSerialRows().filter(r => r.condition && r.condition !== 'used');

    // ── Stats & breakdown panels ───────────────────────────────────────
    const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
    const CONDITIONS = [
      { key: 'needs-testing', label: '🔬 Needs Testing', cls: 'svc-stat-testing' },
      { key: 'faulty',        label: '⚠ Faulty',        cls: 'svc-stat-faulty'  },
      { key: 'rma',           label: '⛔ RMA',           cls: 'svc-stat-rma'    },
      { key: 'fail-tl',       label: '🗑 Total Loss',    cls: 'svc-stat-tl'     },
    ];
    const condTotals = {};
    CONDITIONS.forEach(c => { condTotals[c.key] = { count: 0, value: 0 }; });
    allWorkshopRows.forEach(r => {
      if (condTotals[r.condition]) {
        condTotals[r.condition].count++;
        if (r.cost != null) condTotals[r.condition].value += r.cost;
      }
    });
    const totalCount = allWorkshopRows.length;
    const totalValue = allWorkshopRows.reduce((a, r) => a + (r.cost || 0), 0);

    const statsPanel = document.getElementById('svc-stats-panel');
    if (statsPanel) {
      statsPanel.innerHTML = `
        <div class="panel-title" style="margin-bottom:10px;">Workshop summary</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div class="svc-stat-card svc-stat-total">
            <div class="svc-stat-count">${totalCount}</div>
            <div class="svc-stat-label">Total in workshop</div>
            <div class="svc-stat-value">${fmt$(totalValue)}</div>
          </div>
          ${CONDITIONS.map(c => `
          <div class="svc-stat-card ${c.cls}">
            <div class="svc-stat-count">${condTotals[c.key].count}</div>
            <div class="svc-stat-label">${c.label}</div>
            <div class="svc-stat-value">${fmt$(condTotals[c.key].value)}</div>
          </div>`).join('')}
        </div>`;
    }

    // ── Per-product breakdown ──────────────────────────────────────────
    const prodMap = {};
    allWorkshopRows.forEach(r => {
      if (!prodMap[r.product]) prodMap[r.product] = { product: r.product, category: r.category, 'needs-testing': 0, faulty: 0, rma: 0, 'fail-tl': 0, total: 0, value: 0 };
      if (prodMap[r.product][r.condition] !== undefined) prodMap[r.product][r.condition]++;
      prodMap[r.product].total++;
      if (r.cost != null) prodMap[r.product].value += r.cost;
    });
    const prodRows = Object.values(prodMap).sort((a, b) => b.total - a.total);
    const breakdownPanel = document.getElementById('svc-breakdown-panel');
    const breakdownTable = document.getElementById('svc-breakdown-table');
    if (breakdownPanel && breakdownTable) {
      if (prodRows.length) {
        breakdownPanel.style.display = '';
        breakdownTable.innerHTML = `<table class="product-stock-table">
          <thead><tr>
            <th style="width:28%">Product</th>
            <th style="width:14%">Category</th>
            <th style="width:12%">🔬 Testing</th>
            <th style="width:10%">⚠ Faulty</th>
            <th style="width:10%">⛔ RMA</th>
            <th style="width:10%">🗑 TL</th>
            <th style="width:8%">Total</th>
            <th style="width:8%">Value</th>
          </tr></thead>
          <tbody>
            ${prodRows.map(p => `<tr>
              <td style="font-weight:500">${esc(p.product)}</td>
              <td><span class="cat-badge">${esc(p.category||'—')}</span></td>
              <td>${p['needs-testing'] > 0 ? `<span class="cond-inline cond-inline-testing">${p['needs-testing']}</span>` : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p.faulty    > 0 ? `<span class="cond-inline cond-inline-faulty">${p.faulty}</span>`         : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p.rma       > 0 ? `<span class="cond-inline cond-inline-rma">${p.rma}</span>`               : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td>${p['fail-tl']> 0 ? `<span class="cond-inline cond-inline-tl">${p['fail-tl']}</span>`        : '<span style="color:var(--text-hint)">—</span>'}</td>
              <td style="font-weight:600">${p.total}</td>
              <td style="font-weight:600;color:var(--aio-purple)">${fmt$(p.value)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--aio-purple-light);">
              <td colspan="2" style="font-weight:700;font-size:12px;color:var(--text-muted);padding-top:8px;">Total</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['needs-testing'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['faulty'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['rma'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${condTotals['fail-tl'].count||'—'}</td>
              <td style="padding-top:8px;font-weight:700">${totalCount}</td>
              <td style="padding-top:8px;font-weight:700;color:var(--aio-purple)">${fmt$(totalValue)}</td>
            </tr>
          </tfoot>
        </table>`;
      } else {
        breakdownPanel.style.display = 'none';
      }
    }

    // ── Serial table (filtered) ────────────────────────────────────────
    const rows = allWorkshopRows.filter(r => {
      const mf = !flagF  || r.condition === flagF;
      const ms = !search || r.serial.toLowerCase().includes(search)
                         || r.product.toLowerCase().includes(search)
                         || (r.location||'').toLowerCase().includes(search);
      return mf && ms;
    });

    const tbody = document.getElementById('svc-body');
    const footer = document.getElementById('svc-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty">${flagF || search ? 'No matching items' : 'No items in servicing'}</div></td></tr>`;
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => `<tr>
      <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
      <td style="font-weight:500">${esc(r.product)}</td>
      <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
      <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
      <td><span class="badge b-condition b-cond-${r.condition}">${_conditionLabel(r.condition)}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$'+r.cost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes)}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
      <td style="text-align:right;">
        ${canEdit ? `<button class="btn btn-primary btn-xs svc-test-btn"
          data-serial="${esc(r.serial)}"
          data-product="${esc(r.product)}"
          data-condition="${esc(r.condition)}">
          Log outcome
        </button>` : ''}
      </td>
    </tr>`).join('');

    if (footer) footer.textContent = `${rows.length} item${rows.length!==1?'s':''} shown · ${totalCount} total in workshop · Value: ${fmt$(totalValue)}`;

    // Wire test outcome buttons
    tbody.querySelectorAll('.svc-test-btn').forEach(btn => {
      btn.addEventListener('click', () => _showTestOutcomeModal(btn.dataset.serial, btn.dataset.product, btn.dataset.condition));
    });
  }

  // ── Test outcome modal ─────────────────────────────────────────────────
  async function _showTestOutcomeModal(serial, product, currentCondition) {
    const existing = document.getElementById('svc-modal');
    if (existing) existing.remove();

    // Load users for the "tested by" dropdown
    let users = [];
    try { users = await UserManager.listUsers(); } catch(e) {}
    const currentUser = typeof Auth !== 'undefined' ? Auth.getName() : '';
    const today = new Date().toISOString().slice(0,10);

    const modal = document.createElement('div');
    modal.id = 'svc-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:480px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>Log test outcome</span>
          <button class="btn-remove-row" id="svc-modal-close">×</button>
        </div>

        <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px;margin-bottom:1.25rem;">
          <div style="font-size:11px;color:var(--text-hint);margin-bottom:3px;">Item</div>
          <div style="font-weight:600;font-size:13px;">${esc(product)}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(serial)}</div>
          <div style="margin-top:6px;"><span class="badge b-condition b-cond-${currentCondition}">${_conditionLabel(currentCondition)}</span></div>
        </div>

        <div class="form-grid g2" style="margin-bottom:1rem;">
          <div class="form-group">
            <label class="form-label">Tested by *</label>
            <select class="fi" id="svc-tested-by">
              ${users.length
                ? users.map(u => `<option value="${esc(u.name)}"${u.name===currentUser?' selected':''}>${esc(u.name)}</option>`).join('')
                : `<option value="${esc(currentUser)}">${esc(currentUser)}</option>`}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Test date *</label>
            <input class="fi" type="date" id="svc-tested-date" value="${today}" />
          </div>
        </div>

        <div class="form-group" style="margin-bottom:1.25rem;">
          <label class="form-label">Outcome notes</label>
          <textarea class="fi" id="svc-test-notes" rows="3"
            placeholder="Describe what was tested and any findings..."
            style="resize:vertical;font-size:13px;"></textarea>
        </div>

        <div class="form-group" style="margin-bottom:1.5rem;">
          <label class="form-label">Test result *</label>
          <div class="condition-flags">
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="pass" checked />
              <span style="color:var(--success-text);">✓ Pass — clear flag</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="rma" />
              <span style="color:var(--danger-text);">⛔ Fail - RMA</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="svc-outcome" value="fail-tl" />
              <span style="color:var(--danger-text);">🗑 Fail - TL</span>
            </label>
          </div>
        </div>

        <div id="svc-modal-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="svc-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="svc-modal-save">Save outcome</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    document.getElementById('svc-modal-close').addEventListener('click', close);
    document.getElementById('svc-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    document.getElementById('svc-modal-save').addEventListener('click', () => {
      const testedBy   = document.getElementById('svc-tested-by').value.trim();
      const testedDate = document.getElementById('svc-tested-date').value;
      const notes      = document.getElementById('svc-test-notes').value.trim();
      const outcome    = document.querySelector('input[name="svc-outcome"]:checked')?.value;
      const errEl      = document.getElementById('svc-modal-error');

      if (!testedBy)   { errEl.textContent = 'Please select who tested this item.'; errEl.style.display='block'; return; }
      if (!testedDate) { errEl.textContent = 'Please enter the test date.'; errEl.style.display='block'; return; }

      const newCondition = outcome === 'rma' ? 'rma' : outcome === 'fail-tl' ? 'fail-tl' : '';  // db.js preserves USED
      DB.updateSerialCondition(serial, newCondition, testedBy, testedDate, notes);

      close();
      renderServicing();
      if (outcome === 'rma') {
        showAlert(`${serial} marked as RMA`, 'success');
      } else if (outcome === 'fail-tl') {
        showAlert(`${serial} marked as Total Loss`, 'success');
      } else {
        showAlert(`${serial} passed testing — flag cleared`, 'success');
      }
    });
  }

  // ── RMA view ───────────────────────────────────────────────────────────
  function renderRMA() {
    const search  = (document.getElementById('rma-search')?.value || '').toLowerCase();
    const statusF = document.getElementById('rma-status-filter')?.value || '';

    // Build full RMA list — serials that were ever flagged as RMA
    const { movements } = DB.getData();
    const serialInMovement = {};
    movements.forEach(mv => {
      if (mv.type === 'IN') mv.serials.forEach(s => { serialInMovement[s.toUpperCase()] = mv; });
    });

    // All serials currently flagged rma and still in stock = "To Return"
    const inStockRMA = Inventory.getAllSerialRows().filter(r => r.condition === 'rma');

    // Serials that were ever rma but are no longer in stock = "Returned"
    const availableSet = Inventory.getAvailableSerials();
    const returnedRMA = [];
    Object.entries(serialInMovement).forEach(([serial, mv]) => {
      if (mv.condition === 'rma' && !availableSet.has(serial)) {
        // Find the OUT movement for this serial
        const outMv = [...movements].reverse().find(m => m.type === 'OUT' && m.serials.some(s => s.toUpperCase() === serial));
        returnedRMA.push({
          serial,
          product:   mv.product,
          category:  mv.category || '',
          location:  mv.location || '',
          testedBy:  mv.testedBy  || '',
          testedAt:  mv.testedAt  || '',
          testNotes: mv.testNotes || '',
          returnedDate: outMv?.date || '',
          returnedBy:   outMv?.by  || '',
          returnedTo:   outMv?.customer || '',
        });
      }
    });

    // Combine based on filter
    let rows = [];
    if (!statusF || statusF === 'to-return') {
      inStockRMA.forEach(r => rows.push({ ...r, rmaStatus: 'to-return' }));
    }
    if (!statusF || statusF === 'returned') {
      returnedRMA.forEach(r => rows.push({ ...r, rmaStatus: 'returned' }));
    }

    // Apply search
    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.location||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('rma-body');
    const footer = document.getElementById('rma-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No RMA items found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isReturned = r.rmaStatus === 'returned';
      return `<tr style="${isReturned ? 'opacity:0.65;' : ''}">
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
        <td>
          ${isReturned
            ? '<span class="badge b-ok" style="font-size:9px;">✓ Returned</span>'
            : '<span class="badge b-cond-rma b-condition" style="font-size:9px;">⛔ To Return</span>'}
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes||'')}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint);">${isReturned
          ? (r.returnedDate ? fmtDate(r.returnedDate) : '—') + (r.returnedTo ? `<br><span style="color:var(--text-muted)">${esc(r.returnedTo)}</span>` : '')
          : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    const toReturnCount = rows.filter(r => r.rmaStatus === 'to-return').length;
    const returnedCount = rows.filter(r => r.rmaStatus === 'returned').length;
    if (footer) {
      footer.innerHTML = toReturnCount > 0
        ? `<span style="color:var(--danger-text);font-weight:600;">${toReturnCount} awaiting return</span>${returnedCount > 0 ? ` · ${returnedCount} returned` : ''} · Use <strong>Stock Out</strong> to mark as returned`
        : `<span style="color:var(--success-text);font-weight:600;">${returnedCount} returned</span>`;
    }
  }

  // ── Total Loss view ────────────────────────────────────────────────────
  function renderTotalLoss() {
    const search  = (document.getElementById('tl-search')?.value || '').toLowerCase();
    const statusF = document.getElementById('tl-status-filter')?.value || '';

    const { movements } = DB.getData();
    const serialInMovement = {};
    movements.forEach(mv => {
      if (mv.type === 'IN') mv.serials.forEach(s => { serialInMovement[s.toUpperCase()] = mv; });
    });

    // Items with fail-tl still in stock = "To Write Off"
    const inStockTL = Inventory.getAllSerialRows().filter(r => r.condition === 'fail-tl');

    // Items with fail-tl that have been booked out = "Written Off"
    const availableSet = Inventory.getAvailableSerials();
    const writtenOff = [];
    Object.entries(serialInMovement).forEach(([serial, mv]) => {
      if (mv.condition === 'fail-tl' && !availableSet.has(serial)) {
        const outMv = [...movements].reverse().find(m => m.type === 'OUT' && m.serials.some(s => s.toUpperCase() === serial));
        writtenOff.push({
          serial,
          product:   mv.product,
          category:  mv.category || '',
          location:  mv.location || '',
          testedBy:  mv.testedBy  || '',
          testedAt:  mv.testedAt  || '',
          testNotes: mv.testNotes || '',
          writtenOffDate: outMv?.date || '',
          writtenOffBy:   outMv?.by   || '',
          writtenOffTo:   outMv?.customer || '',
        });
      }
    });

    let rows = [];
    if (!statusF || statusF === 'to-writeoff') inStockTL.forEach(r => rows.push({ ...r, tlStatus: 'to-writeoff' }));
    if (!statusF || statusF === 'written-off') writtenOff.forEach(r => rows.push({ ...r, tlStatus: 'written-off' }));

    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.location||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('tl-body');
    const footer = document.getElementById('tl-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No Total Loss items found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isWrittenOff = r.tlStatus === 'written-off';
      return `<tr style="${isWrittenOff ? 'opacity:0.65;' : ''}">
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
        <td>
          ${isWrittenOff
            ? '<span class="badge b-ok" style="font-size:9px;">✓ Written Off</span>'
            : '<span class="badge b-cond-fail-tl b-condition" style="font-size:9px;">🗑 To Write Off</span>'}
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes||'')}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint);">${isWrittenOff
          ? (r.writtenOffDate ? fmtDate(r.writtenOffDate) : '—') + (r.writtenOffTo ? `<br><span style="color:var(--text-muted)">${esc(r.writtenOffTo)}</span>` : '')
          : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    const toWriteOffCount = rows.filter(r => r.tlStatus === 'to-writeoff').length;
    const writtenOffCount = rows.filter(r => r.tlStatus === 'written-off').length;
    if (footer) {
      footer.innerHTML = toWriteOffCount > 0
        ? `<span style="color:var(--danger-text);font-weight:600;">${toWriteOffCount} awaiting write-off</span>${writtenOffCount > 0 ? ` · ${writtenOffCount} written off` : ''} · Use <strong>Stock Out</strong> to book out`
        : `<span style="color:var(--success-text);font-weight:600;">${writtenOffCount} written off</span>`;
    }
  }

  // ── Stock RMA/TL Dispatched view ────────────────────────────────────────
  function renderRmaTlDispatched() {
    const search = (document.getElementById('rmatldisp-search')?.value || '').toLowerCase();
    const typeF  = document.getElementById('rmatldisp-type-filter')?.value || '';

    let rows = Inventory.getRmaTlDispatchedRows();

    if (typeF) rows = rows.filter(r => r.rmaTlType === typeF);
    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.customer||'').toLowerCase().includes(search) ||
        (r.category||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('rmatldisp-body');
    const footer = document.getElementById('rmatldisp-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty">No RMA / Total Loss dispatches found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isTL = r.rmaTlType === 'fail-tl';
      const typeBadge = isTL
        ? '<span class="badge b-cond-fail-tl b-condition" style="font-size:9px;">🗑 TL</span>'
        : '<span class="badge b-cond-rma b-condition" style="font-size:9px;">⛔ RMA</span>';
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td>${typeBadge}</td>
        <td style="font-size:12px;">${esc(r.customer||'—')}</td>
        <td style="font-size:12px;color:var(--text-muted)">${esc(r.by||'—')}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.date ? fmtDate(r.date) : '—'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    if (footer) {
      const rmaCount = rows.filter(r => r.rmaTlType !== 'fail-tl').length;
      const tlCount  = rows.filter(r => r.rmaTlType === 'fail-tl').length;
      footer.textContent = `${rows.length} dispatched — ${rmaCount} RMA · ${tlCount} Total Loss`;
    }
  }

  // ── Recall to Servicing modal ─────────────────────────────────────────
  function showRecallModal(serial, product, currentLocation) {
    const existing = document.getElementById('recall-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'recall-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:440px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>Recall to Servicing</span>
          <button class="btn-remove-row" id="recall-modal-close">×</button>
        </div>
        <div style="margin-bottom:1rem;font-size:13px;color:var(--text-muted);">
          Returning <strong style="color:var(--text);">${esc(serial)}</strong> (${esc(product)}) from deployment back into stock for servicing.
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Return to location *</label>
          <input class="fi" id="recall-location" placeholder="e.g. SF Warehouse" autocomplete="off" />
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Recalled by</label>
          <input class="fi" id="recall-by" placeholder="e.g. Peter Roberts" />
        </div>
        <div class="form-group" style="margin-bottom:1.5rem;">
          <label class="form-label">Condition on return</label>
          <div class="condition-flags">
            <label class="condition-flag-btn">
              <input type="radio" name="recall-condition" value="needs-testing" checked />
              <span>🔬 Needs Testing</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="recall-condition" value="faulty" />
              <span>⚠ Faulty</span>
            </label>
          </div>
        </div>
        <div id="recall-modal-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="recall-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="recall-modal-confirm">Recall to Servicing</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Init SmartSelect on the location field and pre-fill with current location
    SmartSelect('recall-location', Inventory.getLocations, DB.addCustomLocation);
    const recallLocInput  = document.getElementById('recall-location');
    const recallLocSelect = recallLocInput?.parentNode?.querySelector('.ss-select');
    if (currentLocation && recallLocSelect) {
      const opt = Array.from(recallLocSelect.options).find(o => o.value === currentLocation);
      if (opt) { recallLocSelect.value = currentLocation; }
      recallLocInput.value = currentLocation;
    }

    const close = () => modal.remove();
    document.getElementById('recall-modal-close').addEventListener('click', close);
    document.getElementById('recall-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    document.getElementById('recall-modal-confirm').addEventListener('click', () => {
      const location  = document.getElementById('recall-location').value.trim();
      const recalledBy = document.getElementById('recall-by').value.trim();
      const condition = document.querySelector('input[name="recall-condition"]:checked')?.value || 'needs-testing';
      const errEl     = document.getElementById('recall-modal-error');

      if (!location) { errEl.textContent = 'Location is required.'; errEl.style.display = 'block'; return; }

      try {
        Inventory.recallToServicing(serial, location, condition, recalledBy);
        close();
        renderDeployed();
        showAlert(`${serial} recalled to Servicing at ${location}`, 'success');
      } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    });
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


    return { showAlert, hideAlert, renderDashboard, renderProductList, renderSupplierList, renderOrderList, renderTransitList, renderShipmentHistory, renderStockBreakdown, renderStockList, populateStockListFilters, populateCategoryFilters, renderDeployed, populateDeployedFilters, togglePendingCollapse, setDeployedTab, closeRestaurantDetail, exportDeployedCSV, exportDeployedXLSX, renderHistory, renderLookup, renderServicing, renderRMA, renderTotalLoss, renderRmaTlDispatched, populateDataLists, exportInventoryCSV, exportHistoryCSV, downloadBackup, initSmartSelects, refreshSmartSelects };
})();

