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
