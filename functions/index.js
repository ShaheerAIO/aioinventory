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
