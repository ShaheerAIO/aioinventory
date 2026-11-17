// Hardware forecast: the HubSpot filters (functions/hardwareForecast.js) and the
// formula the Forecast view computes (js/forecast.js, a browser IIFE evaluated here).
//
//   Run: node test/forecast.test.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const { getForecastData } = require(root + '/functions/hardwareForecast');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ── server: a fake HubSpot ──
const deal = (id, p) => ({ id, properties: { dealname: 'Deal ' + id, dealstage: 'active', ...p } });
const DEALS = [
  deal('1', { signed_date: '2026-08-10', modules_used: 'POS/Payments;Website' }),
  deal('2', { signed_date: '2026-09-30', modules_used: 'POS/Payments' }),
  deal('3', { signed_date: '2026-10-01' }),                                         // next quarter
  deal('4', { signed_date: '2026-08-01', dealstage: 'cancelled' }),                 // cancelled before live
  deal('5', { signed_date: '2026-08-01', dealstage: 'churned' }),                   // churned: still counts
  deal('6', { signed_date: '2026-08-01', aio_relationship_type_from_company: 'Ambassador;Test Account' }),
  deal('7', { signed_date: '2026-08-01', dealname: "Shaheer's test company" }),
  deal('8', { modules_used: 'Marketing;Website', dealstage: 'quote' }),            // pool
  deal('9', { modules_used: 'Marketing', dealstage: 'churned' }),                  // churned: not pool
  deal('10', { modules_used: 'Marketing;POS/Payments' }),                          // has POS: not pool
  deal('11', { modules_used: 'Website' }),                                          // pool
  deal('12', { dealname: 'Contest Pizza', signed_date: '2026-08-02' }),             // "test" mid-word: kept
];
const ITEMS = {
  1: [{ id: 'a', p: { name: 'QSR POS Hardware Bundle', quantity: '2', hs_product_id: '100' } },
      { id: 'b', p: { name: 'AIO Platform', quantity: '1', hs_product_id: '200', recurringbillingfrequency: 'monthly' } }],
  2: [{ id: 'c', p: { name: 'Custom cable', quantity: '3' } }],
};
async function fakeFetch(url, opts) {
  const u = new URL(url);
  const json = body => ({ ok: true, json: async () => body });
  if (u.pathname === '/crm/v3/objects/deals') {
    const after = Number(u.searchParams.get('after') || 0);
    return json({ results: DEALS.slice(after, after + 5), paging: after + 5 < DEALS.length ? { next: { after: String(after + 5) } } : undefined });
  }
  if (u.pathname === '/crm/v3/pipelines/deals') return json({ results: [{ stages: [
    { id: 'active', label: 'Deal Active' }, { id: 'cancelled', label: 'Cancelled Before Live' },
    { id: 'churned', label: 'Churned' }, { id: 'quote', label: 'Quote Sent' }] }] });
  if (u.pathname === '/account-info/v3/details') return json({ portalId: 42, uiDomain: 'app.hubspot.com' });
  const body = JSON.parse(opts.body);
  if (u.pathname === '/crm/v4/associations/deals/line_items/batch/read') return json({
    results: body.inputs.filter(i => ITEMS[i.id]).map(i => ({ from: { id: i.id }, to: ITEMS[i.id].map(x => ({ toObjectId: x.id })) })) });
  if (u.pathname === '/crm/v3/objects/line_items/batch/read') {
    const all = Object.values(ITEMS).flat();
    return json({ results: body.inputs.map(i => all.find(x => x.id === i.id)).map(x => ({ id: x.id, properties: x.p })) });
  }
  throw new Error('unexpected ' + url);
}

(async () => {
  const d = await getForecastData('tok', '2026-07-01', '2026-09-30', fakeFetch);
  eq(d.signed.map(r => r.id).sort(), ['1', '12', '2', '5'], 'signed in quarter: inclusive range, cancelled and tests out, churned in');
  eq(d.pool.map(r => r.id).sort(), ['11', '8'], 'pool: marketing-only, not churned, not POS');
  eq(d.excludedTests, 2, 'test accounts counted');
  const one = d.signed.find(r => r.id === '1');
  eq(one.items, [{ key: '100', name: 'QSR POS Hardware Bundle', qty: 2 }], 'recurring line items dropped');
  eq(d.signed.find(r => r.id === '2').items[0].key, 'name:Custom cable', 'line item without a product keyed by name');
  eq(d.dealUrl, 'https://app.hubspot.com/contacts/42/record/0-3/', 'deal link prefix');

  // ── client: the formula ──
  const src = fs.readFileSync(root + '/js/forecast.js', 'utf8');
  const Forecast = new Function(src + '\nreturn Forecast;')();
  const data = {
    signed: [
      { items: [{ key: '100', name: 'QSR', qty: 2 }, { key: '300', name: 'Onboarding', qty: 1 }] },
      { items: [{ key: '100', name: 'QSR', qty: 1 }, { key: '400', name: 'Mystery', qty: 5 }] },
      { items: [{ key: '300', name: 'Onboarding', qty: 1 }] },
    ],
    pool: new Array(10).fill({}),
  };
  const settings = {
    bundleMap: { 100: { parts: { POS: 1, Printer: 2 } }, 300: { ignore: true } },
    perDeal: { POS: 1, KDS: 0.5 },
    conversionPct: 25,                       // 10 × 25% = 2.5 → 3 deals
    z: { Printer: -4, KDS: 2 },
  };
  const r = Forecast._compute(data, settings, { POS: { inStock: 7, inTransit: 1 }, Router: { inStock: 9 } }, { POS: 2, Router: 52 / 12 });
  const row = p => r.rows.find(x => x.product === p);
  eq(r.B, 3, 'B rounds projected deals');
  eq(r.hwDeals, 2, 'deals with mapped hardware');
  eq([row('POS').a, row('POS').b, row('POS').needed], [2, 3, 5], 'POS = (A 2 + B 3) × 1');
  eq([row('Printer').a, row('Printer').needed], [0, 0], 'Printer: no b, Z −4 → 0');
  eq([row('KDS').a, row('KDS').b, row('KDS').needed], [1, 1.5, 5], 'KDS = (2 + 3) × 0.5 + 2, rounded up');
  eq([row('POS').inStock, row('POS').inTransit, row('KDS').inStock], [7, 1, 0], 'stock shown, not subtracted');
  eq([row('POS').avg, row('Printer').avg], [1.5, 3], 'average units per hardware deal');
  eq([row('POS').perMonth, row('POS').zone], [2, 'ok'], 'POS: deployments beat forecast 5/3; 8 units ≈ 17 weeks');
  eq([row('KDS').perMonth, row('KDS').zone], [2.5 / 3, 'red'], 'KDS: forecast use, no stock → red');
  eq([row('Router').cover, row('Router').zone], [9, 'amber'], 'Router: 9 weeks of cover, lead 8 → amber');
  eq(row('Printer').zone, '', 'no use → no zone');
  const r2 = Forecast._compute(data, { ...settings, leadWeeks: { Router: 10 } }, { Router: { inStock: 9 } }, { Router: 52 / 12 });
  eq([r2.rows.find(x => x.product === 'Router').lead, r2.rows.find(x => x.product === 'Router').zone], [10, 'red'], 'per-product lead time: 9 weeks of cover, lead 10 → red');
  eq(r.unmapped.map(h => h.key), ['400'], 'unmapped product flagged');
  eq(Forecast._compute(data, { ...settings, z: { POS: -100 } }).rows.find(x => x.product === 'POS').needed, 0, 'needed never negative');

  eq(Forecast._qRange('2026-Q3'), { from: '2026-07-01', to: '2026-09-30' }, 'quarter range');
  eq(Forecast._qRange('2024-Q1').to, '2024-03-31', 'Q1 end');
  eq(Forecast._nextQ('2026-Q4'), '2027-Q1', 'next quarter wraps the year');
  eq(Forecast._recentQuarters(new Date(2026, 10, 16)).slice(0, 3), ['2026-Q4', '2026-Q3', '2026-Q2'], 'recent quarters');

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
