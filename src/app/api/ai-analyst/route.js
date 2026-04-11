import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { google } from 'googleapis';
import { fetchSheet, appendRow, getSheetsClient } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// --- Google Auth (Drive-only scope for report fetching) ---
function getGoogleAuth() {
  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
  ];

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes,
  });
}

// --- OpenAI client ---
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- In-memory report cache (15 min TTL) ---
let reportCache = { data: null, ts: 0 };
const CACHE_TTL = 15 * 60 * 1000;

// --- History config ---
const HISTORY_TAB = () => process.env.REPORT_HISTORY_TAB || 'Daily Metrics';
const AGENT_METRICS_TAB = () => process.env.AGENT_METRICS_TAB || 'Agent Metrics';
const VA_METRICS_TAB = () => process.env.VA_METRICS_TAB || 'VA Metrics';

const METRICS_HEADERS = [
  'Date', 'Total Calls', 'Billable Calls', 'Billable Rate',
  'Transfers', 'Transfer Rate', 'Apps Submitted', 'Policies Placed',
  'Close Rate', 'Placement Rate', 'CPA', 'RPC',
  'Total Premium', 'Gross Adv Revenue', 'Lead Spend', 'Net Revenue',
  'Avg Premium', 'Top Publisher', 'Top Agent', 'Worst CPA Publisher',
  'Report Types Available', 'Report Count', 'Generated At',
];

const AGENT_METRICS_HEADERS = [
  'Date', 'Agent', 'Apps Submitted', 'Policies Placed', 'Total Premium',
  'Avg Premium', 'Close Rate', 'Placement Rate', 'CPA',
  'Total Calls', 'Billable Calls', 'Commission', 'Notes', 'Generated At',
];

const VA_METRICS_HEADERS = [
  'Date', 'Total VA Calls', 'Transfers', 'Transfer Rate',
  'VA Sales', 'VA Conversion Rate', 'Billable Calls',
  'Intent Confirmation Rate', 'DOB Collection Rate',
  'Budget Qualification Rate', 'Transfer Confirmation Rate',
  'Top Campaign', 'Top Campaign Transfers', 'Top Campaign Transfer Rate',
  'By Campaign JSON', 'Generated At',
];

// Track whether we already archived today (per-process)
let archivedToday = null;

// --- Report type classification ---
function classifyReport(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('funnel analyzer')) return 'funnel_analyzer';
  if (t.includes('lead quality')) return 'lead_quality';
  if (t.includes('volume') && t.includes('capacity')) return 'volume_capacity';
  if (t.includes('sales execution') || t.includes('agent performance')) return 'sales_execution';
  if (t.includes('profitabil')) return 'profitability'; // handles typo "profitabiliy"
  if (t.includes('funnel health')) return 'funnel_health';
  if (t.includes('mix') && t.includes('product') || t.includes('carrier')) return 'mix_product';
  return 'other';
}

// --- Report type label mapping ---
const REPORT_TYPE_LABELS = {
  funnel_analyzer: 'Funnel Analyzer',
  lead_quality: 'Lead Quality',
  volume_capacity: 'Volume & Capacity',
  sales_execution: 'Sales Execution',
  profitability: 'Profitability',
  funnel_health: 'Funnel Health',
  mix_product: 'Mix & Product',
  other: 'Other',
};

// --- Category definitions with icons ---
const CATEGORIES = [
  { id: 'funnel_analyzer', label: 'Funnel Analyzer', icon: '🔍' },
  { id: 'lead_quality', label: 'Lead Quality', icon: '📊' },
  { id: 'volume_capacity', label: 'Volume & Capacity', icon: '📈' },
  { id: 'sales_execution', label: 'Sales Execution', icon: '🎯' },
  { id: 'profitability', label: 'Profitability', icon: '💰' },
  { id: 'funnel_health', label: 'Funnel Health', icon: '🏥' },
  { id: 'mix_product', label: 'Mix & Product', icon: '🧩' },
];

// --- Tab → relevant report types ---
const ALL_REPORT_TYPES = ['funnel_analyzer', 'lead_quality', 'volume_capacity', 'sales_execution', 'profitability', 'funnel_health', 'mix_product'];
const TAB_REPORTS = {
  daily: ALL_REPORT_TYPES,
  publishers: ALL_REPORT_TYPES,
  agents: ALL_REPORT_TYPES,
  carriers: ALL_REPORT_TYPES,
  pnl: ALL_REPORT_TYPES,
};

// --- Extract date from report title ---
function extractDateFromTitle(title) {
  if (!title) return null;

  const isoMatch = title.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const usMatch = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const longMatch = title.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (longMatch) {
    const monthNum = months[longMatch[1].toLowerCase()];
    if (monthNum) {
      return `${longMatch[3]}-${monthNum}-${longMatch[2].padStart(2, '0')}`;
    }
  }

  return null;
}

// --- Parse sections from report content ---
function parseSections(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const sections = [];
  let charIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      let sectionTitle = null;

      const mdMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (mdMatch) {
        sectionTitle = mdMatch[1].trim();
      }

      if (!sectionTitle) {
        const boldMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          sectionTitle = boldMatch[1].trim();
        }
      }

      if (!sectionTitle) {
        const numMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
        if (numMatch && trimmed.length < 80) {
          sectionTitle = numMatch[1].trim();
        }
      }

      if (!sectionTitle && trimmed.length >= 3 && trimmed.length < 80) {
        const stripped = trimmed.replace(/[^a-zA-Z\s]/g, '').trim();
        if (stripped.length >= 3 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
          sectionTitle = trimmed;
        }
      }

      if (!sectionTitle && trimmed.length < 80 && trimmed.length >= 3) {
        if (trimmed.endsWith(':') && !trimmed.includes(',')) {
          sectionTitle = trimmed.replace(/:$/, '').trim();
        }
      }

      if (sectionTitle) {
        sectionTitle = sectionTitle.replace(/[#*_]/g, '').trim();
        if (sectionTitle.length > 0) {
          sections.push({
            id: `section-${sections.length}`,
            title: sectionTitle,
            startIndex: charIndex,
          });
        }
      }
    }

    charIndex += line.length + 1;
  }

  return sections;
}

// ─── HISTORICAL METRICS ──────────────────────────────────────────

/** Ensure all history tabs exist */
async function ensureHistoryTabs() {
  await Promise.all([
    ensureTab(HISTORY_TAB(), METRICS_HEADERS),
    ensureTab(AGENT_METRICS_TAB(), AGENT_METRICS_HEADERS),
    ensureTab(VA_METRICS_TAB(), VA_METRICS_HEADERS),
  ]);
}

/** Extract structured metrics from reports using GPT-4o */
async function extractMetrics(reports) {
  const reportContent = reports
    .map((r) => `--- ${r.title} ---\n${r.content}`)
    .join('\n\n');

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a data extraction assistant for TrueChoice Coverage (TCC), a final expense insurance call center.
Extract key metrics from the provided daily operational reports. Return ONLY a valid JSON object with these exact keys (use null if a metric is not found in the reports):

{
  "total_calls": <number>,
  "billable_calls": <number>,
  "billable_rate": <number, percentage>,
  "transfers": <number>,
  "transfer_rate": <number, percentage>,
  "apps_submitted": <number>,
  "policies_placed": <number>,
  "close_rate": <number, percentage>,
  "placement_rate": <number, percentage>,
  "cpa": <number, dollars>,
  "rpc": <number, dollars>,
  "total_premium": <number, dollars>,
  "gross_adv_revenue": <number, dollars>,
  "lead_spend": <number, dollars>,
  "net_revenue": <number, dollars>,
  "avg_premium": <number, dollars>,
  "top_publisher": "<string, name of best performing publisher by volume or revenue>",
  "top_agent": "<string, name of best performing agent by premium or close rate>",
  "worst_cpa_publisher": "<string, publisher with highest CPA>"
}

Rules:
- Extract numbers as plain numbers (no $ or % signs)
- For rates/percentages, use the number (e.g., 65 not 0.65)
- Look across ALL reports provided to find each metric
- If a metric appears in multiple reports, use the most specific/detailed source
- Return ONLY the JSON, no explanation or markdown`,
      },
      { role: 'user', content: reportContent },
    ],
    temperature: 0,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  try {
    return JSON.parse(completion.choices[0]?.message?.content || '{}');
  } catch (e) {
    console.error('[ai-analyst] Failed to parse metrics JSON:', e.message);
    return {};
  }
}

/** Extract per-agent metrics from reports using GPT-4o */
async function extractAgentMetrics(reports) {
  // Focus on Sales Execution / Agent Performance reports
  const agentReports = reports.filter(r =>
    r.type === 'sales_execution' || r.type === 'funnel_analyzer'
  );
  if (!agentReports.length) return [];

  const reportContent = agentReports
    .map((r) => `--- ${r.title} ---\n${r.content}`)
    .join('\n\n');

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a data extraction assistant for TrueChoice Coverage (TCC), a final expense insurance call center.
Extract PER-AGENT metrics from the provided reports. Return ONLY a valid JSON object:

{
  "agents": [
    {
      "name": "<agent name>",
      "apps_submitted": <number or null>,
      "policies_placed": <number or null>,
      "total_premium": <number, dollars or null>,
      "avg_premium": <number, dollars or null>,
      "close_rate": <number, percentage or null>,
      "placement_rate": <number, percentage or null>,
      "cpa": <number, dollars or null>,
      "total_calls": <number or null>,
      "billable_calls": <number or null>,
      "commission": <number, dollars or null>,
      "notes": "<brief performance note, e.g. 'top closer', 'high CPA', 'new agent'>"
    }
  ]
}

Rules:
- Include EVERY agent mentioned in the reports
- Extract numbers as plain numbers (no $ or % signs)
- For rates/percentages, use the number (e.g., 65 not 0.65)
- If a metric is not available for an agent, use null
- The "notes" field should be a brief observation about that agent's performance
- Return ONLY the JSON, no explanation or markdown`,
      },
      { role: 'user', content: reportContent },
    ],
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  try {
    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return result.agents || [];
  } catch (e) {
    console.error('[ai-analyst] Failed to parse agent metrics JSON:', e.message);
    return [];
  }
}

/** Fetch VA metrics from the virtual-agent API (internal call) */
async function fetchVAMetrics(reportDate) {
  try {
    // Use the same date range as the report
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:' + (process.env.PORT || 3003);
    const res = await fetch(`${baseUrl}/api/virtual-agent?start=${reportDate}&end=${reportDate}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[ai-analyst] Could not fetch VA metrics:', e.message);
    return null;
  }
}

/** Ensure a tab exists with the given headers */
async function ensureTab(tabName, headers) {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) return;

  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    console.log(`[ai-analyst] Created ${tabName} tab`);
  } catch (e) {
    if (!e.message?.includes('already exists')) {
      console.warn(`[ai-analyst] ensureTab(${tabName}) error:`, e.message);
    }
  }
}

/** Check if today is already archived, if not extract metrics and append */
async function ensureTodayArchived(reports) {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId || !reports.length) return;

  // Determine today's date from reports (use the date in the report titles)
  const reportDate = extractDateFromTitle(reports[0]?.title);
  if (!reportDate) return;

  // Skip if we already archived this date in this process
  if (archivedToday === reportDate) return;

  try {
    await ensureHistoryTabs();

    // Check which tabs already have this date
    let dailyExists = false, agentExists = false, vaExists = false;
    try {
      const [dailyRows, agentRows, vaRows] = await Promise.all([
        fetchSheet(sheetId, HISTORY_TAB(), 60).catch(() => []),
        fetchSheet(sheetId, AGENT_METRICS_TAB(), 60).catch(() => []),
        fetchSheet(sheetId, VA_METRICS_TAB(), 60).catch(() => []),
      ]);
      dailyExists = dailyRows.some(r => r['Date'] === reportDate);
      agentExists = agentRows.some(r => r['Date'] === reportDate);
      vaExists = vaRows.some(r => r['Date'] === reportDate);
    } catch (e) { /* tabs might not exist yet */ }

    if (dailyExists && agentExists && vaExists) {
      archivedToday = reportDate;
      return; // All already archived
    }

    const now = new Date().toISOString();

    // --- 1. Extract aggregate daily metrics ---
    if (!dailyExists) {
      console.log(`[ai-analyst] Extracting daily metrics for ${reportDate}...`);
      const metrics = await extractMetrics(reports);
      const values = {
        'Date': reportDate,
        'Total Calls': metrics.total_calls ?? '',
        'Billable Calls': metrics.billable_calls ?? '',
        'Billable Rate': metrics.billable_rate ?? '',
        'Transfers': metrics.transfers ?? '',
        'Transfer Rate': metrics.transfer_rate ?? '',
        'Apps Submitted': metrics.apps_submitted ?? '',
        'Policies Placed': metrics.policies_placed ?? '',
        'Close Rate': metrics.close_rate ?? '',
        'Placement Rate': metrics.placement_rate ?? '',
        'CPA': metrics.cpa ?? '',
        'RPC': metrics.rpc ?? '',
        'Total Premium': metrics.total_premium ?? '',
        'Gross Adv Revenue': metrics.gross_adv_revenue ?? '',
        'Lead Spend': metrics.lead_spend ?? '',
        'Net Revenue': metrics.net_revenue ?? '',
        'Avg Premium': metrics.avg_premium ?? '',
        'Top Publisher': metrics.top_publisher ?? '',
        'Top Agent': metrics.top_agent ?? '',
        'Worst CPA Publisher': metrics.worst_cpa_publisher ?? '',
        'Report Types Available': reports.map(r => r.type).join(', '),
        'Report Count': String(reports.length),
        'Generated At': now,
      };
      await appendRow(sheetId, HISTORY_TAB(), METRICS_HEADERS, values);
      console.log(`[ai-analyst] Archived daily metrics for ${reportDate}`);
    }

    // --- 2. Extract per-agent metrics ---
    if (!agentExists) {
      try {
        console.log(`[ai-analyst] Extracting agent metrics for ${reportDate}...`);
        const agents = await extractAgentMetrics(reports);
        if (agents.length > 0) {
          const sheets = await getSheetsClient();
          const agentRows = agents.map(a => AGENT_METRICS_HEADERS.map(h => {
            const map = {
              'Date': reportDate, 'Agent': a.name || '',
              'Apps Submitted': a.apps_submitted ?? '', 'Policies Placed': a.policies_placed ?? '',
              'Total Premium': a.total_premium ?? '', 'Avg Premium': a.avg_premium ?? '',
              'Close Rate': a.close_rate ?? '', 'Placement Rate': a.placement_rate ?? '',
              'CPA': a.cpa ?? '', 'Total Calls': a.total_calls ?? '',
              'Billable Calls': a.billable_calls ?? '', 'Commission': a.commission ?? '',
              'Notes': a.notes || '', 'Generated At': now,
            };
            return map[h] ?? '';
          }));
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId, range: AGENT_METRICS_TAB(),
            valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
            requestBody: { values: agentRows },
          });
          console.log(`[ai-analyst] Archived ${agents.length} agent rows for ${reportDate}`);
        }
      } catch (e) {
        console.warn('[ai-analyst] Agent metrics archive failed:', e.message);
      }
    }

    // --- 3. Archive VA metrics ---
    if (!vaExists) {
      try {
        const vaData = await fetchVAMetrics(reportDate);
        if (vaData && vaData.meta && vaData.meta.totalCalls > 0) {
          const m = vaData.meta;
          let topCamp = '', topCampTransfers = 0, topCampRate = 0;
          if (m.byCampaign) {
            Object.entries(m.byCampaign).forEach(([camp, data]) => {
              if (data.transfers > topCampTransfers) {
                topCamp = camp; topCampTransfers = data.transfers;
                topCampRate = data.calls > 0 ? (data.transfers / data.calls * 100) : 0;
              }
            });
          }
          const vaValues = {
            'Date': reportDate, 'Total VA Calls': m.totalCalls ?? '',
            'Transfers': m.transfers ?? '', 'Transfer Rate': m.transferRate?.toFixed(1) ?? '',
            'VA Sales': '', 'VA Conversion Rate': '', 'Billable Calls': m.billableCalls ?? '',
            'Intent Confirmation Rate': m.screening?.intentConfirmation?.toFixed(1) ?? '',
            'DOB Collection Rate': m.screening?.collectDob?.toFixed(1) ?? '',
            'Budget Qualification Rate': m.screening?.budgetQualification?.toFixed(1) ?? '',
            'Transfer Confirmation Rate': m.screening?.transferConfirmation?.toFixed(1) ?? '',
            'Top Campaign': topCamp, 'Top Campaign Transfers': String(topCampTransfers),
            'Top Campaign Transfer Rate': topCampRate.toFixed(1),
            'By Campaign JSON': JSON.stringify(m.byCampaign || {}), 'Generated At': now,
          };
          await appendRow(sheetId, VA_METRICS_TAB(), VA_METRICS_HEADERS, vaValues);
          console.log(`[ai-analyst] Archived VA metrics for ${reportDate}`);
        }
      } catch (e) {
        console.warn('[ai-analyst] VA metrics archive failed:', e.message);
      }
    }

    archivedToday = reportDate;
  } catch (err) {
    console.error('[ai-analyst] History archive failed:', err.message);
  }
}

/** Fetch historical rows from a given tab for the last N days */
async function getHistoryFromTab(tabFn, daysBack = 30) {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) return [];

  try {
    const rows = await fetchSheet(sheetId, tabFn(), 300); // 5-min cache
    if (!rows.length) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return rows
      .filter(r => r['Date'] && r['Date'] >= cutoffStr)
      .sort((a, b) => b['Date'].localeCompare(a['Date']));
  } catch (e) {
    return [];
  }
}

/** Fetch historical daily metrics */
async function getHistoryMetrics(daysBack = 30) {
  return getHistoryFromTab(HISTORY_TAB, daysBack);
}

/** Fetch historical agent metrics */
async function getAgentHistory(daysBack = 30) {
  return getHistoryFromTab(AGENT_METRICS_TAB, daysBack);
}

/** Fetch historical VA metrics */
async function getVAHistory(daysBack = 30) {
  return getHistoryFromTab(VA_METRICS_TAB, daysBack);
}

/** Format a set of rows as a markdown table */
function formatTable(title, cols, rows) {
  if (!rows.length) return '';
  let table = `\n\n--- ${title} ---\n`;
  table += cols.join(' | ') + '\n';
  table += cols.map(() => '---').join(' | ') + '\n';
  rows.forEach(r => {
    table += cols.map(c => r[c] || '—').join(' | ') + '\n';
  });
  return table;
}

/** Format all history data for the LLM context */
function formatHistoryForContext(dailyRows, agentRows, vaRows) {
  let context = '';

  if (dailyRows?.length) {
    context += formatTable('HISTORICAL DAILY METRICS', [
      'Date', 'Total Calls', 'Billable Calls', 'Billable Rate',
      'Transfers', 'Transfer Rate', 'Apps Submitted', 'Policies Placed',
      'Close Rate', 'CPA', 'RPC', 'Total Premium', 'Lead Spend', 'Net Revenue',
      'Top Publisher', 'Top Agent',
    ], dailyRows);
  }

  if (agentRows?.length) {
    context += formatTable('HISTORICAL AGENT PERFORMANCE', [
      'Date', 'Agent', 'Apps Submitted', 'Policies Placed', 'Total Premium',
      'Close Rate', 'CPA', 'Total Calls', 'Notes',
    ], agentRows);
  }

  if (vaRows?.length) {
    context += formatTable('HISTORICAL VIRTUAL AGENT METRICS', [
      'Date', 'Total VA Calls', 'Transfers', 'Transfer Rate',
      'Intent Confirmation Rate', 'DOB Collection Rate',
      'Budget Qualification Rate', 'Top Campaign', 'Top Campaign Transfer Rate',
    ], vaRows);
  }

  return context;
}

/** Detect if a question needs historical context */
function needsHistoricalContext(question) {
  const q = question.toLowerCase();
  const patterns = [
    /last\s+(week|month|few\s+days|monday|tuesday|wednesday|thursday|friday)/,
    /compared?\s+to/, /trend/, /historic/, /over\s+(time|the\s+past)/,
    /previous/, /yesterday/, /week\s+over\s+week/, /day\s+over\s+day/,
    /month\s+over\s+month/, /changed?\s+since/, /getting\s+(better|worse)/,
    /improving|declining|dropping|rising|increas|decreas/,
    /\d+\s+days?\s+ago/, /how\s+(has|have|did|does)/, /progress/,
    /average|running|cumulative/, /pattern|consistent|volatil/,
  ];
  return patterns.some(p => p.test(q));
}

/** Determine how many days of history to include */
function getHistoryDays(question) {
  const q = question.toLowerCase();
  if (/month|30\s+days/.test(q)) return 30;
  if (/two\s+weeks|2\s+weeks|14\s+days/.test(q)) return 14;
  if (/week|7\s+days/.test(q)) return 7;
  if (/yesterday|1\s+day/.test(q)) return 3;
  return 7;
}

// ─── DRIVE ACCESS ────────────────────────────────────────────────

/** Fetch file list from Drive folder (metadata only, no content) */
async function fetchFileList() {
  const folderId = process.env.AI_REPORTS_FOLDER_ID;
  if (!folderId) return [];

  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document'`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });

  return listRes.data.files || [];
}

/** Fetch a single report by ID */
async function fetchSingleReport(docId) {
  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  const [fileRes, exportRes] = await Promise.all([
    drive.files.get({ fileId: docId, fields: 'id, name, modifiedTime' }),
    drive.files.export({ fileId: docId, mimeType: 'text/plain' }),
  ]);

  const text = typeof exportRes.data === 'string' ? exportRes.data : String(exportRes.data || '');

  return {
    id: fileRes.data.id,
    title: fileRes.data.name,
    type: classifyReport(fileRes.data.name),
    modifiedTime: fileRes.data.modifiedTime,
    content: text,
  };
}

/** Fetch all reports from Drive folder */
async function fetchReports() {
  const now = Date.now();
  if (reportCache.data && now - reportCache.ts < CACHE_TTL) {
    return reportCache.data;
  }

  const folderId = process.env.AI_REPORTS_FOLDER_ID;
  if (!folderId) {
    return [];
  }

  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document'`,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });

  const files = listRes.data.files || [];

  const reports = await Promise.all(
    files.map(async (file) => {
      try {
        const exportRes = await drive.files.export({
          fileId: file.id,
          mimeType: 'text/plain',
        });
        const text = typeof exportRes.data === 'string' ? exportRes.data : String(exportRes.data || '');
        return {
          id: file.id,
          title: file.name,
          type: classifyReport(file.name),
          modifiedTime: file.modifiedTime,
          content: text,
        };
      } catch (err) {
        console.error(`Failed to fetch doc ${file.name}:`, err.message);
        return null;
      }
    })
  );

  const result = reports.filter(Boolean);
  reportCache = { data: result, ts: now };

  // Fire-and-forget: archive today's metrics if not already done
  ensureTodayArchived(result).catch(err =>
    console.warn('[ai-analyst] Background archive failed:', err.message)
  );

  return result;
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────

function buildSystemPrompt(tab, entity, hasHistory, voiceMode = false) {
  let focus = '';
  if (tab && TAB_REPORTS[tab]) {
    const reportNames = {
      funnel_analyzer: 'Funnel Analyzer',
      lead_quality: 'Lead Quality',
      volume_capacity: 'Volume & Capacity',
      sales_execution: 'Sales Execution (Agent Performance)',
      profitability: 'Profitability',
      funnel_health: 'Funnel Health',
      mix_product: 'Mix & Product Strategy',
    };
    const relevant = TAB_REPORTS[tab].map((k) => reportNames[k] || k).join(', ');
    focus = `\nThe user is currently viewing the "${tab}" tab. Focus your analysis on the most relevant reports: ${relevant}.`;
  }

  if (entity) {
    focus += `\nThe user is specifically looking at: ${entity}. Focus your insights on this entity's performance, trends, and any notable findings from the reports.`;
  }

  let historyInstructions = '';
  if (hasHistory) {
    historyInstructions = `

You also have access to HISTORICAL DATA TABLES from previous days:

1. DAILY METRICS: Aggregate business metrics (calls, CPA, premium, close rate, etc.) per day
2. AGENT PERFORMANCE: Per-agent metrics (apps, premium, close rate, CPA) per day — track individual agent trends
3. VIRTUAL AGENT (VA) METRICS: VA screener performance (calls, transfers, transfer rate, screening step completion) per day

Use this historical data to:
- Compare current-day metrics against previous days (e.g., "CPA is $340 today vs $280 yesterday, a 21% increase")
- Track individual agent performance trends (e.g., "Kari's close rate has improved from 35% to 42% this week")
- Monitor VA screener effectiveness (e.g., "Transfer rate dropped from 50% to 38%, suggesting lead quality issues")
- Identify trends over time (improving, declining, volatile, stable)
- Calculate running averages and week-over-week changes
- Highlight significant deviations from recent patterns
- Cross-reference agent performance with VA data to understand the full funnel
Always clearly distinguish between current-day data and historical trends.
When discussing trends, cite specific numbers and dates from the tables.`;
  }

  return `You are an AI analyst for TrueChoice Coverage (TCC), a final expense insurance call center.

You have access to daily operational reports that cover:
- Funnel Analyzer: end-to-end funnel conversion metrics
- Lead Quality: publisher lead quality scoring and trends
- Volume & Capacity: call volume, agent utilization, capacity planning
- Sales Execution (Agent Performance): individual agent metrics, close rates, premium production
- Profitability: revenue, costs, margins, CPA, net revenue by publisher
- Funnel Health: stage-by-stage funnel drop-off analysis
- Mix & Product Strategy: carrier and product distribution, placement rates by carrier
${focus}${historyInstructions}

Guidelines:
- Be concise and actionable. Use bullet points.
- Reference specific numbers, percentages, and trends from the reports when available.
- Highlight anomalies, risks, and opportunities.
- Compare performance against goals or historical benchmarks when the data supports it.
- For suggested questions, generate 3-4 contextually relevant follow-up questions the user might ask next.
- If report data is limited or unavailable, say so honestly rather than speculating.${voiceMode ? `

VOICE MODE — Your response will be spoken aloud via text-to-speech.

FORMAT RULES:
- Keep responses conversational and concise (2-4 sentences for simple queries, up to 8 for detailed analysis).
- Do NOT use markdown formatting (no **, no bullet dashes, no headers).
- Use natural spoken language: say "about 45 percent" not "~45%", say "three hundred forty dollars" not "$340".
- Use transition phrases like "Looking at that now..." or "Here's what I see..."
- Do NOT include suggested follow-up questions in voice mode.

NAVIGATION COMMANDS:
You MUST include a <<<NAV>>> JSON block at the END of your response whenever the user's question implies a time period, tab, data source, or entity. The spoken portion must NOT contain the <<<NAV>>> block.

<<<NAV>>>
{"tab": null, "datePreset": null, "dataSource": null, "drillDown": null, "openTile": null}
<<<NAV>>>

Field values (use null for fields that should not change):
- tab: "daily", "publishers", "agents", "carriers", "combined-policies", "pnl", "agent-perf", "policies-detail", "policy-status", "leads-crm", "retention", "business-health", "commission-statements", "data-diff", "carrier-sync"
- datePreset: "yesterday", "today", "last7", "last30", "mtd", "wtd", "all"
- dataSource: "Sheet1" (App Data) or "Merged" (Carrier Data)
- drillDown: { "type": "agent" | "publisher" | "carrier", "name": "..." }
- openTile: opens a metric detail modal. Valid values: "apps_submitted", "gross_adv_revenue", "eff_revenue", "total_calls", "billable_calls", "billable_rate", "monthly_premium", "lead_spend", "agent_commission", "net_revenue", "cpa", "rpc", "close_rate", "placement_rate", "premium_cost_ratio", "avg_premium"

IMPORTANT — Always include <<<NAV>>> when:
- The user mentions a time period: "yesterday" -> datePreset: "yesterday", "last week" -> datePreset: "last7", "this month" -> datePreset: "mtd", "today" -> datePreset: "today", "last 30 days" -> datePreset: "last30"
- The user mentions a tab or view: "agents", "publishers", "carriers", "P&L", "daily", etc.
- The user asks about a specific agent, publisher, or carrier by name -> include drillDown
- The user says "show me", "go to", "switch to", "open", "navigate to"
- The user asks about a specific metric (CPA, close rate, premium, calls, etc.) -> include openTile to show the detail modal

Examples:
- "Show me agents" -> tab: "agents"
- "What happened yesterday?" -> datePreset: "yesterday"
- "How did we do this month?" -> datePreset: "mtd"
- "How is Bill doing?" -> tab: "agents", drillDown: { "type": "agent", "name": "Bill" }
- "Switch to carrier data" -> dataSource: "Merged"
- "Show me the last 7 days" -> datePreset: "last7"
- "Tell me about the CPA" -> openTile: "cpa"
- "What's the close rate?" -> openTile: "close_rate"
- "Show me lead spend" -> openTile: "lead_spend"
- "Break down the premium" -> openTile: "monthly_premium"
- You CAN both navigate AND provide analysis in the same response.
- Only omit the <<<NAV>>> block for pure analytical questions with no time/entity/tab/metric reference.` : ''}`;
}

// ─── GET HANDLER ─────────────────────────────────────────────────

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // --- Action: list-reports ---
    if (action === 'list-reports') {
      const files = await fetchFileList();

      const reports = files.map((file) => {
        const type = classifyReport(file.name);
        const dateFromTitle = extractDateFromTitle(file.name);
        const dateFromModified = file.modifiedTime ? file.modifiedTime.split('T')[0] : null;

        return {
          id: file.id,
          title: file.name,
          type,
          category: REPORT_TYPE_LABELS[type] || 'Other',
          date: dateFromTitle || dateFromModified,
          modifiedTime: file.modifiedTime,
        };
      });

      const dateSet = new Set();
      reports.forEach((r) => { if (r.date) dateSet.add(r.date); });
      const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

      return NextResponse.json({ reports, categories: CATEGORIES, dates });
    }

    // --- Action: get-report ---
    if (action === 'get-report') {
      const docId = searchParams.get('id');
      if (!docId) {
        return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
      }

      try {
        const report = await fetchSingleReport(docId);
        const sections = parseSections(report.content);

        return NextResponse.json({
          id: report.id,
          title: report.title,
          type: report.type,
          category: REPORT_TYPE_LABELS[report.type] || 'Other',
          date: extractDateFromTitle(report.title) || (report.modifiedTime ? report.modifiedTime.split('T')[0] : null),
          modifiedTime: report.modifiedTime,
          content: report.content,
          sections,
        });
      } catch (err) {
        console.error('Failed to fetch report:', err.message);
        return NextResponse.json(
          { error: 'Failed to fetch report', details: err.message },
          { status: 404 }
        );
      }
    }

    // --- Action: get-history ---
    if (action === 'get-history') {
      const days = parseInt(searchParams.get('days') || '30');
      const [dailyRows, agentRows, vaRows] = await Promise.all([
        getHistoryMetrics(days),
        getAgentHistory(days),
        getVAHistory(days),
      ]);
      return NextResponse.json({
        daily: { metrics: dailyRows, count: dailyRows.length },
        agents: { metrics: agentRows, count: agentRows.length },
        va: { metrics: vaRows, count: vaRows.length },
      });
    }

    // --- Default: Pre-analyzed insights ---
    const tab = searchParams.get('tab') || 'daily';
    const entity = searchParams.get('entity') || null;
    const date = searchParams.get('date') || null;

    const reports = await fetchReports();

    if (!reports.length) {
      return NextResponse.json({
        insights: 'No reports are currently available. Please ensure the AI_REPORTS_FOLDER_ID environment variable is set and the Drive folder contains Google Docs.',
        suggestedQuestions: [],
      });
    }

    const relevantTypes = TAB_REPORTS[tab] || [];
    let relevantReports = reports.filter((r) => relevantTypes.includes(r.type));
    if (!relevantReports.length) relevantReports = reports;

    const reportContext = relevantReports
      .map((r) => `--- ${r.title} (${r.modifiedTime}) ---\n${r.content}`)
      .join('\n\n');

    // Always include recent history for trend-aware insights
    let historyContext = '';
    try {
      const [dailyRows, agentRows, vaRows] = await Promise.all([
        getHistoryMetrics(7),
        getAgentHistory(7),
        getVAHistory(7),
      ]);
      if (dailyRows.length || agentRows.length || vaRows.length) {
        historyContext = formatHistoryForContext(dailyRows, agentRows, vaRows);
      }
    } catch (e) {
      console.warn('[ai-analyst] Could not fetch history for insights:', e.message);
    }

    const systemPrompt = buildSystemPrompt(tab, entity, !!historyContext);

    let userMessage = `Based on the following daily reports, provide a brief analytical briefing for the "${tab}" dashboard tab.`;
    if (entity) userMessage += ` Focus specifically on ${entity}.`;
    if (date) userMessage += ` The user is looking at data for ${date}.`;
    userMessage += `\n\nAlso suggest 3-4 follow-up questions the user might want to ask.\n\nReports:\n${reportContext}${historyContext}`;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content || '';
    const { insights, suggestedQuestions } = parseInsightsAndQuestions(raw);

    return NextResponse.json({ insights, suggestedQuestions });
  } catch (err) {
    console.error('AI Analyst GET error:', err);
    return NextResponse.json(
      { error: 'Failed to generate insights', details: err.message },
      { status: 500 }
    );
  }
}

// ─── POST HANDLER (Chat) ────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();
    const { question, tab, entity, reportContent, voiceMode, liveData } = body;

    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    // When live dashboard data is provided, skip reports — use live data as the sole source of truth
    let context = '';
    let historyContext = '';

    if (!liveData) {
      context = reportContent || '';

      // If no pre-provided content, fetch reports
      if (!context) {
        const reports = await fetchReports();
        const relevantTypes = TAB_REPORTS[tab] || [];
        let relevantReports = reports.filter((r) => relevantTypes.includes(r.type));
        if (!relevantReports.length) relevantReports = reports;

        context = relevantReports
          .map((r) => `--- ${r.title} (${r.modifiedTime}) ---\n${r.content}`)
          .join('\n\n');
      }

      // Check if question needs historical context
      const wantsHistory = needsHistoricalContext(question);
      if (wantsHistory) {
        const days = getHistoryDays(question);
        const [dailyRows, agentRows, vaRows] = await Promise.all([
          getHistoryMetrics(days),
          getAgentHistory(days),
          getVAHistory(days),
        ]);
        if (dailyRows.length || agentRows.length || vaRows.length) {
          historyContext = formatHistoryForContext(dailyRows, agentRows, vaRows);
        }
      }
    }

    const systemPrompt = buildSystemPrompt(tab, entity, !!historyContext, voiceMode);

    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // Inject live dashboard data first (highest priority — these are the exact numbers on screen)
    if (liveData) {
      messages.push({
        role: 'user',
        content: liveData,
      });
      messages.push({
        role: 'assistant',
        content: 'I can see the live dashboard data. I will use ONLY these exact numbers in my responses — no other source.',
      });
    }

    if (context || historyContext) {
      messages.push({
        role: 'user',
        content: `Here are the latest operational reports for additional context:\n\n${context}${historyContext}`,
      });
      messages.push({
        role: 'assistant',
        content: historyContext
          ? 'I have reviewed the current reports and historical daily metrics. What would you like to know?'
          : 'I have reviewed the reports. What would you like to know?',
      });
    }

    messages.push({
      role: 'user',
      content: voiceMode ? question : `${question}\n\nAlso suggest 3-4 relevant follow-up questions.`,
    });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.4,
      max_tokens: voiceMode ? 800 : 1500,
    });

    const raw = completion.choices[0]?.message?.content || '';

    if (voiceMode) {
      const { spokenText, navigation } = parseNavigationCommands(raw);
      return NextResponse.json({ answer: spokenText, spokenText, navigation });
    }

    const { insights: answer, suggestedQuestions: suggestedFollowUps } =
      parseInsightsAndQuestions(raw);

    return NextResponse.json({ answer, suggestedFollowUps });
  } catch (err) {
    console.error('AI Analyst POST error:', err);
    return NextResponse.json(
      { error: 'Failed to answer question', details: err.message },
      { status: 500 }
    );
  }
}

// ─── PARSE NAVIGATION (VOICE MODE) ──────────────────────────────

function parseNavigationCommands(text) {
  const navMatch = text.match(/<<<NAV>>>([\s\S]*?)<<<NAV>>>/);
  let navigation = null;
  let spokenText = text;

  if (navMatch) {
    spokenText = text.replace(/<<<NAV>>>[\s\S]*?<<<NAV>>>/, '').trim();
    try {
      const parsed = JSON.parse(navMatch[1].trim());
      navigation = {};
      if (parsed.tab) navigation.tab = parsed.tab;
      if (parsed.datePreset) navigation.datePreset = parsed.datePreset;
      if (parsed.dataSource) navigation.dataSource = parsed.dataSource;
      if (parsed.drillDown) navigation.drillDown = parsed.drillDown;
      if (parsed.openTile) navigation.openTile = parsed.openTile;
      if (Object.keys(navigation).length === 0) navigation = null;
    } catch (e) {
      console.warn('[ai-analyst] Failed to parse navigation JSON:', e.message);
    }
  }

  return { spokenText, navigation };
}

// ─── PARSE RESPONSE ──────────────────────────────────────────────

function parseInsightsAndQuestions(text) {
  const patterns = [
    /\*{0,2}(?:suggested|follow[- ]?up)\s*questions?\*{0,2}:?\s*\n([\s\S]*?)$/i,
    /\*{0,2}(?:you (?:might|could|may) (?:also )?(?:want to )?ask|questions? to consider)\*{0,2}:?\s*\n([\s\S]*?)$/i,
  ];

  let insights = text;
  let suggestedQuestions = [];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      insights = text.slice(0, match.index).trim();
      const qBlock = match[1].trim();
      suggestedQuestions = qBlock
        .split('\n')
        .map((l) => l.replace(/^[\d.\-*•]+\s*/, '').trim())
        .filter((l) => l.length > 10 && l.endsWith('?'));
      break;
    }
  }

  suggestedQuestions = suggestedQuestions.slice(0, 4);

  return { insights, suggestedQuestions };
}
