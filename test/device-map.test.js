// Map Devices: the planning rules in js/device-map.js (what gets created where,
// names, AMS1 pairing, discrepancies) over the real Inventory, and the backend
// client in functions/aioDashboard.js against a fake fetch.
//
//   Run: node test/device-map.test.js
const fs = require('fs');
const root = require('path').resolve(__dirname, '..');
const invSrc = fs.readFileSync(root + '/js/inventory.js', 'utf8');
const dmSrc  = fs.readFileSync(root + '/js/device-map.js', 'utf8');
const { createClient, validateDevice } = require(root + '/functions/aioDashboard.js');

const d = { movements: [], thresholds: {}, shipments: [], transfers: [], serialCosts: {}, serialConditions: {},
            purchaseOrders: {}, serialPOs: {}, customLocations: [], productRecords: [], pendingDeployments: [],
            deviceLocationMap: {}, hubspotIgnored: [] };
const DB = {
  onReady: fn => fn(),
  getData: () => d,
  addMovement: mv => d.movements.push(mv),
  setThreshold: () => {}, getThreshold: () => 3,
  setSerialCost: (s, c) => { d.serialCosts[s.toUpperCase()] = c; },
  getSerialCost: s => d.serialCosts[s.toUpperCase()] ?? null,
  setSerialPO: () => {}, getSerialPO: () => null,
  getSerialCondition: () => null,
  getPOUnitCost: () => null, getPO: () => null, savePO: () => {},
  getProductRecords: () => d.productRecords, getSupplierRecords: () => [],
  getCustomLocations: () => d.customLocations, addCustomLocation: () => {}, getCustomSuppliers: () => [],
  getPendingDeployments: () => d.pendingDeployments,
  addPendingDeployment: pd => d.pendingDeployments.push(pd),
  getTransfers: () => d.transfers, getOrders: () => [],
  getDeviceLocation: c => d.deviceLocationMap[c] || null,
  getDeviceLocationMap: () => d.deviceLocationMap,
  setDeviceLocation: (c, l) => { d.deviceLocationMap[c] = l; },
  isHubspotIgnored: c => d.hubspotIgnored.includes(c),
};
globalThis.Auth = { isSuperAdmin: () => true, isAdmin: () => true };
const { Inventory } = new Function('DB', invSrc + '\n; return { Inventory };')(DB);
const { DeviceMap } = new Function('DB', 'Inventory', dmSrc + '\n; return { DeviceMap };')(DB, Inventory);
const R = DeviceMap._rules;

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

console.log('\nRules');
eq('AMS1 key strips the prefix', R.key('ams1-000168254080966'), '000168254080966');
eq('terminal serial gets the prefix', R.terminalSerial('000168254080966'), 'AMS1-000168254080966');
eq('POS terminal → pos', R.deviceTypeFor({ serial: 'DP02256GJ0540', category: 'POS Terminal' }), 'pos');
eq('kitchen printer is not mapped (bound locally by IP)', R.deviceTypeFor({ serial: 'N439257312266', category: 'Kitchen Printer' }), null);
eq('label printer is not mapped', R.deviceTypeFor({ serial: 'XAZ2005618', category: 'Receipt/Label Printer' }), null);
eq('menu board → tv', R.deviceTypeFor({ serial: 'ADRB0AAHE00049', category: 'Menu Board' }), 'tv');
eq('NS- placeholder is unmappable', R.deviceTypeFor({ serial: 'NS-AIOKIOSK-1-1', category: 'Kiosk' }), null);
eq('router is unmappable', R.deviceTypeFor({ serial: '1C0B8BE4327C', category: 'Gateway/Router' }), null);
eq('initials', R.initials('Pac Heights Deli'), 'PHD');

console.log('\nSetup — Pac Heights Deli gets 2 POS, 1 KDS, 1 printer, 2 AMS1, 1 router; one KDS staged');
const P = cat => Inventory.PRODUCTS.find(p => p.category === cat);
const stock = (cat, serials) => Inventory.stockIn({ supplier: 'Sunmi', location: 'San Jose', receivedBy: 'A', condition: '', poNumber: 'PO-1',
  products: [{ product: P(cat).name, category: cat, serials, unitCost: 1 }] });
stock('POS Terminal', ['POS-A', 'POS-B']);
stock('Kitchen Display System', ['KDS-A', 'KDS-B']);
stock('Menu Board', ['MB-A', 'MB-X']);
stock('Kitchen Printer', ['PRN-A']);
stock('Payment Terminal', ['000111', '000222']);
stock('Gateway/Router', ['RTR-A']);
const C = 'Pac Heights Deli (1784)';
Inventory.stockOut({ customer: C, by: 'P', ref: '', serials: ['POS-A', 'POS-B', 'KDS-A', 'MB-A', 'PRN-A', '000111', '000222', 'RTR-A'] });
Inventory.stagePendingDeployment({ customer: C, by: 'P', ref: '', serials: ['KDS-B'] });
const units = R.customerUnits()[C];
eq('deployed + staged units', units.length, 9);

const locs = [{ restaurantId: 1784, businessId: 1784, name: 'Pac Heights Deli' }, { restaurantId: 9, businessId: 9, name: 'Other Place' }];
eq('suggest from the number in the name', R.suggestLocation(C, units, locs, {})?.loc.restaurantId, 1784);
eq('suggest from devices already there beats the name', R.suggestLocation(C, units, locs, { 'POS-A': 9 })?.loc.restaurantId, 9);

console.log('\nPlan — KDS-A already there, nothing paired yet');
const existing = [{ id: '2', type: 'kds', name: 'KDS 1 - PHD', serial: 'KDS-A', paymentDeviceSerial: '' }];
let plan = R.buildPlan(units, locs[0], existing, { 'KDS-A': 1784 });
eq('creates 2 POS, 1 KDS, 1 menu board — printer left out', plan.creates.map(c => c.serial).sort(), ['KDS-B', 'MB-A', 'POS-A', 'POS-B']);
eq('names continue after existing', plan.creates.find(c => c.serial === 'KDS-B').name, 'KDS 2 - PHD');
eq('two POS + two terminals needs a choice', plan.problems.length, 1);

plan = R.buildPlan(units, locs[0], existing, { 'KDS-A': 1784 }, { 'POS-A': '000222', 'POS-B': '000111' });
eq('pairing chosen → no problems', plan.problems, []);
eq('payload carries AMS1-prefixed terminal', plan.payload.find(p => p.serial === 'POS-A').paymentDeviceSerial, 'AMS1-000222');
eq('router never in payload', plan.payload.some(p => p.serial === 'RTR-A'), false);

plan = R.buildPlan(units, locs[0], existing, {}, { 'POS-A': '000111', 'POS-B': '000111' });
eq('same terminal twice is refused', plan.problems.some(p => p.includes('only go on one')), true);

const one = units.filter(u => u.serial !== 'POS-B' && u.serial !== '000222');
plan = R.buildPlan(one, locs[0], existing, {});
eq('one POS + one terminal pairs automatically', plan.payload.find(p => p.serial === 'POS-A').paymentDeviceSerial, 'AMS1-000111');

plan = R.buildPlan(units, locs[0], [...existing, { id: '9', type: 'pos', name: 'Old POS', serial: '8ce67bbcbbf32cd3', paymentDeviceSerial: '' }], {}, { 'POS-A': '', 'POS-B': '' });
eq('a POS under an unknown (Android) id is flagged as possible duplicate', plan.overlap, [{ type: 'pos', count: 1 }]);

plan = R.buildPlan(units, locs[0], existing, { 'POS-B': 9 }, { 'POS-A': '' });
eq('a serial registered elsewhere is not created', plan.payload.some(p => p.serial === 'POS-B'), false);
eq('…and is shown as elsewhere', plan.rows.find(r => r.serial === 'POS-B').status, 'elsewhere');

console.log('\nDiscrepancies');
DB.setDeviceLocation(C, { businessId: 1784, restaurantId: 1784, name: 'Pac Heights Deli' });
const disc = R.buildDiscrepancies(R.customerUnits(), locs, { 'POS-A': 9, 'MB-X': 1784, 'KDS-A': 1784, 'PRN-A': 9 });
eq('POS-A at the wrong restaurant', disc.filter(x => x.kind === 'wrong').map(x => x.serial), ['POS-A']);
eq('MB-X registered but in stock', disc.filter(x => x.kind === 'stock').map(x => x.serial), ['MB-X']);
eq('a printer registered elsewhere is not a discrepancy', disc.some(x => x.serial === 'PRN-A'), false);
eq('…with the linked customer as the fix', disc.find(x => x.kind === 'stock').owners, [C]);
eq('deployed units missing from the dashboard (staged and terminals left out)',
  disc.filter(x => x.kind === 'missing').map(x => x.serial).sort(), ['MB-A', 'POS-B']);
eq('no terminal checks until terminals are loaded', disc.some(x => x.kind.startsWith('t-')), false);

console.log('\nPayment terminals');
stock('Payment Terminal', ['000333']);
const pos = { type: 'pos', name: 'POS 1 - PHD', serial: 'POS-A' };
const td = R.buildDiscrepancies(R.customerUnits(), locs, {}, [
  { serial: 'AMS1-000111', restaurantId: 9, device: pos },      // inventory: deployed to C, linked to 1784
  { serial: 'AMS1-000333', restaurantId: 1784, device: pos },   // in stock in inventory
  { serial: 'AMS1-000999', restaurantId: 1784, device: pos },   // never received
]).filter(x => x.kind.startsWith('t-'));
const tk = k => td.filter(x => x.kind === k).map(x => x.serial);
eq('paired at the wrong restaurant (inventory serial, for the fixes)', tk('t-wrong'), ['000111']);
eq('paired but in stock', tk('t-stock'), ['000333']);
eq('…offers the restaurant\'s customer', td.find(x => x.kind === 't-stock').owners, [C]);
eq('…and says which device it is on', td.find(x => x.kind === 't-stock').pairedTo.name, 'POS 1 - PHD');
eq('paired, never received', tk('t-unknown'), ['AMS1-000999']);
eq('deployed but not paired anywhere', tk('t-missing'), ['000222']);

console.log('\nStuck serials');
const sd = R.buildDiscrepancies(R.customerUnits(), locs, { 'POS-A': 9, 'MB-X': 1784 }, [],
  [{ serial: 'POS-A', restaurantId: 9 }, { serial: 'ANDROID-1', restaurantId: 1784 }]);
eq('every stuck serial listed, inventory or not', sd.filter(x => x.kind === 'stuck').map(x => x.serial), ['POS-A', 'ANDROID-1']);
eq('…with where it is taken', sd.find(x => x.serial === 'ANDROID-1').at.restaurantId, 1784);
eq('a stuck serial is not also offered a move or remove', sd.some(x => x.serial === 'POS-A' && x.kind === 'wrong'), false);
eq('other discrepancies still found', sd.filter(x => x.kind === 'stock').map(x => x.serial), ['MB-X']);
eq('no stuck section until the scan has run',
  R.buildDiscrepancies(R.customerUnits(), locs, {}, []).some(x => x.kind === 'stuck'), false);

console.log('\nUniFi');
stock('Gateway/Router', ['1C0B8BE4327C', '9041B27430B1']);
stock('Wi-Fi Access Point', ['942A6FD4150F', 'A89C6CC87BD2']);
Inventory.stockOut({ customer: C, by: 'P', ref: '', serials: ['1C0B8BE4327C', '9041B27430B1'] });
Inventory.stockOut({ customer: 'Other Cafe', by: 'P', ref: '', serials: ['A89C6CC87BD2'] });
const uni = R.buildUnifi(R.customerUnits(), [
  { site: 'Pac Heights Deli', mac: '1C0B8BE4327C', model: 'UDR7', status: 'online' },
  { site: 'Pac Heights Deli', mac: '942A6FD4150F', model: 'U7 Lite', status: 'online' },   // in stock in inventory
  { site: 'Pac Heights Deli', mac: 'A89C6CC87BD2', model: 'U7 Lite', status: 'online' },   // inventory says Other Cafe
  { site: 'Pac Heights Deli', mac: 'FFEEDDCCBBAA', model: 'U6+', status: 'online' },       // never received
  { site: 'Pac Heights Deli', mac: '1C0B8B52310E', model: 'U7 Lite', status: 'offline' },  // ghost: on two sites
  { site: 'LA Template 7',    mac: '1C0B8B52310E', model: 'U7 Lite', status: 'offline' },
]);
eq('site matched to its majority customer', uni.siteCustomer['Pac Heights Deli'], C);
eq('in-stock unit at a customer site', uni.items.filter(i => i.kind === 'u-stock').map(i => i.serial), ['942A6FD4150F']);
eq('…offers that customer', uni.items.find(i => i.kind === 'u-stock').owners, [C]);
eq('unit deployed to another customer', uni.items.filter(i => i.kind === 'u-wrong').map(i => i.serial), ['A89C6CC87BD2']);
eq('never-received device', uni.items.filter(i => i.kind === 'u-unknown').map(i => i.serial), ['FFEEDDCCBBAA']);
eq('ghost MAC on several sites ignored', uni.items.some(i => i.serial === '1C0B8B52310E'), false);
eq('deployed but not in UniFi (incl. the earlier RTR-A)', uni.items.filter(i => i.kind === 'u-missing').map(i => i.serial).sort(), ['9041B27430B1', 'RTR-A']);
eq('per-customer online count', uni.perCustomer[C], { total: 3, seen: 1, online: 1 });
const page = R.unifiForCustomer(C, R.customerUnits(), [
  { site: 'Pac Heights Deli', mac: '1C0B8BE4327C', model: 'UDR7', status: 'online' },
  { site: 'Pac Heights Deli', mac: '942A6FD4150F', model: 'U7 Lite', status: 'online' },
]);
eq('customer page lists its own Ubiquiti units', page.own.map(o => o.serial).sort(), ['1C0B8BE4327C', '9041B27430B1', 'RTR-A']);
eq('…with UniFi status where seen', page.own.find(o => o.serial === '1C0B8BE4327C').device.status, 'online');
eq('…and other devices at its site', page.extra.map(x => x.device.mac), ['942A6FD4150F']);

console.log('\nBackend client');
eq('valid POS with terminal', validateDevice({ type: 'pos', serial: 'DP02256GJ0540', name: 'POS 1', paymentDeviceSerial: 'AMS1-000168254080966' }), null);
eq('nugget refused', !!validateDevice({ type: 'nugget', serial: 'AB12', name: 'N' }), true);
eq('terminal on a KDS refused', !!validateDevice({ type: 'kds', serial: 'DK1', name: 'K', paymentDeviceSerial: 'AMS1-000168254080966' }), true);
eq('bad serial refused', !!validateDevice({ type: 'pos', serial: 'a--b', name: 'P' }), true);

(async () => {
  const calls = [];
  let fail401 = 1;
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const json = b => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith('/user-login')) return json({ success: true, data: { authChallengeResponse: { AuthenticationResult: { AccessToken: 'A', IdToken: 'I', ExpiresIn: 43200 } } } });
    if (url.includes('/device/list') && fail401-- > 0) return { ok: false, status: 401, json: async () => ({}) };
    if (url.includes('/device/list')) return json({ statusCode: 200, response: { success: true, data: { restaurants: [
      { name: 'POS', data: [{ id: '168', name: 'Main POS', serialNo: 'DP1', paymentDeviceSerial: 'AMS1-1', status: 'Online' }] },
      { name: 'STATION', data: [{ id: '0', name: 'Custom' }] },
    ] } } });
    if (url.includes('/device/create')) return json({ success: false, message: 'Serial number already exists' });
    return json({});
  };
  const c = createClient({ username: 'u', password: 'p', fetchImpl: fakeFetch });
  const [a, b] = await Promise.all([c.listDevices(1784, 1784), c.listDevices(1784, 1784)]);
  eq('stations dropped, payment serial kept', a, [{ id: '168', type: 'pos', name: 'Main POS', serial: 'DP1', paymentDeviceSerial: 'AMS1-1', status: 'Online' }]);
  eq('both concurrent calls answered', b.length, 1);
  eq('logged in twice at most (once + once after the 401)', calls.filter(x => x.url.endsWith('/user-login')).length, 2);
  const listCall = calls.find(x => x.url.includes('/device/list'));
  eq('tenant + id token headers sent', [listCall.opts.headers['x-tenant-id'], listCall.opts.headers['x-id-token']], ['1784', 'I']);

  const r = await c.createDevice(1784, 1784, { type: 'pos', serial: 'DP1', name: 'POS 1', paymentDeviceSerial: 'AMS1-1' });
  eq('a 200 with success:false is a failure', r, { ok: false, message: 'Serial number already exists' });
  const body = JSON.parse(calls.find(x => x.url.includes('/device/create')).opts.body);
  eq('create body matches the dashboard DTO', [body.businessId, body.restaurantId, body.device.deviceType, body.device.deviceSerialNumber, body.device.deviceName, body.device.paymentSource, body.device.paymentDeviceSerial],
    [1784, 1784, 'pos', 'DP1', 'POS 1', 'adyen', 'AMS1-1']);

  // pos.paymentSource / kiosk.paymentSource are NOT NULL. Leave it off and the backend has already
  // written restaurant_devices before the insert fails — the serial reads as taken but never lists.
  const createBody = async d => {
    await c.createDevice(1784, 1784, d);
    return JSON.parse(calls.filter(x => x.url.includes('/device/create')).pop().opts.body).device;
  };
  eq('POS without a terminal still sends a payment source',
    (await createBody({ type: 'pos', serial: 'DP2', name: 'POS 2' })).paymentSource, 'adyen');
  eq('kiosk without a terminal still sends a payment source',
    (await createBody({ type: 'kiosk', serial: 'K1', name: 'Kiosk 1' })).paymentSource, 'adyen');
  eq('KDS sends no payment source', (await createBody({ type: 'kds', serial: 'KD1', name: 'KDS 1' })).paymentSource, undefined);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
