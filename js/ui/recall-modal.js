/**
 * ui/recall-modal.js — Recall to Servicing modal (Deployed + RMA/TL Dispatched)
 */
(() => {
  const { showAlert, esc, SmartSelect } = UI._;

  // ── Recall to Servicing modal ─────────────────────────────────────────
  function showRecallModal(serial, product, currentLocation) {
    const existing = document.getElementById('recall-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'recall-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box" style="width:440px;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
          <span>Recall to Servicing</span>
          <button class="btn-remove-row" id="recall-modal-close">×</button>
        </div>
        <div style="margin-bottom:1rem;font-size:13px;color:var(--text-muted);">
          Returning <strong style="color:var(--text);">${esc(serial)}</strong> (${esc(product)}) from deployment back into stock for servicing.
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Return to location *</label>
          <input class="fi" id="recall-location" placeholder="e.g. SF Warehouse" autocomplete="off" />
        </div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label">Recalled by</label>
          <input class="fi" id="recall-by" placeholder="e.g. Peter Roberts" />
        </div>
        <div class="form-group" style="margin-bottom:1.5rem;">
          <label class="form-label">Condition on return</label>
          <div class="condition-flags">
            <label class="condition-flag-btn">
              <input type="radio" name="recall-condition" value="needs-testing" checked />
              <span>🔬 Needs Testing</span>
            </label>
            <label class="condition-flag-btn">
              <input type="radio" name="recall-condition" value="faulty" />
              <span>⚠ Faulty</span>
            </label>
          </div>
        </div>
        <div id="recall-modal-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-ghost" id="recall-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="recall-modal-confirm">Recall to Servicing</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Init SmartSelect on the location field and pre-fill with current location
    SmartSelect('recall-location', Inventory.getLocations, DB.addCustomLocation);
    const recallLocInput  = document.getElementById('recall-location');
    const recallLocSelect = recallLocInput?.parentNode?.querySelector('.ss-select');
    if (currentLocation && recallLocSelect) {
      const opt = Array.from(recallLocSelect.options).find(o => o.value === currentLocation);
      if (opt) { recallLocSelect.value = currentLocation; }
      recallLocInput.value = currentLocation;
    }

    const close = () => modal.remove();
    document.getElementById('recall-modal-close').addEventListener('click', close);
    document.getElementById('recall-modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    document.getElementById('recall-modal-confirm').addEventListener('click', () => {
      const location  = document.getElementById('recall-location').value.trim();
      const recalledBy = document.getElementById('recall-by').value.trim();
      const condition = document.querySelector('input[name="recall-condition"]:checked')?.value || 'needs-testing';
      const errEl     = document.getElementById('recall-modal-error');

      if (!location) { errEl.textContent = 'Location is required.'; errEl.style.display = 'block'; return; }

      try {
        Inventory.recallToServicing(serial, location, condition, recalledBy);
        close();
        UI.renderDeployed();
        showAlert(`${serial} recalled to Servicing at ${location}`, 'success');
      } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    });
  }

  Object.assign(UI._, { showRecallModal });
})();
