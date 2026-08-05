/**
 * hubspotSync.js — nightly rollup of deployed hardware (units + value) per
 * customer into HubSpot Company properties.
 *
 * This is a server-side reimplementation of the relevant pieces of
 * js/inventory.js (getInventoryMap / getAvailableSerials / getDeployedSerialRows /
 * getDeployedByCustomer) — those live as browser-global IIFE functions and
 * aren't importable into a Cloud Function, so the same logic is kept here in
 * minimal form. Keep this in sync if the inventory aggregation rules change.
 */

const admin = require('firebase-admin');

const HUBSPOT_DEVICE_COUNT_PROP = 'aio_device_count';
const HUBSPOT_DEPLOYED_VALUE_PROP = 'aio_total_deployed_value';

// Serials currently in stock anywhere (mirrors Inventory.getAvailableSerials())
function computeAvailableSerials(movements) {
  const inStock = {}; // product||location -> Set<serial>
  for (const mv of movements) {
    const key = mv.product + '||' + (mv.location || '');
    if (!inStock[key]) inStock[key] = new Set();
    if (mv.type === 'IN') {
      for (const s of mv.serials) inStock[key].add(s);
    } else {
      for (const s of mv.serials) inStock[key].delete(s);
    }
  }
  const all = new Set();
  for (const set of Object.values(inStock)) for (const s of set) all.add(s);
  return all;
}

// Mirrors Inventory.getDeployedSerialRows() + getDeployedByCustomer()
function computeDeployedByCustomer(movements, serialCosts) {
  const lastOut = {};
  for (const mv of movements) {
    if (mv.type === 'OUT' && !mv.isRmaTl) {
      for (const s of mv.serials) lastOut[s] = mv;
    }
  }
  const availableSerials = computeAvailableSerials(movements);

  const byCustomer = {};
  for (const [serial, mv] of Object.entries(lastOut)) {
    if (availableSerials.has(serial)) continue; // re-received into stock
    const key = mv.customer || '(no customer)';
    if (!byCustomer[key]) byCustomer[key] = { units: 0, value: 0 };
    byCustomer[key].units++;
    const cost = serialCosts[serial.toUpperCase()];
    if (cost != null) byCustomer[key].value += cost;
  }
  return byCustomer;
}

async function patchHubspotCompany(token, companyId, properties) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    throw new Error(`HubSpot PATCH failed for company ${companyId}: ${res.status} ${await res.text()}`);
  }
}

async function runHubspotSync(hubspotToken) {
  const db = admin.firestore();
  const snap = await db.collection('inventory').doc('main').get();
  const data = snap.data() || {};

  // After the storage split (movementsSplit flag) the ledger lives in its own doc
  let movements = data.movements || [];
  if (data.movementsSplit) {
    const mvSnap = await db.collection('inventory').doc('movements').get();
    movements = (mvSnap.data() || {}).movements || [];
  }
  const serialCosts = data.serialCosts || {};
  const hubspotCompanyMap = data.hubspotCompanyMap || {};
  // pendingDeployments intentionally excluded — not committed movements yet.

  const byCustomer = computeDeployedByCustomer(movements, serialCosts);

  const results = [];
  for (const [customer, agg] of Object.entries(byCustomer)) {
    const companyId = hubspotCompanyMap[customer];
    if (!companyId) {
      results.push({ customer, skipped: 'unmapped' });
      continue;
    }
    await patchHubspotCompany(hubspotToken, companyId, {
      [HUBSPOT_DEVICE_COUNT_PROP]: agg.units,
      [HUBSPOT_DEPLOYED_VALUE_PROP]: agg.value,
    });
    results.push({ customer, companyId, units: agg.units, value: agg.value });
  }
  return results;
}

module.exports = { runHubspotSync };
