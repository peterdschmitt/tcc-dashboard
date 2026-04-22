import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { fetchSheet, appendRow, getSheetsClient } from '@/lib/sheets';
import {
  buildCompanyRow, buildAgentRows, buildCampaignRows, writeSnapshots,
  readCompanySeries, readAgentSeries, readCampaignSeries,
} from '@/lib/snapshots';
import { computeBaseline, buildBaselineBlock } from '@/lib/baselines';

const PLACED_STATUSES = ['Advance Released', 'Active - In Force', 'Submitted - Pending'];
const AI_CACHE_TAB = process.env.AI_CACHE_TAB || 'AI Summary Cache';
const AI_CACHE_HEADERS = ['Date', 'Mode', 'Narrative', 'TableSummaries', 'GeneratedAt'];
const isPlaced = p => PLACED_STATUSES.includes(p.placed);

function getBaseUrl() {
  // Use production domain instead of VERCEL_URL (deployment-specific URLs get 401 from deployment protection)
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

function getYesterday() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - 1);
  return et.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function computeAlerts(metrics, goals, companyMeta, companyBaselines = {}) {
  const alerts = [];
  const metricDefs = [
    { key: 'apps_submitted',     label: 'Apps Submitted',     actual: metrics.apps,          snapKey: 'apps' },
    { key: 'policies_placed',    label: 'Policies Placed',    actual: metrics.placed,        snapKey: 'placed' },
    { key: 'total_calls',        label: 'Total Calls',        actual: metrics.totalCalls,    snapKey: 'calls' },
    { key: 'billable_calls',     label: 'Billable Calls',     actual: metrics.billable,      snapKey: 'billable' },
    { key: 'billable_rate',      label: 'Billable Rate',      actual: metrics.billableRate,  snapKey: 'billableRate', isRate: true },
    { key: 'monthly_premium',    label: 'Monthly Premium',    actual: metrics.totalPremium,  snapKey: 'premium' },
    { key: 'gross_adv_revenue',  label: 'Gross Adv Revenue',  actual: metrics.totalGAR,      snapKey: 'gar' },
    { key: 'lead_spend',         label: 'Lead Spend',         actual: metrics.totalLeadSpend, snapKey: 'leadSpend' },
    { key: 'agent_commission',   label: 'Agent Commission',   actual: metrics.totalComm,     snapKey: 'commission' },
    { key: 'net_revenue',        label: 'Net Revenue',        actual: metrics.netRevenue,    snapKey: 'netRevenue' },
    { key: 'cpa',                label: 'CPA',                actual: metrics.cpa,           snapKey: 'cpa',         isRate: true },
    { key: 'rpc',                label: 'RPC',                actual: metrics.rpc,           snapKey: 'rpc',         isRate: true },
    { key: 'close_rate',         label: 'Close Rate',         actual: metrics.closeRate,     snapKey: 'closeRate',   isRate: true },
    { key: 'placement_rate',     label: 'Placement Rate',     actual: metrics.placementRate, snapKey: 'placementRate', isRate: true },
    { key: 'premium_cost_ratio', label: 'Premium:Cost',       actual: metrics.premCost,      snapKey: 'premCost',    isRate: true },
    { key: 'avg_premium',        label: 'Avg Premium',        actual: metrics.avgPremium,    snapKey: 'avgPremium',  isRate: true },
  ];

  for (const m of metricDefs) {
    const meta = companyMeta[m.key] || {};
    const lower = meta.lower || false;
    const yellowPct = (meta.yellow || 80) / 100;

    // Goal-based alert (existing behavior, now tagged with kind)
    const goal = goals[m.key];
    if (goal && m.actual) {
      const ratio = lower ? goal / m.actual : m.actual / goal;
      if (ratio < yellowPct) {
        alerts.push({ kind: 'goal-miss', metric: m.label, actual: m.actual, goal, status: 'red', lower });
      } else if (ratio < 1) {
        alerts.push({ kind: 'goal-miss', metric: m.label, actual: m.actual, goal, status: 'yellow', lower });
      }
    }

    // Historical-anomaly alert (new, independent of goal)
    const b = companyBaselines[m.snapKey];
    if (b && b.z != null) {
      // For "lower is better" metrics, a high positive z (spike up) is bad; for normal metrics, a low negative z (drop) is bad.
      const badZ = lower ? b.z : -b.z;
      if (badZ >= 1.5 || b.worstInN) {
        alerts.push({
          kind: 'historical-anomaly',
          metric: m.label,
          actual: m.actual,
          status: badZ >= 2.5 ? 'red' : 'yellow',
          lower,
          z: b.z,
          avg30: b.avg30,
          worstInN: b.worstInN || false,
        });
      }
    }
  }

  return alerts;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start') || searchParams.get('date') || getYesterday();
    const endDate = searchParams.get('end') || startDate;
    const date = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    const mode = searchParams.get('mode') || (startDate !== endDate ? 'weekly' : 'daily');
    const source = searchParams.get('source') || process.env.SALES_TAB_NAME || 'Sheet1';
    const baseUrl = getBaseUrl();
    console.log('[daily-summary] baseUrl:', baseUrl);

    // Fetch all data in parallel
    const [dashRes, perfRes, goalsRes, vaRes] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard?start=${startDate}&end=${endDate}&source=${source}`),
      fetch(`${baseUrl}/api/agent-performance?start=${startDate}&end=${endDate}`).catch(() => null),
      fetch(`${baseUrl}/api/goals`),
      fetch(`${baseUrl}/api/virtual-agent?start=${startDate}&end=${endDate}`).catch(() => null),
    ]);

    if (!dashRes.ok) {
      const body = await dashRes.text().catch(() => '(no body)');
      console.error(`[daily-summary] Dashboard failed: status=${dashRes.status}, url=${baseUrl}/api/dashboard, body=${body.slice(0, 500)}`);
      throw new Error(`Dashboard API: ${dashRes.status}`);
    }
    if (!goalsRes.ok) {
      const body = await goalsRes.text().catch(() => '(no body)');
      console.error(`[daily-summary] Goals failed: status=${goalsRes.status}, body=${body.slice(0, 500)}`);
      throw new Error(`Goals API: ${goalsRes.status}`);
    }

    const dashData = await dashRes.json();
    const goalsData = await goalsRes.json();
    const perfData = perfRes?.ok ? await perfRes.json() : null;
    const vaData = vaRes?.ok ? await vaRes.json() : null;
    const vaCalls = vaData?.calls || [];

    const policies = dashData.policies || [];
    const calls = dashData.calls || [];
    const pnl = dashData.pnl || [];
    const cg = goalsData.company || {};
    const cm = goalsData.companyMeta || {};

    // ─── SALES ───
    const placed = policies.filter(isPlaced);
    const byAgent = {};
    policies.forEach(p => {
      if (!byAgent[p.agent]) byAgent[p.agent] = { apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      byAgent[p.agent].apps++;
      byAgent[p.agent].premium += p.premium || 0;
      byAgent[p.agent].commission += p.commission || 0;
      byAgent[p.agent].gar += p.grossAdvancedRevenue || 0;
      if (isPlaced(p)) {
        byAgent[p.agent].placed++;
      }
    });

    const byCampaign = {};
    pnl.forEach(p => {
      const salesCount = p.appCount || 0;
      const prem = p.totalPremium || 0;
      const gar = p.grossAdvancedRevenue || 0;
      const comm = p.totalCommission || 0;
      byCampaign[p.campaign] = {
        vendor: p.vendor,
        calls: p.totalCalls,
        billable: p.billableCalls,
        billableRate: p.totalCalls > 0 ? (p.billableCalls / p.totalCalls * 100) : 0,
        spend: p.leadSpend,
        sales: salesCount,
        premium: prem,
        gar,
        commission: comm,
        netRevenue: gar - (p.leadSpend || 0) - comm,
        rpc: p.totalCalls > 0 ? p.leadSpend / p.totalCalls : 0,
        cpa: salesCount > 0 ? p.leadSpend / salesCount : 0,
        closeRate: p.billableCalls > 0 ? (salesCount / p.billableCalls * 100) : 0,
      };
    });

    // ─── FINANCIALS ───
    const totalPremium = policies.reduce((s, p) => s + (p.premium || 0), 0);
    const totalLeadSpend = pnl.reduce((s, p) => s + (p.leadSpend || 0), 0);
    const totalGAR = policies.reduce((s, p) => s + (p.grossAdvancedRevenue || 0), 0);
    const totalComm = policies.reduce((s, p) => s + (p.commission || 0), 0);
    const totalCalls = calls.length;
    const billable = calls.filter(c => c.isBillable).length;
    const apps = policies.length;
    const cpa = apps > 0 ? totalLeadSpend / apps : 0;
    const closeRate = billable > 0 ? apps / billable * 100 : 0;
    const placementRate = apps > 0 ? placed.length / apps * 100 : 0;
    const avgPremium = apps > 0 ? totalPremium / apps : 0;
    const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
    const rpc = totalCalls > 0 ? totalLeadSpend / totalCalls : 0;
    const netRevenue = totalGAR - totalLeadSpend - totalComm;
    const premCost = totalLeadSpend > 0 ? totalPremium / totalLeadSpend : 0;

    // ─── CALLS BY SOURCE ───
    const callsBySource = {};
    const billableBySource = {};
    calls.forEach(c => {
      const src = c.campaign || 'Unknown';
      callsBySource[src] = (callsBySource[src] || 0) + 1;
      if (c.isBillable) billableBySource[src] = (billableBySource[src] || 0) + 1;
    });

    // ─── AGENT DIALER PERFORMANCE ───
    const agentPerf = perfData?.daily || perfData?.agents || [];

    // ─── AGENT DIALER ALERTS ───
    const agentAlerts = [];
    (perfData?.daily || []).forEach(a => {
      if (a.availPct != null && a.availPct < 70) {
        agentAlerts.push({ metric: 'Availability', agent: a.rep, actual: a.availPct, goal: 70, status: a.availPct < 50 ? 'red' : 'yellow', unit: '%' });
      }
      if (a.pausePct != null && a.pausePct > 30) {
        agentAlerts.push({ metric: 'Pause Time', agent: a.rep, actual: a.pausePct, goal: 30, status: a.pausePct > 50 ? 'red' : 'yellow', unit: '%', lower: true });
      }
    });

    // ─── SNAPSHOT WRITE (daily mode only, single-day requests) ───
    if (mode === 'daily' && startDate === endDate) {
      try {
        const metricsForSnap = {
          apps, placed: placed.length, totalCalls, billable, billableRate,
          totalPremium, totalGAR, totalLeadSpend, totalComm, netRevenue,
          cpa, rpc, closeRate, placementRate, premCost, avgPremium,
        };
        const companyRow = buildCompanyRow(startDate, metricsForSnap);
        const agentRows = buildAgentRows(startDate, byAgent, agentPerf);
        const campaignRows = buildCampaignRows(startDate, byCampaign);
        await writeSnapshots(startDate, companyRow, agentRows, campaignRows);
        console.log(`[daily-summary] Wrote snapshots for ${startDate}`);
      } catch (e) {
        console.warn('[daily-summary] Snapshot write failed:', e.message);
      }
    }

    // ─── HISTORICAL BASELINES (daily mode only, single-day requests) ───
    let baselines = { company: {}, topAgents: [], topCampaigns: [] };
    let baselineBlock = '';
    if (mode === 'daily' && startDate === endDate) {
      try {
        const asOf = startDate;
        const companyMetrics = ['apps','placed','calls','billable','premium','gar','leadSpend','commission','netRevenue','cpa','rpc','closeRate','placementRate','billableRate','avgPremium','premCost'];
        for (const m of companyMetrics) {
          const series = await readCompanySeries(asOf, m);
          baselines.company[m] = computeBaseline(series);
        }

        // Top 5 agents today by premium
        const topAgentNames = Object.entries(byAgent)
          .sort((a, b) => (b[1].premium || 0) - (a[1].premium || 0))
          .slice(0, 5)
          .map(([n]) => n);
        const agentMetrics = ['apps','premium','gar','availPct','talkTimeSec','salesPerHour'];
        for (const name of topAgentNames) {
          const bl = {};
          for (const m of agentMetrics) {
            const s = await readAgentSeries(asOf, name, m);
            bl[m] = computeBaseline(s);
          }
          baselines.topAgents.push({ agent: name, baseline: bl });
        }

        // Top 8 campaigns today by spend
        const topCampaignCodes = Object.entries(byCampaign)
          .sort((a, b) => (b[1].spend || 0) - (a[1].spend || 0))
          .slice(0, 8)
          .map(([c]) => c);
        const campaignMetricsList = ['calls','billable','spend','sales','premium','gar','cpa','rpc','closeRate','netRevenue'];
        for (const code of topCampaignCodes) {
          const bl = {};
          for (const m of campaignMetricsList) {
            const s = await readCampaignSeries(asOf, code, m);
            bl[m] = computeBaseline(s);
          }
          baselines.topCampaigns.push({ campaign: code, baseline: bl });
        }

        baselineBlock = buildBaselineBlock(baselines);
      } catch (e) {
        console.warn('[daily-summary] Baseline compute failed:', e.message);
      }
    }

    // ─── COMPANY ALERTS (after baselines so anomaly signal is available) ───
    const companyAlerts = computeAlerts({
      apps, placed: placed.length, totalCalls, billable, billableRate,
      totalPremium, totalGAR, totalLeadSpend, totalComm, netRevenue,
      cpa, rpc, closeRate, placementRate, premCost, avgPremium,
    }, cg, cm, baselines.company);

    const allAlerts = [...companyAlerts, ...agentAlerts];

    // ─── TABLE 1: DAILY OVERVIEW (metrics x days) ───
    const allDates = [...new Set([...calls.map(c => c.date), ...policies.map(p => p.submitDate)])].filter(Boolean).sort();
    const dailyOverview = {};
    allDates.forEach(d => {
      const dayCalls = calls.filter(c => c.date === d);
      const dayPolicies = policies.filter(p => p.submitDate === d);
      const dayPlaced = dayPolicies.filter(isPlaced);
      const dayBillable = dayCalls.filter(c => c.isBillable).length;
      const daySpend = pnl.reduce((s, p) => {
        const pubCalls = dayCalls.filter(c => c.campaign === p.campaign);
        const pubBillable = pubCalls.filter(c => c.isBillable).length;
        return s + pubBillable * (p.pricePerCall || 0);
      }, 0);
      const dayGAR = dayPolicies.reduce((s, p) => s + (p.grossAdvancedRevenue || 0), 0);
      const dayComm = dayPolicies.reduce((s, p) => s + (p.commission || 0), 0);
      const dayVA = vaCalls.filter(c => c.date === d);
      const dayVATransfers = dayVA.filter(c => c.transferConfirmation).length;

      const dayPrem = dayPolicies.reduce((s, p) => s + (p.premium || 0), 0);

      // Agent availability & talk time for this day
      const dayPerf = agentPerf.filter(a => a.date === d);
      const totalLoggedIn = dayPerf.reduce((s, a) => s + (a.loggedIn || 0), 0);
      const totalAvailable = dayPerf.reduce((s, a) => s + (a.available || 0), 0);
      const totalTalkTime = dayPerf.reduce((s, a) => s + (a.talkTime || 0), 0);
      const agentCount = dayPerf.length;

      dailyOverview[d] = {
        agentCount,
        availPct: totalLoggedIn > 0 ? (totalAvailable / totalLoggedIn * 100) : 0,
        talkTimeSec: totalTalkTime,
        loggedInSec: totalLoggedIn,
        salesPerAgent: agentCount > 0 ? dayPolicies.length / agentCount : 0,
        calls: dayCalls.length,
        sales: dayPolicies.length,
        billables: dayBillable,
        billableRate: dayCalls.length > 0 ? (dayBillable / dayCalls.length * 100) : 0,
        premium: dayPrem,
        spend: daySpend,
        gar: dayGAR,
        commission: dayComm,
        nar: dayGAR - daySpend - dayComm,
        cpa: dayPolicies.length > 0 ? daySpend / dayPolicies.length : 0,
        rpc: dayCalls.length > 0 ? daySpend / dayCalls.length : 0,
        closeRate: dayBillable > 0 ? (dayPolicies.length / dayBillable * 100) : 0,
        vaCalls: dayVA.length,
        vaTransfers: dayVATransfers,
        vaTransferRate: dayVA.length > 0 ? (dayVATransfers / dayVA.length * 100) : 0,
        avgPremium: dayPolicies.length > 0 ? dayPrem / dayPolicies.length : 0,
      };
    });

    // ─── TABLE 3: CARRIER BREAKDOWN ───
    const carrierMap = {};
    policies.forEach(p => {
      const c = p.carrier || 'Unknown';
      if (!carrierMap[c]) carrierMap[c] = { sales: 0, placed: 0, premium: 0, gar: 0, commission: 0 };
      carrierMap[c].sales++;
      carrierMap[c].premium += p.premium || 0;
      carrierMap[c].gar += p.grossAdvancedRevenue || 0;
      carrierMap[c].commission += p.commission || 0;
      if (isPlaced(p)) { carrierMap[c].placed++; }
    });
    // Add call/billable data per carrier via the pnl agent breakdown
    const byCarrier = Object.entries(carrierMap).map(([name, c]) => ({
      carrier: name, sales: c.sales, premium: c.premium, gar: c.gar, commission: c.commission,
      cpa: c.sales > 0 ? totalLeadSpend * (c.sales / apps) / c.sales : 0,
      rpc: totalCalls > 0 ? totalLeadSpend * (c.sales / apps) / totalCalls : 0,
      conversionRate: billable > 0 ? c.sales / billable * 100 : 0,
      premCost: totalLeadSpend > 0 ? c.premium / (totalLeadSpend * (c.sales / apps || 1)) : 0,
    }));

    // ─── TABLE 5: POLICY STATUS PIPELINE ───
    const statusGroups = {};
    policies.forEach(p => {
      const d = p.submitDate || 'Unknown';
      const status = p.placed || p.outcome || 'Unknown';
      if (!statusGroups[d]) statusGroups[d] = {};
      if (!statusGroups[d][status]) statusGroups[d][status] = { count: 0, amount: 0 };
      statusGroups[d][status].count++;
      statusGroups[d][status].amount += p.premium || 0;
    });
    // Get all unique statuses
    const allStatuses = [...new Set(policies.map(p => p.placed || p.outcome || 'Unknown'))].sort();

    // ─── BUILD NARRATIVE CONTEXT ───
    const liveContext = `DAILY SUMMARY DATA for ${date}:
SALES: ${apps} apps submitted
FINANCIALS: CPA $${cpa.toFixed(2)}, GAR $${totalGAR.toFixed(0)}, Net Revenue $${netRevenue.toFixed(0)}, Lead Spend $${totalLeadSpend.toFixed(0)}, Commission $${totalComm.toFixed(0)}, Avg Premium $${avgPremium.toFixed(2)}, Prem:Cost ${premCost.toFixed(2)}x
CALLS: ${totalCalls} total, ${billable} billable (${billableRate.toFixed(1)}%), Close Rate ${closeRate.toFixed(1)}%
AGENTS: ${Object.entries(byAgent).map(([n, a]) => `${n}: ${a.apps} apps, $${a.premium.toFixed(0)} premium, $${a.gar.toFixed(0)} GAR, $${a.commission.toFixed(0)} commission`).join('; ')}
PUBLISHERS: ${Object.entries(byCampaign).map(([n, c]) => `${n}: ${c.calls} calls, ${c.billable} billable (${c.billableRate.toFixed(1)}%), $${c.spend.toFixed(0)} spend, RPC $${c.rpc.toFixed(2)}, CPA $${c.cpa.toFixed(0)}, ${c.placed || 0} sales, $${(c.premium || 0).toFixed(0)} premium, $${(c.gar || 0).toFixed(0)} GAR`).join('; ')}
CARRIERS: ${byCarrier.map(c => `${c.carrier}: ${c.sales} sales, $${c.premium.toFixed(0)} premium, $${c.gar.toFixed(0)} GAR, Conv ${c.conversionRate.toFixed(1)}%`).join('; ')}
ALERTS: ${allAlerts.length === 0 ? 'All metrics on target' : allAlerts.map(a => `${a.agent ? a.agent + ' ' : ''}${a.metric}: ${typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual} vs goal ${a.goal} (${a.status.toUpperCase()})`).join('; ')}
${agentPerf.length > 0 ? 'AGENT DIALER: ' + agentPerf.map(a => `${a.rep}: avail ${a.availPct?.toFixed(1) || '?'}%, pause ${a.pausePct?.toFixed(1) || '?'}%, logged in ${a.loggedInStr || '?'}, talk time ${a.talkTimeStr || '?'}, ${a.dialed || 0} dials, ${a.connects || 0} connects`).join('; ') : ''}
${baselineBlock ? '\n' + baselineBlock : ''}`;

    // ─── LOAD AI ANALYSIS RULES ───
    let aiRules = {};
    try {
      const rulesRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.AI_RULES_TAB || 'AI Analysis Rules', 1800
      );
      rulesRaw.forEach(r => {
        const table = (r['Table'] || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (table) {
          aiRules[table] = {
            focusOn: (r['Focus On'] || '').trim(),
            ignore: (r['Ignore'] || '').trim(),
            context: (r['Context'] || '').trim(),
          };
        }
      });
    } catch (e) { /* no rules tab yet — use defaults */ }

    // Map table keys to rule keys (flexible matching)
    const ruleMap = {
      dailyOverview: aiRules['daily_overview'] || aiRules['dailyoverview'] || aiRules['daily'] || {},
      publishers: aiRules['publisher_performance'] || aiRules['publishers'] || aiRules['publisher'] || {},
      carriers: aiRules['carrier_breakdown'] || aiRules['carriers'] || aiRules['carrier'] || {},
      agents: aiRules['agent_activity'] || aiRules['agents'] || aiRules['agent'] || {},
      pipeline: aiRules['policy_status_pipeline'] || aiRules['pipeline'] || aiRules['policy_pipeline'] || aiRules['policy_status'] || {},
    };

    // Build per-table rule instructions
    function buildRulePrompt(key, defaultFocus) {
      const rule = ruleMap[key] || {};
      let prompt = '';
      if (rule.focusOn) prompt += `FOCUS ON: ${rule.focusOn}\n`;
      else if (defaultFocus) prompt += `FOCUS ON: ${defaultFocus}\n`;
      if (rule.ignore) prompt += `IGNORE: ${rule.ignore}\n`;
      if (rule.context) prompt += `CONTEXT: ${rule.context}\n`;
      return prompt;
    }

    // Build thresholds string from company goals
    const thresholds = Object.entries(cg)
      .filter(([_, v]) => v > 0)
      .map(([k, v]) => {
        const meta = cm[k] || {};
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const dir = meta.lower ? '↓ lower is better' : '↑ higher is better';
        return `${label}: ${v} (${dir})`;
      })
      .join(', ');

    // ─── AI NARRATIVE + TABLE SUMMARIES (cached in Google Sheet) ───
    let narrative = '';
    let tableSummaries = {};
    const cacheKey = `${startDate}|${endDate}`;
    const cacheSheetId = process.env.GOALS_SHEET_ID;

    // Check cache first
    let cacheHit = false;
    if (cacheSheetId) {
      try {
        const cached = await fetchSheet(cacheSheetId, AI_CACHE_TAB, 300);
        const row = cached.find(r => r['Date'] === cacheKey && r['Mode'] === mode);
        if (row && row['Narrative']) {
          narrative = row['Narrative'];
          try { tableSummaries = JSON.parse(row['TableSummaries'] || '{}'); } catch { tableSummaries = {}; }
          cacheHit = true;
          console.log(`[daily-summary] AI cache hit for ${cacheKey} (${mode})`);
        }
      } catch (e) {
        // Tab might not exist yet — will be created on first write
        console.log('[daily-summary] AI cache tab not found, will generate fresh analysis');
      }
    }

    // Generate via OpenAI only if not cached
    if (!cacheHit) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0.4,
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content: `You are a senior insurance call center performance analyst. Your job is to uncover WHAT DRIVES the highest sales, GAR, and Net Revenue — not just describe the numbers.

ALWAYS answer the question: "WHY did the best days/agents/publishers perform well, and what can we replicate?"

COMPANY GOAL THRESHOLDS:
${thresholds || 'No thresholds configured'}
Sales per Agent goal: 2.5/day. Commission goal: 30% of GAR.

ANALYSIS RULES:
- Do NOT just restate numbers. Identify CAUSES and CORRELATIONS.
- Use the COMPANY/AGENT/CAMPAIGN BASELINES block: always compare today to avg7/avg30, call out z-scores, and flag "best/worst in 14" events.
- When a day had high sales, explain what was different using the baseline deltas (more agents available vs their 30-day norm? a campaign spiked conversion vs its avg30?).
- When a day was weak, explain what broke down in baseline terms (which agent's availability dropped vs their norm; which campaign went from producing to burning cash).
- Prefer percentage deltas vs avg30 ("CPA 27% worse than 30-day avg") over raw numbers alone.
- Be specific: name the agent or campaign, cite today's value and the baseline comparator.
- Do NOT mention "policies placed" or "placement rate."
- Return ONLY valid JSON — no markdown, no code fences, no extra text.`,
            },
            {
              role: 'user',
              content: `Analyze this ${mode === 'weekly' ? 'weekly' : 'daily'} performance data. Focus on uncovering what DRIVES the highest sales, GAR, and NAR.

${liveContext}

For each section, follow the analysis rules AND answer the driving question.

DAILY OVERVIEW — What made the best day(s) the best? What broke down on weak days? Correlate agent availability, talk time, billable calls, and conversion rate to sales output. Relate today's values to avg7/avg30; call out any z > 1.5 or best/worst-in-14. 3-4 sentences.
${buildRulePrompt('dailyOverview', 'Correlate availability and talk time to sales. Identify the best and worst days and explain WHY.')}

PUBLISHER PERFORMANCE — Which publishers are actually producing sales and revenue? Which are burning spend with nothing to show? What is the ROI by publisher? Identify each campaign's delta vs its own avg30. A campaign producing above its norm is worth scaling; one spending above its norm with sales below its norm is bleeding. 3-4 sentences.
${buildRulePrompt('publishers', 'Identify which publishers drive sales vs which just drive spend. Calculate effective ROI. Flag any with high spend and zero sales.')}

CARRIER BREAKDOWN — Which carriers convert best? Which generate the most GAR per sale? Are we leaning on the right carriers? 2-3 sentences.
${buildRulePrompt('carriers', 'Identify which carriers produce the best economics (highest GAR, best conversion). Flag carriers with poor conversion rates.')}

AGENT ACTIVITY — Who is the top producer and why? Who is underperforming relative to their availability? Is there a correlation between talk time and sales? For each top agent, compare today's apps/premium/availPct to their avg30. Flag agents having a materially worse day than their own baseline. 3-4 sentences.
${buildRulePrompt('agents', 'Rank agents by productivity (sales per hour available). Correlate talk time and availability to output. Flag agents with high availability but low sales.')}

POLICY STATUS PIPELINE — What does the status mix tell us about lead quality and agent effectiveness? 2-3 sentences.
${buildRulePrompt('pipeline', 'Analyze the ratio of statuses. High declined = quality issue. High pending = either new or stalled.')}

Return ONLY a JSON object:
{
  "executive": "3-4 sentence executive summary focused on what drove the best results and what held us back. Be specific and actionable.",
  "dailyOverview": "3-4 sentences answering: what drove the best day vs the worst day?",
  "publishers": "3-4 sentences on publisher ROI — who produces vs who burns cash.",
  "carriers": "2-3 sentences on carrier economics and conversion.",
  "agents": "3-4 sentences on agent productivity — who converts and why.",
  "pipeline": "2-3 sentences on what the status mix reveals."
}`,
            },
          ],
        });

        const rawText = completion.choices[0]?.message?.content || '';
        try {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            narrative = parsed.executive || '';
            tableSummaries = {
              dailyOverview: parsed.dailyOverview || '',
              publishers: parsed.publishers || '',
              carriers: parsed.carriers || '',
              agents: parsed.agents || '',
              pipeline: parsed.pipeline || '',
            };
          } else {
            narrative = rawText;
          }
        } catch (parseErr) {
          console.warn('[daily-summary] JSON parse failed, using raw text:', parseErr.message);
          narrative = rawText;
        }

        // Save to cache (fire-and-forget)
        if (cacheSheetId && narrative) {
          (async () => {
            try {
              // Ensure tab exists
              const sheets = await getSheetsClient();
              try {
                await sheets.spreadsheets.batchUpdate({
                  spreadsheetId: cacheSheetId,
                  requestBody: { requests: [{ addSheet: { properties: { title: AI_CACHE_TAB } } }] },
                });
                await sheets.spreadsheets.values.update({
                  spreadsheetId: cacheSheetId, range: `'${AI_CACHE_TAB}'!A1`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [AI_CACHE_HEADERS] },
                });
                console.log(`[daily-summary] Created ${AI_CACHE_TAB} tab`);
              } catch (e) {
                if (!e.message?.includes('already exists')) throw e;
              }
              await appendRow(cacheSheetId, AI_CACHE_TAB, AI_CACHE_HEADERS, {
                'Date': cacheKey,
                'Mode': mode,
                'Narrative': narrative,
                'TableSummaries': JSON.stringify(tableSummaries),
                'GeneratedAt': new Date().toISOString(),
              });
              console.log(`[daily-summary] Cached AI analysis for ${cacheKey} (${mode})`);
            } catch (e) {
              console.warn('[daily-summary] Failed to cache AI analysis:', e.message);
            }
          })();
        }
      } catch (e) {
        console.warn('[daily-summary] AI narrative generation failed:', e.message);
      }
    }

    return NextResponse.json({
      date,
      startDate,
      endDate,
      mode,
      sales: {
        total: apps,
        placed: placed.length,
        byAgent,
        byCampaign,
      },
      financials: {
        cpa, gar: totalGAR, netRevenue, leadSpend: totalLeadSpend,
        commission: totalComm, totalPremium, avgPremium, premCost,
        closeRate, placementRate, billableRate, rpc,
      },
      calls: {
        total: totalCalls,
        billable,
        billableRate,
        bySource: callsBySource,
        billableBySource,
      },
      agentPerf,
      alerts: allAlerts,
      narrative,
      tableSummaries,
      baselines,
      // Table data
      dailyOverview,
      byCarrier,
      statusPipeline: { byDate: statusGroups, statuses: allStatuses },
      vaStats: {
        totalCalls: vaCalls.length,
        transfers: vaCalls.filter(c => c.transferConfirmation).length,
        transferRate: vaCalls.length > 0 ? vaCalls.filter(c => c.transferConfirmation).length / vaCalls.length * 100 : 0,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[daily-summary] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
