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
const METRICS_HEADERS = [
  'Date', 'Total Calls', 'Billable Calls', 'Billable Rate',
  'Transfers', 'Transfer Rate', 'Apps Submitted', 'Policies Placed',
  'Close Rate', 'Placement Rate', 'CPA', 'RPC',
  'Total Premium', 'Gross Adv Revenue', 'Lead Spend', 'Net Revenue',
  'Avg Premium', 'Top Publisher', 'Top Agent', 'Worst CPA Publisher',
  'Report Types Available', 'Report Count', 'Generated At',
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

/** Ensure the Daily Metrics tab exists, create with headers if not */
async function ensureHistoryTab() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) return;
  const tab = HISTORY_TAB();

  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
    // Tab was just created — write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tab}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [METRICS_HEADERS] },
    });
    console.log('[ai-analyst] Created Daily Metrics tab');
  } catch (e) {
    if (!e.message?.includes('already exists')) {
      console.warn('[ai-analyst] ensureHistoryTab error:', e.message);
    }
    // Tab already exists — fine
  }
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
    // Check if this date already exists in the history tab
    await ensureHistoryTab();
    let existing = [];
    try {
      existing = await fetchSheet(sheetId, HISTORY_TAB(), 60);
    } catch (e) {
      // Tab might be empty or new
    }
    if (existing.some(r => r['Date'] === reportDate)) {
      archivedToday = reportDate;
      return; // Already archived
    }

    // Extract metrics from reports
    console.log(`[ai-analyst] Extracting metrics for ${reportDate}...`);
    const metrics = await extractMetrics(reports);

    // Build row values
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
      'Generated At': new Date().toISOString(),
    };

    await appendRow(sheetId, HISTORY_TAB(), METRICS_HEADERS, values);
    archivedToday = reportDate;
    console.log(`[ai-analyst] Archived metrics for ${reportDate}`);
  } catch (err) {
    console.error('[ai-analyst] History archive failed:', err.message);
  }
}

/** Fetch historical metrics for the last N days */
async function getHistoryMetrics(daysBack = 30) {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) return [];

  try {
    const rows = await fetchSheet(sheetId, HISTORY_TAB(), 300); // 5-min cache
    if (!rows.length) return [];

    // Calculate cutoff date
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return rows
      .filter(r => r['Date'] && r['Date'] >= cutoffStr)
      .sort((a, b) => b['Date'].localeCompare(a['Date']));
  } catch (e) {
    console.warn('[ai-analyst] Could not fetch history:', e.message);
    return [];
  }
}

/** Format history metrics as a readable table for the LLM */
function formatHistoryForContext(rows) {
  if (!rows.length) return '';

  const metricCols = [
    'Date', 'Total Calls', 'Billable Calls', 'Billable Rate',
    'Transfers', 'Transfer Rate', 'Apps Submitted', 'Policies Placed',
    'Close Rate', 'CPA', 'RPC', 'Total Premium', 'Lead Spend', 'Net Revenue',
    'Top Publisher', 'Top Agent',
  ];

  let table = '\n\n--- HISTORICAL DAILY METRICS ---\n';
  table += metricCols.join(' | ') + '\n';
  table += metricCols.map(() => '---').join(' | ') + '\n';

  rows.forEach(r => {
    table += metricCols.map(c => r[c] || '—').join(' | ') + '\n';
  });

  return table;
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

function buildSystemPrompt(tab, entity, hasHistory) {
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

You also have access to a HISTORICAL DAILY METRICS table showing key metrics from previous days. Use this data to:
- Compare current-day metrics against previous days (e.g., "CPA is $340 today vs $280 yesterday, a 21% increase")
- Identify trends over time (improving, declining, volatile, stable)
- Calculate running averages and week-over-week changes
- Highlight significant deviations from recent patterns
- Explain what's driving changes by cross-referencing the full report content
Always clearly distinguish between current-day data and historical trends.
When discussing trends, cite specific numbers and dates from the metrics table.`;
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
- If report data is limited or unavailable, say so honestly rather than speculating.`;
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
      const rows = await getHistoryMetrics(days);
      return NextResponse.json({ metrics: rows, count: rows.length });
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
      const historyRows = await getHistoryMetrics(7);
      if (historyRows.length > 0) {
        historyContext = formatHistoryForContext(historyRows);
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
    const { question, tab, entity, reportContent } = body;

    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    let context = reportContent || '';

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
    let historyContext = '';
    const wantsHistory = needsHistoricalContext(question);
    if (wantsHistory) {
      const days = getHistoryDays(question);
      const historyRows = await getHistoryMetrics(days);
      if (historyRows.length > 0) {
        historyContext = formatHistoryForContext(historyRows);
      }
    }

    const systemPrompt = buildSystemPrompt(tab, entity, !!historyContext);

    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    if (context || historyContext) {
      messages.push({
        role: 'user',
        content: `Here are the latest operational reports for context:\n\n${context}${historyContext}`,
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
      content: `${question}\n\nAlso suggest 3-4 relevant follow-up questions.`,
    });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.4,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content || '';
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
