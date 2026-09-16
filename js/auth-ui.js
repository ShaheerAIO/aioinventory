/**
 * auth-ui.js — Login screen, user header bar, admin users panel
 */

const AuthUI = (() => {

  // ── Login screen ──────────────────────────────────────────────────────
  // Microsoft Entra ID is the only advertised way in. The password form is the
  // break-glass admin login and only renders on the unlisted ?signin=fallback
  // URL — there is deliberately no link to it. See ENTRA-SETUP.md.
  const MS_MARK = `<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true" style="flex:none;">
    <rect x="1"  y="1"  width="10" height="10" fill="#F25022"/>
    <rect x="12" y="1"  width="10" height="10" fill="#7FBA00"/>
    <rect x="1"  y="12" width="10" height="10" fill="#00A4EF"/>
    <rect x="12" y="12" width="10" height="10" fill="#FFB900"/></svg>`;

  function showLoginScreen() {
    const fallback = new URLSearchParams(location.search).get('signin') === 'fallback';

    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">
            <img src="logo.png" alt="AIO" class="login-logo-img" />
            <div class="login-logo-label">Inventory System</div>
          </div>
          <div id="login-error" class="login-error" style="display:none;"></div>
          <button class="btn btn-primary login-btn" id="btn-ms-login" style="display:flex;align-items:center;justify-content:center;gap:10px;">
            ${MS_MARK}<span>Sign in with Microsoft</span>
          </button>
          ${fallback ? `
            <div style="margin:22px 0 14px;border-top:1px solid var(--border);padding-top:18px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-hint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Break-glass admin sign-in</div>
              <div class="form-group" style="margin-bottom:14px;">
                <label class="form-label">Email address</label>
                <input class="fi" id="login-email" type="email" autocomplete="email" />
              </div>
              <div class="form-group" style="margin-bottom:16px;">
                <label class="form-label">Password</label>
                <input class="fi" id="login-password" type="password" autocomplete="current-password" />
              </div>
              <button class="btn btn-ghost login-btn" id="login-btn">Sign in with password</button>
            </div>` : ''}
          <div class="login-footer">AIO App Inventory · Authorised users only</div>
        </div>
      </div>`;

    function showError(msg) {
      const el = document.getElementById('login-error');
      if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    // Always name the underlying code — without it every failure outside the
    // handful we recognise looks identical and is impossible to diagnose.
    function describe(e) {
      const code = e && e.code ? e.code : 'unknown';
      const known = {
        'auth/popup-closed-by-user':
          'The Microsoft window closed before sign-in finished. If you did not close it, your browser may be blocking it — try Chrome or Edge, and tell an administrator.',
        'auth/cancelled-popup-request':
          'Sign-in was interrupted. Please try again.',
        'auth/account-exists-with-different-credential':
          'An older account already uses this email address. Ask an administrator to finish moving it over.',
        'auth/unauthorized-domain':
          'This site is not an authorised sign-in domain for AIO. Contact an administrator.',
        'auth/popup-blocked':
          'Your browser blocked the Microsoft sign-in window. Allow pop-ups for this site and try again.',
      };
      const msg = known[code] || 'Sign in failed. Please try again, or contact an administrator if this continues.';
      return `${msg} (${code})`;
    }

    // Surface a redirect that failed after we were bounced back to this page
    const redirectErr = Auth.getRedirectError && Auth.getRedirectError();
    if (redirectErr) showError(describe(redirectErr));

    document.getElementById('btn-ms-login').addEventListener('click', async () => {
      const btn = document.getElementById('btn-ms-login');
      const label = btn.querySelector('span');
      label.textContent = 'Signing in...';
      btn.disabled = true;
      try {
        await Auth.signInWithMicrosoft();
        // Reload — this re-initialises everything with the authenticated user
        window.location.reload();
      } catch (e) {
        label.textContent = 'Sign in with Microsoft';
        btn.disabled = false;
        showError(describe(e));
      }
    });

    if (!fallback) return;

    const doLogin = async () => {
      const email = document.getElementById('login-email').value.trim();
      const pass  = document.getElementById('login-password').value;
      const btn   = document.getElementById('login-btn');

      if (!email || !pass) { showError('Please enter your email and password.'); return; }
      btn.textContent = 'Signing in...';
      btn.disabled = true;

      try {
        await Auth.signIn(email, pass);
        window.location.reload();
      } catch (e) {
        btn.textContent = 'Sign in with password';
        btn.disabled = false;
        const msg = e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found'
          ? 'Incorrect email or password.'
          : e.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : 'Sign in failed. Please try again.';
        showError(msg);
      }
    };

    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    setTimeout(() => document.getElementById('login-email')?.focus(), 100);
  }

  // ── Inject user bar into header ───────────────────────────────────────
  function injectUserBar() {
    const header = document.querySelector('.header');
    if (!header) return;

    const profile = Auth.getProfile();
    const name    = Auth.getName();
    const role    = profile?.role || 'view';
    const roleLabel = { admin: 'Admin', edit: 'Editor', view: 'View only' }[role] || role;
    const roleColour = { admin: 'var(--aio-purple)', edit: 'var(--success-text)', view: 'var(--text-hint)' }[role];

    const bar = document.createElement('div');
    bar.className = 'user-bar';
    bar.id = 'user-bar';
    bar.innerHTML = `
      <span class="user-name">${esc(name)}</span>
      <span class="user-role" style="color:${roleColour}">${roleLabel}</span>
      ${Auth.isAdmin() ? '<button class="btn btn-ghost btn-xs" id="btn-manage-users">Manage users</button>' : ''}
      ${Auth.isAdmin() ? '<button class="btn btn-ghost btn-xs" id="btn-hubspot-map">HubSpot mapping</button>' : ''}
      <button class="btn btn-ghost btn-xs" id="btn-sign-out">Sign out</button>`;
    header.appendChild(bar);

    document.getElementById('btn-sign-out')?.addEventListener('click', () => {
      if (confirm('Sign out?')) Auth.signOut();
    });
    document.getElementById('btn-manage-users')?.addEventListener('click', showUsersPanel);
    document.getElementById('btn-hubspot-map')?.addEventListener('click', showHubspotMapPanel);
  }

  // ── Apply role restrictions ───────────────────────────────────────────
  function applyRoleRestrictions() {
    if (Auth.canEdit()) return; // admin + edit = full access

    // View only — disable all action buttons and form inputs
    const selectors = [
      '#btn-submit-in', '#btn-submit-out', '#btn-submit-transit',
      '#btn-add-product', '#btn-add-transit-product', '#btn-clear-out',
      '.btn-orange', '.btn-danger', '.btn-success',
      '.btn-remove-row', '.used-toggle input'
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.disabled = true;
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.title = 'View only access';
      });
    });

    // Add view-only banner
    const banner = document.createElement('div');
    banner.style.cssText = 'background:var(--info-bg);color:var(--info-text);border:1px solid var(--info-border);border-radius:var(--r-md);padding:8px 16px;font-size:12px;font-weight:500;margin:0 1.5rem 1rem;';
    banner.textContent = '👁 View only access — contact an administrator to make changes';
    document.querySelector('.view')?.parentElement?.insertBefore(banner, document.querySelector('.view'));
  }

  // ── Admin: Users panel ────────────────────────────────────────────────
  async function showUsersPanel() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'users-panel-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="width:700px;max-height:80vh;overflow-y:auto;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Manage users</span>
          <button class="btn-remove-row" id="close-users-panel">×</button>
        </div>
        <div id="users-list"><div style="color:var(--text-hint);font-size:13px;">Loading...</div></div>
        <hr style="margin:1.25rem 0;border-color:var(--border);" />
        <div style="font-size:11px;font-weight:700;color:var(--aio-purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Pre-assign a role</div>
        <div style="font-size:12px;color:var(--text-hint);margin-bottom:12px;">
          Anyone with an AIO Microsoft account can sign in and lands as View only. Use this to have someone
          arrive as an Editor or Admin instead — enter the email they sign in with and it applies on their first sign-in.
        </div>
        <div id="add-user-error" class="login-error" style="display:none;margin-bottom:10px;"></div>
        <div class="form-grid g2" style="margin-bottom:10px;">
          <div class="form-group">
            <label class="form-label">Full name *</label>
            <input class="fi" id="new-user-name" placeholder="e.g. John Smith" />
          </div>
          <div class="form-group">
            <label class="form-label">Work email *</label>
            <input class="fi" id="new-user-email" type="email" placeholder="john@aioapp.com" />
          </div>
        </div>
        <div class="form-grid g2" style="margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label">Role *</label>
            <select class="fi" id="new-user-role">
              <option value="view">View only</option>
              <option value="edit">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-primary" id="btn-add-user-confirm">Pre-assign role</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#close-users-panel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    await refreshUsersList();

    overlay.querySelector('#btn-add-user-confirm').addEventListener('click', async () => {
      const name  = document.getElementById('new-user-name').value.trim();
      const email = document.getElementById('new-user-email').value.trim();
      const role  = document.getElementById('new-user-role').value;
      const errEl = document.getElementById('add-user-error');
      const btn   = document.getElementById('btn-add-user-confirm');

      errEl.style.display = 'none';
      if (!name || !email) { errEl.textContent = 'Name and email are both required.'; errEl.style.display = 'block'; return; }

      btn.textContent = 'Saving...'; btn.disabled = true;

      try {
        // Someone who has already signed in has a profile — change their role there instead
        const existing = (await UserManager.listUsers())
          .find(u => String(u.email || '').toLowerCase() === email.toLowerCase() && !u.deleted);
        if (existing) {
          errEl.textContent = `${existing.name || email} has already signed in — use the role dropdown above instead.`;
          errEl.style.display = 'block';
          btn.textContent = 'Pre-assign role'; btn.disabled = false;
          return;
        }

        UserManager.addPendingUser(email, name, role);
        ['new-user-name','new-user-email'].forEach(id => document.getElementById(id).value = '');
        await refreshUsersList();
        btn.textContent = '\u2713 Role pre-assigned';
        setTimeout(() => { btn.textContent = 'Pre-assign role'; btn.disabled = false; }, 2000);
      } catch(e) {
        errEl.textContent = 'Error: ' + (e.message || 'Could not save');
        errEl.style.display = 'block';
        btn.textContent = 'Pre-assign role'; btn.disabled = false;
      }
    });
  }

  async function refreshUsersList() {
    const container = document.getElementById('users-list');
    if (!container) return;
    try {
      const allUsers   = await UserManager.listUsers();
      const active     = allUsers.filter(u => !u.deleted);
      const removed    = allUsers.filter(u =>  u.deleted);
      const currentUid = Auth.getUser()?.uid;
      const roleLabel  = { admin: 'Admin', edit: 'Editor', view: 'View only' };
      const roleColour = { admin: 'var(--aio-purple)', edit: 'var(--success-text)', view: 'var(--text-hint)' };

      const th = (t) => `<th style="text-align:left;padding:6px 8px;font-size:10px;font-weight:700;color:var(--text-hint);text-transform:uppercase;border-bottom:1px solid var(--border);">${t}</th>`;
      const cols = `<colgroup><col style="width:130px;"><col style="width:220px;"><col style="width:110px;"><col></colgroup>`;

      const activeRows = active.map(u => `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-weight:500;">${esc(u.name || '—')}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:12px;overflow-wrap:anywhere;">${esc(u.email)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);">
          ${u.id === currentUid
            ? `<span style="font-size:11px;color:${roleColour[u.role]};font-weight:600;">${roleLabel[u.role] || u.role} (you)</span>`
            : `<select class="fi" data-uid="${esc(u.id)}" style="width:100%;padding:4px 6px;font-size:12px;box-sizing:border-box;">
                ${['view','edit','admin'].map(r => `<option value="${r}"${u.role===r?' selected':''}>${roleLabel[r]}</option>`).join('')}
              </select>`}
        </td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;">
          <div style="display:flex;gap:6px;justify-content:flex-end;white-space:nowrap;">
            ${u.id !== currentUid
              ? `<button class="btn btn-ghost btn-xs" data-delete="${esc(u.id)}" data-name="${esc(u.name||u.email)}" style="color:var(--danger-text);border-color:var(--danger-border);">Remove</button>`
              : ''}
          </div>
        </td>
      </tr>`).join('');

      const removedRows = removed.length ? removed.map(u => `<tr style="opacity:.65;">
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-weight:500;">${esc(u.name || '—')}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:12px;overflow-wrap:anywhere;">${esc(u.email)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-hint);">Removed</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;display:flex;gap:6px;justify-content:flex-end;white-space:nowrap;">
          <button class="btn btn-ghost btn-xs" data-reactivate="${esc(u.id)}" data-email="${esc(u.email)}" data-name="${esc(u.name||u.email)}">Reactivate</button>
        </td>
      </tr>`).join('') : '';

      // Pending users — Firebase Auth exists, awaiting first login to create Firestore profile
      const pendingUsersMap = (typeof DB !== 'undefined') ? (DB.getData().pendingUsers || {}) : {};
      const pendingList = Object.entries(pendingUsersMap).map(([email, p]) => ({ email, ...p }));
      const pendingRows = pendingList.map(p => `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-weight:500;">${esc(p.name || '—')}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:12px;overflow-wrap:anywhere;">${esc(p.email)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);">${roleLabel[p.role] || p.role || 'edit'} · awaiting sign-in</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;display:flex;gap:6px;justify-content:flex-end;white-space:nowrap;">
          <button class="btn btn-ghost btn-xs" data-remove-pending="${esc(p.email)}" style="color:var(--danger-text);border-color:var(--danger-border);font-size:11px;">Remove</button>
        </td>
      </tr>`).join('');

      container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
          ${cols}
          <thead><tr>${th('Name')}${th('Email')}${th('Role')}<th style="border-bottom:1px solid var(--border);"></th></tr></thead>
          <tbody>${activeRows}</tbody>
        </table>
        ${pendingList.length ? `
          <div style="margin-top:14px;margin-bottom:6px;font-size:10px;font-weight:700;color:var(--aio-orange-dark, #AC1B02);text-transform:uppercase;letter-spacing:.06em;">Pending — awaiting first sign-in</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
            ${cols}
            <tbody>${pendingRows}</tbody>
          </table>` : ''}
        ${removed.length ? `
          <div style="margin-top:14px;margin-bottom:6px;font-size:10px;font-weight:700;color:var(--text-hint);text-transform:uppercase;letter-spacing:.06em;">Removed users</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
            ${cols}
            <tbody>${removedRows}</tbody>
          </table>` : ''}`;

      // Wire role change dropdowns
      container.querySelectorAll('select[data-uid]').forEach(sel => {
        sel.addEventListener('change', async () => {
          await UserManager.updateUserRole(sel.dataset.uid, sel.value);
        });
      });

      // Wire remove buttons
      container.querySelectorAll('button[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Remove ${btn.dataset.name}?\n\nThey lose access the next time they sign in. You can reactivate them later from the Removed users section.`)) return;
          btn.textContent = 'Removing...'; btn.disabled = true;
          await UserManager.deleteUser(btn.dataset.delete);
          await refreshUsersList();
        });
      });

      // Wire reactivate buttons
      container.querySelectorAll('button[data-reactivate]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const role = prompt(`Reactivate ${btn.dataset.name} (${btn.dataset.email})\nEnter their role: admin / edit / view`, 'edit');
          if (!role || !['admin','edit','view'].includes(role)) return;
          if (!confirm(`Reactivate ${btn.dataset.name} as ${role}?\n\nThey get access back the next time they sign in with Microsoft.`)) return;
          btn.textContent = 'Reactivating...'; btn.disabled = true;
          try {
            await UserManager.reactivateUser(btn.dataset.reactivate, btn.dataset.name, role);
            await refreshUsersList();
          } catch(e) {
            alert('Error reactivating: ' + (e.message || 'Unknown'));
            btn.textContent = 'Reactivate'; btn.disabled = false;
          }
        });
      });

      // Wire remove-pending buttons
      container.querySelectorAll('button[data-remove-pending]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Remove pending profile for ${btn.dataset.removePending}?`)) return;
          if (typeof DB !== 'undefined') DB.removePendingUser(btn.dataset.removePending);
          await refreshUsersList();
        });
      });

    } catch(e) {
      container.innerHTML = `<div style="color:var(--danger-text);font-size:13px;">Error loading users: ${e.message}</div>`;
    }
  }

  // ── Admin: HubSpot Company mapping panel ───────────────────────────────
  function showHubspotMapPanel() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'hubspot-map-overlay';

    const customers = Inventory.getCustomers();
    const unitsByCustomer = Object.fromEntries(Inventory.getDeployedByCustomer().map(b => [b.customer, b.units]));
    const map = DB.getHubspotCompanyMap();

    const rows = customers.map(c => `
      <div class="form-grid g2" style="margin-bottom:8px;align-items:center;">
        <div style="font-size:13px;">${esc(c)} <span style="color:var(--text-hint);font-size:11px;">(${unitsByCustomer[c] || 0} deployed)${DB.isHubspotIgnored(c) ? ' · not a customer' : ''}</span></div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="fi hubspot-id-input" data-customer="${esc(c)}" placeholder="HubSpot Company ID" value="${esc(map[c] || '')}" />
          <button class="btn btn-ghost btn-xs hubspot-find-btn" data-customer="${esc(c)}" title="Search HubSpot">Find</button>
        </div>
      </div>`).join('');

    overlay.innerHTML = `
      <div class="modal-box" style="width:700px;max-height:80vh;overflow-y:auto;">
        <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>HubSpot Company mapping</span>
          <button class="btn-remove-row" id="close-hubspot-map">×</button>
        </div>
        <div style="font-size:12px;color:var(--text-hint);margin-bottom:14px;">
          Link each customer name to its HubSpot Company ID (find this in the company's HubSpot URL). Only mapped customers are included in the nightly sync.
        </div>
        ${customers.length ? `<div id="hubspot-map-rows">${rows}</div>` : `<div style="color:var(--text-hint);font-size:13px;">No customers found yet.</div>`}
        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <button class="btn btn-primary" id="btn-save-hubspot-map">Save mapping</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#close-hubspot-map').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.hubspot-find-btn').forEach(btn => btn.addEventListener('click', () => {
      const c = btn.dataset.customer;
      HubspotPicker.open({ customer: c, onDone: () => {
        const inp = overlay.querySelector(`.hubspot-id-input[data-customer="${CSS.escape(c)}"]`);
        if (inp) inp.value = DB.getHubspotCompanyId(c) || '';
      }});
    }));

    overlay.querySelector('#btn-save-hubspot-map')?.addEventListener('click', () => {
      overlay.querySelectorAll('.hubspot-id-input').forEach(inp => {
        DB.setHubspotCompanyId(inp.dataset.customer, inp.value);
      });
      overlay.remove();
    });
  }

  function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { showLoginScreen, injectUserBar, applyRoleRestrictions };
})();
