import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const goals = { company: {}, agents: {} };

    // Try loading Company Goals tab
    try {
      const companyRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.COMPANY_GOALS_TAB || 'Company Daily Goals'
      );
      // Expect rows like: { Metric: "CPA", Value: "250" }
      companyRaw.forEach(r => {
        const rawKey = (r['Metric'] || r['Goal'] || r['Name'] || '').trim();
        const rawVal = (r['Value'] || r['Target'] || '0').replace(/[$,%x]/g, '');
        const val = parseFloat(rawVal) || 0;
        if (!rawKey || !val) return;
        const key = rawKey.toLowerCase().replace(/[:/]+/g, '_').replace(/[\s/]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        goals.company[key] = val;
      });
    } catch (e) {
      console.log('[goals] Company Goals tab not found:', e.message);
    }

    // Alias mapping: support both old camelCase sheet values and new snake_case keys
    const aliases = {
      conversionrate: 'close_rate', conversion_rate: 'close_rate',
      placementrate: 'placement_rate', closerate: 'close_rate',
      billablerate: 'billable_rate', avgpremium: 'avg_premium',
      avg_prem: 'avg_premium', monthlypremium: 'monthly_premium',
      premium_target: 'monthly_premium', premiumtarget: 'monthly_premium',
      grossadvrevenue: 'gross_adv_revenue', gross_advanced_revenue: 'gross_adv_revenue',
      agentcommission: 'agent_commission', netrevenue: 'net_revenue',
      leadspend: 'lead_spend', totalcalls: 'total_calls',
      billablecalls: 'billable_calls', appssubmitted: 'apps_submitted',
      apps_per_day: 'apps_submitted', policiesplaced: 'policies_placed',
      policies_per_day: 'policies_placed', premiumcost: 'premium_cost_ratio',
      premium_cost: 'premium_cost_ratio', 'premium:cost': 'premium_cost_ratio',
    };
    // Apply aliases
    Object.entries(goals.company).forEach(([k, v]) => {
      const normalized = k.replace(/_/g, '');
      if (aliases[k] && !goals.company[aliases[k]]) goals.company[aliases[k]] = v;
      if (aliases[normalized] && !goals.company[aliases[normalized]]) goals.company[aliases[normalized]] = v;
    });

    // Fallback defaults for any missing goals
    const defaults = {
      cpa: 250, rpc: 35, close_rate: 5, placement_rate: 80, billable_rate: 65,
      avg_premium: 70, apps_submitted: 5, policies_placed: 3, total_calls: 50,
      billable_calls: 35, monthly_premium: 500, gross_adv_revenue: 4000,
      lead_spend: 1500, agent_commission: 1000, net_revenue: 2000, premium_cost_ratio: 2.5,
    };
    Object.entries(defaults).forEach(([k, v]) => {
      if (!goals.company[k]) goals.company[k] = v;
    });

    // Try loading Agent Goals tab
    try {
      const agentRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.AGENT_GOALS_TAB || 'Agent Daily Goals'
      );
      agentRaw.forEach(r => {
        const name = (r['Agent'] || r['Name'] || '').trim();
        if (!name) return;
        goals.agents[name] = {
          appsPerDay: parseFloat(r['Apps/Day'] || r['Apps Per Day'] || '0') || 0,
          premiumTarget: parseFloat((r['Premium Target'] || r['Premium'] || '0').replace(/[$,]/g, '')) || 0,
          closeRate: parseFloat((r['Close Rate'] || '0').replace('%', '')) || 0,
        };
      });
    } catch (e) {
      console.log('[goals] Agent Goals tab not found:', e.message);
    }

    return NextResponse.json(goals);
  } catch (error) {
    console.error('[goals] API error:', error);
    return NextResponse.json({ company: {}, agents: {} });
  }
}
