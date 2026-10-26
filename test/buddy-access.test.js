// Buddy access picker: the add-only merge and the verify/restore in
// functions/buddyAccess.js, against a fake dashboard that keeps one buddy record.
//
//   Run: node test/buddy-access.test.js
const root = require('path').resolve(__dirname, '..');
const { withLocations, toUpdateBody, grantLocations, resolveBuddy } = require(root + '/functions/buddyAccess.js');

let pass = 0, fail = 0;
const eq = (name, a, b) => { const good = JSON.stringify(a) === JSON.stringify(b); good ? pass++ : fail++; console.log(`  ${good ? '✓' : '✗'} ${name}${good ? '' : ` (${JSON.stringify(a)} !== ${JSON.stringify(b)})`}`); };

// The record lists every location with a ticked flag; she only has the ticked ones.
const record = () => ({
  aioBuddy: { id: 'u1', firstName: 'Aby', lastName: 'T', email: 'a@x.com', contactNo: '+920000000000', status: 'Active', createdBy: 'z' },
  userBusinessData: [
    { value: 10, label: 'Biz Ten', location: [{ id: 100, label: 'Ten One', value: true }, { id: 102, label: 'Ten Three', value: false }] },
    { value: 20, label: 'Biz Twenty', location: [{ id: 200, label: 'Twenty One', value: true }] },
    { value: 40, label: 'Biz Forty', location: [{ id: 400, label: 'Forty One', value: false }] },
  ],
  userPermission: [{ appId: 4, appKey: 'web-dash', id: 29, label: 'Inventory', key: 'inventory' },
                   { appId: 1, appKey: 'mom', id: 1, label: 'My Restaurant', key: 'my-restaurant' }],
});
const sentIds = biz => biz.flatMap(b => b.location.filter(l => l.value).map(l => l.id));
const LOCS = [
  { restaurantId: 100, businessId: 10, name: 'Ten One', businessName: 'Biz Ten' },
  { restaurantId: 101, businessId: 10, name: 'Ten Two', businessName: 'Biz Ten' },
  { restaurantId: 300, businessId: 30, name: 'Thirty One', businessName: 'Biz Thirty' },
];

// A fake dashboard. `lossy` makes update drop the first existing location, like a bad round trip.
function fake({ lossy = false, refuse = false, partial = false, throws = false } = {}) {
  let rec = record(); const puts = [];
  return {
    puts, get rec() { return rec; },
    getBuddy: async () => JSON.parse(JSON.stringify(rec)),
    updateBuddy: async body => {
      puts.push(body);
      if (refuse) return { ok: false, message: 'Invalid or inactive restaurantId' };
      if (throws) throw new Error('The AIO dashboard rejected the update: FK_user_restaurants_restaurant');
      if (partial && puts.length === 1) {   // the tenant-side write lands, then a later step fails
        rec = { ...rec, userBusinessData: JSON.parse(JSON.stringify(body.selectedBusinessPermissions)) };
        throw new Error('The AIO dashboard rejected the update: FK_user_restaurants_restaurant');
      }
      const biz = JSON.parse(JSON.stringify(body.selectedBusinessPermissions));
      if (lossy && puts.length === 1) biz[0].location.shift();
      rec = { aioBuddy: rec.aioBuddy, userBusinessData: biz, userPermission: body.modulePermission.map(({ value, ...p }) => p) };
      return { ok: true, message: '' };
    },
  };
}

console.log('\nMerge');
let m = withLocations(record(), [LOCS[1]]);
eq('a new location in a business she has joins that business', sentIds(toUpdateBody(record(), m.businesses).selectedBusinessPermissions), [100, 101, 200]);
eq('it is counted as added', m.added, [101]);
m = withLocations(record(), [LOCS[2]]);
eq('a location in a new business adds the business', toUpdateBody(record(), m.businesses).selectedBusinessPermissions.map(b => b.value), [10, 20, 30]);
eq('...labelled with the business name', m.businesses.find(b => b.value === 30), { value: 30, label: 'Biz Thirty', location: [{ id: 300, label: 'Thirty One', value: true }] });
m = withLocations(record(), [LOCS[0], LOCS[0]]);
eq('a location she already has is not added twice', m.added, []);
const rec = record(); withLocations(rec, [LOCS[1]]);
eq('the record that was read is not mutated', rec, record());

console.log('\nUpdate body');
const sent = toUpdateBody(record(), record().userBusinessData).selectedBusinessPermissions;
eq('unticked locations are not sent back', sent.flatMap(b => b.location.map(l => l.id)), [100, 200]);
eq('a business with nothing ticked is left out', sent.map(b => b.value), [10, 20]);
eq('every location sent is ticked', sent.every(b => b.location.every(l => l.value === true)), true);
const dup = toUpdateBody({ ...record(), userPermission: [...record().userPermission, record().userPermission[0]] }, []).modulePermission;
eq('modules are deduped by id and app', dup.length, 2);
const flip = withLocations(record(), [{ restaurantId: 102, businessId: 10, name: 'Ten Three', businessName: 'Biz Ten' }]);
eq('a listed-but-unticked location is ticked, not duplicated', flip.businesses[0].location.filter(l => l.id === 102), [{ id: 102, label: 'Ten Three', value: true }]);
const body = toUpdateBody(record(), record().userBusinessData);
eq('only the fields the dashboard form sends for the buddy', Object.keys(body.aioBuddy), ['id', 'firstName', 'lastName', 'email', 'contactNo']);
eq('every existing module is sent back as granted', body.modulePermission.map(p => p.value), [true, true]);
eq('restaurantId is present (the DTO requires a number)', body.restaurantId, 0);

(async () => {
  console.log('\nGrant');
  let f = fake();
  let r = await grantLocations(f, 'u1', [101, 300], LOCS);
  eq('adds the new locations', r, { added: [101, 300], skipped: [] });
  eq('keeps everything she had', [100, 200].every(id => f.rec.userBusinessData.some(b => b.location.some(l => l.id === id))), true);
  eq('keeps her modules', f.rec.userPermission.length, 2);
  eq('one update call', f.puts.length, 1);

  f = fake();
  r = await grantLocations(f, 'u1', [100], LOCS);
  eq('nothing new → no update is sent', [r, f.puts.length], [{ added: [], skipped: [100] }, 0]);

  f = fake();
  await grantLocations(f, 'u1', [999], LOCS).catch(e => eq('an unknown restaurant id is rejected before any call', [e.message, f.puts.length], ['Unknown restaurant id(s): 999', 0]));

  f = fake({ lossy: true });
  await grantLocations(f, 'u1', [101], LOCS).then(() => eq('should have thrown', 1, 0), e => {
    eq('a lossy update is caught', /dropped/.test(e.message) && /restored/.test(e.message), true);
    eq('and the original is written back', sentIds(f.rec.userBusinessData), [100, 200]);
    eq('with exactly two updates (grant, then restore)', f.puts.length, 2);
  });

  f = fake({ refuse: true });
  await grantLocations(f, 'u1', [101], LOCS).then(() => eq('should have thrown', 1, 0), e => eq('a refused update surfaces the dashboard message', e.message, 'Invalid or inactive restaurantId'));

  console.log('\nA failed update');
  f = fake({ throws: true });
  await grantLocations(f, 'u1', [101], LOCS).then(() => eq('should have thrown', 1, 0), e => {
    eq('the dashboard\'s reason reaches the caller', /FK_user_restaurants_restaurant/.test(e.message), true);
    eq('an untouched account is not rewritten', f.puts.length, 1);
  });
  f = fake({ partial: true });
  await grantLocations(f, 'u1', [101], LOCS).then(() => eq('should have thrown', 1, 0), e => {
    eq('a partly changed account is detected and restored', /partly changed/.test(e.message) && /restored/.test(e.message), true);
    eq('the original access is back', sentIds(f.rec.userBusinessData), [100, 200]);
  });

  console.log('\nChoosing the buddy');
  const buddies = { listBuddies: async () => [{ id: 'u1', email: 'a@x.com', fullName: 'Aby T' }, { id: 'u2', email: 'b@x.com', fullName: 'Bo B' }] };
  eq('a buddy id from the dashboard list resolves', (await resolveBuddy(buddies, 'u2')).email, 'b@x.com');
  await resolveBuddy(buddies, 'someone-else').then(() => eq('should have thrown', 1, 0), e => eq('an id that is not a buddy is rejected', e.message, 'That is not an AIO Buddy account'));
  await resolveBuddy(buddies, undefined).then(() => eq('should have thrown', 1, 0), e => eq('a missing id is rejected', e.message, 'That is not an AIO Buddy account'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
