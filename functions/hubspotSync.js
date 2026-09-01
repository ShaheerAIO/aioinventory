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

  // Several inventory customer names can point at one HubSpot company — a
  // renamed account, or a pair like "Sammy G's" and "Sammy G's Pizza". Roll the
  // totals up per company BEFORE writing: a PATCH per customer name assigns
  // rather than accumulates, so the last name written would win and every other
  // name's hardware would silently vanish from the company record.
  const results = [];
  const byCompany = new Map();

  for (const [customer, agg] of Object.entries(byCustomer)) {
    const companyId = hubspotCompanyMap[customer];
    if (!companyId) {
      results.push({ customer, skipped: 'unmapped' });
      continue;
    }
    const roll = byCompany.get(companyId) || { units: 0, value: 0, customers: [] };
    roll.units += agg.units;
    roll.value += agg.value;
    roll.customers.push(customer);
    byCompany.set(companyId, roll);
  }

  for (const [companyId, roll] of byCompany) {
    await patchHubspotCompany(hubspotToken, companyId, {
      [HUBSPOT_DEVICE_COUNT_PROP]: roll.units,
      [HUBSPOT_DEPLOYED_VALUE_PROP]: roll.value,
    });
    results.push({ companyId, customers: roll.customers, units: roll.units, value: roll.value });
  }
  return results;
}

module.exports = { runHubspotSync };
