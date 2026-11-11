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

    // ── Lifecycle strip ───────────────────────────────────────────────
    const { orders = [], shipments = [], pendingDeployments = [] } = DB.getData();
    const openPOs = orders.filter(o => o.status === 'pending' || o.status === 'partial');
    const receivedByPO = {};
    movements.forEach(m => {
      if (m.type === 'IN' && !m.isTransfer && m.poNumber) {
        const k = m.poNumber + '||' + m.product;
        receivedByPO[k] = (receivedByPO[k] || 0) + m.serials.length;
      }
    });
    const shippedByPO = {};
    shipments.filter(s => s.status === 'in-transit' && s.poNumber).forEach(s =>
      s.products.forEach(p => { const k = s.poNumber + '||' + p.product; shippedByPO[k] = (shippedByPO[k] || 0) + p.serials.length; }));
    const orderedUnits = openPOs.reduce((a, o) => a + (o.products || []).reduce((b, p) => {
      const k = o.poNumber + '||' + p.product;
      return b + Math.max(0, (parseInt(p.qty) || 0) - (receivedByPO[k] || 0) - (shippedByPO[k] || 0));
    }, 0), 0);
    const openShipments = shipments.filter(s => s.status === 'in-transit');
    const flights = Inventory.getInFlightTransfers();
    const wkRows = Inventory.getAllSerialRows().filter(r => r.condition && r.condition !== 'used'); // same source as Servicing view
    const rmaCount = wkRows.filter(r => r.condition === 'rma').length;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const cols = [
      { label: 'Ordered',    n: orderedUnits,    view: 'orders',     color: 'var(--electric)',     hint: plural(openPOs.length, 'open PO') },
      { label: 'In transit', n: stats.inTransit, view: 'transit',    color: 'var(--aio-orange)',   hint: plural(openShipments.length, 'shipment') + (flights.length ? ` · ${plural(flights.length, 'transfer')}` : '') },
      { label: 'In stock',   n: stats.inStock,   view: 'stock-list', color: 'var(--aio-purple)',   hint: plural(stats.productLines, 'product line') },
      { label: 'Deployed',   n: stats.deployed,  view: 'deployed',   color: 'var(--success-text)', hint: 'with customers' },
      { label: 'Servicing',  n: wkRows.length,   view: 'servicing',  color: 'var(--danger-text)',  hint: rmaCount ? `${rmaCount} RMA` : 'RMA & repair' },
    ];
    const maxN = Math.max(...cols.map(c => c.n), 1);
    document.getElementById('stats-row').innerHTML = `<div class="dash-strip">${cols.map(c => `
      <a class="dash-col" href="#${c.view}" style="--accent:${c.color}">
        <div class="dash-col-head"><span class="dash-dot" style="background:${c.color}"></span>${esc(c.label)}</div>
        <div class="dash-col-n">${c.n.toLocaleString()}</div>
        <div class="dash-col-hint">${esc(c.hint)}</div>
        <div class="dash-track"><div class="dash-fill" style="width:${c.n > 0 ? Math.max(3, c.n / maxN * 100) : 0}%;background:${c.color}"></div></div>
      </a>`).join('')}</div>`;

    // ── Needs attention ───────────────────────────────────────────────
    const ic = {
      box:   '<path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
      truck: '<path d="M2 6h11v10H2zM13 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
      check: '<path d="M5 12l5 5 9-10"/>',
      swap:  '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    };
    const svg = k => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[k]}</svg>`;
    const today = new Date().toISOString().slice(0, 10);
    const att = [];
    lowItems.forEach(v => att.push({ k: 'box', tint: 'low', title: `${v.product} running low`,
      hint: `${v.inStock.size} left · ${v.location || 'no location'} · threshold ${DB.getThreshold(v.product + '||' + v.location)}`, pill: 'Reorder', href: 'orders' }));
    openShipments.slice().sort((x, y) => (x.expectedBy || '9999').localeCompare(y.expectedBy || '9999')).forEach(s => {
      const units = s.products.reduce((a, p) => a + p.serials.length, 0);
      const late = s.expectedBy && s.expectedBy < today;
      att.push({ k: 'truck', tint: 'ship', title: s.poNumber || s.supplier || 'Shipment',
        hint: `${plural(units, 'unit')}${s.expectedBy ? ` · ${late ? 'overdue, was due' : 'ETA'} ${fmtDate(s.expectedBy)}` : ''}`, pill: 'Receive', href: 'transit' });
    });
    pendingDeployments.forEach(d => {
      const n = (d.serials || []).length;
      att.push({ k: 'check', tint: 'dep', title: d.customer || 'Pending deployment', hint: `${n} × ${d.product || 'unit'} staged${d.location ? ' · ' + d.location : ''}`, pill: 'Confirm', href: 'deployed' });
    });
    flights.forEach(t => {
      const n = (t.products || []).reduce((a, p) => a + (p.serials || []).length, 0);
      att.push({ k: 'swap', tint: 'ship', title: `Transfer ${t.from || '?'} → ${t.to || '?'}`, hint: `${plural(n, 'unit')} in flight`, pill: 'View', href: 'transfers' });
    });
    const shown = att.slice(0, 6);
    const attEl = document.getElementById('dash-attention');
    attEl.innerHTML = att.length
      ? shown.map(r => `<div class="dash-row">
          <span class="dash-chip dash-chip-${r.tint}">${svg(r.k)}</span>
          <div class="dash-row-main"><div class="dash-row-title">${esc(r.title)}</div><div class="dash-row-hint">${esc(r.hint)}</div></div>
          <a class="dash-pill dash-pill-${r.tint}" href="#${r.href}">${esc(r.pill)}</a></div>`).join('')
        + (att.length > 6 ? `<div class="dash-more">+${att.length - 6} more</div>` : '')
      : `<div class="dash-row"><span class="dash-chip dash-chip-ok">${svg('check')}</span><div class="dash-row-main"><div class="dash-row-title" style="font-weight:500;color:var(--text-muted)">Nothing needs attention</div></div></div>`;
    document.getElementById('dash-attention-count').textContent = att.length;

    const lowBox = document.getElementById('low-alert-box');
    if (lowBox) lowBox.style.display = 'none';

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
