/**
 * hubspotCompanies.js — company lookup behind the in-app HubSpot picker.
 *
 * The browser holds no HubSpot credentials (the token is a Secret Manager
 * param), and the portal has >23k companies, so the mapping UI can't hold a
 * plain dropdown — it searches through here as the user types.
 */

const SEARCH_PROPS = ['name', 'city', 'state', 'domain', 'tenant_id'];

// Free-text search across HubSpot's default searchable company properties
// (name, website, domain, phone). Results come back relevance-ordered, so no
// explicit sort — sorting by name would bury the best match.
async function searchHubspotCompanies(token, query, limit = 20) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, properties: SEARCH_PROPS }),
  });
  if (!res.ok) {
    throw new Error(`HubSpot company search failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return (body.results || []).map(r => ({
    id: String(r.id),
    name: r.properties?.name || '(unnamed)',
    city: r.properties?.city || '',
    state: r.properties?.state || '',
    domain: r.properties?.domain || '',
    tenantId: r.properties?.tenant_id || '',
  }));
}

module.exports = { searchHubspotCompanies };
