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

const UNCATEGORIZED = '(uncategorized)';

// mv.category is captured on the movement but can be blank; fall back to the
// product record's category, and bucket the rest explicitly rather than
// dropping the units.
function categoryOf(mv, productCategories) {
  return mv.category || productCategories[mv.product] || UNCATEGORIZED;
}

// Mirrors Inventory.getDeployedSerialRows() + getDeployedByCustomer().
// `productCategories` (product name -> category) is optional and only feeds the
// per-category breakdown; the deployment rules themselves are unchanged.
function computeDeployedByCustomer(movements, serialCosts, productCategories = {}) {
  const lastOut = {};
  for (const mv of movements) {
    // isTransfer = a warehouse-to-warehouse move, not a dispatch
    if (mv.type === 'OUT' && !mv.isRmaTl && !mv.isTransfer) {
      for (const s of mv.serials) lastOut[s] = mv;
    }
  }
  const availableSerials = computeAvailableSerials(movements);

  const byCustomer = {};
  for (const [serial, mv] of Object.entries(lastOut)) {
    if (availableSerials.has(serial)) continue; // re-received into stock
    const key = mv.customer || '(no customer)';
    if (!byCustomer[key]) byCustomer[key] = { units: 0, value: 0, costedUnits: 0, categories: {} };
    const cat = categoryOf(mv, productCategories);
    if (!byCustomer[key].categories[cat]) byCustomer[key].categories[cat] = { units: 0, value: 0, costedUnits: 0 };
    const agg = byCustomer[key];
    const catAgg = agg.categories[cat];
    agg.units++;
    catAgg.units++;
    const cost = serialCosts[serial.toUpperCase()];
    // "costed" here matches costedCount()/costCoverage: a present (non-null)
    // serialCosts entry. An uncosted serial contributes 0 to value.
    if (cost != null) {
      agg.value += cost;
      agg.costedUnits++;
      catAgg.value += cost;
      catAgg.costedUnits++;
    }
  }
  return byCustomer;
}

/**
 * Per-customer deployed hardware, joined to HubSpot Company IDs.
 *
 * Categories are returned raw — what counts as an "ordering point" is a pricing
 * rule and lives in the consumer, not here. Unmapped customers are included and
 * flagged: silently dropping them makes a billing gap look like zero hardware.
 */
function computeDeployedByCompany({ data, movements, serialCosts }) {
  const hubspotCompanyMap = data.hubspotCompanyMap || {};
  const productCategories = {};
  for (const r of data.productRecords || []) {
    if (r && r.name && r.category) productCategories[r.name] = r.category;
  }

  // Fallback layer for legacy movements whose category is blank on a product
  // that was never added as an admin productRecord — most notably the ~26
  // core products hardcoded in js/inventory.js's HARDCODED_PRODUCTS (POS
  // Terminal, Kiosk, MPOS, Tableside AI Device, ...). That list is
  // deliberately NOT mirrored into functions/ (see the file-level note at the
  // top of this file) — copying it here would just create a second
  // hand-maintained list that drifts out of sync with the SPA.
  // Instead, infer the category from *other* movements of the same product
  // that do carry one: scan every movement once and record product -> category,
  // preferring a stock-IN movement's category on conflict (the stock-in form
  // auto-fills from the product list, so it's the most trustworthy source),
  // otherwise first-seen wins. Only fills gaps productRecords doesn't already
  // cover — an explicit productRecords category always takes priority.
  // Full resolution order (see categoryOf): mv.category -> productRecords ->
  // derived-from-movements -> "(uncategorized)". A unit that still lands in
  // "(uncategorized)" after all three is a genuine unknown, not a bug —
  // EasyOB should surface it as needs-review, not silently count or drop it.
  const derivedCategories = {};
  const derivedFromIn = {};
  for (const mv of movements) {
    if (!mv.category || !mv.product) continue;
    if (derivedCategories[mv.product] === undefined) {
      derivedCategories[mv.product] = mv.category;
      derivedFromIn[mv.product] = mv.type === 'IN';
    } else if (mv.type === 'IN' && !derivedFromIn[mv.product]) {
      derivedCategories[mv.product] = mv.category;
      derivedFromIn[mv.product] = true;
    }
  }
  for (const [product, cat] of Object.entries(derivedCategories)) {
    if (!(product in productCategories)) productCategories[product] = cat;
  }

  const byCustomer = computeDeployedByCustomer(movements, serialCosts, productCategories);

  const round = (agg) => ({ ...agg, value: Math.round(agg.value) });
  const customers = Object.entries(byCustomer)
    .map(([customer, agg]) => {
      const categories = {};
      for (const [cat, catAgg] of Object.entries(agg.categories)) categories[cat] = round(catAgg);
      return {
        customer,
        hubspotCompanyId: hubspotCompanyMap[customer] || null,
        unmapped: !hubspotCompanyMap[customer],
        units: agg.units,
        costedUnits: agg.costedUnits,
        costCoverage: agg.units ? +(agg.costedUnits / agg.units).toFixed(3) : null,
        value: Math.round(agg.value),
        categories,
      };
    })
    .sort((a, b) => b.units - a.units || a.customer.localeCompare(b.customer));

  return {
    customers,
    summary: {
      customers: customers.length,
      unmappedCustomers: customers.filter((c) => c.unmapped).length,
      units: sum(customers.map((c) => c.units)),
      value: sum(customers.map((c) => c.value)),
    },
  };
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
  // Units on a truck between two warehouses: dispatched out of the source, not
  // yet received at the destination. Mirrors Inventory.getTransferInFlightSerials()
  // — without this they would count in neither stock nor transit and just vanish.
  for (const t of data.transfers || []) {
    if (t.status !== 'in-transit') continue;
    const received = new Set((t.receivedSerials || []).map((s) => String(s).toUpperCase()));
    for (const p of t.products || []) {
      for (const s of p.serials || []) if (!received.has(String(s).toUpperCase())) inTransitSerials.add(s);
    }
  }

  const inWindow = (mv) => {
    const t = +new Date(mv.date);
    return !isNaN(t) && t >= fromMs && t < toMs;
  };
  // Both legs of a location transfer are excluded — nothing was received from a
  // supplier or sent to a customer, the units just changed warehouse.
  const received = movements.filter((mv) => mv.type === 'IN' && !mv.isTransfer && inWindow(mv));
  const sentOut = movements.filter((mv) => mv.type === 'OUT' && !mv.isRmaTl && !mv.isTransfer && inWindow(mv));
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
  computeDeployedByCompany,
  loadInventory,
  computeMetrics,
};
