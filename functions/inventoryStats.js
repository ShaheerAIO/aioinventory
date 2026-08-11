/**
 * inventoryStats.js — server-side reimplementation of the aggregation rules in
 * js/inventory.js (getInventoryMap / getAvailableSerials / getDeployedSerialRows /
 * getDeployedByCustomer). Those live as browser-global IIFE functions and aren't
 * importable into a Cloud Function.
 *
 * This is the single server-side copy: both hubspotSync.js and the metrics
 * endpoint use it, so the rules only ever need updating in one place.
 * Keep in sync with js/inventory.js if the aggregation rules change.
 */

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

/**
 * Read the inventory documents. After the v106 storage split the movements
 * ledger lives in its own doc, flagged by `movementsSplit` on the main doc.
 */
async function loadInventory(db) {
  const snap = await db.collection('inventory').doc('main').get();
  const data = snap.data() || {};
  let movements = data.movements || [];
  if (data.movementsSplit) {
    const mvSnap = await db.collection('inventory').doc('movements').get();
    movements = (mvSnap.data() || {}).movements || [];
  }
  return { data, movements, serialCosts: data.serialCosts || {} };
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function valueOf(serials, serialCosts) {
  return Math.round(sum([...serials].map((s) => serialCosts[String(s).toUpperCase()] || 0)));
}
function costedCount(serials, serialCosts) {
  return [...serials].filter((s) => serialCosts[String(s).toUpperCase()] != null).length;
}

/**
 * Aggregate figures for the executive dashboard.
 *
 * Stock/deployed/transit are point-in-time snapshots and ignore the date range —
 * "cash tied up in hardware" is a balance, not a flow. Only `received` and
 * `deployedInPeriod` respect from/to.
 */
function computeMetrics({ data, movements, serialCosts }, fromMs, toMs) {
  const available = computeAvailableSerials(movements);
  const byCustomer = computeDeployedByCustomer(movements, serialCosts);

  const inTransitSerials = new Set();
  for (const sh of data.shipments || []) {
    if (sh.status !== 'in-transit') continue;
    for (const p of sh.products || []) for (const s of p.serials || []) inTransitSerials.add(s);
  }

  const inWindow = (mv) => {
    const t = +new Date(mv.date);
    return !isNaN(t) && t >= fromMs && t < toMs;
  };
  const received = movements.filter((mv) => mv.type === 'IN' && inWindow(mv));
  const sentOut = movements.filter((mv) => mv.type === 'OUT' && !mv.isRmaTl && inWindow(mv));
  const rmaTl = movements.filter((mv) => mv.type === 'OUT' && mv.isRmaTl && inWindow(mv));

  const deployedUnits = sum(Object.values(byCustomer).map((v) => v.units));
  const deployedValue = Math.round(sum(Object.values(byCustomer).map((v) => v.value)));

  // How much of the stock actually carries a cost. The value figures are only
  // as trustworthy as this — an uncosted serial contributes 0, silently
  // understating the total.
  const costed = costedCount(available, serialCosts);

  return {
    stock: {
      units: available.size,
      value: valueOf(available, serialCosts),
      costedUnits: costed,
      costCoverage: available.size ? +(costed / available.size).toFixed(3) : null,
    },
    deployed: { units: deployedUnits, value: deployedValue, customers: Object.keys(byCustomer).length },
    inTransit: { units: inTransitSerials.size, value: valueOf(inTransitSerials, serialCosts) },
    flow: {
      receivedUnits: sum(received.map((mv) => mv.serials.length)),
      deployedUnits: sum(sentOut.map((mv) => mv.serials.length)),
      rmaTotalLossUnits: sum(rmaTl.map((mv) => mv.serials.length)),
    },
    productLines: new Set(movements.map((mv) => mv.product).filter(Boolean)).size,
  };
}

module.exports = {
  computeAvailableSerials,
  computeDeployedByCustomer,
  loadInventory,
  computeMetrics,
};
