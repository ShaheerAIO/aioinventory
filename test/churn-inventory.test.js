// Churn: units deployed to a customer return to stock (Needs Testing, cost kept).
//   Run: node test/churn-inventory.test.js
const fs = require('fs');
const path = require('path').resolve(__dirname, '..');
const src = fs.readFileSync(path + '/js/inventory.js', 'utf8');

function makeDB() {
  const d = { movements: [], thresholds: {}, shipments: [], transfers: [], serialCosts: {}, serialConditions: {},
              purchaseOrders: {}, serialPOs: {}, customLocations: [], productRecords: [], pendingDeployments: [] };
  return {
    _d: d, calls: 0,
    onReady: fn => fn(),
    getData: () => d,
    addMovement: mv => d.movements.push(mv),
    addMovements(mvs) { this.calls++; d.movements.push(...mvs); },
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
    updateShipment: () => {},
    addTransfer: t => d.transfers.push(t),
    updateTransfer: () => {},
    getTransfers: () => d.transfers,
    getOrders: () => [], updateOrder: () => {},
  };
}

const DB = makeDB();
const { Inventory } = new Function('DB', src + '\n; return { Inventory };')(DB);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name, extra ?? ''); } };
const throws = (name, fn) => { try { fn(); fail++; console.log('  ✗ ' + name + ' — no error thrown'); } catch (e) { pass++; console.log('  ✓ ' + name + ' → "' + e.message + '"'); } };
const row = sn => Inventory.getAllSerialRows().find(r => r.serial === sn);

Inventory.stockIn({ supplier: 'Sunmi', location: 'San Jose', receivedBy: 'Ann', condition: '',
  products: [
    { product: 'AIO Kiosk', category: 'Kiosk', serials: ['K-1', 'K-2', 'K-3'], unitCost: 500 },
    { product: 'AIO POS', category: 'POS', serials: ['P-1', 'P-2'], unitCost: 300 },
  ] });
Inventory.stockOut({ customer: 'Cafe A', by: 'Bob', ref: 'R1', serials: ['K-1', 'P-1'] });
Inventory.stockOut({ customer: 'Cafe B', by: 'Bob', ref: 'R2', serials: ['K-2', 'P-2'] });
ok('4 units deployed', Inventory.getDeployedSerialRows().length === 4);

console.log('\nChurn Cafe A');
const before = DB._d.movements.length;
const res = Inventory.churnCustomer(' Cafe A ', 'Dallas', 'Pete');
ok('returns unit count', res.units === 2, res);
ok('one movement per product', DB._d.movements.length - before === 2 && DB.calls === 1);
const avail = Inventory.getAvailableSerials();
ok('Cafe A units back in stock', avail.has('K-1') && avail.has('P-1'));
ok('Cafe B units still out', !avail.has('K-2') && !avail.has('P-2'));
const dep = Inventory.getDeployedSerialRows();
ok('Cafe A gone from deployed', dep.length === 2 && dep.every(r => r.customer === 'Cafe B'));
ok('condition needs-testing', row('K-1').condition === 'needs-testing' && row('P-1').condition === 'needs-testing', row('K-1'));
ok('located at Dallas', row('K-1').location === 'Dallas');
ok('cost preserved', DB.getSerialCost('K-1') === 500 && DB.getSerialCost('P-1') === 300);
const ids = DB._d.movements.slice(before).map(m => m.id);
ok('unique ids', new Set(ids).size === ids.length);

throws('no units for customer', () => Inventory.churnCustomer('Nobody', 'Dallas'));
throws('empty location', () => Inventory.churnCustomer('Cafe B', ''));
ok('failed calls changed nothing', Inventory.getDeployedSerialRows().length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
