// audit.js — Stock Count v57
// 3-phase: Build count list → Count → Variance report
// Serialised products: scan serials. NS products: enter physical qty.
// Deployed / in-transit: not on site, entirely excluded.

const Audit = (() => {

  // ── State ─────────────────────────────────────────────────────────────
  // Phase 1: count list items: [{ product, category, location, isNS, systemCount, systemSerials[] }]
  // Phase 2: per-product scanned: { [product||loc]: { matched:Set, unexpected:[] } }
  // Phase 2: per-product NS count: { [product||loc]: number|null }
  let _countList  = [];   // items user has added to count
  let _scanned    = {};   // phase 2 scan results
  let _nsCounts   = {};   // phase 2 NS physical counts
  let _lostSet    = new Set();
  let _phase      = 1;    // 1=setup, 2=counting, 3=report
  let _report     = null;
  let _cutoff     = '';   // "received on/before" cutoff captured when the count starts

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const _key = item => item.product + '||' + (item.location || '');

  // "Received on/before" cutoff — blank = no filter
  function _cutoffDate() { return document.getElementById('audit-date-filter')?.value || ''; }
  function _passesCutoff(r) {
    const d = _cutoffDate();
    if (!d) return true;
    if (!r.receivedDate) return true; // no IN date known — keep it in the count
    // Compare in local time: the date picker is a local date, receivedDate is UTC ISO
    const dt = new Date(r.receivedDate);
    const local = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    return local <= d;
  }

  // ── init ──────────────────────────────────────────────────────────────
  function init() {
    if (_phase === 2) return; // don't reset if counting
    if (_phase === 3) return;
    _phase = 1;
    _populateLocFilter();
    _populateProductPicker();
    _renderCountList();
    _renderHistory();
    _wireSetupButtons();
    _checkPausedAudit();
    _renderAdminCounts();
  }

  function _renderAdminCounts() {
    const panel = document.getElementById('audit-admin-panel');
    const body  = document.getElementById('audit-admin-counts-body');
    if (!panel || !body) return;

    // Only show to admins
    if (typeof Auth === 'undefined' || !Auth.isAdmin()) { panel.style.display = 'none'; return; }

    const allPaused = DB.getAllPausedAudits ? DB.getAllPausedAudits() : {};
    const entries   = Object.values(allPaused);

    if (!entries.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';

    const myEmail = Auth.getUser()?.email?.toLowerCase();

    body.innerHTML = entries.map(p => {
      const scannedCount = Object.values(p.scanned || {}).reduce((a, v) => a + (v.matched?.length || 0), 0);
      const missingCount  = (p.missing || []).length;
      const isMe          = p.userEmail?.toLowerCase() === myEmail;
      const savedLabel    = p.autoSaved ? `Auto-saved ${p.savedAt ? new Date(p.savedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : ''}` : `Paused ${p.pausedAt ? new Date(p.pausedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : ''}`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <div>
          <span style="font-weight:600;font-size:13px;">${_esc(p.userName || p.userEmail || 'Unknown')}</span>
          ${isMe ? '<span style="font-size:10px;color:var(--aio-purple);margin-left:6px;">(you)</span>' : ''}
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${_esc(savedLabel)}</span>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            ${(p.countList||[]).length} product${(p.countList||[]).length!==1?'s':''} · ${scannedCount} scanned · ${missingCount} not yet scanned
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          ${isMe ? `<button class="btn btn-orange btn-xs" data-admin-resume="${_esc(p.userEmail)}">▶ Resume my count</button>` : ''}
          <button class="btn btn-ghost btn-xs" data-admin-export="${_esc(p.userEmail)}" style="font-size:11px;">📥 Missing list</button>
          <button class="btn btn-ghost btn-xs" data-admin-discard="${_esc(p.userEmail)}" style="color:var(--danger-text);font-size:11px;">✕ Discard</button>
        </div>
      </div>`;
    }).join('');

    // Wire buttons
    body.querySelectorAll('[data-admin-resume]').forEach(btn => {
      btn.addEventListener('click', () => {
        const paused = DB.getPausedAudit(btn.dataset.adminResume);
        if (paused) _resumeAudit(paused);
      });
    });
    body.querySelectorAll('[data-admin-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const paused = DB.getPausedAudit(btn.dataset.adminExport);
        if (paused) _exportPausedMissing(paused);
      });
    });
    body.querySelectorAll('[data-admin-discard]').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.dataset.adminDiscard;
        const paused = DB.getPausedAudit(email);
        const name = paused?.userName || email;
        if (!confirm(`Discard ${name}'s count? This cannot be undone.`)) return;
        DB.clearPausedAudit(email);
        _renderAdminCounts();
      });
    });

    // Wire refresh button
    const refreshBtn = document.getElementById('btn-refresh-admin-counts');
    if (refreshBtn && !refreshBtn._wired) {
      refreshBtn._wired = true;
      refreshBtn.addEventListener('click', _renderAdminCounts);
    }
  }

  function _checkPausedAudit() {
    const _ue = Auth.getUser()?.email;
    const paused = _ue ? DB.getPausedAudit(_ue) : null;
    const banner  = document.getElementById('audit-paused-banner');
    const summary = document.getElementById('audit-paused-summary');
    if (!banner) return;
    if (!paused) { banner.style.display = 'none'; return; }

    // Count how many serials are missing across all items
    const missingCount = _getMissingFromPaused(paused).length;
    const scannedCount = Object.values(paused.scanned || {}).reduce((a, v) => a + (v.matched?.length || 0) + (v.unexpected?.length || 0), 0);
    banner.style.display = '';
    if (summary) summary.textContent = `${paused.countList?.length || 0} products · ${scannedCount} scanned · ${missingCount} missing — paused ${new Date(paused.pausedAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}`;

    // Wire buttons
    const exportBtn  = document.getElementById('btn-export-paused-missing');
    const resumeBtn  = document.getElementById('btn-resume-audit');
    const discardBtn = document.getElementById('btn-discard-paused');

    if (exportBtn && !exportBtn._wired) {
      exportBtn._wired = true;
      exportBtn.addEventListener('click', () => _exportPausedMissing(paused));
    }
    if (resumeBtn && !resumeBtn._wired) {
      resumeBtn._wired = true;
      resumeBtn.addEventListener('click', () => _resumeAudit(paused));
    }
    if (discardBtn && !discardBtn._wired) {
      discardBtn._wired = true;
      discardBtn.addEventListener('click', () => {
        if (!confirm('Discard the paused count? This cannot be undone.')) return;
        DB.clearPausedAudit(Auth.getUser()?.email||'x');
        banner.style.display = 'none';
      });
    }
  }

  function _getMissingFromPaused(paused) {
    return paused.missing || _getMissingFromState(paused.countList, paused.scanned);
  }

  function _exportPausedMissing(paused) {
    const missing = _getMissingFromPaused(paused);
    const rows = [['Serial Number', 'Product', 'Location', 'Status']];
    missing.forEach(m => rows.push([m.serial, m.product, m.location || '', 'Not scanned']));
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `missing-serials-${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function _resumeAudit(paused) {
    // Restore state from saved paused audit
    _countList    = paused.countList || [];
    _scanned      = {};
    _nsCounts     = paused.nsCounts || {};
    _lostSet      = new Set(paused.lostSet || []);
    _cutoff       = paused.cutoff || '';
    _phase        = 2;

    // Restore scanned sets (arrays → Sets)
    Object.entries(paused.scanned || {}).forEach(([k, v]) => {
      _scanned[k] = { matched: new Set(v.matched || []), unexpected: v.unexpected || [] };
    });

    DB.clearPausedAudit(Auth.getUser()?.email||'x');
    document.getElementById('audit-paused-banner').style.display = 'none';
    document.getElementById('audit-setup-panel').style.display  = 'none';
    document.getElementById('audit-active-panel').style.display = '';

    _buildSerialLookup();
    _renderProductPanels();

    const input  = document.getElementById('audit-serial-input');
    const submit = document.getElementById('btn-audit-submit');
    if (input) { input.disabled = false; input.value = ''; }
    if (!input?._wired) {
      if (input) {
        input._wired = true;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _submitSerial(); } });
        input.addEventListener('paste', e => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData).getData('text');
          const serials = text.split(/[,\n\r\t]+/).map(s => s.trim()).filter(Boolean);
          if (serials.length <= 1) { input.value = serials[0] || ''; return; }
          let added = 0, skipped = 0;
          serials.forEach(s => { const r = _submitSerialValue(s); if (r === 'added') added++; else skipped++; });
          input.value = '';
          const fb = document.getElementById('audit-scan-feedback');
          if (fb) { fb.textContent = `Pasted ${serials.length} serials — ${added} added${skipped > 0 ? ', ' + skipped + ' skipped/unknown' : ''}`; fb.style.color = skipped > 0 ? 'var(--aio-orange-dark,#c05000)' : 'var(--success-text,#1a6b38)'; setTimeout(() => { fb.textContent = ''; fb.style.color = ''; }, 3000); }
        });
      }
      if (submit) submit.addEventListener('click', _submitSerial);
    }
    const finBtn = document.getElementById('btn-finish-audit');
    if (finBtn) { finBtn.disabled = false; finBtn.textContent = 'Complete Count'; }
    if (finBtn && !finBtn._wired) { finBtn._wired = true; finBtn.addEventListener('click', _completeCount); }
    const cancelBtn = document.getElementById('btn-cancel-audit');
    if (cancelBtn && !cancelBtn._wired) { cancelBtn._wired = true; cancelBtn.addEventListener('click', _cancel); }

    const pauseBtn = document.getElementById('btn-pause-audit');
    if (pauseBtn && !pauseBtn._wired) { pauseBtn._wired = true; pauseBtn.addEventListener('click', _pause); }
    if (input) input.focus();
  }

  function _populateLocFilter() {
    const sel = document.getElementById('audit-loc-filter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All locations</option>' +
      Inventory.getLocations().map(l => `<option value="${_esc(l)}"${l===cur?' selected':''}>${_esc(l)}</option>`).join('');
    if (!sel._locWired) {
      sel._locWired = true;
      sel.addEventListener('change', () => _populateProductPicker());
    }
  }

  function _populateProductPicker() {
    const sel  = document.getElementById('audit-product-picker');
    const locF = document.getElementById('audit-loc-filter')?.value || '';
    if (!sel) return;
    const inStock = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock' && _passesCutoff(r));
    // Build product+location combos
    const combos = {};
    inStock.forEach(r => {
      if (locF && r.location !== locF) return;
      const k = r.product + '||' + (r.location||'');
      if (!combos[k]) combos[k] = { product: r.product, location: r.location||'', category: r.category, ns: 0, serial: 0 };
      if (r.serial.startsWith('NS-')) combos[k].ns++;
      else combos[k].serial++;
    });
    // Exclude already-added
    const alreadyAdded = new Set(_countList.map(i => _key(i)));
    sel.innerHTML = '<option value="">Select product to add...</option>' +
      Object.values(combos)
        .filter(c => !alreadyAdded.has(c.product + '||' + c.location))
        .sort((a,b) => a.product.localeCompare(b.product))
        .map(c => {
          const type = c.ns > 0 && c.serial === 0 ? '📦 NS' : c.serial > 0 && c.ns === 0 ? '🔢' : '🔢+📦';
          const qty  = c.ns > 0 && c.serial === 0 ? c.ns : c.serial + (c.ns > 0 ? `+${c.ns}NS` : '');
          return `<option value="${_esc(c.product + '||' + c.location)}">${_esc(c.product)}${c.location?' @ '+c.location:''} · ${type} · ${qty}</option>`;
        }).join('');
  }

  function _wireSetupButtons() {
    const dateF = document.getElementById('audit-date-filter');
    if (dateF && !dateF._wired) {
      dateF._wired = true;
      dateF.addEventListener('change', () => { _populateProductPicker(); _renderCountList(); });
    }
    const addBtn = document.getElementById('btn-add-to-count');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', _addProduct);
    }
    const addAllBtn = document.getElementById('btn-add-all-products');
    if (addAllBtn && !addAllBtn._wired) {
      addAllBtn._wired = true;
      addAllBtn.addEventListener('click', _addAllProducts);
    }
    const startBtn = document.getElementById('btn-start-count');
    if (startBtn && !startBtn._wired) {
      startBtn._wired = true;
      startBtn.addEventListener('click', _startCounting);
    }
  }

  function _addProduct() {
    const sel = document.getElementById('audit-product-picker');
    if (!sel?.value) return;
    const [product, location] = sel.value.split('||');
    _addToCountList(product, location || '');
  }

  function _addAllProducts() {
    const locF    = document.getElementById('audit-loc-filter')?.value || '';
    const inStock = Inventory.getAllSerialRows().filter(r => r.status === 'in-stock' && _passesCutoff(r));
    const combos  = {};
    inStock.forEach(r => {
      if (locF && r.location !== locF) return;
      const k = r.product + '||' + (r.location||'');
      if (!combos[k]) combos[k] = { product: r.product, location: r.location||'' };
    });
    const alreadyAdded = new Set(_countList.map(i => _key(i)));
    Object.values(combos).forEach(c => {
      if (!alreadyAdded.has(c.product + '||' + c.location))
        _addToCountList(c.product, c.location, false);
    });
    _renderCountList();
    _populateProductPicker();
  }

  function _addToCountList(product, location, doRender = true) {
    const inStock = Inventory.getAllSerialRows().filter(r =>
      r.status === 'in-stock' && r.product === product &&
      (!location || r.location === location) && _passesCutoff(r)
    );
    if (!inStock.length) return;
    const isNS     = inStock.every(r => r.serial.startsWith('NS-'));
    const category = inStock[0].category;
    const serials  = inStock.filter(r => !r.serial.startsWith('NS-')).map(r => r.serial);
    const nsCount  = inStock.filter(r => r.serial.startsWith('NS-')).length;

    _countList.push({ product, location, category, isNS: nsCount > 0 && serials.length === 0,
      hasBoth: nsCount > 0 && serials.length > 0,
      systemSerials: serials, systemNsCount: nsCount, systemCount: inStock.length });

    if (doRender) { _renderCountList(); _populateProductPicker(); }
  }

  function _renderCountList() {
    const body    = document.getElementById('audit-count-list-body');
    const badge   = document.getElementById('audit-count-list-badge');
    const startBtn = document.getElementById('btn-start-count');
    if (!body) return;

    const cutoff = _cutoffDate();
    if (badge) badge.textContent = _countList.length ? `(${_countList.length} products${cutoff ? ' · received ≤ ' + fmtDate(cutoff + 'T00:00:00') : ''})` : '';
    if (startBtn) startBtn.style.display = _countList.length ? '' : 'none';

    if (!_countList.length) {
      body.innerHTML = '<div class="empty" style="padding:.75rem 0">No products added yet — select a product above and click Add</div>';
      return;
    }

    body.innerHTML = `<table class="product-stock-table">
      <thead><tr>
        <th style="width:30%">Product</th>
        <th style="width:15%">Category</th>
        <th style="width:18%">Location</th>
        <th style="width:12%">Type</th>
        <th style="width:10%">System qty</th>
        <th style="width:15%"></th>
      </tr></thead>
      <tbody>
        ${_countList.map((item, idx) => {
          const type = item.isNS ? '<span class="cat-badge">📦 No-serial</span>'
                     : item.hasBoth ? '<span class="cat-badge">🔢+📦 Mixed</span>'
                     : '<span class="cat-badge">🔢 Serialised</span>';
          return `<tr>
            <td style="font-weight:500">${_esc(item.product)}</td>
            <td><span class="cat-badge">${_esc(item.category||'—')}</span></td>
            <td>${item.location?`<span class="loc-badge">${_esc(item.location)}</span>`:'<span style="color:var(--text-hint)">All</span>'}</td>
            <td>${type}</td>
            <td style="font-weight:600;color:var(--success-text)">${item.systemCount}</td>
            <td style="text-align:right"><button class="btn btn-ghost btn-xs audit-remove-item" data-idx="${idx}" style="color:#9c2a00;">✕ Remove</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

    body.querySelectorAll('.audit-remove-item').forEach(btn => {
      btn.addEventListener('click', () => {
        _countList.splice(parseInt(btn.dataset.idx), 1);
        _renderCountList();
        _populateProductPicker();
      });
    });
  }

  function _renderHistory() {
    const el = document.getElementById('audit-history-body');
    if (!el) return;
    const records = DB.getAuditRecords().slice().reverse();
    if (!records.length) { el.innerHTML = '<div class="empty" style="padding:.75rem 0">No counts recorded yet</div>'; return; }
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    el.innerHTML = `<table class="product-stock-table">
      <thead><tr>
        <th style="width:11%">Date & Time</th><th style="width:16%">Scope</th>
        <th style="width:10%">Completed by</th>
        <th style="width:7%">Expected</th><th style="width:7%">Matched</th>
        <th style="width:7%">Missing</th><th style="width:7%">Written off</th>
        <th style="width:9%">Value at risk</th>
        <th style="width:26%"></th>
      </tr></thead>
      <tbody>${records.map((r,idx)=>{
        const pendingMissing = (r.missingSerials||[]).filter(s => !(r.writtenOffSerials||[]).includes(s) && !(r.foundSerials||[]).includes(s));
        const writtenOff = (r.writtenOffSerials||[]).length || (r.lost||0);
        const hasPendingMissing = pendingMissing.length > 0 || (r.nsShortfalls||[]).some(ns=>ns.short>(ns.writtenOff||0));
        const pendingTotal = pendingMissing.length + (r.nsShortfalls||[]).reduce((a,ns)=>a+Math.max(0,ns.short-(ns.writtenOff||0)),0);
        const canResume = r._countList && r.missing > 0 && !r.completed; // snapshot exists and not fully matched
        const hasSnapshot = !!r._countList;
        const isLocked = !!r.locked;
        return `<tr>
          <td style="color:var(--text-muted);font-size:11px;white-space:nowrap;">
            ${r.completedAt ? new Date(r.completedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : fmtDate(r.date)}<br>
            <span style="font-size:10px;">${r.completedAt ? new Date(r.completedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
          </td>
          <td style="font-size:12px">${_esc(r.scope)} ${r.locked ? '<span style="font-size:10px;font-weight:700;color:#1a7a3c;background:#eaf7ee;border:1px solid #b8e0c4;border-radius:3px;padding:1px 5px;margin-left:4px;">✅ LOCKED</span>' : ''}</td>
          <td style="font-size:11px;color:var(--text-muted);">${_esc(r.completedBy || '—')}</td>
          <td>${r.expected}</td>
          <td style="color:#1a7a3c;font-weight:600">${r.matched}</td>
          <td style="color:${r.missing>0?'#9c6000':'var(--text-muted)'};font-weight:600">${r.missing}</td>
          <td style="color:${writtenOff>0?'#9c2a00':'var(--text-muted)'};font-weight:600">${writtenOff}</td>
          <td style="font-size:12px;font-weight:600;color:var(--aio-purple)">${fmt$(r.missingValue||0)}</td>
          <td style="text-align:right;white-space:nowrap;">
            <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;">
              ${hasSnapshot ? `<button class="btn btn-ghost btn-xs audit-history-view" data-idx="${idx}" style="font-size:11px;">📋 View report</button>` : ''}
              ${hasSnapshot && r.missing > 0 && !isLocked ? `<button class="btn btn-ghost btn-xs audit-history-resume" data-idx="${idx}" style="font-size:11px;color:var(--aio-purple);">▶ Resume</button>` : ''}
              ${isAdmin && !isLocked && (r.missing > 0 || (r.nsShortfalls||[]).some(ns => ns.short > (ns.writtenOff||0))) ? `<button class="btn btn-ghost btn-xs audit-history-review" data-idx="${idx}" style="font-size:11px;">${hasPendingMissing ? `⚠ ${pendingTotal} pending` : '✓ All resolved'}</button>` : ''}
              ${isAdmin ? `<button class="btn btn-ghost btn-xs audit-history-delete" data-idx="${idx}" style="font-size:11px;color:var(--danger-text);border-color:var(--danger-border);">🗑</button>` : ''}
              ${isAdmin ? `<button class="btn btn-ghost btn-xs audit-history-lock" data-idx="${idx}" style="font-size:11px;${r.locked?'color:#1a7a3c;border-color:#b8e0c4;font-weight:600;':'color:var(--text-muted);'}" title="${r.locked?'Locked — click to unlock':'Lock this count as resolved'}">${r.locked ? '🔒' : '🔓'}</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

    // Wire lock buttons
    el.querySelectorAll('.audit-history-lock').forEach(btn => {
      btn.addEventListener('click', () => {
        const recs = DB.getAuditRecords().slice().reverse();
        const rec = recs[parseInt(btn.dataset.idx)];
        if (!rec) return;
        const allRecs = DB.getAuditRecords();
        const ri = allRecs.findIndex(r => r.id === rec.id);
        if (ri < 0) return;
        if (rec.locked) {
          if (!confirm(`Unlock "${rec.scope}"?\nEdits and write-offs will be possible again.`)) return;
          allRecs[ri].locked = false; allRecs[ri].lockedBy = null; allRecs[ri].lockedAt = null;
        } else {
          if (!confirm(`Lock and mark "${rec.scope}" as fully resolved?\nNo further edits, write-offs, or resuming will be possible.`)) return;
          allRecs[ri].locked = true;
          allRecs[ri].lockedBy = Auth.getName ? Auth.getName() : (Auth.getUser()?.email || 'Unknown');
          allRecs[ri].lockedAt = new Date().toISOString();
        }
        DB.save();
        _renderHistory();
      });
    });

    // Wire delete buttons
    el.querySelectorAll('.audit-history-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const recs = DB.getAuditRecords().slice().reverse();
        const rec = recs[parseInt(btn.dataset.idx)];
        if (!rec) return;
        if (!confirm(`Delete count record for "${rec.scope}"?\n\nThis removes the record only — no stock movements are affected.`)) return;
        const allRecs = DB.getAuditRecords();
        const ri = allRecs.findIndex(r => r.id === rec.id);
        if (ri > -1) { allRecs.splice(ri, 1); DB.save(); }
        _renderHistory();
      });
    });

    // Wire review buttons
    el.querySelectorAll('.audit-history-review').forEach(btn => {
      btn.addEventListener('click', () => {
        const records = DB.getAuditRecords().slice().reverse();
        _showHistoryReview(records[parseInt(btn.dataset.idx)], parseInt(btn.dataset.idx));
      });
    });

    // Wire view report buttons
    el.querySelectorAll('.audit-history-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const records = DB.getAuditRecords().slice().reverse();
        _viewHistoricalReport(records[parseInt(btn.dataset.idx)]);
      });
    });

    // Wire resume buttons
    el.querySelectorAll('.audit-history-resume').forEach(btn => {
      btn.addEventListener('click', () => {
        const records = DB.getAuditRecords().slice().reverse();
        const rec = records[parseInt(btn.dataset.idx)];
        if (!rec._countList) { UI.showAlert('No snapshot available to resume this count.', 'error'); return; }
        if (!confirm(`Resume the count for "${rec.scope}"?\n\nYou'll continue from where it was completed — ${rec.matched} matched, ${rec.missing} still missing.`)) return;
        _resumeFromRecord(rec);
      });
    });
  }

  // ── View historical report ────────────────────────────────────────────
  function _viewHistoricalReport(record) {
    if (!record._countList || !record._scanned) {
      // No snapshot — fall back to the review modal
      _showHistoryReview(record, DB.getAuditRecords().slice().reverse().findIndex(r=>r.id===record.id));
      return;
    }

    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();

    // Rebuild _report from snapshot so _renderReport() works
    const savedCountList = JSON.parse(JSON.stringify(record._countList));
    const savedScanned = {};
    Object.entries(record._scanned).forEach(([k, v]) => {
      savedScanned[k] = { matched: new Set(v.matched || []), unexpected: v.unexpected || [] };
    });
    const savedNsCounts = record._nsCounts || {};
    const writtenOffSet = new Set((record.writtenOffSerials||[]).map(s=>s.toUpperCase()));
    const foundSet = new Set((record.foundSerials||[]).map(s=>s.toUpperCase()));

    let totalExpected=0, totalMatched=0, totalMissing=0, totalUnexpected=0, totalNsVariance=0, nsGroupsEntered=0, missingValue=0;
    const allMissingSerials=[], allUnexpectedSerials=[];

    const productReports = savedCountList.map(item => {
      const k = item.product + '||' + (item.location||'');
      const st = savedScanned[k] || { matched: new Set(), unexpected: [] };
      const _costed = Inventory.getAllSerialRows().filter(r=>r.product===item.product&&r.status==='in-stock'&&r.cost!=null);
      const unitCost = _costed.length ? _costed.reduce((a,r)=>a+r.cost,0) / _costed.length : 0;

      if (item.isNS) {
        const phys = savedNsCounts[k];
        // Written-off items count as accounted for — add them to effective count
        const nsWO = (record.nsShortfalls||[]).find(ns => ns.product===item.product && ns.location===(item.location||''));
        const writtenOffQty = nsWO?.writtenOff || 0;
        const effectivePhys = phys != null ? phys + writtenOffQty : null;
        const diff = effectivePhys != null ? effectivePhys - item.systemNsCount : null;
        if (diff !== null) { totalNsVariance += diff; nsGroupsEntered++; }
        const short = diff !== null && diff < 0 ? Math.abs(diff) * unitCost : 0;
        totalExpected += item.systemNsCount;
        if (diff !== null && diff < 0) { totalMissing += Math.abs(diff); missingValue += short; }
        return { item, type:'ns', phys: effectivePhys, diff, short, writtenOffQty };
      } else {
        // Apply written-off and found adjustments to the display
        const missing = item.systemSerials.filter(s => !st.matched.has(s.toUpperCase()) && !writtenOffSet.has(s.toUpperCase()) && !foundSet.has(s.toUpperCase()));
        const matched = [...st.matched, ...item.systemSerials.filter(s=>foundSet.has(s.toUpperCase()))];
        const unexp = st.unexpected || [];
        const mVal = missing.length * unitCost;
        totalExpected += item.systemSerials.length;
        totalMatched += matched.length;
        totalMissing += missing.length;
        totalUnexpected += unexp.length;
        missingValue += mVal;
        missing.forEach(s => allMissingSerials.push({ serial:s, item }));
        unexp.forEach(s => allUnexpectedSerials.push({ serial:s, item }));
        return { item, type:'serial', matched, missing, unexp, mVal, _rawMissing: item.systemSerials.filter(s=>!st.matched.has(s.toUpperCase())) };
      }
    });

    _report = { productReports, totalExpected, totalMatched, totalMissing, totalUnexpected,
                totalNsVariance, nsGroupsEntered, missingValue, allMissingSerials, allUnexpectedSerials,
                _historicalRecord: record };

    // Show the report panel (same as after completing a count)
    document.getElementById('audit-setup-panel').style.display  = 'none';
    document.getElementById('audit-active-panel').style.display = 'none';
    document.getElementById('audit-report-panel').style.display = '';

    _renderReport();
    _wireReportButtons();

    // Override the report header to show it's historical + add back/resume buttons
    const reportSummaryEl = document.getElementById('audit-report-summary');
    if (reportSummaryEl) {
      const headerBanner = document.createElement('div');
      headerBanner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 14px;background:var(--bg-hover);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;font-size:13px;';
      headerBanner.innerHTML = `
        <div>
          <strong>${_esc(record.scope)}</strong>
          <span style="color:var(--text-muted);margin-left:8px;">${record.completedAt ? new Date(record.completedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : fmtDate(record.date)}</span>
          ${record.completedBy ? `<span style="color:var(--text-muted);margin-left:8px;">by <strong>${_esc(record.completedBy)}</strong></span>` : ''}
          ${(record.writtenOffSerials||[]).length>0?`<span style="margin-left:8px;color:#9c2a00;">· ${(record.writtenOffSerials||[]).length} written off</span>`:''}
          ${(record.foundSerials||[]).length>0?`<span style="margin-left:8px;color:#1a7a3c;">· ${(record.foundSerials||[]).length} found</span>`:''}
          ${record.locked?`<span style="margin-left:10px;font-size:11px;font-weight:700;color:#1a7a3c;background:#eaf7ee;border:1px solid #b8e0c4;border-radius:4px;padding:2px 8px;">🔒 LOCKED${record.lockedBy?' · '+_esc(record.lockedBy):''}</span>`:''}
        </div>
        <div style="display:flex;gap:8px;">
          ${record.missing > 0 && !record.locked ? `<button class="btn btn-orange btn-sm" id="btn-hist-resume-count">▶ Resume count</button>` : ''}
          ${isAdmin && !record.locked ? `<button class="btn btn-ghost btn-sm" id="btn-hist-lock-count" style="color:#1a7a3c;border-color:#b8e0c4;">🔒 Lock & resolve</button>` : ''}
          ${isAdmin && record.locked ? `<button class="btn btn-ghost btn-sm" id="btn-hist-unlock-count" style="color:var(--text-muted);">🔓 Unlock</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="btn-hist-back-to-history">← Back to history</button>
        </div>`;
      reportSummaryEl.insertBefore(headerBanner, reportSummaryEl.firstChild);
    }

    // Wire historical-specific buttons
    const backBtn = document.getElementById('btn-hist-back-to-history');
    if (backBtn) backBtn.addEventListener('click', () => {
      document.getElementById('audit-report-panel').style.display = 'none';
      document.getElementById('audit-setup-panel').style.display  = '';
      _report = null;
      _renderHistory();
      _checkPausedAudit(); // re-show resume banner if there's a paused count
    });

    const lockBtn = document.getElementById('btn-hist-lock-count');
    if (lockBtn) lockBtn.addEventListener('click', () => {
      if (!confirm(`Lock "${record.scope}" as fully resolved?\nNo further edits or write-offs will be possible.`)) return;
      const recs = DB.getAuditRecords(); const ri = recs.findIndex(r => r.id === record.id);
      if (ri > -1) { recs[ri].locked = true; recs[ri].lockedBy = Auth.getName?Auth.getName():(Auth.getUser()?.email||'Unknown'); recs[ri].lockedAt = new Date().toISOString(); Object.assign(record, recs[ri]); DB.save(); }
      document.getElementById('audit-report-panel').style.display = 'none';
      document.getElementById('audit-setup-panel').style.display = '';
      _report = null; _renderHistory();
    });
    const unlockBtn = document.getElementById('btn-hist-unlock-count');
    if (unlockBtn) unlockBtn.addEventListener('click', () => {
      if (!confirm(`Unlock this count? Edits and write-offs will be possible again.`)) return;
      const recs = DB.getAuditRecords(); const ri = recs.findIndex(r => r.id === record.id);
      if (ri > -1) { recs[ri].locked = false; recs[ri].lockedBy = null; recs[ri].lockedAt = null; Object.assign(record, recs[ri]); DB.save(); }
      document.getElementById('audit-report-panel').style.display = 'none';
      document.getElementById('audit-setup-panel').style.display = '';
      _report = null; _renderHistory();
    });

    const resumeBtn = document.getElementById('btn-hist-resume-count');
    if (resumeBtn) resumeBtn.addEventListener('click', () => {
      if (!confirm(`Resume the count for "${record.scope}"?\n\nYou'll continue scanning from where it was completed. ${(record.writtenOffSerials||[]).length>0?`${(record.writtenOffSerials||[]).length} written-off serials will be excluded.`:''}`)) return;
      _resumeFromRecord(record);
    });

    // Add admin action buttons to each missing serial row in the report
    if (isAdmin) {
      // Wire write-off buttons — works on locked AND unlocked counts
      function _wireHistWriteOff() {
        document.querySelectorAll('.audit-mark-lost').forEach(btn => {
          const serial = btn.dataset.serial;
          btn.onclick = (e) => {
            e.stopPropagation();
            if (!confirm(`Write off "${serial}" as permanently lost?\nThis removes it from inventory.`)) return;
            _histWriteOff([serial], record, btn);
          };
        });
        document.querySelectorAll('.audit-write-off-product').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const pr = _report.productReports[parseInt(btn.dataset.idx)];
            if (!pr?.missing?.length) return;
            const remaining = pr.missing.filter(s=>!new Set((record.writtenOffSerials||[]).map(x=>x.toUpperCase())).has(s.toUpperCase()));
            if (!remaining.length) return;
            if (!confirm(`Write off all ${remaining.length} missing serials as permanently lost?`)) return;
            _histWriteOff(remaining, record, null);
            btn.remove();
          };
        });
      }
      _wireHistWriteOff(); // wire immediately
      requestAnimationFrame(_wireHistWriteOff); // and after paint to catch any late renders
    }
  }

  // ── Central write-off function — works on locked AND unlocked counts ────
  // Single-save approach: build all changes first, then save ONCE to avoid race conditions
  function _histWriteOff(serials, record, singleBtn) {
    const now = new Date().toISOString();
    const by  = Auth.getName ? Auth.getName() : (Auth.getUser()?.email || '');
    const data = DB.getData();
    const recs = data.auditRecords || DB.getAuditRecords();
    const ri   = recs.findIndex(r => r.id === record.id);
    if (ri < 0) return;
    if (!recs[ri].writtenOffSerials) recs[ri].writtenOffSerials = [];

    // Step 1: build the write-off movements (persisted append-safely below)
    const newMovements = [];
    serials.forEach(serial => {
      const key = serial.toUpperCase();
      const info = Inventory.getAllSerialRows().find(r => r.serial.toUpperCase() === key) || {};
      // Only write off if still in stock
      const stillInStock = data.movements.filter(m => m.serials && m.serials.some(s => s.toUpperCase() === key));
      const outCount = stillInStock.filter(m => m.type === 'OUT').length;
      const inCount  = stillInStock.filter(m => m.type === 'IN').length;
      if (outCount >= inCount && outCount > 0) return; // already fully written off

      newMovements.push({
        id: Date.now() + Math.random(), type: 'OUT',
        product: info.product || recs[ri].scope.split(' @ ')[0],
        category: info.category || '',
        location: info.location || recs[ri].scope.split(' @ ')[1] || '',
        serials: [serial],
        customer: 'Lost Stock — Count Write-off',
        by,
        ref: `Audit: ${recs[ri].scope} (${new Date(recs[ri].date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})})`,
        date: now, isLost: true,
      });

      // Record in writtenOffSerials
      if (!recs[ri].writtenOffSerials.some(s => s.toUpperCase() === key)) {
        recs[ri].writtenOffSerials.push(serial);
      }
    });

    // Step 2: recalculate counts
    const woSet = new Set(recs[ri].writtenOffSerials.map(s => s.toUpperCase()));
    const fSet  = new Set((recs[ri].foundSerials||[]).map(s => s.toUpperCase()));
    recs[ri].missing = (recs[ri].missingSerials||[]).filter(s => !woSet.has(s.toUpperCase()) && !fSet.has(s.toUpperCase())).length;
    recs[ri].matched = recs[ri].expected - recs[ri].missing;
    recs[ri].lost    = recs[ri].writtenOffSerials.length;

    // Step 3: persist — movements via the append-safe path, audit record via save
    Object.assign(record, recs[ri]);
    DB.addMovements(newMovements);
    DB.save();

    // Step 4: refresh report
    _viewHistoricalReport(record);
  }


  function _resumeFromRecord(record) {
    if (!record._countList || !record._scanned) return;

    _countList = JSON.parse(JSON.stringify(record._countList));
    _nsCounts  = Object.assign({}, record._nsCounts || {});
    _lostSet   = new Set(record.writtenOffSerials || []);
    _cutoff    = record.cutoffDate || '';
    _phase     = 2;

    // Restore scanned state — exclude serials that have been written off
    _scanned = {};
    Object.entries(record._scanned).forEach(([k, v]) => {
      const woSet = new Set((record.writtenOffSerials||[]).map(s=>s.toUpperCase()));
      _scanned[k] = {
        matched: new Set((v.matched||[]).filter(s => !woSet.has(s.toUpperCase()))),
        unexpected: v.unexpected || [],
      };
    });

    // Also mark found serials as matched (so they show scanned)
    const foundSet = new Set((record.foundSerials||[]).map(s=>s.toUpperCase()));
    if (foundSet.size > 0) {
      _countList.forEach(item => {
        const k = item.product + '||' + (item.location||'');
        if (!_scanned[k]) _scanned[k] = { matched: new Set(), unexpected: [] };
        item.systemSerials.forEach(s => {
          if (foundSet.has(s.toUpperCase())) _scanned[k].matched.add(s.toUpperCase());
        });
      });
    }

    _buildSerialLookup();

    // Immediately save so progress is preserved even before scanning
    _autoSave();

    // Switch to active panel
    document.getElementById('audit-setup-panel').style.display  = 'none';
    document.getElementById('audit-report-panel').style.display = 'none';
    document.getElementById('audit-active-panel').style.display = '';

    const scopeLabel = _countList.length === 1
      ? _countList[0].product + (_countList[0].location ? ' @ ' + _countList[0].location : '')
      : `${_countList.length} products`;
    const progressEl = document.getElementById('audit-progress-title');
    const scopeEl = document.getElementById('audit-scope-label');
    if (progressEl) progressEl.textContent = 'Resumed count';
    if (scopeEl) scopeEl.textContent = scopeLabel;

    _renderProductPanels();
    _updateScanLog();

    const input  = document.getElementById('audit-serial-input');
    const submit = document.getElementById('btn-audit-submit');
    if (input) { input.disabled = false; input.value = ''; }
    if (input && !input._wired) {
      input._wired = true;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _submitSerial(); } });
      input.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData||window.clipboardData).getData('text');
        const serials = text.split(/[,\n\r\t]+/).map(s=>s.trim()).filter(Boolean);
        if (serials.length <= 1) { input.value = serials[0]||''; return; }
        let added=0,skipped=0;
        serials.forEach(s => { const r=_submitSerialValue(s); if(r==='added') added++; else skipped++; });
        input.value='';
        const fb=document.getElementById('audit-scan-feedback');
        if(fb){fb.textContent=`Pasted ${serials.length} serials — ${added} added${skipped>0?', '+skipped+' skipped':''}`;setTimeout(()=>{fb.textContent='';},3000);}
      });
      if (submit) submit.addEventListener('click', _submitSerial);
    }

    const finBtn = document.getElementById('btn-finish-audit');
    if (finBtn) { finBtn.disabled = false; finBtn.textContent = 'Complete Count'; }
    if (finBtn && !finBtn._wired) { finBtn._wired = true; finBtn.addEventListener('click', _completeCount); }

    const cancelBtn = document.getElementById('btn-cancel-audit');
    if (cancelBtn && !cancelBtn._wired) { cancelBtn._wired = true; cancelBtn.addEventListener('click', _cancel); }

    const pauseBtn = document.getElementById('btn-pause-audit');
    if (pauseBtn && !pauseBtn._wired) { pauseBtn._wired = true; pauseBtn.addEventListener('click', _pause); }

    if (input) input.focus();
  }

  function _showHistoryReview(record, idx) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'audit-review-overlay';

    const missing = record.missingSerials || [];
    const nsShortfalls = record.nsShortfalls || [];
    const writtenOff = new Set((record.writtenOffSerials || []).map(s=>s.toUpperCase()));
    const found = new Set((record.foundSerials || []).map(s=>s.toUpperCase()));

    const pending = missing.filter(s => !writtenOff.has(s.toUpperCase()) && !found.has(s.toUpperCase()));
    const alreadyWrittenOff = missing.filter(s => writtenOff.has(s.toUpperCase()));
    const alreadyFound = missing.filter(s => found.has(s.toUpperCase()));

    const totalSerialPending = pending.length;
    const totalNsPending = nsShortfalls.reduce((a, ns) => a + Math.max(0, ns.short - (ns.writtenOff||0)), 0);
    const totalPending = totalSerialPending + totalNsPending;

    // NS shortfall section HTML
    const nsHtml = nsShortfalls.length ? nsShortfalls.map((ns, nsIdx) => {
      const remaining = Math.max(0, ns.short - (ns.writtenOff||0));
      return `<div style="padding:10px;background:#fffbf0;border:1.5px solid #f0d860;border-radius:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <span style="font-weight:600;font-size:13px;">${_esc(ns.product)}</span>
            ${ns.location ? `<span class="loc-badge" style="margin-left:6px;">${_esc(ns.location)}</span>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
              System: ${ns.system} · Counted: ${ns.counted} · Short: <strong style="color:#9c6000;">${ns.short}</strong>
              ${ns.writtenOff ? ` · Already written off: ${ns.writtenOff}` : ''}
              ${remaining === 0 ? ' · <span style="color:#1a7a3c;">✅ Fully resolved</span>' : ''}
            </div>
          </div>
          ${remaining > 0 ? `<div style="display:flex;gap:6px;align-items:center;">
            <label style="font-size:12px;color:var(--text-muted);">Write off:</label>
            <input type="number" class="fi ns-writeoff-qty" data-ns-idx="${nsIdx}" min="1" max="${remaining}" value="${remaining}" style="width:60px;padding:4px 6px;font-size:12px;" />
            <button class="btn btn-ghost btn-xs ns-writeoff-btn" data-ns-idx="${nsIdx}" style="color:#9c2a00;border-color:#f5c6b0;white-space:nowrap;">🗑 Write off</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('') : '';

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:620px;max-height:85vh;display:flex;flex-direction:column;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>⚠ Missing stock — ${_esc(record.scope)}</span>
          <button class="btn-remove-row" id="audit-review-close">×</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">${fmtDate(record.date)} · ${totalPending > 0 ? `${totalPending} unit${totalPending!==1?'s':''} pending action` : 'All resolved'}</div>
        ${nsHtml ? `<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">No-serial items (write off by quantity)</div>${nsHtml}</div>` : ''}

        ${pending.length > 0 ? `
        <div style="margin-bottom:10px;padding:10px;background:#fffbf0;border:1.5px solid #f0d860;border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:12px;font-weight:700;color:#7a5000;">⚠ ${pending.length} pending — not yet actioned</div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-ghost btn-xs" id="audit-review-mark-all-found" style="font-size:11px;color:#1a7a3c;border-color:#b8e0c4;">✓ Mark all as found</button>
              <button class="btn btn-ghost btn-xs" id="audit-review-write-all" style="font-size:11px;color:#9c2a00;border-color:#f5c6b0;">🗑 Write off all ${pending.length}</button>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:3px;max-height:150px;overflow-y:auto;" id="audit-review-pending-list">
            ${pending.map(s=>`<div style="display:flex;align-items:center;gap:4px;background:white;border:1px solid var(--border);border-radius:4px;padding:2px 6px;">
              <span style="font-family:var(--mono);font-size:11px;">${_esc(s)}</span>
              <button class="btn-review-found" data-serial="${_esc(s)}" title="Mark as found" style="background:none;border:none;cursor:pointer;color:#1a7a3c;font-size:14px;padding:0 2px;">✓</button>
              <button class="btn-review-writeoff" data-serial="${_esc(s)}" title="Write off as lost" style="background:none;border:none;cursor:pointer;color:#9c2a00;font-size:14px;padding:0 2px;">🗑</button>
            </div>`).join('')}
          </div>
        </div>` : `<div style="padding:10px;background:#eaf7ee;border:1.5px solid #b8e0c4;border-radius:8px;color:#1a6b38;font-size:13px;margin-bottom:10px;">✅ All missing serials have been actioned</div>`}

        ${alreadyWrittenOff.length > 0 ? `
        <div style="margin-bottom:8px;font-size:12px;">
          <span style="font-weight:600;color:#9c2a00;">🗑 Written off (${alreadyWrittenOff.length}):</span>
          <span style="color:var(--text-muted);margin-left:6px;font-family:var(--mono);font-size:11px;">${alreadyWrittenOff.join(' · ')}</span>
        </div>` : ''}
        ${alreadyFound.length > 0 ? `
        <div style="margin-bottom:8px;font-size:12px;">
          <span style="font-weight:600;color:#1a7a3c;">✓ Marked as found (${alreadyFound.length}):</span>
          <span style="color:var(--text-muted);margin-left:6px;font-family:var(--mono);font-size:11px;">${alreadyFound.join(' · ')}</span>
        </div>` : ''}

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid var(--border);">
          <button class="btn btn-ghost" id="audit-review-close2">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#audit-review-close').addEventListener('click', () => { overlay.remove(); _renderHistory(); });
    overlay.querySelector('#audit-review-close2').addEventListener('click', () => { overlay.remove(); _renderHistory(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); _renderHistory(); } });

    // Helper to action a serial
    function _actionSerial(serial, action) {
      const records = DB.getAuditRecords();
      // Find this record by id
      const recIdx = records.findIndex(r => r.id === record.id);
      if (recIdx === -1) return;
      const rec = records[recIdx];

      if (action === 'writeoff') {
        if (!rec.writtenOffSerials) rec.writtenOffSerials = [];
        if (!rec.writtenOffSerials.includes(serial)) rec.writtenOffSerials.push(serial);
        rec.lost = (rec.writtenOffSerials || []).length;
        // Create OUT movement as lost
        const info = Inventory.getAllSerialRows().find(r => r.serial.toUpperCase() === serial.toUpperCase()) || {};
        DB.addMovement({
          id: Date.now() + Math.random(), type: 'OUT',
          product: info.product || rec.scope, category: info.category || '', location: info.location || '',
          serials: [serial], customer: 'Lost Stock — Count Write-off',
          by: Auth.getName ? Auth.getName() : '', ref: `Audit: ${rec.scope} (${fmtDate(rec.date)})`,
          date: new Date().toISOString(), isLost: true,
        });
      } else if (action === 'found') {
        if (!rec.foundSerials) rec.foundSerials = [];
        if (!rec.foundSerials.includes(serial)) rec.foundSerials.push(serial);
      }
      DB.save();
      // Update record reference for next action
      Object.assign(record, rec);
    }

    // Wire NS write-off buttons
    overlay.querySelectorAll('.ns-writeoff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nsIdx = parseInt(btn.dataset.nsIdx);
        const ns = nsShortfalls[nsIdx];
        if (!ns) return;
        const qtyInput = overlay.querySelector(`.ns-writeoff-qty[data-ns-idx="${nsIdx}"]`);
        const qty = parseInt(qtyInput?.value) || 0;
        if (qty < 1) return;
        const remaining = Math.max(0, ns.short - (ns.writtenOff||0));
        if (qty > remaining) { alert(`Only ${remaining} unit${remaining!==1?'s':''} left to write off.`); return; }
        if (!confirm(`Write off ${qty} unit${qty!==1?'s':''} of "${ns.product}" as lost stock?\nThis removes them from inventory permanently.`)) return;

        // Create OUT movements for the NS items
        const invMap = Inventory.getInventoryMap();
        const key = ns.product + '||' + ns.location;
        const inStock = [...(invMap[key]?.inStock || [])];
        const toWriteOff = inStock.slice(0, qty);
        const now = new Date().toISOString();

        if (toWriteOff.length > 0) {
          DB.addMovement({
            id: Date.now(), type: 'OUT',
            product: ns.product, category: ns.category, location: ns.location,
            serials: toWriteOff, customer: 'Lost Stock — Count Write-off',
            by: Auth.getName ? Auth.getName() : '', ref: `Audit: ${record.scope} (${fmtDate(record.date)})`,
            date: now, isLost: true,
          });
        }

        // Update the nsShortfalls record
        const allRecords = DB.getAuditRecords();
        const recIdx = allRecords.findIndex(r => r.id === record.id);
        if (recIdx > -1) {
          if (!allRecords[recIdx].nsShortfalls) allRecords[recIdx].nsShortfalls = [];
          if (!allRecords[recIdx].nsShortfalls[nsIdx]) allRecords[recIdx].nsShortfalls[nsIdx] = ns;
          const _remaining3 = Math.max(0, ns.short-(ns.writtenOff||0));
          const _actualQty3 = Math.min(qty, _remaining3);
          allRecords[recIdx].nsShortfalls[nsIdx].writtenOff = (ns.writtenOff||0) + _actualQty3;
          allRecords[recIdx].lost = (allRecords[recIdx].lost||0) + _actualQty3;
          const _nsTotal3 = (allRecords[recIdx].nsShortfalls||[]).reduce((a,ns2)=>a+Math.max(0,ns2.short-(ns2.writtenOff||0)),0);
          const _sm3 = (allRecords[recIdx].missingSerials||[]).filter(s=>!(allRecords[recIdx].writtenOffSerials||[]).includes(s)&&!(allRecords[recIdx].foundSerials||[]).includes(s)).length;
          allRecords[recIdx].missing = _nsTotal3 + _sm3;
          allRecords[recIdx].matched = allRecords[recIdx].expected - allRecords[recIdx].missing;
          Object.assign(record, allRecords[recIdx]);
          DB.save();
        }

        // Refresh the modal
        overlay.remove();
        _showHistoryReview(record, idx);
        _renderHistory();
      });
    });

    // Wire individual serial buttons
    overlay.querySelectorAll('.btn-review-found').forEach(btn => {
      btn.addEventListener('click', () => {
        _actionSerial(btn.dataset.serial, 'found');
        const item = btn.closest('div[style]');
        if (item) { item.style.opacity = '.4'; item.querySelectorAll('button').forEach(b => b.disabled = true); item.title = 'Marked as found'; }
      });
    });
    overlay.querySelectorAll('.btn-review-writeoff').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm(`Write off "${btn.dataset.serial}" as permanently lost?\nThis will create a lost stock movement removing it from inventory.`)) return;
        _actionSerial(btn.dataset.serial, 'writeoff');
        const item = btn.closest('div[style]');
        if (item) { item.style.opacity = '.4'; item.style.textDecoration = 'line-through'; item.querySelectorAll('button').forEach(b => b.disabled = true); }
      });
    });

    // Wire bulk buttons
    const writeAllBtn = overlay.querySelector('#audit-review-write-all');
    if (writeAllBtn) {
      writeAllBtn.addEventListener('click', () => {
        if (!confirm(`Write off all ${pending.length} missing serials as permanently lost?\nThis will remove them from inventory.`)) return;
        pending.forEach(s => _actionSerial(s, 'writeoff'));
        overlay.remove();
        _renderHistory();
      });
    }
    const foundAllBtn = overlay.querySelector('#audit-review-mark-all-found');
    if (foundAllBtn) {
      foundAllBtn.addEventListener('click', () => {
        if (!confirm(`Mark all ${pending.length} missing serials as found?\nNo stock movements will be created.`)) return;
        pending.forEach(s => _actionSerial(s, 'found'));
        overlay.remove();
        _renderHistory();
      });
    }
  }

  // ── Phase 2: Start counting ───────────────────────────────────────────
  function _startCounting() {
    if (!_countList.length) return;
    _phase   = 2;
    _scanned = {};
    _nsCounts = {};
    _lostSet  = new Set();
    _cutoff   = _cutoffDate();

    // Init scan state per item
    _countList.forEach(item => {
      _scanned[_key(item)] = { matched: new Set(), unexpected: [] };
    });

    // Build a serial→item lookup for smart assignment
    _serialLookup = {};
    _countList.forEach(item => {
      item.systemSerials.forEach(s => { _serialLookup[s.toUpperCase()] = item; });
    });

    document.getElementById('audit-setup-panel').style.display  = 'none';
    document.getElementById('audit-active-panel').style.display  = '';
    document.getElementById('audit-report-panel').style.display  = 'none';

    const scopeLabel = _countList.length === 1
      ? _countList[0].product + (_countList[0].location ? ' @ ' + _countList[0].location : '')
      : `${_countList.length} products`;
    document.getElementById('audit-scope-label').textContent   = scopeLabel;
    document.getElementById('audit-progress-title').textContent = 'Count in progress';

    _renderProductPanels();

    const input = document.getElementById('audit-serial-input');
    const submit = document.getElementById('btn-audit-submit');
    if (input) { input.disabled = false; input.value = ''; }
    if (!input._wired) {
      input._wired = true;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _submitSerial(); } });
      submit.addEventListener('click', _submitSerial);

      // Paste handler — supports comma/newline/tab separated serials (CSV, column copy, etc.)
      input.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const serials = text.split(/[,\n\r\t]+/).map(s => s.trim()).filter(Boolean);
        if (serials.length <= 1) {
          // Single value — just insert it and let user submit normally
          input.value = serials[0] || '';
          return;
        }
        // Multiple values — submit each one
        let added = 0, skipped = 0;
        serials.forEach(s => {
          const result = _submitSerialValue(s);
          if (result === 'added') added++;
          else skipped++;
        });
        input.value = '';
        const fb = document.getElementById('audit-scan-feedback');
        if (fb) {
          fb.textContent = `Pasted ${serials.length} serials — ${added} added${skipped > 0 ? ', ' + skipped + ' skipped/unknown' : ''}`;
          fb.style.color = skipped > 0 ? 'var(--aio-orange-dark, #c05000)' : 'var(--success-text, #1a6b38)';
          setTimeout(() => { fb.textContent = ''; fb.style.color = ''; }, 3000);
        }
      });
    }

    const finBtn = document.getElementById('btn-finish-audit');
    if (finBtn) { finBtn.textContent = 'Complete Count'; finBtn.disabled = false; }
    if (finBtn && !finBtn._wired) { finBtn._wired = true; finBtn.addEventListener('click', _completeCount); }

    const cancelBtn = document.getElementById('btn-cancel-audit');
    if (cancelBtn && !cancelBtn._wired) { cancelBtn._wired = true; cancelBtn.addEventListener('click', _cancel); }

    const pauseBtn = document.getElementById('btn-pause-audit');
    if (pauseBtn && !pauseBtn._wired) { pauseBtn._wired = true; pauseBtn.addEventListener('click', _pause); }

    const camBtn = document.getElementById('btn-audit-camera');
    if (camBtn && !camBtn._wired) {
      camBtn._wired = true;
      camBtn.addEventListener('click', () => {
        if (typeof Scanner !== 'undefined') Scanner.start(s => { input.value = s; _submitSerial(); });
      });
    }

    const logToggle = document.getElementById('btn-audit-log-toggle');
    if (logToggle && !logToggle._wired) {
      logToggle._wired = true;
      logToggle.addEventListener('click', () => {
        const logEl = document.getElementById('audit-scan-log');
        if (!logEl) return;
        const hidden = logEl.style.display === 'none';
        logEl.style.display = hidden ? '' : 'none';
        logToggle.textContent = hidden ? '▲ Hide list' : '▼ Show list';
      });
    }

    _updateScanLog();
    if (input) input.focus();
  }

  let _serialLookup = {};

  function _buildSerialLookup() {
    _serialLookup = {};
    _countList.forEach(item => {
      (item.systemSerials || []).forEach(s => {
        _serialLookup[s.toUpperCase()] = item;
      });
    });
  }

  function _renderProductPanels() {
    const container = document.getElementById('audit-product-panels');
    if (!container) return;

    container.innerHTML = _countList.map((item, idx) => {
      const k        = _key(item);
      const typeLabel = item.isNS ? '📦 No-serial (enter qty)'
                      : item.hasBoth ? '🔢+📦 Mixed'
                      : '🔢 Scan serials';
      return `<div class="panel audit-product-panel" style="margin-bottom:1rem;" id="audit-panel-${idx}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <span style="font-weight:600;font-size:14px">${_esc(item.product)}</span>
            ${item.location?`<span class="loc-badge" style="margin-left:8px;">${_esc(item.location)}</span>`:''}
            <span class="cat-badge" style="margin-left:6px;">${_esc(item.category||'—')}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${typeLabel}</span>
          </div>
          <div class="audit-panel-status" id="audit-panel-status-${idx}" style="font-size:12px;font-weight:600;color:var(--text-muted);">
            System: ${item.systemCount}
          </div>
        </div>
        ${item.isNS ? `
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-size:13px;color:var(--text-muted);">System count: <strong>${item.systemNsCount}</strong></div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="font-size:13px;font-weight:500;">Physical count:</label>
              <input type="number" min="0" class="fi audit-ns-qty" style="width:80px;padding:4px 8px;font-size:14px;font-weight:600;"
                data-key="${_esc(k)}" data-system="${item.systemNsCount}" placeholder="0" />
            </div>
            <div class="audit-ns-variance-display" id="audit-ns-var-${idx}" style="font-size:14px;font-weight:700;"></div>
          </div>
        ` : item.hasBoth ? `
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
            <div style="flex:1;min-width:200px;">
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">SERIALISED (${item.systemSerials.length})</div>
              <div class="audit-panel-scanned" id="audit-scanned-${idx}" style="font-size:12px;color:var(--text-muted);">None scanned yet</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">NO-SERIAL COUNT (system: ${item.systemNsCount})</div>
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" min="0" class="fi audit-ns-qty" style="width:80px;padding:4px 8px;"
                  data-key="${_esc(k)}" data-system="${item.systemNsCount}" placeholder="0" />
                <div class="audit-ns-variance-display" id="audit-ns-var-${idx}"></div>
              </div>
            </div>
          </div>
        ` : `
          <div class="audit-panel-scanned" id="audit-scanned-${idx}" style="font-size:12px;color:var(--text-muted);">
            None scanned yet — use the scan input above
          </div>
        `}
      </div>`;
    }).join('');

    // Wire NS qty inputs
    container.querySelectorAll('.audit-ns-qty').forEach(inp => {
      inp.addEventListener('input', () => {
        const k      = inp.dataset.key;
        const system = parseInt(inp.dataset.system, 10);
        const phys   = inp.value === '' ? null : parseInt(inp.value, 10);
        _nsCounts[k] = phys;
        // Find the panel idx
        const panelIdx = _countList.findIndex(i => _key(i) === k);
        const varEl = document.getElementById(`audit-ns-var-${panelIdx}`);
        if (varEl) {
          if (phys === null || isNaN(phys)) { varEl.textContent = ''; return; }
          const diff = phys - system;
          varEl.textContent = (diff > 0 ? '+' : '') + diff;
          varEl.style.color = diff === 0 ? '#1a7a3c' : diff > 0 ? '#1a5080' : '#9c6000';
        }
        _updatePanelStatus(panelIdx);
      });
    });
  }

  // ── submit a serial (auto-assigns to correct product) ─────────────────
  // ── Auto-save ─────────────────────────────────────────────────────────
  function _getMissingFromState(countList, scannedMap) {
    const missing = [];
    (countList || []).forEach(item => {
      if (item.isNS) return;
      const key = item.product + '||' + (item.location || '');
      const scanned = new Set((scannedMap[key]?.matched || []).map(s => s.toUpperCase()));
      (item.systemSerials || []).forEach(s => {
        if (!scanned.has(s.toUpperCase())) missing.push({ serial: s, product: item.product, location: item.location });
      });
    });
    return missing;
  }

  function _autoSave() {
    const email = Auth.getUser()?.email;
    if (!email || _phase !== 2) return;
    const scannedSerializable = {};
    Object.entries(_scanned).forEach(([k, v]) => {
      scannedSerializable[k] = { matched: [...v.matched], unexpected: v.unexpected };
    });
    DB.savePausedAudit(email, {
      countList: _countList, scanned: scannedSerializable, nsCounts: _nsCounts,
      lostSet: [..._lostSet], missing: _getMissingFromState(_countList, scannedSerializable),
      cutoff: _cutoff,
      savedAt: new Date().toISOString(), userEmail: email,
      userName: Auth.getName ? Auth.getName() : email, autoSaved: true,
    });
  }

  // ── Scanned serials log ─────────────────────────────────────────────
  function _updateScanLog() {
    const wrap    = document.getElementById('audit-scan-log-wrap');
    const logEl   = document.getElementById('audit-scan-log');
    const countEl = document.getElementById('audit-scan-log-count');
    if (!wrap || !logEl) return;

    // Gather all scanned serials across all panels (matched only — not unexpected)
    const all = [];
    Object.entries(_scanned).forEach(([key, state]) => {
      const item = _countList.find(i => _key(i) === key);
      state.matched.forEach(s => all.push({ serial: s, product: item?.product || '' }));
    });

    if (all.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    if (countEl) countEl.textContent = all.length;

    // Render newest-first
    const reversed = [...all].reverse();
    logEl.innerHTML = reversed.map(({ serial, product }) =>
      `<span title="${_esc(product)}" style="font-family:var(--mono);font-size:11px;background:var(--bg-hover,rgba(0,0,0,.04));border:1px solid var(--border);border-radius:4px;padding:2px 7px;color:var(--success-text,#1a6b38);white-space:nowrap;">${_esc(serial)}</span>`
    ).join('');
  }

  // Core serial submission logic — used by both _submitSerial (single) and paste handler (bulk)
  // Returns: 'added' | 'duplicate' | 'ns' | 'not-in-count' | 'unknown'
  function _submitSerialValue(raw) {
    if (_phase !== 2 || !raw) return 'unknown';
    const key = raw.trim().toUpperCase();
    if (!key) return 'unknown';

    if (key.startsWith('NS-')) return 'ns';

    // Already scanned?
    const alreadyIn = Object.values(_scanned).find(s => s.matched.has(key) || s.unexpected.find(u => u.toUpperCase() === key));
    if (alreadyIn) return 'duplicate';

    const item = _serialLookup[key];
    if (item) {
      const k = _key(item);
      _scanned[k].matched.add(key);
      const idx = _countList.indexOf(item);
      _updateSerialPanel(idx, item);
      _updatePanelStatus(idx);
      _updateScanLog();
      _autoSave();
      return 'added';
    } else {
      // Not in count list — check if in stock at all
      const allRow = Inventory.getAllSerialRows().find(r => r.serial.toUpperCase() === key && r.status === 'in-stock');
      if (allRow) return 'not-in-count';
      // Truly unknown — add as unexpected to first serialised product
      const firstSerial = _countList.find(i => !i.isNS);
      if (firstSerial) {
        _scanned[_key(firstSerial)].unexpected.push(raw.trim());
        const idx = _countList.indexOf(firstSerial);
        _updateSerialPanel(idx, firstSerial);
      }
      return 'unknown';
    }
  }

  function _submitSerial() {
    if (_phase !== 2) return;
    const input    = document.getElementById('audit-serial-input');
    const raw      = (input?.value || '').trim();
    if (!raw) return;
    input.value = '';
    const key      = raw.toUpperCase();
    const feedback = document.getElementById('audit-scan-feedback');

    if (raw.toUpperCase().startsWith('NS-')) {
      feedback.style.color = '#9c6000';
      feedback.textContent = `⚠ No-serial item — enter the physical count in the panel below`;
      setTimeout(() => { feedback.textContent = ''; }, 3000);
      return;
    }

    // Check if already scanned in any panel
    const alreadyIn = Object.values(_scanned).find(s => s.matched.has(key) || s.unexpected.find(u => u.toUpperCase() === key));
    if (alreadyIn) {
      feedback.style.color = 'var(--text-muted)';
      feedback.textContent = `⚠ ${raw} already scanned`;
      setTimeout(() => { feedback.textContent = ''; }, 2000);
      return;
    }

    const item = _serialLookup[key];
    if (item) {
      const k = _key(item);
      _scanned[k].matched.add(key);
      const idx = _countList.indexOf(item);
      feedback.style.color = '#1a7a3c';
      feedback.textContent = `✅ ${raw} — ${item.product}`;
      _updateSerialPanel(idx, item);
      _updatePanelStatus(idx);
      _updateScanLog();
      _autoSave();
    } else {
      // Unexpected — doesn't match any product in count list
      // Try to find which product panel it might belong to (best-effort: check all in-stock)
      const allRow = Inventory.getAllSerialRows().find(r => r.serial.toUpperCase() === key && r.status === 'in-stock');
      if (allRow) {
        feedback.style.color = '#9c6000';
        feedback.textContent = `⚠ ${raw} — ${allRow.product} is in stock but not in your count list`;
      } else {
        // Truly unknown — assign to first serialised product as unexpected
        const firstSerial = _countList.find(i => !i.isNS);
        if (firstSerial) {
          _scanned[_key(firstSerial)].unexpected.push(raw);
          const idx = _countList.indexOf(firstSerial);
          _updateSerialPanel(idx, firstSerial);
        }
        feedback.style.color = '#9c2a00';
        feedback.textContent = `❓ ${raw} — not found in system`;
      }
    }

    if (input) input.focus();
  }

  function _updateSerialPanel(idx, item) {
    const el = document.getElementById(`audit-scanned-${idx}`);
    if (!el) return;
    const k          = _key(item);
    const st         = _scanned[k];
    const matchCount = st.matched.size;
    const unexpCount = st.unexpected.length;
    const missingCount = item.systemSerials.length - matchCount;

    el.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
        <span style="color:#1a7a3c;font-weight:600">✅ ${matchCount} scanned</span>
        <span style="color:${missingCount>0?'#9c6000':'var(--text-muted)'};font-weight:600">⚠ ${missingCount} not yet scanned</span>
        ${unexpCount>0?`<span style="color:#9c2a00;font-weight:600">❓ ${unexpCount} unexpected</span>`:''}
      </div>`;
  }

  function _updatePanelStatus(idx) {
    const item = _countList[idx];
    const el   = document.getElementById(`audit-panel-status-${idx}`);
    if (!el || !item) return;
    const k  = _key(item);
    const st = _scanned[k];

    if (item.isNS) {
      const phys = _nsCounts[k];
      if (phys == null) { el.textContent = `System: ${item.systemCount}`; el.style.color = 'var(--text-muted)'; return; }
      const diff = phys - item.systemNsCount;
      el.textContent = `System: ${item.systemNsCount} · Counted: ${phys} · ${diff>=0?(diff===0?'✅ Match':'↑ +'+diff):'↓ '+diff}`;
      el.style.color = diff === 0 ? '#1a7a3c' : '#9c6000';
    } else {
      const matched  = st.matched.size;
      const total    = item.systemSerials.length;
      const missing  = total - matched;
      const unexp    = st.unexpected.length;
      el.textContent = `${matched}/${total} scanned${missing>0?' · ⚠ '+missing+' missing':''}${unexp>0?' · ❓ '+unexp+' unexpected':''}`;
      el.style.color = matched === total && unexp === 0 ? '#1a7a3c' : '#9c6000';
    }
  }

  // ── Phase 3: Complete count ───────────────────────────────────────────
  function _completeCount() {
    if (_phase !== 2) return;
    _phase = 3;

    document.getElementById('audit-serial-input').disabled = true;
    document.getElementById('btn-audit-submit').disabled   = true;
    document.getElementById('btn-finish-audit').disabled   = true;
    document.querySelectorAll('.audit-ns-qty').forEach(i => i.disabled = true);

    // Build report
    let totalExpected = 0, totalMatched = 0, totalMissing = 0, totalUnexpected = 0, totalNsVariance = 0, nsGroupsEntered = 0;
    let missingValue  = 0;
    const allMissingSerials = [], allUnexpectedSerials = [];

    const productReports = _countList.map(item => {
      const k   = _key(item);
      const st  = _scanned[k];
      const _costed = Inventory.getAllSerialRows().filter(r => r.product === item.product && r.status === 'in-stock' && r.cost != null);
      const unitCost = _costed.length ? _costed.reduce((a,r)=>a+r.cost,0) / _costed.length : 0;

      if (item.isNS) {
        const phys     = _nsCounts[k];
        const diff     = (phys != null && !isNaN(phys)) ? phys - item.systemNsCount : null;
        if (diff !== null) { totalNsVariance += diff; nsGroupsEntered++; }
        const short    = diff !== null && diff < 0 ? Math.abs(diff) * unitCost : 0;
        totalExpected += item.systemNsCount;
        if (diff !== null && diff < 0) { totalMissing += Math.abs(diff); missingValue += short; }
        return { item, type:'ns', phys, diff, short };
      } else {
        const missing  = item.systemSerials.filter(s => !st.matched.has(s.toUpperCase()));
        const matched  = [...st.matched];
        const unexp    = st.unexpected;
        const mVal     = missing.length * unitCost;
        totalExpected += item.systemSerials.length;
        totalMatched  += matched.length;
        totalMissing  += missing.length;
        totalUnexpected += unexp.length;
        missingValue   += mVal;
        missing.forEach(s => allMissingSerials.push({ serial:s, item }));
        unexp.forEach(s => allUnexpectedSerials.push({ serial:s, item }));
        if (item.hasBoth) {
          const phys = _nsCounts[k];
          const diff = (phys != null && !isNaN(phys)) ? phys - item.systemNsCount : null;
          if (diff !== null) { totalNsVariance += diff; nsGroupsEntered++; }
          return { item, type:'mixed', matched, missing, unexp, mVal, phys, nsDiff: diff };
        }
        return { item, type:'serial', matched, missing, unexp, mVal };
      }
    });

    _report = { productReports, totalExpected, totalMatched, totalMissing, totalUnexpected,
                totalNsVariance, nsGroupsEntered, missingValue, allMissingSerials, allUnexpectedSerials };

    // Save to DB
    // Build NS shortfall summary for write-off later
    const nsShortfalls = productReports
      .filter(pr => (pr.type === 'ns' || pr.type === 'mixed') && pr.diff != null && pr.diff < 0)
      .map(pr => ({
        product:  pr.item.product,
        category: pr.item.category || '',
        location: pr.item.location || '',
        system:   pr.item.systemNsCount,
        counted:  pr.phys,
        short:    Math.abs(pr.diff),
        writtenOff: 0,
      }));

    // Serialize scanned state for resume
    const _scannedSnapshot = {};
    Object.entries(_scanned).forEach(([k,v]) => {
      _scannedSnapshot[k] = { matched: [...v.matched], unexpected: v.unexpected };
    });

    DB.addAuditRecord({
      id: Date.now(), date: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      completedBy: Auth.getName ? Auth.getName() : (Auth.getUser()?.email || 'Unknown'),
      scope: _countList.map(i => i.product + (i.location?' @ '+i.location:'')).join(', '),
      productCount: _countList.length,
      cutoffDate: _cutoff || '',
      locF: '', catF: '', prodF: '',
      expected: totalExpected, matched: totalMatched, missing: totalMissing,
      unexpected: totalUnexpected, lost: 0, missingValue,
      nsVariance: nsGroupsEntered > 0 ? totalNsVariance : null,
      missingSerials: allMissingSerials.map(r=>r.serial),
      matchedSerials: productReports.filter(pr=>pr.matched).flatMap(pr=>pr.matched),
      unexpectedSerials: allUnexpectedSerials.map(r=>r.serial),
      writtenOffSerials: [],
      foundSerials: [],
      nsShortfalls,
      // Full snapshot for resume & report replay
      _countList: JSON.parse(JSON.stringify(_countList)),
      _scanned: _scannedSnapshot,
      _nsCounts: Object.assign({}, _nsCounts),
      completed: true,
    });

    _renderReport();

    document.getElementById('audit-active-panel').style.display = 'none';
    document.getElementById('audit-report-panel').style.display = '';
    _wireReportButtons();
  }

  function _renderReport() {
    const { productReports, totalExpected, totalMatched, totalMissing, totalUnexpected,
            totalNsVariance, nsGroupsEntered, missingValue } = _report;

    // Summary cards
    document.getElementById('audit-report-summary').innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
        <div class="svc-stat-card" style="background:#eaf7ee;border-color:#b8e0c4;color:#1a6b38;flex:1;min-width:110px;">
          <div class="svc-stat-count">${totalMatched}<span style="font-size:14px;font-weight:400;margin-left:4px;">/ ${totalExpected}</span></div>
          <div class="svc-stat-label">✅ Serials matched</div>
          <div class="svc-stat-value">${totalExpected>0?Math.round(totalMatched/totalExpected*100):100}% found</div>
        </div>
        <div class="svc-stat-card" style="background:#fffbf0;border-color:#f0d860;color:#9c6000;flex:1;min-width:110px;">
          <div class="svc-stat-count">${totalMissing}</div>
          <div class="svc-stat-label">⚠ Serials missing</div>
          <div class="svc-stat-value">${fmt$(missingValue)}</div>
        </div>
        <div class="svc-stat-card" style="background:#fef0ea;border-color:#f5c6b0;color:#9c2a00;flex:1;min-width:110px;">
          <div class="svc-stat-count">${totalUnexpected}</div>
          <div class="svc-stat-label">❓ Unexpected serials</div>
          <div class="svc-stat-value">Not in system</div>
        </div>
        ${nsGroupsEntered > 0 ? `<div class="svc-stat-card" style="background:${totalNsVariance===0?'#eaf7ee':'#fffbf0'};border-color:${totalNsVariance===0?'#b8e0c4':'#f0d860'};color:${totalNsVariance===0?'#1a6b38':'#9c6000'};flex:1;min-width:110px;">
          <div class="svc-stat-count">${totalNsVariance>0?'+':''}${totalNsVariance}</div>
          <div class="svc-stat-label">📦 NS total variance</div>
          <div class="svc-stat-value">${nsGroupsEntered} group${nsGroupsEntered!==1?'s':''} counted</div>
        </div>` : ''}
      </div>
      ${totalMissing > 0 ? `<div style="margin-bottom:12px;padding:10px 14px;background:#fffbf0;border:1.5px solid #f0d860;border-radius:8px;font-size:13px;color:#7a5000;">
        <strong>⚠ ${totalMissing} missing serial${totalMissing!==1?'s':''}</strong> detected — use <strong>Write off</strong> on items below to permanently remove them from inventory and record as lost stock.
      </div>` : ''}`;

    // Per-product report panels
    const reportsHtml = productReports.map((pr, idx) => {
      const item = pr.item;
      if (pr.type === 'ns') {
        const diffStr = pr.diff === null ? 'Not counted' : pr.diff === 0 ? '✅ Correct' : (pr.diff > 0 ? `↑ Over by ${pr.diff}` : `↓ Short by ${Math.abs(pr.diff)}`);
        const rc = pr.diff === null ? '' : pr.diff === 0 ? 'audit-row-match' : 'audit-row-missing';
        return `<div class="panel" style="margin-bottom:1rem;">
          <div style="font-weight:600;font-size:14px;margin-bottom:8px;">${_esc(item.product)}${item.location?` <span class="loc-badge">${_esc(item.location)}</span>`:''}</div>
          <table class="product-stock-table"><thead><tr>
            <th>System</th><th>Counted</th><th>Variance</th><th>Value short</th><th>Result</th>
          </tr></thead><tbody><tr class="${rc}">
            <td style="font-weight:600">${item.systemNsCount}</td>
            <td style="font-weight:600">${pr.phys != null ? pr.phys : '—'}</td>
            <td style="font-weight:700;color:${pr.diff===null?'var(--text-hint)':pr.diff===0?'#1a7a3c':pr.diff>0?'#1a5080':'#9c2a00'}">${pr.diff!=null?(pr.diff>0?'+':'')+pr.diff:'—'}</td>
            <td style="font-size:12px">${pr.short>0?fmt$(pr.short):'—'}</td>
            <td><span class="audit-badge ${pr.diff===null?'audit-badge-missing':pr.diff===0?'audit-badge-match':'audit-badge-missing'}">${diffStr}</span></td>
          </tr></tbody></table>
          ${pr.diff !== null && pr.diff < 0 ? `<div style="margin-top:10px;padding:10px;background:#fffbf0;border:1.5px solid #f0d860;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-size:13px;color:#7a5000;">Write off short stock:</span>
            <input type="number" class="fi audit-ns-writeoff-qty" data-product="${_esc(item.product)}" data-location="${_esc(item.location||'')}" min="1" max="${Math.abs(pr.diff)}" value="${Math.abs(pr.diff)}" style="width:70px;padding:4px 8px;font-size:13px;" />
            <span style="font-size:12px;color:var(--text-muted);">of ${Math.abs(pr.diff)} short</span>
            <button class="btn btn-ghost btn-sm audit-ns-writeoff-btn" data-product="${_esc(item.product)}" data-location="${_esc(item.location||'')}" data-short="${Math.abs(pr.diff)}" style="color:#9c2a00;border-color:#f5c6b0;">🗑 Write off</button>
          </div>` : ''}
        </div>`;
      }

      // Serialised or mixed
      const allRows = [
        ...pr.missing.map(s => ({ serial:s, cat:'missing' })),
        ...(pr.unexp||[]).map(s => ({ serial:s, cat:'unexpected' })),
        ...pr.matched.map(s => ({ serial:s, cat:'matched' })),
      ];

      const tableRows = allRows.map(r => {
        const rc    = r.cat==='matched'?'audit-row-match':r.cat==='missing'?'audit-row-missing':'audit-row-unexpected';
        const badge = r.cat==='matched'    ? '<span class="audit-badge audit-badge-match">✅ Matched</span>'
                    : r.cat==='missing'    ? '<span class="audit-badge audit-badge-missing">⚠ Missing</span>'
                    : '<span class="audit-badge audit-badge-unexpected">❓ Unexpected</span>';
        const lostBtn = r.cat==='missing'
          ? `<button class="btn btn-ghost btn-xs audit-mark-lost" data-serial="${_esc(r.serial)}" style="color:#9c2a00;border-color:#f5c6b0;white-space:nowrap;">Write off</button>` : '';
        const removeUnexpBtn = r.cat==='unexpected'
          ? `<button class="btn btn-ghost btn-xs audit-remove-unexpected" data-serial="${_esc(r.serial)}" style="color:var(--text-muted);white-space:nowrap;">✕ Remove</button>` : '';
        const rowId = `audit-row-${r.serial.replace(/[^a-z0-9]/gi,'_')}`;
        const info  = Inventory.getAllSerialRows().find(row => row.serial.toUpperCase() === r.serial.toUpperCase()) || {};
        return `<tr class="${rc}" id="${rowId}">
          <td>${badge}</td>
          <td style="font-family:var(--mono);font-size:11px;font-weight:500">${_esc(r.serial)}</td>
          <td>${lostBtn}${removeUnexpBtn}</td>
        </tr>`;
      }).join('');

      const nsSection = (pr.type === 'mixed' && item.systemNsCount > 0) ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">NO-SERIAL ITEMS</div>
          <div style="display:flex;gap:16px;font-size:13px;">
            <span>System: <strong>${item.systemNsCount}</strong></span>
            <span>Counted: <strong>${pr.phys!=null?pr.phys:'—'}</strong></span>
            ${pr.nsDiff!=null?`<span style="font-weight:700;color:${pr.nsDiff===0?'#1a7a3c':pr.nsDiff>0?'#1a5080':'#9c6000'}">${pr.nsDiff>0?'+':''}${pr.nsDiff} variance</span>`:''}
          </div>
        </div>` : '';

      return `<div class="panel" style="margin-bottom:1rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-weight:600;font-size:14px;">${_esc(item.product)}${item.location?` <span class="loc-badge">${_esc(item.location)}</span>`:''}</div>
          <div style="font-size:12px;color:${pr.missing.length===0&&(pr.unexp||[]).length===0?'#1a7a3c':'#9c6000'};font-weight:600">
            ${pr.matched.length}/${item.systemSerials.length} matched
            ${pr.missing.length>0?' · ⚠ '+pr.missing.length+' missing':''}
            ${(pr.unexp||[]).length>0?' · ❓ '+(pr.unexp||[]).length+' unexpected':''}
          </div>
        </div>
        ${allRows.length ? `<div class="table-wrap"><table>
          <thead><tr><th style="width:18%">Result</th><th style="width:62%">Serial</th><th style="width:20%"></th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>` : '<div class="empty" style="padding:.5rem">Nothing to show</div>'}
        ${nsSection}
        ${pr.missing.length > 1 ? `<div style="margin-top:8px;"><button class="btn btn-ghost btn-xs audit-write-off-product" data-idx="${idx}" style="color:#9c2a00;border-color:#f5c6b0;">Write off all ${pr.missing.length} missing</button></div>` : ''}
      </div>`;
    }).join('');

    document.getElementById('audit-report-products').innerHTML = reportsHtml;

    // Wire write-off buttons
    document.querySelectorAll('.audit-mark-lost').forEach(btn => {
      btn.addEventListener('click', () => _writeOff([btn.dataset.serial], btn));
    });
    document.querySelectorAll('.audit-write-off-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const pr = _report.productReports[parseInt(btn.dataset.idx)];
        if (!pr || !pr.missing?.length) return;
        const remaining = pr.missing.filter(s => !_lostSet.has(s.toUpperCase()));
        if (!remaining.length) return;
        if (!confirm(`Write off all ${remaining.length} missing serials for "${pr.item.product}" as lost?\nThis removes them from inventory permanently.`)) return;
        _writeOff(remaining);
        btn.remove();
      });
    });
  }

  function _wireReportButtons() {
    const newBtn = document.getElementById('btn-new-count');
    if (newBtn && !newBtn._wired) {
      newBtn._wired = true;
      newBtn.addEventListener('click', () => {
        // If currently in an active count (phase 2), save progress before resetting
        if (_phase === 2 && _countList.length > 0) {
          const email = Auth.getUser()?.email;
          if (email) {
            const scannedSerializable = {};
            Object.entries(_scanned).forEach(([k, v]) => {
              scannedSerializable[k] = { matched: [...v.matched], unexpected: v.unexpected };
            });
            DB.savePausedAudit(email, {
              countList: _countList, scanned: scannedSerializable,
              nsCounts: _nsCounts, lostSet: [..._lostSet],
              missing: _getMissingFromState(_countList, scannedSerializable),
              cutoff: _cutoff,
              savedAt: new Date().toISOString(), userEmail: email,
              userName: Auth.getName ? Auth.getName() : email, autoSaved: true,
            });
          }
        }
        _reset();
      });
    }
    const exportBtn = document.getElementById('btn-audit-export-report');
    if (exportBtn && !exportBtn._wired) { exportBtn._wired = true; exportBtn.addEventListener('click', _exportCSV); }

    // Wire remove-unexpected buttons
    document.querySelectorAll('.audit-remove-unexpected').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', () => {
        const serial = btn.dataset.serial;
        if (!confirm(`Remove "${serial}" from the count?\nNo stock movements are affected.`)) return;

        // Update historical record if viewing one
        if (_report?._historicalRecord) {
          const rec = _report._historicalRecord;
          const recs = DB.getAuditRecords();
          const ri = recs.findIndex(r => r.id === rec.id);
          if (ri > -1) {
            recs[ri].unexpectedSerials = (recs[ri].unexpectedSerials||[]).filter(s => s.toUpperCase() !== serial.toUpperCase());
            recs[ri].unexpected = recs[ri].unexpectedSerials.length;
            Object.values(recs[ri]._scanned||{}).forEach(st => {
              st.unexpected = (st.unexpected||[]).filter(s => s.toUpperCase() !== serial.toUpperCase());
            });
            Object.assign(rec, recs[ri]);
            DB.save();
          }
          _viewHistoricalReport(rec);
          return;
        }

        // Live report — remove from DOM and update last record
        const rowEl = document.getElementById(`audit-row-${serial.replace(/[^a-z0-9]/gi,'_')}`);
        if (rowEl) rowEl.remove();
        Object.values(_scanned||{}).forEach(st => {
          st.unexpected = (st.unexpected||[]).filter(s => s.toUpperCase() !== serial.toUpperCase());
        });
        const records = DB.getAuditRecords();
        if (records.length) {
          const last = records[records.length-1];
          last.unexpectedSerials = (last.unexpectedSerials||[]).filter(s => s.toUpperCase() !== serial.toUpperCase());
          last.unexpected = last.unexpectedSerials.length;
          Object.values(last._scanned||{}).forEach(st => {
            st.unexpected = (st.unexpected||[]).filter(s => s.toUpperCase() !== serial.toUpperCase());
          });
          DB.save();
        }
      });
    });

    // Wire NS write-off buttons (works for both live and historical reports)
    document.querySelectorAll('.audit-ns-writeoff-btn').forEach(btn => {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', () => {
        const product  = btn.dataset.product;
        const location = btn.dataset.location;
        const maxShort = parseInt(btn.dataset.short);
        const qtyInput = btn.parentElement.querySelector('.audit-ns-writeoff-qty');
        const qty = parseInt(qtyInput?.value) || 0;
        if (qty < 1 || qty > maxShort) { alert(`Enter a quantity between 1 and ${maxShort}`); return; }
        if (!confirm(`Write off ${qty} unit${qty!==1?'s':''} of "${product}" as permanently lost?\nThis removes them from inventory.`)) return;

        const now = new Date().toISOString();
        const by = Auth.getName ? Auth.getName() : (Auth.getUser()?.email || '');

        // Get actual NS serials from stock (system uses NS- prefixed serial strings)
        const nsInStock = Inventory.getAllSerialRows().filter(r =>
          r.product === product &&
          r.location === location &&
          r.status === 'in-stock' &&
          r.serial.startsWith('NS-')
        );
        const toWriteOff = nsInStock.slice(0, qty).map(r => r.serial);

        if (toWriteOff.length === 0) {
          alert('Could not find NS stock items to write off — they may already have been removed.');
          return;
        }

        DB.addMovement({
          id: Date.now(), type: 'OUT',
          product, category: '', location,
          serials: toWriteOff,
          customer: 'Lost Stock — Count Write-off',
          by, ref: `Audit write-off`,
          date: now, isLost: true,
        });

        // If this is a historical report, update the record too
        if (_report?._historicalRecord) {
          const rec = _report._historicalRecord;
          const recs = DB.getAuditRecords();
          const ri = recs.findIndex(r => r.id === rec.id);
          if (ri > -1) {
            if (!recs[ri].nsShortfalls) recs[ri].nsShortfalls = [];
            const nsIdx = recs[ri].nsShortfalls.findIndex(ns => ns.product === product && ns.location === location);
            if (nsIdx > -1) {
              const _ns = recs[ri].nsShortfalls[nsIdx];
              const _remaining = Math.max(0, _ns.short - (_ns.writtenOff||0));
              const _actualQty = Math.min(qty, _remaining);
              _ns.writtenOff = (_ns.writtenOff||0) + _actualQty;
            }
            recs[ri].lost = (recs[ri].lost||0) + qty;
            // Update missing/matched so history reflects write-offs
            const _nsTotal = (recs[ri].nsShortfalls||[]).reduce((a,ns) => a + Math.max(0,ns.short-(ns.writtenOff||0)), 0);
            const _serialMissing = (recs[ri].missingSerials||[]).filter(s=>!(recs[ri].writtenOffSerials||[]).includes(s)&&!(recs[ri].foundSerials||[]).includes(s)).length;
            recs[ri].missing = _nsTotal + _serialMissing;
            recs[ri].matched = recs[ri].expected - recs[ri].missing;
            Object.assign(rec, recs[ri]);
            DB.save();
          }
          // Refresh the historical report
          _viewHistoricalReport(rec);
        } else {
          // Live report — update lostSet count and refresh
          if (!_lostSet) _lostSet = new Set();
          const records = DB.getAuditRecords();
          if (records.length) { records[records.length-1].lost = (records[records.length-1].lost||0) + qty; DB.save(); }
          btn.textContent = `✓ ${qty} written off`;
          btn.disabled = true;
          btn.style.color = '#888';
          if (qtyInput) qtyInput.disabled = true;
        }
      });
    });
  }

  // ── write-off ─────────────────────────────────────────────────────────
  function _writeOff(serials, singleBtn) {
    const conf = singleBtn
      ? confirm(`Write off "${serials[0]}" as lost stock?\nThis removes it from inventory permanently.`)
      : true; // already confirmed by caller
    if (!conf) return;
    const now = new Date().toISOString();
    serials.forEach(serial => {
      const key  = serial.toUpperCase();
      if (_lostSet.has(key)) return;
      _lostSet.add(key);
      const info = Inventory.getAllSerialRows().find(r => r.serial.toUpperCase() === key) || {};
      DB.addMovement({
        id: Date.now() + Math.random(), type: 'OUT',
        product: info.product||'Unknown', category: info.category||'', location: info.location||'',
        serials: [serial], customer: 'Lost Stock — Count Write-off',
        by: '', ref: `Count: ${_countList.map(i=>i.product).join(', ')}`,
        date: now, isLost: true,
      });
      // Update UI
      if (singleBtn) {
        singleBtn.textContent = '✓ Written off'; singleBtn.disabled = true; singleBtn.style.color = '#888';
        const rowEl = document.getElementById(`audit-row-${serial.replace(/[^a-z0-9]/gi,'_')}`);
        if (rowEl) { rowEl.classList.remove('audit-row-missing'); const b=rowEl.querySelector('.audit-badge'); if(b){b.className='audit-badge';b.style.cssText='background:#f5d8d8;color:#9c2a00;';b.textContent='🗑 Written off';} }
      }
    });
    // Patch DB record — store writtenOffSerials and recalculate
    const records = DB.getAuditRecords();
    // Use the record linked to this report if viewing historical
    const _patchRec = _report?._historicalRecord
      ? records.find(r => r.id === _report._historicalRecord.id)
      : records[records.length-1];
    if (_patchRec) {
      if (!_patchRec.writtenOffSerials) _patchRec.writtenOffSerials = [];
      serials.forEach(s => {
        if (!_patchRec.writtenOffSerials.some(x => x.toUpperCase() === s.toUpperCase()))
          _patchRec.writtenOffSerials.push(s);
      });
      _patchRec.lost = _patchRec.writtenOffSerials.length;
      const _woSet2 = new Set(_patchRec.writtenOffSerials.map(x=>x.toUpperCase()));
      const _fSet2  = new Set((_patchRec.foundSerials||[]).map(x=>x.toUpperCase()));
      _patchRec.missing = (_patchRec.missingSerials||[]).filter(x => !_woSet2.has(x.toUpperCase()) && !_fSet2.has(x.toUpperCase())).length;
      _patchRec.matched = _patchRec.expected - _patchRec.missing;
      if (_report?._historicalRecord) Object.assign(_report._historicalRecord, _patchRec);
      DB.save();
    }
    // Clear auto-saved audit — count is complete
    const _ce = Auth.getUser()?.email; if (_ce) DB.clearPausedAudit(_ce);
  }

  // ── pause ─────────────────────────────────────────────────────────────
  function _pause() {
    // Serialise Sets to arrays for storage
    const scannedSerializable = {};
    Object.entries(_scanned).forEach(([k, v]) => {
      scannedSerializable[k] = { matched: [...v.matched], unexpected: v.unexpected };
    });

    // Calculate missing serials
    const missingSerials = [];
    _countList.forEach(item => {
      if (item.isNS) return;
      const key     = item.product + '||' + (item.location || '');
      const scanned = new Set(scannedSerializable[key]?.matched?.map(s => s.toUpperCase()) || []);
      (item.systemSerials || []).forEach(s => {
        if (!scanned.has(s.toUpperCase())) missingSerials.push({ serial: s, product: item.product, location: item.location });
      });
    });

    // Show modal with missing list — user decides whether to pause
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const groupedByProduct = {};
    missingSerials.forEach(m => {
      const k = m.product + (m.location ? ' @ ' + m.location : '');
      if (!groupedByProduct[k]) groupedByProduct[k] = [];
      groupedByProduct[k].push(m.serial);
    });

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:560px;max-height:80vh;display:flex;flex-direction:column;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>⏸ Pause count — missing serials</span>
          <button class="btn-remove-row" id="pause-modal-close">×</button>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
          ${missingSerials.length === 0
            ? '<span style="color:var(--success-text);font-weight:600;">✓ All serials accounted for — nothing missing!</span>'
            : `<strong>${missingSerials.length}</strong> serial${missingSerials.length!==1?'s':''} not yet scanned:`}
        </div>
        <div style="flex:1;overflow-y:auto;margin-bottom:14px;">
          ${missingSerials.length === 0 ? '' : Object.entries(groupedByProduct).map(([prod, serials]) => `
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;font-weight:700;color:var(--aio-purple);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${_esc(prod)}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${serials.map(s => `<span style="font-family:var(--mono);font-size:12px;background:var(--bg-hover);padding:2px 8px;border-radius:4px;border:1px solid var(--border);">${_esc(s)}</span>`).join('')}
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:12px;">
          <button class="btn btn-ghost" id="pause-modal-cancel">Keep counting</button>
          ${missingSerials.length > 0 ? '<button class="btn btn-ghost" id="pause-modal-export">📥 Export CSV</button>' : ''}
          <button class="btn btn-orange" id="pause-modal-confirm">Pause & save progress</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#pause-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#pause-modal-cancel').addEventListener('click', () => overlay.remove());

    const exportBtn = overlay.querySelector('#pause-modal-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const rows = [['Serial Number', 'Product', 'Location', 'Status']];
        missingSerials.forEach(m => rows.push([m.serial, m.product, m.location || '', 'Not scanned']));
        const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a    = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob),
          download: `missing-serials-${new Date().toISOString().slice(0,10)}.csv`,
        });
        a.click(); URL.revokeObjectURL(a.href);
      });
    }

    overlay.querySelector('#pause-modal-confirm').addEventListener('click', () => {
      overlay.remove();
      const _pe = Auth.getUser()?.email || 'unknown';
    DB.savePausedAudit(_pe, {
        countList:  _countList,
        scanned:    scannedSerializable,
        nsCounts:   _nsCounts,
        lostSet:    [..._lostSet],
        missing:    missingSerials,
        cutoff:     _cutoff,
        pausedAt:   new Date().toISOString(),
      });
      _reset();
      _checkPausedAudit();
    });
  }

  // ── cancel/reset ──────────────────────────────────────────────────────
  function _cancel() {
    if (!confirm('Cancel this count? Progress will be lost.')) return;
    _reset(true); // clear saved state on explicit cancel
  }

  function _reset(clearSaved = false) {
    // Only clear the saved audit when explicitly cancelling/completing — NOT when pausing
    if (clearSaved) { const _re = Auth.getUser()?.email; if (_re) DB.clearPausedAudit(_re); }
    _countList = []; _scanned = {}; _nsCounts = {}; _lostSet = new Set();
    _serialLookup = {}; _phase = 1; _report = null;
    const logWrap = document.getElementById('audit-scan-log-wrap');
    if (logWrap) logWrap.style.display = 'none';
    const logEl = document.getElementById('audit-scan-log');
    if (logEl) logEl.innerHTML = '';
    const logToggle = document.getElementById('btn-audit-log-toggle');
    if (logToggle) { logToggle.textContent = '▲ Hide list'; logToggle._wired = false; }
    document.getElementById('audit-setup-panel').style.display  = '';
    document.getElementById('audit-active-panel').style.display = 'none';
    document.getElementById('audit-report-panel').style.display = 'none';
    const input = document.getElementById('audit-serial-input');
    if (input) { input.disabled = false; input.value = ''; }
    const finBtn = document.getElementById('btn-finish-audit');
    if (finBtn) { finBtn.disabled = false; finBtn.textContent = 'Complete Count'; }
    _populateLocFilter();
    _populateProductPicker();
    _renderCountList();
    _renderHistory();
  }

  // ── export CSV ────────────────────────────────────────────────────────
  function _exportCSV() {
    if (!_report) return;
    const rows = [['Product','Location','Type','Serial / Group','System Qty','Physical Qty','Variance','Result','Written Off']];
    _report.productReports.forEach(pr => {
      const item = pr.item;
      if (pr.type === 'ns') {
        rows.push([item.product, item.location||'', 'No-serial', item.product, item.systemNsCount, pr.phys!=null?pr.phys:'', pr.diff!=null?pr.diff:'', pr.diff===0?'Correct':pr.diff>0?'Over':'Short', '']);
      } else {
        (pr.missing||[]).forEach(s => rows.push([item.product, item.location||'', 'Serialised', s, 1, 0, -1, 'Missing', _lostSet.has(s.toUpperCase())?'Yes':'No']));
        (pr.unexp||[]).forEach(s => rows.push([item.product, item.location||'', 'Serialised', s, 0, 1, 1, 'Unexpected', '']));
        (pr.matched||[]).forEach(s => rows.push([item.product, item.location||'', 'Serialised', s, 1, 1, 0, 'Matched', 'No']));
        if (pr.type === 'mixed') {
          rows.push([item.product, item.location||'', 'No-serial', item.product+' (NS)', item.systemNsCount, pr.phys!=null?pr.phys:'', pr.nsDiff!=null?pr.nsDiff:'', pr.nsDiff===0?'Correct':pr.nsDiff>0?'Over':'Short', '']);
        }
      }
    });
    const csv  = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const a    = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`stock-count-${new Date().toISOString().slice(0,10)}.csv`});
    a.click(); URL.revokeObjectURL(a.href);
  }

  return { init };

})();