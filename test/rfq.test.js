// RFQ workflow rules (js/rfq.js, a browser IIFE evaluated here with stand-in
// globals): forecast → request lines, RFQ numbering, the first draft, who may
// approve/issue, and the issue checks.
//
//   Run: node test/rfq.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

const ctx = { console, DB: {}, Auth: {}, UI: {}, Inventory: {}, document: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(root + '/js/rfq.js', 'utf8') + '\nthis.RFQ = RFQ;', ctx);
const R = ctx.RFQ;

console.log('requestLinesFromForecast');
eq('only products with something Needed, qty defaults to Needed',
  R.requestLinesFromForecast([{ product: 'D3 Pro', needed: 12, zone: 'red' }, { product: 'KDS', needed: 0, zone: 'ok' }, { product: 'Printer', needed: 3 }]),
  [{ product: 'D3 Pro', qty: 12, needed: 12, zone: 'red' }, { product: 'Printer', qty: 3, needed: 3, zone: '' }]);

console.log('nextNumber');
eq('first RFQ', R.nextNumber([]), 'RFQ-AIO-001');
eq('after the highest issued, ignoring unissued and gaps',
  R.nextNumber([{ number: 'RFQ-AIO-002' }, { number: 'RFQ-AIO-009' }, {}, { number: 'PO-AIO-0070' }]), 'RFQ-AIO-010');

console.log('draftFromRequest');
const suppliers = [{ name: 'Sunmi', paymentTerms: '30% deposit', currency: 'cny' }, { name: 'Teltonika', paymentTerms: 'Net 30', currency: 'EUR' }];
const products = [{ name: 'D3 Pro', supplier: 'Sunmi' }, { name: 'KDS', supplier: 'sunmi' }, { name: 'Router', supplier: 'Teltonika' }];
{
  const d = R.draftFromRequest({ lines: [{ product: 'D3 Pro', qty: 5 }, { product: 'KDS', qty: 2 }] }, suppliers, products, '2026-11-18');
  eq('shared supplier picked (case-insensitive)', d.supplier, 'Sunmi');
  eq('terms and currency from the supplier record', [d.payment, d.currency], ['30% deposit', 'RMB']);
  eq('quote due 14 days out', [d.docDate, d.dueDate], ['2026-11-18', '2026-12-02']);
  eq('lines carried over', d.lines, [{ product: 'D3 Pro', desc: '', qty: 5 }, { product: 'KDS', desc: '', qty: 2 }]);
}
{
  const d = R.draftFromRequest({ lines: [{ product: 'D3 Pro', qty: 5 }, { product: 'Router', qty: 1 }] }, suppliers, products, '2026-11-18');
  eq('mixed suppliers leave the vendor blank', [d.supplier, d.payment, d.currency], ['', '', 'USD']);
}
eq('a non-RMB currency becomes USD', R.draftFromRequest({ lines: [{ product: 'Router', qty: 1 }] }, suppliers, products, '2026-11-18').currency, 'USD');

console.log('canTransition');
eq('admins approve and reject', ['superadmin', 'admin', 'edit', 'view'].map(r => R.canTransition('pending', 'approve', r)), [true, true, false, false]);
eq('editors issue approved requests', ['superadmin', 'admin', 'edit', 'view'].map(r => R.canTransition('approved', 'issue', r)), [true, true, true, false]);
eq('pending cannot be issued, issued is final', [R.canTransition('pending', 'issue', 'admin'), R.canTransition('issued', 'issue', 'admin'), R.canTransition('rejected', 'approve', 'admin')], [false, false, false]);

console.log('issueWarnings');
eq('a complete draft passes', R.issueWarnings({ supplier: 'Sunmi', docDate: '2026-11-18', dueDate: '2026-12-02', lines: [{ product: 'D3 Pro', qty: 5 }] }), []);
eq('every problem listed', R.issueWarnings({ supplier: '', docDate: '2026-11-18', dueDate: '2026-11-01', lines: [{ product: 'D3 Pro', qty: 0 }, { product: '', qty: 3 }] }), [
  'No vendor is selected.', 'A line has a quantity of 0.', 'The quote due date is before the document date.']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
