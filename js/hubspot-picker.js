/* ─────────────────────────────────────────────────────────────────────────────
   HubspotPicker — link an inventory customer name to a HubSpot company.

   The portal has >23k companies and the browser holds no HubSpot token, so this
   is a server-backed typeahead against the hubspotCompanySearch Cloud Function
   rather than a plain <select>. If that endpoint is unreachable — not deployed,
   offline, or the caller is a viewer — the picker falls back to the manual
   Company ID box, which is how the mapping was entered before.
   ───────────────────────────────────────────────────────────────────────────── */
const HubspotPicker = (() => {
  const ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/hubspotCompanySearch';

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Inventory names carry a trailing account number — "Crema (1750)" — that
  // HubSpot doesn't have, so it only ever hurts the search term.
  function seedTerm(customer) {
    const c = String(customer || '').trim();
    return c.replace(/\s*\([^()]*\)\s*$/, '').trim() || c;
  }

  async function idToken() {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const user = getAuth().currentUser;
    if (!user) throw new Error('Not signed in');
    return user.getIdToken();
  }

  async function search(term) {
    const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(term)}`, {
      headers: { Authorization: `Bearer ${await idToken()}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Lookup failed (${res.status})`);
    }
    return (await res.json()).results || [];
  }

  function resultRow(r, selectedId) {
    const where = [r.city, r.state].filter(Boolean).join(', ');
    const meta  = [where, r.domain].filter(Boolean).join(' · ');
    return `
      <div class="hsp-row${r.id === selectedId ? ' hsp-row-sel' : ''}" data-id="${esc(r.id)}"
           style="padding:8px 10px;border:1px solid ${r.id === selectedId ? 'var(--aio-purple)' : 'var(--border-md)'};border-radius:var(--r-md);margin-bottom:6px;cursor:pointer;">
        <div style="font-size:13px;font-weight:600;">${esc(r.name)}${r.tenantId ? ` <span class="badge b-in" style="margin-left:4px;">${esc(r.tenantId)}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--text-hint);margin-top:2px;">${esc(meta || '—')} · ID ${esc(r.id)}</div>
      </div>`;
  }

  /* open({ customer, onDone }) — onDone(action) fires after the modal closes,
     with 'mapped' | 'ignored' | 'skipped'. */
  function open({ customer, onDone, context } = {}) {
    const name = String(customer || '').trim();
    if (!name) return;

    let selectedId = DB.getHubspotCompanyId(name) || '';
    let results = [];
    let timer = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="width:560px;max-height:86vh;display:flex;flex-direction:column;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Link to a HubSpot company</span>
          <button class="btn-remove-row" id="hsp-close">×</button>
        </div>
        ${context ? `<div style="font-size:13px;margin-bottom:8px;padding:8px 10px;border-radius:var(--r-md);background:var(--aio-purple-light);">✅ ${esc(context)}</div>` : ''}
        <div style="font-size:13px;margin-bottom:4px;">Customer: <strong>${esc(name)}</strong></div>
        <div style="font-size:12px;color:var(--text-hint);margin-bottom:12px;">
          Pick the matching company so deployed hardware rolls up to it in the nightly sync.
          Skipping only leaves the account unlinked — it changes nothing about the stock movement.
        </div>
        <input class="fi" id="hsp-q" placeholder="Search HubSpot companies…" value="${esc(seedTerm(name))}" autocomplete="off" />
        <div id="hsp-results" style="flex:1;overflow-y:auto;min-height:80px;max-height:34vh;margin-top:10px;"></div>
        <div style="margin-top:10px;">
          <label class="form-label" for="hsp-id" style="font-size:11px;">HubSpot Company ID</label>
          <input class="fi fi-mono" id="hsp-id" placeholder="e.g. 250498570942" value="${esc(selectedId)}" autocomplete="off" />
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;">
          <button class="btn btn-ghost" id="hsp-ignore" title="Warehouses, staff vehicles, write-off buckets — never ask again">Not a customer</button>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost" id="hsp-skip" title="Leave unlinked — you'll be asked again next time">Link later</button>
            <button class="btn btn-primary" id="hsp-save">Save</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = sel => overlay.querySelector(sel);
    const qBox = $('#hsp-q'), idBox = $('#hsp-id'), out = $('#hsp-results');

    function paint() {
      out.innerHTML = results.length
        ? results.map(r => resultRow(r, selectedId)).join('')
        : `<div style="font-size:12px;color:var(--text-hint);padding:6px 2px;">No matches — refine the search, or paste the Company ID below.</div>`;
      out.querySelectorAll('.hsp-row').forEach(row => row.addEventListener('click', () => {
        selectedId = row.dataset.id;
        idBox.value = selectedId;
        paint();
      }));
    }

    async function run() {
      const term = qBox.value.trim();
      if (term.length < 2) { results = []; paint(); return; }
      out.innerHTML = `<div style="font-size:12px;color:var(--text-hint);padding:6px 2px;">Searching…</div>`;
      try {
        results = await search(term);
        paint();
      } catch (e) {
        results = [];
        out.innerHTML = `<div style="font-size:12px;color:var(--text-hint);padding:6px 2px;">
          Company search unavailable — ${esc(e.message)}.<br>Paste the Company ID below instead (it's the number in the company's HubSpot URL).</div>`;
      }
    }

    function close(action) { overlay.remove(); if (onDone) onDone(action); }

    qBox.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
    idBox.addEventListener('input', () => { selectedId = idBox.value.trim(); paint(); });
    $('#hsp-close').addEventListener('click', () => close('skipped'));
    $('#hsp-skip').addEventListener('click',  () => close('skipped'));
    overlay.addEventListener('click', e => { if (e.target === overlay) close('skipped'); });

    $('#hsp-ignore').addEventListener('click', () => {
      DB.setHubspotIgnored(name, true);
      close('ignored');
    });

    $('#hsp-save').addEventListener('click', () => {
      const id = idBox.value.trim();
      if (!id) { alert('Pick a company, or paste its HubSpot Company ID.'); return; }
      if (!/^\d+$/.test(id)) { alert('A HubSpot Company ID is all digits.'); return; }
      DB.setHubspotCompanyId(name, id);
      DB.setHubspotIgnored(name, false);
      close('mapped');
    });

    run();
    setTimeout(() => qBox.focus(), 50);
  }

  /* Prompt only for a name we've never resolved: unmapped, not deliberately
     ignored, and only for users who are allowed to edit. */
  function promptIfUnmapped(customer, context, onDone) {
    const name = String(customer || '').trim();
    if (!name || !Auth.canEdit()) return false;
    if (DB.getHubspotCompanyId(name) || DB.isHubspotIgnored(name)) return false;
    open({ customer: name, context, onDone });
    return true;
  }

  /* ── Quotes & invoices for a linked customer (Stock Out, before scanning) ── */
  const DOCS_ENDPOINT = 'https://us-central1-aio-inventory-b9b29.cloudfunctions.net/hubspotCompanyDocs';
  const DOCS_CACHE_MS = 60 * 1000;
  const _docsCache = new Map(); // companyId -> { at, data }
  let _docsSeq = 0;

  async function loadDocs(companyId) {
    const hit = _docsCache.get(companyId);
    if (hit && Date.now() - hit.at < DOCS_CACHE_MS) return hit.data;
    const res = await fetch(`${DOCS_ENDPOINT}?companyId=${encodeURIComponent(companyId)}`, {
      headers: { Authorization: `Bearer ${await idToken()}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Lookup failed (${res.status})`);
    }
    const data = await res.json();
    _docsCache.set(companyId, { at: Date.now(), data });
    return data;
  }

  const _money = n => n == null ? '' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _date  = s => { const d = s && new Date(s); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  const _link  = (url, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--aio-purple);white-space:nowrap;">${label} ↗</a>` : '';

  function docRow(name, status, meta, publicUrl, publicLabel, hubspotUrl) {
    return `
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span style="font-weight:600;">${esc(name)}</span>
        ${status ? `<span class="badge b-in">${esc(status)}</span>` : ''}
        <span style="font-size:12px;color:var(--text-muted);">${esc(meta)}</span>
        <span style="margin-left:auto;display:flex;gap:12px;font-size:12px;">${_link(publicUrl, publicLabel)}${_link(hubspotUrl, 'Open in HubSpot')}</span>
      </div>`;
  }

  function docsHtml({ quotes = [], invoices = [] }) {
    const none = '<div style="font-size:12px;color:var(--text-hint);padding:4px 0;">None</div>';
    const q = quotes.map(d => docRow(
      [d.number, d.title].filter(Boolean).join(' · ') || `Quote ${d.id}`, d.status,
      [_money(d.amount), _date(d.date), d.expires ? `expires ${_date(d.expires)}` : ''].filter(Boolean).join(' · '),
      d.publicUrl, 'Quote page', d.hubspotUrl)).join('');
    const i = invoices.map(d => docRow(
      d.number || `Invoice ${d.id}`, d.status,
      [_money(d.amount), d.balance ? `${_money(d.balance)} due` : '', _date(d.date), d.due ? `due ${_date(d.due)}` : ''].filter(Boolean).join(' · '),
      d.publicUrl, 'Invoice page', d.hubspotUrl)).join('');
    return `
      <div class="panel-title" style="margin-bottom:4px;">HubSpot quotes</div>${q || none}
      <div class="panel-title" style="margin:12px 0 4px;">HubSpot invoices</div>${i || none}`;
  }

  /* renderDocs(el, customer) — fill `el` with the customer's quotes and invoices,
     or a prompt to link it. Hidden for a blank or "not a customer" name. */
  async function renderDocs(el, customer) {
    if (!el) return;
    const seq = ++_docsSeq;
    const name = String(customer || '').trim();
    const note = html => { el.style.display = ''; el.innerHTML = `<div style="font-size:12px;color:var(--text-hint);">${html}</div>`; };

    if (!name || DB.isHubspotIgnored(name)) { el.style.display = 'none'; el.innerHTML = ''; return; }

    const companyId = DB.getHubspotCompanyId(name);
    if (!companyId) {
      note(`“${esc(name)}” isn't linked to HubSpot, so its quotes and invoices can't be shown.
        ${Auth.canEdit() ? ' <button class="btn btn-ghost btn-xs" id="hsd-link">Link to HubSpot</button>' : ''}`);
      el.querySelector('#hsd-link')?.addEventListener('click', () =>
        open({ customer: name, onDone: () => renderDocs(el, name) }));
      return;
    }

    note('Loading quotes &amp; invoices…');
    try {
      const data = await loadDocs(companyId);
      if (seq !== _docsSeq) return; // customer changed while this was loading
      el.innerHTML = docsHtml(data);
    } catch (e) {
      if (seq !== _docsSeq) return;
      note(`Couldn't load HubSpot quotes &amp; invoices — ${esc(e.message)}.`);
    }
  }

  return { open, promptIfUnmapped, seedTerm, renderDocs };
})();
