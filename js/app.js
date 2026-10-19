/**
 * app.js — navigation, view-level event wiring, and boot. The data-entry forms are in js/forms/.
 */
(() => {








  // ── Navigation ────────────────────────────────────────────────────────
  const VIEWS = ['dashboard','products','suppliers','orders','transit','transfers','shipment-history','changelog','in','out','stock-list','deployed','servicing','rma','totalloss','rmatldisp','stocktake','reports','lookup','history','activity','map-devices'];

  function showView(view) {
    VIEWS.forEach(v => { document.getElementById('v-' + v).style.display = v === view ? '' : 'none'; });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.nav-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    // Keep dropdown toggle highlighted when a child view is active
    document.querySelectorAll('.nav-dropdown').forEach(dd => {
      const hasActive = dd.querySelector('.nav-dropdown-item.active');
      dd.querySelector('.nav-dropdown-toggle')?.classList.toggle('active', !!hasActive);
    });
    UI.hideAlert();
    if (view === 'dashboard')  UI.renderDashboard();
    if (view === 'products')   UI.renderProductList();
    if (view === 'suppliers')  UI.renderSupplierList();
    if (view === 'orders')     { UI.populateDataLists(); Forms.showOrderForm(); UI.renderOrderList(); }
    if (view === 'transit')    { UI.populateDataLists(); Forms.showTransitForm(); UI.renderTransitList(); }
    if (view === 'transfers')  UI.renderTransferList();
    if (view === 'stock-list') { UI.populateStockListFilters(); UI.renderStockBreakdown(); UI.renderStockList(); }
    if (view === 'deployed')   { UI.populateDeployedFilters(); UI.renderDeployed(); }
    if (view === 'servicing')  UI.renderServicing();
    if (view === 'rma')        UI.renderRMA();
    if (view === 'totalloss')  UI.renderTotalLoss();
    if (view === 'rmatldisp')  UI.renderRmaTlDispatched();
    if (view === 'reports')    { Reports.render(); Reports.renderWrittenOff(); }
    if (view === 'stocktake')  Audit.init();
    if (view === 'history')    { UI.populateCategoryFilters(); UI.renderHistory(); }
    if (view === 'activity')   Activity.render();
    if (view === 'map-devices') DeviceMap.render();
    if (view === 'shipment-history') UI.renderShipmentHistory();
    if (view === 'changelog')        renderChangelog();
    if (view === 'in')         { UI.populateDataLists(); Forms.showStockIn(); }
    if (view === 'out')        { UI.populateDataLists(); Forms.showStockOut(); }
    if (view === 'lookup')     setTimeout(() => document.getElementById('lookup-input').focus(), 50);
  }

  // Nav buttons (top-level)
  document.querySelectorAll('.nav-btn:not(.nav-dropdown-toggle)').forEach(btn => btn.addEventListener('click', () => showViewTracked(btn.dataset.view)));

  // In-page shortcuts to another view (e.g. Transfers → Stock Holding)
  document.querySelectorAll('[data-goto-view]').forEach(btn => btn.addEventListener('click', () => showViewTracked(btn.dataset.gotoView)));

  // Dropdown toggle
  document.querySelectorAll('.nav-dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = toggle.closest('.nav-dropdown');
      const isOpen = dd.classList.contains('open');
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
      if (!isOpen) dd.classList.add('open');
    });
  });

  // Dropdown items
  document.querySelectorAll('.nav-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
      showViewTracked(item.dataset.view);
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  });

  // ── Bindings ──────────────────────────────────────────────────────────
  function bind(id, ev, fn) { const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); }


  bind('btn-export-inv',        'click', UI.exportInventoryCSV);
  bind('btn-export-deployed',   'click', UI.exportDeployedCSV);
  bind('btn-export-deployed-xlsx', 'click', UI.exportDeployedXLSX);
  bind('btn-export-hist',       'click', UI.exportHistoryCSV);

  bind('btn-rpt-run',      'click', Reports.render);
  bind('btn-rpt-export',   'click', Reports.exportAll);
  bind('btn-rpt-backup',   'click', UI.downloadBackup);

  bind('dep-pending-toggle',  'click', UI.togglePendingCollapse);
  bind('dep-pending-chevron', 'click', UI.togglePendingCollapse);
  bind('dep-search',         'input',  () => UI.renderDeployed());
  bind('dep-cat-filter',     'change', () => UI.renderDeployed());
  bind('dep-customer-filter','change', () => UI.renderDeployed());
  bind('dep-tab-unit',       'click',  () => UI.setDeployedTab('unit'));
  bind('dep-tab-restaurant', 'click',  () => UI.setDeployedTab('restaurant'));
  bind('dep-detail-back',    'click',  UI.closeRestaurantDetail);
  bind('dep-bucket-search',  'input',  () => UI.renderDeployed());
  bind('btn-lookup',            'click', () => UI.renderLookup(document.getElementById('lookup-input').value));

  bind('inv-search',       'input',  () => UI.renderStockList());
  bind('inv-cat-filter',   'change', () => UI.renderStockList());
  bind('inv-loc-filter',   'change', () => UI.renderStockList());
  bind('inv-status-filter','change', () => UI.renderStockList());

  bind('svc-search',      'input',  () => UI.renderServicing());
  bind('svc-flag-filter', 'change', () => UI.renderServicing());
  bind('rma-search',        'input',  () => UI.renderRMA());
  bind('rma-status-filter', 'change', () => UI.renderRMA());

  bind('tl-search',         'input',  () => UI.renderTotalLoss());
  bind('tl-status-filter',  'change', () => UI.renderTotalLoss());

  bind('rmatldisp-search',       'input',  () => UI.renderRmaTlDispatched());
  bind('rmatldisp-type-filter',  'change', () => UI.renderRmaTlDispatched());

  bind('hist-search',      'input',  () => UI.renderHistory());
  bind('hist-type-filter', 'change', () => UI.renderHistory());
  bind('hist-cat-filter',  'change', () => UI.renderHistory());
  bind('hist-date-from',   'change', () => UI.renderHistory());
  bind('hist-date-to',     'change', () => UI.renderHistory());

  const outField = document.getElementById('out-serial-field');
  if (outField) {
    outField.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===',') { e.preventDefault(); outField.value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerialOut); outField.value=''; }});
    outField.addEventListener('paste', e => { e.preventDefault(); (e.clipboardData||window.clipboardData).getData('text').split(/[\n,\t]+/).map(v=>v.trim()).filter(Boolean).forEach(addSerialOut); outField.value=''; });
  }

  bind('rpt-run',         'click', Reports.renderAll);
  bind('rpt-clear-dates', 'click', () => {
    document.getElementById('rpt-date-from').value = '';
    document.getElementById('rpt-date-to').value   = '';
    Reports.renderAll();
  });
  // Export buttons on each report section
  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => Reports.exportReport(btn.dataset.export));
  });

  bind('lookup-input','keydown', e => { if(e.key==='Enter') UI.renderLookup(document.getElementById('lookup-input').value); });



  // ── Track current view for real-time refresh ──────────────────────────
  // Each view gets a #hash history entry, so the browser/mouse Back button
  // steps between views instead of leaving the app.
  const ADMIN_VIEWS = ['activity', 'map-devices'];
  function _viewFromHash() {
    const v = decodeURIComponent(location.hash.slice(1));
    if (!VIEWS.includes(v)) return null;
    if (ADMIN_VIEWS.includes(v) && !Auth.isAdmin()) return null;
    return v;
  }

  function showViewTracked(view, fromHistory) {
    if (!fromHistory && location.hash !== '#' + view) history.pushState(null, '', '#' + view);
    _currentView = view;
    showView(view);
    Forms.autoFillUser();
  }

  window.addEventListener('popstate', () => showViewTracked(_viewFromHash() || 'dashboard', true));

  // ── Boot: gate everything behind Firebase Auth ────────────────────────
  document.getElementById('alert-box').textContent = '⏳ Loading...';
  document.getElementById('alert-box').className   = 'alert alert-success show';

  Auth.onReady((isLoggedIn) => {
    document.getElementById('alert-box').classList.remove('show');

    if (!isLoggedIn) {
      // Show login screen — replaces entire page
      AuthUI.showLoginScreen();
      // When auth state changes to logged in, reload
      return;
    }

    // User is logged in — inject user bar into header
    AuthUI.injectUserBar();

    // Wait for DB then render
    DB.onReady(() => {
      // Apply view-only restrictions if not editor/admin
      AuthUI.applyRoleRestrictions();
      if (Auth.isAdmin()) {
        document.getElementById('nav-activity').style.display = '';
        document.getElementById('nav-map-devices').style.display = '';
        document.getElementById('dm-refresh').addEventListener('click', () => DeviceMap.refresh());
      }
      UI.initSmartSelects();
      const startView = _viewFromHash() || 'dashboard';
      history.replaceState(null, '', '#' + startView);
      showViewTracked(startView, true);
    });
  });

})();
