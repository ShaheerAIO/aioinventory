// Read-only client for the UniFi Site Manager API (api.ui.com). One console per
// restaurant; each device's id is its MAC, which is also what inventory stores
// as the serial of Ubiquiti hardware. Used by aioDevices (action=unifi).

const BASE = 'https://api.ui.com';

async function listUnifiDevices(apiKey, fetchImpl = fetch) {
  const out = [];
  let next = '';
  // Paginated by nextToken; the cap only guards against a token that never ends
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ pageSize: '500', ...(next ? { nextToken: next } : {}) });
    const res = await fetchImpl(`${BASE}/v1/devices?${qs}`, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`UniFi request failed (${res.status})`);
    const json = await res.json();
    for (const host of json.data || []) {
      for (const d of host.devices || []) {
        out.push({ site: host.hostName || '', hostId: host.hostId, mac: String(d.mac || d.id || '').toUpperCase(),
                   name: d.name || '', model: d.model || '', status: d.status || '' });
      }
    }
    next = json.nextToken || '';
    if (!next) break;
  }
  return out;
}

module.exports = { listUnifiDevices };
