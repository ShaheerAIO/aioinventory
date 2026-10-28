// HubSpot quotes/invoices for Stock Out: functions/hubspotDocs.js against a fake
// HubSpot that links one quote both to the company and to its deal.
//
//   Run: node test/hubspot-docs.test.js
const root = require('path').resolve(__dirname, '..');

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

function fakeHubspot({ failOn = null } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    const path = url.replace('https://api.hubapi.com', '');
    calls.push(path);
    if (failOn && path.startsWith(failOn)) return { ok: false, status: 403, json: async () => ({}), text: async () => 'MISSING_SCOPES' };
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (path === '/account-info/v3/details') return ok({ portalId: 123, uiDomain: 'app.hubspot.com' });
    if (path.startsWith('/crm/v4/objects/companies/9/associations/deals')) return ok({ results: [{ toObjectId: 50 }] });
    if (path.startsWith('/crm/v4/objects/companies/9/associations/quotes')) return ok({ results: [{ toObjectId: 1 }] });
    if (path.startsWith('/crm/v4/objects/companies/9/associations/invoices')) return ok({ results: [] });
    if (path === '/crm/v4/associations/deals/quotes/batch/read') return ok({ results: [{ from: { id: '50' }, to: [{ toObjectId: 1 }, { toObjectId: 2 }] }] });
    if (path === '/crm/v4/associations/deals/invoices/batch/read') return ok({ results: [{ from: { id: '50' }, to: [{ toObjectId: 7 }] }] });
    if (path === '/crm/v3/objects/quotes/batch/read') return ok({ results: body.inputs.map(({ id }) => ({ id, properties: {
      hs_title: `Quote ${id}`, hs_quote_number: `Q-${id}`, hs_status: 'APPROVED', hs_quote_amount: '100.5',
      hs_quote_link: `https://quote/${id}`, hs_createdate: id === '2' ? '2026-10-02T00:00:00Z' : '2026-09-01T00:00:00Z' } })) });
    if (path === '/crm/v3/objects/invoices/batch/read') return ok({ results: body.inputs.map(({ id }) => ({ id, properties: {
      hs_number: `INV-${id}`, hs_invoice_status: 'open', hs_amount_billed: '250', hs_invoice_link: `https://pay/${id}` } })) });
    throw new Error('unexpected call ' + path);
  };
  return { fn, calls };
}

(async () => {
  // Fresh module so the cached portal id from one case can't hide a failure in another
  const load = () => { delete require.cache[require.resolve(root + '/functions/hubspotDocs.js')]; return require(root + '/functions/hubspotDocs.js'); };

  console.log('company + deal records, deduped');
  {
    const hs = fakeHubspot();
    const { quotes, invoices } = await load().getCompanyDocs('tok', '9', hs.fn);
    eq('quote linked to both company and deal appears once', quotes.map(q => q.id).sort(), ['1', '2']);
    eq('newest quote first', quotes.map(q => q.id), ['2', '1']);
    eq('deal-only invoice included', invoices.map(i => i.number), ['INV-7']);
    eq('amount is a number', quotes[0].amount, 100.5);
    eq('public quote link', quotes[0].publicUrl, 'https://quote/2');
    eq('quote HubSpot record URL', quotes[0].hubspotUrl, 'https://app.hubspot.com/contacts/123/record/0-14/2');
    eq('invoice HubSpot record URL', invoices[0].hubspotUrl, 'https://app.hubspot.com/contacts/123/record/0-53/7');
    eq('public invoice link', invoices[0].publicUrl, 'https://pay/7');
  }

  console.log('HubSpot errors surface');
  {
    const hs = fakeHubspot({ failOn: '/crm/v3/objects/quotes' });
    let msg = '';
    try { await load().getCompanyDocs('tok', '9', hs.fn); } catch (e) { msg = e.message; }
    eq('non-OK response throws with status and body', /403 MISSING_SCOPES/.test(msg), true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
