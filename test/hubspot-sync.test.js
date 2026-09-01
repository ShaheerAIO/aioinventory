/**
 * hubspot-sync.test.js — the nightly HubSpot rollup.
 *
 * Guards the case that made duplicate mappings destructive: two inventory
 * customer names pointing at one HubSpot company. The PATCH assigns rather than
 * accumulates, so writing once per customer name loses every name but the last.
 *
 * Run: node test/hubspot-sync.test.js
 */

// firebase-admin lives under functions/node_modules and the test suite is
// deliberately dependency-free, so intercept the require instead of resolving it.
const Module = require('module');
const _load = Module._load;
const adminStub = { initializeApp() {}, firestore: null };
Module._load = function (request, ...rest) {
  return request === 'firebase-admin' ? adminStub : _load.call(this, request, ...rest);
};

let passed = 0, failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label} (${a} === ${e})`); passed++; }
  else { console.log(`  ✗ ${label} (${a} !== ${e})`); failed++; }
}

// ── Fixture ────────────────────────────────────────────────────────────────
// Sammy G's ships under two names that map to one company; Crema is its own.
const OUT = (customer, serials) => ({ type: 'OUT', product: 'Terminal', location: 'SJ', customer, serials, date: '2026-01-02' });
const IN  = (serials) => ({ type: 'IN', product: 'Terminal', location: 'SJ', supplier: 'Acme', serials, date: '2026-01-01' });

const doc = {
  hubspotCompanyMap: {
    "Sammy G's (595)":       '250498547410',
    "Sammy G's Pizza (595)": '250498547410',   // same company
    'Crema (1750)':          '250498570942',
    // 'Unlinked Cafe' deliberately absent
  },
  serialCosts: { 'S-1': 100, 'S-2': 100, 'S-3': 100, 'S-4': 100, 'S-5': 100 },
  movements: [
    IN(['S-1', 'S-2', 'S-3', 'S-4', 'S-5']),
    OUT("Sammy G's (595)",       ['S-1', 'S-2']),
    OUT("Sammy G's Pizza (595)", ['S-3']),
    OUT('Crema (1750)',          ['S-4']),
    OUT('Unlinked Cafe',         ['S-5']),
  ],
};

adminStub.firestore = () => ({
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => doc }) }) }),
});

const patches = [];
global.fetch = async (url, opts) => {
  patches.push({ id: url.split('/').pop(), props: JSON.parse(opts.body).properties });
  return { ok: true, status: 200, text: async () => '' };
};

const { runHubspotSync } = require('../functions/hubspotSync');

(async () => {
  console.log('\nTwo customer names sharing one HubSpot company');
  const results = await runHubspotSync('fake-token');

  eq('one PATCH per company, not per customer', patches.length, 2);

  const sammy = patches.find(p => p.id === '250498547410');
  eq('shared company gets the SUM, not the last write', sammy.props.aio_device_count, 3);
  eq('value adds up too', sammy.props.aio_total_deployed_value, 300);

  const crema = patches.find(p => p.id === '250498570942');
  eq('unshared company unaffected', crema.props.aio_device_count, 1);

  const rolled = results.find(r => r.companyId === '250498547410');
  eq('result names every customer rolled in', rolled.customers.sort(), ["Sammy G's (595)", "Sammy G's Pizza (595)"]);
  eq('unmapped still reported per customer', results.filter(r => r.skipped === 'unmapped').map(r => r.customer), ['Unlinked Cafe']);
  eq('unmapped never patched', patches.some(p => p.props.aio_device_count === 1 && p.id !== '250498570942'), false);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
