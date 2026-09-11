/**
 * reports.js — AIO Inventory Reporting Suite
 * All reports computed from DB + Inventory module.
 */
const Reports = (() => {

  // ── Date helpers ──────────────────────────────────────────────────────
  function inRange(isoDate, from, to) {
    if (!from && !to) return true;
    const d = isoDate ? isoDate.slice(0, 10) : '';
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  }

  function fmt$(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  }

  // ── Data builders ─────────────────────────────────────────────────────

  /** Summary KPIs */
  function buildSummary(from, to) {
    const holdingRows = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock');
    const deployedRows = Inventory.getDeployedSerialRows().filter(r => inRange(r.date, from, to));
    const transitRows = Inventory.getAllSerialRows().filter(r => r.status === 'in-transit');

    const holdingValue  = holdingRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const deployedValue = deployedRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const transitValue  = transitRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const holdingCosted = holdingRows.filter(r => r.cost != null).length;
    const deployedCosted= deployedRows.filter(r => r.cost != null).length;

    return {
      holdingUnits: holdingRows.length,
      holdingValue,
      holdingCosted,
      deployedUnits: deployedRows.length,
      deployedValue,
      deployedCosted,
      transitUnits: transitRows.length,
      transitValue,
    };
  }

  /** Stock value grouped by category */
  function buildByCategory(from, to) {
    const map = {};
    Inventory.getAllSerialRows().filter(r => r.status === 'in-stock').forEach(r => {
      const cat = r.category || 'Uncategorised';
      if (!map[cat]) map[cat] = { category: cat, units: 0, value: 0, costed: 0 };
      map[cat].units++;
      if (r.cost != null) { map[cat].value += r.cost; map[cat].costed++; }
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }

  /** Stock value grouped by product */
  function buildByProduct(from, to) {
    const map = {};
    Inventory.getAllSerialRows().filter(r => r.status === 'in-stock').forEach(r => {
      const k = r.product;
      if (!map[k]) map[k] = { product: k, category: r.category, units: 0, value: 0, costed: 0 };
      map[k].units++;
      if (r.cost != null) { map[k].value += r.cost; map[k].costed++; map[k].avgCost = map[k].value / map[k].costed; }
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }

  /** Low stock items */
  function buildLowStock() {
    return Inventory.getLowStockItems().map(v => {
      const key = v.product + '||' + v.location;
      const threshold = DB.getThreshold(key);
      const gap = threshold - v.inStock.size;
      return { ...v, threshold, gap, inStockCount: v.inStock.size };
    }).sort((a, b) => a.inStockCount - b.inStockCount);
  }

  /** Deployed cost grouped by customer */
  function buildDeployedByCustomer(from, to) {
    const map = {};
    Inventory.getDeployedSerialRows().filter(r => inRange(r.date, from, to)).forEach(r => {
      const k = r.customer || 'Unknown';
      if (!map[k]) map[k] = { customer: k, units: 0, value: 0, costed: 0, firstDate: r.date, lastDate: r.date, products: new Set() };
      map[k].units++;
      map[k].products.add(r.product);
      if (r.cost != null) { map[k].value += r.cost; map[k].costed++; }
      if (r.date < map[k].firstDate) map[k].firstDate = r.date;
      if (r.date > map[k].lastDate)  map[k].lastDate  = r.date;
    });
    return Object.values(map).map(v => ({ ...v, products: v.products.size })).sort((a, b) => b.value - a.value);
  }

  /** Stock holding cost by location */
  function buildHoldingByLocation(from, to) {
    const map = {};
    Inventory.getAllSerialRows().filter(r => r.status === 'in-stock').forEach(r => {
      const k = r.location || 'Unassigned';
      if (!map[k]) map[k] = { location: k, units: 0, value: 0, costed: 0 };
      map[k].units++;
      if (r.cost != null) { map[k].value += r.cost; map[k].costed++; }
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }

  // ── Chart renderer (pure canvas — no deps) ────────────────────────────
  function drawBarChart(canvasId, labels, values, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 20, right: 20, bottom: 60, left: 72 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    // Detect dark mode
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textCol  = isDark ? '#7F8597' : '#888D95';
    const gridCol  = isDark ? '#24334F' : '#E9E9F4';
    const bgCol    = isDark ? '#0F1A2F' : '#ffffff';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, W, H);

    const max = Math.max(...values, 1);
    const barW = Math.floor(chartW / labels.length * 0.6);
    const gap  = Math.floor(chartW / labels.length);

    // Grid lines
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = PAD.top + chartH - (i / steps) * chartH;
      ctx.strokeStyle = gridCol;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
      ctx.fillStyle = textCol;
      ctx.font = '400 11px Poppins, sans-serif';
      ctx.textAlign = 'right';
      const val = (max * i / steps);
      ctx.fillText(val >= 1000 ? '$' + (val/1000).toFixed(1) + 'k' : '$' + val.toFixed(0), PAD.left - 6, y + 3);
    }

    // Bars
    labels.forEach((label, i) => {
      const barH = values[i] > 0 ? Math.max(2, (values[i] / max) * chartH) : 0;
      const x = PAD.left + i * gap + (gap - barW) / 2;
      const y = PAD.top + chartH - barH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [8, 8, 0, 0]) : ctx.rect(x, y, barW, barH);
      ctx.fill();

      // Value label on bar
      if (values[i] > 0) {
        ctx.fillStyle = isDark ? '#F3F5F9' : '#242528';
        ctx.font = '500 11px Poppins, sans-serif';
        ctx.textAlign = 'center';
        const lbl = values[i] >= 1000 ? '$' + (values[i]/1000).toFixed(1)+'k' : '$'+values[i].toFixed(0);
        ctx.fillText(lbl, x + barW / 2, y - 4);
      }

      // X axis label (truncate)
      ctx.fillStyle = textCol;
      ctx.font = '400 11px Poppins, sans-serif';
      ctx.textAlign = 'center';
      const short = label.length > 12 ? label.slice(0, 11) + '…' : label;
      ctx.fillText(short, x + barW / 2, PAD.top + chartH + 16);
    });
  }

  function drawDonutChart(canvasId, labels, values, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.38, cy = H / 2;
    const R = Math.min(cx, cy) - 16;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bgCol  = isDark ? '#0F1A2F' : '#ffffff';
    const textCol= isDark ? '#F3F5F9' : '#242528';
    const mutCol = isDark ? '#7F8597' : '#888D95';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, W, H);

    const total = values.reduce((a, v) => a + v, 0);
    if (total === 0) { ctx.fillStyle = mutCol; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No data', cx, cy); return; }

    let startAngle = -Math.PI / 2;
    values.forEach((v, i) => {
      const slice = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, startAngle, startAngle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      startAngle += slice;
    });

    // Donut hole
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.58, 0, Math.PI * 2); ctx.fillStyle = bgCol; ctx.fill();

    // Centre total
    ctx.fillStyle = textCol; ctx.font = 'bold 13px -apple-system,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(fmt$(total), cx, cy + 5);

    // Legend
    const legX = W * 0.72, legStartY = cy - (labels.length * 18) / 2;
    labels.forEach((lbl, i) => {
      const y = legStartY + i * 20;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(legX - 24, y - 6, 12, 12);
      ctx.fillStyle = mutCol; ctx.font = '10px -apple-system,sans-serif'; ctx.textAlign = 'left';
      const pct = total > 0 ? ((values[i]/total)*100).toFixed(0)+'%' : '0%';
      const short = lbl.length > 16 ? lbl.slice(0,15)+'…' : lbl;
      ctx.fillText(`${short} (${pct})`, legX - 8, y + 4);
    });
  }

  // ── Main render ───────────────────────────────────────────────────────
  /** Tax paid by supplier & period */
  function buildTaxReport(from, to) {
    const orders = DB.getOrders().filter(o => (o.taxAmount||0) > 0 && inRange(o.createdAt, from, to));
    const bySupplier = {};
    orders.forEach(o => {
      if (!bySupplier[o.supplier]) bySupplier[o.supplier] = { supplier: o.supplier, orders: 0, subtotal: 0, taxAmount: 0, total: 0 };
      bySupplier[o.supplier].orders++;
      bySupplier[o.supplier].subtotal  += o.subtotal    || 0;
      bySupplier[o.supplier].taxAmount += o.taxAmount   || 0;
      bySupplier[o.supplier].total     += o.totalWithTax || 0;
    });
    return {
      orders,
      bySupplier: Object.values(bySupplier).sort((a,b) => b.taxAmount - a.taxAmount),
      totalTax:   orders.reduce((a,o) => a + (o.taxAmount||0), 0),
      totalPaid:  orders.reduce((a,o) => a + (o.totalWithTax||0), 0),
    };
  }

  function render() {
    const from = document.getElementById('rpt-date-from').value;
    const to   = document.getElementById('rpt-date-to').value;

    const summary    = buildSummary(from, to);
    const byCategory = buildByCategory(from, to);
    const byProduct  = buildByProduct(from, to);
    const lowStock   = buildLowStock();
    const byCustomer = buildDeployedByCustomer(from, to);
    const byLocation = buildHoldingByLocation(from, to);
    const taxReport  = buildTaxReport(from, to);

    renderTaxSection(taxReport);
    const AIO_PURPLE  = '#FFD7CF';
    const AIO_ORANGE  = '#D5D9FC';
    const AIO_GREEN   = '#34C759';
    const AIO_AMBER   = '#FFA500';
    const DONUT_COLORS = [AIO_PURPLE, AIO_ORANGE, AIO_AMBER, AIO_GREEN, '#5F68BC', '#4D7CFF'];

    // ── Summary KPI cards ──────────────────────────────────────────────
    document.getElementById('rpt-summary').innerHTML = `
      <div class="rpt-card purple">
        <div class="rpt-card-label">Stock Holding Value</div>
        <div class="rpt-card-val">${fmt$(summary.holdingValue)}</div>
        <div class="rpt-card-sub">${summary.holdingUnits} units · ${summary.holdingCosted} priced</div>
      </div>
      <div class="rpt-card orange">
        <div class="rpt-card-label">Deployed Stock Value</div>
        <div class="rpt-card-val">${fmt$(summary.deployedValue)}</div>
        <div class="rpt-card-sub">${summary.deployedUnits} units · ${summary.deployedCosted} priced</div>
      </div>
      <div class="rpt-card green">
        <div class="rpt-card-label">In Transit Value</div>
        <div class="rpt-card-val">${fmt$(summary.transitValue)}</div>
        <div class="rpt-card-sub">${summary.transitUnits} units</div>
      </div>
      <div class="rpt-card amber">
        <div class="rpt-card-label">Total Portfolio</div>
        <div class="rpt-card-val">${fmt$(summary.holdingValue + summary.deployedValue + summary.transitValue)}</div>
        <div class="rpt-card-sub">Holding + Deployed + Transit</div>
      </div>`;

    // ── Helper: inline bar rows ────────────────────────────────────────
    function barRows(items, labelKey, valueKey, color) {
      if (!items.length) return '<div class="empty">No data</div>';
      const max = Math.max(...items.map(i => i[valueKey]), 1);
      return `<div class="rpt-bars-wrap">${items.map(item => `
        <div class="rpt-bar-row">
          <div class="rpt-bar-label" title="${esc(item[labelKey])}">${esc(item[labelKey])}</div>
          <div class="rpt-bar-track"><div class="rpt-bar-fill ${color==='orange'?'orange':''}" style="width:${Math.max(2, Math.round(item[valueKey]/max*100))}%"></div></div>
          <div class="rpt-bar-val">${fmt$(item[valueKey])}</div>
        </div>`).join('')}</div>`;
    }

    // ── Stock value by category ────────────────────────────────────────
    document.getElementById('rpt-by-category').innerHTML = `
      <div class="rpt-grid">
        ${barRows(byCategory, 'category', 'value', 'purple')}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Units</th><th>Priced</th><th>Total value</th><th>Avg / unit</th></tr></thead>
            <tbody>${byCategory.length
              ? byCategory.map(c => `<tr>
                  <td><span class="cat-badge">${esc(c.category)}</span></td>
                  <td>${c.units}</td>
                  <td style="color:var(--text-hint)">${c.costed}</td>
                  <td style="font-weight:600">${fmt$(c.value)}</td>
                  <td style="color:var(--text-muted)">${c.costed > 0 ? fmt$(c.value/c.costed) : '—'}</td>
                </tr>`).join('')
              : '<tr><td colspan="5"><div class="empty">No data</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    // ── Stock value by product ─────────────────────────────────────────
    document.getElementById('rpt-by-product').innerHTML = `
      <div class="rpt-grid">
        ${barRows(byProduct, 'product', 'value', 'purple')}
        <div class="table-wrap">
          <table>
            <thead><tr><th style="width:32%">Product</th><th>Category</th><th>Units</th><th>Total value</th><th>Avg / unit</th></tr></thead>
            <tbody>${byProduct.length
              ? byProduct.map(p => `<tr>
                  <td style="font-weight:500">${esc(p.product)}</td>
                  <td><span class="cat-badge">${esc(p.category)}</span></td>
                  <td>${p.units}</td>
                  <td style="font-weight:600">${fmt$(p.value)}</td>
                  <td style="color:var(--text-muted)">${p.costed > 0 ? fmt$(p.value/p.costed) : '—'}</td>
                </tr>`).join('')
              : '<tr><td colspan="5"><div class="empty">No data</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    // ── Holding cost by location ───────────────────────────────────────
    document.getElementById('rpt-by-location').innerHTML = `
      <div class="rpt-grid">
        ${barRows(byLocation, 'location', 'value', 'purple')}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Location</th><th>Units</th><th>Priced</th><th>Total value</th></tr></thead>
            <tbody>${byLocation.length
              ? byLocation.map(l => `<tr>
                  <td><span class="loc-badge">${esc(l.location)}</span></td>
                  <td>${l.units}</td>
                  <td style="color:var(--text-hint)">${l.costed}</td>
                  <td style="font-weight:600">${fmt$(l.value)}</td>
                </tr>`).join('')
              : '<tr><td colspan="4"><div class="empty">No data</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    // ── Low stock items ────────────────────────────────────────────────
    document.getElementById('rpt-low-stock').innerHTML = lowStock.length
      ? `<table>
          <thead><tr>
            <th style="width:25%">Product</th><th style="width:13%">Category</th>
            <th style="width:15%">Location</th><th>In stock</th>
            <th>Threshold</th><th>Shortfall</th><th>Status</th>
          </tr></thead>
          <tbody>${lowStock.map(item => `<tr>
            <td style="font-weight:500">${esc(item.product)}</td>
            <td><span class="cat-badge">${esc(item.category||'—')}</span></td>
            <td><span class="loc-badge">${esc(item.location||'—')}</span></td>
            <td style="font-weight:600;color:var(--${item.inStockCount===0?'danger':'warning'}-text)">${item.inStockCount}</td>
            <td style="color:var(--text-muted)">${item.threshold}</td>
            <td style="color:var(--danger-text)">${item.gap > 0 ? '+'+item.gap+' needed' : 'At threshold'}</td>
            <td><span class="badge ${item.inStockCount===0?'b-zero':'b-low'}">${item.inStockCount===0?'Out of stock':'Low stock'}</span></td>
          </tr>`).join('')}</tbody>
        </table>`
      : '<div class="empty">All products above threshold</div>';

    // ── Deployed cost by customer ──────────────────────────────────────
    document.getElementById('rpt-by-customer').innerHTML = `
      <div class="rpt-grid">
        ${barRows(byCustomer, 'customer', 'value', 'orange')}
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th style="width:28%">Customer / Account</th><th>Units</th>
              <th>Products</th><th>Total value</th><th>First deploy</th><th>Last deploy</th>
            </tr></thead>
            <tbody>${byCustomer.length
              ? byCustomer.map(c => `<tr>
                  <td style="font-weight:500">${esc(c.customer)}</td>
                  <td>${c.units}</td>
                  <td style="color:var(--text-muted)">${c.products}</td>
                  <td style="font-weight:600">${fmt$(c.value)}</td>
                  <td style="color:var(--text-hint);font-size:11px">${fmtDate(c.firstDate)}</td>
                  <td style="color:var(--text-hint);font-size:11px">${fmtDate(c.lastDate)}</td>
                </tr>`).join('')
              : '<tr><td colspan="6"><div class="empty">No deployed stock in range</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

  }

  // ── CSV exports ───────────────────────────────────────────────────────
  function exportAll() {
    const from = document.getElementById('rpt-date-from').value;
    const to   = document.getElementById('rpt-date-to').value;

    const rows = [
      ['AIO Inventory — Report Export'],
      ['Generated', new Date().toLocaleString()],
      ['Date range', from || 'All time', to || ''],
      [],
      ['=== SUMMARY ==='],
    ];
    const s = buildSummary(from, to);
    rows.push(['Metric','Value','Units']);
    rows.push(['Stock Holding Value', s.holdingValue.toFixed(2), s.holdingUnits]);
    rows.push(['Deployed Stock Value', s.deployedValue.toFixed(2), s.deployedUnits]);
    rows.push(['In Transit Value', s.transitValue.toFixed(2), s.transitUnits]);
    rows.push([]);
    rows.push(['=== STOCK VALUE BY CATEGORY ===']);
    rows.push(['Category','Units','Priced Units','Total Value','Avg per Unit']);
    buildByCategory(from, to).forEach(c => rows.push([c.category, c.units, c.costed, c.value.toFixed(2), c.costed > 0 ? (c.value/c.costed).toFixed(2) : '']));
    rows.push([]);
    rows.push(['=== STOCK VALUE BY PRODUCT ===']);
    rows.push(['Product','Category','Units','Total Value','Avg per Unit']);
    buildByProduct(from, to).forEach(p => rows.push([p.product, p.category, p.units, p.value.toFixed(2), p.costed > 0 ? (p.value/p.costed).toFixed(2) : '']));
    rows.push([]);
    rows.push(['=== HOLDING COST BY LOCATION ===']);
    rows.push(['Location','Units','Priced Units','Total Value']);
    buildHoldingByLocation(from, to).forEach(l => rows.push([l.location, l.units, l.costed, l.value.toFixed(2)]));
    rows.push([]);
    rows.push(['=== LOW STOCK ITEMS ===']);
    rows.push(['Product','Category','Location','In Stock','Threshold','Shortfall','Status']);
    buildLowStock().forEach(i => rows.push([i.product, i.category, i.location, i.inStockCount, i.threshold, i.gap > 0 ? i.gap : 0, i.inStockCount === 0 ? 'Out of stock' : 'Low stock']));
    rows.push([]);
    rows.push(['=== DEPLOYED VALUE BY CUSTOMER ===']);
    rows.push(['Customer','Units Deployed','Product Lines','Total Value','First Deploy','Last Deploy']);
    buildDeployedByCustomer(from, to).forEach(c => rows.push([c.customer, c.units, c.products, c.value.toFixed(2), fmtDate(c.firstDate), fmtDate(c.lastDate)]));

    const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `aio_report_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // Render tax section
  function renderTaxSection(taxReport) {
    const taxEl = document.getElementById('rpt-tax-section');
    if (!taxEl) return;
    if (!taxReport.orders.length) {
      taxEl.innerHTML = '<div class="empty" style="padding:1rem">No tax recorded on purchase orders in this period</div>';
      return;
    }
    taxEl.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div class="svc-stat-card" style="background:#FEF7EA;border-color:#FFA500;color:#8A5200;flex:1;min-width:120px;">
          <div class="svc-stat-count">${taxReport.orders.length}</div>
          <div class="svc-stat-label">POs with tax</div>
        </div>
        <div class="svc-stat-card" style="background:#FEF7EA;border-color:#FFA500;color:#8A5200;flex:1;min-width:120px;">
          <div class="svc-stat-count">${fmt$(taxReport.totalTax)}</div>
          <div class="svc-stat-label">Total tax paid</div>
        </div>
        <div class="svc-stat-card" style="background:#EDFEEA;border-color:#4AA37B;color:#4AA37B;flex:1;min-width:120px;">
          <div class="svc-stat-count">${fmt$(taxReport.totalPaid)}</div>
          <div class="svc-stat-label">Total inc. tax</div>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">By supplier</div>
        <table class="product-stock-table">
          <thead><tr>
            <th style="width:28%">Supplier</th><th style="width:8%">POs</th>
            <th style="width:18%">Subtotal</th><th style="width:18%">Tax paid</th>
            <th style="width:18%">Total inc. tax</th><th style="width:10%">Eff. rate</th>
          </tr></thead>
          <tbody>${taxReport.bySupplier.map(s => `<tr>
            <td style="font-weight:500">${esc(s.supplier)}</td>
            <td>${s.orders}</td>
            <td>${fmt$(s.subtotal)}</td>
            <td style="color:#8A5200;font-weight:600">${fmt$(s.taxAmount)}</td>
            <td style="color:var(--aio-purple);font-weight:600">${fmt$(s.total)}</td>
            <td style="color:var(--text-muted)">${s.subtotal > 0 ? (s.taxAmount/s.subtotal*100).toFixed(2)+'%' : '—'}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr style="border-top:2px solid var(--aio-purple-light);">
            <td colspan="2" style="font-weight:700;padding-top:8px;">Total</td>
            <td style="padding-top:8px;font-weight:700">${fmt$(taxReport.orders.reduce((a,o)=>a+(o.subtotal||0),0))}</td>
            <td style="padding-top:8px;font-weight:700;color:#8A5200">${fmt$(taxReport.totalTax)}</td>
            <td style="padding-top:8px;font-weight:700;color:var(--aio-purple)">${fmt$(taxReport.totalPaid)}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Individual POs</div>
        <table class="product-stock-table">
          <thead><tr>
            <th style="width:12%">Date</th><th style="width:16%">PO</th><th style="width:18%">Supplier</th>
            <th style="width:13%">Subtotal</th><th style="width:11%">Tax</th><th style="width:8%">Rate</th>
            <th style="width:12%">Tax ref</th><th style="width:10%">Total</th>
          </tr></thead>
          <tbody>${taxReport.orders.slice().reverse().map(o => `<tr>
            <td style="color:var(--text-muted);font-size:12px">${fmtDate(o.createdAt)}</td>
            <td><span class="po-lock-badge">🔒 ${esc(o.poNumber)}</span></td>
            <td style="font-weight:500">${esc(o.supplier)}</td>
            <td>${fmt$(o.subtotal)}</td>
            <td style="color:#8A5200;font-weight:600">${fmt$(o.taxAmount)}</td>
            <td style="color:var(--text-muted)">${o.taxRate ? o.taxRate+'%' : '—'}</td>
            <td style="font-size:11px;color:var(--text-muted)">${esc(o.taxRef||'—')}</td>
            <td style="font-weight:700;color:var(--aio-purple)">${fmt$(o.totalWithTax)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }


  // ── Written-off stock report ─────────────────────────────────────────
  function renderWrittenOff() {
    const el = document.getElementById('report-writtenoff');
    if (!el) return;

    const allMoves = DB.getData().movements.filter(m => m.type === 'OUT' && m.isLost === true);
    const auditRecs = DB.getAuditRecords();

    if (!allMoves.length) {
      el.innerHTML = '<div class="empty" style="padding:2rem;text-align:center;color:var(--text-muted);">No written-off stock found</div>';
      return;
    }

    const fmtMoney = v => v ? '$' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';
    const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) : '—';

    // Deduplicate by serial — only count each serial once (keep earliest entry)
    const seenSerials = new Set();
    const rows = [];
    // Sort movements oldest first so we keep the original write-off, not duplicates
    const sortedMoves = [...allMoves].sort((a,b) => new Date(a.date) - new Date(b.date));
    sortedMoves.forEach(m => {
      (m.serials||[]).forEach(serial => {
        const key = serial.toUpperCase();
        if (seenSerials.has(key)) return; // skip duplicates
        seenSerials.add(key);
        const auditRec = auditRecs.find(r =>
          (r.writtenOffSerials||[]).some(s => s.toUpperCase() === key)
        );
        const serialCosts = DB.getData().serialCosts || {};
        const cost = serialCosts[serial] || serialCosts[serial.toUpperCase()] || m.cost || 0;
        rows.push({
          serial: serial.startsWith('NS-') ? '(No serial)' : serial,
          product: m.product && m.product !== 'Unknown' ? m.product : (auditRec?.scope?.split(' @ ')[0] || m.product || '—'),
          location: m.location || '—',
          date: m.date,
          by: m.by || '—',
          ref: m.ref || '—',
          auditScope: auditRec ? auditRec.scope : '—',
          cost,
          isNS: serial.startsWith('NS-'),
        });
      });
    });

    // Display newest first
    rows.sort((a,b) => new Date(b.date) - new Date(a.date));

    const totalUnits = rows.length;
    const totalValue = rows.reduce((a,r) => a+r.cost, 0);
    const byProduct = {};
    rows.forEach(r => {
      if (!byProduct[r.product]) byProduct[r.product] = { count: 0, value: 0 };
      byProduct[r.product].count++;
      byProduct[r.product].value += r.cost;
    });
    const productRows = Object.entries(byProduct).sort((a,b) => b[1].count - a[1].count);

    el.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
        <div class="svc-stat-card" style="background:#FFDFD7;border-color:#FFC8BC;color:#AC1B02;flex:1;min-width:120px;">
          <div class="svc-stat-count">${totalUnits}</div>
          <div class="svc-stat-label">🗑 Total units written off</div>
        </div>
        <div class="svc-stat-card" style="background:#FFDFD7;border-color:#FFC8BC;color:#AC1B02;flex:1;min-width:120px;">
          <div class="svc-stat-count">${fmtMoney(totalValue)}</div>
          <div class="svc-stat-label">💰 Total value written off</div>
        </div>
        <div class="svc-stat-card" style="background:#F6F6F6;border-color:#FFC8BC;color:var(--aio-purple);flex:1;min-width:120px;">
          <div class="svc-stat-count">${productRows.length}</div>
          <div class="svc-stat-label">📦 Products affected</div>
        </div>
      </div>

      <div class="panel" style="margin-bottom:1rem;">
        <div class="panel-title">By product</div>
        <div class="table-wrap"><table class="product-stock-table">
          <thead><tr><th>Product</th><th style="width:12%">Units</th><th style="width:18%">Value</th></tr></thead>
          <tbody>${productRows.map(([product, data]) =>
            `<tr><td style="font-weight:500">${product}</td><td style="color:#AC1B02;font-weight:600">${data.count}</td><td style="color:#AC1B02;font-weight:600">${fmtMoney(data.value)}</td></tr>`
          ).join('')}</tbody>
        </table></div>
      </div>

      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="panel-title" style="margin:0;">All written-off items</div>
          <button class="btn btn-ghost btn-sm" id="btn-export-writtenoff">📥 Export CSV</button>
        </div>
        <div class="table-wrap"><table class="product-stock-table">
          <thead><tr>
            <th style="width:13%">Date</th>
            <th style="width:18%">Serial</th>
            <th style="width:20%">Product</th>
            <th style="width:12%">Location</th>
            <th style="width:12%">By</th>
            <th style="width:25%">Audit count</th>
          </tr></thead>
          <tbody>${rows.map(r =>
            `<tr>
              <td style="font-size:12px;color:var(--text-muted)">${fmtDate(r.date)}</td>
              <td style="font-family:var(--mono);font-size:11px;${r.isNS ? 'color:var(--text-muted);font-style:italic;' : ''}">${r.serial}</td>
              <td style="font-size:12px">${r.product}</td>
              <td style="font-size:12px">${r.location}</td>
              <td style="font-size:12px">${r.by}</td>
              <td style="font-size:11px;color:var(--text-muted)">${r.auditScope}</td>
            </tr>`
          ).join('')}</tbody>
        </table></div>
      </div>`;

    document.getElementById('btn-export-writtenoff')?.addEventListener('click', () => {
      const csv = [
        ['Date','Serial','Product','Location','Written off by','Audit count'],
        ...rows.map(r => [fmtDate(r.date), r.serial, r.product, r.location, r.by, r.auditScope])
      ].map(r => r.map(c => '"' + (c||'').toString().replace(/"/g,'""') + '"').join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv,' + encodeURIComponent(csv);
      a.download = 'written-off-stock-' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
    });
  }

  return { render, exportAll, renderWrittenOff };
})();
