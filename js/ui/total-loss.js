/**
 * ui/total-loss.js — Total Loss view
 */
(() => {
  const { esc, fmtDate } = UI._;

  // ── Total Loss view ────────────────────────────────────────────────────
  function renderTotalLoss() {
    const search  = (document.getElementById('tl-search')?.value || '').trim().toLowerCase();
    const statusF = document.getElementById('tl-status-filter')?.value || '';

    const { movements } = DB.getData();
    const serialInMovement = {};
    movements.forEach(mv => {
      if (mv.type === 'IN') mv.serials.forEach(s => { serialInMovement[s.toUpperCase()] = mv; });
    });

    // Items with fail-tl still in stock = "To Write Off"
    const inStockTL = Inventory.getAllSerialRows().filter(r => r.condition === 'fail-tl');

    // Items with fail-tl that have been booked out = "Written Off"
    const availableSet = Inventory.getAvailableSerials();
    const writtenOff = [];
    Object.entries(serialInMovement).forEach(([serial, mv]) => {
      if (mv.condition === 'fail-tl' && !availableSet.has(serial)) {
        const outMv = [...movements].reverse().find(m => m.type === 'OUT' && !m.isTransfer && m.serials.some(s => s.toUpperCase() === serial));
        writtenOff.push({
          serial,
          product:   mv.product,
          category:  mv.category || '',
          location:  mv.location || '',
          testedBy:  mv.testedBy  || '',
          testedAt:  mv.testedAt  || '',
          testNotes: mv.testNotes || '',
          writtenOffDate: outMv?.date || '',
          writtenOffBy:   outMv?.by   || '',
          writtenOffTo:   outMv?.customer || '',
        });
      }
    });

    let rows = [];
    if (!statusF || statusF === 'to-writeoff') inStockTL.forEach(r => rows.push({ ...r, tlStatus: 'to-writeoff' }));
    if (!statusF || statusF === 'written-off') writtenOff.forEach(r => rows.push({ ...r, tlStatus: 'written-off' }));

    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.location||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('tl-body');
    const footer = document.getElementById('tl-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No Total Loss items found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isWrittenOff = r.tlStatus === 'written-off';
      return `<tr style="${isWrittenOff ? 'opacity:0.65;' : ''}">
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td><span class="loc-badge">${esc(r.location||'—')}</span></td>
        <td>
          ${isWrittenOff
            ? '<span class="badge b-ok" style="font-size:9px;">✓ Written Off</span>'
            : '<span class="badge b-cond-fail-tl b-condition" style="font-size:9px;">🗑 To Write Off</span>'}
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${r.testedBy ? esc(r.testedBy) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.testedAt ? fmtDate(r.testedAt) : '—'}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.testNotes||'')}">${r.testNotes ? esc(r.testNotes) : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text-hint);">${isWrittenOff
          ? (r.writtenOffDate ? fmtDate(r.writtenOffDate) : '—') + (r.writtenOffTo ? `<br><span style="color:var(--text-muted)">${esc(r.writtenOffTo)}</span>` : '')
          : '<span style="color:var(--text-hint)">—</span>'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    const toWriteOffCount = rows.filter(r => r.tlStatus === 'to-writeoff').length;
    const writtenOffCount = rows.filter(r => r.tlStatus === 'written-off').length;
    if (footer) {
      footer.innerHTML = toWriteOffCount > 0
        ? `<span style="color:var(--danger-text);font-weight:600;">${toWriteOffCount} awaiting write-off</span>${writtenOffCount > 0 ? ` · ${writtenOffCount} written off` : ''} · Use <strong>Stock Out</strong> to book out`
        : `<span style="color:var(--success-text);font-weight:600;">${writtenOffCount} written off</span>`;
    }
  }

  Object.assign(UI, { renderTotalLoss });
})();
