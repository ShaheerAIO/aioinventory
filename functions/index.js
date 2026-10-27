const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const { runHubspotSync } = require('./hubspotSync');

const HUBSPOT_TOKEN = defineSecret('HUBSPOT_TOKEN');
const MANUAL_TRIGGER_KEY = defineSecret('MANUAL_TRIGGER_KEY');

// Nightly sync — inventory deployed-hardware rollups -> HubSpot Companies.
exports.hubspotNightlySync = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'America/Chicago', secrets: [HUBSPOT_TOKEN] },
  async () => {
    const results = await runHubspotSync(HUBSPOT_TOKEN.value());
    console.log('hubspotNightlySync results:', JSON.stringify(results));
  }
);

// On-demand trigger for testing/manual re-sync — guarded by a shared secret
// query param so it isn't an open endpoint.
exports.hubspotSyncManual = onRequest(
  { secrets: [HUBSPOT_TOKEN, MANUAL_TRIGGER_KEY] },
  async (req, res) => {
    if (req.query.key !== MANUAL_TRIGGER_KEY.value()) {
      res.status(403).send('forbidden');
      return;
    }
    try {
      const results = await runHubspotSync(HUBSPOT_TOKEN.value());
      res.json({ ok: true, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ── Metrics feed for the executive dashboard ─────────────────────────────────
// Read-only aggregates. Guarded by a shared secret in the X-Metrics-Key header
// rather than a query param, so the key doesn't land in request logs.
const METRICS_KEY = defineSecret('METRICS_KEY');
const { loadInventory, computeMetrics, computeDeployedByCompany } = require('./inventoryStats');

exports.metrics = onRequest({ secrets: [METRICS_KEY], cors: false }, async (req, res) => {
  const key = req.get('X-Metrics-Key') || '';
  const expected = METRICS_KEY.value() || '';
  // Fail closed — an unset secret rejects everything rather than opening up.
  if (!expected || key !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: 'from and to are required, as YYYY-MM-DD' });
    return;
  }
  const fromMs = Date.parse(from + 'T00:00:00Z');
  // `to` is inclusive, so extend to the end of that day.
  const toMs = Date.parse(to + 'T00:00:00Z') + 86400000;
  if (isNaN(fromMs) || isNaN(toMs) || fromMs >= toMs) {
    res.status(400).json({ error: 'from must not be after to' });
    return;
  }

  try {
    const inv = await loadInventory(admin.firestore());
    const m = computeMetrics(inv, fromMs, toMs);
    res.json({ generatedAt: new Date().toISOString(), period: { from, to }, ...m });
  } catch (e) {
    console.error('metrics failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Per-customer deployed hardware, keyed to HubSpot Company IDs. Same shared
// secret as /metrics. No date range — deployed is a point-in-time balance.
exports.deployedByCompany = onRequest({ secrets: [METRICS_KEY], cors: false }, async (req, res) => {
  const key = req.get('X-Metrics-Key') || '';
  const expected = METRICS_KEY.value() || '';
  // Fail closed — an unset secret rejects everything rather than opening up.
  if (!expected || key !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const inv = await loadInventory(admin.firestore());
    res.json({ generatedAt: new Date().toISOString(), ...computeDeployedByCompany(inv) });
  } catch (e) {
    console.error('deployedByCompany failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Company lookup for the in-app HubSpot picker ─────────────────────────────
// Called from the browser by a signed-in user, so this is gated on a Firebase
// Auth ID token plus the caller's app role — a shared secret would have to ship
// inside client JS, where it is public. Viewers are excluded: mapping is an
// editing action, and this enumerates CRM company names.
const { searchHubspotCompanies } = require('./hubspotCompanies');

const PICKER_ORIGINS = [
  'https://aioinventory.vercel.app',
  'https://shaheeraio.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];

exports.hubspotCompanySearch = onRequest(
  { secrets: [HUBSPOT_TOKEN], cors: PICKER_ORIGINS },
  async (req, res) => {
    const bearer = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
    if (!bearer) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(bearer[1])).uid;
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await admin.firestore().doc(`users/${uid}`).get();
    const role = profile.exists ? profile.data().role : null;
    if (!['superadmin', 'admin', 'edit'].includes(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const q = String(req.query.q || '').trim().slice(0, 200);
    if (q.length < 2) {
      res.status(400).json({ error: 'q must be at least 2 characters' });
      return;
    }

    try {
      res.json({ results: await searchHubspotCompanies(HUBSPOT_TOKEN.value(), q) });
    } catch (e) {
      console.error('hubspotCompanySearch failed:', e.message);
      res.status(502).json({ error: 'HubSpot lookup failed' });
    }
  }
);

// ── Device mapping against the AIO production dashboard ──────────────────────
// Backs the Map Devices view. Reads (restaurants, each one's devices, and the
// platform-wide serial index) are open to admins; anything that writes to the
// production dashboard is super admin only. Same Firebase ID token + app role
// gate as the HubSpot picker.
const AIO_DASHBOARD_USERNAME = defineSecret('AIO_DASHBOARD_USERNAME');
const AIO_DASHBOARD_PASSWORD = defineSecret('AIO_DASHBOARD_PASSWORD');
const { createClient, validateDevice } = require('./aioDashboard');
const UNIFI_API_KEY = defineSecret('UNIFI_API_KEY');
const { listUnifiDevices } = require('./unifi');

const MAX_DEVICES_PER_MAP = 50;
const CACHE_MS = 2 * 60 * 1000;
let _aio = null;
let _cache = { at: 0, locations: null, serials: null };
let _unifi = { at: 0, devices: null };
// Every paired AMS1 means reading each restaurant's device list — one call per
// restaurant, so it is cached longer and fetched only for the discrepancy report
const TERMINAL_CACHE_MS = 10 * 60 * 1000;
const TERMINAL_SCAN_CONCURRENCY = 6;
let _terminals = { at: 0, data: null };

function aio() {
  if (!_aio) _aio = createClient({ username: AIO_DASHBOARD_USERNAME.value(), password: AIO_DASHBOARD_PASSWORD.value() });
  return _aio;
}

async function overview(fresh) {
  if (fresh || !_cache.locations || Date.now() - _cache.at > CACHE_MS) {
    const locations = await aio().listLocations();
    if (!locations.length) throw new Error('The AIO dashboard returned no restaurants');
    const serials = await aio().serialIndex(locations[0]);
    _cache = { at: Date.now(), locations, serials };
  }
  return { locations: _cache.locations, serials: _cache.serials };
}

// The list shows a backend-generated printer serial without its "printer_" prefix
const listedSerial = s => String(s).replace(/^printer_/, '').toUpperCase();

async function terminalIndex(fresh) {
  if (fresh || !_terminals.data || Date.now() - _terminals.at > TERMINAL_CACHE_MS) {
    const { locations, serials } = await overview(fresh);
    const terminals = [], failed = [];
    const listed = new Map(); // restaurantId → Set of serials its device list shows
    let next = 0;
    const worker = async () => {
      while (next < locations.length) {
        const loc = locations[next++];
        try {
          const devices = await aio().listDevices(loc.businessId, loc.restaurantId);
          listed.set(loc.restaurantId, new Set(devices.map(d => listedSerial(d.serial))));
          devices
            .filter(d => d.paymentDeviceSerial)
            .forEach(d => terminals.push({ serial: d.paymentDeviceSerial, restaurantId: loc.restaurantId,
                                           device: { type: d.type, name: d.name, serial: d.serial } }));
        } catch {
          failed.push(loc.restaurantId);
        }
      }
    };
    await Promise.all(Array.from({ length: TERMINAL_SCAN_CONCURRENCY }, worker));
    // Stuck: the serial is taken (restaurant_devices) but its restaurant lists no device with it —
    // a create that failed after its first insert. Only restaurants that were read are judged.
    const stuck = serials.filter(s => listed.has(s.restaurantId) && !listed.get(s.restaurantId).has(listedSerial(s.serial)));
    _terminals = { at: Date.now(), data: { terminals, failed, stuck } };
  }
  return _terminals.data;
}

async function callerRole(req) {
  const bearer = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  if (!bearer) return null;
  try {
    const { uid } = await admin.auth().verifyIdToken(bearer[1]);
    const profile = await admin.firestore().doc(`users/${uid}`).get();
    return profile.exists && !profile.data().deleted ? profile.data().role : null;
  } catch {
    return null;
  }
}

// The restaurant a serial is registered to right now, read fresh, plus the device record
async function findRegistered(serial) {
  const { locations, serials } = await overview(true);
  const hit = serials.find(s => s.serial.toUpperCase() === serial.toUpperCase());
  const loc = hit && locations.find(l => l.restaurantId === hit.restaurantId);
  if (!loc) return null;
  const device = (await aio().listDevices(loc.businessId, loc.restaurantId))
    .find(d => d.serial.toUpperCase() === serial.toUpperCase());
  return device ? { loc, device } : null;
}

async function knownLocation(businessId, restaurantId) {
  const { locations } = await overview(false);
  return locations.find(l => l.businessId === businessId && l.restaurantId === restaurantId) || null;
}

exports.aioDevices = onRequest(
  { secrets: [AIO_DASHBOARD_USERNAME, AIO_DASHBOARD_PASSWORD, UNIFI_API_KEY], cors: PICKER_ORIGINS, timeoutSeconds: 300 },
  async (req, res) => {
    const role = await callerRole(req);
    if (!role) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!['superadmin', 'admin'].includes(role)) { res.status(403).json({ error: 'Forbidden' }); return; }

    const isWrite = req.method === 'POST';
    if (isWrite && role !== 'superadmin') {
      res.status(403).json({ error: 'Only a super admin can change the AIO dashboard' });
      return;
    }
    const p = isWrite ? (req.body || {}) : req.query;
    const action = String(p.action || '');

    try {
      if (!isWrite && action === 'overview') {
        res.json(await overview(p.fresh === '1'));
        return;
      }

      // Every UniFi device (read-only key) — reconciled against inventory in the browser
      if (!isWrite && action === 'unifi') {
        if (p.fresh === '1' || !_unifi.devices || Date.now() - _unifi.at > CACHE_MS) {
          _unifi = { at: Date.now(), devices: await listUnifiDevices(UNIFI_API_KEY.value()) };
        }
        res.json({ devices: _unifi.devices });
        return;
      }

      // Every AMS1 paired onto a POS or kiosk record, platform-wide
      if (!isWrite && action === 'terminals') {
        res.json(await terminalIndex(p.fresh === '1'));
        return;
      }

      if (!isWrite && action === 'devices') {
        const loc = await knownLocation(Number(p.businessId), Number(p.restaurantId));
        if (!loc) { res.status(400).json({ error: 'Unknown restaurant' }); return; }
        res.json({ devices: await aio().listDevices(loc.businessId, loc.restaurantId) });
        return;
      }

      if (isWrite && action === 'map') {
        const loc = await knownLocation(Number(p.businessId), Number(p.restaurantId));
        if (!loc) { res.status(400).json({ error: 'Unknown restaurant' }); return; }
        const devices = Array.isArray(p.devices) ? p.devices : [];
        if (!devices.length || devices.length > MAX_DEVICES_PER_MAP) {
          res.status(400).json({ error: `Send between 1 and ${MAX_DEVICES_PER_MAP} devices` });
          return;
        }
        const bad = devices.map(validateDevice).filter(Boolean);
        if (bad.length) { res.status(400).json({ error: bad.join('; ') }); return; }

        // One at a time — the backend's duplicate check is a read-then-write,
        // so parallel creates could race it.
        const results = [];
        for (const d of devices) {
          try {
            const r = await aio().createDevice(loc.businessId, loc.restaurantId, d);
            results.push({ serial: d.serial, ok: r.ok, message: r.message });
          } catch (e) {
            results.push({ serial: d.serial, ok: false, message: e.message });
          }
        }
        _cache.at = 0; _terminals.at = 0;
        res.json({ results });
        return;
      }

      if (isWrite && (action === 'move' || action === 'remove')) {
        const serial = String(p.serial || '').trim();
        if (!serial) { res.status(400).json({ error: 'serial is required' }); return; }
        const found = await findRegistered(serial);
        if (!found) { res.status(404).json({ error: `${serial} is not registered in the AIO dashboard` }); return; }
        const { loc: from, device } = found;

        let to = null, moved = null;
        if (action === 'move') {
          to = await knownLocation(Number(p.to?.businessId), Number(p.to?.restaurantId));
          if (!to) { res.status(400).json({ error: 'Unknown destination restaurant' }); return; }
          if (to.restaurantId === from.restaurantId) { res.status(400).json({ error: 'Already at that restaurant' }); return; }
          // The payment terminal travels with its POS; the backend re-assigns it to the new Adyen store
          moved = { type: device.type, serial: device.serial, name: String(p.name || device.name).trim(),
                    paymentDeviceSerial: device.paymentDeviceSerial };
          const bad = validateDevice(moved);
          if (bad) { res.status(400).json({ error: bad }); return; }
        }

        const del = await aio().deleteDevice(from.businessId, from.restaurantId, device);
        _cache.at = 0; _terminals.at = 0;
        if (!del.ok) { res.json({ ok: false, message: del.message || 'Delete failed' }); return; }
        if (action === 'remove') { res.json({ ok: true, from }); return; }

        const made = await aio().createDevice(to.businessId, to.restaurantId, moved).catch(e => ({ ok: false, message: e.message }));
        if (made.ok) { res.json({ ok: true, from, to }); return; }

        // Put it back where it was so a failed move never drops a device off the platform
        const back = await aio().createDevice(from.businessId, from.restaurantId, { ...moved, name: device.name })
          .catch(e => ({ ok: false, message: e.message }));
        res.json({ ok: false, message: made.message || 'Create at destination failed', restored: back.ok, from, to });
        return;
      }

      res.status(400).json({ error: `Unknown action "${action}"` });
    } catch (e) {
      console.error('aioDevices failed:', e);
      res.status(502).json({ error: e.message });
    }
  }
);

// ── AIO Buddy access picker ──────────────────────────────────────────────────
// Lets a super admin add restaurants to an AIO Buddy account they pick. It runs as the
// same ops service account as aioDevices, which must first be granted the dashboard's
// aiobuddy read/update permissions (a super admin does that once, in the dashboard);
// no super admin login is stored here. Only an existing buddy can be named (checked
// against the dashboard's buddy list), and only existing buddies — it creates none.
// Add-only: it never removes access.
const { grantLocations, grantedIds, resolveBuddy } = require('./buddyAccess');

const MAX_GRANT = 50;

exports.aioBuddyAccess = onRequest(
  { secrets: [AIO_DASHBOARD_USERNAME, AIO_DASHBOARD_PASSWORD], cors: PICKER_ORIGINS, timeoutSeconds: 120 },
  async (req, res) => {
    const role = await callerRole(req);
    if (!role) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (role !== 'superadmin') { res.status(403).json({ error: 'Super admin only' }); return; }

    const isWrite = req.method === 'POST';
    const p = isWrite ? (req.body || {}) : req.query;
    const action = String(p.action || '');

    try {
      if (!isWrite && action === 'buddies') {
        const buddies = await aio().listBuddies();
        res.json({ buddies: buddies.map(b => ({ id: b.id, email: b.email, name: b.fullName })) });
        return;
      }

      if (!isWrite && action === 'state') {
        const target = await resolveBuddy(aio(), p.buddyId);
        const [locations, buddy] = await Promise.all([aio().listLocations(), aio().getBuddy(target.id)]);
        const b = buddy.aioBuddy;
        res.json({
          buddy: { id: target.id, name: `${b.firstName} ${b.lastName}`.trim(), email: b.email },
          granted: [...grantedIds(buddy)],
          locations,
        });
        return;
      }

      if (isWrite && action === 'grant') {
        const ids = [...new Set((Array.isArray(p.restaurantIds) ? p.restaurantIds : []).map(Number))];
        if (!ids.length || ids.length > MAX_GRANT || ids.some(n => !Number.isInteger(n) || n <= 0)) {
          res.status(400).json({ error: `Send between 1 and ${MAX_GRANT} restaurant ids` });
          return;
        }
        const target = await resolveBuddy(aio(), p.buddyId);
        res.json(await grantLocations(aio(), target.id, ids, await aio().listLocations()));
        return;
      }

      res.status(400).json({ error: `Unknown action "${action}"` });
    } catch (e) {
      console.error('aioBuddyAccess failed:', e);
      res.status(502).json({ error: e.message });
    }
  }
);
