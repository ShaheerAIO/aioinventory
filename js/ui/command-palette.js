// Cmd/Ctrl+K serial search palette. Public: CommandPalette.open / close.
window.CommandPalette = (function () {
  const MAX = 8;
  const esc = s => (typeof UI !== 'undefined' && UI._ && UI._.esc) ? UI._.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = d => { try { return (UI._.fmtDate || (x => x))(d); } catch (e) { return ''; } };

  let root = null, input = null, listEl = null, tlEl = null, prevFocus = null, timer = null;
  let results = [], total = 0, sel = 0, prevOverflow = '';

  function highlight(serial, q) {
    const s = String(serial), i = s.toUpperCase().indexOf(String(q || '').trim().toUpperCase());
    if (i < 0 || !q.trim()) return esc(s);
    const n = q.trim().length;
    return esc(s.slice(0, i)) + '<mark class="cmdk-hl">' + esc(s.slice(i, i + n)) + '</mark>' + esc(s.slice(i + n));
  }

  function pill(status) {
    if (status === 'in-stock') return ['In stock', 'stock'];
    if (status === 'in-transit') return ['In transit', 'transit'];
    if (status === 'dispatched') return ['Deployed', 'deployed'];
    return [status === 'unknown' ? 'Unknown' : String(status), 'other'];
  }

  // history movements -> [{label, date, isTransfer}] (last 5, oldest first)
  function labels(history) {
    return (history || []).slice(-5).map(m => {
      const loc = m.location || '';
      let label;
      if (m.isTransfer) label = m.type === 'IN' ? 'Transferred to ' + (loc || m.transferTo || '?') : 'Dispatched for transfer to ' + (m.transferTo || '?');
      else if (m.type === 'IN') label = 'Received' + (m.po || m.poNumber || m.ref ? ' on ' + (m.po || m.poNumber || m.ref) : '') + (loc ? ' · ' + loc : '');
      else label = 'Dispatched to ' + (m.customer || '?');
      return { label, date: m.date, isTransfer: !!m.isTransfer };
    });
  }

  function ready() {
    try {
      if (!(typeof Auth !== 'undefined' && Auth.getProfile && Auth.getProfile())) return false;
      return !!(typeof DB !== 'undefined' && DB.getData && DB.getData() && Inventory && Inventory.searchSerials);
    } catch (e) { return false; }
  }

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

  function build() {
    root = document.createElement('div');
    root.className = 'cmdk-backdrop';
    root.innerHTML = '<div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Find a serial">' +
      '<div class="cmdk-search"><span class="cmdk-ico">' + ICON + '</span>' +
      '<input class="cmdk-input" type="text" autocomplete="off" spellcheck="false" placeholder="Find a serial — type any part of it">' +
      '<kbd class="cmdk-kbd">⌘K</kbd></div>' +
      '<div class="cmdk-body"><div class="cmdk-list"></div><div class="cmdk-tl"></div></div></div>';
    document.body.appendChild(root);
    input = root.querySelector('.cmdk-input');
    listEl = root.querySelector('.cmdk-list');
    tlEl = root.querySelector('.cmdk-tl');
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!results.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        paint(true);
      } else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) go(results[sel].serial); }
    });
    listEl.addEventListener('click', e => { const r = e.target.closest('.cmdk-row'); if (r) go(r.dataset.serial); });
    listEl.addEventListener('mousemove', e => {
      const r = e.target.closest('.cmdk-row');
      if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; paint(false); }
    });
  }

  function search() {
    const q = input.value.trim();
    results = []; total = 0; sel = 0;
    if (q.length < 2) { listEl.innerHTML = ''; tlEl.innerHTML = ''; return; }
    let all = [];
    try { all = Inventory.searchSerials(q); } catch (e) {}
    total = all.length;
    results = all.slice(0, MAX).map(serial => ({ serial, info: Inventory.getSerialInfo(serial) }));
    paint(false);
  }

  function paint(scroll) {
    const q = input.value.trim();
    if (!results.length) {
      listEl.innerHTML = q.length < 2 ? '' : '<div class="cmdk-empty">No serial matching “' + esc(q) + '”</div>';
      tlEl.innerHTML = ''; return;
    }
    listEl.innerHTML = results.map((r, i) => {
      const p = pill(r.info.status);
      const sub = [r.info.currentProduct, r.info.status === 'dispatched' ? r.info.deployedTo : r.info.currentLocation].filter(Boolean).join(' · ');
      return '<div class="cmdk-row' + (i === sel ? ' is-sel' : '') + '" data-i="' + i + '" data-serial="' + esc(r.serial) + '">' +
        '<div class="cmdk-main"><div class="cmdk-serial">' + highlight(r.serial, q) + '</div><div class="cmdk-sub">' + esc(sub || '—') + '</div></div>' +
        '<span class="cmdk-pill cmdk-pill-' + p[1] + '">' + esc(p[0]) + '</span></div>';
    }).join('') + (total > MAX ? '<div class="cmdk-more">+' + (total - MAX) + ' more</div>' : '');
    const cur = results[sel], ev = labels(cur.info.history);
    tlEl.innerHTML = ev.length ? '<div class="cmdk-tl-title">History</div><ol class="cmdk-tline">' + ev.map((e, i) =>
      '<li class="' + (i === ev.length - 1 ? 'is-now' : '') + '"><span class="cmdk-dot"></span><div class="cmdk-ev">' + esc(e.label) +
      '</div><div class="cmdk-date">' + esc(fmt(e.date)) + '</div></li>').join('') + '</ol>' : '';
    if (scroll) { const el = listEl.querySelector('.is-sel'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
  }

  function go(serial) {
    close();
    location.hash = '#lookup';
    setTimeout(() => {
      const el = document.getElementById('lookup-input');
      if (el) el.value = serial;
      if (typeof UI !== 'undefined' && UI.renderLookup) UI.renderLookup(serial);
    }, 60);
  }

  function open() {
    if (root && root.classList.contains('is-open')) return;
    if (!ready()) return;
    if (!root) build();
    prevFocus = document.activeElement;
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.value = ''; results = []; listEl.innerHTML = ''; tlEl.innerHTML = '';
    root.classList.add('is-open');
    input.focus();
  }

  function close() {
    if (!root || !root.classList.contains('is-open')) return;
    clearTimeout(timer);
    root.classList.remove('is-open');
    document.body.style.overflow = prevOverflow;
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
  }

  if (typeof document !== 'undefined') document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if (root && root.classList.contains('is-open')) close(); else open();
    } else if (e.key === 'Escape' && root && root.classList.contains('is-open')) { e.preventDefault(); close(); }
  });

  return { open, close, _labels: labels, _highlight: highlight, _pill: pill };
})();
