// Grants an AIO Buddy account access to more restaurants. The dashboard's buddy
// update REPLACES the account's whole record (every business, location and module),
// so a grant is: read the record, append the new locations, send all of it back, read
// it again and check nothing was lost. These are the pure steps; the aioBuddyAccess
// function in index.js does the calls. Takes the client as a parameter, like
// inventoryStats.js takes db, so it is unit-testable without Firebase.

const grantedIds = item =>
  new Set((item.userBusinessData || []).flatMap(b => (b.location || []).filter(l => l.value).map(l => l.id)));

const moduleKeys = item => new Set((item.userPermission || []).map(p => `${p.appId}:${p.id}`));

const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const sameAccess = (a, b) => sameSet(grantedIds(a), grantedIds(b)) && sameSet(moduleKeys(a), moduleKeys(b));

// The body the dashboard's own edit form sends, built from the record as read. The record lists
// EVERY location with a ticked/unticked flag, but the backend links every location it is sent
// whatever the flag says, so — as the form does — only ticked locations go back, a business with
// none is left out, and modules are deduped by id+app.
function toUpdateBody(item, businesses) {
  const b = item.aioBuddy;
  const ticked = businesses
    .map(biz => ({ ...biz, location: (biz.location || []).filter(l => l.value === true) }))
    .filter(biz => biz.location.length);
  const modules = new Map();
  for (const p of item.userPermission || []) if (!modules.has(`${p.id}-${p.appId}`)) modules.set(`${p.id}-${p.appId}`, { ...p, value: true });
  return {
    aioBuddy: { id: b.id, firstName: b.firstName, lastName: b.lastName, email: b.email, contactNo: b.contactNo },
    modulePermission: [...modules.values()],
    selectedBusinessPermissions: ticked,
    restaurantId: 0,
  };
}

// The record's businesses with `add` appended. `add` is [{ restaurantId, businessId, name, businessName }].
// Returns { businesses, added } — locations already granted are left alone and not counted.
function withLocations(item, add) {
  const have = grantedIds(item);
  const businesses = (item.userBusinessData || []).map(b => ({ ...b, location: (b.location || []).map(l => ({ ...l })) }));
  const added = [];
  for (const loc of add) {
    if (have.has(loc.restaurantId)) continue;
    have.add(loc.restaurantId);
    const entry = { id: loc.restaurantId, label: loc.name, value: true };
    const biz = businesses.find(b => b.value === loc.businessId);
    const unticked = biz?.location.find(l => l.id === loc.restaurantId);   // listed but not ticked
    if (unticked) unticked.value = true;
    else if (biz) biz.location.push(entry);
    else businesses.push({ value: loc.businessId, label: loc.businessName, location: [entry] });
    added.push(loc.restaurantId);
  }
  return { businesses, added };
}

// After the update: every location and module she had is still there, and so is every one added.
// Returns a list of problems, empty when the record is as intended.
function checkGrant(before, after, added) {
  const problems = [];
  const have = grantedIds(after);
  const lostLoc = [...grantedIds(before)].filter(id => !have.has(id));
  const missing = added.filter(id => !have.has(id));
  const lostMod = [...moduleKeys(before)].filter(k => !moduleKeys(after).has(k));
  if (lostLoc.length) problems.push(`${lostLoc.length} existing location(s) were dropped`);
  if (missing.length) problems.push(`${missing.length} new location(s) did not apply`);
  if (lostMod.length) problems.push(`${lostMod.length} module permission(s) were dropped`);
  return problems;
}

// Adds `restaurantIds` to the buddy. If the re-read shows anything lost, the original
// record is written straight back. Returns { added, skipped, restored? }, or throws.
async function grantLocations(client, buddyId, restaurantIds, locations) {
  const byId = new Map(locations.map(l => [l.restaurantId, l]));
  const unknown = restaurantIds.filter(id => !byId.has(id));
  if (unknown.length) throw new Error(`Unknown restaurant id(s): ${unknown.join(', ')}`);

  const before = await client.getBuddy(buddyId);
  const { businesses, added } = withLocations(before, restaurantIds.map(id => byId.get(id)));
  if (!added.length) return { added: [], skipped: restaurantIds };

  // The dashboard's update is not one transaction (the tenant-side write can land before a later
  // step fails), so a refused update can still leave the account half-changed. After any failure,
  // read the account again and write the original back if it differs.
  let failure = null;
  try {
    const res = await client.updateBuddy(toUpdateBody(before, businesses));
    if (!res.ok) failure = new Error(res.message || 'The AIO dashboard refused the update');
  } catch (e) {
    failure = e;
  }
  const after = await client.getBuddy(buddyId).catch(() => null);
  if (failure && !after) throw new Error(`${failure.message}. Could not re-read the account to confirm it is unchanged — check it in the dashboard.`);
  const problems = failure ? [] : checkGrant(before, after, added);
  if (failure && !sameAccess(before, after)) problems.push('the account was partly changed');
  if (problems.length) {
    const back = await client.updateBuddy(toUpdateBody(before, before.userBusinessData || [])).catch(() => ({ ok: false }));
    throw new Error(`${[failure?.message, ...problems].filter(Boolean).join('; ')}. ${back.ok ? 'The original access was restored.' : 'RESTORE FAILED — check the account in the dashboard.'}`);
  }
  if (failure) throw failure;
  return { added, skipped: restaurantIds.filter(id => !added.includes(id)) };
}

// The browser names the buddy, so the id is checked against the dashboard's own buddy list:
// only an existing AIO Buddy account can be edited through this, never an arbitrary user id.
async function resolveBuddy(client, buddyId) {
  const buddy = (await client.listBuddies()).find(b => b.id === String(buddyId || ''));
  if (!buddy) throw new Error('That is not an AIO Buddy account');
  return buddy;
}

module.exports = { grantedIds, withLocations, toUpdateBody, checkGrant, grantLocations, resolveBuddy };
