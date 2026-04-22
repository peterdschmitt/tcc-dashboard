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

// Fetch a single report by the synthetic ID we hand to the client (cvai-<agentId>).
// Returns null when the ID isn't a Conversely ID so the caller can fall back to Drive.
export async function fetchSingleReportById(id) {
  if (!id || !id.startsWith('cvai-')) return null;
  const agentId = parseInt(id.slice('cvai-'.length), 10);
  if (!agentId || !AGENT_ID_TO_CATEGORY[agentId]) return null;
  const result = await fetchLatestResultForAgent(agentId);
  return toReport(AGENT_ID_TO_CATEGORY[agentId], agentId, result);
}
