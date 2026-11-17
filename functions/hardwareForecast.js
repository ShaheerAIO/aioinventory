/**
 * hardwareForecast.js — the HubSpot side of the quarterly hardware forecast.
 *
 * Returns, for one quarter:
 *   signed — deals signed in it (Signed Date), each with its one-off line items.
 *            HubSpot sells bundles ("QSR POS Hardware Bundle"), so the browser maps
 *            each line item's product to inventory products; nothing is mapped here.
 *   pool   — marketing-only deals (Modules Used without POS/Payments) still alive,
 *            the deals sales aims to convert to full deals with hardware.
 * Test accounts are dropped from both. Read only.
 */

const API = 'https://api.hubapi.com';

const DEAL_PROPS = ['dealname', 'dealstage', 'signed_date', 'modules_used', 'deal_status', 'aio_relationship_type_from_company'];
const ITEM_PROPS = ['name', 'quantity', 'hs_product_id', 'recurringbillingfrequency'];

// Stages a deal never comes back from. A deal signed and then cancelled before
// going live took no hardware; a churned one did, so churn only leaves the pool.
const DEAD_SIGNED = ['Closed Lost', 'Cancelled Before Live'];
const DEAD_POOL = ['Closed Lost', 'Cancelled Before Live', 'Churned'];

async function hs(fetchFn, token, path, body) {
  const res = await fetchFn(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HubSpot ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const isTest = p => String(p.aio_relationship_type_from_company || '').split(';').includes('Test Account')
  || /\btest/i.test(p.dealname || '');
const modules = p => String(p.modules_used || '').split(';').filter(Boolean);
const isMarketingOnly = p => modules(p).length > 0 && !modules(p).includes('POS/Payments');

async function allDeals(fetchFn, token) {
  const deals = [];
  let after = '';
  do {
    const page = await hs(fetchFn, token,
      `/crm/v3/objects/deals?limit=100&properties=${DEAL_PROPS.join(',')}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    deals.push(...(page.results || []));
    after = page.paging?.next?.after || '';
  } while (after);
  return deals;
}

// One-off line items per deal id. Recurring ones (platform, payroll, marketing
// subscriptions) are never hardware.
async function oneOffItems(fetchFn, token, dealIds) {
  const itemDeal = {};
  for (const part of chunks(dealIds, 100)) {
    const body = await hs(fetchFn, token, '/crm/v4/associations/deals/line_items/batch/read',
      { inputs: part.map(id => ({ id })) });
    (body.results || []).forEach(r => (r.to || []).forEach(t => { itemDeal[String(t.toObjectId)] = String(r.from.id); }));
  }
  const byDeal = {};
  for (const part of chunks(Object.keys(itemDeal), 100)) {
    const body = await hs(fetchFn, token, '/crm/v3/objects/line_items/batch/read',
      { inputs: part.map(id => ({ id })), properties: ITEM_PROPS });
    (body.results || []).forEach(r => {
      const p = r.properties || {};
      if (p.recurringbillingfrequency) return;
      const name = String(p.name || '').trim();
      (byDeal[itemDeal[r.id]] ||= []).push({
        key: p.hs_product_id ? String(p.hs_product_id) : `name:${name}`,
        name,
        qty: Number(p.quantity) || 0,
      });
    });
  }
  return byDeal;
}

// from / to are YYYY-MM-DD, both inclusive
async function getForecastData(token, from, to, fetchFn = fetch) {
  const [deals, pipelines, account] = await Promise.all([
    allDeals(fetchFn, token),
    hs(fetchFn, token, '/crm/v3/pipelines/deals'),
    hs(fetchFn, token, '/account-info/v3/details'),
  ]);
  const stageLabel = {};
  (pipelines.results || []).forEach(p => (p.stages || []).forEach(s => { stageLabel[s.id] = s.label; }));
  const row = d => ({
    id: String(d.id),
    name: d.properties.dealname || '',
    stage: stageLabel[d.properties.dealstage] || d.properties.dealstage || '',
    status: d.properties.deal_status || '',
    modules: modules(d.properties),
    signedDate: d.properties.signed_date || '',
  });

  const live = deals.filter(d => !isTest(d.properties));
  const signed = live
    .filter(d => { const s = (d.properties.signed_date || '').slice(0, 10); return s && s >= from && s <= to; })
    .map(row)
    .filter(r => !DEAD_SIGNED.includes(r.stage));
  const pool = live
    .filter(d => isMarketingOnly(d.properties))
    .map(row)
    .filter(r => !DEAD_POOL.includes(r.stage));

  const items = await oneOffItems(fetchFn, token, signed.map(r => r.id));
  signed.forEach(r => { r.items = items[r.id] || []; });

  return {
    from, to,
    signed: signed.sort((a, b) => a.signedDate.localeCompare(b.signedDate)),
    pool: pool.sort((a, b) => a.name.localeCompare(b.name)),
    excludedTests: deals.length - live.length,
    dealUrl: `https://${account.uiDomain || 'app.hubspot.com'}/contacts/${account.portalId}/record/0-3/`,
    at: Date.now(),
  };
}

module.exports = { getForecastData, _isTest: isTest, _isMarketingOnly: isMarketingOnly };
