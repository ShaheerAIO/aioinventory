# AIO Inventory System

Serial-number-level inventory management for AIO App. Tracks hardware — POS terminals,
printers, routers, kiosks — through its whole lifecycle: purchase orders, in-transit
shipments, stock holding, warehouse transfers, deployment to customers, servicing/RMA,
total loss, and physical stock audits.

**Live at [aioinventory.vercel.app](https://aioinventory.vercel.app)** · sign in with your
AIO Microsoft account.

## Features

- **Serial number tracking** — every unit tracked individually, with full provenance
- **Purchase orders & shipments** — order, dispatch, receive in full or in part
- **Stock holding** — live counts per product and location, with low-stock thresholds
- **Warehouse transfers** — two-step dispatch/receive, so units in flight are never double-counted
- **Deployment** — assign units to customers, with a pending-deployment queue
- **Servicing / RMA** — condition and test-outcome history per unit
- **Stock audits** — three-phase physical count (build list → count/scan → variance), pausable
- **Barcode scanning** — camera scanning on any serial field
- **Reporting** — KPI summaries and Excel export
- **HubSpot sync** — nightly rollup of deployed hardware onto HubSpot companies
- **Real-time multi-user sync** — changes appear for everyone immediately
- **Role-based access** — admin, editor, view only

## Tech stack

Plain HTML + CSS + vanilla JavaScript. **No build step, no bundler, no npm dependencies** —
the modules are IIFE singletons on `window`, loaded in a fixed order by `index.html`.

- **Firebase Firestore** — data, with real-time sync
- **Firebase Auth + Microsoft Entra ID** — SSO, with roles in a `users/<uid>` profile doc
- **Cloud Functions** (`functions/`, Node 20) — HubSpot sync and a metrics feed
- **CDN libraries** — SheetJS (Excel export), html5-qrcode (scanning), Firebase SDK v10.12.0

## Running locally

The app needs a real HTTP origin — dynamic ES-module imports and Firebase both fail from
`file://`:

```bash
npx serve .
# or
python3 -m http.server 8080
```

`localhost` is already an authorised Firebase sign-in domain, so Microsoft sign-in works
against the live project from a local server.

## Tests

One dependency-free test file, run directly with node:

```bash
node test/transfer-protocol.test.js    # warehouse transfers: dispatch → receive → cancel
```

It evaluates `js/inventory.js` with a fake `DB` injected and asserts against both it and
`functions/inventoryStats.js`, so it catches the two copies of the aggregation rules drifting
apart. Nothing else is covered.

## Deploying

**The frontend deploys on push to `main`** — Vercel builds it automatically (project
`aioinventory`, team `aioapp1`). Bump the `?v=` cache-busting query string on any `<script>`
you changed in `index.html`, or browsers will keep the old file.

Firestore rules and Cloud Functions deploy separately:

```bash
firebase deploy --only firestore:rules --dry-run   # compile check, publishes nothing
firebase deploy --only firestore:rules
firebase deploy --only functions
```

## Authentication

Sign-in is Microsoft Entra ID SSO. Anyone in the AIO tenant can sign in and arrives as
**view only**; an admin grants Editor or Admin from *Manage users*, or pre-assigns a role to
an email address so someone lands with it on their first sign-in.

Setup and the break-glass admin login are documented in **[ENTRA-SETUP.md](ENTRA-SETUP.md)**.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — architecture, conventions and gotchas. The detailed reference.
- **[ENTRA-SETUP.md](ENTRA-SETUP.md)** — Entra + Firebase console setup, sign-in behaviour.
- **`js/changelog.js`** — the release notes shown in-app under *What's New*; the most reliable
  record of recent feature work.

## Data

All inventory data lives in Firestore: `inventory/main`, `inventory/movements` (the movement
ledger) and `audits/{auditId}`. Backup and restore from the browser console:

```js
DB.exportJSON();
DB.importJSON('<json>');
```
