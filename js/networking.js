/* ─────────────────────────────────────────────────────────────────────────────
   Networking — every SIM in a UniFi LTE device, read-only.

   The aioDevices Cloud Function (action=cellular) reads each UniFi console that
   has cellular gear and returns its SIM details: IMEI, ICCID, carrier, signal and
   whether the site is failing over to LTE right now. A SIM is flagged unless its
   APN is exactly "Broadband" and its auth type is none. Nothing is changed in UniFi. Admin only, like Map Devices.
   ───────────────────────────────────────────────────────────────────────────── */
const Networking = (() => {
  const ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/aioDevices';

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const CACHE_KEY = 'aio_networking_cache_v1';
  const STALE_MS = 5 * 60 * 1000;

  let _data = null;          // last good { devices, failed, at }
  let _savedAt = 0;          // when _data was fetched (ms)
  let _fromStorage = false;  // _data came from localStorage on this page load
  let _error = '';           // last fetch error message
  let _loading = false;
  let _view = { search: '', filter: 'all' };

  const root = () => document.getElementById('net-root');

  // ── cache (stale-while-revalidate) ──
  function cacheParse(raw, uid) {
    try {
      const c = JSON.parse(raw);
      if (c && c.uid && c.uid === uid && typeof c.savedAt === 'number' && c.data && Array.isArray(c.data.devices)) return c;
    } catch (e) {}
    return null;
  }
  function cacheRead(uid) { try { return cacheParse(localStorage.getItem(CACHE_KEY), uid); } catch (e) { return null; } }
  function cacheWrite(uid, data, savedAt) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, savedAt, data })); } catch (e) {} }
  function cacheClear() { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
  function fmtAge(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
  }

  async function currentUid() {
    try {
      const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      return getAuth().currentUser?.uid || null;
    } catch (e) { return null; }
  }

  async function api(params) {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const user = getAuth().currentUser;
    if (!user) throw new Error('Not signed in');
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } })
      .catch(() => { throw new Error('the aioDevices Cloud Function did not respond — check it is deployed'); });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `UniFi request failed (${res.status})`);
    return json;
  }

  function statusHtml() {
    if (!_data) return '';
    const age = fmtAge(Date.now() - _savedAt);
    if (_loading) return `Updated ${esc(age)} · refreshing…`;
    if (_error) return `Updated ${esc(age)} · <span style="color:var(--danger-text);">refresh failed: ${esc(_error)}</span>`;
    return `Updated ${esc(age)}`;
  }
  function paintStatus() {
    const el = root() && root().querySelector('#net-status');
    if (el) el.innerHTML = statusHtml();
  }

  async function load(fresh) {
    if (_loading) return;
    _loading = true;
    _error = '';
    if (_data) paintStatus();
    else if (root()) root().innerHTML = `<div class="empty">Reading SIMs from UniFi… this reads every console with an LTE unit, so it can take a minute.</div>`;
    try {
      const data = await api({ action: 'cellular', ...(fresh ? { fresh: '1' } : {}) });
      _data = data; _savedAt = Date.now(); _fromStorage = false;
      const uid = await currentUid();
      if (uid) cacheWrite(uid, data, _savedAt);
    } catch (e) { _error = e.message; }
    finally { _loading = false; }
    draw();
  }

  async function render() {
    if (!_data) {
      const uid = await currentUid();
      const c = uid && cacheRead(uid);
      if (c) { _data = c.data; _savedAt = c.savedAt; _fromStorage = true; }
    }
    if (!_data) { load(false); return; }
    draw();
    if (_fromStorage || Date.now() - _savedAt > STALE_MS) load(false);
  }
  function refresh() { load(true); }

  // Drop the cache when the user signs out (this file loads after auth.js)
  if (typeof Auth !== 'undefined' && Auth && typeof Auth.signOut === 'function') {
    const _so = Auth.signOut;
    Auth.signOut = async (...args) => { cacheClear(); _data = null; _fromStorage = false; return _so.apply(Auth, args); };
  }

  // Required SIM setup: APN exactly "Broadband" (case-sensitive) and no authentication
  const REQUIRED_APN = 'Broadband';
  const badApn  = d => d.apn !== REQUIRED_APN;
  const badAuth = d => String(d.authType).toLowerCase() !== 'none';
  const misconfigured = d => badApn(d) || badAuth(d);

  function simBadge(d) {
    if (!d.online) return '<span class="badge b-zero">Device offline</span>';
    if (d.connected) return `<span class="badge b-ok">${esc(d.rat || 'Connected')}</span>`;
    return `<span class="badge b-zero">${esc(d.simState || 'Not connected')}</span>`;
  }

  const FILTERS = {
    all:     ['All',          () => true],
    config:  ['Wrong APN / auth', misconfigured],
    nosig:   ['Not connected', d => !d.connected],
    onlte:   ['On LTE now',   d => d.onLte],
    offline: ['Device offline', d => !d.online],
  };

  function draw() {
    const el = root();
    if (!el) return;
    if (!_data) { el.innerHTML = _error ? `<div class="empty">Couldn't read UniFi — ${esc(_error)}</div>` : ''; return; }
    const hadFocus = document.activeElement && document.activeElement.id === 'net-search';
    const caret = hadFocus ? document.activeElement.selectionStart : 0;

    const all = _data.devices;
    const q = _view.search.trim().toLowerCase();
    const [, test] = FILTERS[_view.filter];
    const rows = all
      .filter(test)
      .filter(d => !q || [d.site, d.name, d.mac, d.imei, d.iccid, d.carrier, d.apn]
        .some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => (misconfigured(b) - misconfigured(a)) || (a.connected - b.connected) || a.site.localeCompare(b.site));

    const count = f => all.filter(FILTERS[f][1]).length;
    const carriers = [...new Set(_data.devices.map(d => d.carrier).filter(Boolean))];

    el.innerHTML = `
      <p id="net-status" style="font-size:12px;color:var(--text-hint);margin:0 0 6px;">${statusHtml()}</p>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">
        ${all.length} SIM${all.length !== 1 ? 's' : ''} in UniFi LTE units · ${count('config') ? `<b style="color:var(--danger-text);">${count('config')} with wrong APN / auth</b>` : 'all set to APN Broadband, no auth'} · ${count('nosig')} not connected · ${count('onlte')} on LTE now (main internet down)
        ${carriers.length ? ` · ${esc(carriers.join(', '))}` : ''}
        · read ${new Date(_data.at).toLocaleTimeString()}
      </p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${Object.entries(FILTERS).map(([k, [label]]) => `<button class="btn btn-sm ${_view.filter === k ? 'btn-orange' : 'btn-ghost'} net-filter" data-filter="${k}">${label} (${count(k)})</button>`).join('')}
      </div>
      <div class="search-bar"><input class="fi" id="net-search" placeholder="Search site, customer, IMEI, ICCID, MAC…" value="${esc(_view.search)}" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th>UniFi site</th><th>MAC / serial</th><th>IMEI</th><th>SIM (ICCID)</th><th>Carrier</th><th>APN · auth</th><th>SIM status</th><th>Signal</th><th>Internet</th></tr></thead>
        <tbody>
          ${rows.map(d => `<tr>
            <td>${esc(d.site)}</td>
            <td style="font-family:var(--mono);font-size:12px;">${esc(d.mac)}</td>
            <td style="font-family:var(--mono);font-size:12px;">${esc(d.imei || '—')}</td>
            <td style="font-family:var(--mono);font-size:12px;">${esc(d.iccid || '—')}</td>
            <td>${esc(d.carrier || '—')}${d.roaming ? '<div style="font-size:11px;color:var(--text-hint);">roaming</div>' : ''}</td>
            <td>${badApn(d) ? `<span class="badge b-zero" title="APN must be exactly ${REQUIRED_APN}">${esc(d.apn || 'no APN')}</span>` : esc(d.apn)}
              <div style="font-size:11px;">${badAuth(d) ? `<span class="badge b-zero" title="Auth type must be none">auth ${esc(d.authType || 'not reported')}</span>` : '<span style="color:var(--text-hint);">auth none</span>'}</div></td>
            <td>${simBadge(d)}</td>
            <td style="font-size:12px;">${esc(d.signal || '—')}${d.rsrp ? `<div style="font-size:11px;color:var(--text-hint);">RSRP ${esc(d.rsrp)} dBm</div>` : ''}</td>
            <td>${d.onLte ? '<span class="badge b-low">On LTE now</span>' : `<span style="font-size:12px;color:var(--text-muted);">${esc(d.failoverMode === 'failover' ? 'Backup' : d.failoverMode || '—')}</span>`}</td>
          </tr>`).join('') || `<tr><td colspan="9" class="empty">Nothing matches.</td></tr>`}
        </tbody>
      </table></div>
      ${_data.failed?.length ? `<div style="font-size:12px;color:var(--text-hint);margin-top:12px;">Couldn't read ${_data.failed.length} console${_data.failed.length !== 1 ? 's' : ''} (usually offline): ${esc(_data.failed.map(f => `${f.site} (${f.error})`).join(' · '))}</div>` : ''}`;

    el.querySelectorAll('.net-filter').forEach(b => b.addEventListener('click', () => { _view.filter = b.dataset.filter; draw(); }));
    const input = el.querySelector('#net-search');
    if (hadFocus) { input.focus(); input.setSelectionRange(caret, caret); }
    input.addEventListener('input', () => {
      _view.search = input.value;
      draw();   // draw() restores focus and caret
    });
  }

  return { render, refresh, _cacheParse: cacheParse, _fmtAge: fmtAge };
})();
