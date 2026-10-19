/**
 * ui/rma.js — RMA view
 */
(() => {
  const { esc, fmtDate } = UI._;

  // ── RMA view ───────────────────────────────────────────────────────────
  function renderRMA() {
    const search  = (document.getElementById('rma-search')?.value || '').trim().toLowerCase();
    const statusF = document.getElementById('rma-status-filter')?.value || '';

    // Build full RMA list — serials that were ever flagged as RMA
    const { movements } = DB.getData();
    const serialInMovement = {};
    movements.forEach(mv => {
      if (mv.type === 'IN') mv.serials.forEach(s => { serialInMovement[s.toUpperCase()] = mv; });
    });

    // All serials currently flagged rma and still in stock = "To Return"
    const inStockRMA = Inventory.getAllSerialRows().filter(r => r.condition === 'rma');

    // Serials that were ever rma but are no longer in stock = "Returned"
    const availableSet = Inventory.getAvailableSerials();
    const returnedRMA = [];
    Object.entries(serialInMovement).forEach(([serial, mv]) => {
      if (mv.condition === 'rma' && !availableSet.has(serial)) {
        // Find the OUT movement for this serial
        const outMv = [...movements].reverse().find(m => m.type === 'OUT' && !m.isTransfer && m.serials.some(s => s.toUpperCase() === serial));
        returnedRMA.push({
          serial,
          product:   mv.product,
          category:  mv.category || '',
          location:  mv.location || '',
          testedBy:  mv.testedBy  || '',
          testedAt:  mv.testedAt  || '',
          testNotes: mv.testNotes || '',
          returnedDate: outMv?.date || '',
          returnedBy:   outMv?.by  || '',
          returnedTo:   outMv?.customer || '',
        });
      }
    });

    // Combine based on filter
    let rows = [];
    if (!statusF || statusF === 'to-return') {
      inStockRMA.forEach(r => rows.push({ ...r, rmaStatus: 'to-return' }));
    }
    if (!statusF || statusF === 'returned') {
      returnedRMA.forEach(r => rows.push({ ...r, rmaStatus: 'returned' }));
    }

    // Apply search
    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.location||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('rma-body');
    const footer = document.getElementById('rma-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No RMA items found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isReturned = r.rmaStatus === 'returned';
      return `<tr style="${isReturned ? 'opacity:0.65;' : ''}">
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
        <td>
          ${isReturned
            ? '<span class="badge b-ok" style="font-size:9px;">✓ Returned</span>'
            : '<span class="badge b-cond-rma b-condition" style="font-size:9px;">⛔ To Return</span>'}
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes||'')}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint);">${isReturned
          ? (r.returnedDate ? fmtDate(r.returnedDate) : '—') + (r.returnedTo ? `<br><span style="color:var(--text-muted)">${esc(r.returnedTo)}</span>` : '')
          : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    const toReturnCount = rows.filter(r => r.rmaStatus === 'to-return').length;
    const returnedCount = rows.filter(r => r.rmaStatus === 'returned').length;
    if (footer) {
      footer.innerHTML = toReturnCount > 0
        ? `<span style="color:var(--danger-text);font-weight:600;">${toReturnCount} awaiting return</span>${returnedCount > 0 ? ` · ${returnedCount} returned` : ''} · Use <strong>Stock Out</strong> to mark as returned`
        : `<span style="color:var(--success-text);font-weight:600;">${returnedCount} returned</span>`;
    }
  }

  Object.assign(UI, { renderRMA });
})();
