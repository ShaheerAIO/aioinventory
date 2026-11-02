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
                   name: d.name || '', model: d.model || '', shortname: d.shortname || '', status: d.status || '' });
      }
    }
    next = json.nextToken || '';
    if (!next) break;
  }
  return out;
}

// Cellular gear (LTE Pro and the like). The device list carries no SIM details,
// so each console that has one is read through the Site Manager connector, which
// proxies to that console's Network application. Only hosts with cellular gear
// are read, a few at a time; a console that can't be reached is reported, not fatal.
const CELLULAR_MODEL = /LTE|5G|UMR/i;
const CONSOLE_CONCURRENCY = 6;

async function listUnifiSites(apiKey, fetchImpl) {
  const res = await fetchImpl(`${BASE}/v1/sites?pageSize=500`, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`UniFi sites request failed (${res.status})`);
  const json = await res.json();
  const byHost = {};
  for (const s of json.data || []) (byHost[s.hostId] = byHost[s.hostId] || []).push(s.meta?.name || 'default');
  return byHost;
}

function cellularRow(host, d) {
  return {
    site: host.site, hostId: host.hostId,
    mac: String(d.mac || '').replace(/:/g, '').toUpperCase(),
    name: d.name || '', model: d.model || '', online: d.state === 1,
    imei: d.lte_imei || '', iccid: d.lte_iccid || '', carrier: d.lte_networkoperator || '',
    simState: d.lte_state || '', connected: d.lte_connected === 'yes',
    signal: d.lte_signal || '', rsrp: d.lte_rsrp || '', rat: d.lte_rat || d.lte_mode || '',
    roaming: d.lte_radio === 'roam', apn: d.lte_apn || '', authType: d.lte_auth_type || '', ip: d.lte_ip || '',
    failoverMode: d.lte_failover_mode || '', onLte: d.lte_failover === true,
  };
}

async function listCellular(apiKey, fetchImpl = fetch) {
  const devices = await listUnifiDevices(apiKey, fetchImpl);
  const hosts = new Map();
  for (const d of devices) {
    if (CELLULAR_MODEL.test(`${d.model} ${d.shortname}`) && !hosts.has(d.hostId)) hosts.set(d.hostId, { hostId: d.hostId, site: d.site });
  }
  const sites = await listUnifiSites(apiKey, fetchImpl);
  const queue = [...hosts.values()];
  const rows = [], failed = [];
  const worker = async () => {
    while (queue.length) {
      const host = queue.shift();
      try {
        for (const site of sites[host.hostId] || ['default']) {
          const url = `${BASE}/v1/connector/consoles/${encodeURIComponent(host.hostId)}/proxy/network/api/s/${encodeURIComponent(site)}/stat/device`;
          const res = await fetchImpl(url, { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } });
          if (!res.ok) throw new Error(`console request failed (${res.status})`);
          const json = await res.json();
          for (const d of json.data || []) if (d.lte_imei || d.lte_iccid) rows.push(cellularRow(host, d));
        }
      } catch (e) {
        failed.push({ site: host.site, error: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: CONSOLE_CONCURRENCY }, worker));
  return { devices: rows, failed };
}

module.exports = { listUnifiDevices, listCellular };
