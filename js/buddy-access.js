/* ─────────────────────────────────────────────────────────────────────────────
   BuddyAccess — a super admin adds restaurants to an AIO Buddy account.

   Pick a buddy by searching their name or email, then the picker lists every
   restaurant on the AIO dashboard that account can't see yet; ticking some and
   confirming adds them. It only ever adds — nothing the account already has is
   removed — and it only edits existing buddy accounts. The aioBuddyAccess Cloud
   Function enforces the super admin rule, checks the buddy against the dashboard's
   own list, and holds the dashboard login.
   ───────────────────────────────────────────────────────────────────────────── */
const BuddyAccess = (() => {
  const ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/aioBuddyAccess';
  const MAX_SHOWN = 200;

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  let _buddies = null;        // [{ id, email, name }] — every buddy account
  let _buddy = null;          // the chosen buddy's { id, name, email }
  let _state = null;          // { buddy, granted, locations } for _buddy
  let _buddyQuery = '';
  let _picked = new Set();    // restaurant ids ticked
  let _filter = '';
  let _busy = false;

  const root = () => document.getElementById('ba-root');

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
    const res = await fetch(url, opts).catch(() => {
      throw new Error('the aioBuddyAccess Cloud Function did not respond — check it is deployed and that this site\'s address is in its allowed origins');
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `AIO dashboard request failed (${res.status})`);
    return json;
  }

  // ── Step 1: choose the buddy ──────────────────────────────────────────────
  function buddyMatches() {
    const q = _buddyQuery.trim().toLowerCase();
    if (!q) return [];
    return _buddies.filter(b => `${b.name} ${b.email}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
  }

  function drawBuddyPicker() {
    const el = root();
    const hits = buddyMatches();
    el.innerHTML = `
      <p style="font-size:13px;margin:0 0 10px;">Which AIO Buddy account should get access to more restaurants? Search by name or email.</p>
      <input class="fi" id="ba-buddy-search" placeholder="Name or email…" value="${esc(_buddyQuery)}" style="width:100%;max-width:420px;" autocomplete="off" />
      <div style="margin-top:8px;max-width:420px;">
        ${hits.map(b => `<button class="btn btn-ghost btn-sm" data-buddy="${esc(b.id)}" style="display:block;width:100%;text-align:left;margin-bottom:4px;">
          <b>${esc(b.name)}</b> <span style="color:var(--text-muted);">· ${esc(b.email)}</span></button>`).join('')}
        ${_buddyQuery.trim() && !hits.length ? '<div class="empty">No buddy account matches.</div>' : ''}
      </div>`;
    const input = el.querySelector('#ba-buddy-search');
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', () => { _buddyQuery = input.value; drawBuddyPicker(); });
    el.querySelectorAll('[data-buddy]').forEach(btn => btn.addEventListener('click', () => {
      _buddy = _buddies.find(b => b.id === btn.dataset.buddy);
      _state = null; _picked = new Set(); _filter = '';
      load();
    }));
  }

  // ── Step 2: pick restaurants for that buddy ───────────────────────────────
  // Restaurants the buddy can't see yet, matching the search box
  function available() {
    const have = new Set(_state.granted);
    const q = _filter.trim().toLowerCase();
    return _state.locations
      .filter(l => !have.has(l.restaurantId))
      .filter(l => !q || `${l.name} ${l.businessName} ${l.address}`.toLowerCase().includes(q))
      .sort((a, b) => a.businessName.localeCompare(b.businessName) || a.name.localeCompare(b.name));
  }

  const firstName = () => _state.buddy.name.split(' ')[0] || 'this account';

  function draw() {
    const el = root();
    const rows = available();
    const shown = rows.slice(0, MAX_SHOWN);
    el.innerHTML = `
      <p style="font-size:13px;margin:0 0 12px;"><b>${esc(_state.buddy.name)}</b> (${esc(_state.buddy.email)}) can see
        <b>${_state.granted.length}</b> restaurants.
        <button class="btn btn-ghost btn-xs" id="ba-change">Change account</button><br />
        Tick the restaurants to add. Existing access is never removed.</p>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <input class="fi" id="ba-search" placeholder="Search restaurant, business or address…" value="${esc(_filter)}" style="flex:1;" autocomplete="off" />
        <button class="btn btn-primary btn-sm" id="ba-grant" ${_picked.size && !_busy ? '' : 'disabled'}>${_busy ? 'Adding…' : `Add ${_picked.size || ''} to ${esc(firstName())}`}</button>
      </div>
      ${rows.length ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">${rows.length} not yet added${rows.length > shown.length ? ` — showing the first ${shown.length}, search to narrow` : ''}</div>
        <div style="max-height:60vh;overflow:auto;">
          ${shown.map(l => `<label style="display:flex;gap:10px;padding:6px 4px;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" data-id="${l.restaurantId}" ${_picked.has(l.restaurantId) ? 'checked' : ''} />
            <span><b>${esc(l.name)}</b> <span style="color:var(--text-muted);">· ${esc(l.businessName)}${l.address ? ' · ' + esc(l.address) : ''}</span></span>
          </label>`).join('')}
        </div>` : `<div class="empty">${_filter ? 'No matches.' : 'Nothing left to add — this account already sees every restaurant.'}</div>`}`;

    el.querySelector('#ba-change').addEventListener('click', () => { _buddy = null; _state = null; _picked = new Set(); drawBuddyPicker(); });
    const search = el.querySelector('#ba-search');
    search.addEventListener('input', () => {
      _filter = search.value;
      draw();
      const again = root().querySelector('#ba-search');
      again.focus(); again.setSelectionRange(again.value.length, again.value.length);
    });
    el.querySelectorAll('input[data-id]').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      cb.checked ? _picked.add(id) : _picked.delete(id);
      el.querySelector('#ba-grant').disabled = !_picked.size;
      el.querySelector('#ba-grant').textContent = `Add ${_picked.size || ''} to ${firstName()}`;
    }));
    el.querySelector('#ba-grant').addEventListener('click', grant);
  }

  async function grant() {
    if (!_picked.size || _busy) return;
    const names = _state.locations.filter(l => _picked.has(l.restaurantId)).map(l => l.name);
    if (!confirm(`Give ${_state.buddy.name} (${_state.buddy.email}) access to ${names.length} restaurant${names.length > 1 ? 's' : ''}?\n\n` +
        names.slice(0, 15).join('\n') + (names.length > 15 ? `\n…and ${names.length - 15} more` : ''))) return;
    _busy = true; draw();
    try {
      const r = await api({}, { action: 'grant', buddyId: _buddy.id, restaurantIds: [..._picked] });
      UI.showAlert(`Added ${r.added.length} restaurant${r.added.length === 1 ? '' : 's'} to ${_state.buddy.name}`, 'success');
      _picked = new Set();
    } catch (e) {
      UI.showAlert(e.message, 'error');
    }
    _busy = false;
    await load();
  }

  // Loads the chosen buddy's record and the restaurant list, or the buddy list when none is chosen
  async function load() {
    const el = root();
    if (!el) return;
    try {
      if (!_buddies) {
        el.innerHTML = `<div class="empty">Loading from the AIO dashboard…</div>`;
        _buddies = (await api({ action: 'buddies' })).buddies;
      }
      if (!_buddy) return drawBuddyPicker();
      if (!_state) el.innerHTML = `<div class="empty">Loading ${esc(_buddy.name)}…</div>`;
      const wanted = _buddy.id;
      const state = await api({ action: 'state', buddyId: wanted });
      if (!_buddy || _buddy.id !== wanted) return;   // they switched accounts while this loaded
      _state = state;
      draw();
    } catch (e) {
      el.innerHTML = `<div class="empty">Couldn't reach the AIO dashboard — ${esc(e.message)}</div>`;
    }
  }

  function refresh() { _buddies = null; _state = null; return load(); }

  return { render: load, refresh };
})();
