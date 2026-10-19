// Server-side client for the AIO production dashboard backend (backend.prod.aioapp.com).
// Used by the aioDevices function to read each restaurant's devices and to create,
// move and remove device records. The service-account password lives in Secret
// Manager — it can never reach the browser.
//
// Backend quirks this handles (see AIO-DASHBOARD-API-GUIDE.md, kept out of git):
//  - every call needs the access token AND the id token (x-id-token), plus x-app-name
//  - tenant-scoped routes 500 with "tenant_0.…" unless x-tenant-id is sent
//  - two response envelopes: { success, data, message } and { response: {…} }
//  - a create that fails business validation still returns HTTP 200/201 with
//    success:false, so success is judged from the payload
//
// The request bodies mirror zeus/apps/backend/src/modules/restaurant-management/devices.

const BASE = 'https://backend.prod.aioapp.com';
const BROWSER_ID = 'ad267d0e-52d1-4da2-a351-ec52be592fbc'; // fixed — Cognito treats it as a device
const RENEW_EARLY_MS = 5 * 60 * 1000;

// The device types the inventory can map. Nuggets need a table, KDCs/stations
// aren't inventory hardware, and printers bind to a restaurant locally by IP —
// so none of those are created from here.
const MAPPABLE_TYPES = ['pos', 'kiosk', 'kds', 'tv'];
const PAYMENT_TYPES = ['pos', 'kiosk'];

// device/list groups devices under these names
const GROUP_TYPES = {
  'POS': 'pos', 'KIOSK': 'kiosk', 'NUGGET': 'nugget', 'PRINTER': 'printer',
  'STICKY-PRINTER': 'sticky-printer', 'TV': 'tv', 'KDC': 'kdc', 'KDS': 'kds',
};

// Same rule the dashboard's own device form applies
const SERIAL_RE = /^(?!-)(?!.*--)[a-zA-Z0-9-]+(?<!-)$/;
const PAYMENT_SERIAL_RE = /^AMS1-\d{6,}$/;

function unwrap(json) {
  const env = json?.response ?? json;
  return { success: !!env?.success, data: env?.data, message: String(env?.message ?? '') };
}

function createClient({ username, password, fetchImpl = fetch }) {
  let session = null;   // { access, id, expiresAt }
  let loggingIn = null; // one in-flight login shared by concurrent callers

  async function login() {
    const res = await fetchImpl(`${BASE}/api/authentication/user-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-name': 'dashboard' },
      body: JSON.stringify({ username, password, rememberMe: false, browserId: BROWSER_ID }),
    });
    const auth = unwrap(await res.json().catch(() => ({}))).data?.authChallengeResponse?.AuthenticationResult;
    if (!res.ok || !auth?.AccessToken) throw new Error('AIO dashboard login failed');
    session = {
      access: auth.AccessToken,
      id: auth.IdToken,
      expiresAt: Date.now() + Number(auth.ExpiresIn || 3600) * 1000,
    };
    return session;
  }

  async function getSession() {
    if (session && Date.now() < session.expiresAt - RENEW_EARLY_MS) return session;
    if (!loggingIn) loggingIn = login().finally(() => { loggingIn = null; });
    return loggingIn;
  }

  // On a 401: drop the session, log in again once, retry once. Never loop.
  async function call(method, path, { tenant, body } = {}, retried = false) {
    const s = await getSession();
    const headers = {
      Authorization: `Bearer ${s.access}`,
      'x-id-token': s.id,
      'x-app-name': 'dashboard',
      'Content-Type': 'application/json',
    };
    if (tenant != null) headers['x-tenant-id'] = String(tenant);
    const res = await fetchImpl(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && !retried) {
      session = null;
      return call(method, path, { tenant, body }, true);
    }
    const out = unwrap(await res.json().catch(() => ({})));
    if (!res.ok) {
      // Error bodies carry backend internals — log them here, return something plain
      console.error(`AIO dashboard ${method} ${path} → ${res.status}: ${out.message}`);
      throw new Error(`AIO dashboard request failed (${res.status})`);
    }
    return out;
  }

  // Every restaurant (the dashboard calls them "locations") with its tenant id
  async function listLocations() {
    const r = await call('GET', '/api/restaurant/get/restaurant-list?allRecords=true');
    return (r.data?.restaurants || []).map(l => ({
      restaurantId: l.id, businessId: l.businessId,
      name: l.name || '', businessName: l.businessName || '', address: l.address || '', status: l.status || '',
    }));
  }

  // Every device serial on the platform and the restaurant it is registered to.
  // printer-list returns it alongside one restaurant's printers, so any valid
  // restaurant works as the anchor. Printers created without a serial get a
  // random one from the backend; those never match inventory and are harmless.
  async function serialIndex(anchor) {
    const r = await call('GET',
      `/api/device/printer-list?businessId=${anchor.businessId}&restaurantId=${anchor.restaurantId}`,
      { tenant: anchor.businessId });
    return (r.data?.existingSerialNumber || []).map(d => ({
      serial: String(d.deviceSerialNumber || ''), restaurantId: d.restaurantId,
    })).filter(d => d.serial);
  }

  async function listDevices(businessId, restaurantId) {
    const r = await call('GET',
      `/api/device/list?businessId=${businessId}&restaurantId=${restaurantId}&allRecords=true`,
      { tenant: businessId });
    if (!r.success) throw new Error(r.message || 'Could not read devices');
    const out = [];
    for (const g of r.data?.restaurants || []) {
      const type = GROUP_TYPES[g.name];
      if (!type) continue; // STATION
      for (const d of g.data || []) {
        const pay = d.paymentDeviceSerial && d.paymentDeviceSerial !== ':' ? d.paymentDeviceSerial : '';
        out.push({ id: String(d.id), type, name: d.name || '', serial: d.serialNo || '',
                   paymentDeviceSerial: pay, status: d.status || '' });
      }
    }
    return out;
  }

  // Returns { ok, message } — the backend reports a duplicate serial, or a POS
  // whose terminal can't be assigned, as success:false rather than an error.
  async function createDevice(businessId, restaurantId, d) {
    const device = {
      deviceType: d.type,
      deviceName: d.name,
      deviceSerialNumber: d.serial,
      ipAddress: '',
      printer: null,
      stickyPrinter: null,
      kdsStations: [],
      table: null,
    };
    if (d.type === 'tv') device.orientation = '0';
    if (d.paymentDeviceSerial) {
      device.paymentSource = 'adyen';
      device.paymentDeviceSerial = d.paymentDeviceSerial;
    }
    const r = await call('POST', '/api/device/create',
      { tenant: businessId, body: { businessId, restaurantId, device } });
    return { ok: r.success, message: r.message };
  }

  async function deleteDevice(businessId, restaurantId, d) {
    const r = await call('POST', '/api/device/delete',
      { tenant: businessId, body: { id: Number(d.id), restaurantId, businessId, deviceType: d.type } });
    return { ok: r.success, message: r.message };
  }

  return { listLocations, serialIndex, listDevices, createDevice, deleteDevice };
}

// Validates one device the browser asked to create. Returns an error string or null.
function validateDevice(d) {
  if (!d || typeof d !== 'object') return 'missing device';
  if (!MAPPABLE_TYPES.includes(d.type)) return `unsupported device type "${d.type}"`;
  if (typeof d.serial !== 'string' || d.serial.length < 2 || d.serial.length > 64 || !SERIAL_RE.test(d.serial))
    return `invalid serial "${d.serial}"`;
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 100) return `invalid name for ${d.serial}`;
  if (d.paymentDeviceSerial) {
    if (!PAYMENT_TYPES.includes(d.type)) return `${d.serial}: only a POS or kiosk takes a payment terminal`;
    if (!PAYMENT_SERIAL_RE.test(d.paymentDeviceSerial)) return `invalid payment terminal "${d.paymentDeviceSerial}"`;
  }
  return null;
}

module.exports = { createClient, validateDevice, unwrap, MAPPABLE_TYPES };
