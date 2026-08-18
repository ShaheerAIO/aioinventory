// Exercises the warehouse-transfer protocol (dispatch → receive → cancel)
// against the real js/inventory.js, with a fake DB standing in for Firestore.
// js/inventory.js is a browser IIFE, so it is loaded as text and evaluated with
// DB injected — the same trick functions/inventoryStats.js exists to avoid.
//
//   Run: node test/transfer-protocol.test.js
//
// Exits non-zero on the first failing assertion count, so it works in CI as-is.
const fs = require('fs');
const path = require('path').resolve(__dirname, '..');
const src = fs.readFileSync(path + '/js/inventory.js', 'utf8');

function makeDB() {
  const d = { movements: [], thresholds: {}, shipments: [], transfers: [], serialCosts: {}, serialConditions: {},
              purchaseOrders: {}, serialPOs: {}, customLocations: [], productRecords: [], pendingDeployments: [] };
  return {
    _d: d,
    onReady: fn => fn(),
    getData: () => d,
    addMovement: mv => d.movements.push(mv),
    addMovements: mvs => d.movements.push(...mvs),
    setThreshold: (k, v) => { d.thresholds[k] = v; },
    getThreshold: k => d.thresholds[k] !== undefined ? d.thresholds[k] : 3,
    setSerialCost: (s, c) => { d.serialCosts[s.toUpperCase()] = c; },
    getSerialCost: s => d.serialCosts[s.toUpperCase()] ?? null,
    setSerialPO: (s, po) => { d.serialPOs[s.toUpperCase()] = po; },
    getSerialPO: s => d.serialPOs[s.toUpperCase()] || null,
    getSerialCondition: s => (s.toUpperCase() in d.serialConditions) ? d.serialConditions[s.toUpperCase()] : null,
    getPOUnitCost: () => null, getPO: () => null, savePO: () => {},
    getProductRecords: () => d.productRecords,
    getSupplierRecords: () => [],
    getCustomLocations: () => d.customLocations,
    addCustomLocation: n => { if (!d.customLocations.includes(n)) d.customLocations.push(n); },
    getCustomSuppliers: () => [],
    getPendingDeployments: () => d.pendingDeployments,
    addPendingDeployment: pd => d.pendingDeployments.push(pd),
    addShipment: sh => d.shipments.push(sh),
    updateShipment: (id, u) => { const i = d.shipments.findIndex(x => x.id === id); if (i > -1) d.shipments[i] = { ...d.shipments[i], ...u }; },
    addTransfer: t => d.transfers.push(t),
    updateTransfer: (id, u) => { const i = d.transfers.findIndex(t => t.id === id); if (i > -1) d.transfers[i] = { ...d.transfers[i], ...u }; },
    getTransfers: () => d.transfers,
    getOrders: () => [], updateOrder: () => {},
  };
}

const DB = makeDB();
const { Inventory } = new Function('DB', src + '\n; return { Inventory };')(DB);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name, extra ?? ''); } };
const eq = (name, a, b) => ok(name + ` (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const throws = (name, fn, match) => {
  try { fn(); fail++; console.log('  ✗ ' + name + ' — no error thrown'); }
  catch (e) { const good = !match || e.message.includes(match); if (good) { pass++; console.log('  ✓ ' + name + ' → "' + e.message + '"'); } else { fail++; console.log('  ✗ ' + name + ' — wrong error: ' + e.message); } }
};
const rowsAt = loc => Inventory.getAllSerialRows().filter(r => r.location === loc);
const row = sn => Inventory.getAllSerialRows().find(r => r.serial === sn);

// ── Setup ─────────────────────────────────────────────────────────────
console.log('\nSetup — 4 units at San Jose (SJ-4 faulty), threshold 2');
Inventory.stockIn({ supplier: 'Sunmi', location: 'San Jose', receivedBy: 'Ann', condition: '',
  products: [{ product: 'AIO Kiosk', category: 'Kiosk', serials: ['SJ-1', 'SJ-2', 'SJ-3'], unitCost: 500, threshold: 2 }] });
Inventory.stockIn({ supplier: 'Sunmi', location: 'San Jose', receivedBy: 'Ann', condition: 'faulty',
  products: [{ product: 'AIO Kiosk', category: 'Kiosk', serials: ['SJ-4'], unitCost: 500 }] });
const receivedDateBefore = row('SJ-1').receivedDate;
eq('4 in stock at San Jose', rowsAt('San Jose').length, 4);

// ── Dispatch ──────────────────────────────────────────────────────────
console.log('\nDispatch SJ-1, SJ-4 → Los Angeles (in flight)');
const disp = Inventory.dispatchTransfer({ serials: ['SJ-1', 'SJ-4'], toLocation: 'Los Angeles', by: 'Pete', ref: 'Truck 4', expectedBy: '2026-08-20' });
eq('units dispatched', disp.units, 2);
eq('one transfer record per source', disp.transfers.length, 1);
eq('not received yet', disp.received, false);
const tid = disp.transfers[0].id;

eq('San Jose down to 2 in stock', rowsAt('San Jose').filter(r => r.status === 'in-stock').length, 2);
eq('in stock overall is 2', Inventory.getAvailableSerials().size, 2);
eq('2 units in flight', Inventory.getTransferInFlightSerials().size, 2);
eq('dashboard in-transit stat', Inventory.getStats().inTransit, 2);
ok('nothing looks deployed', Inventory.getDeployedSerialRows().length === 0, Inventory.getDeployedSerialRows());
eq('lifetime dispatched total still 0', Inventory.getStats().totalOut, 0);
eq('in-flight rows filed at destination', rowsAt('Los Angeles').map(r => [r.serial, r.status, r.transferFrom]),
   [['SJ-1', 'in-transit', 'San Jose'], ['SJ-4', 'in-transit', 'San Jose']]);
eq('cost visible while in flight', row('SJ-1').cost, 500);

const info = Inventory.getSerialInfo('SJ-1');
eq('lookup: in transit, not dispatched', [info.status, info.currentLocation], ['in-transit', 'Los Angeles']);
eq('lookup: names both ends', [info.transferInFlight.from, info.transferInFlight.to], ['San Jose', 'Los Angeles']);

// in-flight units must not be receivable a second time through the front door
throws('Stock In blocked while in flight', () => Inventory.stockIn({ supplier: 'Sunmi', location: 'Los Angeles', receivedBy: 'Ann',
  products: [{ product: 'AIO Kiosk', category: 'Kiosk', serials: ['SJ-1'], unitCost: 500 }] }), 'already registered as In Transit');
throws('shipment registration blocked too', () => Inventory.createShipment({ supplier: 'Sunmi', location: 'Los Angeles',
  products: [{ product: 'AIO Kiosk', category: 'Kiosk', serials: ['SJ-1'] }] }), 'already registered as In Transit');
throws('cannot dispatch what is in flight', () => Inventory.dispatchTransfer({ serials: ['SJ-1'], toLocation: 'Reno' }), 'not in Stock Holding');
throws('cannot deploy what is in flight', () => Inventory.stockOut({ customer: 'Taco Place', serials: ['SJ-1'], product: 'AIO Kiosk' }), 'not in Stock Holding');

// ── Partial receipt ───────────────────────────────────────────────────
console.log('\nReceive part of the load (SJ-4 only)');
const part = Inventory.receiveTransfer(tid, { serials: ['SJ-4'], by: 'Dana' });
eq('received / remaining / complete', [part.received, part.remaining, part.complete], [1, 1, false]);
eq('transfer still in flight', Inventory.getInFlightTransfers().length, 1);
eq('SJ-4 now in stock at LA', [row('SJ-4').status, row('SJ-4').location], ['in-stock', 'Los Angeles']);
eq('SJ-1 still on the truck', row('SJ-1').status, 'in-transit');
eq('faulty condition survived the move', row('SJ-4').condition, 'faulty');
eq('used flag survived', row('SJ-4').used, true);
eq('threshold carried to LA', DB._d.thresholds['AIO Kiosk||Los Angeles'], 2);
eq('total units still accounted for', Inventory.getAvailableSerials().size + Inventory.getTransferInFlightSerials().size, 4);
throws('cannot receive a serial not on the manifest', () => Inventory.receiveTransfer(tid, { serials: ['SJ-2'] }), 'Not in flight');
throws('cannot re-receive what already landed', () => Inventory.receiveTransfer(tid, { serials: ['SJ-4'] }), 'Not in flight');

// ── Rest of the load ──────────────────────────────────────────────────
console.log('\nReceive the rest');
const rest = Inventory.receiveTransfer(tid, { by: 'Dana' });
eq('completes the transfer', [rest.received, rest.remaining, rest.complete], [1, 0, true]);
eq('transfer closed', DB._d.transfers[0].status, 'received');
eq('nothing left in flight', Inventory.getTransferInFlightSerials().size, 0);
eq('LA holds 2 in stock', rowsAt('Los Angeles').filter(r => r.status === 'in-stock').length, 2);
eq('received date preserved (audit cut-offs)', row('SJ-1').receivedDate, receivedDateBefore);
eq('receipt log has both legs', DB._d.transfers[0].receiptLog.map(l => l.units), [1, 1]);
eq('lifetime received total ignores transfers', Inventory.getStats().totalIn, 4);
eq('lifetime dispatched total ignores transfers', Inventory.getStats().totalOut, 0);
throws('cannot receive a closed transfer', () => Inventory.receiveTransfer(tid, { by: 'Dana' }), 'not in flight');

// ── Cancel a load ─────────────────────────────────────────────────────
console.log('\nDispatch then cancel — stock returns to source');
const d2 = Inventory.dispatchTransfer({ serials: ['SJ-2'], toLocation: 'Reno', by: 'Pete' });
eq('San Jose down to 1', rowsAt('San Jose').filter(r => r.status === 'in-stock').length, 1);
const canc = Inventory.cancelTransfer(d2.transfers[0].id, { by: 'Pete' });
eq('returned to source', [canc.returned, canc.to], [1, 'San Jose']);
eq('San Jose back to 2', rowsAt('San Jose').filter(r => r.status === 'in-stock').length, 2);
eq('SJ-2 in stock at San Jose again', [row('SJ-2').status, row('SJ-2').location], ['in-stock', 'San Jose']);
eq('cost intact after cancel', row('SJ-2').cost, 500);
eq('transfer marked cancelled', DB._d.transfers[1].status, 'cancelled');
eq('nothing in flight', Inventory.getTransferInFlightSerials().size, 0);
throws('cannot cancel a closed transfer', () => Inventory.cancelTransfer(d2.transfers[0].id, {}), 'not in flight');

// ── One-step move for stock that already arrived ───────────────────────
console.log('\nreceiveNow — recording a move after the fact');
const now1 = Inventory.dispatchTransfer({ serials: ['SJ-2'], toLocation: 'Los Angeles', by: 'Pete', receiveNow: true });
eq('reported as received', now1.received, true);
eq('landed immediately', [row('SJ-2').status, row('SJ-2').location], ['in-stock', 'Los Angeles']);
eq('nothing left in flight', Inventory.getTransferInFlightSerials().size, 0);
eq('trail still records both legs', DB._d.movements.filter(m => m.transferId === now1.transfers[0].id).map(m => m.type), ['OUT', 'IN']);

// ── Guards ────────────────────────────────────────────────────────────
console.log('\nGuards');
throws('no destination', () => Inventory.dispatchTransfer({ serials: ['SJ-3'], toLocation: '  ' }), 'Destination location is required');
throws('nothing selected', () => Inventory.dispatchTransfer({ serials: [], toLocation: 'Los Angeles' }), 'at least one item');
throws('unknown serial', () => Inventory.dispatchTransfer({ serials: ['NOPE-9'], toLocation: 'Los Angeles' }), 'not in Stock Holding');
throws('already at destination', () => Inventory.dispatchTransfer({ serials: ['SJ-2'], toLocation: 'Los Angeles' }), 'already at Los Angeles');
Inventory.stagePendingDeployment({ customer: 'Taco Place', by: 'Pete', ref: '', serials: ['SJ-3'] });
throws('staged for deployment', () => Inventory.dispatchTransfer({ serials: ['SJ-3'], toLocation: 'Los Angeles' }), 'staged for deployment');
throws('unknown transfer id', () => Inventory.receiveTransfer('TR-nope', {}), 'Transfer not found');

// ── Real deployments still work ───────────────────────────────────────
console.log('\nReal deployments unaffected');
Inventory.stockOut({ customer: 'Taco Place', by: 'Pete', ref: '', serials: ['SJ-4'], product: 'AIO Kiosk' });
eq('one deployed unit', Inventory.getDeployedSerialRows().length, 1);
eq('deployed to the right customer', Inventory.getDeployedByCustomer()[0].customer, 'Taco Place');
eq('no phantom "(no customer)" bucket', Inventory.getDeployedByCustomer().filter(c => c.customer === '(no customer)').length, 0);
eq('customer detail: 1 current, 0 stray', [Inventory.getCustomerDetail('Taco Place').current.length, Inventory.getCustomerDetail('Taco Place').past.length], [1, 0]);
eq('lifetime dispatched total now 1', Inventory.getStats().totalOut, 1);

// ── Multi-source dispatch ─────────────────────────────────────────────
console.log('\nDispatch spanning two source warehouses');
Inventory.stockIn({ supplier: 'Sunmi', location: 'Reno', receivedBy: 'Ann', condition: '',
  products: [{ product: 'AIO Kiosk', category: 'Kiosk', serials: ['RN-1'], unitCost: 500 }] });
const multi = Inventory.dispatchTransfer({ serials: ['SJ-2', 'RN-1'], toLocation: 'Dallas', by: 'Pete' });
eq('one record per source warehouse', multi.transfers.map(t => t.from).sort(), ['Los Angeles', 'Reno']);
ok('same-millisecond records get distinct ids', new Set(DB._d.transfers.map(t => t.id)).size === DB._d.transfers.length);
eq('both in flight to Dallas', Inventory.getTransferInFlightSerials().size, 2);
multi.transfers.forEach(t => Inventory.receiveTransfer(t.id, { by: 'Dana' }));
eq('Dallas holds 2', rowsAt('Dallas').filter(r => r.status === 'in-stock').length, 2);

// ── Server-side mirror ────────────────────────────────────────────────
console.log('\nServer-side metrics (functions/inventoryStats.js)');
const stats = require(path + '/functions/inventoryStats.js');
const m = () => stats.computeMetrics({ data: DB._d, movements: DB._d.movements, serialCosts: DB._d.serialCosts }, 0, Date.now() + 1e10);
eq('stock units', m().stock.units, 4);
eq('deployed units', m().deployed.units, 1);
eq('received flow ignores transfers', m().flow.receivedUnits, 5);
eq('deployed flow ignores transfers', m().flow.deployedUnits, 1);

// dispatch one and check the server sees it as in transit, not vanished
const srv = Inventory.dispatchTransfer({ serials: ['RN-1'], toLocation: 'San Jose', by: 'Pete' });
eq('server: in-transit units include the truck', m().inTransit.units, 1);
eq('server: value counted while in flight', m().inTransit.value, 500);
eq('server: stock excludes the truck', m().stock.units, 3);
eq('server: nothing leaked into deployed', m().deployed.units, 1);
Inventory.receiveTransfer(srv.transfers[0].id, { by: 'Dana' });
eq('server: back to stock after receipt', [m().stock.units, m().inTransit.units], [4, 0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
