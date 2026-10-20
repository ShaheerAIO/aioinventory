/* ─────────────────────────────────────────────────────────────────────────────
   DeviceMap — register deployed hardware in the AIO production dashboard.

   A POS, KDS, kiosk or menu board looks itself up by serial when it boots
   (restaurant-by-deviceId), so its device record has to exist at the right
   restaurant first. This view does that from what inventory already knows:
   every customer with deployed or staged units, linked once to an AIO dashboard
   restaurant (tenant + location), then one button creates every missing device
   there. AMS1 payment terminals ride on a POS or kiosk record, so they are
   paired rather than created.

   The browser never holds dashboard credentials — every call goes through the
   aioDevices Cloud Function. Admins can look; only a super admin can write
   (the function enforces the same rule). Super admins also get a report of
   where inventory and the dashboard disagree, with a fix for each.
   ───────────────────────────────────────────────────────────────────────────── */
const DeviceMap = (() => {
  const ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/aioDevices';

  // ── Rules (pure — covered by test/device-map.test.js) ──────────────────────
  // Inventory category → dashboard device type. Everything else (routers, mounts,
  // cash drawers, displays, nuggets, tablets) has no dashboard record. Printers are
  // left out on purpose: they're bound to a restaurant locally by IP address, so
  // their serial in the dashboard doesn't decide where they print.
  const CATEGORY_TYPES = {
    'POS Terminal': 'pos',
    'Kiosk': 'kiosk',
    'Kitchen Display System': 'kds',
    'Menu Board': 'tv',
  };
  const TYPE_LABELS = { pos: 'POS', kiosk: 'Kiosk', kds: 'KDS', tv: 'Menu Board' };
  const PAYMENT_TYPES = ['pos', 'kiosk'];
  const TERMINAL_CATEGORY = 'Payment Terminal';
  const SERIAL_RE = /^(?!-)(?!.*--)[a-zA-Z0-9-]+(?<!-)$/;   // the dashboard's own rule

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Inventory stores an AMS1 as its bare number; the dashboard as "AMS1-<number>"
  const key = s => String(s || '').trim().toUpperCase().replace(/^AMS1-/, '');
  const terminalSerial = s => 'AMS1-' + key(s);

  const isTerminal = u => u.category === TERMINAL_CATEGORY && /^\d{6,}$/.test(key(u.serial));

  // null = not something the dashboard tracks, or a serial it can't take (NS- placeholders)
  function deviceTypeFor(u) {
    const type = CATEGORY_TYPES[u.category];
    if (!type) return null;
    const s = String(u.serial || '');
    if (/^NS-/i.test(s) || s.length < 2 || !SERIAL_RE.test(s)) return null;
    return type;
  }

  // "Pac Heights Deli" → "PHD", the suffix the dashboard's own device names use
  function initials(name) {
    return String(name || '').replace(/\([^)]*\)/g, ' ').split(/[^A-Za-z0-9]+/).filter(Boolean)
      .map(w => w[0].toUpperCase()).join('').slice(0, 5);
  }

  // Every inventory customer → their deployed + staged units
  function customerUnits() {
    const by = {};
    const add = (customer, u) => {
      const c = String(customer || '').trim();
      if (!c) return;
      (by[c] = by[c] || []).push(u);
    };
    Inventory.getDeployedSerialRows().forEach(r =>
      add(r.customer, { serial: r.serial, product: r.product, category: r.category, state: 'deployed', date: r.date }));
    DB.getPendingDeployments().forEach(pd => (pd.serials || []).forEach(s =>
      add(pd.customer, { serial: s, product: pd.product, category: pd.category, state: 'staged', date: pd.stagedAt })));
    return by;
  }

  // Best guess at a customer's dashboard restaurant, strongest evidence first
  function suggestLocation(customer, units, locations, serialMap) {
    const saved = DB.getDeviceLocation(customer);
    if (saved) {
      const loc = locations.find(l => l.restaurantId === saved.restaurantId && l.businessId === saved.businessId);
      if (loc) return { loc, why: 'linked', saved: true };
    }
    // Its hardware is already registered there
    const votes = {};
    units.forEach(u => { const rid = serialMap[key(u.serial)]; if (rid != null) votes[rid] = (votes[rid] || 0) + 1; });
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const loc = locations.find(l => l.restaurantId === Number(top[0]));
      if (loc) return { loc, why: `${top[1]} of its devices are already registered there` };
    }
    // "Crema (1750)" — the number is usually the dashboard location id
    const m = /\((\d+)\)\s*$/.exec(customer);
    if (m) {
      const loc = locations.find(l => l.restaurantId === Number(m[1]));
      if (loc) return { loc, why: `location ${m[1]} matches the number in the name` };
    }
    const norm = s => String(s || '').replace(/\([^)]*\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const want = norm(customer);
    const same = want ? locations.filter(l => norm(l.name) === want || norm(l.businessName) === want) : [];
    if (same.length === 1) return { loc: same[0], why: 'same name' };
    return null;
  }

  /* What mapping a customer's units to one restaurant would do.
     existing = that restaurant's devices (fresh from the dashboard).
     pairing  = { [deviceSerial]: terminalKey | '' } — the user's choices.
     Returns creates (ready to send), and everything else for display. */
  function buildPlan(units, loc, existing, serialMap, pairing = {}, names = {}) {
    const here = new Set(existing.map(d => key(d.serial)));
    const pairedHere = new Set(existing.map(d => key(d.paymentDeviceSerial)).filter(Boolean));
    const count = {};
    existing.forEach(d => { count[d.type] = (count[d.type] || 0) + 1; });
    const suffix = initials(loc.name);

    const rows = [];
    const creates = [];
    units.forEach(u => {
      if (isTerminal(u)) return;
      const type = deviceTypeFor(u);
      if (!type) return;
      const k = key(u.serial);
      if (here.has(k))                       rows.push({ ...u, type, status: 'mapped' });
      else if (serialMap[k] != null)         rows.push({ ...u, type, status: 'elsewhere', restaurantId: serialMap[k] });
      else {
        count[type] = (count[type] || 0) + 1;
        const name = names[u.serial] ?? `${TYPE_LABELS[type]} ${count[type]}${suffix ? ' - ' + suffix : ''}`;
        const row = { ...u, type, status: 'create', name };
        rows.push(row);
        creates.push(row);
      }
    });

    // Terminals: already on a device here, or free to pair with a new POS/kiosk
    const terminals = units.filter(isTerminal).map(u => ({ ...u, paired: pairedHere.has(key(u.serial)) }));
    const free = terminals.filter(t => !t.paired);
    const targets = creates.filter(c => PAYMENT_TYPES.includes(c.type));

    // One of each — nothing to decide
    const auto = targets.length === 1 && free.length === 1 && pairing[targets[0].serial] === undefined;
    const used = {};
    targets.forEach(t => {
      const choice = auto ? key(free[0].serial) : pairing[t.serial];
      t.terminal = choice || '';
      t.terminalChosen = auto || choice !== undefined;
      if (t.terminal) used[t.terminal] = (used[t.terminal] || 0) + 1;
    });

    const problems = [];
    if (free.length && targets.some(t => !t.terminalChosen))
      problems.push('Choose a payment terminal (or "None") for each POS and kiosk.');
    if (Object.values(used).some(n => n > 1))
      problems.push('A payment terminal can only go on one device.');
    if (creates.some(c => !String(c.name || '').trim()))
      problems.push('Every device needs a name.');

    // Devices here under a serial inventory doesn't have — usually a POS or menu
    // board registered by its Android id. Creating the hardware serial next to
    // one makes a second record for the same box.
    const known = new Set(units.map(u => key(u.serial)));
    const unknownHere = {};
    existing.filter(e => !known.has(key(e.serial))).forEach(e => { unknownHere[e.type] = (unknownHere[e.type] || 0) + 1; });
    const overlap = [...new Set(creates.map(c => c.type))].filter(t => unknownHere[t]).map(t => ({ type: t, count: unknownHere[t] }));

    const payload = creates.map(c => ({
      type: c.type, serial: c.serial, name: String(c.name).trim(),
      ...(c.terminal ? { paymentDeviceSerial: terminalSerial(c.terminal) } : {}),
    }));
    return { rows, creates, payload, terminals, free, targets, problems, overlap };
  }

  /* Where inventory and the dashboard disagree. Only serials inventory knows
     are considered — Android ids and backend-generated printer serials are
     unmappable by design. */
  function buildDiscrepancies(byCustomer, locations, serialMap) {
    const locById = {};
    locations.forEach(l => { locById[l.restaurantId] = l; });
    // restaurant → the inventory customer(s) that belong to it: saved links,
    // or the suggestion for customers not linked yet
    const reverse = {};
    Object.entries(byCustomer).forEach(([c, us]) => {
      if (DB.isHubspotIgnored(c)) return;
      const rid = suggestLocation(c, us, locations, serialMap)?.loc.restaurantId;
      if (rid != null) (reverse[rid] = reverse[rid] || []).push(c);
    });

    const inv = {};
    Object.entries(byCustomer).forEach(([c, us]) => us.forEach(u => { inv[key(u.serial)] = { ...u, customer: c }; }));
    Inventory.getAllSerialRows().forEach(r => {
      if (!inv[key(r.serial)]) inv[key(r.serial)] = { serial: r.serial, product: r.product, category: r.category, state: r.status, location: r.location };
    });

    const out = [];
    Object.entries(serialMap).forEach(([k, rid]) => {
      const u = inv[k];
      if (!u || isTerminal(u) || !deviceTypeFor(u)) return;   // printers etc. aren't mapped
      const at = locById[rid] || { restaurantId: rid, name: `location ${rid}` };
      const owners = reverse[rid] || [];
      if (u.state === 'in-stock' || u.state === 'in-transit') {
        out.push({ kind: 'stock', serial: u.serial, product: u.product, inv: u, at, owners });
        return;
      }
      if (u.state !== 'deployed' && u.state !== 'staged') return;
      const linked = DB.getDeviceLocation(u.customer);
      if (linked && linked.restaurantId !== rid)
        out.push({ kind: 'wrong', serial: u.serial, product: u.product, inv: u, at, owners, linked });
      else if (!linked && DB.isHubspotIgnored(u.customer))
        out.push({ kind: 'wrong', serial: u.serial, product: u.product, inv: u, at, owners, linked: null });
    });

    Object.entries(byCustomer).forEach(([c, us]) => {
      const linked = DB.getDeviceLocation(c);
      if (!linked) return;
      us.forEach(u => {
        if (u.state !== 'deployed' || isTerminal(u) || !deviceTypeFor(u) || serialMap[key(u.serial)] != null) return;
        out.push({ kind: 'missing', serial: u.serial, product: u.product, inv: { ...u, customer: c }, linked });
      });
    });
    return out;
  }

  /* UniFi, read-only. A UniFi device's id is its MAC, which inventory stores as
     the Ubiquiti serial. Each site (one console per restaurant) is matched to the
     inventory customer most of its devices are deployed to. */
  const UBIQUITI_CATEGORIES = ['Wi-Fi Access Point', 'Gateway/Router', 'Mobile Router', 'LTE Failover', 'PoE Switch'];
  // Consoles being set up at the warehouse — in-stock units there are expected
  const IGNORED_SITE_RE = /^(LA )?Template\b|QA Team/i;
  const macKey = s => String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');

  function buildUnifi(byCustomer, devices) {
    // A MAC on more than one site is a config cloned onto several consoles, not hardware
    const sitesOf = {};
    devices.forEach(d => { (sitesOf[macKey(d.mac)] = sitesOf[macKey(d.mac)] || new Set()).add(d.site); });
    const real = devices.filter(d => sitesOf[macKey(d.mac)].size === 1);
    const seen = {};
    real.forEach(d => { seen[macKey(d.mac)] = d; });

    const inv = {};
    Object.entries(byCustomer).forEach(([c, us]) => us.forEach(u => { inv[macKey(u.serial)] = { ...u, customer: c }; }));
    Inventory.getAllSerialRows().forEach(r => {
      if (!inv[macKey(r.serial)]) inv[macKey(r.serial)] = { serial: r.serial, product: r.product, category: r.category, state: r.status, location: r.location };
    });
    const everKnown = new Set(DB.getData().movements.flatMap(m => (m.serials || []).map(macKey)));

    const counted = real.filter(d => !IGNORED_SITE_RE.test(d.site));
    const votes = {};
    counted.forEach(d => {
      const u = inv[macKey(d.mac)];
      if (!u || !u.customer || DB.isHubspotIgnored(u.customer)) return;
      const v = votes[d.site] = votes[d.site] || {};
      v[u.customer] = (v[u.customer] || 0) + 1;
    });
    const siteCustomer = {};
    Object.entries(votes).forEach(([site, v]) => { siteCustomer[site] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]; });
    // A site with nothing deployed yet: fall back to one customer whose name matches
    const norm = x => String(x || '').replace(/\([^)]*\)/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const names = Object.keys(byCustomer).filter(c => !DB.isHubspotIgnored(c));
    new Set(counted.map(d => d.site)).forEach(site => {
      if (siteCustomer[site]) return;
      const n = norm(site);
      const hits = n.length >= 4 ? names.filter(c => { const m = norm(c); return m.length >= 4 && (m.startsWith(n) || n.startsWith(m)); }) : [];
      if (hits.length === 1) siteCustomer[site] = hits[0];
    });

    const items = [];
    counted.forEach(d => {
      const k = macKey(d.mac), u = inv[k], owner = siteCustomer[d.site];
      const base = { source: 'UniFi', serial: u?.serial || d.mac, product: u?.product || d.model, at: { name: d.site }, owners: owner ? [owner] : [], unifi: d };
      if (!u) { if (!everKnown.has(k)) items.push({ ...base, kind: 'u-unknown', inv: { state: 'unknown' } }); return; }
      if (u.state === 'in-stock' || u.state === 'in-transit') items.push({ ...base, kind: 'u-stock', inv: u });
      else if ((u.state === 'deployed' || u.state === 'staged') && owner && u.customer !== owner) items.push({ ...base, kind: 'u-wrong', inv: u });
    });

    const perCustomer = {};
    Object.entries(byCustomer).forEach(([c, us]) => {
      const ubq = us.filter(u => u.state === 'deployed' && UBIQUITI_CATEGORIES.includes(u.category));
      if (!ubq.length) return;
      const found = ubq.filter(u => seen[macKey(u.serial)]);
      perCustomer[c] = { total: ubq.length, seen: found.length, online: found.filter(u => seen[macKey(u.serial)].status === 'online').length };
      if (DB.isHubspotIgnored(c)) return;
      ubq.filter(u => !seen[macKey(u.serial)]).forEach(u =>
        items.push({ source: 'UniFi', kind: 'u-missing', serial: u.serial, product: u.product, inv: { ...u, customer: c }, at: null, owners: [] }));
    });
    return { items, perCustomer, siteCustomer, seen, inv };
  }

  /* One customer's UniFi picture: its own Ubiquiti units and where UniFi sees
     them, plus anything else live at its site(s) that inventory files elsewhere. */
  function unifiForCustomer(customer, byCustomer, devices) {
    const u = buildUnifi(byCustomer, devices);
    const own = (byCustomer[customer] || [])
      .filter(x => (x.state === 'deployed' || x.state === 'staged') && UBIQUITI_CATEGORIES.includes(x.category))
      .map(x => ({ ...x, device: u.seen[macKey(x.serial)] || null }));
    const sites = new Set(own.filter(o => o.device).map(o => o.device.site));
    Object.entries(u.siteCustomer).forEach(([site, c]) => { if (c === customer) sites.add(site); });
    const ownKeys = new Set(own.map(o => macKey(o.serial)));
    const extra = Object.values(u.seen)
      .filter(dv => sites.has(dv.site) && !IGNORED_SITE_RE.test(dv.site) && !ownKeys.has(macKey(dv.mac)))
      .map(dv => ({ device: dv, inv: u.inv[macKey(dv.mac)] || null }));
    return { own, extra, sites: [...sites] };
  }

  // ── Server calls ───────────────────────────────────────────────────────────
  async function idToken() {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const user = getAuth().currentUser;
    if (!user) throw new Error('Not signed in');
    return user.getIdToken();
  }

  async function api(params, body) {
    const headers = { Authorization: `Bearer ${await idToken()}` };
    const opts = body ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers };
    const url = body ? ENDPOINT : `${ENDPOINT}?${new URLSearchParams(params)}`;
    // A missing function or a disallowed origin both surface as a bare "Failed to fetch"
    const res = await fetch(url, opts).catch(() => {
      throw new Error('the aioDevices Cloud Function did not respond — check it is deployed and that this site\'s address is in its allowed origins');
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `AIO dashboard request failed (${res.status})`);
    return json;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let _ov = null;            // { locations, serials }
  let _unifi = null;         // { devices } | { error } — read-only, never blocks the view
  let _serialMap = {};       // key(serial) → restaurantId
  let _view = { customer: null, search: '', filter: 'all', tab: 'list' };
  let _detail = null;        // { customer, loc, existing, pairing, names, results }
  let _pendingOpen = null;
  let _loading = false;
  const _openReport = new Set(); // discrepancy sections left expanded, kept across re-renders

  const root = () => document.getElementById('dm-root');
  const locLabel = l => `${l.name}${l.businessName && l.businessName !== l.name ? ` — ${l.businessName}` : ''}`;
  const locIds = l => `tenant ${l.businessId} · location ${l.restaurantId}`;

  async function loadOverview(fresh) {
    _loading = true;
    try {
      _ov = await api({ action: 'overview', ...(fresh ? { fresh: '1' } : {}) });
      _serialMap = {};
      _ov.serials.forEach(s => { _serialMap[key(s.serial)] = s.restaurantId; });
    } finally { _loading = false; }
  }

  async function render() {
    const el = root();
    if (!el) return;
    if (_pendingOpen) { _view.customer = _pendingOpen; _pendingOpen = null; }
    if (!_ov) {
      el.innerHTML = `<div class="empty">Loading restaurants from the AIO dashboard…</div>`;
      try { await loadOverview(false); }
      catch (e) { el.innerHTML = `<div class="empty">Couldn't reach the AIO dashboard — ${esc(e.message)}</div>`; return; }
    }
    if (!_unifi) {
      try { _unifi = await api({ action: 'unifi' }); }
      catch (e) { _unifi = { error: e.message }; }
    }
    if (_view.customer) return renderDetail(_view.customer);
    renderList();
  }

  const unifiView = byCustomer => _unifi?.devices ? buildUnifi(byCustomer, _unifi.devices) : null;

  // ── List: one row per inventory customer ──────────────────────────────────
  // hidden = the names marked "Not a customer" (people, warehouses, test buckets)
  function listRows(hidden = false) {
    const byCustomer = customerUnits();
    return Object.entries(byCustomer)
      .filter(([c]) => DB.isHubspotIgnored(c) === hidden)
      .map(([c, units]) => {
        const sug = suggestLocation(c, units, _ov.locations, _serialMap);
        const devices = units.filter(u => !isTerminal(u) && deviceTypeFor(u));
        const rid = sug?.loc.restaurantId;
        const mapped = devices.filter(u => _serialMap[key(u.serial)] === rid && rid != null).length;
        const elsewhere = devices.filter(u => _serialMap[key(u.serial)] != null && _serialMap[key(u.serial)] !== rid).length;
        const toMap = devices.length - mapped - elsewhere;
        const staged = units.filter(u => u.state === 'staged').length;
        const last = units.map(u => u.date || '').sort().pop() || '';
        return { customer: c, sug, devices: devices.length, mapped, elsewhere, toMap, staged, last };
      })
      .filter(r => r.devices > 0)
      .sort((a, b) => (b.toMap > 0) - (a.toMap > 0) || String(b.last).localeCompare(String(a.last)));
  }

  const FILTERS = { all: 'All', tomap: 'To map', unlinked: 'Not linked', elsewhere: 'Elsewhere', unifi: 'UniFi issue' };

  function renderList() {
    const isSuperUser = Auth.isSuperAdmin();
    const showHidden = isSuperUser && _view.filter === 'hidden';
    const rows = listRows();
    const hiddenRows = isSuperUser ? listRows(true) : [];
    const byCustomer = customerUnits();
    const uni = unifiView(byCustomer);
    const isSuper = Auth.isSuperAdmin();
    const tab = isSuper && _view.tab === 'report' ? 'report' : 'list';
    const uniIssue = c => { const u = uni?.perCustomer[c]; return !!u && u.online < u.total; };
    const match = {
      all: () => true, tomap: r => r.toMap > 0, unlinked: r => !r.sug,
      elsewhere: r => r.elsewhere > 0, unifi: r => uniIssue(r.customer),
    };
    const counts = Object.fromEntries(Object.keys(FILTERS).map(k => [k, rows.filter(match[k]).length]));
    const f = showHidden ? 'hidden' : match[_view.filter] ? _view.filter : 'all';
    const q = _view.search.trim().toLowerCase();
    const shown = (showHidden ? hiddenRows : rows.filter(match[f])).filter(r => !q || r.customer.toLowerCase().includes(q) || (r.sug && locLabel(r.sug.loc).toLowerCase().includes(q)));

    const chip = (n, label, cls, title) => n ? `<span class="badge ${cls}"${title ? ` title="${esc(title)}"` : ''}>${n} ${label}</span>` : '';
    const uniChip = c => {
      const u = uni?.perCustomer[c];
      if (!u) return '';
      const cls = u.online === u.total ? 'b-ok' : u.seen === u.total ? 'b-low' : 'b-zero';
      return `<span class="badge ${cls}" title="${u.seen} of ${u.total} deployed Ubiquiti units found in UniFi, ${u.online} online">UniFi ${u.online}/${u.total}</span>`;
    };
    const card = r => `
      <div class="dm-card" data-customer="${esc(r.customer)}" style="border:1px solid var(--border);border-radius:8px;padding:14px;cursor:pointer;background:var(--bg-2);">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${esc(r.customer)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;min-height:16px;">
          ${r.sug ? `${esc(r.sug.loc.name)} <span style="color:var(--text-hint);">· ${r.sug.loc.businessId}/${r.sug.loc.restaurantId}${r.sug.saved ? '' : ' · suggested'}</span>` : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${r.sug ? '' : '<span class="badge b-zero">Not linked</span>'}
          ${chip(r.toMap, 'to map', 'b-out')}
          ${chip(r.mapped, 'mapped', 'b-ok')}
          ${chip(r.elsewhere, 'elsewhere', 'b-zero', 'Registered at a different restaurant')}
          ${chip(r.staged, 'staged', 'b-low')}
          ${uniChip(r.customer)}
        </div>
        ${isSuperUser ? `<div style="display:flex;justify-content:flex-end;margin-top:8px;">${showHidden
          ? `<button class="btn btn-ghost btn-xs dm-notcust" data-customer="${esc(r.customer)}" data-hide="0">Restore as customer</button>`
          : `<button class="btn btn-ghost btn-xs dm-notcust" data-customer="${esc(r.customer)}" data-hide="1" title="People, warehouses, test or write-off buckets — hides it here and from HubSpot mapping">Not a customer</button>`}</div>` : ''}
      </div>`;

    const tabs = isSuper ? `
      <div style="display:flex;gap:4px;margin-bottom:12px;">
        <button class="btn btn-sm ${tab === 'list' ? 'btn-orange' : 'btn-ghost'} dm-tab" data-tab="list">Restaurants</button>
        <button class="btn btn-sm ${tab === 'report' ? 'btn-orange' : 'btn-ghost'} dm-tab" data-tab="report">Discrepancies</button>
      </div>` : '';

    if (tab === 'report') {
      root().innerHTML = tabs + `<div id="dm-report"></div>`;
      wireTabs();
      renderReport();
      return;
    }

    root().innerHTML = tabs + `
      <div class="search-bar"><input class="fi" id="dm-search" placeholder="Search customer or restaurant…" value="${esc(_view.search)}" /></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        ${Object.entries(FILTERS).map(([k, label]) => `<button class="btn btn-xs ${f === k ? 'btn-orange' : 'btn-ghost'} dm-filter" data-filter="${k}">${label} · ${counts[k]}</button>`).join('')}
        ${isSuperUser ? `<button class="btn btn-xs ${f === 'hidden' ? 'btn-orange' : 'btn-ghost'} dm-filter" data-filter="hidden" title="Names marked Not a customer">Not customers · ${hiddenRows.length}</button>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
        ${rows.length} customer${rows.length !== 1 ? 's' : ''} with dashboard devices · ${rows.reduce((a, r) => a + r.toMap, 0)} devices to map${uni ? '' : ` · UniFi unavailable${_unifi?.error ? ` (${esc(_unifi.error)})` : ''}`}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
        ${shown.map(card).join('') || '<div class="empty">No customers match.</div>'}
      </div>`;

    wireTabs();
    const search = document.getElementById('dm-search');
    // renderList() replaces the box, so put focus and the caret back where they were
    search.addEventListener('input', () => {
      const at = search.selectionStart;
      _view.search = search.value;
      renderList();
      const box = document.getElementById('dm-search');
      box.focus();
      box.setSelectionRange(at, at);
    });
    root().querySelectorAll('.dm-filter').forEach(b => b.addEventListener('click', () => { _view.filter = b.dataset.filter; renderList(); }));
    root().querySelectorAll('.dm-card').forEach(c => c.addEventListener('click', () => openCustomer(c.dataset.customer)));
    root().querySelectorAll('.dm-notcust').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();   // the card behind it opens the customer
      setNotCustomer(b.dataset.customer, b.dataset.hide === '1');
    }));
  }

  // Super admin: "Not a customer" is the same list HubSpot mapping uses, so one
  // mark hides a name from both
  function setNotCustomer(customer, hide) {
    if (!Auth.isSuperAdmin()) return;
    if (hide && !confirm(`Mark "${customer}" as not a customer?\n\nIt disappears from Map Devices, the discrepancy report and HubSpot mapping. Its units stay exactly as they are in inventory. You can restore it under "Not customers".`)) return;
    DB.setHubspotIgnored(customer, hide);
    UI.showAlert(hide ? `"${customer}" marked as not a customer` : `"${customer}" restored as a customer`, 'success');
    if (_view.customer) { _view.customer = null; _detail = null; }
    renderList();
  }

  function wireTabs() {
    root().querySelectorAll('.dm-tab').forEach(b => b.addEventListener('click', () => { _view.tab = b.dataset.tab; renderList(); }));
  }

  // ── Detail: one customer, one button ──────────────────────────────────────
  async function openCustomer(customer) {
    _view.customer = customer;
    _detail = { customer, loc: null, existing: null, pairing: {}, names: {}, results: null, error: '' };
    const units = customerUnits()[customer] || [];
    const sug = suggestLocation(customer, units, _ov.locations, _serialMap);
    if (sug) await selectLocation(sug.loc, sug);
    else renderDetail(customer);
  }

  async function selectLocation(loc, sug) {
    Object.assign(_detail, { loc, sug: sug || { loc, why: 'chosen' }, existing: null, pairing: {}, names: {}, results: null, error: '' });
    renderDetail(_detail.customer);
    try {
      _detail.existing = (await api({ action: 'devices', businessId: loc.businessId, restaurantId: loc.restaurantId })).devices;
    } catch (e) { _detail.error = e.message; }
    renderDetail(_detail.customer);
  }

  function unifiSection(customer) {
    if (!_unifi?.devices) return _unifi?.error ? `<div style="font-size:12px;color:var(--text-hint);margin-top:16px;">UniFi unavailable — ${esc(_unifi.error)}</div>` : '';
    const { own, extra, sites } = unifiForCustomer(customer, customerUnits(), _unifi.devices);
    if (!own.length && !extra.length) return '';
    const status = dv => dv ? `<span class="badge ${dv.status === 'online' ? 'b-ok' : 'b-zero'}">${esc(dv.status || '?')}</span>` : '<span class="badge b-zero">Not in UniFi</span>';
    const invText = i => !i ? '<span class="badge b-zero">Not in inventory</span>'
      : i.state === 'deployed' || i.state === 'staged' ? `${i.state === 'staged' ? 'Staged for' : 'Deployed to'} ${esc(i.customer)}`
      : `${i.state === 'in-transit' ? 'In transit to' : 'In stock at'} ${esc(i.location || '—')}`;
    const canFix = Auth.isSuperAdmin();
    return `
      <div class="panel-title" style="margin-top:20px;">UniFi <span style="font-size:12px;color:var(--text-hint);font-weight:400;">${sites.length ? esc(sites.join(' · ')) : 'no site found'} · read only</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>MAC / serial</th><th>Product</th><th>UniFi site</th><th>Name in UniFi</th><th>Status</th><th>Inventory</th></tr></thead>
        <tbody>
          ${own.map(o => `<tr>
            <td style="font-family:var(--mono);font-size:12px;">${esc(o.serial)}${o.state === 'staged' ? ' <span class="badge b-low">staged</span>' : ''}</td>
            <td>${esc(o.product)}</td>
            <td>${o.device ? esc(o.device.site) : '—'}</td>
            <td>${o.device ? esc(o.device.name || '—') : '—'}</td>
            <td>${status(o.device)}</td>
            <td>${o.device && !sites.includes(o.device.site) ? '<span class="badge b-zero">At another site</span>' : 'This customer'}</td>
          </tr>`).join('')}
          ${extra.map(x => `<tr>
            <td style="font-family:var(--mono);font-size:12px;">${esc(x.device.mac)}</td>
            <td>${esc(x.inv?.product || x.device.model)}</td>
            <td>${esc(x.device.site)}</td>
            <td>${esc(x.device.name || '—')}</td>
            <td>${status(x.device)}</td>
            <td>${invText(x.inv)}${canFix && x.inv?.state === 'in-stock'
              ? ` <button class="btn btn-ghost btn-xs dm-uni-dispatch" data-serial="${esc(x.inv.serial)}" data-site="${esc(x.device.site)}">Record as dispatched here</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  function renderDetail(customer) {
    if (!_detail || _detail.customer !== customer) { openCustomer(customer); return; }
    const d = _detail;
    const units = customerUnits()[customer] || [];
    const canWrite = Auth.isSuperAdmin();
    const other = units.filter(u => !isTerminal(u) && !deviceTypeFor(u));
    const header = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <button class="btn btn-ghost btn-sm" id="dm-back">← All customers</button>
        <h3 style="margin:0;font-size:18px;flex:1;">${esc(customer)}</h3>
        ${canWrite ? `<button class="btn btn-ghost btn-xs" id="dm-notcust" title="People, warehouses, test or write-off buckets">Not a customer</button>` : ''}
      </div>`;

    const locBox = d.loc ? `
      <div style="padding:12px 14px;border:1px solid var(--border-md);border-radius:var(--r-md);margin-bottom:14px;display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <div style="font-size:14px;font-weight:600;">${esc(locLabel(d.loc))}</div>
          <div style="font-size:12px;color:var(--text-hint);">${esc(locIds(d.loc))}${d.loc.address ? ` · ${esc(d.loc.address)}` : ''}</div>
          ${d.sug.saved ? '' : `<div style="font-size:12px;margin-top:4px;color:var(--warning-text);">Suggested — ${esc(d.sug.why)}. ${canWrite ? 'Mapping links it.' : ''}</div>`}
        </div>
        ${canWrite ? `<div style="display:flex;gap:6px;flex-shrink:0;">
          ${d.sug.saved ? '' : `<button class="btn btn-primary btn-xs" id="dm-confirm">Confirm link</button>`}
          <button class="btn btn-ghost btn-xs" id="dm-change">Change restaurant</button>
        </div>` : ''}
      </div>` : `
      <div style="padding:12px 14px;border:1px dashed var(--border-md);border-radius:var(--r-md);margin-bottom:14px;">
        No AIO dashboard restaurant found for this customer.
        ${canWrite ? `<button class="btn btn-primary btn-xs" id="dm-change" style="margin-left:8px;">Choose restaurant</button>` : ' A super admin needs to link it.'}
      </div>`;

    if (!d.loc || (!d.existing && !d.error)) {
      root().innerHTML = header + locBox + (d.loc ? `<div class="empty">Reading this restaurant's devices…</div>` : '') + unifiSection(customer);
      wireDetail();
      return;
    }
    if (d.error) {
      root().innerHTML = header + locBox + `<div class="empty">Couldn't read this restaurant's devices — ${esc(d.error)}</div>` + unifiSection(customer);
      wireDetail();
      return;
    }

    const plan = buildPlan(units, d.loc, d.existing, _serialMap, d.pairing, d.names);
    const locName = rid => { const l = _ov.locations.find(x => x.restaurantId === rid); return l ? l.name : `location ${rid}`; };
    const terminalOpts = t => [`<option value="" ${t.terminalChosen && !t.terminal ? 'selected' : ''}>None</option>`]
      .concat(plan.free.map(f => `<option value="${esc(key(f.serial))}" ${t.terminal === key(f.serial) ? 'selected' : ''}>AMS1-${esc(key(f.serial))}</option>`)).join('');
    const statusCell = r => r.status === 'mapped' ? '<span class="badge b-ok">Mapped</span>'
      : r.status === 'elsewhere' ? `<span class="badge b-zero">At ${esc(locName(r.restaurantId))}</span>`
      : d.results?.[r.serial] ? (d.results[r.serial].ok ? '<span class="badge b-ok">Mapped</span>' : `<span class="badge b-zero" title="${esc(d.results[r.serial].message)}">Failed</span>`)
      : '<span class="badge b-out">To map</span>';

    const rowsHtml = plan.rows.map(r => `
      <tr>
        <td class="fi-mono" style="font-family:var(--mono);font-size:12px;">${esc(r.serial)}${r.state === 'staged' ? ' <span class="badge b-low">staged</span>' : ''}</td>
        <td>${esc(r.product)}</td>
        <td>${esc(TYPE_LABELS[r.type])}</td>
        <td>${r.status === 'create' && canWrite
              ? `<input class="fi dm-name" data-serial="${esc(r.serial)}" value="${esc(r.name)}" style="min-width:160px;" />`
              : esc(r.status === 'create' ? r.name : (d.existing.find(x => key(x.serial) === key(r.serial))?.name || '—'))}</td>
        <td>${r.status === 'create' && PAYMENT_TYPES.includes(r.type) && plan.free.length
              ? (canWrite ? `<select class="fi dm-term" data-serial="${esc(r.serial)}">${r.terminalChosen ? '' : '<option value="" disabled selected>Choose…</option>'}${terminalOpts(r)}</select>`
                          : esc(r.terminal ? 'AMS1-' + r.terminal : '—'))
              : r.status === 'mapped' ? esc(d.existing.find(x => key(x.serial) === key(r.serial))?.paymentDeviceSerial || '—') : '—'}</td>
        <td>${statusCell(r)}</td>
        ${canWrite ? `<td style="white-space:nowrap;">${
          r.status === 'mapped' ? `<button class="btn btn-ghost btn-xs dm-move" data-serial="${esc(r.serial)}">Move…</button>`
          : r.status === 'elsewhere' ? `<button class="btn btn-ghost btn-xs dm-move" data-serial="${esc(r.serial)}" data-here="1">Move here</button>` : ''}</td>` : ''}
      </tr>`).join('');

    const pending = d.results ? plan.payload.filter(p => !d.results[p.serial]?.ok) : plan.payload;
    const terminalsNote = plan.terminals.length ? `
      <div style="font-size:12px;color:var(--text-muted);margin:10px 0;">
        Payment terminals: ${plan.terminals.map(t => `AMS1-${esc(key(t.serial))} ${t.paired ? '(on a device here)' : '(free)'}`).join(' · ')}
        ${plan.free.length && !plan.targets.length ? ' — no new POS or kiosk to put them on. Pair them in the dashboard.' : ''}
      </div>` : '';

    root().innerHTML = header + locBox + `
      <div class="table-wrap"><table>
        <thead><tr><th>Serial</th><th>Product</th><th>Type</th><th>Name in dashboard</th><th>Payment terminal</th><th>Status</th>${canWrite ? '<th></th>' : ''}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" class="empty">No dashboard devices among this customer's units.</td></tr>`}</tbody>
      </table></div>
      ${terminalsNote}
      ${plan.overlap.length && pending.length ? `<div style="font-size:13px;color:var(--warning-text);background:var(--warning-bg);border:1px solid var(--warning-border);border-radius:var(--r-md);padding:8px 10px;margin-bottom:10px;">
        This restaurant already has ${plan.overlap.map(o => `${o.count} ${esc(TYPE_LABELS[o.type])}${o.count !== 1 ? 's' : ''}`).join(', ')} registered under serials inventory doesn't know — often a device's Android id.
        If one of those is the same box you're about to map, you'll end up with two records for it. Check the dashboard and delete the old one if so.</div>` : ''}
      ${other.length ? `<div style="font-size:12px;color:var(--text-hint);margin-bottom:10px;">${other.length} other unit${other.length !== 1 ? 's' : ''} (routers, mounts, displays, placeholders…) have no dashboard record and are skipped.</div>` : ''}
      ${plan.problems.length && pending.length ? `<div style="font-size:13px;color:var(--danger-text);margin-bottom:8px;">${plan.problems.map(esc).join('<br>')}</div>` : ''}
      ${canWrite && pending.length ? `
        <button class="btn btn-primary" id="dm-map" ${plan.problems.length ? 'disabled' : ''}>
          Map ${pending.length} device${pending.length !== 1 ? 's' : ''} to ${esc(d.loc.name)}
        </button>` : ''}
      ${!canWrite && pending.length ? `<div style="font-size:13px;color:var(--text-muted);">${pending.length} device${pending.length !== 1 ? 's' : ''} to map — a super admin can map them.</div>` : ''}
      ${!pending.length && plan.rows.length ? `<div style="font-size:13px;color:var(--success-text);">Every device for this customer is registered in the dashboard.</div>` : ''}
      ${unifiSection(customer)}`;

    wireDetail(plan, pending);
  }

  function wireDetail(plan, pending) {
    const d = _detail;
    document.getElementById('dm-back')?.addEventListener('click', () => { _view.customer = null; _detail = null; renderList(); });
    document.getElementById('dm-notcust')?.addEventListener('click', () => setNotCustomer(d.customer, true));
    root().querySelectorAll('.dm-uni-dispatch').forEach(b => b.addEventListener('click', () =>
      runFix({ fix: 'dispatch', customer: d.customer }, { serial: b.dataset.serial, at: { name: b.dataset.site }, source: 'UniFi' })));
    document.getElementById('dm-change')?.addEventListener('click', () =>
      pickLocation({ title: `AIO dashboard restaurant for ${d.customer}`, seed: d.customer.replace(/\s*\([^()]*\)\s*$/, '') }, loc => {
        DB.setDeviceLocation(d.customer, loc);
        selectLocation(loc, { loc, why: 'linked', saved: true });
      }));
    root().querySelectorAll('.dm-move').forEach(b => b.addEventListener('click', () => {
      const r = plan.rows.find(x => x.serial === b.dataset.serial);
      if (b.dataset.here) runMove(r, d.loc);
      else pickLocation({ title: `Move ${r.serial} to another restaurant`, exclude: d.loc.restaurantId }, loc => runMove(r, loc));
    }));
    document.getElementById('dm-confirm')?.addEventListener('click', () => {
      DB.setDeviceLocation(d.customer, d.loc);
      d.sug = { ...d.sug, saved: true };
      renderDetail(d.customer);
    });
    root().querySelectorAll('.dm-name').forEach(inp => inp.addEventListener('change', () => { d.names[inp.dataset.serial] = inp.value; renderDetail(d.customer); }));
    root().querySelectorAll('.dm-term').forEach(sel => sel.addEventListener('change', () => { d.pairing[sel.dataset.serial] = sel.value; renderDetail(d.customer); }));
    document.getElementById('dm-map')?.addEventListener('click', () => runMap(plan, pending));
  }

  async function runMap(plan, pending) {
    const d = _detail;
    const btn = document.getElementById('dm-map');
    if (!pending.length || plan.problems.length) return;
    const terms = pending.filter(p => p.paymentDeviceSerial).length;
    if (!confirm(`Create ${pending.length} device${pending.length !== 1 ? 's' : ''} at ${d.loc.name} (tenant ${d.loc.businessId}) in the AIO production dashboard?` +
      (terms ? `\n\n${terms} payment terminal${terms !== 1 ? 's' : ''} will be assigned to this restaurant's Adyen store.` : ''))) return;
    btn.disabled = true;
    btn.textContent = 'Mapping…';
    try {
      // The link is the source of truth for this customer from now on
      if (!d.sug.saved) { DB.setDeviceLocation(d.customer, d.loc); d.sug = { ...d.sug, saved: true }; }
      const { results } = await api(null, { action: 'map', businessId: d.loc.businessId, restaurantId: d.loc.restaurantId, devices: pending });
      d.results = { ...(d.results || {}) };
      results.forEach(r => { d.results[r.serial] = r; });
      const ok = results.filter(r => r.ok), bad = results.filter(r => !r.ok);
      Activity.log('mapDevices',
        `AIO dashboard: mapped ${ok.length} device(s) for ${d.customer} to ${d.loc.name} (tenant ${d.loc.businessId}, location ${d.loc.restaurantId})` +
          (bad.length ? `; ${bad.length} failed` : ''),
        { restaurant: d.loc, sent: pending, results },
        pending.flatMap(p => [p.serial, p.paymentDeviceSerial ? key(p.paymentDeviceSerial) : null]).filter(Boolean));
      UI.showAlert(bad.length
        ? `${ok.length} mapped, ${bad.length} failed: ${bad.map(b => `${b.serial} — ${b.message}`).join('; ')}`
        : `${ok.length} device${ok.length !== 1 ? 's' : ''} mapped to ${d.loc.name}`, bad.length ? 'error' : 'success');
      await loadOverview(true);
      d.existing = (await api({ action: 'devices', businessId: d.loc.businessId, restaurantId: d.loc.restaurantId })).devices;
    } catch (e) {
      UI.showAlert(e.message, 'error');
    }
    renderDetail(d.customer);
  }

  /* Super admin: move one registered device to another restaurant — any tenant.
     The function deletes it where it is and creates it at the destination (putting
     it back if that fails); a POS or kiosk keeps its payment terminal, which the
     backend re-assigns to the destination's Adyen store. */
  async function runMove(r, to) {
    const d = _detail;
    const fromRid = _serialMap[key(r.serial)];
    const from = _ov.locations.find(l => l.restaurantId === fromRid);
    if (!from) { UI.showAlert(`${r.serial} isn't registered in the dashboard`, 'error'); return; }
    let current = r.name || '';
    if (from.restaurantId === d.loc.restaurantId) current = d.existing.find(x => key(x.serial) === key(r.serial))?.name || current;
    else {
      try { current = (await api({ action: 'devices', businessId: from.businessId, restaurantId: from.restaurantId })).devices.find(x => key(x.serial) === key(r.serial))?.name || current; }
      catch (_) { /* name is only a default */ }
    }
    // "POS 1 - PHD" → "POS 1 - TUT": swap the restaurant initials on the end
    const fromTag = initials(from.name), toTag = initials(to.name);
    const suggested = fromTag && current.endsWith(' - ' + fromTag) ? current.slice(0, -fromTag.length) + toTag : current || `${TYPE_LABELS[r.type]} - ${toTag}`;
    const name = (prompt(`Move ${r.serial} (${r.product})\n\nfrom ${from.name} (tenant ${from.businessId})\nto ${to.name} (tenant ${to.businessId})\n\nName at the new restaurant:`, suggested) || '').trim();
    if (!name) return;

    const res = await api(null, { action: 'move', serial: r.serial, name, to: { businessId: to.businessId, restaurantId: to.restaurantId } })
      .catch(e => ({ ok: false, message: e.message }));
    Activity.log('moveDevice',
      `AIO dashboard: ${res.ok ? 'moved' : 'FAILED to move'} ${r.serial} from ${from.name} (tenant ${from.businessId}) to ${to.name} (tenant ${to.businessId}) as "${name}"` +
        (res.ok ? '' : ` — ${res.message}${res.restored ? ' (put back)' : ''}`),
      { serial: r.serial, from, to, name, result: res }, [r.serial]);
    if (!res.ok) {
      UI.showAlert(`${r.serial}: ${res.message}${res.restored ? ' — it was put back where it was' : res.restored === false ? ' — it could NOT be put back; re-add it in the dashboard' : ''}`, 'error');
    } else {
      UI.showAlert(`${r.serial} moved to ${to.name}`, 'success');
      // Keep inventory in step when the destination belongs to another customer
      const owner = Object.entries(DB.getDeviceLocationMap()).filter(([, l]) => l.restaurantId === to.restaurantId).map(([c]) => c);
      if (r.state === 'deployed' && owner.length === 1 && owner[0] !== d.customer &&
          confirm(`Also change ${r.serial}'s customer in inventory from "${d.customer}" to "${owner[0]}"?`)) {
        try { Inventory.superEditSerial(r.serial, { customer: owner[0] }, `Moved to ${to.name} in the AIO dashboard`); }
        catch (e) { UI.showAlert(e.message, 'error'); }
      }
    }
    await loadOverview(true);
    try { d.existing = (await api({ action: 'devices', businessId: d.loc.businessId, restaurantId: d.loc.restaurantId })).devices; } catch (_) {}
    renderDetail(d.customer);
  }

  // ── Restaurant picker ─────────────────────────────────────────────────────
  function pickLocation({ title, seed = '', exclude = null }, onPick) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="width:600px;max-height:86vh;display:flex;flex-direction:column;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>${esc(title)}</span>
          <button class="btn-remove-row" id="dmp-close">×</button>
        </div>
        <input class="fi" id="dmp-q" placeholder="Search name, tenant or location id, address…" autocomplete="off" value="${esc(seed)}" />
        <div id="dmp-results" style="flex:1;overflow-y:auto;max-height:52vh;margin-top:10px;"></div>
      </div>`;
    document.body.appendChild(overlay);
    const q = overlay.querySelector('#dmp-q'), out = overlay.querySelector('#dmp-results');
    const paint = () => {
      const t = q.value.trim().toLowerCase();
      const hits = _ov.locations.filter(l => l.restaurantId !== exclude).filter(l => !t || [l.name, l.businessName, l.address, String(l.businessId), String(l.restaurantId)]
        .some(v => String(v || '').toLowerCase().includes(t))).slice(0, 60);
      out.innerHTML = hits.map(l => `
        <div class="dmp-row" data-rid="${l.restaurantId}" style="padding:8px 10px;border:1px solid var(--border-md);border-radius:var(--r-md);margin-bottom:6px;cursor:pointer;">
          <div style="font-size:13px;font-weight:600;">${esc(locLabel(l))}</div>
          <div style="font-size:11px;color:var(--text-hint);">${esc(locIds(l))}${l.address ? ' · ' + esc(l.address) : ''}</div>
        </div>`).join('') || `<div style="font-size:12px;color:var(--text-hint);">No restaurants match.</div>`;
      out.querySelectorAll('.dmp-row').forEach(row => row.addEventListener('click', () => {
        const loc = _ov.locations.find(l => l.restaurantId === Number(row.dataset.rid));
        overlay.remove();
        onPick(loc);
      }));
    };
    q.addEventListener('input', paint);
    overlay.querySelector('#dmp-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    paint();
    setTimeout(() => q.focus(), 50);
  }

  // ── Super admin: discrepancy report ───────────────────────────────────────
  const REPORT_KINDS = {
    wrong:   { title: 'Registered at a different restaurant than inventory says', hint: 'The dashboard and inventory disagree on where this unit is.' },
    stock:   { title: 'Registered in the dashboard, but in stock in inventory', hint: 'Usually a dispatch that was never recorded in inventory.' },
    missing: { title: 'Deployed in inventory, not in the dashboard', hint: 'The device will not find its restaurant when it boots.' },
  };
  const UNIFI_KINDS = {
    'u-wrong':   { title: 'At a UniFi site that belongs to a different customer', hint: 'The site is matched to the inventory customer most of its devices are deployed to.' },
    'u-stock':   { title: 'Live at a UniFi site, but in stock in inventory', hint: 'Usually a dispatch that was never recorded. Template and QA consoles are left out.' },
    'u-unknown': { title: 'At a UniFi site, never received into inventory', hint: 'Bought outside inventory, or a serial typed wrong at receipt.' },
    'u-missing': { title: 'Deployed in inventory, not found in UniFi', hint: 'Not adopted, adopted under another account, or not actually installed.' },
  };

  function renderReport() {
    const box = document.getElementById('dm-report');
    if (!box) return;
    const byCustomer = customerUnits();
    const uni = unifiView(byCustomer);
    const items = [...buildDiscrepancies(byCustomer, _ov.locations, _serialMap), ...(uni ? uni.items : [])];
    const invText = i => i.inv.state === 'unknown' ? 'Not in inventory'
      : i.inv.state === 'deployed' || i.inv.state === 'staged'
      ? `${i.inv.state === 'staged' ? 'Staged for' : 'Deployed to'} ${esc(i.inv.customer)}${i.source ? '' : i.linked ? ` (→ ${esc(i.linked.name)})` : ' (not a customer)'}`
      : `${i.inv.state === 'in-transit' ? 'In transit to' : 'In stock at'} ${esc(i.inv.location || '—')}`;

    const fixes = i => {
      const b = [];
      if (i.kind === 'wrong' && i.linked) b.push(`<button class="btn btn-primary btn-xs dm-fix" data-fix="move" data-serial="${esc(i.serial)}">Move to ${esc(i.linked.name)}</button>`);
      if ((i.kind === 'wrong' || i.kind === 'u-wrong') && i.inv.state === 'deployed' && i.owners.length === 1)
        b.push(`<button class="btn btn-ghost btn-xs dm-fix" data-fix="recustomer" data-serial="${esc(i.serial)}" data-customer="${esc(i.owners[0])}">Set inventory customer to ${esc(i.owners[0])}</button>`);
      if ((i.kind === 'stock' || i.kind === 'u-stock') && i.inv.state === 'in-stock' && i.owners.length === 1)
        b.push(`<button class="btn btn-ghost btn-xs dm-fix" data-fix="dispatch" data-serial="${esc(i.serial)}" data-customer="${esc(i.owners[0])}">Record as dispatched to ${esc(i.owners[0])}</button>`);
      else if (i.kind === 'u-stock' && i.inv.state === 'in-stock')
        b.push(`<button class="btn btn-ghost btn-xs dm-fix" data-fix="dispatch" data-serial="${esc(i.serial)}" data-customer="">Record as dispatched…</button>`);
      if (i.kind === 'wrong' || i.kind === 'stock') b.push(`<button class="btn btn-danger btn-xs dm-fix" data-fix="remove" data-serial="${esc(i.serial)}">Remove from dashboard</button>`);
      if (i.kind === 'missing' && i.inv.customer) b.push(`<button class="btn btn-ghost btn-xs dm-fix" data-fix="open" data-customer="${esc(i.inv.customer)}">Open ${esc(i.inv.customer)}</button>`);
      return b.join(' ');
    };

    const section = (kinds, cols) => Object.keys(kinds).map(k => ({ k, items: items.filter(i => i.kind === k) })).map(g => `
        <details data-kind="${g.k}" ${_openReport.has(g.k) ? 'open' : ''} style="margin-bottom:10px;">
          <summary style="cursor:pointer;font-weight:600;font-size:14px;">${esc(kinds[g.k].title)} <span class="badge ${g.items.length ? 'b-zero' : 'b-ok'}">${g.items.length}</span></summary>
          <div style="font-size:12px;color:var(--text-hint);margin:4px 0 8px;">${esc(kinds[g.k].hint)}</div>
          ${g.items.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Serial</th><th>Product</th><th>Inventory</th><th>${cols}</th><th>Fix</th></tr></thead>
            <tbody>${g.items.map(i => `
              <tr>
                <td style="font-family:var(--mono);font-size:12px;">${esc(i.serial)}</td>
                <td>${esc(i.product)}</td>
                <td>${invText(i)}</td>
                <td>${i.at ? esc(i.at.name) + (i.unifi ? ` <span class="badge ${i.unifi.status === 'online' ? 'b-ok' : 'b-zero'}">${esc(i.unifi.status)}</span>` : '') : 'Not registered'}${i.owners?.length && i.source ? `<div style="font-size:11px;color:var(--text-hint);">site → ${esc(i.owners[0])}</div>` : ''}</td>
                <td style="min-width:200px;display:flex;flex-wrap:wrap;gap:6px;">${fixes(i).replace(/class="btn /g, `data-i="${items.indexOf(i)}" class="btn `)}</td>
              </tr>`).join('')}</tbody>
          </table></div>` : ''}
        </details>`).join('');

    box.innerHTML = `
      <div class="panel-title">AIO dashboard</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">Serials inventory knows about, compared with where the production dashboard has them registered. Devices the dashboard tracks by Android id can't be matched and are left out.</p>
      ${section(REPORT_KINDS, 'Dashboard')}
      <div class="panel-title" style="margin-top:18px;">UniFi <span style="font-size:12px;color:var(--text-hint);font-weight:400;">read only</span></div>
      ${uni ? `<p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">Ubiquiti gear matched by MAC address. Fixes change inventory only — nothing is changed in UniFi.</p>${section(UNIFI_KINDS, 'UniFi site')}`
            : `<div class="empty">UniFi unavailable — ${esc(_unifi?.error || 'not loaded')}</div>`}`;

    box.querySelectorAll('details[data-kind]').forEach(d => d.addEventListener('toggle', () =>
      d.open ? _openReport.add(d.dataset.kind) : _openReport.delete(d.dataset.kind)));
    box.querySelectorAll('.dm-fix').forEach(btn => btn.addEventListener('click', () => runFix(btn.dataset, items[Number(btn.dataset.i)])));
  }

  async function runFix(ds, item) {
    try {
      if (ds.fix === 'open') { openCustomer(ds.customer); return; }
      if (ds.fix === 'recustomer') {
        const reason = prompt(`Change the inventory customer of ${item.serial} from "${item.inv.customer}" to "${ds.customer}" — where ${item.source || 'the AIO dashboard'} has it?\n\nReason (goes in the activity log):`,
          `Matches ${item.source || 'the AIO dashboard'} (Map Devices reconcile)`);
        if (!reason) return;
        Inventory.superEditSerial(item.serial, { customer: ds.customer }, reason);
        UI.showAlert(`${item.serial} now shows as deployed to ${ds.customer}`, 'success');
      }
      if (ds.fix === 'dispatch') {
        if (!ds.customer) {
          const c = (prompt(`${item.serial} is live at ${item.at.name} in ${item.source || 'the AIO dashboard'}. Record it as dispatched to which customer?`, item.at.name) || '').trim();
          if (!c) return;
          ds = { ...ds, customer: c };
        }
        if (!confirm(`Record ${item.serial} as dispatched to "${ds.customer}" in inventory? It is at ${item.at.name} in ${item.source || 'the AIO dashboard'}.`)) return;
        Inventory.stockOut({ customer: ds.customer, by: Auth.getName(), ref: 'Map Devices reconcile', serials: [item.serial] });
        UI.showAlert(`${item.serial} recorded as dispatched to ${ds.customer}`, 'success');
      }
      if (ds.fix === 'move' || ds.fix === 'remove') {
        const msg = ds.fix === 'move'
          ? `Move ${item.serial} from ${item.at.name} to ${item.linked.name} in the AIO production dashboard?\n\nIts record is deleted at ${item.at.name} and created at ${item.linked.name}. If the create fails it is put back.`
          : `Delete ${item.serial} from ${item.at.name} in the AIO production dashboard? The device will stop finding its restaurant.`;
        if (!confirm(msg)) return;
        const body = ds.fix === 'move'
          ? { action: 'move', serial: item.serial, to: { businessId: item.linked.businessId, restaurantId: item.linked.restaurantId } }
          : { action: 'remove', serial: item.serial };
        const r = await api(null, body);
        Activity.log(ds.fix === 'move' ? 'moveDevice' : 'removeDevice',
          ds.fix === 'move'
            ? `AIO dashboard: ${r.ok ? 'moved' : 'FAILED to move'} ${item.serial} from ${item.at.name} to ${item.linked.name}${r.ok ? '' : ` — ${r.message}${r.restored ? ' (put back)' : ' (NOT put back)'}`}`
            : `AIO dashboard: ${r.ok ? 'removed' : 'FAILED to remove'} ${item.serial} from ${item.at.name}${r.ok ? '' : ` — ${r.message}`}`,
          { item: { serial: item.serial, at: item.at, linked: item.linked || null }, result: r }, [item.serial]);
        if (!r.ok) {
          UI.showAlert(`${item.serial}: ${r.message}${ds.fix === 'move' ? (r.restored ? ' — it was put back where it was' : ' — and it could NOT be put back; re-add it in the dashboard') : ''}`, 'error');
        } else {
          UI.showAlert(`${item.serial} ${ds.fix === 'move' ? `moved to ${item.linked.name}` : 'removed from the dashboard'}`, 'success');
        }
        await loadOverview(true);
      }
    } catch (e) { UI.showAlert(e.message, 'error'); }
    if (_view.customer && _detail) renderDetail(_view.customer); else renderList();
  }

  // ── After a stage or dispatch: offer to go straight to the customer ───────
  function nudge(customer, serials) {
    if (typeof Auth === 'undefined' || !Auth.isAdmin()) return;
    const units = (customerUnits()[customer] || []).filter(u => (serials || []).some(s => key(s) === key(u.serial)));
    const n = units.filter(u => !isTerminal(u) && deviceTypeFor(u)).length;
    if (!n) return;
    document.getElementById('dm-nudge')?.remove();
    const el = document.createElement('div');
    el.id = 'dm-nudge';
    el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:900;background:var(--bg);border:1px solid var(--aio-purple);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:12px 14px;max-width:340px;font-size:13px;';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div><strong>${n} device${n !== 1 ? 's' : ''}</strong> for ${esc(customer)} can be mapped in the AIO dashboard.</div>
        <button class="btn-remove-row" id="dm-nudge-x" title="Dismiss">×</button>
      </div>
      <button class="btn btn-primary btn-xs" id="dm-nudge-go" style="margin-top:8px;">Map devices →</button>`;
    document.body.appendChild(el);
    el.querySelector('#dm-nudge-x').addEventListener('click', () => el.remove());
    el.querySelector('#dm-nudge-go').addEventListener('click', () => { el.remove(); open(customer); });
  }

  function open(customer) {
    _pendingOpen = customer || null;
    _detail = null;
    document.querySelector('[data-view="map-devices"]')?.click();
  }

  function refresh() {
    if (_loading) return;
    _ov = null;
    _unifi = null;
    _detail = null;
    render();
  }

  return { render, refresh, open, nudge,
           // exposed for tests
           _rules: { key, terminalSerial, isTerminal, deviceTypeFor, initials, customerUnits, suggestLocation, buildPlan, buildDiscrepancies, buildUnifi, unifiForCustomer } };
})();
