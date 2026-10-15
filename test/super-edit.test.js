// Exercises the super-admin unit editor: Inventory.superEditSerial (validation)
// over the real DB.editSerialProperties (movement splitting). db.js is a browser
// IIFE wired to Firestore, so only that one function is lifted out of it and
// run against the same fake DB the transfer test uses.
//
//   Run: node test/super-edit.test.js
const fs = require('fs');
const root = require('path').resolve(__dirname, '..');
const invSrc = fs.readFileSync(root + '/js/inventory.js', 'utf8');
const dbSrc  = fs.readFileSync(root + '/js/db.js', 'utf8');

const d = { movements: [], thresholds: {}, shipments: [], transfers: [], serialCosts: {}, serialConditions: {},
            purchaseOrders: {}, serialPOs: {}, customLocations: [], productRecords: [], pendingDeployments: [] };
const fnSrc = dbSrc.match(/  function editSerialProperties[\s\S]*?\n  }\n/)[0];
const editSerialProperties = new Function('_data', 'SAVE_FIELDS', '_persist', fnSrc + '\nreturn editSerialProperties;')(
  d, [], () => Promise.resolve());

const DB = {
  onReady: fn => fn(),
  getData: () => d,
  addMovement: mv => d.movements.push(mv),
  setThreshold: () => {}, getThreshold: () => 3,
  setSerialCost: (s, c) => { d.serialCosts[s.toUpperCase()] = c; },
  getSerialCost: s => d.serialCosts[s.toUpperCase()] ?? null,
  setSerialPO: (s, po) => { d.serialPOs[s.toUpperCase()] = po; },
  getSerialPO: s => d.serialPOs[s.toUpperCase()] || null,
  getSerialCondition: s => (s.toUpperCase() in d.serialConditions) ? d.serialConditions[s.toUpperCase()] : null,
  getPOUnitCost: () => null, getPO: () => null, savePO: () => {},
  getProductRecords: () => d.productRecords, getSupplierRecords: () => [],
  getCustomLocations: () => d.customLocations, addCustomLocation: () => {}, getCustomSuppliers: () => [],
  getPendingDeployments: () => d.pendingDeployments,
  getTransfers: () => d.transfers, getOrders: () => [],
  editSerialProperties,
};
let role = 'superadmin';
globalThis.Auth = { isSuperAdmin: () => role === 'superadmin' };
const { Inventory } = new Function('DB', invSrc + '\n; return { Inventory };')(DB);

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`); };
const throws = (name, fn, match) => {
  try { fn(); fail++; console.log('  ✗ ' + name + ' — no error thrown'); }
  catch (e) { const good = e.message.includes(match); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name} → "${e.message}"`); }
};
const row = sn => Inventory.getAllSerialRows().find(r => r.serial === sn);
const dep = sn => Inventory.getDeployedSerialRows().find(r => r.serial === sn);
const P1 = Inventory.PRODUCTS[0], P2 = Inventory.PRODUCTS.find(p => p.category !== P1.category);

console.log('\nSetup — batch of 3 at San Jose, A-2 deployed to Acme');
Inventory.stockIn({ supplier: 'Sunmi', location: 'San Jose', receivedBy: 'Ann', condition: '', poNumber: 'PO-1',
  products: [{ product: P1.name, category: P1.category, serials: ['A-1', 'A-2', 'A-3'], unitCost: 100 }] });
Inventory.stockOut({ customer: 'Acme', by: 'Pete', ref: 'R1', serials: ['A-2'] });
eq('2 in stock', Inventory.getAvailableSerials().size, 2);

console.log('\nGuards');
role = 'admin';
throws('plain admin refused', () => Inventory.superEditSerial('A-1', { cost: 5 }, 'x'), 'super admin');
role = 'superadmin';
throws('reason required', () => Inventory.superEditSerial('A-1', { cost: 5 }, ' '), 'reason');
throws('duplicate serial refused', () => Inventory.superEditSerial('A-1', { serial: 'a-2' }, 'x'), 'already in use');
throws('unknown product refused', () => Inventory.superEditSerial('A-1', { product: 'Nope' }, 'x'), 'catalog');
throws('unknown serial refused', () => Inventory.superEditSerial('ZZZ', { cost: 5 }, 'x'), 'in stock or dispatched');

console.log('\nIn-stock unit: product, location, cost, PO, condition, serial');
Inventory.superEditSerial('A-1', { product: P2.name, location: 'Los Angeles', cost: 250, poNumber: 'PO-9',
  condition: 'faulty', testedBy: 'Tess', used: true, serial: 'b-1' }, 'wrong product on receipt');
const b1 = row('B-1');
eq('renamed', !!b1 && !row('A-1'), true);
eq('product', b1.product, P2.name);
eq('category follows product', b1.category, P2.category);
eq('location', b1.location, 'Los Angeles');
eq('cost moved to new serial', b1.cost, 250);
eq('PO', b1.poNumber, 'PO-9');
eq('condition', [b1.condition, b1.testedBy, b1.used], ['faulty', 'Tess', true]);
eq('batch-mate A-3 untouched', [row('A-3').product, row('A-3').location, row('A-3').cost, row('A-3').used, row('A-3').condition], [P1.name, 'San Jose', 100, false, '']);
eq('stock count unchanged', Inventory.getAvailableSerials().size, 2);

console.log('\nDispatched unit: product, location, customer — stays deployed');
Inventory.superEditSerial('A-2', { product: P2.name, location: 'Los Angeles', customer: 'Globex', ref: 'R2' }, 'fix');
eq('still not in stock', Inventory.getAvailableSerials().has('A-2'), false);
eq('deployed row', [dep('A-2').product, dep('A-2').customer, dep('A-2').ref, dep('A-2').location], [P2.name, 'Globex', 'R2', 'Los Angeles']);
eq('stock count unchanged', Inventory.getAvailableSerials().size, 2);
eq('ledger: split IN kept before the OUT', d.movements.map(m => m.type + ':' + m.serials.join(',')),
  ['IN:A-3', 'IN:A-2', 'IN:B-1', 'OUT:A-2']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
