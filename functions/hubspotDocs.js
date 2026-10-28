/**
 * hubspotDocs.js — a company's quotes and invoices, for the Stock Out form.
 *
 * Staff pick hardware from the quote/invoice, so the form shows them before any
 * serial is scanned. Quotes usually hang off a deal rather than the company, so
 * this collects records linked to the company directly AND to its deals, deduped.
 */

const API = 'https://api.hubapi.com';

const QUOTE_PROPS = ['hs_title', 'hs_quote_number', 'hs_status', 'hs_quote_amount', 'hs_quote_link', 'hs_expiration_date', 'hs_createdate'];
const INVOICE_PROPS = ['hs_number', 'hs_invoice_status', 'hs_amount_billed', 'hs_balance_due', 'hs_due_date', 'hs_invoice_link', 'hs_createdate'];

let _account = null; // { portalId, uiDomain } — fixed per token, so cached for the instance's life

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

async function companyAssoc(fetchFn, token, companyId, toType) {
  const ids = [];
  let after = '';
  do {
    const page = await hs(fetchFn, token,
      `/crm/v4/objects/companies/${companyId}/associations/${toType}?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    (page.results || []).forEach(r => ids.push(String(r.toObjectId)));
    after = page.paging?.next?.after || '';
  } while (after);
  return ids;
}

async function dealAssoc(fetchFn, token, dealIds, toType) {
  const ids = [];
  for (const part of chunks(dealIds, 100)) {
    const body = await hs(fetchFn, token, `/crm/v4/associations/deals/${toType}/batch/read`,
      { inputs: part.map(id => ({ id })) });
    (body.results || []).forEach(r => (r.to || []).forEach(t => ids.push(String(t.toObjectId))));
  }
  return ids;
}

async function readObjects(fetchFn, token, type, ids, properties) {
  const rows = [];
  for (const part of chunks(ids, 100)) {
    const body = await hs(fetchFn, token, `/crm/v3/objects/${type}/batch/read`,
      { inputs: part.map(id => ({ id })), properties });
    rows.push(...(body.results || []));
  }
  return rows;
}

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const newestFirst = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

async function getCompanyDocs(token, companyId, fetchFn = fetch) {
  if (!_account) {
    const a = await hs(fetchFn, token, '/account-info/v3/details');
    _account = { portalId: a.portalId, uiDomain: a.uiDomain || 'app.hubspot.com' };
  }
  const recordUrl = (typeId, id) => `https://${_account.uiDomain}/contacts/${_account.portalId}/record/${typeId}/${id}`;

  const [dealIds, directQuotes, directInvoices] = await Promise.all([
    companyAssoc(fetchFn, token, companyId, 'deals'),
    companyAssoc(fetchFn, token, companyId, 'quotes'),
    companyAssoc(fetchFn, token, companyId, 'invoices'),
  ]);
  const [dealQuotes, dealInvoices] = dealIds.length
    ? await Promise.all([dealAssoc(fetchFn, token, dealIds, 'quotes'), dealAssoc(fetchFn, token, dealIds, 'invoices')])
    : [[], []];

  const quoteIds = [...new Set([...directQuotes, ...dealQuotes])];
  const invoiceIds = [...new Set([...directInvoices, ...dealInvoices])];

  const [quoteRows, invoiceRows] = await Promise.all([
    readObjects(fetchFn, token, 'quotes', quoteIds, QUOTE_PROPS),
    readObjects(fetchFn, token, 'invoices', invoiceIds, INVOICE_PROPS),
  ]);

  const quotes = quoteRows.map(r => {
    const p = r.properties || {};
    return {
      id: String(r.id),
      title: p.hs_title || '',
      number: p.hs_quote_number || '',
      status: p.hs_status || '',
      amount: num(p.hs_quote_amount),
      date: p.hs_createdate || '',
      expires: p.hs_expiration_date || '',
      publicUrl: p.hs_quote_link || '',
      hubspotUrl: recordUrl('0-14', r.id),
    };
  }).sort(newestFirst);

  const invoices = invoiceRows.map(r => {
    const p = r.properties || {};
    return {
      id: String(r.id),
      number: p.hs_number || '',
      status: p.hs_invoice_status || '',
      amount: num(p.hs_amount_billed),
      balance: num(p.hs_balance_due),
      date: p.hs_createdate || '',
      due: p.hs_due_date || '',
      publicUrl: p.hs_invoice_link || '',
      hubspotUrl: recordUrl('0-53', r.id),
    };
  }).sort(newestFirst);

  return { quotes, invoices };
}

module.exports = { getCompanyDocs };
