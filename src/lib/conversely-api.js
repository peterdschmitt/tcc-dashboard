// CONVERSELY.AI External API client.
// When CONVERSELY_API_BASE_URL and CONVERSELY_API_KEY are both set, the
// ai-analyst route reads agent results from this API instead of Google Drive.

const CATEGORY_TO_AGENT_ID = {
  funnel_health: 6,
  volume_capacity: 5,
  profitability: 4,
  sales_execution: 12,
  mix_product: 13,
  lead_quality: 27,
  funnel_analyzer: 25,
};

// Per-agent deep-dive analyst (entity-batch). Returns one analysis per call-center agent.
export const AGENT_DEEP_DIVE_ID = 41;
export const AGENT_DEEP_DIVE_CATEGORY = 'agent_deep_dive';

const AGENT_ID_TO_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TO_AGENT_ID).map(([cat, id]) => [id, cat])
);

const CATEGORY_LABELS = {
  funnel_analyzer: 'Funnel Analyzer',
  lead_quality: 'Lead Quality',
  volume_capacity: 'Volume & Capacity',
  sales_execution: 'Sales Execution',
  profitability: 'Profitability',
  funnel_health: 'Funnel Health',
  mix_product: 'Mix & Product',
  agent_deep_dive: 'Agent Deep Dive',
};

export function isConverselyEnabled() {
  return Boolean(process.env.CONVERSELY_API_BASE_URL && process.env.CONVERSELY_API_KEY);
}

export function getCategoryToAgentId() {
  return { ...CATEGORY_TO_AGENT_ID };
}

function baseUrl() {
  return (process.env.CONVERSELY_API_BASE_URL || '').replace(/\/+$/, '');
}

function authHeaders() {
  return { 'X-API-Key': process.env.CONVERSELY_API_KEY || '' };
}

async function callApi(path, params) {
  const url = new URL(`${baseUrl()}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Conversely API ${res.status} ${path}: ${text || res.statusText}`);
  }
  return res.json();
}

// Convert one API result into the Drive-shaped report object the rest of the
// ai-analyst route expects: { id, title, type, modifiedTime, content }.
function toReport(category, agentId, apiResult) {
  if (!apiResult) return null;
  const label = CATEGORY_LABELS[category] || category;
  const dateLabel = apiResult.run_date || (apiResult.created_at || '').split('T')[0] || '';
  return {
    id: `cvai-${agentId}`,
    title: dateLabel ? `${label} — ${dateLabel}` : label,
    type: category,
    modifiedTime: apiResult.created_at || apiResult.run_date || null,
    content: apiResult.result_message || '',
    // Extra fields downstream code may want
    runDate: apiResult.run_date || null,
    dataStartDate: apiResult.data_start_date || null,
    dataEndDate: apiResult.data_end_date || null,
    entityName: apiResult.entity_name || null,
    agentId,
  };
}

export async function fetchLatestResultForAgent(agentId, opts = {}) {
  const data = await callApi(`/api/external/agents/${agentId}/results/latest`, {
    entity_name: opts.entityName,
    start_date: opts.startDate,
    end_date: opts.endDate,
  });
  return data?.result || null;
}

// Fetch the latest result for every mapped agent in parallel and return the
// Drive-shaped report list (skipping agents that returned no result).
export async function fetchAllLatestReports(opts = {}) {
  const entries = Object.entries(CATEGORY_TO_AGENT_ID);
  const settled = await Promise.allSettled(
    entries.map(async ([category, agentId]) => {
      const result = await fetchLatestResultForAgent(agentId, opts);
      return toReport(category, agentId, result);
    })
  );
  const reports = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const [category, agentId] = entries[i];
    if (s.status === 'fulfilled' && s.value) {
      reports.push(s.value);
    } else if (s.status === 'rejected') {
      console.warn(`[conversely] ${category} (agent ${agentId}) failed:`, s.reason?.message || s.reason);
    }
  }
  // Newest first to match Drive behavior
  reports.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
  return reports;
}

// Fetch the latest-by-entity bundle for an entity-batch agent. Returns
// { runDate, dataStartDate, dataEndDate, entityLabel, entities: [{ entityName, resultMessage, createdAt }] }
// or null if no completed run exists.
export async function fetchLatestByEntity(agentId, opts = {}) {
  const data = await callApi(`/api/external/agents/${agentId}/results/latest-by-entity`, {
    run_date: opts.runDate,
  });
  if (!data || !data.success) return null;
  return {
    agent: data.agent || null,
    runDate: data.run_date || null,
    dataStartDate: data.data_start_date || null,
    dataEndDate: data.data_end_date || null,
    entityLabel: data.agent?.entity_label || null,
    entityCount: data.entity_count || 0,
    entities: (data.entities || []).map(e => ({
      entityName: e.entity_name || null,
      resultMessage: e.result_message || '',
      resultData: e.result_data || null,
      executionTimeSeconds: e.execution_time_seconds ?? null,
      createdAt: e.created_at || null,
    })),
  };
}

// Fetch the Agent Deep Dive bundle. Thin wrapper over fetchLatestByEntity for
// the well-known agent ID 41. Returns null on any error so callers can degrade gracefully.
export async function fetchAgentDeepDive(opts = {}) {
  if (!isConverselyEnabled()) return null;
  try {
    return await fetchLatestByEntity(AGENT_DEEP_DIVE_ID, opts);
  } catch (err) {
    console.warn('[conversely] fetchAgentDeepDive failed:', err.message);
    return null;
  }
}

// Fetch the list of entity names an agent knows about (its saved entity_query
// universe). Returns [] on error.
export async function fetchAgentEntities(agentId) {
  if (!isConverselyEnabled()) return [];
  try {
    const data = await callApi(`/api/external/agents/${agentId}/entities`);
    return Array.isArray(data?.entities) ? data.entities : [];
  } catch (err) {
    console.warn(`[conversely] fetchAgentEntities(${agentId}) failed:`, err.message);
    return [];
  }
}

// Combined fetch: returns the latest-by-entity bundle plus the entity universe,
// so callers can render placeholder cards for agents that haven't been analyzed yet.
export async function fetchAgentDeepDiveWithUniverse(opts = {}) {
  if (!isConverselyEnabled()) return null;
  const [bundle, universe] = await Promise.all([
    fetchAgentDeepDive(opts),
    fetchAgentEntities(AGENT_DEEP_DIVE_ID),
  ]);
  if (!bundle && (!universe || !universe.length)) return null;
  const analyzed = new Set((bundle?.entities || []).map(e => e.entityName).filter(Boolean));
  const pending = universe.filter(name => !analyzed.has(name));
  return {
    ...(bundle || { entities: [], runDate: null }),
    universe,
    pending,
  };
}

// Fetch a single report by the synthetic ID we hand to the client.
// Shapes:
//   cvai-<agentId>                      -> aggregate (non-entity) report
//   cvai-<agentId>:<entityName>         -> one entity's result from a latest-by-entity bundle
// Returns null when the ID isn't a Conversely ID so the caller can fall back to Drive.
export async function fetchSingleReportById(id) {
  if (!id || !id.startsWith('cvai-')) return null;
  const rest = id.slice('cvai-'.length);
  const colonIdx = rest.indexOf(':');

  // Entity-specific ID: cvai-<agentId>:<entityName>
  if (colonIdx > -1) {
    const agentId = parseInt(rest.slice(0, colonIdx), 10);
    const entityName = rest.slice(colonIdx + 1);
    if (!agentId || !entityName) return null;
    const bundle = await fetchLatestByEntity(agentId);
    if (!bundle) return null;
    const match = bundle.entities.find(e => e.entityName === entityName);
    if (!match) return null;
    const label = CATEGORY_LABELS[AGENT_DEEP_DIVE_CATEGORY] || 'Agent Deep Dive';
    return {
      id,
      title: `${label} — ${entityName} — ${bundle.runDate || ''}`,
      type: AGENT_DEEP_DIVE_CATEGORY,
      modifiedTime: match.createdAt || bundle.runDate || null,
      content: match.resultMessage || '',
      runDate: bundle.runDate,
      dataStartDate: bundle.dataStartDate,
      dataEndDate: bundle.dataEndDate,
      entityName,
      agentId,
    };
  }

  // Aggregate ID: cvai-<agentId>
  const agentId = parseInt(rest, 10);
  if (!agentId) return null;

  // Deep-dive agent: concatenate all entities into a single report so the
  // existing single-report viewer + TOC renders them naturally.
  if (agentId === AGENT_DEEP_DIVE_ID) {
    const bundle = await fetchLatestByEntity(agentId);
    if (!bundle || !bundle.entities.length) return null;
    const label = CATEGORY_LABELS[AGENT_DEEP_DIVE_CATEGORY] || 'Agent Deep Dive';
    const content = bundle.entities
      .map(e => `# ${e.entityName || 'Unknown Agent'}\n\n${e.resultMessage || ''}`)
      .join('\n\n---\n\n');
    return {
      id,
      title: bundle.runDate ? `${label} — ${bundle.runDate}` : label,
      type: AGENT_DEEP_DIVE_CATEGORY,
      modifiedTime: bundle.runDate || null,
      content,
      runDate: bundle.runDate,
      dataStartDate: bundle.dataStartDate,
      dataEndDate: bundle.dataEndDate,
      entityName: null,
      agentId,
    };
  }

  if (!AGENT_ID_TO_CATEGORY[agentId]) return null;
  const result = await fetchLatestResultForAgent(agentId);
  return toReport(AGENT_ID_TO_CATEGORY[agentId], agentId, result);
}
