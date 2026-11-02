/**
 * ui/rmatl-dispatched.js — RMA / Total Loss view (in-stock RMA to return + dispatched RMA/TL)
 */
(() => {
  const { esc, fmtDate } = UI._;

  // ── Stock RMA/TL Dispatched view ────────────────────────────────────────
  function renderRmaTlDispatched() {
    const search = (document.getElementById('rmatldisp-search')?.value || '').trim().toLowerCase();
    const typeF  = document.getElementById('rmatldisp-type-filter')?.value || '';

    // Dispatched RMA/TL units (RMA ones are the "returned" units) plus in-stock RMA units awaiting return
    let rows = Inventory.getRmaTlDispatchedRows();
    const toReturn = Inventory.getAllSerialRows().filter(r => r.condition === 'rma').map(r => ({
      serial: r.serial, product: r.product, category: r.category, rmaTlType: 'to-return',
      customer: r.location ? 'In stock · ' + r.location : 'In stock', by: r.testedBy, date: r.testedAt, cost: r.cost,
    }));
    const seen = new Set(rows.map(r => r.serial.toUpperCase()));
    rows = rows.concat(toReturn.filter(r => !seen.has(r.serial.toUpperCase())));

    if (typeF) rows = rows.filter(r => r.rmaTlType === typeF);
    if (search) {
      rows = rows.filter(r =>
        r.serial.toLowerCase().includes(search) ||
        r.product.toLowerCase().includes(search) ||
        (r.customer||'').toLowerCase().includes(search) ||
        (r.category||'').toLowerCase().includes(search)
      );
    }

    const tbody  = document.getElementById('rmatldisp-body');
    const footer = document.getElementById('rmatldisp-footer');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty">No RMA / Total Loss dispatches found</div></td></tr>';
      if (footer) footer.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const isTL = r.rmaTlType === 'fail-tl';
      const typeBadge = isTL
        ? '<span class="badge b-cond-fail-tl b-condition" style="font-size:9px;">🗑 TL</span>'
        : r.rmaTlType === 'to-return'
        ? '<span class="badge b-cond-rma b-condition" style="font-size:9px;">⛔ To return</span>'
        : '<span class="badge b-cond-rma b-condition" style="font-size:9px;">⛔ RMA</span>';
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;font-weight:500">${esc(r.serial)}</td>
        <td style="font-weight:500">${esc(r.product)}</td>
        <td><span class="cat-badge">${esc(r.category||'—')}</span></td>
        <td>${typeBadge}</td>
        <td style="font-size:12px;">${esc(r.customer||'—')}</td>
        <td style="font-size:12px;color:var(--text-muted)">${esc(r.by||'—')}</td>
        <td style="font-size:11px;color:var(--text-hint)">${r.date ? fmtDate(r.date) : '—'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.cost != null ? '$' + Number(r.cost).toFixed(2) : '<span style="color:var(--text-hint)">—</span>'}</td>
      </tr>`;
    }).join('');

    if (footer) {
      const n = t => rows.filter(r => r.rmaTlType === t).length;
      footer.textContent = `${rows.length} items — ${n('to-return')} RMA to return · ${n('rma')} RMA returned · ${n('fail-tl')} Total Loss`;
    }
  }

  Object.assign(UI, { renderRmaTlDispatched });
})();
