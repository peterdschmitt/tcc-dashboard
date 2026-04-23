import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  fetchLatestResultForAgent,
  isConverselyEnabled,
} from '@/lib/conversely-api';
import { getPriorities } from '@/lib/insight-priorities';

export const dynamic = 'force-dynamic';

// Map dashboard category slug → Conversely agent ID.
// Mirrors CATEGORY_TO_AGENT_ID in conversely-api.js but kept local to avoid
// exporting that map from another file.
const CATEGORY_TO_AGENT = {
  funnel_health: 6,
  volume_capacity: 5,
  profitability: 4,
  sales_execution: 12,
  mix_product: 13,
  lead_quality: 27,
  funnel_analyzer: 25,
};

// In-memory cache: key = `${category}:${date}`. Resets on server restart.
// Sheet-backed cache lands in a follow-up pass.
const cache = new Map();

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function buildSystemPrompt() {
  return `You are a synthesis layer over a CONVERSELY.AI analyst report. Your job is to extract the report's most valuable findings into a structured JSON object — preserving the qualitative depth, examples, and verbatim evidence the agent already wrote.

CRITICAL RULES
- Do NOT summarize away the agent's specific examples, names, quotes, or numbers. Carry them through verbatim or near-verbatim into the "evidence" field of each item.
- Do NOT invent insights that aren't in the report. If a bucket has nothing, return an empty array.
- The "headline" must reference the highest-ranked priority item that has strong signal in today's report. Severity-override items (marked OVERRIDE in the priority list) jump the queue when present.
- Down-weight any insight whose underlying segment has fewer than ~5 billable calls.
- Prefer specifics over generalities ("HIW × Michael close rate 17% vs HIW × Kari 39% — same campaign, different outcome" beats "rep performance varies").

OUTPUT SHAPE — return STRICT JSON matching exactly:
{
  "headline": {
    "text": "string — one sentence (max ~30 words). Lead with the SPECIFIC finding, then the implication.",
    "severity": "red" | "yellow" | "green" | "info",
    "priorityRank": 1-8,
    "priorityMatched": "string — copy the priority item label that this headline ties to",
    "wasOverride": boolean
  },
  "kpis": [
    { "label": "string (≤8 chars)", "value": "string with unit", "trend": "up" | "down" | null }
  ],
  "topAction": "string — single most actionable next step (max ~20 words)",
  "anomalies": [
    { "text": "string — what's anomalous", "severity": "red" | "yellow" | "info", "evidence": "string — verbatim or near-verbatim from the report. Include numbers, names, segment." }
  ],
  "breaches": [
    { "text": "string — which threshold was crossed", "severity": "red" | "yellow", "evidence": "string — actual vs goal with specifics" }
  ],
  "actions": [
    { "text": "string — imperative action", "rank": 1-3, "evidence": "string — why this action, citing the report's reasoning" }
  ],
  "themes": [
    { "text": "string — the recurring theme", "daysObserved": number | null, "evidence": "string — examples or quotes that illustrate the theme" }
  ],
  "wins": [
    { "text": "string — what's working", "evidence": "string — specifics from the report" }
  ],
  "examples": [
    { "type": "quote" | "case" | "archetype", "text": "string — verbatim quote, case description, or archetype name", "context": "string — what makes this notable" }
  ]
}

LIMITS
- kpis: max 4
- anomalies, breaches, actions: max 3 each
- themes, wins: max 2 each
- examples: max 4 (only include if the report has rich qualitative content like quotes, case studies, transcripts, archetypes)

Return ONLY the JSON. No markdown fences, no commentary.`;
}

function buildUserMessage({ category, date, todayReport, priorityList }) {
  const priorityText = priorityList.map(p =>
    `${p.rank}. ${p.item} (weight ${p.weight}${p.override ? ', OVERRIDE' : ''}) — ${p.why}`
  ).join('\n');

  return `SECTION: ${category}
DATE: ${date}

PRIORITY LIST (use to pick the headline; OVERRIDE items jump the queue when present):
${priorityText}

TODAY'S REPORT:
${todayReport}

Synthesize. Return only the JSON.`;
}

async function runSynthesis({ category, date, agentId }) {
  const result = await fetchLatestResultForAgent(agentId);
  if (!result || !result.result_message) {
    return {
      headline: {
        text: `No report available from ${category} agent for ${date}.`,
        severity: 'info', priorityRank: null, priorityMatched: null, wasOverride: false,
      },
      kpis: [], topAction: null, anomalies: [], breaches: [],
      actions: [], themes: [], wins: [], examples: [],
      meta: { source: 'no-report', agentId, date },
    };
  }

  const priorityList = getPriorities(category);
  const openai = getOpenAI();

  const t0 = Date.now();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserMessage({
        category, date, todayReport: result.result_message, priorityList,
      }) },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  });
  const synthesisMs = Date.now() - t0;

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Synthesis returned invalid JSON: ${e.message}`);
  }

  return {
    ...parsed,
    meta: {
      source: 'conversely',
      agentId,
      date,
      runDate: result.run_date,
      synthesisMs,
      rawReportLength: result.result_message.length,
      modelUsed: 'gpt-4o',
    },
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const force = searchParams.get('force') === '1';

    if (!category) {
      return NextResponse.json({ error: 'category parameter required' }, { status: 400 });
    }
    const agentId = CATEGORY_TO_AGENT[category];
    if (!agentId) {
      return NextResponse.json({ error: `Unknown category: ${category}` }, { status: 400 });
    }
    if (!isConverselyEnabled()) {
      return NextResponse.json({
        error: 'CONVERSELY_API_BASE_URL and CONVERSELY_API_KEY must be set',
      }, { status: 503 });
    }

    const cacheKey = `${category}:${date}`;
    if (!force && cache.has(cacheKey)) {
      return NextResponse.json({ ...cache.get(cacheKey), cached: true });
    }

    const synthesis = await runSynthesis({ category, date, agentId });
    cache.set(cacheKey, synthesis);
    return NextResponse.json({ ...synthesis, cached: false });
  } catch (err) {
    console.error('[ai-analyst/insights] error:', err);
    return NextResponse.json({
      error: 'Synthesis failed',
      details: err.message,
    }, { status: 500 });
  }
}
