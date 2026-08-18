# AIO Inventory System

## Overview
A serial-number-level inventory management web app for AIO App, tracking hardware devices (POS terminals, printers, routers, kiosks, etc.) through their full lifecycle: purchase orders, in-transit shipments, stock holding, deployment to customers, servicing/RMA, total loss, and physical stock audits. It is a single-page app built with plain HTML/CSS/vanilla JavaScript (no build step, no framework, no npm dependencies). Data is stored in **Firebase Firestore** with real-time multi-user sync, gated behind **Firebase Auth** (email/password) with role-based access. It is designed to be served as static files (e.g. GitHub Pages).

> Note: `README.md` is outdated — it describes a localStorage-only, no-auth version with far fewer features. The actual app uses Firebase and has many more modules/views. Trust the source files over the README.

## Tech Stack
- **Languages:** HTML, CSS, vanilla JavaScript (ES modules loaded dynamically via `import()`)
- **Backend:** Firebase Firestore (database) + Firebase Auth (email/password) — Firebase SDK v10.12.0 imported from `gstatic.com` CDN at runtime
- **Third-party libraries (loaded from CDN, no npm):**
  - `xlsx` (SheetJS 0.20.3) — Excel/CSV export, loaded via `<script>` in `index.html`
  - `html5-qrcode` (2.3.8) — camera barcode scanning, lazy-loaded by `js/scanner.js`
- **No build tooling.** No `package.json`, no bundler, no transpilation.

## Architecture
The app is a collection of **IIFE module singletons** attached to `window` (e.g. `DB`, `Auth`, `Inventory`, `UI`, `Reports`, `Audit`, `Scanner`, `AuthUI`, `CHANGELOG`). They communicate by calling each other's public methods directly (no module system / no exports beyond globals). Load order matters and is fixed in `index.html`.

Layered design:
- **Storage layer (`db.js`)** — `DB` singleton. Reads/writes a single Firestore document `inventory/main` containing all app data (`movements`, `thresholds`, `shipments`, `serialCosts`, `serialConditions`, `orders`, `suppliers`, `productRecords`, `auditRecords`, `pendingUsers`, `pendingDeployments`, `pausedAudits`, etc.). Uses `onSnapshot` for real-time sync across users; falls back to `localStorage` key `aio_inventory_v2` if Firebase init fails.
- **Auth layer (`auth.js`, `auth-ui.js`)** — `Auth` handles Firebase Auth + a Firestore `users/<uid>` profile doc (`{ name, email, role }`). `AuthUI` renders the login screen, the user header bar, and the admin Users panel. Roles: `admin`, `edit`, `viewer`. `Auth.isAdmin()` = admin only; `Auth.canEdit()` = admin or edit.
- **Business logic (`inventory.js`)** — `Inventory` singleton: pure-ish functions over `DB` data. Defines the product catalog (`HARDCODED_PRODUCTS` / `PRODUCTS`) and `CATEGORIES`, and computes serial statuses (in-stock, in-transit, deployed, RMA, total-loss). Public API includes `stockIn`, `stockOut`, `createOrder`, `createShipment`, `receiveShipment`, `receivePartialShipment`, `confirmDeployment`, `getStats`, `getAllSerialRows`, `getLowStockItems`, etc.
- **Rendering (`ui.js`)** — `UI` singleton: renders every view (dashboard, stock lists, deployed, transit, lookup, history, etc.) into the `<section class="view">` containers in `index.html`. Largest file.
- **Reporting (`reports.js`)** — `Reports` singleton: KPI/summary builders and report exports (uses `xlsx`).
- **Stock audit (`audit.js`)** — `Audit` singleton: 3-phase physical stock count (build count list → count/scan → variance report), with pause/resume support.
- **Scanner (`scanner.js`)** — `Scanner` singleton: camera barcode scanning, attachable to input fields.
- **Event wiring & navigation (`app.js`)** — bootstraps the app: gates everything behind `Auth.onReady`, shows login if logged out, otherwise injects the user bar, waits for `DB.onReady`, applies role restrictions, and shows the dashboard. Wires all nav buttons (`data-view="..."`) and form events.

Views are sections `#v-<name>` in `index.html`; navigation buttons carry `data-view="<name>"` and `app.js` toggles visibility.

**Cloud Functions (`functions/`)** — Node 20, `firebase-functions` v2, deployed separately from the
static frontend (`firebase deploy --only functions`; the frontend is GitHub Pages).
`hubspotNightlySync` (scheduled) and `hubspotSyncManual` (HTTP, shared-secret query param) push
deployed-hardware rollups into HubSpot. `metrics` (HTTP, `X-Metrics-Key` header) is a read-only
aggregate feed for the executive dashboard — stock/deployed/in-transit units and value, plus
per-period received/deployed/RMA flows. Secrets are Firebase Secret Manager params
(`defineSecret`): `HUBSPOT_TOKEN`, `MANUAL_TRIGGER_KEY`, `METRICS_KEY`. All three functions read
inventory through `inventoryStats.js`.

**`functions/inventoryStats.js` is the single server-side copy of the aggregation rules** —
a reimplementation of `getAvailableSerials` / `getDeployedSerialRows` / `getDeployedByCustomer`
from `js/inventory.js`, which can't be imported into a Cloud Function because it's a browser
IIFE global. Both the HubSpot sync and the metrics endpoint use it. **If you change how stock or
deployment is derived in `js/inventory.js`, change it here too** — nothing enforces this.
It takes `db` as a parameter rather than importing `firebase-admin`, so it is unit-testable
without Firebase.

## Key Files & Entry Points
- `index.html` — single-page app shell: header/nav, all view templates (`#v-dashboard`, `#v-orders`, `#v-transit`, `#v-stock-list`, `#v-deployed`, `#v-stocktake`, `#v-reports`, `#v-lookup`, `#v-history`, etc.), and the ordered `<script>` tags. **The app entry point.**
- `js/auth.js` — Firebase Auth + user-profile/role logic (`Auth`).
- `js/auth-ui.js` — login screen, user bar, admin Users panel (`AuthUI`).
- `js/scanner.js` — camera barcode scanner (`Scanner`).
- `js/db.js` — Firestore storage layer + localStorage fallback (`DB`). **Contains the Firebase config (apiKey, projectId `aio-inventory-b9b29`, etc.).**
- `js/inventory.js` — core business logic + product catalog & categories (`Inventory`).
- `js/reports.js` — reporting suite (`Reports`).
- `js/ui.js` — all DOM rendering (`UI`).
- `js/audit.js` — physical stock-count workflow (`Audit`).
- `js/changelog.js` — `CHANGELOG` array powering the "What's New" view; currently at `v101`.
- `functions/index.js` — Cloud Function entry points (`hubspotNightlySync`, `hubspotSyncManual`, `metrics`).
- `functions/inventoryStats.js` — shared server-side inventory aggregation (see above).
- `functions/hubspotSync.js` — HubSpot company rollup logic.
- `js/app.js` — boot, navigation, event wiring (IIFE, no exports).
- `css/styles.v4.css` — the active stylesheet (referenced by `index.html`). `styles.css` and `styles.v2.css` are older/unused versions.
- `logo.png` — app/login logo. `.nojekyll` — disables Jekyll for GitHub Pages.

## Build / Run / Test
There is **no build step and no test suite** in this repo.

Run locally as static files (commands from `README.md`):
```bash
# Serve the project root with any static server:
npx serve .
# or
python3 -m http.server 8080
```
Then open the served URL (e.g. `http://localhost:8080`). Opening `index.html` via `file://` may fail because the JS uses dynamic ES-module imports and Firebase — use a local HTTP server.

Deploy: push to GitHub and enable **Settings → Pages → Deploy from branch → main → / (root)** (per `README.md`). `.nojekyll` is present for this.

Data backup/restore via browser console: `DB.exportJSON()` and `DB.importJSON('<json>')`.

## Conventions & Gotchas
- **Script load order is load-bearing** (see bottom of `index.html`): `auth.js → auth-ui.js → scanner.js → db.js → inventory.js → reports.js → xlsx → ui.js → audit.js → changelog.js → app.js`. Each module assumes its dependencies are already defined as globals.
- **Cache-busting query strings** (`?v=101`, `?v=108`, ...) are appended to each `<script src>` in `index.html`. When you change a JS file, **bump its version number** in `index.html` so browsers reload it.
- **Firebase config is committed in source** (`db.js` and `auth.js` both inline the same `FB_CONFIG` for project `aio-inventory-b9b29`). This is a client-side Firebase web key (normal for Firebase), but be aware it is in the repo; security relies on Firestore/Auth rules, not on hiding the key.
- **Single shared Firestore document** (`inventory/main`) holds *all* inventory data and is fully read into memory and rewritten on save. Writes set a `_pendingWrite` flag so the app ignores its own `onSnapshot` echo. Keep this in mind for concurrency — last write generally wins on the whole document.
- **Modules are IIFE singletons exposing a returned object** — to add functionality, add a method to the relevant module's returned object (see the `return { ... }` at the bottom of each `js/*.js`) and call it from `app.js`/`ui.js`. There is no import/export wiring.
- **Roles gate the UI**: `AuthUI.applyRoleRestrictions()` (called on boot) hides/disables editing for non-editors. `Auth.canEdit()` and `Auth.isAdmin()` are the gates; respect them when adding write actions.
- **A location ("warehouse") is not an entity** — it is a string on each movement, and stock is
  bucketed by `product||location`. A unit's location is the one on its latest `IN` movement.
- **Warehouse-to-warehouse moves are a two-step protocol** in `js/inventory.js`:
  `dispatchTransfer` writes an `OUT` leg per product bucket and a record in the `transfers` store
  (`DB.addTransfer`, main Firestore doc); `receiveTransfer` writes the `IN` legs at the destination
  (accepts a subset for a part-load); `cancelTransfer` writes them back at the source. Units between
  the two steps are **in flight**: not in `getAvailableSerials()`, not deployed, surfaced as
  `status: 'in-transit'` rows filed under the destination. Every leg is flagged `isTransfer: true`,
  and **anything that reads an `OUT` as a dispatch or an `IN` as a supplier receipt must skip them** —
  `getDeployedSerialRows`, `getCustomerDetail`, `getStats`, and `functions/inventoryStats.js`
  (which must also count in-flight transfers as in-transit). Transfer `IN` legs carry the provenance
  fields `getAllSerialRows` reads off the latest `IN` (condition, used, tested*, PO, `receivedDate`),
  so a move never resets a unit's condition or its stock age.
- **Serial numbers are the primary key** for units. Auto-generated placeholders use an `NS-` prefix (non-serialised items); real serials replace these on receipt. Serials are generally upper-cased before lookup.
- **HTML is built via template strings** with manual escaping (`esc(...)` helpers defined per module). When rendering user/data-driven text, escape it the same way to avoid breaking markup.
- `README.md` and `js/changelog.js` are maintained by hand; the changelog is the most reliable record of recent feature work.
