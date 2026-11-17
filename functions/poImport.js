// Reads a supplier's purchase order / pro-forma / packing list (PDF, image, or a
// spreadsheet the browser has turned into CSV text) with Claude and returns what
// the Orders form needs: supplier, PO number, dates, tax and one line per product
// with its quantity, unit cost and any serial numbers printed on the document.
//
// Takes the Anthropic client as a parameter so the test can pass a fake one.

const MODEL = 'claude-haiku-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'poNumber', 'expectedBy', 'currency', 'taxAmount', 'lines', 'notes'],
  properties: {
    supplier:   { type: 'string', description: 'The selling company (manufacturer / vendor), not the buyer: the exact name from the known suppliers list when it is the same company, otherwise as written. "" if not shown.' },
    poNumber:   { type: 'string', description: 'The PO / order / PI / invoice number. "" if not shown.' },
    expectedBy: { type: 'string', description: 'Delivery / ship-by / ETA date as YYYY-MM-DD, "" if not shown.' },
    currency:   { type: 'string', description: 'ISO currency code of the prices, e.g. USD. "" if not shown.' },
    taxAmount:  { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Total tax / VAT / GST charged, null if none shown.' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'matchedProduct', 'qty', 'unitCost', 'serials'],
        properties: {
          description:    { type: 'string', description: 'The line item as written on the document (model + description).' },
          matchedProduct: { type: 'string', description: 'Exact name from the catalog this line is, or "" if none fits.' },
          qty:            { type: 'integer', description: 'Units ordered on this line.' },
          unitCost:       { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Price per unit before tax, null if not shown.' },
          serials:        { type: 'array', items: { type: 'string' }, description: 'Serial numbers listed for this line, copied exactly. [] if none.' },
        },
      },
    },
    notes: { type: 'string', description: 'Anything the person entering the order should double-check, in one or two short sentences. "" if nothing.' },
  },
};

const SYSTEM = `You read hardware purchase documents (purchase orders, pro-forma invoices, commercial invoices, packing lists) for a company that buys POS terminals, printers, KDS screens, kiosks and networking gear, and you pull out the order details.

Rules:
- One line per product the buyer is paying for. Skip shipping, freight, bank fees, discounts and subtotal rows; never include them as products.
- Accessories, cables or power supplies that are their own priced line are their own line.
- matchedProduct must be copied exactly from the catalog the user gives you, or "" when no catalog entry is clearly the same item. Match on model, not on loose similarity: a "D3 Pro" is not a "D3 Mini", and a "80mm printer" is not a "58mm printer". If unsure, use "".
- Serial numbers (SN, S/N, IMEI, MAC) must be copied character for character from the document. Never invent, complete or guess a serial. If the document has no serials, return [] for every line. When serials are listed in a block that isn't next to a line, assign them to the line whose model they are listed under; if you can't tell, put them on no line and say so in notes.
- Use the unit price before tax. If only a line total is shown, divide it by the quantity.
- Dates must be YYYY-MM-DD. Leave a field "" (or null) when the document doesn't show it; don't infer it.`;

const ALLOWED_MEDIA = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// input: { fileName, mediaType, data (base64) } or { fileName, text }
function buildContent(input, products, suppliers) {
  const parts = [];
  if (input.text) {
    parts.push({ type: 'text', text: `Contents of ${input.fileName || 'the spreadsheet'}, converted to CSV (one block per sheet):\n\n${input.text}` });
  } else if (input.mediaType === 'application/pdf') {
    parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.data } });
  } else {
    parts.push({ type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.data } });
  }
  const list = a => a.map(n => `- ${n}`).join('\n') || '(none)';
  parts.push({ type: 'text', text: `Catalog (use these exact names for matchedProduct):\n${list(products)}\n\nKnown suppliers:\n${list(suppliers)}\n\nExtract the order from this document.` });
  return parts;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);

// Clean the model's answer: catalog names must be real, serials upper-cased and
// unique across the whole order, quantities whole numbers. Adds warnings for
// anything the person should look at before placing the order.
function normalize(raw, products) {
  const names = new Set(products);
  const seen = new Set();
  const warnings = [];
  const lines = (raw.lines || []).map(l => {
    const serials = [];
    (l.serials || []).forEach(s => {
      const v = String(s || '').trim().toUpperCase();
      if (!v) return;
      if (seen.has(v)) { warnings.push(`Serial ${v} appears more than once — kept the first.`); return; }
      seen.add(v); serials.push(v);
    });
    const qty = Number.isInteger(l.qty) && l.qty > 0 ? l.qty : serials.length;
    const description = String(l.description || '').trim();
    const matchedProduct = names.has(l.matchedProduct) ? l.matchedProduct : '';
    if (serials.length && serials.length !== qty) {
      warnings.push(`${matchedProduct || description}: ${qty} ordered but ${serials.length} serial${serials.length === 1 ? '' : 's'} found.`);
    }
    return { description, matchedProduct, qty, unitCost: num(l.unitCost), serials };
  }).filter(l => l.qty > 0);
  if (raw.notes) warnings.push(String(raw.notes).trim());
  return {
    supplier: String(raw.supplier || '').trim(),
    poNumber: String(raw.poNumber || '').trim(),
    expectedBy: DAY.test(raw.expectedBy) ? raw.expectedBy : '',
    currency: String(raw.currency || '').trim().toUpperCase(),
    taxAmount: num(raw.taxAmount),
    lines,
    warnings,
  };
}

// Throws an Error with .expose (and .status) set for anything to show the person as-is.
async function extractPurchaseOrder(client, input, { products = [], suppliers = [] } = {}) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status, expose: true });
  if (!input || (!input.text && !input.data)) throw fail(400, 'No file content was sent.');
  if (!input.text && !ALLOWED_MEDIA.includes(input.mediaType)) throw fail(400, 'Upload a PDF, an image, or an Excel/CSV file.');

  const msg = await client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildContent(input, products, suppliers) }],
  }).finalMessage();

  if (msg.stop_reason === 'refusal') throw fail(422, 'The document could not be read.');
  if (msg.stop_reason === 'max_tokens') throw fail(422, 'The document is too long to read in one go — split it and import each part.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let raw;
  try { raw = JSON.parse(text); } catch { throw fail(502, 'Could not understand the reply from the reader.'); }
  return normalize(raw, products);
}

module.exports = { extractPurchaseOrder, normalize, MODEL, ALLOWED_MEDIA };
