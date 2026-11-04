/**
 * ui/churn-modal.js — Churn restaurant modal (Stock Deployed → Restaurants detail)
 * Two steps: review, then typed-name confirmation. Dashboard devices are deleted first;
 * inventory is only touched if every dashboard delete succeeded.
 */
(() => {
  const { showAlert, esc, SmartSelect } = UI._;

  function showChurnModal(customer) {
    const existing = document.getElementById('churn-modal');
    if (existing) existing.remove();

    const c = (customer || '').trim();
    const units = Inventory.getDeployedSerialRows().filter(r => (r.customer || '').trim() === c);
    if (!units.length) { showAlert(`${customer} has no units to return.`, 'error'); return; }

    const byProduct = {};
    const byLoc = {};
    units.forEach(u => {
      byProduct[u.product] = (byProduct[u.product] || 0) + 1;
      if (u.location) byLoc[u.location] = (byLoc[u.location] || 0) + 1;
    });
    const commonLoc = Object.entries(byLoc).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const breakdown = Object.entries(byProduct).sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `<li>${esc(p)} × ${n}</li>`).join('');

    let preview = null;      // { location, devices } once loaded
    let previewError = '';
    let loading = true;
    let step = 1;
    let busy = false;
    let chosenLocation = commonLoc;
    let chosenBy = '';
    let failures = null;     // [{serial, message}]
    let execError = '';

    const modal = document.createElement('div');
    modal.id = 'churn-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal && !busy) close(); });

    function devicesHtml() {
      if (loading) return '<div style="font-size:13px;color:var(--text-muted);">Loading dashboard devices…</div>';
      if (previewError) return `<div style="color:var(--danger-text);font-size:13px;">Could not load dashboard devices: ${esc(previewError)}</div>`;
      if (!preview.location) return '<div style="font-size:13px;color:var(--text-muted);">Not linked to an AIO dashboard restaurant — no dashboard devices will be removed</div>';
      const list = preview.devices.length
        ? `<ul style="margin:6px 0 0 18px;font-size:13px;">${preview.devices.map(d => `<li>${esc(d.type)} · <span style="font-family:var(--mono);">${esc(d.serial)}</span>${d.name ? ' · ' + esc(d.name) : ''}</li>`).join('')}</ul>`
        : '<div style="font-size:13px;color:var(--text-muted);margin-top:4px;">No devices registered there.</div>';
      return `<div style="font-size:13px;">${preview.devices.length} device${preview.devices.length !== 1 ? 's' : ''} at <strong>${esc(preview.location.name)}</strong> will be deleted from the AIO dashboard:</div>${list}`;
    }

    function render() {
      if (step === 1) {
        modal.innerHTML = `
          <div class="modal-box" style="width:480px;">
            <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
              <span>Churn ${esc(c)}</span>
              <button class="btn-remove-row" id="churn-close">×</button>
            </div>
            <div style="font-size:13px;margin-bottom:6px;"><strong>${units.length} unit${units.length !== 1 ? 's' : ''}</strong> will return to stock:</div>
            <ul style="margin:0 0 1rem 18px;font-size:13px;">${breakdown}</ul>
            <div style="margin-bottom:1rem;max-height:180px;overflow:auto;">${devicesHtml()}</div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">Return to location *</label>
              <input class="fi" id="churn-location" placeholder="e.g. SF Warehouse" autocomplete="off" />
            </div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">Churned by</label>
              <input class="fi" id="churn-by" placeholder="e.g. Peter Roberts" value="${esc(chosenBy)}" />
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem;">Units come back flagged Needs Testing.</div>
            <div id="churn-error" style="display:none;color:var(--danger-text);font-size:12px;margin-bottom:10px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="btn btn-ghost" id="churn-cancel">Cancel</button>
              <button class="btn btn-primary" id="churn-continue" ${loading || previewError ? 'disabled' : ''}>Continue →</button>
            </div>
          </div>`;
        SmartSelect('churn-location', Inventory.getLocations, DB.addCustomLocation);
        const locInput = document.getElementById('churn-location');
        const locSelect = locInput?.parentNode?.querySelector('.ss-select');
        if (chosenLocation) {
          if (locSelect) {
            const opt = Array.from(locSelect.options).find(o => o.value === chosenLocation);
            if (opt) locSelect.value = chosenLocation;
          }
          locInput.value = chosenLocation;
        }
        document.getElementById('churn-close').addEventListener('click', close);
        document.getElementById('churn-cancel').addEventListener('click', close);
        document.getElementById('churn-continue').addEventListener('click', () => {
          const loc = document.getElementById('churn-location').value.trim();
          const errEl = document.getElementById('churn-error');
          if (!loc) { errEl.textContent = 'Return-to location is required.'; errEl.style.display = 'block'; return; }
          chosenLocation = loc;
          chosenBy = document.getElementById('churn-by').value.trim();
          step = 2;
          render();
        });
      } else {
        const linked = !!preview?.location;
        const nDev = linked ? preview.devices.length : 0;
        const summary = linked
          ? `This will delete ${nDev} device record${nDev !== 1 ? 's' : ''} from ${esc(preview.location.name)} in the AIO production dashboard and return ${units.length} unit${units.length !== 1 ? 's' : ''} to ${esc(chosenLocation)}. This cannot be undone.`
          : `This will return ${units.length} unit${units.length !== 1 ? 's' : ''} to ${esc(chosenLocation)}. No dashboard devices will be removed. This cannot be undone.`;
        const failHtml = failures ? `
          <div style="color:var(--danger-text);font-size:12px;margin-bottom:10px;">
            Some dashboard devices could not be deleted, so inventory was not changed. Run churn again to retry.
            <ul style="margin:4px 0 0 18px;">${failures.map(f => `<li><span style="font-family:var(--mono);">${esc(f.serial)}</span>: ${esc(f.message || 'failed')}</li>`).join('')}</ul>
          </div>` : '';
        const errHtml = execError ? `<div style="color:var(--danger-text);font-size:12px;margin-bottom:10px;">${esc(execError)}</div>` : '';
        modal.innerHTML = `
          <div class="modal-box" style="width:480px;">
            <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
              <span>Confirm churn: ${esc(c)}</span>
              <button class="btn-remove-row" id="churn-close" ${busy ? 'disabled' : ''}>×</button>
            </div>
            <div style="background:var(--danger-bg, #fdecea);color:var(--danger-text);border:1px solid var(--danger-text);border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:1rem;">${summary}</div>
            <div class="form-group" style="margin-bottom:1rem;">
              <label class="form-label">Type <strong>${esc(c)}</strong> to confirm</label>
              <input class="fi" id="churn-confirm-input" autocomplete="off" ${busy ? 'disabled' : ''} />
            </div>
            ${failHtml}${errHtml}
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="btn btn-ghost" id="churn-back" ${busy ? 'disabled' : ''}>Back</button>
              <button class="btn btn-danger" id="churn-go" disabled>Churn restaurant</button>
            </div>
          </div>`;
        const input = document.getElementById('churn-confirm-input');
        const go = document.getElementById('churn-go');
        input.addEventListener('input', () => { go.disabled = busy || input.value !== c; });
        document.getElementById('churn-close').addEventListener('click', close);
        document.getElementById('churn-back').addEventListener('click', () => { failures = null; execError = ''; step = 1; render(); });
        go.addEventListener('click', execute);
        input.focus();
      }
    }

    async function execute() {
      if (busy) return;
      const input = document.getElementById('churn-confirm-input');
      if (!input || input.value !== c) return;
      busy = true; failures = null; execError = '';
      ['churn-go', 'churn-back', 'churn-close', 'churn-confirm-input'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
      const linked = !!preview?.location;
      let removed = 0;
      try {
        if (linked) {
          const res = await DeviceMap.churn(c);
          const results = res.results || [];
          const bad = results.filter(r => !r.ok);
          if (bad.length) {
            failures = bad;
            busy = false; render();
            return;
          }
          removed = results.length;
        }
        Inventory.churnCustomer(c, chosenLocation, chosenBy);
        if (linked) DB.setDeviceLocation(c, null);
      } catch (e) {
        execError = e.message;
        busy = false; render();
        return;
      }
      busy = false;
      close();
      UI.closeRestaurantDetail();
      UI.renderDeployed();
      showAlert(`${c} churned — ${units.length} units returned to ${chosenLocation}, ${removed} dashboard devices removed`, 'success');
    }

    render();
    DeviceMap.churnPreview(c)
      .then(r => { preview = { location: r.location || null, devices: r.devices || [] }; })
      .catch(e => { previewError = e.message || 'request failed'; })
      .finally(() => { loading = false; if (step === 1 && document.getElementById('churn-modal')) { chosenBy = document.getElementById('churn-by')?.value || chosenBy; chosenLocation = document.getElementById('churn-location')?.value.trim() || chosenLocation; render(); } });
  }

  Object.assign(UI._, { showChurnModal });
})();
