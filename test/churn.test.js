// Churn: the aioDevices role gate, and resolving + deleting every device at a
// customer's dashboard restaurant (functions/churn.js), against a fake db and
// a fake AIO dashboard client.
//
//   Run: node test/churn.test.js
const root = require('path').resolve(__dirname, '..');
const { accessError, resolveChurnLocation, previewChurn, runChurn } = require(root + '/functions/churn.js');

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

// inventory/main with one linked customer, one linked to a restaurant the dashboard doesn't have
const fakeDb = (data, exists = true) => ({
  reads: 0,
  collection(c) { return { doc: d => ({ get: async () => { this.reads++; return { exists: exists && c === 'inventory' && d === 'main', data: () => data }; } }) }; },
});
const MAP = { deviceLocationMap: {
  'Pac Heights Deli': { businessId: 10, restaurantId: 100, name: 'Pac Heights (linked)' },
  'Gone Cafe':        { businessId: 99, restaurantId: 999, name: 'Gone' },
} };
const LOCS = [{ businessId: 10, restaurantId: 100, name: 'Pac Heights Deli', businessName: 'PHD LLC' }];
const knownLocation = async (b, r) => LOCS.find(l => l.businessId === b && l.restaurantId === r) || null;

const DEVICES = [
  { id: '1', type: 'pos',   serial: 'POS-A', name: 'PHD POS 1', paymentDeviceSerial: 'AMS1-1', status: 'active' },
  { id: '2', type: 'kds',   serial: 'KDS-A', name: 'PHD KDS 1', paymentDeviceSerial: '',       status: 'active' },
  { id: '3', type: 'tv',    serial: 'MB-A',  name: 'PHD TV 1',  paymentDeviceSerial: '',       status: 'active' },
];
// A fake dashboard client. failOn: serial → 'refuse' (ok:false) or 'throw'.
function fakeAio(failOn = {}) {
  const calls = { list: [], del: [] };
  let inFlight = 0, maxInFlight = 0;
  return {
    calls, get maxInFlight() { return maxInFlight; },
    listDevices: async (b, r) => { calls.list.push([b, r]); return DEVICES.map(d => ({ ...d })); },
    deleteDevice: async (b, r, d) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      calls.del.push([b, r, d.id, d.type]);
      await new Promise(ok => setTimeout(ok, 5));
      inFlight--;
      if (failOn[d.serial] === 'throw') throw new Error('socket hang up');
      if (failOn[d.serial] === 'refuse') return { ok: false, message: 'Device not found' };
      return { ok: true, message: 'Deleted' };
    },
  };
}

console.log('\nRole gate');
const FORBIDDEN = { status: 403, error: 'Forbidden' };
const SUPER_ONLY = { status: 403, error: 'Only a super admin can change the AIO dashboard' };
for (const role of ['superadmin', 'admin', 'edit']) {
  eq(`${role} can preview a churn`, accessError(role, 'churnPreview', false), null);
  eq(`${role} can churn`, accessError(role, 'churn', true), null);
}
eq('view cannot preview a churn', accessError('view', 'churnPreview', false), FORBIDDEN);
eq('view cannot churn', accessError('view', 'churn', true), FORBIDDEN);
eq('an unknown role cannot churn', accessError('guest', 'churn', true), FORBIDDEN);
eq('edit still cannot read anything else', accessError('edit', 'overview', false), FORBIDDEN);
eq('edit still cannot read devices', accessError('edit', 'devices', false), FORBIDDEN);
eq('edit still cannot map', accessError('edit', 'map', true), FORBIDDEN);
eq('edit still cannot remove', accessError('edit', 'remove', true), FORBIDDEN);
eq('edit cannot churn with a GET', accessError('edit', 'churn', false), FORBIDDEN);
eq('edit cannot POST a preview', accessError('edit', 'churnPreview', true), FORBIDDEN);
eq('view still cannot read', accessError('view', 'overview', false), FORBIDDEN);
eq('admin still reads', accessError('admin', 'overview', false), null);
eq('admin still cannot map', accessError('admin', 'map', true), SUPER_ONLY);
eq('admin still cannot move', accessError('admin', 'move', true), SUPER_ONLY);
eq('admin still cannot POST an unknown action', accessError('admin', '', true), SUPER_ONLY);
eq('superadmin still maps', accessError('superadmin', 'map', true), null);
eq('superadmin still reads', accessError('superadmin', 'terminals', false), null);

(async () => {
  console.log('\nResolve');
  eq('a linked customer resolves to the confirmed restaurant',
     await resolveChurnLocation(fakeDb(MAP), 'Pac Heights Deli', knownLocation),
     { location: { businessId: 10, restaurantId: 100, name: 'Pac Heights Deli' } });
  eq('the customer name is trimmed',
     (await resolveChurnLocation(fakeDb(MAP), '  Pac Heights Deli \n', knownLocation)).location?.restaurantId, 100);
  eq('an unlinked customer has no location', await resolveChurnLocation(fakeDb(MAP), 'Nobody', knownLocation), { location: null });
  eq('no deviceLocationMap at all → no location', await resolveChurnLocation(fakeDb({}), 'Pac Heights Deli', knownLocation), { location: null });
  eq('a missing main doc → no location', await resolveChurnLocation(fakeDb(MAP, false), 'Pac Heights Deli', knownLocation), { location: null });
  eq('a link the dashboard does not know is an error', await resolveChurnLocation(fakeDb(MAP), 'Gone Cafe', knownLocation), { error: 'Unknown restaurant' });
  const db = fakeDb(MAP);
  eq('an empty customer is an error', await resolveChurnLocation(db, '   ', knownLocation), { error: 'customer is required' });
  eq('a missing customer is an error', await resolveChurnLocation(db, undefined, knownLocation), { error: 'customer is required' });
  eq('...without reading Firestore', db.reads, 0);

  console.log('\nPreview');
  let a = fakeAio();
  let r = await previewChurn(fakeDb(MAP), a, knownLocation, ' Pac Heights Deli');
  eq('lists the devices at the linked restaurant', a.calls.list, [[10, 100]]);
  eq('returns the location', r.location, { businessId: 10, restaurantId: 100, name: 'Pac Heights Deli' });
  eq('devices carry id, type, serial, name only', r.devices, DEVICES.map(({ id, type, serial, name }) => ({ id, type, serial, name })));
  eq('nothing is deleted', a.calls.del, []);
  a = fakeAio();
  eq('unlinked → null location, no devices', await previewChurn(fakeDb(MAP), a, knownLocation, 'Nobody'), { location: null, devices: [] });
  eq('...and the dashboard is not called', a.calls.list, []);
  eq('unknown restaurant → error', await previewChurn(fakeDb(MAP), fakeAio(), knownLocation, 'Gone Cafe'), { error: 'Unknown restaurant' });

  console.log('\nChurn');
  a = fakeAio();
  r = await runChurn(fakeDb(MAP), a, knownLocation, 'Pac Heights Deli');
  eq('every listed device is deleted at the linked restaurant', a.calls.del, [[10, 100, '1', 'pos'], [10, 100, '2', 'kds'], [10, 100, '3', 'tv']]);
  eq('one at a time', a.maxInFlight, 1);
  eq('a result per device', r.results, [
    { serial: 'POS-A', ok: true, message: 'Deleted' },
    { serial: 'KDS-A', ok: true, message: 'Deleted' },
    { serial: 'MB-A',  ok: true, message: 'Deleted' },
  ]);
  eq('returns the location', r.location, { businessId: 10, restaurantId: 100, name: 'Pac Heights Deli' });

  a = fakeAio({ 'POS-A': 'throw', 'KDS-A': 'refuse' });
  r = await runChurn(fakeDb(MAP), a, knownLocation, 'Pac Heights Deli');
  eq('a throw and a refusal do not stop the loop', a.calls.del.length, 3);
  eq('both are recorded as failures', r.results, [
    { serial: 'POS-A', ok: false, message: 'socket hang up' },
    { serial: 'KDS-A', ok: false, message: 'Device not found' },
    { serial: 'MB-A',  ok: true,  message: 'Deleted' },
  ]);

  a = fakeAio();
  eq('unlinked → null location, no results', await runChurn(fakeDb(MAP), a, knownLocation, 'Nobody'), { location: null, results: [] });
  eq('...and nothing is listed or deleted', [a.calls.list, a.calls.del], [[], []]);
  a = fakeAio();
  eq('unknown restaurant → error', await runChurn(fakeDb(MAP), a, knownLocation, 'Gone Cafe'), { error: 'Unknown restaurant' });
  eq('...and nothing is deleted', a.calls.del, []);
  eq('empty customer → error', await runChurn(fakeDb(MAP), fakeAio(), knownLocation, ''), { error: 'customer is required' });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
