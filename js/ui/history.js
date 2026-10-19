/**
 * ui/history.js — Movement History view
 */
(() => {
  const { _dlCSV, esc, fmtDateFull } = UI._;

  // ── History ───────────────────────────────────────────────────────────
  function renderHistory() {
    const search   = (document.getElementById('hist-search').value || '').trim().toLowerCase();
    const typeF    = document.getElementById('hist-type-filter').value;
    const catF     = document.getElementById('hist-cat-filter').value;
    const dateFrom = document.getElementById('hist-date-from').value;
    const dateTo   = document.getElementById('hist-date-to').value;
    const { movements } = DB.getData();

    let rows = [...movements].reverse().filter(m => {
      const mt = !typeF  || (typeF === 'TRANSFER' ? m.isTransfer === true
                                                  : (m.type === typeF && !m.isTransfer));
      const mc = !catF   || m.category === catF;
      const ms = !search || m.product.toLowerCase().includes(search) || (m.customer||'').toLowerCase().includes(search) || (m.supplier||'').toLowerCase().includes(search) || (m.ref||'').toLowerCase().includes(search) || (m.location||'').toLowerCase().includes(search) || (m.receivedBy||'').toLowerCase().includes(search) || m.serials.some(s => s.toLowerCase().includes(search));
      const mdf= !dateFrom || m.date.slice(0,10) >= dateFrom;
      const mdt= !dateTo   || m.date.slice(0,10) <= dateTo;
      return mt && mc && ms && mdf && mdt;
    });

    // A location transfer writes an OUT + IN pair, so it is counted on its own —
    // nothing was received from a supplier or dispatched to a customer.
    const totalIn  = rows.filter(m => m.type==='IN'  && !m.isTransfer).reduce((a,m) => a+m.serials.length, 0);
    const totalOut = rows.filter(m => m.type==='OUT' && !m.isTransfer).reduce((a,m) => a+m.serials.length, 0);
    const totalTrf = rows.filter(m => m.type==='IN'  &&  m.isTransfer).reduce((a,m) => a+m.serials.length, 0);
    document.getElementById('hist-summary').textContent = rows.length
      ? `${rows.length} movement${rows.length!==1?'s':''} · ${totalIn} received · ${totalOut} dispatched` +
        (totalTrf ? ` · ${totalTrf} transferred` : '')
      : '';

    const tbody = document.getElementById('hist-body');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty">No movements found</div></td></tr>'; return; }
    tbody.innerHTML = rows.map((m, i) => {
      const isTrf   = m.isTransfer === true;
      const party   = isTrf
        ? (m.type==='IN' ? `from ${m.transferFrom||'?'}` : `to ${m.transferTo||'?'}`)
        : (m.type==='IN' ? (m.supplier||'—') : (m.customer||'—'));
      const preview = m.serials.slice(0,3).join(', ') + (m.serials.length>3 ? ` +${m.serials.length-3}` : '');
      const actor = m.type==='IN' ? (m.receivedBy||'—') : (m.by||'—');
      const dl = m.serials.length ? `<button class="btn btn-ghost btn-sm batch-dl" data-idx="${i}" title="Download all ${m.serials.length} serial number${m.serials.length!==1?'s':''} as CSV" style="margin-left:8px;white-space:nowrap;">⬇ CSV</button>` : '';
      return `<tr title="${esc(m.serials.join(', '))}">
        <td style="color:var(--text-hint)">${fmtDateFull(m.date)}</td>
        <td><span class="badge ${m.type==='IN'?'b-in':'b-out'}">${m.type}</span>${isTrf?'<span class="badge b-transfer" style="margin-left:4px;">⇄ TRF</span>':''}</td>
        <td style="font-weight:500">${esc(m.product)}</td>
        <td><span class="cat-badge">${esc(m.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(m.location||'—')}</span></td>
        <td>${m.serials.length}</td>
        <td>${esc(party)}</td>
        <td style="font-size:12px;color:var(--text-muted)">${esc(actor)}</td>
        <td class="serial-mono"><span>${esc(preview)}</span>${dl}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button.batch-dl').forEach(btn => {
      btn.addEventListener('click', () => downloadBatchSerials(rows[parseInt(btn.dataset.idx, 10)]));
    });
  }

  function downloadBatchSerials(m) {
    if (!m || !m.serials.length) return;
    const csvRows = [['Serial Number'], ...m.serials.map(s => [s])];
    const safe = (m.product || 'batch').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    _dlCSV(csvRows, `serials_${safe}_${(m.date || '').slice(0,10)}.csv`);
  }

  function exportHistoryCSV() {
    const { movements } = DB.getData();
    const rows = [['Date','Type','Product','Category','Location','Qty','Supplier / Customer','Received By','Reference','Serials']];
    [...movements].reverse().forEach(m => rows.push([fmtDateFull(m.date), m.isTransfer ? m.type + ' (transfer)' : m.type, m.product, m.category||'', m.location||'', m.serials.length, m.type==='IN'?(m.supplier||''):(m.customer||''), m.type==='IN'?(m.receivedBy||''):(m.by||''), m.ref||'', m.serials.join(' | ')]));
    _dlCSV(rows, 'aio_history.csv');
  }

  Object.assign(UI, { renderHistory, exportHistoryCSV });
})();
