// Churn: delete every device record at a customer's AIO dashboard restaurant.
// Used by aioDevices (action=churnPreview / churn). Unlike the other dashboard
// writes it is open to editors, so the restaurant is never taken from the
// client: it is resolved here from the customer's link in deviceLocationMap on
// inventory/main, then confirmed against the dashboard's restaurant list.
// Dependencies are passed in (db, the aio client, knownLocation) so this is
// testable without Firebase — see test/churn.test.js.

const CHURN_ROLES = ['superadmin', 'admin', 'edit'];

// The aioDevices role gate. null = allowed, else { status, error } to send.
// Churn is the only thing an editor may call; everything else is unchanged:
// admins read, only a super admin writes.
function accessError(role, action, isWrite) {
  const churn = (!isWrite && action === 'churnPreview') || (isWrite && action === 'churn');
  if (churn) return CHURN_ROLES.includes(role) ? null : { status: 403, error: 'Forbidden' };
  if (!['superadmin', 'admin'].includes(role)) return { status: 403, error: 'Forbidden' };
  if (isWrite && role !== 'superadmin') return { status: 403, error: 'Only a super admin can change the AIO dashboard' };
  return null;
}

// { location } (null when the customer has no dashboard link) or { error }
async function resolveChurnLocation(db, customer, knownLocation) {
  const key = String(customer || '').trim();
  if (!key) return { error: 'customer is required' };
  const snap = await db.collection('inventory').doc('main').get();
  const link = ((snap.exists && snap.data().deviceLocationMap) || {})[key];
  if (!link) return { location: null };
  const loc = await knownLocation(Number(link.businessId), Number(link.restaurantId));
  if (!loc) return { error: 'Unknown restaurant' };
  return { location: { businessId: loc.businessId, restaurantId: loc.restaurantId, name: loc.name || link.name || '' } };
}

async function previewChurn(db, client, knownLocation, customer) {
  const r = await resolveChurnLocation(db, customer, knownLocation);
  if (r.error) return r;
  if (!r.location) return { location: null, devices: [] };
  const devices = await client.listDevices(r.location.businessId, r.location.restaurantId);
  return { location: r.location, devices: devices.map(({ id, type, serial, name }) => ({ id, type, serial, name })) };
}

// One delete at a time, like map's creates; a failure is recorded and the rest still run
async function runChurn(db, client, knownLocation, customer) {
  const r = await resolveChurnLocation(db, customer, knownLocation);
  if (r.error) return r;
  if (!r.location) return { location: null, results: [] };
  const { businessId, restaurantId } = r.location;
  const devices = await client.listDevices(businessId, restaurantId);
  const results = [];
  for (const d of devices) {
    try {
      const del = await client.deleteDevice(businessId, restaurantId, d);
      results.push({ serial: d.serial, ok: !!del.ok, message: del.message || '' });
    } catch (e) {
      results.push({ serial: d.serial, ok: false, message: e.message });
    }
  }
  return { location: r.location, results };
}

module.exports = { accessError, resolveChurnLocation, previewChurn, runChurn };
