/**
 * ui/edit-serial-modal.js — Admin edit/add serial modal (Stock Holding)
 */
(() => {
  const { showAlert, esc } = UI._;

  // ── Admin: edit serial modal ──────────────────────────────────────────
  function _showEditSerialModal(oldSerial, product, isAdd = false) {
    const existing = document.getElementById('edit-serial-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'edit-serial-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:420px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>${isAdd ? 'Add serial number' : 'Edit serial number'}</span>
          <button class="btn-remove-row" id="edit-serial-close">×</button>
        </div>
        <div class="form-group" style="margin-bottom:6px;">
          <label class="form-label">Product</label>
          <div style="font-size:13px;font-weight:500;color:var(--text);padding:6px 0;">${esc(product)}</div>
        </div>
        ${isAdd ? '' : `
        <div class="form-group" style="margin-bottom:6px;">
          <label class="form-label">Current serial</label>
          <div style="font-family:var(--mono);font-size:13px;color:var(--text-muted);padding:6px 0;">${esc(oldSerial)}</div>
        </div>`}
        <div class="form-group" style="margin-bottom:1.25rem;">
          <label class="form-label">${isAdd ? 'Serial number *' : 'New serial number *'}</label>
          <input class="fi fi-mono" id="edit-serial-input" value="${isAdd ? '' : esc(oldSerial)}" placeholder="Enter ${isAdd ? 'or scan the ' : 'correct '}serial number" />
          ${isAdd ? '<div class="hint">Scan or type the serial, then check it before clicking Save.</div>' : ''}
        </div>
        <div id="edit-serial-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="edit-serial-cancel">Cancel</button>
          <button class="btn btn-primary" id="edit-serial-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const input  = document.getElementById('edit-serial-input');
    const errEl  = document.getElementById('edit-serial-error');
    const close  = () => modal.remove();

    document.getElementById('edit-serial-close').addEventListener('click', close);
    document.getElementById('edit-serial-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    setTimeout(() => { input.focus(); input.select(); }, 50);

    document.getElementById('edit-serial-save').addEventListener('click', () => {
      const newSerial = input.value.trim().toUpperCase();
      errEl.style.display = 'none';

      if (!newSerial) { errEl.textContent = 'Serial number is required.'; errEl.style.display = 'block'; return; }
      if (newSerial === oldSerial) { close(); return; }

      // Check the new serial isn't already in use ANYWHERE — not just in stock.
      // A serial that is deployed / RMA / total-loss lives in an OUT movement and
      // is netted out of stock, so an in-stock-only check silently misses it and
      // renaming onto it makes the unit vanish (IN nets against the existing OUT).
      const usage = Inventory.getSerialInfo(newSerial);
      if (usage.status !== 'unknown') {
        const where =
          usage.status === 'dispatched'  ? (usage.deployedTo ? `already deployed to ${usage.deployedTo}` : 'already deployed to a customer')
        : usage.status === 'in-transit'  ? 'already in transit'
        : usage.status === 'in-stock'    ? `already in stock${usage.currentLocation ? ' at ' + usage.currentLocation : ''}`
        : 'already in use';
        errEl.textContent = `Serial "${newSerial}" is ${where}. Every serial must be unique — pick a different one.`;
        errEl.style.display = 'block';
        return;
      }

      DB.renameSerial(oldSerial, newSerial);
      close();
      UI.renderStockList();
      showAlert(isAdd ? `Serial added: ${newSerial}` : `Serial updated: ${oldSerial} → ${newSerial}`, 'success');
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // In add mode a scanner appends Enter after the serial — don't auto-submit
        // so the user can verify the captured value before clicking Save.
        if (!isAdd) document.getElementById('edit-serial-save').click();
      }
      if (e.key === 'Escape') close();
    });
  }

  Object.assign(UI._, { _showEditSerialModal });
})();
