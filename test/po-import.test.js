// PO import: functions/poImport.js against a fake Anthropic client — the request it
// builds for each kind of file, and how it cleans up what comes back.
//
//   Run: node test/po-import.test.js
const root = require('path').resolve(__dirname, '..');
const { extractPurchaseOrder, normalize } = require(root + '/functions/poImport.js');

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

const PRODUCTS = ['Sunmi D3 Pro Data Processing Machine', 'Sunmi D2s KDS', 'Sunmi 80mm Kitchen Cloud Printer'];
const SUPPLIERS = ['Sunmi', 'Teltonika Networks'];

function fakeClient(reply, stop_reason = 'end_turn') {
  const calls = [];
  return {
    calls,
    messages: { stream: params => {
      calls.push(params);
      return { finalMessage: async () => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(reply) }] }) };
    } },
  };
}

const reply = {
  supplier: 'Sunmi', poNumber: 'PI-2026-118', expectedBy: '2026-12-01', currency: 'usd', taxAmount: null,
  lines: [
    { description: 'D3 PRO 15.6"', matchedProduct: 'Sunmi D3 Pro Data Processing Machine', qty: 2, unitCost: 410, serials: ['p2120a1', ' P2120A2 '] },
    { description: 'D2s 15.6 KDS', matchedProduct: 'Sunmi D2s Kds', qty: 3, unitCost: 300, serials: ['K1', 'P2120A2'] },
    { description: 'NT311 printer', matchedProduct: 'Sunmi 80mm Kitchen Cloud Printer', qty: 0, unitCost: -5, serials: ['N1'] },
  ],
  notes: 'Freight not included.',
};

(async () => {
  console.log('normalize');
  {
    const r = normalize(reply, PRODUCTS);
    eq('serials upper-cased and trimmed', r.lines[0].serials, ['P2120A1', 'P2120A2']);
    eq('a catalog name that isn\'t exact is dropped', r.lines[1].matchedProduct, '');
    eq('a serial repeated on another line is kept once', r.lines[1].serials, ['K1']);
    eq('missing qty falls back to the serial count', r.lines[2].qty, 1);
    eq('a negative cost becomes null', r.lines[2].unitCost, null);
    eq('currency upper-cased', r.currency, 'USD');
    eq('warnings: duplicate, count mismatch, notes', r.warnings, [
      'Serial P2120A2 appears more than once — kept the first.',
      'D2s 15.6 KDS: 3 ordered but 1 serial found.',
      'Freight not included.',
    ]);
    eq('a bad date is cleared', normalize({ ...reply, expectedBy: 'next week' }, PRODUCTS).expectedBy, '');
    eq('lines with no qty and no serials are dropped', normalize({ lines: [{ description: 'Freight', matchedProduct: '', qty: 0, unitCost: 50, serials: [] }] }, PRODUCTS).lines, []);
  }

  console.log('PDF request');
  {
    const c = fakeClient(reply);
    const r = await extractPurchaseOrder(c, { fileName: 'po.pdf', mediaType: 'application/pdf', data: 'QUJD' }, { products: PRODUCTS, suppliers: SUPPLIERS });
    const p = c.calls[0];
    eq('model', p.model, 'claude-haiku-5-5');
    eq('JSON schema output', p.output_config.format.type, 'json_schema');
    eq('PDF sent as a document block', p.messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } });
    const prompt = p.messages[0].content[1].text;
    eq('catalog and suppliers in the prompt', [prompt.includes('- Sunmi D2s KDS'), prompt.includes('- Teltonika Networks')], [true, true]);
    eq('result is normalized', r.lines.length, 3);
  }

  console.log('spreadsheet and image requests');
  {
    const c = fakeClient(reply);
    await extractPurchaseOrder(c, { fileName: 'po.xlsx', text: 'Model,Qty\nD3 Pro,2' }, { products: PRODUCTS });
    eq('spreadsheet sent as text', c.calls[0].messages[0].content[0].type, 'text');
    await extractPurchaseOrder(c, { fileName: 'po.png', mediaType: 'image/png', data: 'QUJD' }, { products: PRODUCTS });
    eq('image sent as an image block', c.calls[1].messages[0].content[0].type, 'image');
  }

  console.log('errors');
  {
    const err = async (fn) => { try { await fn(); return null; } catch (e) { return [e.status, !!e.expose]; } };
    eq('unsupported file type', await err(() => extractPurchaseOrder(fakeClient(reply), { mediaType: 'application/zip', data: 'x' })), [400, true]);
    eq('empty upload', await err(() => extractPurchaseOrder(fakeClient(reply), {})), [400, true]);
    eq('refusal', await err(() => extractPurchaseOrder(fakeClient(reply, 'refusal'), { text: 'x' })), [422, true]);
    eq('too long', await err(() => extractPurchaseOrder(fakeClient(reply, 'max_tokens'), { text: 'x' })), [422, true]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
