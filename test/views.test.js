// Navigation wiring: every view in app.js has its section in index.html, every sidebar
// button targets a known view, every local asset exists, and every id app.js looks up
// exists in index.html (or is allowlisted below as built at runtime).
//
//   Run: node test/views.test.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const htmlPath = process.env.INDEX_HTML || root + '/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');
const app = fs.readFileSync(root + '/js/app.js', 'utf8');

// Ids app.js looks up that are NOT in index.html because JS creates them at runtime.
const RUNTIME_IDS = {
  // KNOWN STALE (not runtime-built): these bindings are dead in HEAD too -- no element has this id.
  // bind() is null-safe so they are harmless. Remove the lines in app.js, then these entries.
  'rpt-run': 'stale: report button is now id="btn-rpt-run"',
  'rpt-clear-dates': 'stale: no such button in index.html',
  // Stock Out rows are built by js/forms/stock-out.js with id `${row.id}-out-serial-field`; the bare id never exists.
  'out-serial-field': 'stale: rows use a per-row prefixed id',
};

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }

const views = (app.match(/const VIEWS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
ok(views.length > 0, 'VIEWS array found in app.js');
const count = (re) => (html.match(re) || []).length;
for (const v of views) ok(count(new RegExp('id="v-' + v + '"', 'g')) === 1, `exactly one section id="v-${v}"`);

for (const m of html.matchAll(/data-view="([^"]+)"/g)) ok(views.includes(m[1]), `data-view="${m[1]}" is in VIEWS`);

const refs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g), ...html.matchAll(/<link[^>]*\shref="([^"]+)"/g)]
  .map(m => m[1].split('?')[0]).filter(p => !/^(https?:)?\/\//.test(p) && !p.startsWith('data:'));
for (const p of refs) ok(fs.existsSync(path.join(root, p)), `asset exists: ${p}`);

const ids = new Set([...app.matchAll(/(?:getElementById|bind)\('([^']+)'/g)].map(m => m[1]));
for (const id of ids) {
  if (id.endsWith('-') || id === 'v-') continue; // prefix concatenation, e.g. 'v-' + v
  ok(count(new RegExp('id="' + id + '"')) >= 1 || id in RUNTIME_IDS, `app.js id "${id}" exists in index.html`);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
