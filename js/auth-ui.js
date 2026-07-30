/**
 * auth-ui.js — Login screen, user header bar, admin users panel
 */

const AuthUI = (() => {

  // ── Login screen ──────────────────────────────────────────────────────
  function showLoginScreen() {
    document.body.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">
            <img src="logo.png" alt="AIO" class="login-logo-img" />
            <div class="login-logo-label">Inventory System</div>
          </div>
          <div id="login-error" class="login-error" style="display:none;"></div>
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Email address</label>
            <input class="fi" id="login-email" type="email" placeholder="you@aioapp.com" autocomplete="email" />
          </div>
          <div class="form-group" style="margin-bottom:20px;">
            <label class="form-label">Password</label>
            <input class="fi" id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" />
          </div>
          <button class="btn btn-orange login-btn" id="login-btn">Sign in</button>
          <div style="margin-top:12px;text-align:center;">
            <button id="btn-forgot-password" style="background:none;border:none;color:var(--aio-purple,#6e3fc8);font-size:13px;cursor:pointer;text-decoration:underline;padding:0;">Forgot password?</button>
          </div>
          <div class="login-footer">AIO App Inventory · Authorised users only</div>
        </div>
      </div>`;

    const doLogin = async () => {
      const email = document.getElementById('login-email').value.trim();
      const pass  = document.getElementById('login-password').value;
      const err   = document.getElementById('login-error');
      const btn   = document.getElementById('login-btn');

      if (!email || !pass) { showError('Please enter your email and password.'); return; }
      btn.textContent = 'Signing in...';
      btn.disabled = true;

      try {
        await Auth.signIn(email, pass);
        // Reload the page — this re-initialises everything with the authenticated user
        window.location.reload();
      } catch (e) {
        btn.textContent = 'Sign in';
        btn.disabled = false;
        const msg = e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found'
          ? 'Incorrect email or password.'
          : e.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please try again later.'
          : 'Sign in failed. Please try again.';
        showError(msg);
      }
    };

    function showError(msg) {
      const el = document.getElementById('login-error');
      if (el) { el.textContent = msg; el.style.display = 'block'; }
    }

    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    document.getElementById('btn-forgot-password').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const btn   = document.getElementById('btn-forgot-password');
      if (!email) {
        showError('Enter your email address above, then click Forgot password.');
        return;
      }
      btn.textContent = 'Sending...';
      btn.disabled = true;
      try {
        const { getAuth, sendPasswordResetEmail } =
          await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        await sendPasswordResetEmail(getAuth(), email);
        btn.textContent = '✓ Reset email sent — check your inbox';
        btn.style.color = '#1a7a3c';
        // Clear any error
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.style.display = 'none';
      } catch(e) {
        btn.textContent = 'Forgot password?';
        btn.disabled = false;
        const msg = e.code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : e.code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : 'Could not send reset email. Please try again.';
        showError(msg);
      }
    });

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
        <div style="font-size:11px;font-weight:700;color:var(--aio-purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Add new user</div>
        <div id="add-user-error" class="login-error" style="display:none;margin-bottom:10px;"></div>
        <div class="form-grid g2" style="margin-bottom:10px;">
          <div class="form-group">
            <label class="form-label">Full name *</label>
            <input class="fi" id="new-user-name" placeholder="e.g. John Smith" />
          </div>
          <div class="form-group">
            <label class="form-label">Email *</label>
            <input class="fi" id="new-user-email" type="email" placeholder="john@aioapp.com" />
          </div>
        </div>
        <div class="form-grid g2" style="margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label">Temporary password *</label>
            <input class="fi" id="new-user-pass" type="password" placeholder="Min 6 characters" />
          </div>
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
          <button class="btn btn-primary" id="btn-add-user-confirm">Add user</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#close-users-panel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    await refreshUsersList();

    overlay.querySelector('#btn-add-user-confirm').addEventListener('click', async () => {
      const name  = document.getElementById('new-user-name').value.trim();
      const email = document.getElementById('new-user-email').value.trim();
      const pass  = document.getElementById('new-user-pass').value;
      const role  = document.getElementById('new-user-role').value;
      const errEl = document.getElementById('add-user-error');
      const btn   = document.getElementById('btn-add-user-confirm');

      // Reactivation mode — button was switched after email-already-in-use on a deleted user
      if (btn.dataset.reactivateUid) {
        if (!confirm(`Reactivate this user with the name "${name}" and role "${role}"?\n\nA password reset email will be sent to ${email} so they can set their own password.`)) return;
        btn.textContent = 'Reactivating...'; btn.disabled = true;
        try {
          await UserManager.reactivateUser(btn.dataset.reactivateUid, name || email, role);
          await UserManager.sendPasswordReset(email);
          delete btn.dataset.reactivateUid;
          ['new-user-name','new-user-email','new-user-pass'].forEach(id => document.getElementById(id).value = '');
          errEl.style.display = 'none';
          await refreshUsersList();
          btn.textContent = '✓ Reactivated — reset email sent';
          setTimeout(() => { btn.textContent = 'Add user'; btn.disabled = false; }, 3000);
        } catch(e) {
          errEl.textContent = 'Error reactivating: ' + (e.message || 'Unknown error');
          errEl.style.display = 'block';
          btn.textContent = 'Reactivate user'; btn.disabled = false;
        }
        return;
      }

      // Ghost account restore flow
      if (btn.dataset.restoreEmail) {
        const restoreEmail = btn.dataset.restoreEmail;
        if (!confirm(`Restore access for ${restoreEmail}?\n\nThis will:\n1. Pre-create their profile (${name || restoreEmail}, role: ${role})\n2. Send them a password reset email so they can log back in.`)) return;
        btn.textContent = 'Restoring...'; btn.disabled = true;
        try {
          await UserManager.addPendingUser(restoreEmail, name || restoreEmail, role);
          await UserManager.sendPasswordReset(restoreEmail);
          delete btn.dataset.restoreEmail;
          ['new-user-name','new-user-email','new-user-pass'].forEach(id => document.getElementById(id).value = '');
          errEl.style.display = 'none';
          await refreshUsersList();
          btn.textContent = '✓ Reset email sent — profile ready';
          setTimeout(() => { btn.textContent = 'Add user'; btn.disabled = false; }, 3000);
        } catch(e) {
          errEl.textContent = 'Error restoring: ' + (e.message || 'Unknown');
          errEl.style.display = 'block';
          btn.textContent = 'Restore access'; btn.disabled = false;
        }
        return;
      }

      errEl.style.display = 'none';
      if (!name || !email || !pass) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return; }
      if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }

      btn.textContent = 'Adding...'; btn.disabled = true;

      try {
        await UserManager.addUser(email, pass, name, role);
        // Clear form
        ['new-user-name','new-user-email','new-user-pass'].forEach(id => document.getElementById(id).value = '');
        await refreshUsersList();
        btn.textContent = '✓ User added';
        setTimeout(() => { btn.textContent = 'Add user'; btn.disabled = false; }, 2000);
      } catch(e) {
        if (e.code === 'auth/email-already-in-use') {
          const allUsers = await UserManager.listUsers();
          const deleted  = allUsers.find(u => u.email === email && u.deleted);
          const active   = allUsers.find(u => u.email === email && !u.deleted);
          if (active) {
            errEl.textContent = 'That email is already registered to an active user.';
            errEl.style.display = 'block';
            btn.textContent = 'Add user'; btn.disabled = false;
          } else if (deleted) {
            // Soft-deleted — offer reactivation
            errEl.innerHTML = `<strong>This user was previously removed.</strong><br>
              <span style="font-size:12px;">Would you like to reactivate <strong>${esc(deleted.name||email)}</strong>?</span>`;
            errEl.style.display = 'block';
            btn.textContent = 'Reactivate user';
            btn.disabled = false;
            btn.dataset.reactivateUid = deleted.id;
          } else {
            // Ghost account — Firebase Auth exists but no Firestore doc (old hard-delete)
            errEl.innerHTML = `<strong>This email has an existing account.</strong><br>
              <span style="font-size:12px;">Their profile was previously removed. Click <strong>Restore access</strong> to send them a password reset and restore their profile with the name and role entered above.</span>`;
            errEl.style.display = 'block';
            btn.textContent = 'Restore access';
            btn.disabled = false;
            btn.dataset.restoreEmail = email;
          }
        } else {
          errEl.textContent = 'Error: ' + (e.message || 'Could not add user');
          errEl.style.display = 'block';
          btn.textContent = 'Add user'; btn.disabled = false;
        }
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
            <button class="btn btn-ghost btn-xs" data-reset-pass="${esc(u.email)}" style="font-size:11px;">Reset password</button>
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
          <button class="btn btn-ghost btn-xs" data-reset-pass="${esc(u.email)}" style="font-size:11px;">Reset password</button>
        </td>
      </tr>`).join('') : '';

      // Pending users — Firebase Auth exists, awaiting first login to create Firestore profile
      const pendingUsersMap = (typeof DB !== 'undefined') ? (DB.getData().pendingUsers || {}) : {};
      const pendingList = Object.entries(pendingUsersMap).map(([email, p]) => ({ email, ...p }));
      const pendingRows = pendingList.map(p => `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-weight:500;">${esc(p.name || '—')}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:12px;overflow-wrap:anywhere;">${esc(p.email)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);">${p.role || 'edit'} · awaiting login</td>
        <td style="padding:9px 8px;border-bottom:1px solid var(--border);text-align:right;display:flex;gap:6px;justify-content:flex-end;white-space:nowrap;">
          <button class="btn btn-ghost btn-xs" data-reset-pass="${esc(p.email)}" style="font-size:11px;">Send reset email</button>
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
          <div style="margin-top:14px;margin-bottom:6px;font-size:10px;font-weight:700;color:var(--aio-orange-dark, #c05000);text-transform:uppercase;letter-spacing:.06em;">Pending — awaiting first login</div>
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
          if (!confirm(`Remove ${btn.dataset.name}?\n\nThey will lose access immediately. You can reactivate them later from the Removed users section.`)) return;
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
          if (!confirm(`Reactivate ${btn.dataset.name} as ${role}?\n\nA password reset email will be sent to ${btn.dataset.email}.`)) return;
          btn.textContent = 'Reactivating...'; btn.disabled = true;
          try {
            await UserManager.reactivateUser(btn.dataset.reactivate, btn.dataset.name, role);
            await UserManager.sendPasswordReset(btn.dataset.email);
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

      // Wire reset password buttons
      container.querySelectorAll('button[data-reset-pass]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Send a password reset email to ${btn.dataset.resetPass}?`)) return;
          try {
            await UserManager.sendPasswordReset(btn.dataset.resetPass);
            btn.textContent = '✓ Email sent'; btn.disabled = true;
            setTimeout(() => { btn.textContent = 'Reset password'; btn.disabled = false; }, 3000);
          } catch(e) { alert('Error: ' + e.message); }
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
        <div style="font-size:13px;">${esc(c)} <span style="color:var(--text-hint);font-size:11px;">(${unitsByCustomer[c] || 0} deployed)</span></div>
        <input class="fi hubspot-id-input" data-customer="${esc(c)}" placeholder="HubSpot Company ID" value="${esc(map[c] || '')}" />
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
