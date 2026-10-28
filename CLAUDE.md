# AIO Inventory System

## Overview
A serial-number-level inventory management web app for AIO App, tracking hardware devices (POS terminals, printers, routers, kiosks, etc.) through their full lifecycle: purchase orders, in-transit shipments, stock holding, deployment to customers, servicing/RMA, total loss, and physical stock audits. It is a single-page app built with plain HTML/CSS/vanilla JavaScript (no build step, no framework, no npm dependencies). Data is stored in **Firebase Firestore** with real-time multi-user sync, gated behind **Firebase Auth** using **Microsoft Entra ID SSO** with role-based access. It is deployed as static files on **Vercel** (project `aioinventory` under the `aioapp1` team, `https://aioinventory.vercel.app`, auto-built from pushes to `main`).

## Tech Stack
- **Languages:** HTML, CSS, vanilla JavaScript (ES modules loaded dynamically via `import()`)
- **Backend:** Firebase Firestore (database) + Firebase Auth via the `microsoft.com` OAuth provider (Microsoft Entra ID) — Firebase SDK v10.12.0 imported from `gstatic.com` CDN at runtime
- **Third-party libraries (loaded from CDN, no npm):**
  - `xlsx` (SheetJS 0.20.3) — Excel/CSV export, loaded via `<script>` in `index.html`
- **No build tooling.** No `package.json`, no bundler, no transpilation.

## Architecture
The app is a collection of **IIFE module singletons** attached to `window` (e.g. `DB`, `Auth`, `Inventory`, `UI`, `Reports`, `Audit`, `AuthUI`, `CHANGELOG`). They communicate by calling each other's public methods directly (no module system / no exports beyond globals). Load order matters and is fixed in `index.html`.

Layered design:
- **Storage layer (`db.js`)** — `DB` singleton. Reads/writes a single Firestore document `inventory/main` containing all app data (`movements`, `thresholds`, `shipments`, `serialCosts`, `serialConditions`, `orders`, `suppliers`, `productRecords`, `auditRecords`, `pendingUsers`, `pendingDeployments`, `pausedAudits`, etc.). Uses `onSnapshot` for real-time sync across users; falls back to `localStorage` key `aio_inventory_v2` if Firebase init fails.
- **Auth layer (`auth.js`, `auth-ui.js`)** — `Auth` handles Firebase Auth + a Firestore `users/<uid>` profile doc (`{ name, email, role }`). Sign-in is `Auth.signInWithMicrosoft()`, pinned to the AIO Entra tenant by `ENTRA_TENANT_ID` at the top of `auth.js`. `AuthUI` renders the login screen, the user header bar, and the admin Users panel. Roles: `superadmin`, `admin`, `edit`, `view`. `Auth.isAdmin()` = admin or superadmin; `Auth.canEdit()` = any of those or edit; `Auth.isSuperAdmin()` = superadmin only — it unlocks the Serial Lookup "Edit all properties" editor (`Inventory.superEditSerial` → `DB.editSerialProperties`, logged with before/after values). Only a superadmin can grant, change or revoke superadmin (enforced in `firestore.rules`), and it can never come from a `pendingUsers` pre-assignment. See `ENTRA-SETUP.md` for the Entra/Firebase console configuration.
- **Business logic (`inventory.js`)** — `Inventory` singleton: pure-ish functions over `DB` data. Defines the product catalog (`HARDCODED_PRODUCTS` / `PRODUCTS`) and `CATEGORIES`, and computes serial statuses (in-stock, in-transit, deployed, RMA, total-loss). Public API includes `stockIn`, `stockOut`, `createOrder`, `createShipment`, `receiveShipment`, `receivePartialShipment`, `confirmDeployment`, `getStats`, `getAllSerialRows`, `getLowStockItems`, etc.
- **Rendering (`js/ui/`)** — `UI` singleton, one file per view (dashboard, stock list, deployed, transit, lookup, history, etc.) rendering into the `<section class="view">` containers in `index.html`. `js/ui/core.js` defines `UI` and the shared helpers (`esc`, date formatting, alerts, SmartSelect); each view file attaches its public renderers to `UI` and any helper another file needs to `UI._`. Files pull core helpers from `UI._` at load, but call *other view files* through `UI.x` / `UI._.x` at call time — view files reference each other in cycles, so never destructure a non-core helper at load.
- **Reporting (`reports.js`)** — `Reports` singleton: KPI/summary builders and report exports (uses `xlsx`).
- **Stock audit (`audit.js`)** — `Audit` singleton: 3-phase physical stock count (build count list → count/scan → variance report), with pause/resume support.
- **Event wiring & navigation (`app.js`)** — bootstraps the app: gates everything behind `Auth.onReady`, shows login if logged out, otherwise injects the user bar, waits for `DB.onReady`, applies role restrictions, and shows the view named in the URL hash (else the dashboard). Wires all nav buttons (`data-view="..."`) and view-level filters/exports; navigating pushes `#<view>` onto browser history and `popstate` re-renders, so Back/Forward stay inside the app. Admin-only views (`activity`, `map-devices`) fall back to the dashboard for non-admins. The data-entry forms live in `js/forms/` (`Forms`).

Views are sections `#v-<name>` in `index.html`; navigation buttons carry `data-view="<name>"` and `app.js` toggles visibility.

**Cloud Functions (`functions/`)** — Node 22, `firebase-functions` v2, deployed separately from the
static frontend (`firebase deploy --only functions`; the frontend is on Vercel).
`aioDevices` (HTTP, Firebase ID token + role: admin reads, super admin writes) backs Map Devices and
holds the AIO dashboard service-account login as secrets `AIO_DASHBOARD_USERNAME` / `AIO_DASHBOARD_PASSWORD`,
plus a read-only UniFi Site Manager key `UNIFI_API_KEY` (`functions/unifi.js`, `action=unifi`; UniFi device id = MAC = inventory serial).
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
- `js/db.js` — Firestore storage layer + localStorage fallback (`DB`). **Contains the Firebase config (apiKey, projectId `aio-inventory-b9b29`, etc.).**
- `js/activity.js` — permanent activity log (`Activity`). Wraps the mutating `DB.*` methods (and `UserManager`, sign-in/out) at load time and writes one append-only doc per user action to the `activityLog` collection, stamped with the signed-in uid/email. **A new write method on `DB` is not logged until you add it to `OPS` in this file.** Admin-only viewer at Records → Activity Log.
- `js/inventory.js` — core business logic + product catalog & categories (`Inventory`).
- `js/reports.js` — reporting suite (`Reports`).
- `js/ui/*.js` — DOM rendering (`UI`), one file per view/modal; `core.js` loads first.
- `js/forms/*.js` — the data-entry forms (Stock In, In Transit, Orders, Stock Out, Products, Suppliers) as `Forms`; `shared.js` loads first and holds the product-row/serial-row builders. Each form owns its row state, its button bindings, and a `Forms.show…()` that `app.js` calls on navigation.
- `js/audit.js` — physical stock-count workflow (`Audit`).
- `js/changelog.js` — `CHANGELOG` array powering the "What's New" view; currently at `v132`.
- `functions/index.js` — Cloud Function entry points (`hubspotNightlySync`, `hubspotSyncManual`, `metrics`).
- `functions/inventoryStats.js` — shared server-side inventory aggregation (see above).
- `functions/hubspotSync.js` — HubSpot company rollup logic.
- `functions/hubspotDocs.js` — `hubspotCompanyDocs` (HTTP, any signed-in role): a linked company's quotes and invoices (direct + via its deals, deduped) with HubSpot record and public links, shown on Stock Out by `HubspotPicker.renderDocs`. Needs the token's quote/invoice read scopes. Tested by `test/hubspot-docs.test.js`.
- `functions/buddyAccess.js` + `js/buddy-access.js` — the Buddy Access picker. `aioBuddyAccess` (HTTP, super admin only) adds restaurants to an AIO Buddy account the super admin picks by name/email (the id must be in the dashboard's buddy list — `resolveBuddy` — so only existing buddies can be edited) as the same ops service account `aioDevices` uses, so that account must hold the dashboard's `aiobuddy-*` permissions (granted once by a super admin; no super admin login lives in the cloud). The dashboard's buddy update **replaces the whole record**, so a grant reads it, appends, writes it all back, re-reads and restores the original if anything was dropped. Add-only. Tested by `test/buddy-access.test.js`.
- `functions/aioDashboard.js` — server-side client for the AIO production dashboard backend (`backend.prod.aioapp.com`): login/session, `x-tenant-id`, envelopes, device list/create/delete. Request bodies mirror `zeus/apps/backend/src/modules/restaurant-management/devices` (the backend source is the sibling `zeus` repo). Used by the `aioDevices` function.
- `js/device-map.js` — `DeviceMap`: the Map Devices view. Registers deployed/staged POS, KDS, kiosks and menu boards (printers are deliberately excluded — they bind locally by IP) at the customer's AIO dashboard restaurant via `aioDevices`, pairs AMS1 terminals onto POS/kiosk records, the super-admin discrepancy report, and the corner nudge after a stage/dispatch. Customer → restaurant links live in `deviceLocationMap` on the main doc (`DB.setDeviceLocation`).
- `js/app.js` — boot, navigation (hash routing: each view is `#<view>`, so Back/Forward and deep links work), view-level event wiring (IIFE, no exports).
- `css/styles.v4.css` — the active stylesheet (referenced by `index.html`). `styles.css` and `styles.v2.css` are older/unused versions.
- `firestore.rules` — Firestore security rules (wired into `firebase.json`). **Gates role escalation** — see Conventions below.
- `ENTRA-SETUP.md` — Entra app registration + Firebase console setup, and the break-glass admin login.
- `logo.png` — app/login logo. `.nojekyll` — leftover from an earlier GitHub Pages setup; a stale Pages build still exists at `shaheeraio.github.io/aioinventory` but Vercel is what people use.

## Build / Run / Test
There is **no build step** in this repo, and no test framework/runner — but there is one
dependency-free test file, run directly with node:

```bash
node test/transfer-protocol.test.js    # warehouse transfers: dispatch → receive → cancel
node test/super-edit.test.js           # super admin unit editor (movement splitting)
node test/device-map.test.js           # Map Devices planning rules + AIO dashboard client
node test/buddy-access.test.js         # Buddy Access: add-only merge, verify and restore
node test/hubspot-docs.test.js         # HubSpot quotes/invoices for Stock Out
```

It loads `js/inventory.js` as text and evaluates it with a fake `DB` injected (the module is a
browser IIFE, so it cannot be `require`d), then asserts against both it and
`functions/inventoryStats.js` — so it catches the two copies of the aggregation rules drifting
apart. Exits non-zero on failure. `test/super-edit.test.js` lifts `editSerialProperties` out of `js/db.js` the same way. Nothing else is covered by tests.

Run locally as static files (commands from `README.md`):
```bash
# Serve the project root with any static server:
npx serve .
# or
python3 -m http.server 8080
```
Then open the served URL (e.g. `http://localhost:8080`). Opening `index.html` via `file://` may fail because the JS uses dynamic ES-module imports and Firebase — use a local HTTP server.

Deploy: **push to `main`** — Vercel builds and serves it automatically at
`https://aioinventory.vercel.app`. Firestore rules and Cloud Functions deploy separately:

```bash
firebase deploy --only firestore:rules --dry-run   # compile check, publishes nothing
firebase deploy --only firestore:rules
firebase deploy --only functions
```

Data backup/restore via browser console: `DB.exportJSON()` and `DB.importJSON('<json>')`.

## Conventions & Gotchas
- **Script load order is load-bearing** (see bottom of `index.html`): `auth.js → auth-ui.js → db.js → activity.js → hubspot-picker.js → inventory.js → reports.js → xlsx → ui/core.js → ui/*.js → audit.js → device-map.js → changelog.js → forms/shared.js → forms/*.js → app.js`. Each module assumes its dependencies are already defined as globals.
- **Cache-busting query strings** (`?v=101`, `?v=108`, ...) are appended to each `<script src>` in `index.html`. When you change a JS file, **bump its version number** in `index.html` so browsers reload it.
- **Firebase config is committed in source** (`db.js` and `auth.js` both inline the same `FB_CONFIG` for project `aio-inventory-b9b29`). This is a client-side Firebase web key (normal for Firebase), but be aware it is in the repo; security relies on Firestore/Auth rules, not on hiding the key.
- **Single shared Firestore document** (`inventory/main`) holds *all* inventory data and is fully read into memory and rewritten on save. Writes set a `_pendingWrite` flag so the app ignores its own `onSnapshot` echo. Keep this in mind for concurrency — last write generally wins on the whole document.
- **Modules are IIFE singletons exposing a returned object** — to add functionality, add a method to the relevant module's returned object (see the `return { ... }` at the bottom of each `js/*.js`; for `UI` and `Forms`, the `Object.assign(UI, { ... })` / `Object.assign(Forms, { ... })` at the bottom of the file) and call it from `app.js`/`js/ui/`. There is no import/export wiring.
- **Roles gate the UI**: `AuthUI.applyRoleRestrictions()` (called on boot) hides/disables editing for non-editors. `Auth.canEdit()` and `Auth.isAdmin()` are the gates; respect them when adding write actions.
- **Sign-in provisions accounts automatically.** Anyone in the AIO Entra tenant can sign in;
  `Auth` resolves their role in this order: existing `users/<uid>` → a profile with the same email
  under a different uid (the **lazy join** — adopts name + role, stamps `migratedTo` on the old
  doc) → a role an admin pre-assigned by email in `pendingUsers` → otherwise a new `view` profile.
  A profile flagged `deleted` is refused and signed straight back out.
- **`firestore.rules` is what actually stops privilege escalation.** Clients write their own
  `users/<uid>` on first sign-in, so the rules constrain that write to your own uid, your own
  email, and role `view` unless the role came from `pendingUsers` or from an older profile
  carrying the same email. Loosening the `users` create rule hands any tenant member an admin
  account. The rules also make `pendingUsers` admin-only (granting a role is a privileged act),
  with a carve-out so a new user can clear their own entry. **The rules live in the repo now —
  edits are not live until `firebase deploy --only firestore:rules`.**
- **Password sign-in is break-glass only** — one dedicated admin account, reachable at the
  unlisted `?signin=fallback` URL. There is no password UI anywhere else, and no reset flow;
  reset it from the Firebase console.
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
- **AIO dashboard device serials**: inventory stores an AMS1 as its bare number, the dashboard as
  `AMS1-<number>`. A dashboard serial must be unique platform-wide; moving a device is delete + create.
  Attaching an AMS1 assigns it to the restaurant's live Adyen store and fails if the restaurant isn't
  Adyen-onboarded. Some POS/menu boards are registered under their Android id and can never match inventory.
