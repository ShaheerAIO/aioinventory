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
  const ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/hardwareForecast';

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
          <select class="fi fc-part-prod" data-i="${i}"><option value="">Pick a product…</option>${productOptions(p)}</select>
          <button class="btn btn-ghost btn-sm fc-part-del" data-i="${i}">Remove</button></div>`).join('')}
        <button class="btn btn-ghost btn-sm" id="fc-part-add">+ Add product</button>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;"><button class="btn btn-orange btn-sm" id="fc-map-save">Save</button><button class="btn btn-ghost btn-sm" id="fc-map-cancel">Cancel</button></div>
    </td></tr>`;
  }

  function draw() {
    const el = root();
    if (!el) return;
    const quarters = recentQuarters();
    const head = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <label style="font-size:13px;">Base quarter
        <select class="fi" id="fc-quarter" style="width:auto;display:inline-block;margin-left:6px;">
          ${quarters.map((q, i) => `<option value="${q}"${q === _quarter ? ' selected' : ''}>${q.replace('-', ' ')}${i === 0 ? ' (so far)' : ''}</option>`).join('')}
        </select></label>
      <span style="font-size:13px;color:var(--text-muted);">→ forecast for <b>${nextQ(_quarter).replace('-', ' ')}</b></span>
      <span style="font-size:12px;color:var(--text-hint);">${_loading ? 'Reading HubSpot…' : _error ? `<span style="color:var(--danger-text);">${esc(_error)}</span>` : ''}</span>
    </div>`;
    const data = _cache[_quarter];
    if (!data) { el.innerHTML = head + `<div class="empty">${_loading ? 'Reading deals and line items from HubSpot…' : 'No data yet.'}</div>`; bindHead(el); return; }

    const s = settings();
    const r = compute(data, s, stockByProduct(), usedPerMonth());
    const map = s.bundleMap || {};
    const total = r.rows.reduce((a, x) => a + x.needed, 0);

    el.innerHTML = head + `
      ${r.unmapped.length ? `<div class="alert alert-error show" style="margin:0 0 12px;">${r.unmapped.length} HubSpot product${r.unmapped.length !== 1 ? 's are' : ' is'} not mapped yet, so ${r.unmapped.length !== 1 ? 'they are' : 'it is'} left out of A: ${esc(r.unmapped.map(h => h.name).join(', '))}. Set ${r.unmapped.length !== 1 ? 'them' : 'it'} in HubSpot bundle contents below.</div>` : ''}

      <div class="fc-eq">
        <div class="fc-eq-line">Needed <span class="fc-op">=</span> ( <i>A</i> <span class="fc-op">+</span>
          <i>M</i> <span class="fc-op">×</span> <span class="fc-pct"><input class="fi" id="fc-pct" type="number" min="0" max="100" step="1" value="${esc(s.conversionPct ?? '')}" placeholder="c" aria-label="Conversion %">%</span> )
          <span class="fc-op">×</span> <i>b</i> <span class="fc-op">+</span> <i>Z</i></div>
        <dl class="fc-key">
          <dt>A</dt><dd>Deals with hardware signed in ${esc(_quarter.replace('-', ' '))} — <b>${r.hwDeals}</b> of ${data.signed.length} signed${r.unmapped.length
            ? ` so far (${r.unmapped.length} HubSpot product${r.unmapped.length !== 1 ? 's' : ''} still to map below)` : ''}</dd>
          <dt>M</dt><dd>Open marketing-only deals — <b>${data.pool.length}</b></dd>
          <dt>c</dt><dd>Share of them expected to convert to a hardware deal — <b>${r.B}</b> projected deals</dd>
          <dt>b</dt><dd>Units of the product in one hardware deal (table below)</dd>
          <dt>Z</dt><dd>Carry-over from last quarter's order, + or −, per product (table below)</dd>
        </dl>
        <div class="fc-note">Read from HubSpot; nothing is changed there. Stock and in-transit aren't subtracted from Needed; they set the zone.</div>
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th title="Units in one hardware deal">b · per deal</th><th title="Signed hardware deals × b">A × b</th><th title="Projected deals × b">M × c × b</th><th title="Carry-over from last quarter's order; negative if we over-ordered">Z · carry-over</th><th>Needed</th><th title="The higher of the last 90 days' deployments and Needed ÷ 3 (before Z)">Use / month</th><th>In stock</th><th>In transit</th><th title="Weeks from ordering to having it on the shelf; blank = ${DEFAULT_LEAD_WEEKS}">Lead time</th><th title="How long stock + in transit lasts at that use">Cover</th></tr></thead>
        <tbody>
          ${r.rows.map(x => `<tr>
            <td>${esc(x.product)}</td>
            <td><input class="fi fc-perdeal" data-p="${esc(x.product)}" type="number" min="0" step="0.1" value="${x.perDeal || ''}" placeholder="0" style="width:80px;"></td>
            <td>${fmt(x.a)}</td>
            <td>${fmt(x.b)}</td>
            <td><input class="fi fc-z" data-p="${esc(x.product)}" type="number" step="1" value="${x.z || ''}" placeholder="0" style="width:80px;"></td>
            <td><b>${x.needed}</b></td>
            <td title="Deployed: ${fmt(x.hist)}/mo · forecast: ${fmt(x.fcst)}/mo">${fmt(x.perMonth)}</td>
            <td>${x.inStock}</td>
            <td>${x.inTransit}</td>
            <td><input class="fi fc-lead" data-p="${esc(x.product)}" type="number" min="1" step="1" value="${x.leadSet ? x.lead : ''}" placeholder="${DEFAULT_LEAD_WEEKS}" style="width:64px;"> wk</td>
            <td>${x.zone ? `<span class="fc-zone fc-zone-${x.zone}">${x.cover >= 52 ? '52+' : fmt(x.cover)} wk</span>` : '—'}</td>
          </tr>`).join('') || `<tr><td colspan="11" class="empty">Map the HubSpot products below to see the forecast.</td></tr>`}
        </tbody>
        ${r.rows.length ? `<tfoot><tr><td><b>Total</b></td><td></td><td>${fmt(r.rows.reduce((a, x) => a + x.a, 0))}</td><td>${fmt(r.rows.reduce((a, x) => a + x.b, 0))}</td><td>${fmt(r.rows.reduce((a, x) => a + x.z, 0))}</td><td><b>${total}</b></td><td></td><td>${r.rows.reduce((a, x) => a + x.inStock, 0)}</td><td>${r.rows.reduce((a, x) => a + x.inTransit, 0)}</td><td></td><td></td></tr></tfoot>` : ''}
      </table></div>
      <div style="font-size:12px;color:var(--text-hint);margin-top:6px;">
        <span class="fc-zone fc-zone-red">Red</span> runs out inside its lead time (${DEFAULT_LEAD_WEEKS} weeks unless set) — order now and it still won't arrive in time.
        <span class="fc-zone fc-zone-amber">Amber</span> hits zero around the time an order placed today lands (within ${AMBER_WEEKS} weeks after) — order now.
        Use / month is the higher of the last 90 days' deployments and the forecast.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 20px;">
        <button class="btn btn-ghost btn-sm" id="fc-fill" ${r.hwDeals ? '' : 'disabled'}>Fill per-deal from ${esc(_quarter.replace('-', ' '))} average</button>
        <span style="font-size:12px;color:var(--text-hint);">Average units per signed deal with hardware (${r.hwDeals} deals). Stock isn't subtracted — adjust Z for it.</span>
      </div>

      <details ${r.unmapped.length ? 'open' : ''} style="margin-bottom:14px;"><summary style="cursor:pointer;font-weight:600;">HubSpot bundle contents (${r.hsItems.length - r.unmapped.length}/${r.hsItems.length} set)</summary>
        <div class="table-wrap" style="margin-top:8px;"><table>
          <thead><tr><th>HubSpot product</th><th>Qty in ${esc(_quarter.replace('-', ' '))}</th><th>Contains</th><th></th></tr></thead>
          <tbody>${r.hsItems.map(h => `<tr>
            <td>${esc(h.name)}</td><td>${fmt(h.qty)} <span style="color:var(--text-hint);font-size:12px;">on ${h.deals} deal${h.deals !== 1 ? 's' : ''}</span></td>
            <td style="font-size:12px;">${partsText(map[h.key])}</td>
            <td><button class="btn btn-ghost btn-sm fc-map-edit" data-k="${esc(h.key)}">Edit</button></td>
          </tr>${_editing === h.key ? editorHtml(h) : ''}`).join('')}</tbody>
        </table></div>
      </details>

      <details style="margin-bottom:14px;"><summary style="cursor:pointer;font-weight:600;">Signed deals in ${esc(_quarter.replace('-', ' '))} (${data.signed.length})</summary>
        <div class="table-wrap" style="margin-top:8px;"><table>
          <thead><tr><th>Deal</th><th>Signed</th><th>Stage</th><th>One-off line items</th></tr></thead>
          <tbody>${data.signed.map(d => `<tr><td><a href="${esc(data.dealUrl + d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a></td><td>${esc(d.signedDate.slice(0, 10))}</td><td>${esc(d.stage)}</td>
            <td style="font-size:12px;">${d.items.map(i => `${fmt(i.qty)} × ${esc(i.name)}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>

      <details><summary style="cursor:pointer;font-weight:600;">Open marketing deals (${data.pool.length})</summary>
        <div class="table-wrap" style="margin-top:8px;"><table>
          <thead><tr><th>Deal</th><th>Stage</th><th>Modules</th></tr></thead>
          <tbody>${data.pool.map(d => `<tr><td><a href="${esc(data.dealUrl + d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a></td><td>${esc(d.stage)}</td><td>${esc(d.modules.join(', '))}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
      <p style="font-size:12px;color:var(--text-hint);margin-top:12px;">Read from HubSpot ${new Date(data.at).toLocaleString()} · ${data.excludedTests} test-account deals left out · marketing deal = Modules Used without POS/Payments, not lost, churned or cancelled.</p>`;

    bindHead(el);
    const num = v => v === '' ? 0 : Number(v);
    const setIn = (key, p, v) => { const o = { ...(s[key] || {}) }; if (!v) delete o[p]; else o[p] = v; save(key, o); };
    el.querySelector('#fc-pct').addEventListener('change', e => save('conversionPct', Math.min(100, Math.max(0, num(e.target.value)))));
    el.querySelectorAll('.fc-perdeal').forEach(i => i.addEventListener('change', () => setIn('perDeal', i.dataset.p, Math.max(0, num(i.value)))));
    el.querySelectorAll('.fc-lead').forEach(i => i.addEventListener('change', () => setIn('leadWeeks', i.dataset.p, Math.max(0, Math.round(num(i.value))))));
    el.querySelectorAll('.fc-z').forEach(i => i.addEventListener('change', () => setIn('z', i.dataset.p, Math.round(num(i.value)))));
    el.querySelector('#fc-fill').addEventListener('click', () => {
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
    if (_editing) bindEditor(el, r.hsItems.find(h => h.key === _editing), map);
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
