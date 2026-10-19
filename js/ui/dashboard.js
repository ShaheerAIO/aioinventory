/**
 * ui/dashboard.js — Dashboard view
 */
(() => {
  const { esc, fmtDate } = UI._;

  // ── Dashboard ─────────────────────────────────────────────────────────
  function renderDashboard() {
    UI._._syncTransferBadge();
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
            <th style="width:8%;color:var(--cond-working)" title="Units ready to deploy">✅ Working</th>
            <th style="width:8%;color:var(--cond-testing)" title="Units in needs-testing">🔬 Testing</th>
            <th style="width:7%;color:var(--cond-faulty)" title="Units flagged faulty">⚠ Faulty</th>
            <th style="width:7%;color:var(--cond-rma)" title="Units for return">⛔ RMA</th>
            <th style="width:6%;color:var(--cond-tl)" title="Written off">🗑 TL</th>
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
              <td style="font-size:14px;font-weight:500;color:var(--text)">${fmt$(p.totalCost)}</td>
            </tr>`;}).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--border-md);">
              <td colspan="2" style="font-weight:700;font-size:12px;color:var(--text-muted);padding-top:10px;">Total</td>
              <td style="font-weight:700;font-size:13px;color:var(--success-text);padding-top:10px;">${grandTotalUnits}</td>
              <td style="font-weight:700;font-size:13px;color:#4AA37B;padding-top:10px;">${grandWorking}</td>
              <td style="font-weight:700;font-size:13px;color:#2B4FA8;padding-top:10px;">${grandTesting > 0 ? grandTesting : '—'}</td>
              <td style="font-weight:700;font-size:13px;color:#8A5200;padding-top:10px;">${grandFaulty  > 0 ? grandFaulty  : '—'}</td>
              <td style="font-weight:700;font-size:13px;color:#AC1B02;padding-top:10px;">${grandRMA > 0 ? grandRMA : '—'}</td>
              <td style="font-weight:600;font-size:14px;color:var(--text);padding-top:10px;">${grandTL  > 0 ? grandTL  : '—'}</td>
              <td style="padding-top:10px;"></td>
              <td style="font-weight:600;font-size:14px;color:var(--text);padding-top:10px;">$${grandTotalCost.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
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
              <td style="font-size:14px;font-weight:500;color:var(--text)">${fmt$(p.totalCost)}</td>
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
         ${recent.map(m => `<tr><td style="font-weight:500">${esc(m.product)}</td><td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span>${m.isTransfer?'<span class="badge b-transfer" style="margin-left:3px;">⇄</span>':''}</td><td><span class="loc-badge">${esc(m.location||'—')}</span></td><td style="color:var(--text-hint)">${fmtDate(m.date)}</td></tr>`).join('')}
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

  Object.assign(UI, { renderDashboard });
})();
