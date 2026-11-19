/* ─────────────────────────────────────────────────────────────────────────────
   RFQ — request for quotation, from an approved forecast count.

     1. Someone with Forecast access submits the products and quantities to buy
        (Forecast → Submit for RFQ). Defaults are each product's Needed number.
     2. An admin approves or rejects the request.
     3. An editor opens the RFQ editor on an approved request, edits vendor, dates,
        terms, lines and notes against a live preview, and issues it: the preview
        is turned into a PDF (html2pdf, loaded on first use), uploaded to Firebase
        Storage, and listed here for everyone to open.

   The document layout is ported from the team's standalone AIO Procurement Tool.
   Vendor details come from the Suppliers records. Requests live in `rfqs` on the
   main doc (DB.addRfq / updateRfq). Admin-only approval is enforced in the UI only:
   firestore.rules lets every editor write the main doc.
   ───────────────────────────────────────────────────────────────────────────── */
const RFQ = (() => {
  const HTML2PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  const SHIP_TO = { name: 'AIO APP INC', address: '6489 Camden Avenue, San Jose CA 95120, United States' };
  const DEFAULT_NOTES = 'Please quote unit price, MOQ, lead time and shipping cost for each line.';
  const DUE_DAYS = 14;

  function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  const pad2 = n => String(n).padStart(2, '0');
  const isoLocal = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  function addDays(iso, days) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + days); return isoLocal(dt); }
  function fmtDate(iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return ''; const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
  const norm = s => String(s || '').trim().toLowerCase();

  // ── pure helpers (tested in test/rfq.test.js) ──────────────────────────
  // Forecast rows → request lines: every product with something Needed.
  function requestLinesFromForecast(rows) {
    return (rows || []).filter(r => r.needed > 0)
      .map(r => ({ product: r.product, qty: r.needed, needed: r.needed, zone: r.zone || '' }));
  }

  // Next number in the tool's RFQ-AIO-001 sequence, after the highest issued.
  function nextNumber(rfqs) {
    const max = (rfqs || []).reduce((m, r) => {
      const x = /^RFQ-AIO-(\d+)$/.exec(r.number || '');
      return x ? Math.max(m, Number(x[1])) : m;
    }, 0);
    return 'RFQ-AIO-' + String(max + 1).padStart(3, '0');
  }

  // First draft of the document for an approved request. The vendor is the lines'
  // shared default supplier (Products → supplier); left blank when they differ.
  function draftFromRequest(req, supplierRecords, productRecords, today) {
    const supOf = p => (productRecords || []).find(r => norm(r.name) === norm(p))?.supplier || '';
    const sups = [...new Set((req.lines || []).map(l => supOf(l.product)).filter(Boolean).map(norm))];
    const supplier = sups.length === 1 ? supOf(req.lines.find(l => norm(supOf(l.product)) === sups[0]).product) : '';
    const rec = supplierRecord(supplier, supplierRecords);
    return {
      supplier,
      docDate: today,
      dueDate: addDays(today, DUE_DAYS),
      currency: ['RMB', 'CNY'].includes(String(rec?.currency || '').trim().toUpperCase()) ? 'RMB' : 'USD',
      incoterms: '',
      payment: rec?.paymentTerms || '',
      notes: DEFAULT_NOTES,
      lines: (req.lines || []).map(l => ({ product: l.product, desc: '', qty: l.qty })),
    };
  }

  function supplierRecord(name, records) {
    return name ? (records || []).find(r => norm(r.name) === norm(name)) || null : null;
  }

  // Who may do what to a request in a given status. role: superadmin|admin|edit|view
  function canTransition(status, action, role) {
    const admin = role === 'superadmin' || role === 'admin';
    const editor = admin || role === 'edit';
    if (status === 'pending')  return (action === 'approve' || action === 'reject') && admin;
    if (status === 'approved') return (action === 'saveDraft' || action === 'issue') && editor;
    return false;
  }

  // Problems to confirm before issuing (from the tool's export checks).
  function issueWarnings(d) {
    const w = [], lines = (d.lines || []).filter(l => String(l.product || l.desc || '').trim());
    if (!d.supplier) w.push('No vendor is selected.');
    if (!lines.length) w.push('There are no line items.');
    if (lines.some(l => !(Number(l.qty) > 0))) w.push('A line has a quantity of 0.');
    if (d.dueDate && d.docDate && d.dueDate < d.docDate) w.push('The quote due date is before the document date.');
    return w;
  }

  // ── state ──────────────────────────────────────────────────────────────
  let _editing = null;   // { id, draft } while the RFQ editor is open
  let _busy = false;

  const root = () => document.getElementById('rfq-root');
  const role = () => Auth.getProfile()?.role || 'view';
  const me = () => { const p = Auth.getProfile() || {}; return { name: p.name || p.email || '', email: p.email || '' }; };
  const byId = id => DB.getRfqs().find(r => r.id === id);

  // ── actions ────────────────────────────────────────────────────────────
  function submit(lines, quarter, note) {
    const clean = lines.filter(l => l.qty > 0);
    if (!clean.length) throw new Error('Pick at least one product with a quantity.');
    const r = { id: Date.now(), status: 'pending', quarter, lines: clean, note: note || '', submittedBy: me(), submittedAt: new Date().toISOString() };
    DB.addRfq(r);
    updateBadge();
    return r;
  }

  function act(id, action, changes) {
    const r = byId(id);
    if (!r || !canTransition(r.status, action, role())) { UI.showAlert('That RFQ has changed — refresh and try again.', 'error'); return false; }
    DB.updateRfq(id, changes);
    updateBadge();
    return true;
  }

  function approve(id) {
    if (act(id, 'approve', { status: 'approved', reviewedBy: me(), reviewedAt: new Date().toISOString() })) { UI.showAlert('Approved — an editor can now create the RFQ.', 'success'); render(); }
  }

  function reject(id) {
    const reason = prompt('Why is this count rejected? (shown to the submitter)');
    if (reason === null) return;
    if (act(id, 'reject', { status: 'rejected', rejectReason: reason.trim(), reviewedBy: me(), reviewedAt: new Date().toISOString() })) { UI.showAlert('Rejected.', 'success'); render(); }
  }

  // ── list view ──────────────────────────────────────────────────────────
  function updateBadge() {
    const el = document.getElementById('rfq-count-badge');
    if (!el || typeof Auth === 'undefined') return;
    const rs = DB.getRfqs(), r = role();
    const n = rs.filter(x => (x.status === 'pending' && canTransition('pending', 'approve', r)) ||
                             (x.status === 'approved' && canTransition('approved', 'issue', r))).length;
    el.textContent = n || '';
  }

  const zoneChip = z => z ? `<span class="fc-zone fc-zone-${esc(z)}">${z === 'red' ? 'Red' : z === 'amber' ? 'Amber' : 'OK'}</span>` : '';
  const who = p => esc(p?.name || p?.email || '—');
  const when = iso => iso ? new Date(iso).toLocaleString() : '';

  function requestCard(r) {
    const r0 = role();
    const actions = r.status === 'pending'
      ? (canTransition('pending', 'approve', r0)
          ? `<button class="btn btn-primary btn-sm" data-rfq-approve="${r.id}">Approve</button><button class="btn btn-ghost btn-sm" data-rfq-reject="${r.id}">Reject</button>`
          : '<span class="hint">Waiting for an admin</span>')
      : (canTransition('approved', 'issue', r0)
          ? `<button class="btn btn-primary btn-sm" data-rfq-edit="${r.id}">Open RFQ editor</button>`
          : '<span class="hint">Waiting for an editor to issue</span>');
    return `<div class="rfq-card">
      <div class="rfq-card-head">
        <div><b>${esc((r.quarter || '').replace('-', ' ')) || 'Forecast'} count</b>
          <span class="hint"> · ${r.lines.length} product${r.lines.length !== 1 ? 's' : ''} · submitted by ${who(r.submittedBy)} ${esc(when(r.submittedAt))}</span>
          ${r.status === 'approved' ? `<div class="hint">Approved by ${who(r.reviewedBy)} ${esc(when(r.reviewedAt))}</div>` : ''}</div>
        <div class="rfq-card-actions">${actions}</div>
      </div>
      <table class="rfq-lines"><thead><tr><th>Product</th><th>Qty</th><th>Needed</th><th></th></tr></thead>
        <tbody>${r.lines.map(l => `<tr><td>${esc(l.product)}</td><td><b>${l.qty}</b></td><td>${l.needed ?? '—'}</td><td>${zoneChip(l.zone)}</td></tr>`).join('')}</tbody></table>
      ${r.note ? `<div class="hint" style="margin-top:6px;">Note: ${esc(r.note)}</div>` : ''}
    </div>`;
  }

  function render() {
    const el = root();
    if (!el) return;
    updateBadge();
    if (_editing) { if (!el.querySelector('#rfq-editor')) drawEditor(); return; }
    const rs = DB.getRfqs().slice().sort((a, b) => b.id - a.id);
    const pending = rs.filter(r => r.status === 'pending');
    const approved = rs.filter(r => r.status === 'approved');
    const issued = rs.filter(r => r.status === 'issued');
    const rejected = rs.filter(r => r.status === 'rejected');
    const section = (title, list, empty) => `<div class="panel" style="margin-bottom:1rem;">
      <div class="panel-title">${title} <span class="hint">${list.length || ''}</span></div>
      ${list.length ? list.map(requestCard).join('') : `<div class="empty">${empty}</div>`}</div>`;
    el.innerHTML =
      section('Awaiting approval', pending, 'No counts waiting. Submit one from Integrations → Forecast.') +
      section('Approved — ready to issue', approved, 'Nothing approved waiting to be issued.') +
      `<div class="panel" style="margin-bottom:1rem;"><div class="panel-title">Issued RFQs <span class="hint">${issued.length || ''}</span></div>
        ${issued.length ? `<div class="table-wrap"><table>
          <thead><tr><th>RFQ</th><th>Vendor</th><th>Date</th><th>Lines</th><th>Issued by</th><th>PDF</th></tr></thead>
          <tbody>${issued.map(r => `<tr><td><b>${esc(r.number)}</b></td><td>${esc(r.draft?.supplier)}</td><td>${esc(fmtDate(r.draft?.docDate))}</td>
            <td>${(r.draft?.lines || []).length}</td><td>${who(r.issuedBy)}<div class="hint">${esc(when(r.issuedAt))}</div></td>
            <td>${r.pdf?.url ? `<a href="${esc(r.pdf.url)}" target="_blank" rel="noopener">${esc(r.pdf.name)}</a>` : '—'}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">No RFQs issued yet.</div>'}</div>` +
      (rejected.length ? `<details class="panel"><summary style="cursor:pointer;font-weight:600;">Rejected (${rejected.length})</summary>
        ${rejected.map(r => `<div class="rfq-card"><b>${esc((r.quarter || '').replace('-', ' '))} count</b>
          <span class="hint"> · ${r.lines.map(l => `${l.qty} × ${esc(l.product)}`).join(', ')} · by ${who(r.submittedBy)}</span>
          <div class="hint">Rejected by ${who(r.reviewedBy)} ${esc(when(r.reviewedAt))}${r.rejectReason ? `: ${esc(r.rejectReason)}` : ''}</div></div>`).join('')}</details>` : '');

    el.querySelectorAll('[data-rfq-approve]').forEach(b => b.addEventListener('click', () => approve(Number(b.dataset.rfqApprove))));
    el.querySelectorAll('[data-rfq-reject]').forEach(b => b.addEventListener('click', () => reject(Number(b.dataset.rfqReject))));
    el.querySelectorAll('[data-rfq-edit]').forEach(b => b.addEventListener('click', () => openEditor(Number(b.dataset.rfqEdit))));
  }

  // ── editor ─────────────────────────────────────────────────────────────
  function openEditor(id) {
    const r = byId(id);
    if (!r) return;
    const draft = r.draft ? JSON.parse(JSON.stringify(r.draft))
      : draftFromRequest(r, DB.getSupplierRecords(), DB.getProductRecords(), isoLocal(new Date()));
    if (!draft.lines.length) draft.lines.push({ product: '', desc: '', qty: 1 });
    _editing = { id, draft };
    drawEditor();
  }

  function closeEditor() { _editing = null; _fitObserver?.disconnect(); render(); }

  // Vendor contact lines under the name. In the editor the name is a dropdown.
  function addressHtml(name, rec, nameHtml) {
    if (!name && !nameHtml) return '<div class="empty">Not selected</div>';
    let h = nameHtml || `<div class="n">${esc(name)}</div>`;
    if (rec?.address) h += `<div>${esc(rec.address)}</div>`;
    if (rec?.contactName) h += `<div class="c">${esc(rec.contactName)}</div>`;
    if (rec?.phone) h += `<div>${esc(rec.phone)}</div>`;
    if (rec?.email) h += `<div class="e">${esc(rec.email)}</div>`;
    return h;
  }

  function vendorOptions(d) {
    const vendors = [...new Set([...DB.getSupplierRecords().map(s => s.name), ...Inventory.getSuppliers()].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (d.supplier && !vendors.includes(d.supplier)) vendors.unshift(d.supplier);
    return vendors;
  }

  // The document itself: the tool's RFQ layout. With edit = true every field the
  // editor owns is an input styled as document text (the page *is* the editor);
  // without it, plain text — what goes into the PDF.
  function paperHtml(d, number, edit = false) {
    const rec = supplierRecord(d.supplier, DB.getSupplierRecords());
    const lines = edit ? d.lines : d.lines.filter(l => String(l.product || l.desc || '').trim());
    const txt = (k, ph) => edit ? `<input class="ed" data-f="${k}" value="${esc(d[k])}" placeholder="${esc(ph)}">` : esc(d[k]);
    const date = k => edit ? `<input class="ed ed-c" type="date" data-f="${k}" value="${esc(d[k])}">` : esc(fmtDate(d[k]));
    const vendorSel = `<select class="ed ed-vendor n" data-vendor><option value="">Select vendor…</option>${vendorOptions(d).map(v => `<option${v === d.supplier ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const row = (l, i) => edit
      ? `<tr><td class="no">${i + 1}</td>
          <td class="l sku"><input class="ed" list="rfq-products" data-l="${i}" data-k="product" value="${esc(l.product)}" placeholder="Product"></td>
          <td class="l desc"><textarea class="ed" rows="1" data-l="${i}" data-k="desc" placeholder="Description / spec (optional)">${esc(l.desc)}</textarea></td>
          <td><input class="ed ed-c" type="number" min="0" step="1" data-l="${i}" data-k="qty" value="${esc(l.qty)}"></td>
          <td class="d-ctl"><button type="button" data-up="${i}" title="Move up" ${i ? '' : 'disabled'}>↑</button><button type="button" data-del="${i}" title="Remove line">×</button></td></tr>`
      : `<tr><td class="no">${i + 1}</td><td class="l sku">${esc(l.product)}</td><td class="l desc">${esc(l.desc)}</td><td>${Number(l.qty) || 0}</td></tr>`;
    const showNotes = edit || String(d.notes || '').trim();
    return `<div>
      <div class="d-head">
        <div class="d-logo"><img src="assets/aio-mark.svg" alt="AIO"></div>
        <div><h1 class="d-title">Request for Quotation</h1>
          <div class="d-co">${esc(SHIP_TO.name)}</div>
          <div class="d-co-addr">6489 Camden Avenue<br>San Jose CA 95120<br>United States</div></div>
      </div>
      <div class="d-parties">
        <div><h3 class="d-h">Ship to</h3><div class="d-addr">${addressHtml(SHIP_TO.name, { address: SHIP_TO.address })}</div></div>
        <div><h3 class="d-h">Vendor details</h3><div class="d-addr">${addressHtml(d.supplier, rec, edit ? vendorSel : '')}</div></div>
      </div>
      <table class="d-table d-meta">
        <thead><tr><th>RFQ #</th><th>Buyer</th><th>Currency</th><th>Date</th><th>Quote Due By</th></tr></thead>
        <tbody><tr><td>${esc(number)}</td><td>${esc(me().name)}</td>
          <td>${edit ? `<select class="ed ed-c" data-f="currency">${['USD', 'RMB'].map(c => `<option${c === d.currency ? ' selected' : ''}>${c}</option>`).join('')}</select>` : esc(d.currency)}</td>
          <td>${date('docDate')}</td><td>${date('dueDate')}</td></tr></tbody>
      </table>
      <table class="d-table d-items">
        <thead><tr><th style="width:5%">#</th><th style="width:30%">Product</th><th style="width:50%">Description</th><th style="width:15%">Qty</th>${edit ? '<th class="d-ctl"></th>' : ''}</tr></thead>
        <tbody>${lines.length ? lines.map(row).join('') : '<tr class="empty-row"><td colspan="4">No line items yet</td></tr>'}</tbody>
      </table>
      ${edit ? '<button type="button" class="d-add" data-add>+ Add line</button>' : ''}
    </div>
    <div class="d-foot">
      ${showNotes ? `<div><span class="d-chip">Notes</span><div class="d-notes">${edit ? `<textarea class="ed" rows="2" data-f="notes" placeholder="Notes for the vendor (optional)">${esc(d.notes)}</textarea>` : esc(d.notes)}</div></div>` : ''}
      <div class="d-terms">
        <div class="d-term"><span>Payment Terms</span><b>${txt('payment', 'e.g. 30% deposit, 70% before shipment')}</b></div>
        <div class="d-term"><span>Incoterms</span><b>${txt('incoterms', 'e.g. FOB Shenzhen')}</b></div>
      </div>
    </div>`;
  }

  // Text boxes on the page grow with their text (CSS field-sizing; this covers Safari).
  const grow = t => { if (t.tagName === 'TEXTAREA' && !CSS.supports('field-sizing', 'content')) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; } };

  function drawPreview() {
    const p = document.getElementById('rfq-paper');
    if (!p) return;
    p.innerHTML = paperHtml(_editing.draft, nextNumber(DB.getRfqs()), true);
    p.querySelectorAll('textarea.ed').forEach(grow);
  }

  // Zoom the A4 paper down to the canvas width (never up), re-fitting when the canvas resizes.
  let _fitObserver = null;
  function fitPreview() {
    const canvas = document.querySelector('.rfq-canvas'), paper = document.getElementById('rfq-paper');
    if (!canvas || !paper) return;
    const fit = () => {
      const cs = getComputedStyle(canvas);
      const avail = canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      paper.style.zoom = Math.min(1, avail / parseFloat(getComputedStyle(paper).width)).toFixed(3); // computed width stays 210mm whatever the zoom
    };
    _fitObserver?.disconnect();
    _fitObserver = new ResizeObserver(fit);
    _fitObserver.observe(canvas);
    fit();
  }

  function drawEditor() {
    const el = root(), d = _editing.draft;
    const products = Inventory.PRODUCTS.map(p => p.name).filter(n => n !== 'Other');
    el.innerHTML = `<div id="rfq-editor">
      <div class="rfq-bar">
        <button class="btn btn-ghost btn-sm" id="rfq-back">← Back</button>
        <div class="hint" id="rfq-status">Click any field on the page to edit it. Vendor address and contact come from Catalog → Suppliers.</div>
        <button class="btn btn-ghost btn-sm" id="rfq-save">Save draft</button>
        <button class="btn btn-primary btn-sm" id="rfq-issue" title="Saves the PDF here for everyone and downloads a copy">Generate PDF &amp; issue</button>
      </div>
      <datalist id="rfq-products">${products.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="rfq-canvas"><div id="rfq-paper" class="rfq-paper"></div></div>
    </div>`;
    drawPreview();
    fitPreview();

    const paper = el.querySelector('#rfq-paper');
    // Typing only updates the draft — re-rendering would steal focus. Structural
    // changes (vendor, add / move / remove a line) redraw the page.
    paper.addEventListener('input', e => {
      const t = e.target;
      grow(t);
      if (t.dataset.f) d[t.dataset.f] = t.value;
      else if (t.dataset.l != null) {
        const l = d.lines[Number(t.dataset.l)];
        l[t.dataset.k] = t.dataset.k === 'qty' ? (parseInt(t.value) || 0) : t.value;
      }
    });
    paper.addEventListener('change', e => {
      if (!e.target.matches('[data-vendor]')) return;
      d.supplier = e.target.value;
      const rec = supplierRecord(d.supplier, DB.getSupplierRecords());
      if (rec?.paymentTerms && !d.payment) d.payment = rec.paymentTerms;
      drawPreview();
    });
    paper.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add != null) d.lines.push({ product: '', desc: '', qty: 1 });
      else if (b.dataset.del != null) {
        d.lines.splice(Number(b.dataset.del), 1);
        if (!d.lines.length) d.lines.push({ product: '', desc: '', qty: 1 });
      } else if (b.dataset.up != null) {
        const i = Number(b.dataset.up);
        [d.lines[i - 1], d.lines[i]] = [d.lines[i], d.lines[i - 1]];
      } else return;
      drawPreview();
    });
    el.querySelector('#rfq-back').addEventListener('click', closeEditor);
    el.querySelector('#rfq-save').addEventListener('click', () => {
      if (act(_editing.id, 'saveDraft', { draft: JSON.parse(JSON.stringify(d)) })) UI.showAlert('Draft saved.', 'success');
    });
    el.querySelector('#rfq-issue').addEventListener('click', issue);
  }

  function loadHtml2pdf() {
    if (window.html2pdf) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HTML2PDF_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error('the PDF engine did not load — check your connection'));
      document.head.appendChild(s);
    });
  }

  async function issue() {
    if (_busy || !_editing) return;
    const { id, draft } = _editing;
    const r = byId(id);
    if (!r || !canTransition(r.status, 'issue', role())) { UI.showAlert('This RFQ can no longer be issued — it may already have been.', 'error'); return; }
    const w = issueWarnings(draft);
    if (w.length && !confirm('Check before issuing:\n\n• ' + w.join('\n• ') + '\n\nIssue anyway?')) return;

    _busy = true;
    const status = document.getElementById('rfq-status'), btn = document.getElementById('rfq-issue');
    btn.disabled = true;
    try {
      status.textContent = 'Generating PDF…';
      await loadHtml2pdf();
      const number = nextNumber(DB.getRfqs());
      const paper = document.getElementById('rfq-paper');
      paper.innerHTML = paperHtml(draft, number);
      paper.classList.add('exporting');
      let blob;
      try {
        blob = await window.html2pdf().set({
          margin: 0, filename: `${number}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' },
        }).from(paper).outputPdf('blob');
      } finally { paper.classList.remove('exporting'); }

      status.textContent = 'Saving PDF…';
      const pdf = await DB.uploadDocument('rfq', id, new File([blob], `${number}.pdf`, { type: 'application/pdf' }));
      DB.updateRfq(id, { status: 'issued', number, pdf, draft: JSON.parse(JSON.stringify(draft)), issuedBy: me(), issuedAt: new Date().toISOString() });

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${number}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);

      _editing = null;
      render();
      UI.showAlert(`${number} issued and saved.`, 'success');
    } catch (e) {
      status.textContent = '';
      if (_editing) drawPreview();  // put the editable page back
      UI.showAlert(`Couldn't issue the RFQ: ${e.message}`, 'error');
    } finally {
      _busy = false;
      if (btn.isConnected) btn.disabled = false;
    }
  }

  // ── submit modal (opened from the Forecast) ────────────────────────────
  function openSubmit(rows, quarter) {
    const lines = requestLinesFromForecast(rows);
    if (!lines.length) { UI.showAlert('Nothing is Needed in this forecast — there is no count to submit.', 'error'); return; }
    const dup = DB.getRfqs().some(r => r.status === 'pending' && r.quarter === quarter);
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-box" style="width:560px;max-height:90vh;overflow-y:auto;">
      <div class="modal-title">Submit count for RFQ</div>
      <div class="hint" style="margin-bottom:10px;">Forecast for ${esc(quarter.replace('-', ' '))}. An admin approves it, then an editor creates the RFQ. Untick anything not to quote, or change a quantity.</div>
      ${dup ? '<div class="alert alert-error show" style="margin:0 0 10px;">A count for this quarter is already waiting for approval.</div>' : ''}
      <table class="rfq-lines"><thead><tr><th></th><th>Product</th><th>Needed</th><th>Qty to quote</th><th></th></tr></thead>
        <tbody>${lines.map((l, i) => `<tr><td><input type="checkbox" data-on="${i}" checked></td><td>${esc(l.product)}</td><td>${l.needed}</td>
          <td><input class="fi" type="number" min="0" step="1" data-qty="${i}" value="${l.qty}" style="width:90px;"></td><td>${zoneChip(l.zone)}</td></tr>`).join('')}</tbody></table>
      <div class="form-group" style="margin-top:10px;"><label class="form-label">Note for the approver (optional)</label><textarea class="fi" rows="2" id="rfq-sub-note"></textarea></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="rfq-sub-cancel">Cancel</button><button class="btn btn-primary" id="rfq-sub-ok">Submit for approval</button></div>
    </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#rfq-sub-cancel').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#rfq-sub-ok').addEventListener('click', () => {
      const picked = lines.filter((l, i) => ov.querySelector(`[data-on="${i}"]`).checked)
        .map(l => ({ ...l, qty: parseInt(ov.querySelector(`[data-qty="${lines.indexOf(l)}"]`).value) || 0 }));
      try {
        submit(picked, quarter, ov.querySelector('#rfq-sub-note').value.trim());
        close();
        UI.showAlert('Submitted — it is waiting for an admin under Orders → RFQs.', 'success');
      } catch (e) { UI.showAlert(e.message, 'error'); }
    });
  }

  return { render, updateBadge, openSubmit, submit,
    requestLinesFromForecast, nextNumber, draftFromRequest, canTransition, issueWarnings };
})();
