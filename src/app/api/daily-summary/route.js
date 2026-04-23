import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { fetchSheet, appendRow, getSheetsClient } from '@/lib/sheets';
import {
  buildCompanyRow, buildAgentRows, buildCampaignRows, writeSnapshots,
  readCompanySeries, readAgentSeries, readCampaignSeries,
} from '@/lib/snapshots';
import { computeBaseline, buildBaselineBlock } from '@/lib/baselines';
import { fetchAgentDeepDive } from '@/lib/conversely-api';

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
    const forceRegen = searchParams.get('force') === '1';
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
      const totalPaused = dayPerf.reduce((s, a) => s + (a.paused || 0), 0);
      const agentCount = dayPerf.length;

      dailyOverview[d] = {
        agentCount,
        availPct: totalLoggedIn > 0 ? (totalAvailable / totalLoggedIn * 100) : 0,
        talkTimeSec: totalTalkTime,
        loggedInSec: totalLoggedIn,
        pausedSec: totalPaused,
        pausePct: totalLoggedIn > 0 ? (totalPaused / totalLoggedIn * 100) : 0,
        appsPerTalkHour: totalTalkTime > 0 ? (dayPolicies.length / (totalTalkTime / 3600)) : 0,
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

    // ─── AGENT DEEP DIVE (Conversely agent 41, per-agent qualitative analysis) ───
    // Request the run matching our report date when possible; fall back to latest.
    let agentDeepDive = null;
    if (mode === 'daily' && startDate === endDate) {
      try {
        let bundle = await fetchAgentDeepDive({ runDate: startDate });
        if (!bundle || !bundle.entities?.length) {
          bundle = await fetchAgentDeepDive();
        }
        if (bundle && bundle.entities?.length) {
          agentDeepDive = {
            runDate: bundle.runDate,
            dataStartDate: bundle.dataStartDate,
            dataEndDate: bundle.dataEndDate,
            entityLabel: bundle.entityLabel,
            entities: bundle.entities.map(e => ({
              name: e.entityName,
              content: e.resultMessage,
            })),
          };
        }
      } catch (e) {
        console.warn('[daily-summary] Agent deep dive fetch failed:', e.message);
      }
    }

    const deepDiveBlock = agentDeepDive
      ? `\nAGENT DEEP DIVE (run ${agentDeepDive.runDate || '?'}, ${agentDeepDive.entities.length} agents):\n` +
        agentDeepDive.entities.map(e => {
          // Keep per-agent summary compact (first ~600 chars) for the LLM prompt.
          const snippet = (e.content || '').replace(/\s+/g, ' ').trim().slice(0, 600);
          return `- ${e.name}: ${snippet}${(e.content || '').length > 600 ? '…' : ''}`;
        }).join('\n')
      : '';

    // ─── BUILD NARRATIVE CONTEXT ───
    const liveContext = `DAILY SUMMARY DATA for ${date}:
SALES: ${apps} apps submitted${(() => {
  const totalTalkSec = agentPerf.reduce((s, a) => s + (a.talkTime || 0), 0);
  const apph = totalTalkSec > 0 ? (apps / (totalTalkSec / 3600)).toFixed(2) : '0.00';
  return ` (${apph} apps/talk-hour)`;
})()}
FINANCIALS: CPA $${cpa.toFixed(2)}, GAR $${totalGAR.toFixed(0)}, Net Revenue $${netRevenue.toFixed(0)}, Lead Spend $${totalLeadSpend.toFixed(0)}, Commission $${totalComm.toFixed(0)}, Avg Premium $${avgPremium.toFixed(2)}, Prem:Cost ${premCost.toFixed(2)}x
CALLS: ${totalCalls} total, ${billable} billable (${billableRate.toFixed(1)}%), Close Rate ${closeRate.toFixed(1)}%
AGENTS: ${Object.entries(byAgent).map(([n, a]) => `${n}: ${a.apps} apps, $${a.premium.toFixed(0)} premium, $${a.gar.toFixed(0)} GAR, $${a.commission.toFixed(0)} commission`).join('; ')}
PUBLISHERS: ${Object.entries(byCampaign).map(([n, c]) => `${n}: ${c.calls} calls, ${c.billable} billable (${c.billableRate.toFixed(1)}%), $${c.spend.toFixed(0)} spend, RPC $${c.rpc.toFixed(2)}, CPA $${c.cpa.toFixed(0)}, ${c.placed || 0} sales, $${(c.premium || 0).toFixed(0)} premium, $${(c.gar || 0).toFixed(0)} GAR`).join('; ')}
CARRIERS: ${byCarrier.map(c => `${c.carrier}: ${c.sales} sales, $${c.premium.toFixed(0)} premium, $${c.gar.toFixed(0)} GAR, Conv ${c.conversionRate.toFixed(1)}%`).join('; ')}
ALERTS: ${allAlerts.length === 0 ? 'All metrics on target' : allAlerts.map(a => `${a.agent ? a.agent + ' ' : ''}${a.metric}: ${typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual} vs goal ${a.goal} (${a.status.toUpperCase()})`).join('; ')}
${agentPerf.length > 0 ? 'AGENT DIALER: ' + agentPerf.map(a => `${a.rep}: avail ${a.availPct?.toFixed(1) || '?'}%, pause ${a.pausePct?.toFixed(1) || '?'}%, logged in ${a.loggedInStr || '?'}, talk time ${a.talkTimeStr || '?'}, ${a.dialed || 0} dials, ${a.connects || 0} connects`).join('; ') : ''}
VIRTUAL AGENT: ${vaCalls.length} calls, ${vaCalls.filter(c => c.transferConfirmation).length} transfers (${vaCalls.length > 0 ? ((vaCalls.filter(c => c.transferConfirmation).length / vaCalls.length) * 100).toFixed(1) : '0.0'}% transfer rate)
${baselineBlock ? '\n' + baselineBlock : ''}${deepDiveBlock}`;

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
    if (cacheSheetId && !forceRegen) {
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
- For dailyOverview, write SIX separate section summaries, each focused ONLY on the metrics named in its sub-prompt. Do NOT repeat the same fact in multiple sections. If the avg30 baseline is null for a metric, say "insufficient history" rather than inventing a comparison.
- Return ONLY valid JSON — no markdown, no code fences, no extra text.`,
            },
            {
              role: 'user',
              content: `Analyze this ${mode === 'weekly' ? 'weekly' : 'daily'} performance data. Focus on uncovering what DRIVES the highest sales, GAR, and NAR.

${liveContext}

For each section, follow the analysis rules AND answer the driving question.

DAILY OVERVIEW — Write SIX short summaries, one per section of the Daily Overview table. Each is 1-3 sentences, grounded ONLY in the metrics listed for that section. Compare to avg7/avg30 when those baselines exist; say "insufficient history" when they do not.

  availability: Agents Logged In, Avg Availability, Total Talk Time, Total Logged In, Total Pause Time, Pause %.
    REQUIRED FRAMING for the availability section:
    1. LEAD WITH THE CONSTRAINT. If Agents Logged In is below the 7-day average (or below 3 when no baseline exists), the headline is understaffing — name it first, before any per-agent stats. Example opener: "Only N agent(s) logged in — staffing was the constraint today."
    2. ALWAYS COMPUTE UTILIZATION = Total Talk Time ÷ Total Logged In, expressed as a percentage. State it explicitly. Available-but-idle is wasted shift; flag <60% utilization as soft demand or routing failure, >85% as a capacity ceiling.
    3. ALWAYS REPORT PAUSE. State Total Pause Time and Pause % of logged-in time. Flag pause % above 30% as elevated and above 50% as a serious shift-discipline issue. Pause directly subtracts from available capacity, so a high pause % on an understaffed day compounds the constraint.
    4. CONNECT TO OUTCOMES in one clause. Low staffing → call capacity ceiling → sales ceiling. Low utilization → demand or routing problem. High utilization with low sales → execution problem. High pause + low staffing → magnified capacity loss. Pick the implied causal chain and state it.
    5. ALWAYS REFERENCE 30-DAY BASELINES. The COMPANY/AGENT/CAMPAIGN BASELINES block above carries avg7 and avg30 for agentCount, availPct, talkTimeSec, loggedInSec. For each number you cite, also state how it compares vs the 30d avg with a percentage delta (e.g., "1 agent logged in vs 30d avg of 3.2 = -69%"). If a baseline is null/missing, say "insufficient history" rather than omitting the comparison.
    6. BANNED FILLER (do not write any of these): "positive indicator", "agent engagement", "for broader context", "indicates", "strong" (without a comparator), "robust", "healthy" (without a number). Strip any sentence whose only purpose is to label something good or bad — every sentence must add a number, a comparison, or a causal claim.
  sales: Sales (Apps), Apps/Talk-Hour, Billable Calls, Conversion Rate, Total Premium, Avg Premium per App. Name top-producing agent(s).
    REQUIRED FRAMING for the sales section:
    1. LEAD WITH GOAL DELTA + PREMIUM. Open with apps vs goal as a percent (e.g., "4 apps vs 5 goal = -20%") AND total premium generated. Raw counts without goal context are noise.
    2. ALWAYS DECOMPOSE THE FUNNEL. Sales = Billable Calls × Close Rate. State which side was the constraint today: low billable + on-target close = supply problem (lead capacity). On-target billable + low close = execution problem (rep skill / qualification). Both low = compounded. Both high = the day worked.
    3. APPS/TALK-HOUR IS THE PRIMARY PRODUCTIVITY METRIC. Always state company-wide Apps/Talk-Hour and the top agent's individual figure. This isolates rep efficiency from how much time was on shift. Flag <0.5 as low, >1.5 as high.
    4. ECONOMICS TIE-IN. State Avg Premium per App. Flag if it dropped >10% vs 30d (suggests cherry-picking low-quality leads or product mix shift toward cheaper plans).
    5. ALWAYS REFERENCE 30-DAY BASELINES. The COMPANY/AGENT/CAMPAIGN BASELINES block above carries avg7 and avg30 for every metric (apps, billables, closeRate, premium, avgPremium, etc.). For each number you cite, also state how it compares vs 30d avg or 30d total — explicitly, with a percentage delta. Example: "billable calls 18 (-49% vs goal 35; -41% vs 30d avg of 31)." If a baseline is null/missing for that metric, say "insufficient history" rather than skipping the comparison.
    6. DO NOT FLAG NEAR-TARGET METRICS. A close rate within ±2 percentage points of goal is on-target — do NOT call it "below goal" or "potential for improvement."
    7. BANNED FILLER (do not write any of these): "indicating potential for improvement", "slightly below", "aligning with", "in line with", "consistent with expectations", "room for growth", "trending in the right direction". Strip any sentence whose only purpose is to label a metric good or bad — every sentence must add a number, ratio, or causal claim.
  calls: Total Calls, Billable Calls, Billable Rate, RPC. Identify the largest-volume publisher.
    REQUIRED FRAMING for the calls section:
    1. ALWAYS COMPARE TO GOAL FIRST. Goal billable rate is 65%. A billable rate below 65% is BELOW GOAL regardless of baseline trend — never call it "efficient", "strong", or "high efficiency" if it is below 65%. Frame as: "X% billable rate vs 65% goal (Y pp short)."
    2. NAME THE FUNNEL CHAIN. State the chain explicitly: Total Calls → Billable Calls → Apps with absolute numbers and conversion percentages. Example: "55 calls → 18 billable (33%) → 4 apps (22% close)." This anchors call volume in what it produced.
    3. TOP PUBLISHER ATTRIBUTION. Name the largest-volume publisher today (from the PUBLISHERS line in the data above), its share of total calls, and its billable rate. If campaign-level baselines are present, compare that publisher's billable rate to its own norm. If publisher baselines are missing, just compare to the company billable rate.
    4. DISAMBIGUATE % MATH. When stating a delta vs baseline, ALWAYS include both percentage-point and relative-percent. Example: "32.7% billable rate vs 17% 30d avg = +15.7 pp / +95% relative." Never write "X% above the 30-day average" without saying which.
    5. RPC TIE-IN. State today's RPC ($lead spend / total calls) and compare it to the 30d avg. RPC bridges call volume and cost — high RPC + low call volume = expensive small day; low RPC + high call volume = cheap scale.
    6. ALWAYS REFERENCE 30-DAY BASELINES on every cited number with explicit deltas (goal AND 30d). If a baseline is null/missing, say "insufficient history" rather than omitting the comparison.
    7. BANNED FILLER (do not write any of these): "high efficiency", "indicating efficiency", "strong" (without a comparator), "robust", "performing well" (without a number), "despite the low volume" (or any consolation phrasing for a below-goal metric). Every sentence must add a number, ratio, or causal claim.
  revenue: Premium, Gross Adv Revenue, Commission, Net Revenue. Compare each to its 30-day average.
  cost: Lead Spend, CPA, RPC, Avg Premium. Lead Spend / CPA / RPC are lower-is-better; compare each to its 30-day average.
  va: VA Calls, VA Transfers, VA Transfer Rate — use the exact numbers from the "VIRTUAL AGENT:" line in the data above. Describe call volume, transfer count, and transfer rate. Only write "Virtual agent had no meaningful activity today." when VIRTUAL AGENT shows 0 calls AND 0 transfers.

${buildRulePrompt('dailyOverview', 'Correlate availability and talk time to sales. Be specific per section and do not repeat facts across sections.')}

PUBLISHER PERFORMANCE — Which publishers are actually producing sales and revenue? Which are burning spend with nothing to show? What is the ROI by publisher? Identify each campaign's delta vs its own avg30. A campaign producing above its norm is worth scaling; one spending above its norm with sales below its norm is bleeding. 3-4 sentences.
${buildRulePrompt('publishers', 'Identify which publishers drive sales vs which just drive spend. Calculate effective ROI. Flag any with high spend and zero sales.')}

CARRIER BREAKDOWN — Which carriers convert best? Which generate the most GAR per sale? Are we leaning on the right carriers? 2-3 sentences.
${buildRulePrompt('carriers', 'Identify which carriers produce the best economics (highest GAR, best conversion). Flag carriers with poor conversion rates.')}

AGENT ACTIVITY — Who is the top producer and why? Who is underperforming relative to their availability? Is there a correlation between talk time and sales? For each top agent, compare today's apps/premium/availPct to their avg30. Flag agents having a materially worse day than their own baseline. If the AGENT DEEP DIVE block is present, weave in the qualitative observations (coaching, call quality, notable patterns) for the named agents — do NOT just restate the metrics. 3-4 sentences.
${buildRulePrompt('agents', 'Rank agents by productivity (sales per hour available). Correlate talk time and availability to output. Flag agents with high availability but low sales.')}

POLICY STATUS PIPELINE — What does the status mix tell us about lead quality and agent effectiveness? 2-3 sentences.
${buildRulePrompt('pipeline', 'Analyze the ratio of statuses. High declined = quality issue. High pending = either new or stalled.')}

Return ONLY a JSON object:
{
  "executive": "3-4 sentence executive summary focused on what drove the best results and what held us back. Be specific and actionable.",
  "dailyOverview": {
    "availability": "1-3 sentences on Agents Logged In, Avg Availability, Talk Time, Logged-in Time. Cite 30-day averages where available.",
    "sales": "1-3 sentences on Sales per Agent, Apps, Billable Calls, Conversion Rate. Name the top producer.",
    "calls": "1-3 sentences on Total Calls and Billable Rate vs 30-day averages.",
    "revenue": "1-3 sentences on Premium, GAR, Commission, Net Revenue each vs its 30-day average.",
    "cost": "1-3 sentences on Lead Spend, CPA, RPC, Avg Premium each vs its 30-day average.",
    "va": "1-2 sentences quoting today's VA Calls, VA Transfers, and VA Transfer Rate from the VIRTUAL AGENT line. Only use 'Virtual agent had no meaningful activity today.' if VA Calls is 0."
  },
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
            // dailyOverview can be an object (new format) or a string (legacy / model noncompliance)
            let dailyOverview = parsed.dailyOverview;
            if (dailyOverview && typeof dailyOverview === 'object') {
              const allowedKeys = ['availability', 'sales', 'calls', 'revenue', 'cost', 'va'];
              const cleaned = {};
              for (const k of allowedKeys) {
                if (typeof dailyOverview[k] === 'string') cleaned[k] = dailyOverview[k];
              }
              dailyOverview = cleaned;
            } else if (typeof dailyOverview !== 'string') {
              dailyOverview = '';
            }
            tableSummaries = {
              dailyOverview,
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
      agentDeepDive,
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
