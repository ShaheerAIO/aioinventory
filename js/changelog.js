/**
 * changelog.js — AIO Inventory · Release Notes
 * Updated with every deployment.
 */
var CHANGELOG = [
  {
    version: 'v106',
    date: '2026-08-04',
    title: 'Database Capacity — Storage Split',
    changes: [
      { type: 'new', text: 'The inventory database was approaching Firestore\'s 1MB per-document limit. The two biggest, ever-growing datasets can now be split into their own storage: the movements ledger moves to its own document and count history to one document per count (effectively unlimited room). Admins: the yellow capacity banner has a "Split the database now" button — one click migrates everything safely, then ask everyone to refresh the app' },
      { type: 'improved', text: 'The capacity warning now shows which data is using the space and reports the true main-database size. After the split, anything an old, un-refreshed tab writes back is automatically absorbed into the new storage' },
    ],
  },
  {
    version: 'v105',
    date: '2026-08-04',
    title: 'Stock Count — Completing a Count No Longer Duplicates It',
    changes: [
      { type: 'fixed', text: 'Completing a count now clears its auto-saved in-progress copy. Previously the finished count came back as a resumable "paused" count (banner + admin Active Counts panel), and completing that copy created a duplicate entry in Count History' },
      { type: 'fixed', text: 'Resuming a completed count from history and finishing it now updates the original history record in place instead of adding a second one. Serials already written off on that count stay written off instead of reappearing as missing' },
    ],
  },
  {
    version: 'v104',
    date: '2026-08-03',
    title: 'Stock Count — Date Scope Visible Everywhere',
    changes: [
      { type: 'new', text: 'Counts done with a "Received on/before" date filter now show that date everywhere after the fact: the variance report header, the count history table, the historical report view, the missing-stock review modal, the active-count scope label, and the exported CSV. Previously there was no way to tell what date range a completed count had covered' },
    ],
  },
  {
    version: 'v103',
    date: '2026-07-30',
    title: 'Stock Count — Received-Date Filter',
    changes: [
      { type: 'new', text: 'Stock Count setup now has a "Received on/before" date filter — pick a date and the count list only includes stock received up to that day, so untouched recent shipments (e.g. a whole room of new stock) can be left out of a physical count. Serials received after the cutoff still warn as "in stock but not in your count list" if scanned by mistake' },
      { type: 'fixed', text: 'Variance report "Value at risk" now uses the true average unit cost of in-stock items — previously it divided the whole product\'s stock value by only the counted units, which inflated the figure when counting a subset' },
    ],
  },
  {
    version: 'v102',
    date: '2026-07-15',
    title: 'Serial Rename Safety — No More Vanishing Units',
    changes: [
      { type: 'fixed', text: 'Editing/adding a serial number now blocks any serial that is already in use anywhere — deployed, in transit, RMA, total-loss or in stock — not just in-stock ones. Renaming a unit onto a serial already deployed to a customer used to silently make the unit disappear from stock; it now shows a clear error naming where that serial is already used' },
      { type: 'fixed', text: 'Repaired the HK1 RBOX D8 stock at San Jose: several units had been collapsed onto serial ADRB0AAHE00047 (deployed to Con Azucar - Gilroy), hiding them from the count. Recovered units are now distinct rows — 13 show as "+ Add serial" and need their real serial read off the device' },
    ],
  },
  {
    version: 'v101',
    date: '2026-04-15',
    title: 'Order Status Fix — Partial Shipments',
    changes: [
      { type: 'fixed', text: 'Order status no longer jumps to "Received" when a partial shipment arrives — it now compares actual received quantities against ordered quantities and stays "Partial" until everything has come in' },
      { type: 'fixed', text: 'Central Computers order corrected back to Partial — UMR-Industrial (10 units) and U-LTE-Backup Pro remaining (22 units) still outstanding and available to arrange/receive' },
    ],
  },
  {
    version: 'v100',
    date: '2026-04-15',
    title: 'Receive Shipment — Serial Number Scanning',
    changes: [
      { type: 'fixed', text: 'Receive Shipment modal now prompts for real serial numbers when a shipment contains NS- auto-generated placeholders — no more silent placeholder receipt' },
      { type: 'improved', text: 'Serial scanner per product line on receive: scan/type + Enter, bulk paste supported; leave blank for genuine non-serialised items to keep placeholder IDs' },
    ],
  },
  {
    version: 'v99',
    date: '2026-04-15',
    title: 'Part Shipment — Per-Product Include/Exclude Toggle',
    changes: [
      { type: 'improved', text: 'Split Shipment modal — each product now has a "✕ Not in this shipment" toggle button; excluded products are greyed out and skipped, no more typing 0 to exclude' },
      { type: 'improved', text: 'Receive Part modal — same "✕ Not in this delivery" toggle per product, leaving skipped items in transit' },
    ],
  },
  {
    version: 'v98',
    date: '2026-04-15',
    title: 'Part Shipment & Receive — UX Fixes',
    changes: [
      { type: 'fixed', text: 'Receive Part modal now finds shipment by PO number when orderId link is missing — no more "no active shipments" false negatives' },
      { type: 'improved', text: 'Receive Part modal — per-product "✕ Not in this delivery" button to exclude items that didn\'t arrive; they stay in transit' },
      { type: 'improved', text: 'Split Shipment — quantity can now be set to 0 to exclude a product from the current dispatch; only included items register as in transit' },
      { type: 'fixed', text: 'Order status now correctly updates to received even when shipment was created without orderId link (PO number fallback)' },
    ],
  },
  {
    version: 'v97',
    date: '2026-04-15',
    title: 'Navigation Fix',
    changes: [
      { type: 'fixed', text: 'Broken regex in split-shipment scanner caused app.js to fail loading entirely — navigation and all event wiring now works correctly' },
    ],
  },
  {
    version: 'v96',
    date: '2026-04-15',
    title: 'Partial Receive — Split Shipments from Orders',
    changes: [
      { type: 'new', text: 'In-transit orders now remain visible in the All Orders panel — no longer disappear after Arrange Shipment' },
      { type: 'new', text: '✂ Receive Part button on in-transit orders — receive a subset of units from a shipment, scanning real serial numbers on arrival to replace auto-generated placeholders' },
      { type: 'new', text: 'Receive All button on in-transit orders — quick-receive the full shipment directly from the Orders view without switching to the In Transit tab' },
      { type: 'improved', text: 'Serial scanner in partial receive modal supports type/scan + Enter and bulk paste, same as other scan flows' },
    ],
  },
  {
    version: 'v92',
    date: '2026-04-08',
    title: "Navigation Tidy-up — Records Group",
    changes: [
      { type: 'improved', text: 'Reports, Serial Lookup and History consolidated under a new "Records" dropdown — nav bar is now significantly cleaner' },
    ],
  },
  {
    version: 'v91',
    date: '2026-04-08',
    title: "Navigation Tidy-up — Catalog Group",
    changes: [
      { type: 'improved', text: 'Products and Suppliers consolidated under a new "Catalog" dropdown — keeps the top nav clean' },
    ],
  },
  {
    version: 'v90',
    date: '2026-04-08',
    title: "Changelog / What's New Page",
    changes: [
      { type: 'new', text: "What's New page added to the nav — shows full release history with version, date and colour-coded change badges" },
      { type: 'new', text: "changelog.js file introduced — updated with every deployment so users always see current release notes" },
    ],
  },
  {
    version: 'v89',
    date: '2026-04-08',
    title: 'Shipment History & Document Uploads',
    changes: [
      { type: 'new',  text: 'Shipment History tab added under Orders — shows all received shipments with full product breakdown and landed costs' },
      { type: 'new',  text: 'Document uploads — attach PDFs, images and documents to active and received shipments via Firebase Storage' },
      { type: 'new',  text: 'Delete button on Shipment History cards — removes the record without affecting received stock' },
      { type: 'improved', text: 'Purchase Orders tab now shows only pending and cancelled orders — in-transit and received orders move to their own views' },
      { type: 'improved', text: 'Receiving a shipment now automatically marks the linked purchase order as received' },
      { type: 'improved', text: 'Order flow clarified: Purchase Orders → In Transit → Shipment History' },
    ],
  },
  {
    version: 'v88',
    date: '2026-04-07',
    title: 'Audit & Stock Count Improvements',
    changes: [
      { type: 'new',  text: 'Audit system supports NS- (no-serial) items throughout the count and variance flow' },
      { type: 'new',  text: 'Missing serials at count time are written off as lost stock via isLost OUT movements' },
      { type: 'new',  text: 'Audit CSV export added to variance report' },
      { type: 'improved', text: 'Deployed stock explicitly excluded from stock counts — deployed items are at customer sites' },
      { type: 'improved', text: 'Paused audits persisted per user so count progress is not lost on refresh' },
    ],
  },
  {
    version: 'v80',
    date: '2026-03-28',
    title: 'Purchase Orders & Freight Cost Splitting',
    changes: [
      { type: 'new',  text: 'Purchase Orders tab — place orders with supplier, products, quantities and unit costs' },
      { type: 'new',  text: 'Freight cost splitting — freight is distributed proportionally across product lines by value, updating landed cost per unit' },
      { type: 'new',  text: 'Price locking — unit costs are locked at order time and carried through to stock receipt' },
      { type: 'new',  text: 'Arrange Shipment workflow — converts a purchase order into an In Transit shipment' },
      { type: 'new',  text: 'Tax support on orders — GST/VAT amount, rate and reference stored and shown in order breakdown' },
    ],
  },
  {
    version: 'v70',
    date: '2026-03-15',
    title: 'Workshop, Servicing & RMA',
    changes: [
      { type: 'new',  text: 'Servicing view — stat cards and per-product breakdown with cost column for items under repair' },
      { type: 'new',  text: 'Servicing outcomes: Working / Fail-RMA / Fail-Total Loss' },
      { type: 'new',  text: 'RMA and Total Loss views with dispatch tracking' },
      { type: 'new',  text: 'Workshop navigation group consolidating Servicing, RMA and Total Loss' },
      { type: 'improved', text: 'Recall to servicing from Stock Holding with reason capture' },
    ],
  },
  {
    version: 'v60',
    date: '2026-03-05',
    title: 'Stock Holding Conditions & SmartSelect',
    changes: [
      { type: 'new',  text: 'Stock Holding dashboard — per-product breakdown by condition: ✅ Working / 🔬 Testing / ⚠ Faulty / ⛔ RMA / 🗑 TL' },
      { type: 'new',  text: 'Working condition explicitly excludes items with any condition flag' },
      { type: 'new',  text: 'SmartSelect applied to supplier and location fields across Stock In, In Transit and modals' },
      { type: 'new',  text: 'Condition pills on serial detail view with one-click updates' },
      { type: 'improved', text: 'Batch IN condition bleed bug fixed — conditions are now tracked per-serial' },
    ],
  },
  {
    version: 'v50',
    date: '2026-02-20',
    title: 'Suppliers, Products & Navigation Groups',
    changes: [
      { type: 'new',  text: 'Suppliers tab — manage supplier records with contact info, notes and order history auto-population' },
      { type: 'new',  text: 'Products tab — dynamic product management with categories and default thresholds' },
      { type: 'new',  text: 'Grouped navigation dropdowns: Stock Movements, Stock Info, Workshop, Orders' },
      { type: 'new',  text: 'No-serial product support — NS- prefix items handled throughout all views' },
      { type: 'improved', text: 'Product dropdown repopulates correctly after adding new products' },
    ],
  },
  {
    version: 'v40',
    date: '2026-02-05',
    title: 'Stock Deployed & Pending Deployments',
    changes: [
      { type: 'new',  text: 'Stock Deployed view — track units at customer sites with customer, location and cost' },
      { type: 'new',  text: 'Pending deployments — stage a deployment for review before confirming' },
      { type: 'new',  text: 'Confirm / cancel pending deployment workflow' },
      { type: 'new',  text: 'Deployed stock excluded from Stock Holding counts automatically' },
    ],
  },
  {
    version: 'v30',
    date: '2026-01-20',
    title: 'In Transit & Multi-user Auth',
    changes: [
      { type: 'new',  text: 'In Transit tab — register incoming shipments before stock arrives' },
      { type: 'new',  text: 'Receive shipment modal — confirm location and receiver on arrival' },
      { type: 'new',  text: 'Firebase Authentication — role-based access (admin / staff)' },
      { type: 'new',  text: 'Real-time sync via Firestore onSnapshot — all users see live updates' },
      { type: 'new',  text: 'User management — admin can create and manage user accounts' },
    ],
  },
  {
    version: 'v20',
    date: '2026-01-08',
    title: 'Stock In / Out & Movement History',
    changes: [
      { type: 'new',  text: 'Stock In — receive items into stock with supplier, location, PO number and serial numbers' },
      { type: 'new',  text: 'Stock Out — remove items from stock with reason and destination' },
      { type: 'new',  text: 'Movement History — full searchable log of all IN/OUT movements with filters' },
      { type: 'new',  text: 'Serial number lookup — find any serial and see its full movement history' },
      { type: 'new',  text: 'Low stock alerts on dashboard based on per-product thresholds' },
    ],
  },
  {
    version: 'v10',
    date: '2025-12-20',
    title: 'Initial Release',
    changes: [
      { type: 'new',  text: 'AIO Inventory system launched — cloud-based inventory management on GitHub Pages + Firebase' },
      { type: 'new',  text: 'Dashboard with stock summary stats and per-product breakdown' },
      { type: 'new',  text: 'Stock Holding table with product, category, location and quantity' },
      { type: 'new',  text: 'Dark mode support' },
      { type: 'new',  text: 'Firebase Firestore backend — data persists and syncs across sessions' },
    ],
  },
];

// ── Standalone render function — no dependencies on UI IIFE ──────────────
function renderChangelog() {
  var container = document.getElementById('changelog-body');
  if (!container) return;

  if (!CHANGELOG || !CHANGELOG.length) {
    container.innerHTML = '<div class="empty">No release notes available.</div>';
    return;
  }

  function safe(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var typeLabel = { 'new': 'New', 'improved': 'Improved', 'fixed': 'Fixed' };
  var typeClass  = { 'new': 'cl-new', 'improved': 'cl-improved', 'fixed': 'cl-fixed' };

  var html = '';
  for (var i = 0; i < CHANGELOG.length; i++) {
    var entry = CHANGELOG[i];
    var d = new Date(entry.date + 'T00:00:00');
    var dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var isLatest = i === 0;

    var changesHtml = '';
    for (var j = 0; j < entry.changes.length; j++) {
      var c = entry.changes[j];
      var badge = typeClass[c.type] || 'cl-new';
      var label = typeLabel[c.type] || c.type;
      changesHtml += '<li class="cl-item">' +
        '<span class="cl-badge ' + badge + '">' + label + '</span>' +
        '<span class="cl-text">' + safe(c.text) + '</span>' +
        '</li>';
    }

    html += '<div class="cl-entry' + (isLatest ? ' cl-entry-latest' : '') + '">' +
      '<div class="cl-entry-header">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
          '<span class="cl-version">' + safe(entry.version) + '</span>' +
          (isLatest ? '<span class="cl-latest-badge">Latest</span>' : '') +
          '<span class="cl-entry-title">' + safe(entry.title) + '</span>' +
        '</div>' +
        '<span class="cl-date">' + dateStr + '</span>' +
      '</div>' +
      '<ul class="cl-list">' + changesHtml + '</ul>' +
    '</div>';
  }

  container.innerHTML = html;
}

// Auto-update nav version label
document.addEventListener('DOMContentLoaded', function() {
  var el = document.getElementById('app-version-label');
  if (el && CHANGELOG && CHANGELOG.length) el.textContent = CHANGELOG[0].version;
});
