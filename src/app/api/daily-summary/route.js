import { NextResponse } from 'next/server';

const PLACED_STATUSES = ['Advance Released', 'Active - In Force', 'Submitted - Pending'];
const isPlaced = p => PLACED_STATUSES.includes(p.placed);

function getBaseUrl() {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:' + (process.env.PORT || 3003);
}

function getYesterday() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - 1);
  return et.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function computeAlerts(metrics, goals, companyMeta) {
  const alerts = [];
  const metricDefs = [
    { key: 'apps_submitted', label: 'Apps Submitted', actual: metrics.apps },
    { key: 'policies_placed', label: 'Policies Placed', actual: metrics.placed },
    { key: 'total_calls', label: 'Total Calls', actual: metrics.totalCalls },
    { key: 'billable_calls', label: 'Billable Calls', actual: metrics.billable },
    { key: 'billable_rate', label: 'Billable Rate', actual: metrics.billableRate, isRate: true },
    { key: 'monthly_premium', label: 'Monthly Premium', actual: metrics.totalPremium },
    { key: 'gross_adv_revenue', label: 'Gross Adv Revenue', actual: metrics.totalGAR },
    { key: 'lead_spend', label: 'Lead Spend', actual: metrics.totalLeadSpend },
    { key: 'agent_commission', label: 'Agent Commission', actual: metrics.totalComm },
    { key: 'net_revenue', label: 'Net Revenue', actual: metrics.netRevenue },
    { key: 'cpa', label: 'CPA', actual: metrics.cpa, isRate: true },
    { key: 'rpc', label: 'RPC', actual: metrics.rpc, isRate: true },
    { key: 'close_rate', label: 'Close Rate', actual: metrics.closeRate, isRate: true },
    { key: 'placement_rate', label: 'Placement Rate', actual: metrics.placementRate, isRate: true },
    { key: 'premium_cost_ratio', label: 'Premium:Cost', actual: metrics.premCost, isRate: true },
    { key: 'avg_premium', label: 'Avg Premium', actual: metrics.avgPremium, isRate: true },
  ];

  for (const m of metricDefs) {
    const goal = goals[m.key];
    if (!goal || !m.actual) continue;
    const meta = companyMeta[m.key] || {};
    const lower = meta.lower || false;
    const yellowPct = (meta.yellow || 80) / 100;
    const ratio = lower ? goal / m.actual : m.actual / goal;

    if (ratio < yellowPct) {
      alerts.push({ metric: m.label, actual: m.actual, goal, status: 'red', lower });
    } else if (ratio < 1) {
      alerts.push({ metric: m.label, actual: m.actual, goal, status: 'yellow', lower });
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

    // Fetch all data in parallel
    const [dashRes, perfRes, goalsRes] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard?start=${startDate}&end=${endDate}&source=${source}`),
      fetch(`${baseUrl}/api/agent-performance?start=${startDate}&end=${endDate}`).catch(() => null),
      fetch(`${baseUrl}/api/goals`),
    ]);

    if (!dashRes.ok) throw new Error(`Dashboard API: ${dashRes.status}`);
    if (!goalsRes.ok) throw new Error(`Goals API: ${goalsRes.status}`);

    const dashData = await dashRes.json();
    const goalsData = await goalsRes.json();
    const perfData = perfRes?.ok ? await perfRes.json() : null;

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
      byAgent[p.agent].gar += p.grossAdvancedRevenue || 0;
      if (isPlaced(p)) {
        byAgent[p.agent].placed++;
        byAgent[p.agent].premium += p.premium || 0;
        byAgent[p.agent].commission += p.commission || 0;
      }
    });

    const byCampaign = {};
    pnl.forEach(p => {
      byCampaign[p.campaign] = {
        vendor: p.vendor,
        calls: p.totalCalls,
        billable: p.billableCalls,
        billableRate: p.totalCalls > 0 ? (p.billableCalls / p.totalCalls * 100) : 0,
        spend: p.leadSpend,
        placed: p.placedCount,
        premium: p.totalPremium,
        rpc: p.totalCalls > 0 ? p.leadSpend / p.totalCalls : 0,
        cpa: p.placedCount > 0 ? p.leadSpend / p.placedCount : 0,
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

    // ─── COMPANY ALERTS ───
    const companyAlerts = computeAlerts({
      apps, placed: placed.length, totalCalls, billable, billableRate,
      totalPremium, totalGAR, totalLeadSpend, totalComm, netRevenue,
      cpa, rpc, closeRate, placementRate, premCost, avgPremium,
    }, cg, cm);

    const allAlerts = [...companyAlerts, ...agentAlerts];

    // ─── BUILD NARRATIVE CONTEXT ───
    const liveContext = `DAILY SUMMARY DATA for ${date}:
SALES: ${apps} apps submitted, ${placed.length} placed
FINANCIALS: CPA $${cpa.toFixed(2)}, GAR $${totalGAR.toFixed(0)}, Net Revenue $${netRevenue.toFixed(0)}, Lead Spend $${totalLeadSpend.toFixed(0)}, Commission $${totalComm.toFixed(0)}, Avg Premium $${avgPremium.toFixed(2)}
CALLS: ${totalCalls} total, ${billable} billable (${billableRate.toFixed(1)}%)
AGENTS: ${Object.entries(byAgent).map(([n, a]) => `${n}: ${a.apps} apps, ${a.placed} placed, $${a.premium.toFixed(0)} premium`).join('; ')}
PUBLISHERS: ${Object.entries(byCampaign).map(([n, c]) => `${n}: ${c.calls} calls, ${c.billable} billable, $${c.spend.toFixed(0)} spend, RPC $${c.rpc.toFixed(2)}`).join('; ')}
ALERTS: ${allAlerts.length === 0 ? 'All metrics on target' : allAlerts.map(a => `${a.agent ? a.agent + ' ' : ''}${a.metric}: ${typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual} vs goal ${a.goal} (${a.status.toUpperCase()})`).join('; ')}
${agentPerf.length > 0 ? 'AGENT DIALER: ' + agentPerf.map(a => `${a.rep}: avail ${a.availPct?.toFixed(1) || '?'}%, pause ${a.pausePct?.toFixed(1) || '?'}%, logged in ${a.loggedInStr || '?'}`).join('; ') : ''}`;

    // ─── GENERATE AI NARRATIVE ───
    let narrative = '';
    try {
      const aiRes = await fetch(`${baseUrl}/api/ai-analyst`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: mode === 'weekly'
            ? `Give me a complete executive summary of last week's performance (${startDate} to ${endDate}). Cover total sales, top agents, financials, call activity trends across the week, agent performance patterns, and flag any concerns or improvements. Compare early vs late week if notable. Be thorough but conversational.`
            : `Give me a complete executive summary of yesterday's performance. Cover sales, financials, call activity, agent performance, and flag any concerns. Be thorough but conversational.`,
          tab: 'daily',
          voiceMode: true,
          liveData: liveContext,
        }),
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        narrative = aiData.spokenText || aiData.answer || '';
      }
    } catch (e) {
      console.warn('[daily-summary] AI narrative generation failed:', e.message);
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
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[daily-summary] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
