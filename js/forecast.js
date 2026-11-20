/* ─────────────────────────────────────────────────────────────────────────────
   Forecast — next quarter's hardware, per inventory product. Super admin only.

     Needed = (A + B) × b + Z
       A — deals with hardware signed last quarter (HubSpot Signed Date)
       B — open marketing-only deals × the conversion % set here
       b — units of the product in one hardware deal, set here
       Z — carry-over from last quarter's order (pallet deals, MOQ), entered here

   Each product also gets a red / amber zone: monthly use (the higher of the last
   90 days' deployments and the forecast) against stock + in transit. Red: it runs
   out inside the product's lead time (8 weeks unless set here). Amber: it runs out
   within 2 weeks after it.

   HubSpot sells bundles ("QSR POS Hardware Bundle"), so each HubSpot product is
   mapped once to the inventory products inside it; that map, the per-deal bundle,
   the conversion % and Z live in forecastSettings on the main doc. Stock on hand
   and in transit are shown beside the result but are not subtracted — the super
   admin adjusts Z for them. The HubSpot side is the hardwareForecast function.
   ───────────────────────────────────────────────────────────────────────────── */
const Forecast = (() => {
  const ENDPOINT = ENV.functionsBase + '/hardwareForecast';

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  const fmt = n => (Math.round(n * 10) / 10).toLocaleString();
  const DEFAULT_LEAD_WEEKS = 8, AMBER_WEEKS = 2, WEEKS_PER_MONTH = 52 / 12;

  // ── quarters ──
  const qKey = d => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  function qRange(key) {
    const [y, q] = key.split('-Q').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const end = new Date(y, q * 3, 0).getDate();
    return { from: `${y}-${pad(q * 3 - 2)}-01`, to: `${y}-${pad(q * 3)}-${end}` };
  }
  function nextQ(key) { const [y, q] = key.split('-Q').map(Number); return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`; }
  function recentQuarters(now = new Date()) {
    const out = [];
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 6; i++) { out.push(qKey(d)); d.setMonth(d.getMonth() - 3); }
    return out; // current (partial) first
  }

  // ── the formula (pure; tested in test/forecast.test.js) ──
  // data: hardwareForecast response · s: forecastSettings · stock: { product: { inStock, inTransit } }
  // used: { product: units deployed per month lately }
  function compute(data, s, stock = {}, used = {}) {
    const map = s.bundleMap || {}, perDeal = s.perDeal || {}, z = s.z || {}, leads = s.leadWeeks || {};
    const A = {}, hsItems = {};
    let hwDeals = 0;
    data.signed.forEach(deal => {
      let hasHw = false;
      deal.items.forEach(it => {
        const h = (hsItems[it.key] ||= { key: it.key, name: it.name, qty: 0, deals: 0 });
        h.qty += it.qty; h.deals++;
        const m = map[it.key];
        if (!m || m.ignore) return;
        Object.entries(m.parts || {}).forEach(([p, n]) => { A[p] = (A[p] || 0) + it.qty * n; hasHw = true; });
      });
      if (hasHw) hwDeals++;
    });
    const unmapped = Object.values(hsItems).filter(h => !map[h.key]);
    const pct = Number(s.conversionPct) || 0;
    const B = Math.round(data.pool.length * pct / 100);
    const products = [...new Set([...Object.keys(A), ...Object.keys(perDeal), ...Object.keys(z), ...Object.keys(used)])].sort();
    const rows = products.map(p => {
      const per = Number(perDeal[p]) || 0, a = hwDeals * per, b = B * per, zz = Number(z[p]) || 0;
      const inStock = stock[p]?.inStock || 0, inTransit = stock[p]?.inTransit || 0;
      const hist = used[p] || 0, fcst = (a + b) / 3;
      const perMonth = Math.max(hist, fcst);
      const cover = perMonth ? (inStock + inTransit) / (perMonth / WEEKS_PER_MONTH) : null;  // weeks
      const lead = Number(leads[p]) || DEFAULT_LEAD_WEEKS;
      return {
        product: p, a, perDeal: per, b, z: zz,
        needed: Math.max(0, Math.ceil(a + b + zz - 1e-9)),
        inStock, inTransit, hist, fcst, perMonth, cover, lead, leadSet: leads[p] != null,
        zone: cover == null ? '' : cover < lead ? 'red' : cover < lead + AMBER_WEEKS ? 'amber' : 'ok',
        avg: hwDeals ? (A[p] || 0) / hwDeals : 0,
      };
    });
    return { rows, B, pct, hwDeals, hsItems: Object.values(hsItems).sort((x, y) => y.qty - x.qty), unmapped };
  }

  // Units dispatched to customers in the last 90 days, per month
  function usedPerMonth(now = Date.now()) {
    const out = {}, since = now - 90 * 864e5;
    DB.getData().movements.forEach(mv => {
      if (mv.type !== 'OUT' || mv.isRmaTl || mv.isTransfer || !(new Date(mv.date) >= since)) return;
      out[mv.product] = (out[mv.product] || 0) + mv.serials.length / 3;
    });
    return out;
  }

  function stockByProduct() {
    const out = {};
    Inventory.getAllSerialRows().forEach(r => {
      const o = (out[r.product] ||= { inStock: 0, inTransit: 0 });
      if (r.status === 'in-stock') o.inStock++;
      else if (r.status === 'in-transit') o.inTransit++;
    });
    return out;
  }

  // ── state ──
  const _cache = {};       // quarter → hardwareForecast response
  let _quarter = recentQuarters()[1];   // last complete quarter
  let _loading = false, _error = '';
  let _editing = null;     // HubSpot product key whose contents are being edited
  let _draft = null;       // { ignore, parts: [[product, qty]] }
  let _tab = 'overview';   // overview | assumptions | mapping | deals

  const root = () => document.getElementById('fc-root');
  const settings = () => DB.getForecastSettings();

  async function api(params) {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const user = getAuth().currentUser;
    if (!user) throw new Error('Not signed in');
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
      .catch(() => { throw new Error('the hardwareForecast Cloud Function did not respond — check it is deployed'); });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HubSpot request failed (${res.status})`);
    return json;
  }

  async function load(fresh) {
    if (_loading) return;
    if (_cache[_quarter] && !fresh) { draw(); return; }
    _loading = true; _error = '';
    draw();
    const q = _quarter;
    try { _cache[q] = await api(qRange(q)); }
    catch (e) { _error = e.message; }
    finally { _loading = false; }
    draw();
  }

  function render() { load(false); }
  function refresh() { load(true); }

  function save(key, value) {
    try { DB.setForecastSetting(key, value); }
    catch (e) { UI.showAlert(e.message, 'error'); }
    draw();
  }

  const productOptions = sel => Inventory.PRODUCTS.map(p => p.name).filter(n => n !== 'Other')
    .map(n => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

  function partsText(m) {
    if (!m) return '<span class="badge b-zero">Not set</span>';
    if (m.ignore) return '<span style="color:var(--text-hint);">Not hardware</span>';
    const e = Object.entries(m.parts || {});
    return e.length ? e.map(([p, n]) => `${n} × ${esc(p)}`).join('<br>') : '<span class="badge b-zero">Empty</span>';
  }

  function editorHtml(h) {
    return `<tr><td colspan="4" style="background:var(--bg-2);">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">What one <b>${esc(h.name)}</b> contains, in inventory products:</div>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin-bottom:8px;"><input type="checkbox" id="fc-ignore" ${_draft.ignore ? 'checked' : ''}> Not hardware (a service or fee — leave it out)</label>
      <div ${_draft.ignore ? 'style="display:none;"' : ''}>
        ${_draft.parts.map(([p, n], i) => `<div style="display:flex;gap:6px;margin-bottom:6px;">
          <input class="fi fc-part-qty" data-i="${i}" type="number" min="0" step="1" value="${esc(n)}" style="width:80px;">
          <select class="fi fc-part-prod" data-search data-i="${i}"><option value="">Pick a product…</option>${productOptions(p)}</select>
          <button class="btn btn-ghost btn-sm fc-part-del" data-i="${i}">Remove</button></div>`).join('')}
        <button class="btn btn-ghost btn-sm" id="fc-part-add">+ Add product</button>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;"><button class="btn btn-orange btn-sm" id="fc-map-save">Save</button><button class="btn btn-ghost btn-sm" id="fc-map-cancel">Cancel</button></div>
    </td></tr>`;
  }

  // ── dashboard ──
  const ZONE_RANK = { red: 0, amber: 1, ok: 2, '': 3 };
  const ZONE_LABEL = { red: 'Will run out', amber: 'Order now', ok: 'Covered', '': 'No recent use' };
  const qLabel = q => q.replace('-', ' ');
  const signed = n => (n < 0 ? '−' : '+') + fmt(Math.abs(n));

  function kpi(accent, label, value, hint) {
    return `<div class="fc-kpi" style="--accent:${accent};"><div class="fc-kpi-label">${label}</div><div class="fc-kpi-n">${value}</div><div class="fc-kpi-hint">${hint}</div></div>`;
  }

  function productCard(x) {
    const scale = Math.max(26, (x.lead + AMBER_WEEKS) * 2);   // weeks shown on the cover bar
    const cover = x.cover == null ? null : Math.min(x.cover, scale);
    const parts = [x.a && `${fmt(x.a)} signed`, x.b && `${fmt(x.b)} projected`, x.z && `${signed(x.z)} carry-over`].filter(Boolean);
    return `<div class="fc-card fc-card-${x.zone || 'none'}">
      <div class="fc-card-head"><span class="fc-card-name">${esc(x.product)}</span><span class="fc-zone fc-zone-${x.zone || 'none'}">${ZONE_LABEL[x.zone]}</span></div>
      <div class="fc-card-need"><span class="fc-big">${x.needed}</span> to order</div>
      <div class="fc-card-math">${parts.join(' · ') || 'Nothing forecast — set units per deal in Assumptions'}</div>
      ${cover == null ? '' : `<div class="fc-cover" title="Stock + in transit lasts ${x.cover >= 52 ? '52+' : fmt(x.cover)} weeks; lead time ${x.lead} weeks">
        <div class="fc-cover-fill" style="width:${(cover / scale * 100).toFixed(1)}%;"></div>
        <div class="fc-cover-lead" style="left:${(x.lead / scale * 100).toFixed(1)}%;"></div></div>
      <div class="fc-cover-cap"><span>Lasts <b>${x.cover >= 52 ? '52+' : fmt(x.cover)} wk</b></span><span>Lead time ${x.lead} wk</span></div>`}
      <div class="fc-card-stats">
        <div><b>${x.inStock}</b><span>In stock</span></div>
        <div><b>${x.inTransit}</b><span>In transit</span></div>
        <div title="Deployed: ${fmt(x.hist)}/mo · forecast: ${fmt(x.fcst)}/mo"><b>${fmt(x.perMonth)}</b><span>Use / month</span></div>
      </div>
    </div>`;
  }

  // ── stock chart: units per product over time, one line each ──
  // Solid: units in stock each week for the last 13 weeks, rebuilt backwards from today's count
  // (every IN after a week added stock that wasn't there yet; every OUT after it took away
  // stock that was). Dashed: stock + in transit from today, used at the Use / month rate.
  const PAST_WEEKS = 13, AHEAD_WEEKS = 26, WEEK_MS = 7 * 864e5;
  const DEFAULT_LINES = 5, MAX_LINES = 8;   // 8 = colours that stay distinguishable (incl. colour-blind)
  const _colors = {};      // product → palette slot (1–8); a product keeps its colour while shown
  let _shown = null;       // products drawn on the chart; null = the most used
  let _pickOpen = false;   // the product dropdown stays open across redraws
  if (typeof document !== 'undefined') document.addEventListener('click', e => {
    const pick = document.querySelector('.fc-pick[open]');
    if (pick && !pick.contains(e.target)) { pick.open = false; _pickOpen = false; }
  });

  function stockHistory(products, now = Date.now()) {
    const start = now - PAST_WEEKS * WEEK_MS;
    const delta = {};      // product → [{ t, n }] for every movement since start
    DB.getData().movements.forEach(mv => {
      const t = new Date(mv.date).getTime();
      if (!(t > start) || !products.has(mv.product)) return;
      (delta[mv.product] ||= []).push({ t, n: mv.type === 'IN' ? mv.serials.length : mv.type === 'OUT' ? -mv.serials.length : 0 });
    });
    return (p, current) => Array.from({ length: PAST_WEEKS + 1 }, (_, i) => {
      const t = start + i * WEEK_MS;
      const later = (delta[p] || []).filter(d => d.t > t).reduce((a, d) => a + d.n, 0);
      return Math.max(0, current - later);
    });
  }

  function chartSeries(rows) {
    const hist = stockHistory(new Set(rows.map(x => x.product)));
    return rows.map(x => {
      const past = hist(x.product, x.inStock);
      const start = x.inStock + x.inTransit, perWeek = x.perMonth / WEEKS_PER_MONTH;
      const ahead = Array.from({ length: AHEAD_WEEKS + 1 }, (_, i) => Math.max(0, start - perWeek * i));
      // Weeks from today at which the projection turns amber / red / hits zero (same rule as the zone)
      const cover = perWeek ? start / perWeek : null, lead = x.lead || DEFAULT_LEAD_WEEKS;
      const zoneAt = k => cover == null ? '' : cover - k < lead ? 'red' : cover - k < lead + AMBER_WEEKS ? 'amber' : '';
      return { product: x.product, past, ahead, zoneAt, cover, lead, used: x.hist || 0 };
    });
  }

  function pickShown(held) {   // product names, most used first
    if (_shown) _shown = _shown.filter(p => held.includes(p));
    if (!_shown || !_shown.length) _shown = held.slice(0, DEFAULT_LINES);
    Object.keys(_colors).forEach(p => { if (!_shown.includes(p)) delete _colors[p]; });
    _shown.forEach(p => {
      if (_colors[p]) return;
      const used = new Set(Object.values(_colors));
      _colors[p] = [1, 2, 3, 4, 5, 6, 7, 8].find(n => !used.has(n));
    });
  }

  function niceMax(v) {
    if (v <= 5) return 5;
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 5, 10].map(m => m * step).find(m => m >= v);
  }

  // Amber then red glow under a product's dashed line, until it reaches zero
  function zoneHalo(s, x, y) {
    if (s.cover == null) return '';
    const end = Math.min(AHEAD_WEEKS, s.cover);
    const val = k => Math.max(0, s.ahead[0] - s.ahead[0] / s.cover * k);
    const seg = (a, b, cls) => {
      a = Math.max(0, a); b = Math.min(end, b);
      return b > a ? `<line class="fc-halo fc-halo-${cls}" x1="${x(PAST_WEEKS + a)}" y1="${y(val(a))}" x2="${x(PAST_WEEKS + b)}" y2="${y(val(b))}"/>` : '';
    };
    const red = s.cover - s.lead, amber = red - AMBER_WEEKS;
    return seg(amber, red, 'amber') + seg(red, end, 'red');
  }

  function chartHtml(series) {
    const W = 760, H = 260, L = 40, R = 12, T = 12, B = 26;
    const n = PAST_WEEKS + AHEAD_WEEKS;
    const shown = series.filter(s => _shown.includes(s.product));
    const max = niceMax(Math.max(1, ...shown.flatMap(s => [...s.past, ...s.ahead])));
    const x = i => L + (W - L - R) * i / n;
    const y = v => T + (H - T - B) * (1 - v / max);
    const path = (vals, off) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + off).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map(f => Math.round(max * f));
    const now = Date.now();
    const dateAt = i => new Date(now + (i - PAST_WEEKS) * WEEK_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const xTicks = [0, 4, 8, PAST_WEEKS, PAST_WEEKS + 8, PAST_WEEKS + 17, n];
    return `<div class="fc-chart">
      <div class="fc-chart-head"><div><div class="fc-sub" style="margin:0;">Stock per product</div>
        <div class="fc-chart-note">Solid: units in stock over the last ${PAST_WEEKS} weeks. Dashed: stock + in transit from today, used at each product's Use / month.<br><span class="fc-key-amber"></span> Amber glow: order now. <span class="fc-key-red"></span> Red glow: an order placed then lands after it runs out.</div></div>
        <details class="fc-pick"${_pickOpen ? ' open' : ''}><summary class="btn btn-ghost btn-sm">Products · ${_shown.length} of ${series.length}</summary>
          <div class="fc-pick-menu">
            <div class="fc-pick-note">Up to ${MAX_LINES} at once · most used first</div>
            ${series.map(s => {
              const on = _shown.includes(s.product), full = !on && _shown.length >= MAX_LINES;
              return `<label class="fc-pick-row${full ? ' off' : ''}"><input type="checkbox" class="fc-pick-cb" data-p="${esc(s.product)}"${on ? ' checked' : ''}${full || (on && _shown.length === 1) ? ' disabled' : ''}>
                <span class="fc-swatch" style="${on ? `background:var(--fc-s${_colors[s.product]});` : ''}"></span><span class="fc-pick-name">${esc(s.product)}</span>
                <span class="fc-pick-used">${s.used ? `${fmt(s.used)}/mo` : ''}</span></label>`;
            }).join('')}
          </div></details></div>
      <div class="fc-chart-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Units in stock per product, past ${PAST_WEEKS} weeks and projected ${AHEAD_WEEKS} weeks">
          ${ticks.map(t => `<line class="fc-grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}
          <line class="fc-today" x1="${x(PAST_WEEKS)}" x2="${x(PAST_WEEKS)}" y1="${T}" y2="${H - B}"/>
          ${shown.map(s => zoneHalo(s, x, y)).join('')}
          ${shown.map(s => `<g class="fc-line" style="--c:var(--fc-s${_colors[s.product]});">
            <path d="${path(s.past, 0)}"/><path class="fc-proj" d="${path(s.ahead, PAST_WEEKS)}"/></g>`).join('')}
          <line class="fc-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none;"/>
        </svg>
        ${shown.map(s => `<span class="fc-dot" style="background:var(--fc-s${_colors[s.product]});left:${(x(PAST_WEEKS) / W * 100).toFixed(2)}%;top:${y(s.past[PAST_WEEKS]).toFixed(1)}px;"></span>`).join('')}
        <div class="fc-axis-y">${ticks.map(t => `<span style="top:${(y(t) / H * 100).toFixed(2)}%;">${t.toLocaleString()}</span>`).join('')}</div>
        <div class="fc-axis-x">${xTicks.map(i => `<span${[4, 8, PAST_WEEKS + 17].includes(i) ? ' class="fc-x-minor"' : ''} style="left:${(x(i) / W * 100).toFixed(2)}%;">${i === PAST_WEEKS ? '<b>Today</b>' : dateAt(i)}</span>`).join('')}</div>
        <div class="fc-tip" style="display:none;"></div>
      </div>
      <div class="fc-legend">${shown.map(s => `<span><span class="fc-swatch" style="background:var(--fc-s${_colors[s.product]});"></span>${esc(s.product)}</span>`).join('')}</div>
    </div>`;
  }

  function bindChart(el, series) {
    const plot = el.querySelector('.fc-chart-plot');
    if (!plot) return;
    const svg = plot.querySelector('svg'), tip = plot.querySelector('.fc-tip'), cross = plot.querySelector('.fc-cross');
    const W = 760, L = 40, R = 12, n = PAST_WEEKS + AHEAD_WEEKS;
    const shown = series.filter(s => _shown.includes(s.product));
    plot.addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect();
      const i = Math.round(((e.clientX - box.left) / box.width * W - L) / (W - L - R) * n);
      if (i < 0 || i > n) { tip.style.display = cross.style.display = 'none'; return; }
      const cx = L + (W - L - R) * i / n;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      const when = i === PAST_WEEKS ? 'Today' : new Date(Date.now() + (i - PAST_WEEKS) * WEEK_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const val = s => i <= PAST_WEEKS ? s.past[i] : s.ahead[i - PAST_WEEKS];
      tip.innerHTML = `<div class="fc-tip-h">${when}${i > PAST_WEEKS ? ' · projected' : ''}</div>` +
        [...shown].sort((a, b) => val(b) - val(a)).map(s => `<div class="fc-tip-r"><span class="fc-swatch" style="background:var(--fc-s${_colors[s.product]});"></span><span>${esc(s.product)}</span><b>${fmt(val(s))}${i > PAST_WEEKS && s.zoneAt(i - PAST_WEEKS) && val(s) > 0 ? ` <span class="fc-zone fc-zone-${s.zoneAt(i - PAST_WEEKS)}">${s.zoneAt(i - PAST_WEEKS) === 'red' ? 'Red' : 'Amber'}</span>` : ''}</b></div>`).join('');
      tip.style.display = '';
      const px = cx / W * box.width;
      tip.style.left = (px > box.width / 2 ? px - tip.offsetWidth - 12 : px + 12) + 'px';
    });
    plot.addEventListener('pointerleave', () => { tip.style.display = cross.style.display = 'none'; });
    const pick = el.querySelector('.fc-pick');
    pick.addEventListener('toggle', () => { _pickOpen = pick.open; });
    el.querySelectorAll('.fc-pick-cb').forEach(cb => cb.addEventListener('change', () => {
      const p = cb.dataset.p;
      _shown = cb.checked ? [..._shown, p].slice(0, MAX_LINES) : _shown.filter(q => q !== p);
      draw();
    }));
  }

  // Products to chart: the forecast's plus anything else we hold, most used (last 90 days) first
  function chartRows(r, stock) {
    const extra = Object.entries(stock).filter(([p, o]) => !r.rows.some(x => x.product === p) && o.inStock + o.inTransit > 0)
      .map(([product, o]) => ({ product, inStock: o.inStock, inTransit: o.inTransit, perMonth: 0, hist: 0, zone: '' }));
    const sorted = [...r.rows, ...extra].sort((p, q) => q.hist - p.hist || q.perMonth - p.perMonth || p.product.localeCompare(q.product));
    return chartSeries(sorted).filter(s => s.past.some(Boolean) || s.ahead.some(Boolean));
  }

  function overviewTab(r, series) {
    const rows = [...r.rows].sort((p, q) => ZONE_RANK[p.zone] - ZONE_RANK[q.zone] || q.needed - p.needed || p.product.localeCompare(q.product));
    const chart = series.length ? chartHtml(series) : '';
    if (!rows.length) return chart + `<div class="empty">Map the HubSpot products in Bundle mapping to see the forecast.</div>`;
    return chart + `<div class="fc-cards">${rows.map(productCard).join('')}</div>
      <div class="fc-legend">
        <span><span class="fc-zone fc-zone-red">Red</span> stock runs out inside the lead time, so an order placed today lands too late.</span>
        <span><span class="fc-zone fc-zone-amber">Amber</span> it runs out within ${AMBER_WEEKS} weeks after the lead time, so order now.</span>
        <span>The bar shows how many weeks stock + in transit lasts; the tick marks the lead time.</span></div>`;
  }

  function assumptionsTab(r, s, data) {
    return `<div class="fc-eq">
        <div class="fc-eq-line">Needed <span class="fc-op">=</span> ( <i>A</i> <span class="fc-op">+</span>
          <i>M</i> <span class="fc-op">×</span> <span class="fc-pct"><input class="fi" id="fc-pct" type="number" min="0" max="100" step="1" value="${esc(s.conversionPct ?? '')}" placeholder="c" aria-label="Conversion %">%</span> )
          <span class="fc-op">×</span> <i>b</i> <span class="fc-op">+</span> <i>Z</i></div>
        <dl class="fc-key">
          <dt>A</dt><dd>Deals with hardware signed in ${esc(qLabel(_quarter))}: <b>${r.hwDeals}</b> of ${data.signed.length} signed</dd>
          <dt>M</dt><dd>Open marketing-only deals: <b>${data.pool.length}</b></dd>
          <dt>c</dt><dd>Share of them expected to convert to a hardware deal: <b>${r.B}</b> projected deals</dd>
          <dt>b</dt><dd>Units of the product in one hardware deal (below)</dd>
          <dt>Z</dt><dd>Carry-over from last quarter's order, + or −, per product (below)</dd>
        </dl>
        <div class="fc-note">Stock and in transit aren't subtracted from Needed; they set the zone. Adjust Z for them.</div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th title="Units in one hardware deal">Units per deal · b</th><th title="Carry-over from last quarter's order; negative if we over-ordered">Carry-over · Z</th><th title="Weeks from ordering to having it on the shelf; blank = ${DEFAULT_LEAD_WEEKS}">Lead time</th><th>Needed</th></tr></thead>
        <tbody>${r.rows.map(x => `<tr>
          <td>${esc(x.product)}</td>
          <td><input class="fi fc-perdeal" data-p="${esc(x.product)}" type="number" min="0" step="0.1" value="${x.perDeal || ''}" placeholder="0" style="width:90px;"></td>
          <td><input class="fi fc-z" data-p="${esc(x.product)}" type="number" step="1" value="${x.z || ''}" placeholder="0" style="width:90px;"></td>
          <td><input class="fi fc-lead" data-p="${esc(x.product)}" type="number" min="1" step="1" value="${x.leadSet ? x.lead : ''}" placeholder="${DEFAULT_LEAD_WEEKS}" style="width:70px;"> wk</td>
          <td><b>${x.needed}</b></td></tr>`).join('') || `<tr><td colspan="5" class="empty">Map the HubSpot products in Bundle mapping first.</td></tr>`}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-ghost btn-sm" id="fc-fill" ${r.hwDeals ? '' : 'disabled'}>Fill units per deal from ${esc(qLabel(_quarter))} average</button>
        <span style="font-size:12px;color:var(--text-hint);">Average units per signed deal with hardware (${r.hwDeals} deals).</span>
      </div>`;
  }

  function mappingTab(r, map) {
    return `<p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">HubSpot sells bundles. Say once what each one contains in inventory products; unmapped products are left out of A.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>HubSpot product</th><th>Qty in ${esc(qLabel(_quarter))}</th><th>Contains</th><th></th></tr></thead>
        <tbody>${r.hsItems.map(h => `<tr>
          <td>${esc(h.name)}</td><td>${fmt(h.qty)} <span style="color:var(--text-hint);font-size:12px;">on ${h.deals} deal${h.deals !== 1 ? 's' : ''}</span></td>
          <td style="font-size:12px;">${partsText(map[h.key])}</td>
          <td><button class="btn btn-ghost btn-sm fc-map-edit" data-k="${esc(h.key)}">Edit</button></td>
        </tr>${_editing === h.key ? editorHtml(h) : ''}`).join('') || `<tr><td colspan="4" class="empty">No hardware line items on deals signed in ${esc(qLabel(_quarter))}.</td></tr>`}</tbody>
      </table></div>`;
  }

  function dealsTab(data) {
    return `<div class="fc-sub">Signed deals in ${esc(qLabel(_quarter))} (${data.signed.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Deal</th><th>Signed</th><th>Stage</th><th>One-off line items</th></tr></thead>
        <tbody>${data.signed.map(d => `<tr><td><a href="${esc(data.dealUrl + d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a></td><td>${esc(d.signedDate.slice(0, 10))}</td><td>${esc(d.stage)}</td>
          <td style="font-size:12px;">${d.items.map(i => `${fmt(i.qty)} × ${esc(i.name)}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="fc-sub" style="margin-top:18px;">Open marketing deals (${data.pool.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Deal</th><th>Stage</th><th>Modules</th></tr></thead>
        <tbody>${data.pool.map(d => `<tr><td><a href="${esc(data.dealUrl + d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a></td><td>${esc(d.stage)}</td><td>${esc(d.modules.join(', '))}</td></tr>`).join('')}</tbody>
      </table></div>
      <p style="font-size:12px;color:var(--text-hint);margin-top:12px;">${data.excludedTests} test-account deals left out · marketing deal = Modules Used without POS/Payments, not lost, churned or cancelled.</p>`;
  }

  function draw() {
    const el = root();
    if (!el) return;
    const quarters = recentQuarters();
    const data = _cache[_quarter];
    const s = settings();
    const stock = stockByProduct();
    const r = data && compute(data, s, stock, usedPerMonth());
    const total = r ? r.rows.reduce((a, x) => a + x.needed, 0) : 0;

    const head = `<div class="fc-head">
      <label style="font-size:13px;">Base quarter
        <select class="fi" id="fc-quarter" style="width:auto;display:inline-block;margin-left:6px;">
          ${quarters.map((q, i) => `<option value="${q}"${q === _quarter ? ' selected' : ''}>${qLabel(q)}${i === 0 ? ' (so far)' : ''}</option>`).join('')}
        </select></label>
      <span style="font-size:13px;color:var(--text-muted);">→ forecast for <b>${qLabel(nextQ(_quarter))}</b></span>
      <span style="font-size:12px;color:var(--text-hint);">${_loading ? 'Reading HubSpot…' : _error ? `<span style="color:var(--danger-text);">${esc(_error)}</span>` : data ? `Read from HubSpot ${new Date(data.at).toLocaleString()}` : ''}</span>
      ${r ? `<button class="btn btn-primary btn-sm" id="fc-rfq" style="margin-left:auto;" ${total ? '' : 'disabled'} title="Send these Needed numbers to an admin for approval, then make an RFQ">Submit for RFQ</button>` : ''}
    </div>`;
    if (!data) { el.innerHTML = head + `<div class="empty">${_loading ? 'Reading deals and line items from HubSpot…' : 'No data yet.'}</div>`; bindHead(el); return; }

    const map = s.bundleMap || {};
    const red = r.rows.filter(x => x.zone === 'red').length, amber = r.rows.filter(x => x.zone === 'amber').length;
    const tabs = [['overview', 'Overview'], ['assumptions', 'Assumptions'], ['mapping', 'Bundle mapping', r.unmapped.length], ['deals', 'Deals']];
    const series = _tab === 'overview' ? chartRows(r, stock) : [];
    if (series.length) pickShown(series.map(x => x.product));
    const body = { overview: () => overviewTab(r, series), assumptions: () => assumptionsTab(r, s, data), mapping: () => mappingTab(r, map), deals: () => dealsTab(data) }[_tab]();

    el.innerHTML = head + `
      ${r.unmapped.length ? `<div class="fc-banner"><span><b>${r.unmapped.length} HubSpot product${r.unmapped.length !== 1 ? 's aren’t' : ' isn’t'} mapped</b>, so ${r.unmapped.length !== 1 ? 'they’re' : 'it’s'} left out of the forecast: ${esc(r.unmapped.map(h => h.name).join(', '))}</span>
        <button class="btn btn-ghost btn-sm fc-goto" data-tab="mapping">Map now</button></div>` : ''}
      <div class="fc-kpis">
        ${kpi('var(--electric)', `Units to order · ${qLabel(nextQ(_quarter))}`, total.toLocaleString(), `across ${r.rows.filter(x => x.needed).length} product${r.rows.filter(x => x.needed).length !== 1 ? 's' : ''}`)}
        ${kpi('var(--danger-text)', 'Will run out', red, 'before an order placed today lands')}
        ${kpi('var(--aio-orange)', 'Order now', amber, `runs out within ${AMBER_WEEKS} wk after lead time`)}
        ${kpi('var(--border-strong)', `Hardware deals · ${qLabel(_quarter)}`, r.hwDeals, `of ${data.signed.length} deals signed`)}
        ${kpi('var(--success-text)', 'Projected conversions', r.B, `${r.pct}% of ${data.pool.length} marketing deals`)}
      </div>
      <div class="fc-tabs" role="tablist">${tabs.map(([k, label, n]) => `<button class="fc-tab${k === _tab ? ' active' : ''}" role="tab" aria-selected="${k === _tab}" data-tab="${k}">${label}${n ? ` <span class="fc-tab-n">${n}</span>` : ''}</button>`).join('')}</div>
      <div class="fc-tab-body">${body}</div>`;

    bindHead(el);
    if (series.length) bindChart(el, series);
    el.querySelectorAll('.fc-tab, .fc-goto').forEach(b => b.addEventListener('click', () => { _tab = b.dataset.tab; draw(); }));
    el.querySelector('#fc-rfq').addEventListener('click', () => RFQ.openSubmit(r.rows, nextQ(_quarter)));
    const num = v => v === '' ? 0 : Number(v);
    const setIn = (key, p, v) => { const o = { ...(s[key] || {}) }; if (!v) delete o[p]; else o[p] = v; save(key, o); };
    el.querySelector('#fc-pct')?.addEventListener('change', e => save('conversionPct', Math.min(100, Math.max(0, num(e.target.value)))));
    el.querySelectorAll('.fc-perdeal').forEach(i => i.addEventListener('change', () => setIn('perDeal', i.dataset.p, Math.max(0, num(i.value)))));
    el.querySelectorAll('.fc-lead').forEach(i => i.addEventListener('change', () => setIn('leadWeeks', i.dataset.p, Math.max(0, Math.round(num(i.value))))));
    el.querySelectorAll('.fc-z').forEach(i => i.addEventListener('change', () => setIn('z', i.dataset.p, Math.round(num(i.value)))));
    el.querySelector('#fc-fill')?.addEventListener('click', () => {
      if (Object.keys(s.perDeal || {}).length && !confirm('Replace every per-deal number with this quarter\'s average?')) return;
      const o = {};
      r.rows.forEach(x => { if (x.avg) o[x.product] = Math.round(x.avg * 100) / 100; });
      save('perDeal', o);
    });
    el.querySelectorAll('.fc-map-edit').forEach(b => b.addEventListener('click', () => {
      const m = map[b.dataset.k];
      _editing = b.dataset.k;
      _draft = { ignore: !!m?.ignore, parts: Object.entries(m?.parts || {}) };
      if (!_draft.parts.length) _draft.parts.push(['', 1]);
      draw();
    }));
    if (_editing && _tab === 'mapping') bindEditor(el, r.hsItems.find(h => h.key === _editing), map);
  }

  function bindHead(el) {
    el.querySelector('#fc-quarter').addEventListener('change', e => { _quarter = e.target.value; _editing = null; load(false); });
  }

  function bindEditor(el, h, map) {
    if (!h) return;
    const sync = () => {
      el.querySelectorAll('.fc-part-qty').forEach(i => { _draft.parts[i.dataset.i][1] = Number(i.value) || 0; });
      el.querySelectorAll('.fc-part-prod').forEach(i => { _draft.parts[i.dataset.i][0] = i.value; });
    };
    el.querySelector('#fc-ignore').addEventListener('change', e => { sync(); _draft.ignore = e.target.checked; draw(); });
    el.querySelector('#fc-part-add').addEventListener('click', () => { sync(); _draft.parts.push(['', 1]); draw(); });
    el.querySelectorAll('.fc-part-del').forEach(b => b.addEventListener('click', () => { sync(); _draft.parts.splice(Number(b.dataset.i), 1); draw(); }));
    el.querySelector('#fc-map-cancel').addEventListener('click', () => { _editing = null; draw(); });
    el.querySelector('#fc-map-save').addEventListener('click', () => {
      sync();
      const parts = {};
      _draft.parts.forEach(([p, n]) => { if (p && n > 0) parts[p] = (parts[p] || 0) + n; });
      if (!_draft.ignore && !Object.keys(parts).length) { UI.showAlert('Add at least one product, or tick Not hardware.', 'error'); return; }
      _editing = null;
      save('bundleMap', { ...map, [h.key]: _draft.ignore ? { name: h.name, ignore: true } : { name: h.name, parts } });
    });
  }

  return { render, refresh, _compute: compute, _qRange: qRange, _nextQ: nextQ, _recentQuarters: recentQuarters };
})();
