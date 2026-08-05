/**
 * db.js — AIO Inventory · Firebase Firestore backend
 */
const DB_CONFIG = {
  apiKey:            "AIzaSyCwlZg9YaGfQDKuVBDI4RAkEzKcDg7Cgdo",
  authDomain:        "aio-inventory-b9b29.firebaseapp.com",
  projectId:         "aio-inventory-b9b29",
  storageBucket:     "aio-inventory-b9b29.firebasestorage.app",
  messagingSenderId: "146229036238",
  appId:             "1:146229036238:web:c91467e73e3e2912683c9f"
};

const DB = (() => {
  let _pendingWrite = false;
  let _data  = { movements: [], thresholds: {}, shipments: [], serialCosts: {}, serialConditions: {}, customSuppliers: [], customLocations: [], orders: [], suppliers: [], productRecords: [], auditRecords: [], pendingUsers: {}, pendingDeployments: [], pausedAudits: {}, hubspotCompanyMap: {} };
  // Split storage — the escape hatch from the 1MB per-document limit.
  // When main doc has `auditsSplit: true`, audit records live in the `audits`
  // collection (one doc per count). When it has `movementsSplit: true`, the
  // movements ledger lives in inventory/movements. _data stays the in-memory
  // home for both either way, so readers don't care.
  let _auditsSplit = false;
  let _auditsUnsub = null;
  let _movementsSplit = false;
  let _movementsUnsub = null;

  function _assignData(d) {
    _auditsSplit    = !!d.auditsSplit;
    _movementsSplit = !!d.movementsSplit;
    _data = { movements: _movementsSplit ? (_data.movements||[]) : (d.movements||[]), thresholds: d.thresholds||{}, shipments: d.shipments||[], serialCosts: d.serialCosts||{}, serialConditions: d.serialConditions||{}, purchaseOrders: d.purchaseOrders||{}, serialPOs: d.serialPOs||{}, customSuppliers: d.customSuppliers||[], customLocations: d.customLocations||[], orders: d.orders||[], suppliers: d.suppliers||[], productRecords: d.productRecords||[], auditRecords: _auditsSplit ? (_data.auditRecords||[]) : (d.auditRecords||[]), pendingUsers: d.pendingUsers||{}, pendingDeployments: d.pendingDeployments||[], pausedAudits: d.pausedAudits||{}, hubspotCompanyMap: d.hubspotCompanyMap||{} };
  }

  // Movements are identified by id; very old records without one fall back to
  // their JSON shape (mirrors arrayUnion's identical-object dedupe semantics).
  function _mvKey(r) { return r && r.id != null ? 'i' + r.id : 'j' + JSON.stringify(r); }
  let _db    = null;
  let _ready = false;
  let _onReadyCallbacks = [];

  async function init() {
    try {
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, doc, getDoc, setDoc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const app = getApps().length ? getApps()[0] : initializeApp(DB_CONFIG);
      _db = getFirestore(app);

      const docRef = doc(_db, 'inventory', 'main');
      const snap   = await getDoc(docRef);
      if (snap.exists()) {
        _assignData(snap.data());
      } else {
        await setDoc(docRef, _data);
      }
      const d0 = snap.exists() ? snap.data() : {};
      if (_auditsSplit) {
        await _initAuditsSplit();
        if (Array.isArray(d0.auditRecords) && d0.auditRecords.length) _sweepLegacyAudits(d0.auditRecords);
      }
      if (_movementsSplit) {
        await _initMovementsSplit();
        if (Array.isArray(d0.movements) && d0.movements.length) _sweepLegacyMovements(d0.movements);
      }

      // Real-time listener — keeps all users in sync
      onSnapshot(docRef, snap => {
        if (!snap.exists()) return;
        if (_pendingWrite) return;
        const d = snap.data();
        const wasAuditsSplit = _auditsSplit, wasMovementsSplit = _movementsSplit;
        _assignData(d);
        // An admin ran the split while this tab was open
        if (_auditsSplit && !wasAuditsSplit) _initAuditsSplit();
        if (_movementsSplit && !wasMovementsSplit) _initMovementsSplit();
        // An old-cache client wrote split-out data back into main — absorb & remove it
        if (_auditsSplit && Array.isArray(d.auditRecords) && d.auditRecords.length) _sweepLegacyAudits(d.auditRecords);
        if (_movementsSplit && Array.isArray(d.movements) && d.movements.length) _sweepLegacyMovements(d.movements);
        if (typeof _currentView !== 'undefined') _refreshView();
      });

      _ready = true;
      _onReadyCallbacks.forEach(fn => fn());
      // Surface the size warning on load (not just on save) so the admin sees the split button
      if (typeof Auth !== 'undefined' && Auth.onReady) Auth.onReady(() => { const n = _mainSize(); if (n > 850000) _sizeBanner(n); });
      _walReplay(); // re-attempt any appends that never got server-confirmed last session
    } catch(err) {
      console.error('DB init error:', err);
      _loadLS();
      _ready = true;
      _onReadyCallbacks.forEach(fn => fn());
    }
  }

  function _loadLS() {
    try { const r = localStorage.getItem('aio_inventory_v2'); if (r) { const d=JSON.parse(r); _data={movements:[],thresholds:{},shipments:[],serialCosts:{},...d}; } } catch(e) {}
  }

  const FS_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

  // Fields written by the generic _save(). `movements` and `pendingDeployments`
  // are deliberately EXCLUDED: they have their own append-safe write paths
  // (arrayUnion) so that concurrent users can never overwrite each other's
  // additions. Ops that legitimately rewrite those arrays (delete/rename serial,
  // confirm/unstage pending) pass them explicitly via _persist().
  const SAVE_FIELDS = ['thresholds','shipments','serialCosts','serialConditions','purchaseOrders','serialPOs','customSuppliers','customLocations','orders','suppliers','productRecords','auditRecords','pendingUsers','pausedAudits','hubspotCompanyMap'];

  // A write that HANGS (no network / blocked webchannel) never rejects — the
  // Firestore SDK just queues it in memory. Without a timeout that is invisible:
  // no error, no banner, and the queued write dies with the tab. Race it.
  function _withTimeout(p, ms = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const err = new Error('save timed out — no connection to the server');
        err._timeout = true;
        reject(err);
      }, ms);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function _writeOk() {
    _clearSaveBanner();
    try { localStorage.removeItem('aio_inventory_v2'); } catch(_) {}
  }
  function _writeFail(e, retriable) {
    try { localStorage.setItem('aio_inventory_v2', JSON.stringify(_data)); } catch(_) {}
    console.error('DB save FAILED or timed out — change not confirmed on server:', e);
    if (retriable) {
      _saveBanner('⚠️ <b>YOUR LAST CHANGE HAS NOT SAVED YET</b> — no connection to the server. It is stored safely on this device and will keep retrying, even after a refresh, until it saves. Check your internet; if this banner does not clear in a few minutes, tell the admin. <span style="opacity:.75">(' + _esc(e && (e.message || e.code) || 'unknown error') + ')</span>');
    } else {
      _saveBanner('⚠️ <b>YOUR LAST CHANGE HAS NOT SAVED.</b> It is stored only on this device. Do NOT close or refresh this tab — check your internet connection, and if this banner does not clear in a minute, take a screenshot and tell the admin. <span style="opacity:.75">(' + _esc(e && (e.message || e.code) || 'unknown error') + ')</span>');
    }
  }
  function _noDbFail() {
    try { localStorage.setItem('aio_inventory_v2', JSON.stringify(_data)); } catch(_) {}
    _saveBanner('⚠️ <b>NOT CONNECTED TO THE SERVER.</b> Your changes are saved only on this device and are NOT syncing to the team. Refresh the page; if this keeps happening, tell the admin.');
  }

  // Run a Firestore write with timeout + loud failure. If a timed-out write
  // eventually lands (connection came back while the tab stayed open), clear
  // the banner so the user knows they are safe again. onOk runs exactly once
  // when the write is confirmed on the server (used to clear WAL entries).
  async function _guardedWrite(makeWrite, onOk, retriable) {
    const ok = () => { _writeOk(); if (onOk) { onOk(); onOk = null; } };
    try {
      const w = makeWrite();
      try {
        await _withTimeout(w);
        ok();
      } catch(e) {
        _writeFail(e, retriable);
        if (e && e._timeout) w.then(ok, (e2) => _writeFail(e2, retriable));
      }
    } catch(e) { _writeFail(e, retriable); }
    finally { setTimeout(() => { _pendingWrite = false; }, 1000); }
  }

  // ── Write-ahead log for appends ──────────────────────────────────────
  // New movements / pending deployments are journalled to localStorage BEFORE
  // the server write is attempted and cleared only on server ack. If a write
  // hangs (dead connection) and the user refreshes or closes the tab, the
  // records are REPLAYED on next load instead of dying with the tab.
  // Replay is safe: arrayUnion cannot insert a duplicate of an identical record.
  const WAL_KEY = 'aio_wal_v1';
  function _walRead() {
    try { return JSON.parse(localStorage.getItem(WAL_KEY)) || []; } catch(_) { return []; }
  }
  function _walWrite(q) {
    try { localStorage.setItem(WAL_KEY, JSON.stringify(q.slice(-300))); } catch(_) {}
  }
  function _walAdd(field, items) {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const q = _walRead();
    q.push({ id, field, items, ts: Date.now() });
    _walWrite(q);
    return id;
  }
  function _walRemove(id) { _walWrite(_walRead().filter(e => e.id !== id)); }
  function _walReplay() {
    const q = _walRead();
    if (!q.length) return;
    console.warn('[DB] replaying', q.length, 'unsaved change(s) from a previous session');
    q.forEach(entry => {
      if (!entry || !entry.field || !Array.isArray(entry.items) || !entry.items.length) { _walRemove(entry && entry.id); return; }
      // Drop stale junk (>14 days) rather than resurrecting ancient state
      if (Date.now() - (entry.ts || 0) > 14 * 24 * 3600 * 1000) { _walRemove(entry.id); return; }
      const arr = _data[entry.field];
      if (!Array.isArray(arr)) { _walRemove(entry.id); return; }
      // Add locally only if not already present (by record id)
      const have = new Set(arr.map(x => x && x.id));
      const missing = entry.items.filter(x => x && !have.has(x.id));
      arr.push(...missing);
      // Re-attempt the server append (arrayUnion dedupes if it already landed);
      // WAL entry is cleared only when the server confirms.
      _appendArray(entry.field, entry.items, entry.id);
    });
    if (typeof _currentView !== 'undefined') { try { _refreshView(); } catch(_) {} }
  }

  // Field-scoped save: updateDoc only touches the named fields, so it can
  // never wipe out another user's concurrent movement/pending appends.
  async function _persist(fieldNames) {
    if (!_db) { _noDbFail(); return; }
    try {
      const len = _mainSize();
      if (len > 850000) _sizeBanner(len);
      const { doc, updateDoc, writeBatch } = await import(FS_URL);
      const upd = {}, movUpd = {};
      for (const k of fieldNames) {
        if (_auditsSplit && k === 'auditRecords') continue; // records live in the audits collection now
        if (_data[k] === undefined) continue;
        if (_movementsSplit && k === 'movements') movUpd.movements = _data.movements; // ledger lives in inventory/movements now
        else upd[k] = _data[k];
      }
      if (Object.keys(movUpd).length) {
        // Touching both docs (delete/rename serial) — batch keeps it atomic
        await _guardedWrite(() => {
          const b = writeBatch(_db);
          if (Object.keys(upd).length) b.update(doc(_db, 'inventory', 'main'), upd);
          b.update(doc(_db, 'inventory', 'movements'), movUpd);
          return b.commit();
        });
      } else {
        await _guardedWrite(() => updateDoc(doc(_db, 'inventory', 'main'), upd));
      }
    } catch(e) { _writeFail(e); }
  }

  // What actually gets stored in inventory/main (excludes split-out data)
  function _mainDocData() {
    if (!_auditsSplit && !_movementsSplit) return _data;
    const copy = { ..._data };
    if (_auditsSplit)    { copy.auditsSplit = true;    delete copy.auditRecords; }
    if (_movementsSplit) { copy.movementsSplit = true; delete copy.movements; }
    return copy;
  }
  function _mainSize() { try { return JSON.stringify(_mainDocData()).length; } catch(_) { return 0; } }

  // ── Split audit records into their own collection (audits/<id>) ─────────
  function _initAuditsSplit() {
    if (_auditsUnsub) return Promise.resolve();
    return new Promise(resolve => {
      let first = true;
      const done = () => { if (first) { first = false; resolve(); } };
      import(FS_URL).then(({ collection, onSnapshot }) => {
        _auditsUnsub = onSnapshot(collection(_db, 'audits'), snap => {
          _data.auditRecords = snap.docs.map(x => x.data()).sort((a, b) => (a.id || 0) - (b.id || 0));
          if (first) done();
          else if (typeof _currentView !== 'undefined') _refreshView();
        }, err => { console.error('[DB] audits listener error:', err); done(); });
      }).catch(err => { console.error('[DB] audits listener failed to start:', err); done(); });
    });
  }

  async function _writeAuditDocs(records) {
    const { doc, writeBatch } = await import(FS_URL);
    // Flush by count AND accumulated size — a batch is limited to 500 writes / ~10MiB
    let b = writeBatch(_db), n = 0, bytes = 0;
    for (const r of records) {
      b.set(doc(_db, 'audits', String(r.id)), r);
      n++; bytes += JSON.stringify(r).length;
      if (n >= 100 || bytes > 2000000) { await b.commit(); b = writeBatch(_db); n = 0; bytes = 0; }
    }
    if (n > 0) await b.commit();
  }

  // ── Split movements ledger into its own doc (inventory/movements) ───────
  function _initMovementsSplit() {
    if (_movementsUnsub) return Promise.resolve();
    return new Promise(resolve => {
      let first = true;
      const done = () => { if (first) { first = false; resolve(); } };
      import(FS_URL).then(({ doc, onSnapshot }) => {
        _movementsUnsub = onSnapshot(doc(_db, 'inventory', 'movements'), snap => {
          _data.movements = (snap.exists() && snap.data().movements) || [];
          if (first) done();
          else if (typeof _currentView !== 'undefined') _refreshView();
        }, err => { console.error('[DB] movements listener error:', err); done(); });
      }).catch(err => { console.error('[DB] movements listener failed to start:', err); done(); });
    });
  }

  // One-time migration, run by an admin from the size banner (or console:
  // DB.splitStorage()). Moves audit records to the audits collection and the
  // movements ledger to inventory/movements. Idempotent — safe to re-run.
  // NOTE: the HubSpot sync Cloud Function must be deployed with movementsSplit
  // support BEFORE this runs, or the nightly sync reads an empty ledger.
  async function splitStorage() {
    if (!_db) throw new Error('Not connected to the server');
    const { doc, getDoc, deleteField, runTransaction } = await import(FS_URL);
    const mainRef = doc(_db, 'inventory', 'main');
    const mvRef   = doc(_db, 'inventory', 'movements');

    // Pre-write audit records to the collection (batched — too many for one
    // transaction). Anything that appears after this read is caught below.
    const preSnap = await getDoc(mainRef);
    const pre = preSnap.exists() ? preSnap.data() : {};
    const byId = new Map();
    [...(pre.auditRecords || []), ...(_data.auditRecords || [])].forEach((r, i) => {
      if (!r) return;
      if (r.id == null) r.id = (Date.parse(r.date) || 0) + i; // ancient record without an id — don't drop it
      byId.set(String(r.id), r);
    });
    if (!_auditsSplit) await _writeAuditDocs([...byId.values()]);

    // Atomically: merge the ledger into inventory/movements, absorb any audit
    // records added since the pre-write, flip both flags, drop the big arrays.
    // The transaction retries if main changes underneath — nothing can be lost
    // between the copy and the deleteField.
    let mvCount = 0, lateAudits = 0;
    await runTransaction(_db, async tx => {
      const mainSnap = await tx.get(mainRef);
      const mvSnap   = await tx.get(mvRef);
      const d = mainSnap.exists() ? mainSnap.data() : {};
      const merged = [...(mvSnap.exists() ? (mvSnap.data().movements || []) : [])];
      const have = new Set(merged.map(_mvKey));
      [...(d.movements || []), ...(_data.movements || [])].forEach(r => {
        if (r && !have.has(_mvKey(r))) { have.add(_mvKey(r)); merged.push(r); }
      });
      const newAudits = (d.auditRecords || []).filter(r => r && r.id != null && !byId.has(String(r.id)));
      newAudits.forEach(r => tx.set(doc(_db, 'audits', String(r.id)), r));
      tx.set(mvRef, { movements: merged });
      tx.update(mainRef, {
        auditsSplit: true, movementsSplit: true,
        auditRecords: deleteField(), movements: deleteField(),
      });
      mvCount = merged.length; lateAudits = newAudits.length;
      _data.movements = merged;
    });

    _auditsSplit = true; _movementsSplit = true;
    _data.auditRecords = [...byId.values()].sort((a, b) => (a.id || 0) - (b.id || 0));
    await _initAuditsSplit();
    await _initMovementsSplit();
    const auditCount = byId.size + lateAudits;
    console.warn('[DB] split complete — ' + auditCount + ' count records + ' + mvCount + ' movements moved out; main doc is now ~' + Math.round(_mainSize() / 1024) + 'KB');
    return { audits: auditCount, movements: mvCount };
  }

  // After the split, an old-cache tab's _save() can write the whole auditRecords
  // array back into main. Absorb anything new by id, then delete the field again.
  let _sweeping = false;
  async function _sweepLegacyAudits(legacy) {
    if (_sweeping || !Array.isArray(legacy) || !legacy.length) return;
    _sweeping = true;
    try {
      const have = new Set((_data.auditRecords || []).map(r => String(r.id)));
      const missing = legacy.filter(r => r && r.id != null && !have.has(String(r.id)));
      if (missing.length) await _writeAuditDocs(missing);
      const { doc, updateDoc, deleteField } = await import(FS_URL);
      await updateDoc(doc(_db, 'inventory', 'main'), { auditRecords: deleteField() });
      console.warn('[DB] swept ' + missing.length + ' legacy audit record(s) written by an old-version tab');
    } catch(e) { console.error('[DB] audit sweep failed:', e); }
    finally { _sweeping = false; }
  }

  // Same for movements: an old-cache tab's arrayUnion appends land in main —
  // absorb them into inventory/movements, then delete the field again.
  let _mvSweeping = false;
  async function _sweepLegacyMovements(legacy) {
    if (_mvSweeping || !Array.isArray(legacy) || !legacy.length) return;
    _mvSweeping = true;
    try {
      const { doc, updateDoc, deleteField, arrayUnion } = await import(FS_URL);
      const have = new Set((_data.movements || []).map(_mvKey));
      const missing = legacy.filter(r => r && !have.has(_mvKey(r)));
      if (missing.length) {
        _data.movements.push(...missing);
        await updateDoc(doc(_db, 'inventory', 'movements'), { movements: arrayUnion(...missing) });
      }
      await updateDoc(doc(_db, 'inventory', 'main'), { movements: deleteField() });
      console.warn('[DB] swept ' + missing.length + ' legacy movement(s) written by an old-version tab');
    } catch(e) { console.error('[DB] movements sweep failed:', e); }
    finally { _mvSweeping = false; }
  }

  async function _saveAuditDoc(record) {
    if (!_db) { _noDbFail(); return; }
    try {
      const { doc, setDoc } = await import(FS_URL);
      await _guardedWrite(() => setDoc(doc(_db, 'audits', String(record.id)), record));
    } catch(e) { _writeFail(e); }
  }
  async function _deleteAuditDoc(id) {
    if (!_db) { _noDbFail(); return; }
    try {
      const { doc, deleteDoc } = await import(FS_URL);
      await _guardedWrite(() => deleteDoc(doc(_db, 'audits', String(id))));
    } catch(e) { _writeFail(e); }
  }

  // Append-only write for the high-value arrays: arrayUnion adds the new
  // records without rewriting the array, so concurrent saves cannot clobber
  // each other and a stale late-landing write can only ADD its own records.
  // Journalled in the WAL until the server confirms (walId reused on replay).
  async function _appendArray(field, items, walId) {
    if (walId === undefined) walId = _walAdd(field, items);
    if (!_db) { _noDbFail(); return; }
    try {
      const { doc, updateDoc, arrayUnion } = await import(FS_URL);
      const target = (_movementsSplit && field === 'movements') ? doc(_db, 'inventory', 'movements') : doc(_db, 'inventory', 'main');
      await _guardedWrite(
        () => updateDoc(target, { [field]: arrayUnion(...items) }),
        () => _walRemove(walId),
        true
      );
      if (_movementsSplit && field === 'movements') {
        const n = JSON.stringify(_data.movements).length;
        if (n > 850000) console.warn('[DB] movements ledger doc is ~' + Math.round(n / 1024) + 'KB — approaching the 1MB per-document limit; it will need chunking.');
      }
    } catch(e) { _writeFail(e, true); }
  }

  // Full-document overwrite — ONLY for explicit whole-dataset restore.
  async function _persistFull() {
    if (!_db) { _noDbFail(); return; }
    try {
      const { doc, setDoc } = await import(FS_URL);
      await _guardedWrite(() => setDoc(doc(_db, 'inventory', 'main'), _mainDocData()));
    } catch(e) { _writeFail(e); }
  }

  function _save() { return _persist(SAVE_FIELDS); }

  // ── Save-status banners (self-contained; no dependency on ui.js) ─────────
  function _esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c])); }
  function _saveBanner(html) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('db-save-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'db-save-error';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:100000;background:#b00020;color:#fff;padding:12px 18px;font:14px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
  }
  function _clearSaveBanner() {
    const el = document.getElementById('db-save-error');
    if (el) el.remove();
  }
  function _sizeBanner(len) {
    if (typeof document === 'undefined') return;
    const kb = Math.round(len / 1024);
    const byField = Object.entries(_mainDocData()).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]);
    console.warn('[DB] inventory document is ~' + kb + 'KB — approaching the Firestore 1MB per-document limit. Size by field:',
      Object.fromEntries(byField.map(([k, n]) => [k, Math.round(n / 1024) + 'KB'])));
    const top = byField.slice(0, 3).map(([k, n]) => k + ' ' + Math.round(n / 1024) + 'KB').join(' · ');
    let el = document.getElementById('db-size-warn');
    if (!el) {
      el = document.createElement('div');
      el.id = 'db-size-warn';
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#8a6d00;color:#fff;padding:8px 18px;font:13px/1.4 system-ui,-apple-system,sans-serif;text-align:center;';
      document.body.appendChild(el);
    }
    const fullySplit = _auditsSplit && _movementsSplit;
    const canSplit = !fullySplit && typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin();
    el.innerHTML = '⚠️ Inventory database is ~' + kb + 'KB of the 1024KB per-document limit (' + _esc(top) + '). '
      + (canSplit
          ? '<button id="db-split-btn" style="margin-left:10px;padding:3px 12px;border:1px solid #fff;border-radius:5px;background:transparent;color:#fff;font:inherit;font-weight:700;cursor:pointer;">Split the database now</button>'
          : (fullySplit ? 'Storage is already split — tell the admin.' : 'Approaching capacity — tell the admin to split the data before it stops saving.'));
    const btn = document.getElementById('db-split-btn');
    if (btn) btn.onclick = async () => {
      if (!confirm('Split the database now?\n\nMovements and count history move to their own storage. Make sure the updated HubSpot sync function has been deployed first, and ask everyone to refresh the app afterwards.')) return;
      btn.disabled = true; btn.textContent = 'Splitting…';
      try {
        const res = await splitStorage();
        const sz = _mainSize();
        if (sz > 850000) { _sizeBanner(sz); }
        else {
          el.innerHTML = '✅ Moved ' + res.movements + ' movements + ' + res.audits + ' count record(s) to their own storage. Main database is now ~' + Math.round(sz / 1024) + 'KB. Ask everyone to refresh the app.';
          setTimeout(() => el.remove(), 15000);
        }
      } catch(e) {
        btn.disabled = false; btn.textContent = 'Split the database now';
        alert('Split failed: ' + (e && (e.message || e.code) || e));
      }
    };
  }

  function onReady(fn)          { if (_ready) fn(); else _onReadyCallbacks.push(fn); }
  function getData()             { return _data; }
  function addMovement(mv)       { _data.movements.push(mv); _appendArray('movements', [mv]); }
  function addMovements(mvs)     { if (!mvs || !mvs.length) return; _data.movements.push(...mvs); _appendArray('movements', mvs); }
  function setThreshold(k, v)    { _data.thresholds[k] = v; _save(); }
  function getThreshold(k) {
    if (_data.thresholds[k] !== undefined) return _data.thresholds[k];
    const product = k.split('||')[0];
    const rec = (_data.productRecords || []).find(p => p.name === product);
    if (rec && rec.defaultThreshold != null) return rec.defaultThreshold;
    return 3;
  }
  function addShipment(s)        { _data.shipments.push(s); _save(); }
  function updateShipment(id,u)  { const i=_data.shipments.findIndex(s=>s.id===id); if(i>-1){_data.shipments[i]={..._data.shipments[i],...u};_save();} }
  function removeShipment(id)    { _data.shipments=_data.shipments.filter(s=>s.id!==id); _save(); }
  function setSerialCost(s,c)    { _data.serialCosts[s.toUpperCase()]=c; _save(); }
  function getSerialCost(s)      { return _data.serialCosts[s.toUpperCase()]??null; }

  // HubSpot Company mapping — customer name (exact string) -> HubSpot Company ID
  function setHubspotCompanyId(customer, companyId) {
    if (!_data.hubspotCompanyMap) _data.hubspotCompanyMap = {};
    const key = (customer || '').trim();
    if (!key) return;
    const id = (companyId == null ? '' : String(companyId).trim());
    if (!id) delete _data.hubspotCompanyMap[key];
    else _data.hubspotCompanyMap[key] = id;
    _save();
  }
  function getHubspotCompanyId(customer) { return (_data.hubspotCompanyMap || {})[(customer || '').trim()] || null; }
  function getHubspotCompanyMap()        { return _data.hubspotCompanyMap || {}; }
  function setProductCost(name,cost,map) {
    // Update in-stock serials via inventory map
    Object.values(map).forEach(v => { if(v.product===name) v.inStock.forEach(s=>{_data.serialCosts[s.toUpperCase()]=cost;}); });
    // Also update deployed serials so cost stays consistent across all views
    _data.movements.forEach(mv => {
      if (mv.type === 'OUT' && mv.product === name) {
        mv.serials.forEach(s => { _data.serialCosts[s.toUpperCase()] = cost; });
      }
    });
    _save();
  }

  // Delete a serial from all movements (removes it from stock entirely)
  function deleteSerial(serial) {
    const s = serial.toUpperCase();
    _data.movements = _data.movements.map(mv => ({
      ...mv,
      serials: mv.serials.filter(x => x.toUpperCase() !== s)
    })).filter(mv => mv.serials.length > 0);
    delete _data.serialCosts[s];
    _persist([...SAVE_FIELDS, 'movements']);
  }

  // Rename a serial across all movements and cost records
  function renameSerial(oldSerial, newSerial) {
    const o = oldSerial.toUpperCase();
    const n = newSerial.toUpperCase();
    _data.movements = _data.movements.map(mv => ({
      ...mv,
      serials: mv.serials.map(s => s.toUpperCase() === o ? n : s)
    }));
    if (_data.serialCosts[o] !== undefined) {
      _data.serialCosts[n] = _data.serialCosts[o];
      delete _data.serialCosts[o];
    }
    _persist([...SAVE_FIELDS, 'movements']);
  }
  // Update condition flag on the IN movement for a serial (also records tester)
  // NOTE: the 'used' field is NEVER modified here — it is permanent from receipt
  function updateSerialCondition(serial, condition, testedBy, testedDate, notes) {
    const s = serial.toUpperCase();
    // Per-serial storage — prevents one serial's condition from bleeding across
    // all serials that share the same batch IN movement
    if (!_data.serialConditions) _data.serialConditions = {};
    _data.serialConditions[s] = {
      condition:  condition,
      testedBy:   testedBy  || '',
      testedAt:   testedDate ? (testedDate + 'T00:00:00.000Z') : (condition === '' ? '' : new Date().toISOString()),
      testNotes:  notes !== undefined ? notes : '',
    };
    // Also scrub any movement-level condition for this serial so the fallback
    // in getAllSerialRows can never bleed the old movement condition onto other
    // serials in the same batch
    _data.movements = _data.movements.map(mv => {
      if (mv.type === 'IN' && (mv.condition || '') !== '' && mv.serials.some(x => x.toUpperCase() === s)) {
        return { ...mv, condition: '' };
      }
      return mv;
    });
    _persist([...SAVE_FIELDS, 'movements']);
  }
  function getSerialCondition(serial) {
    const s = serial.toUpperCase();
    const sc = _data.serialConditions || {};
    return s in sc ? sc[s] : null; // null = no per-serial override; caller falls back to movement
  }
  function addOrder(order)       { if(!_data.orders) _data.orders=[]; _data.orders.push(order); _save(); }
  function updateOrder(id,u)     { if(!_data.orders) return; const i=_data.orders.findIndex(o=>o.id===id); if(i>-1){_data.orders[i]={..._data.orders[i],...u};_save();} }
  function removeOrder(id)       { if(!_data.orders) return; _data.orders=_data.orders.filter(o=>o.id!==id); _save(); }
  function getOrders()           { return _data.orders||[]; }

  function addSupplier(s)        { if(!_data.suppliers) _data.suppliers=[]; _data.suppliers.push(s); _save(); }
  function updateSupplier(id,u)  { if(!_data.suppliers) return; const i=_data.suppliers.findIndex(s=>s.id===id); if(i>-1){_data.suppliers[i]={..._data.suppliers[i],...u};_save();} }
  function removeSupplier(id)    { if(!_data.suppliers) return; _data.suppliers=_data.suppliers.filter(s=>s.id!==id); _save(); }
  function getSupplierRecords()  { return _data.suppliers||[]; }

  function addProductRecord(r)      { if(!_data.productRecords) _data.productRecords=[]; _data.productRecords.push(r); _save(); }
  function updateProductRecord(id,u){ if(!_data.productRecords) return; const i=_data.productRecords.findIndex(r=>r.id===id); if(i>-1){_data.productRecords[i]={..._data.productRecords[i],...u};_save();} }
  function removeProductRecord(id)  { if(!_data.productRecords) return; _data.productRecords=_data.productRecords.filter(r=>r.id!==id); _save(); }
  function getProductRecords()      { return _data.productRecords||[]; }

  function exportJSON()          { return JSON.stringify(_data, null, 2); }
  function importJSON(str) {
    const p=JSON.parse(str); if(!Array.isArray(p.movements)) throw new Error('Invalid format');
    _data={shipments:[],serialCosts:{},purchaseOrders:{},hubspotCompanyMap:{},...p};
    delete _data.auditsSplit; delete _data.movementsSplit; // storage-layout flags, not data — _mainDocData() re-adds them when split
    if (_auditsSplit && (_data.auditRecords||[]).length) {
      // Restore audit records into the collection (overwrites same ids; extra docs not in the backup are left alone)
      _writeAuditDocs(_data.auditRecords).catch(e => _writeFail(e));
    }
    if (_movementsSplit) {
      import(FS_URL).then(({ doc, setDoc }) =>
        _guardedWrite(() => setDoc(doc(_db, 'inventory', 'movements'), { movements: _data.movements || [] }))
      ).catch(e => _writeFail(e));
    }
    _persistFull();
  }

  // ── Purchase Orders ────────────────────────────────────────────────────
  // poNumber -> { poNumber, supplier, date, lines: [{product, unitCost}] }
  function savePO(poNumber, poData) {
    if (!_data.purchaseOrders) _data.purchaseOrders = {};
    _data.purchaseOrders[poNumber] = { ...poData, poNumber };
    _save();
  }
  function getPO(poNumber)   { return (_data.purchaseOrders || {})[poNumber] || null; }
  function getAllPOs()        { return Object.values(_data.purchaseOrders || {}); }
  function getPONumbers()    { return Object.keys(_data.purchaseOrders || {}).sort(); }
  // Get locked unit cost for a product from a specific PO
  function getPOUnitCost(poNumber, product) {
    const po = getPO(poNumber);
    if (!po) return null;
    const line = (po.lines || []).find(l => l.product === product);
    return line ? line.unitCost : null;
  }
  // Store which PO a serial is linked to
  function setSerialPO(serial, poNumber) {
    if (!_data.serialPOs) _data.serialPOs = {};
    _data.serialPOs[serial.toUpperCase()] = poNumber;
    _save();
  }
  function getSerialPO(serial) { return (_data.serialPOs || {})[serial.toUpperCase()] || null; }

  function addCustomSupplier(name) {
    if (!_data.customSuppliers) _data.customSuppliers = [];
    if (!_data.customSuppliers.includes(name)) { _data.customSuppliers.push(name); _save(); }
  }
  function addCustomLocation(name) {
    if (!_data.customLocations) _data.customLocations = [];
    if (!_data.customLocations.includes(name)) { _data.customLocations.push(name); _save(); }
  }
  function getCustomSuppliers() { return _data.customSuppliers || []; }
  function getCustomLocations() { return _data.customLocations || []; }

  function addAuditRecord(record)  { if(!_data.auditRecords) _data.auditRecords=[]; _data.auditRecords.push(record); if (_auditsSplit) _saveAuditDoc(record); else _save(); }
  function saveAuditRecord(record) { if (!record || record.id == null) return; if (_auditsSplit) _saveAuditDoc(record); else _save(); }
  function deleteAuditRecord(id)   { _data.auditRecords = (_data.auditRecords||[]).filter(r => String(r.id) !== String(id)); if (_auditsSplit) _deleteAuditDoc(id); else _save(); }
  function getAuditRecords()       { return _data.auditRecords || []; }

  // Paused audits — map keyed by user email, supports multiple concurrent users
  function savePausedAudit(email, state) {
    if (!_data.pausedAudits) _data.pausedAudits = {};
    _data.pausedAudits[email.toLowerCase()] = state;
    _save();
  }
  function getPausedAudit(email) {
    return (_data.pausedAudits || {})[email.toLowerCase()] || null;
  }
  function getAllPausedAudits() { return _data.pausedAudits || {}; }
  function clearPausedAudit(email) {
    if (_data.pausedAudits) { delete _data.pausedAudits[email.toLowerCase()]; _save(); }
  }

  // Pending users — ghost Firebase Auth accounts awaiting profile creation on next login
  function setPendingUser(email, name, role) {
    if (!_data.pendingUsers) _data.pendingUsers = {};
    _data.pendingUsers[email.toLowerCase()] = { name, role, createdAt: new Date().toISOString() };
    _save();
  }
  function getPendingUser(email) {
    return (_data.pendingUsers || {})[email.toLowerCase()] || null;
  }
  function removePendingUser(email) {
    if (_data.pendingUsers) { delete _data.pendingUsers[email.toLowerCase()]; _save(); }
  }

  // ── Pending Deployments ──────────────────────────────────────────────
  function addPendingDeployment(pd)   { if(!_data.pendingDeployments) _data.pendingDeployments=[]; _data.pendingDeployments.push(pd); _appendArray('pendingDeployments', [pd]); }
  function getPendingDeployments()    { return _data.pendingDeployments || []; }
  function removePendingDeployment(id){ _data.pendingDeployments = (_data.pendingDeployments||[]).filter(p => p.id !== id); _persist([...SAVE_FIELDS, 'pendingDeployments']); }
  function updatePendingDeployment(id, changes) {
    const idx = (_data.pendingDeployments||[]).findIndex(p => p.id === id);
    if (idx > -1) { _data.pendingDeployments[idx] = { ..._data.pendingDeployments[idx], ...changes }; _persist([...SAVE_FIELDS, 'pendingDeployments']); }
  }


  // ── Document Uploads (Firebase Storage) ─────────────────────────────
  let _storage = null;
  async function _getStorage() {
    if (_storage) return _storage;
    const { getStorage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    const { getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    _storage = getStorage(getApps()[0]);
    return _storage;
  }

  async function uploadDocument(entityType, entityId, file) {
    const { ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
    const storage = await _getStorage();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `documents/${entityType}-${entityId}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snap.ref);
    return { name: file.name, url, size: file.size, path, uploadedAt: new Date().toISOString() };
  }

  function addDocumentToShipment(id, docMeta) {
    const i = _data.shipments.findIndex(s => s.id === id);
    if (i > -1) {
      if (!_data.shipments[i].documents) _data.shipments[i].documents = [];
      _data.shipments[i].documents.push(docMeta);
      _save();
    }
  }

  function removeDocumentFromShipment(shipmentId, docPath) {
    const i = _data.shipments.findIndex(s => s.id === shipmentId);
    if (i > -1) {
      _data.shipments[i].documents = (_data.shipments[i].documents || []).filter(d => d.path !== docPath);
      _save();
    }
  }

  function addDocumentToOrder(id, docMeta) {
    if (!_data.orders) return;
    const i = _data.orders.findIndex(o => o.id === id);
    if (i > -1) {
      if (!_data.orders[i].documents) _data.orders[i].documents = [];
      _data.orders[i].documents.push(docMeta);
      _save();
    }
  }

  init();
  return { onReady, getData, save:_save, addMovement, addMovements, setThreshold, getThreshold, addShipment, updateShipment, removeShipment, setSerialCost, getSerialCost, setProductCost, setHubspotCompanyId, getHubspotCompanyId, getHubspotCompanyMap, deleteSerial, renameSerial, updateSerialCondition, getSerialCondition, savePO, getPO, getAllPOs, getPONumbers, getPOUnitCost, setSerialPO, getSerialPO, addCustomSupplier, addCustomLocation, getCustomSuppliers, getCustomLocations, addOrder, updateOrder, removeOrder, getOrders, addSupplier, updateSupplier, removeSupplier, getSupplierRecords, addProductRecord, updateProductRecord, removeProductRecord, getProductRecords, addAuditRecord, saveAuditRecord, deleteAuditRecord, splitStorage, getAuditRecords, setPendingUser, getPendingUser, removePendingUser, addPendingDeployment, getPendingDeployments, removePendingDeployment, updatePendingDeployment, savePausedAudit, getPausedAudit, getAllPausedAudits, clearPausedAudit, exportJSON, importJSON, uploadDocument, addDocumentToShipment, removeDocumentFromShipment, addDocumentToOrder };
})();

let _currentView = 'dashboard';
function _refreshView() {
  try {
    if      (_currentView==='dashboard')  UI.renderDashboard();
    else if (_currentView==='stock-list') { UI.populateStockListFilters(); UI.renderStockList(); }
    else if (_currentView==='deployed')   { UI.populateDeployedFilters(); UI.renderDeployed(); }
    else if (_currentView==='history')    UI.renderHistory();
    else if (_currentView==='transit')    UI.renderTransitList();
    else if (_currentView==='orders')     UI.renderOrderList();
    else if (_currentView==='shipment-history') UI.renderShipmentHistory();
  } catch(e) {}
}
