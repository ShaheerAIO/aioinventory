/**
 * hubspotSync.js — nightly rollup of deployed hardware (units + value) per
 * customer into HubSpot Company properties.
 *
 * The aggregation rules live in inventoryStats.js, shared with the metrics
 * endpoint so there is only one server-side copy to keep in sync with
 * js/inventory.js.
 */

const admin = require('firebase-admin');
const { loadInventory, computeDeployedByCustomer } = require('./inventoryStats');

const HUBSPOT_DEVICE_COUNT_PROP = 'aio_device_count';
const HUBSPOT_DEPLOYED_VALUE_PROP = 'aio_total_deployed_value';

async function patchHubspotCompany(token, companyId, properties) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    throw new Error(`HubSpot PATCH failed for company ${companyId}: ${res.status} ${await res.text()}`);
  }
}

async function runHubspotSync(hubspotToken) {
  const db = admin.firestore();
  const { data, movements, serialCosts } = await loadInventory(db);
  const hubspotCompanyMap = data.hubspotCompanyMap || {};
  // pendingDeployments intentionally excluded — not committed movements yet.

  const byCustomer = computeDeployedByCustomer(movements, serialCosts);

  const results = [];
  for (const [customer, agg] of Object.entries(byCustomer)) {
    const companyId = hubspotCompanyMap[customer];
    if (!companyId) {
      results.push({ customer, skipped: 'unmapped' });
      continue;
    }
    await patchHubspotCompany(hubspotToken, companyId, {
      [HUBSPOT_DEVICE_COUNT_PROP]: agg.units,
      [HUBSPOT_DEPLOYED_VALUE_PROP]: agg.value,
    });
    results.push({ customer, companyId, units: agg.units, value: agg.value });
  }
  return results;
}

module.exports = { runHubspotSync };
