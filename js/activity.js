/**
 * activity.js — AIO Inventory · permanent activity log
 *
 * Every write the app makes goes through a DB.* method, so this module wraps
 * those methods and records each call — stamped with the signed-in account —
 * as a doc in the Firestore `activityLog` collection. firestore.rules make that
 * collection append-only: nobody can edit or delete an entry from the app, and
 * the uid/email on an entry must be the account that wrote it.
 *
 * One click often fans out into many DB calls (receiving a shipment sets a cost
 * and a PO on every serial), so calls made within FLUSH_MS of each other are
 * written as ONE entry with several operations.
 *
 * Entries are queued in localStorage until Firestore confirms them, so a flaky
 * connection or a closed tab doesn't lose them — they are retried next load.
 */

const Activity = (() => {
  const FS_URL   = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
  const COLL     = 'activityLog';
  const FLUSH_MS = 400;
  const QUEUE_KEY = 'aio_activity_q';
  const MAX_DETAIL = 200000;  // chars — keeps an entry far below Firestore's 1MB doc limit
  const MAX_SERIALS = 2000;

  let _ops = [];
  let _timer = null;

  // ── Describing an operation ─────────────────────────────────────────────
  const n = a => (a || []).length;
  const data = () => DB.getData();
  const find = (field, id) => (data()[field] || []).find(r => String(r.id) === String(id)) || null;
  const label = r => !r ? '(unknown)' : (r.poNumber || r.ref || r.name || r.scope || r.product || r.customer || r.supplier || r.id);
  const short = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s == null ? '' : (s.length > 300 ? s.slice(0, 300) + '…' : s); };

  function mvText(mv) {
    const q = `${n(mv.serials)}× ${mv.product}`;
    if (mv.isTransfer) return mv.type === 'IN'
      ? `Transfer ${mv.cancelled ? 'cancelled, returned' : 'received'}: ${q} at ${mv.location}`
      : `Transfer dispatched: ${q} from ${mv.location}`;
    if (mv.type === 'IN') return `Stock in: ${q} at ${mv.location || '—'}${mv.poNumber ? ` (PO ${mv.poNumber})` : ''}`;
    if (mv.isRmaTl) return `${mv.rmaTlType || 'RMA/TL'}: ${q}`;
    return `Stock out: ${q}${mv.customer ? ` → ${mv.customer}` : ''}`;
  }

  // "before → after" for each field an update touches
  function update(what, field, id, u) {
    const before = find(field, id) || {};
    const changes = {};
    Object.keys(u || {}).forEach(k => { changes[k] = [short(before[k]), short(u[k])]; });
    const parts = Object.entries(changes).map(([k, [a, b]]) =>
      a.length <= 40 && b.length <= 40 ? `${k}: ${a || '—'} → ${b || '—'}` : k);
    return { text: `${what} updated: ${label(before)} (${parts.join(', ')})`, detail: { id, changes } };
  }
  function remove(what, field, id) {
    const rec = find(field, id);
    return { text: `${what} deleted: ${label(rec)}`, detail: { id, record: rec }, serials: rec?.serials };
  }

  // Each returns { text, detail?, serials?, group? }. `group` merges repeat
  // calls in one entry into a single line (see _merge).
  const OPS = {
    addMovement:   mv  => ({ text: mvText(mv), detail: mv, serials: mv.serials }),
    addMovements:  mvs => ({ text: (mvs || []).map(mvText).join('; '), detail: mvs, serials: (mvs || []).flatMap(m => m.serials || []) }),
    setThreshold:  (k, v) => ({ text: `Low-stock threshold for ${k} set to ${v}` }),
    addShipment:   s => ({ text: `Shipment created: ${label(s)}`, detail: s, serials: (s.products || []).flatMap(p => p.serials || []) }),
    updateShipment:(id, u) => update('Shipment', 'shipments', id, u),
    removeShipment: id => remove('Shipment', 'shipments', id),
    addTransfer:   t => ({ text: `Transfer created: ${t.from} → ${t.to}`, detail: t }),
    updateTransfer:(id, u) => update('Transfer', 'transfers', id, u),
    setSerialCost: (s, c) => ({ group: 'cost:' + c, one: s, text: `Unit cost set to ${c}` }),
    setSerialPO:   (s, po) => ({ group: 'po:' + po, one: s, text: `PO ${po} assigned` }),
    setProductCost:(name, cost) => ({ text: `Cost of ${name} set to ${cost}` }),
    setHubspotCompanyId: (c, id) => ({ text: `HubSpot company for ${c} set to ${id || '(none)'}` }),
    setHubspotIgnored:   (c, ig) => ({ text: `${c} ${ig ? 'marked' : 'unmarked'} as "Not a customer"` }),
    setDeviceLocation:   (c, loc) => ({ text: loc ? `AIO dashboard restaurant for ${c} set to ${loc.name} (tenant ${loc.businessId}, location ${loc.restaurantId})` : `AIO dashboard restaurant for ${c} cleared` }),
    deleteSerial:  s  => ({ text: `Serial deleted: ${s}`, serials: [s] }),
    deleteSerials: ss => ({ text: `${n(ss)} serial(s) deleted`, serials: ss }),
    renameSerial:  (a, b) => ({ text: `Serial renamed: ${a} → ${b}`, serials: [a, b] }),
    renameLocation:(a, b) => ({ text: `Location renamed: ${a} → ${b}` }),
    // Super admin rewrite of a unit: every field before → after, the reason, and
    // the unit's movements as they were (batch serial lists dropped for size) so
    // the edit can be reconstructed or undone by hand
    editSerialProperties: (s, ch, reason) => {
      const before = Inventory.getEditableProperties(s) || {};
      const show = v => v == null || v === '' ? '—' : String(v);
      const changes = {};
      Object.keys(ch).filter(k => k !== 'category').forEach(k => { changes[k] = [before[k] ?? null, ch[k] ?? null]; });
      const parts = Object.entries(changes).map(([k, [a, b]]) => `${k}: ${short(show(a))} → ${short(show(b))}`);
      const movementsBefore = Inventory.getSerialInfo(s).history.map(({ serials, ...m }) => ({ ...m, batchSize: n(serials) }));
      return {
        text: `SUPER ADMIN edit of ${s} — ${parts.join('; ')} — reason: ${reason}`,
        detail: { serial: s, reason, changes, before, movementsBefore },
        serials: [s, ch.serial].filter(Boolean),
      };
    },
    updateSerialCondition: (s, cond, testedBy, testedDate, notes) =>
      ({ text: `Condition of ${s} set to ${cond || '(cleared)'}`, detail: { testedBy, testedDate, notes }, serials: [s] }),
    savePO:        (po, d) => ({ text: `Purchase order saved: ${po}`, detail: d }),
    addCustomSupplier: name => ({ text: `Supplier added to list: ${name}` }),
    addCustomLocation: name => ({ text: `Location added to list: ${name}` }),
    addOrder:      o => ({ text: `Purchase order created: ${label(o)}`, detail: o }),
    updateOrder:   (id, u) => update('Purchase order', 'orders', id, u),
    removeOrder:   id => remove('Purchase order', 'orders', id),
    addSupplier:   s => ({ text: `Supplier created: ${label(s)}`, detail: s }),
    updateSupplier:(id, u) => update('Supplier', 'suppliers', id, u),
    removeSupplier: id => remove('Supplier', 'suppliers', id),
    addProductRecord:    r => ({ text: `Product created: ${label(r)}`, detail: r }),
    updateProductRecord: (id, u) => update('Product', 'productRecords', id, u),
    removeProductRecord: id => remove('Product', 'productRecords', id),
    addAuditRecord:  r => ({ text: `Stock audit saved: ${r.scope}`, detail: { id: r.id, scope: r.scope, expected: r.expected, matched: r.matched, missing: r.missing, unexpected: r.unexpected } }),
    saveAuditRecord: r => ({ text: `Stock audit updated: ${r.scope}${r.locked ? ' (locked)' : ''}`, detail: { id: r.id, scope: r.scope, matched: r.matched, missing: r.missing, lost: r.lost, locked: !!r.locked } }),
    deleteAuditRecord: id => remove('Stock audit', 'auditRecords', id),
    splitStorage:  () => ({ text: 'Storage split into separate documents' }),
    setPendingUser:    (email, name, role) => ({ text: `Access pre-assigned: ${email} as ${role}` }),
    removePendingUser: email => ({ text: `Pre-assigned access removed: ${email}` }),
    addPendingDeployment:    pd => ({ text: `Deployment staged: ${n(pd.serials)}× ${pd.product} → ${pd.customer}`, detail: pd, serials: pd.serials }),
    removePendingDeployment: id => remove('Staged deployment', 'pendingDeployments', id),
    updatePendingDeployment: (id, u) => update('Staged deployment', 'pendingDeployments', id, u),
    importJSON:    () => ({ text: 'ENTIRE DATASET REPLACED from a JSON backup' }),
    addDocumentToShipment:      (id, m) => ({ text: `Document attached to shipment ${label(find('shipments', id))}: ${m?.name}` }),
    removeDocumentFromShipment: (id, path) => ({ text: `Document removed from shipment ${label(find('shipments', id))}: ${String(path).split('/').pop()}` }),
    addDocumentToOrder:         (id, m) => ({ text: `Document attached to order ${label(find('orders', id))}: ${m?.name}` }),
  };

  // ── Wrap DB ─────────────────────────────────────────────────────────────
  // Describe BEFORE calling through, so updates/deletes can still see the old record.
  Object.keys(OPS).forEach(name => {
    const orig = DB[name];
    if (typeof orig !== 'function') return;
    DB[name] = function(...args) {
      let op = null;
      try { op = { action: name, ...OPS[name](...args) }; } catch(e) { op = { action: name, text: name }; }
      const result = orig.apply(this, args);
      _queue(op);
      return result;
    };
  });

  // ── User management (auth.js) ───────────────────────────────────────────
  async function _userDoc(uid) {
    try {
      const { getFirestore, doc, getDoc } = await import(FS_URL);
      const s = await getDoc(doc(getFirestore(), 'users', uid));
      return s.exists() ? s.data() : {};
    } catch(_) { return {}; }
  }
  const who = u => `${u.name || '?'} (${u.email || '?'})`;
  const _updateRole = UserManager.updateUserRole, _deleteUser = UserManager.deleteUser, _reactivate = UserManager.reactivateUser;
  UserManager.updateUserRole = async (uid, role) => {
    const u = await _userDoc(uid);
    await _updateRole(uid, role);
    _queue({ action: 'updateUserRole', text: `Role of ${who(u)} changed: ${u.role || '?'} → ${role}`, detail: { uid } });
  };
  UserManager.deleteUser = async uid => {
    const u = await _userDoc(uid);
    await _deleteUser(uid);
    _queue({ action: 'deleteUser', text: `User access removed: ${who(u)}`, detail: { uid } });
  };
  UserManager.reactivateUser = async (uid, name, role) => {
    const u = await _userDoc(uid);
    await _reactivate(uid, name, role);
    _queue({ action: 'reactivateUser', text: `User reactivated: ${who(u)} as ${role}`, detail: { uid } });
  };

  // Sign in / out — once per browser session, so a reload isn't a "sign in"
  Auth.onReady(ok => {
    if (!ok) return;
    _replay();
    const key = 'aio_act_signin_' + Auth.getUser().uid;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch(_) {}
    _queue({ action: 'signIn', text: 'Signed in' });
  });
  const _signOut = Auth.signOut;
  Auth.signOut = async (...args) => {
    _queue({ action: 'signOut', text: 'Signed out' });
    try { await _flush(); } catch(_) {}
    return _signOut(...args);
  };

  // ── Queue → entry → Firestore ───────────────────────────────────────────
  function _queue(op) {
    _ops.push(op);
    if (!_timer) _timer = setTimeout(_flush, FLUSH_MS);
  }

  // Collapse `group`ed ops (e.g. 40× "unit cost set to 120") into one line
  function _merge(ops) {
    const out = [], groups = {};
    ops.forEach(op => {
      if (!op.group) { out.push(op); return; }
      const g = groups[op.group];
      if (g) { g.serials.push(op.one); return; }
      out.push(groups[op.group] = { action: op.action, baseText: op.text, serials: [op.one] });
    });
    Object.values(groups).forEach(g => { g.text = `${g.baseText} on ${g.serials.length} serial(s)`; });
    return out;
  }

  async function _flush() {
    clearTimeout(_timer); _timer = null;
    if (!_ops.length) return;
    const user = Auth.getUser();
    if (!user) { _ops = []; return; }  // not signed in — rules would reject it anyway
    const ops = _merge(_ops); _ops = [];

    const serials = [...new Set(ops.flatMap(o => o.serials || []).filter(Boolean).map(s => String(s).toUpperCase()))];
    let detail = JSON.stringify(ops.map(o => ({ action: o.action, text: o.text, detail: o.detail ?? null })));
    if (detail.length > MAX_DETAIL) detail = detail.slice(0, MAX_DETAIL) + '…[truncated]';

    const entry = {
      id:       Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      clientAt: new Date().toISOString(),
      uid:      user.uid,
      email:    user.email || '',
      name:     Auth.getName(),
      role:     Auth.getProfile()?.role || '',
      summary:  ops.map(o => o.text).join(' · ').slice(0, 1000),
      actions:  [...new Set(ops.map(o => o.action))],
      serials:  serials.slice(0, MAX_SERIALS),
      detail,
    };
    const q = _readQ(); q.push(entry); _writeQ(q);
    await _send(entry);
  }

  const _inFlight = new Set();
  async function _send(entry, isRetry) {
    if (_inFlight.has(entry.id)) return;
    _inFlight.add(entry.id);
    const done = () => _writeQ(_readQ().filter(e => e.id !== entry.id));
    try {
      const { getFirestore, doc, setDoc, serverTimestamp } = await import(FS_URL);
      const { id, ...fields } = entry;
      // Doc id = entry id, so a retry after an unconfirmed write can't duplicate it
      await setDoc(doc(getFirestore(), COLL, id), { ...fields, at: serverTimestamp() });
      done();
    } catch(e) {
      // The rules refuse overwriting an entry, so when retrying our own entry a
      // denial means an earlier, unconfirmed attempt already landed
      if (isRetry && e.code === 'permission-denied') done();
      else console.warn('[Activity] log write failed — will retry on next load:', e);
    } finally {
      _inFlight.delete(entry.id);
    }
  }

  // Only replay this user's entries — the rules won't accept anyone else's
  function _replay() {
    const uid = Auth.getUser()?.uid;
    _readQ().filter(e => e.uid === uid).forEach(e => _send(e, true));
  }
  function _readQ()  { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(_) { return []; } }
  function _writeQ(q){ try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch(_) {} }

  window.addEventListener('pagehide', () => { if (_ops.length) _flush(); });

  // ── Viewer (admin only; the rules refuse reads from anyone else) ─────────
  const PAGE = 200;
  let _rows = [], _lastDoc = null, _done = false, _wired = false;

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  const el = id => document.getElementById(id);
  const when = r => r.at?.toDate ? r.at.toDate() : new Date(r.clientAt);

  async function _load(reset) {
    if (reset) { _rows = []; _lastDoc = null; _done = false; }
    if (_done) return;
    el('act-summary').textContent = 'Loading…';
    try {
      const { getFirestore, collection, query, orderBy, where, limit, startAfter, getDocs, Timestamp } = await import(FS_URL);
      const cons = [orderBy('at', 'desc')];
      const from = el('act-date-from').value, to = el('act-date-to').value;
      if (from) cons.push(where('at', '>=', Timestamp.fromDate(new Date(from + 'T00:00:00'))));
      if (to)   cons.push(where('at', '<=', Timestamp.fromDate(new Date(to + 'T23:59:59.999'))));
      if (_lastDoc) cons.push(startAfter(_lastDoc));
      cons.push(limit(PAGE));
      const snap = await getDocs(query(collection(getFirestore(), COLL), ...cons));
      snap.docs.forEach(d => _rows.push({ id: d.id, ...d.data() }));
      _lastDoc = snap.docs[snap.docs.length - 1] || _lastDoc;
      if (snap.docs.length < PAGE) _done = true;
    } catch(e) {
      el('act-summary').textContent = 'Could not load the activity log: ' + (e.message || e);
      return;
    }
    _renderRows();
  }

  function _filtered() {
    const user = el('act-user').value;
    const q = el('act-search').value.trim().toLowerCase();
    return _rows.filter(r => (!user || r.email === user) &&
      (!q || [r.summary, r.name, r.email, (r.serials || []).join(' ')].join(' ').toLowerCase().includes(q)));
  }

  function _renderRows() {
    const sel = el('act-user'), cur = sel.value;
    const users = [...new Map(_rows.map(r => [r.email, r.name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    sel.innerHTML = '<option value="">All users</option>' + users.map(([e, nm]) => `<option value="${esc(e)}">${esc(nm || e)}</option>`).join('');
    sel.value = cur;

    const rows = _filtered();
    el('act-summary').textContent = `${rows.length} of ${_rows.length} loaded entr${_rows.length === 1 ? 'y' : 'ies'}${_done ? '' : ' — more available'}`;
    el('act-more').style.display = _done ? 'none' : '';
    el('act-body').innerHTML = rows.length ? rows.map(r => {
      let ops = [];
      try { ops = JSON.parse(r.detail || '[]'); } catch(_) {}
      const more = ops.some(o => o.detail) || (r.serials || []).length;
      return `<tr>
        <td>${esc(when(r).toLocaleString())}</td>
        <td><strong>${esc(r.name)}</strong>${r.role === 'superadmin' ? ' <span class="badge b-condition b-cond-faulty">SUPER ADMIN</span>' : ''}<div class="serial-mono">${esc(r.email)}</div></td>
        <td>${ops.length ? ops.map(o => `<div>${esc(o.text)}</div>`).join('') : esc(r.summary)}
          ${more ? `<details style="margin-top:6px;"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted);">Details</summary>
            ${(r.serials || []).length ? `<div class="serial-mono" style="margin:6px 0;">${esc(r.serials.join(', '))}</div>` : ''}
            <pre style="white-space:pre-wrap;font-size:11px;max-height:320px;overflow:auto;background:var(--bg-2);padding:8px;border-radius:6px;">${esc(JSON.stringify(ops.map(o => o.detail).filter(Boolean), null, 2))}</pre>
          </details>` : ''}
        </td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty">No activity matches.</td></tr>';
  }

  function _export() {
    const rows = _filtered().map(r => ({
      When: when(r).toLocaleString(), Name: r.name, Email: r.email, Role: r.role,
      Action: r.summary, Serials: (r.serials || []).join(', '),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activity');
    XLSX.writeFile(wb, `activity-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function render() {
    if (!_wired) {
      _wired = true;
      el('act-search').addEventListener('input', _renderRows);
      el('act-user').addEventListener('change', _renderRows);
      el('act-date-from').addEventListener('change', () => _load(true));
      el('act-date-to').addEventListener('change', () => _load(true));
      el('act-more').addEventListener('click', () => _load(false));
      el('act-refresh').addEventListener('click', () => _load(true));
      el('act-export').addEventListener('click', _export);
    }
    _load(true);
  }

  // For writes that don't go through DB — e.g. Map Devices changing the AIO
  // production dashboard through a Cloud Function
  function log(action, text, detail, serials) { _queue({ action, text, detail, serials }); }

  return { render, log };
})();
