/**
 * ui/orders.js — Purchase Orders view
 */
(() => {
  const { showAlert, esc, fmtDate } = UI._;

  // ── Orders ─────────────────────────────────────────────────────────────
  function renderOrderList() {
    const allOrders = DB.getOrders().slice().reverse();
    // Purchase Orders tab: show pending, partial, in-transit and cancelled
    const orders = allOrders.filter(o => o.status === 'pending' || o.status === 'partial' || o.status === 'in-transit' || o.status === 'cancelled');
    const badge  = document.getElementById('order-count-badge');
    const pending = allOrders.filter(o => o.status === 'pending' || o.status === 'partial').length;
    if (badge) badge.textContent = pending > 0 ? `(${pending})` : '';

    const container = document.getElementById('order-list');
    if (!container) return;
    if (!orders.length) { container.innerHTML = '<div class="empty">No orders placed yet</div>'; return; }

    const statusLabel = { pending: '⏳ Pending', partial: '⚡ Partial', 'in-transit': '✈ In Transit', received: '✓ Received', cancelled: '✗ Cancelled' };
    const statusClass = { pending: 'b-low', partial: 'b-partial', 'in-transit': 'transit', received: 'b-in', cancelled: 'b-zero' };

    container.innerHTML = orders.map(o => {
      const totalQty = o.products.reduce((a, p) => a + p.qty, 0);
      const totalVal = o.products.reduce((a, p) => a + (p.qty * (p.unitCost || 0)), 0);
      const hasTax   = (o.taxAmount || 0) > 0;
      const fmt$ = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

      // Expanded detail panel — full line-by-line breakdown with tax
      const detailPanel = `<div class="ord-detail" id="ord-detail-${o.id}" style="display:none;border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Product</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Qty</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Unit cost</th>
            <th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--text-muted);font-size:11px;">Line total</th>
            ${hasTax ? '<th style="text-align:right;padding:4px 8px;font-weight:600;color:#8A5200;font-size:11px;">Tax share</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:#8A5200;font-size:11px;">Tax/unit</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--aio-purple);font-size:11px;">Landed/unit</th><th style="text-align:right;padding:4px 8px;font-weight:600;color:var(--aio-purple);font-size:11px;">Landed total</th>' : ''}
          </tr></thead>
          <tbody>
            ${o.products.map(p => {
              const lineTotal   = p.qty * (p.unitCost || 0);
              const landedTotal = p.qty * (p.landedUnitCost || p.unitCost || 0);
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px 8px;font-weight:500">${esc(p.product)}</td>
                <td style="padding:6px 8px;text-align:right">${p.qty}</td>
                <td style="padding:6px 8px;text-align:right">${p.unitCost != null ? '$'+p.unitCost.toFixed(2) : '—'}</td>
                <td style="padding:6px 8px;text-align:right">$${lineTotal.toFixed(2)}</td>
                ${hasTax ? `
                <td style="padding:6px 8px;text-align:right;color:#8A5200;">$${(p.taxShare||0).toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;color:#8A5200;">$${(p.taxPerUnit||0).toFixed(4)}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--aio-purple);">$${(p.landedUnitCost||p.unitCost||0).toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--aio-purple);">$${landedTotal.toFixed(2)}</td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:1px solid var(--border-md);">
              <td colspan="3" style="padding:8px;font-weight:700;font-size:12px;color:var(--text-muted);">Subtotal</td>
              <td style="padding:8px;text-align:right;font-weight:700;">$${totalVal.toFixed(2)}</td>
              ${hasTax ? `<td colspan="3" style="padding:8px;text-align:right;color:#8A5200;font-weight:700;">Tax ${fmt$(o.taxAmount)}${o.taxRate?' ('+o.taxRate+'%)':''}</td><td style="padding:8px;text-align:right;font-weight:700;color:var(--aio-purple);">$${(o.totalWithTax||totalVal).toFixed(2)}</td>` : ''}
            </tr>
            ${hasTax && o.taxRef ? `<tr><td colspan="8" style="padding:4px 8px;font-size:11px;color:var(--text-muted);">Tax ref: ${esc(o.taxRef)}</td></tr>` : ''}
          </tfoot>
        </table>
      </div>`;

      return `<div class="shipment-card">
        <div class="shipment-card-header" style="cursor:pointer;" data-toggle-order="${o.id}">
          <div style="flex:1;">
            <div class="shipment-card-title">
              ${esc(o.supplier)} <span class="po-lock-badge">🔒 ${esc(o.poNumber)}</span>
              <span class="badge ${statusClass[o.status] || 'b-low'}" style="margin-left:6px;font-size:10px;">${statusLabel[o.status] || o.status}</span>
              ${hasTax ? '<span style="margin-left:8px;font-size:10px;background:#FEF7EA;color:#8A5200;padding:2px 7px;border-radius:8px;border:1px solid #FFA500;font-weight:600;">💰 Tax</span>' : ''}
            </div>
            <div class="shipment-card-meta">
              ${totalQty} unit${totalQty !== 1 ? 's' : ''} · ${o.products.length} product${o.products.length !== 1 ? 's' : ''} · Subtotal ${fmt$(totalVal)}${hasTax ? ` · <span style="color:#8A5200;">Tax ${fmt$(o.taxAmount)}${o.taxRate ? ' (' + o.taxRate + '%)' : ''}${o.taxRef ? ' — ' + esc(o.taxRef) : ''}</span> · <strong>Total ${fmt$(o.totalWithTax)}</strong>` : ''} · Ordered ${fmtDate(o.createdAt)}${o.expectedBy ? ' · Expected ' + new Date(o.expectedBy).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''} <span style="font-size:11px;color:var(--text-hint);">▼ click to expand</span>
            </div>
          </div>
          <div class="shipment-actions" style="align-self:flex-start;">
            ${o.status === 'pending' ? `<button class="btn btn-success btn-xs" data-arrange-order="${o.id}">Arrange Shipment</button>
            <button class="btn btn-orange btn-xs" data-split-order="${o.id}" title="Register a partial shipment &#8212; specify how many units are being sent now">&#9986; Split Shipment</button>
            <button class="btn btn-ghost btn-xs" data-cancel-order="${o.id}">Cancel</button>` : ''}
            ${o.status === 'partial' ? `<button class="btn btn-success btn-xs" data-arrange-order="${o.id}">Arrange Remaining</button>
            <button class="btn btn-orange btn-xs" data-split-order="${o.id}" title="Register another partial shipment for remaining units">&#9986; Split Again</button>
            <button class="btn btn-ghost btn-xs" data-cancel-order="${o.id}">Cancel</button>` : ''}
            ${o.status === 'in-transit' ? `<button class="btn btn-success btn-xs" data-part-receive-order="${o.id}" title="Receive some or all units now, scan serials on arrival">&#9986; Receive Part</button>
            <button class="btn btn-ghost btn-xs" data-full-receive-order="${o.id}" title="Receive all units from this shipment">Receive All</button>
            <button class="btn btn-orange btn-xs" data-close-order="${o.id}" title="Mark as delivered without adding stock &#8212; for units already entered into the system">&#10003; Already in Stock</button>` : ''}
          </div>
        </div>
        ${detailPanel}
      </div>`;
    }).join('');

    // Toggle expand on card header click
    container.querySelectorAll('[data-toggle-order]').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('button')) return; // don't toggle on button clicks
        const detail = document.getElementById(`ord-detail-${header.dataset.toggleOrder}`);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        const arrow = header.querySelector('.shipment-card-meta span:last-child');
        if (arrow) arrow.textContent = isOpen ? '▼ click to expand' : '▲ click to collapse';
      });
    });

    container.querySelectorAll('[data-arrange-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.arrangeShipmentFromOrder === 'function') window.arrangeShipmentFromOrder(parseInt(btn.dataset.arrangeOrder));
      });
    });
    container.querySelectorAll('[data-split-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.splitShipmentFromOrder === 'function') window.splitShipmentFromOrder(parseInt(btn.dataset.splitOrder));
      });
    });
    container.querySelectorAll('[data-cancel-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Cancel this order?')) { DB.updateOrder(parseInt(btn.dataset.cancelOrder), { status: 'cancelled' }); renderOrderList(); }
      });
    });
    container.querySelectorAll('[data-part-receive-order]').forEach(btn => {
      btn.addEventListener('click', () => UI._.showPartialReceiveModal(parseInt(btn.dataset.partReceiveOrder)));
    });
    container.querySelectorAll('[data-full-receive-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = parseInt(btn.dataset.fullReceiveOrder);
        const { shipments } = DB.getData();
        const s = shipments.find(x => x.orderId === orderId && x.status === 'in-transit');
        if (s) UI._.showReceiveModal(s.id);
      });
    });
    container.querySelectorAll('[data-close-order]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = parseInt(btn.dataset.closeOrder);
        const order   = DB.getOrders().find(o => o.id === orderId);
        if (!order) return;
        const ships = DB.getData().shipments.filter(s =>
          s.status === 'in-transit' &&
          (s.orderId === orderId || (s.poNumber === order.poNumber && s.supplier === order.supplier))
        );
        if (!ships.length) { showAlert('No in-transit shipment found for this order.', 'error'); return; }
        closeWithoutStock(ships, `${order.supplier || 'this order'} · ${order.poNumber || ''}`);
      });
    });
  }

  // Mark shipments delivered without writing any stock — for units that were
  // already entered into the system by hand. Deliberately explicit, because the
  // alternative (Receive) is what double-counts them.
  function closeWithoutStock(shipments, label) {
    const units = shipments.reduce((a, s) => a + s.products.reduce((b, p) => b + p.serials.length, 0), 0);
    if (!confirm(
      `Mark ${shipments.length > 1 ? shipments.length + ' shipments' : 'this shipment'} for ${label} as delivered?\n\n` +
      `${units} unit${units!==1?'s':''} will be cleared from In Transit and NO stock will be added — use this only when the units are already in Stock Holding.\n\n` +
      `To actually receive them into stock, cancel and use Receive Part / Receive All instead.`
    )) return;
    const by = (typeof Auth !== 'undefined' && Auth.getName) ? Auth.getName() : '';
    try {
      shipments.forEach(s => Inventory.closeShipmentWithoutStock(s.id, by));
      renderOrderList();
      UI.renderTransitList();
      UI.renderDashboard();
      showAlert(`${units} unit${units!==1?'s':''} cleared from In Transit — no stock added`, 'success');
    } catch (err) { showAlert(err.message, 'error'); }
  }

  Object.assign(UI, { renderOrderList });
  Object.assign(UI._, { closeWithoutStock });
})();
