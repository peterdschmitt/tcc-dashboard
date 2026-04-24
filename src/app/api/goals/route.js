export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const goals = { company: {}, companyMeta: {}, agents: {} };

    // Try loading Company Goals tab
    try {
      const companyRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.COMPANY_GOALS_TAB || 'Company Daily Goals'
      );
      companyRaw.forEach(r => {
        const rawKey = (r['Metric'] || r['Goal'] || r['Name'] || '').trim();
        const rawVal = (r['Daily Goal'] || r['Value'] || r['Target'] || '0').replace(/[$,%x]/g, '');
        const val = parseFloat(rawVal) || 0;
        if (!rawKey || !val) return;
        const key = rawKey.toLowerCase().replace(/[:/]+/g, '_').replace(/[\s/]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        goals.company[key] = val;

        // Read metadata columns
        const lowerRaw = (r['Lower is Better?'] || r['Lower Is Better'] || '').trim().toLowerCase();
        const isLower = ['yes', 'true', '1', 'y', 'x'].includes(lowerRaw);
        const yellowRaw = (r['Alert Threshold (Yellow)'] || r['Yellow Threshold'] || '').replace(/[%]/g, '');
        const yellowPct = parseFloat(yellowRaw) || 80;
        goals.companyMeta[key] = { lower: isLower, yellow: yellowPct };
      });
    } catch (e) {
      console.log('[goals] Company Goals tab not found:', e.message);
    }

    // Alias mapping
    const aliases = {
      conversionrate: 'close_rate', conversion_rate: 'close_rate',
      placementrate: 'placement_rate', closerate: 'close_rate',
      billablerate: 'billable_rate', avgpremium: 'avg_premium',
      avg_prem: 'avg_premium', monthlypremium: 'monthly_premium',
      premium_target: 'monthly_premium', premiumtarget: 'monthly_premium',
      grossadvrevenue: 'gross_adv_revenue', gross_advanced_revenue: 'gross_adv_revenue',
      agentcommission: 'agent_commission', netrevenue: 'net_revenue',
      effectuationrate: 'effectuation_rate', effectuation: 'effectuation_rate',
      effectuationenabled: 'effectuation_enabled', eff_rev: 'eff_revenue',
      effrevenue: 'eff_revenue',
      leadspend: 'lead_spend', totalcalls: 'total_calls',
      vacalls: 'va_calls', va_total_calls: 'va_calls',
      vatransfers: 'va_transfers', va_transfer: 'va_transfers',
      vatransferrate: 'va_transfer_rate', va_xfer_rate: 'va_transfer_rate',
      vasales: 'va_sales', va_sale: 'va_sales',
      vaconversionrate: 'va_conversion_rate', va_conv_rate: 'va_conversion_rate',
      billablecalls: 'billable_calls', appssubmitted: 'apps_submitted',
      apps_per_day: 'apps_submitted', policiesplaced: 'policies_placed',
      policies_per_day: 'policies_placed', premiumcost: 'premium_cost_ratio',
      premium_cost: 'premium_cost_ratio', 'premium:cost': 'premium_cost_ratio',
      revcost: 'premium_cost_ratio', rev_cost: 'premium_cost_ratio', 'rev:cost': 'premium_cost_ratio',
    };
    // Apply aliases to both company and companyMeta
    Object.entries(goals.company).forEach(([k, v]) => {
      const normalized = k.replace(/_/g, '');
      const target = aliases[k] || aliases[normalized];
      if (target && !goals.company[target]) {
        goals.company[target] = v;
        if (goals.companyMeta[k]) goals.companyMeta[target] = goals.companyMeta[k];
      }
    });

    // Fallback defaults
    const defaults = {
      cpa: 250, rpc: 35, close_rate: 5, placement_rate: 80, billable_rate: 65,
      avg_premium: 70, apps_submitted: 5, policies_placed: 3, total_calls: 50,
      billable_calls: 35, monthly_premium: 500, gross_adv_revenue: 4000,
      eff_revenue: 2800, // gross_adv_revenue * effectuation_rate (4000 * 0.70)
      lead_spend: 1500, agent_commission: 1000, net_revenue: 2000, premium_cost_ratio: 45,
      effectuation_rate: 70, effectuation_enabled: 1,
      va_calls: 100, va_transfers: 30, va_transfer_rate: 30,
      va_sales: 5, va_conversion_rate: 15,
    };
    // Default meta (lower-is-better and yellow threshold)
    const defaultMeta = {
      cpa: { lower: true, yellow: 80 }, rpc: { lower: true, yellow: 80 },
      lead_spend: { lower: true, yellow: 80 },
      close_rate: { lower: false, yellow: 80 }, placement_rate: { lower: false, yellow: 80 },
      billable_rate: { lower: false, yellow: 80 }, avg_premium: { lower: false, yellow: 80 },
      apps_submitted: { lower: false, yellow: 80 }, policies_placed: { lower: false, yellow: 80 },
      total_calls: { lower: false, yellow: 80 }, billable_calls: { lower: false, yellow: 80 },
      monthly_premium: { lower: false, yellow: 80 }, gross_adv_revenue: { lower: false, yellow: 80 },
      eff_revenue: { lower: false, yellow: 80 },
      agent_commission: { lower: false, yellow: 80 }, net_revenue: { lower: false, yellow: 80 },
      premium_cost_ratio: { lower: false, yellow: 80 },
      va_calls: { lower: false, yellow: 80 }, va_transfers: { lower: false, yellow: 80 },
      va_transfer_rate: { lower: false, yellow: 80 }, va_sales: { lower: false, yellow: 80 },
      va_conversion_rate: { lower: false, yellow: 80 },
    };
    Object.entries(defaults).forEach(([k, v]) => {
      if (!goals.company[k]) goals.company[k] = v;
      if (!goals.companyMeta[k]) goals.companyMeta[k] = defaultMeta[k] || { lower: false, yellow: 80 };
    });

    console.log('[goals] Company meta:', JSON.stringify(goals.companyMeta));

    // Try loading Agent Goals tab
    try {
      const agentRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.AGENT_GOALS_TAB || 'Agent Daily Goals'
      );
      console.log('[sheets] Agent Daily Goals:', agentRaw.length > 0 ? Object.keys(agentRaw[0]).join(', ') : 'no data');
      agentRaw.forEach(r => {
        const name = (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim();
        if (!name) return;
        const yellowRaw = (r['Yellow Threshold (%)'] || r['Alert Threshold'] || '').replace(/[%]/g, '');
        goals.agents[name] = {
          appsPerDay: parseFloat(r['Apps/Day'] || r['Apps Per Day'] || '0') || 0,
          premiumTarget: parseFloat((r['Premium/Day ($)'] || r['Premium Target'] || r['Premium'] || '0').replace(/[$,]/g, '')) || 0,
          placedPerDay: parseFloat(r['Placed/Day'] || r['Placed Per Day'] || '0') || 0,
          placementRate: parseFloat((r['Placement Rate (%)'] || r['Placement Rate'] || '0').replace('%', '')) || 0,
          cpaTarget: parseFloat((r['CPA Target ($)'] || r['CPA'] || '0').replace(/[$,]/g, '')) || 0,
          closeRate: parseFloat((r['Conversion Rate (%)'] || r['Close Rate'] || '0').replace('%', '')) || 0,
          yellowThreshold: parseFloat(yellowRaw) || 80,
          notes: (r['Notes'] || '').trim(),
          commissionType: (r['Commission Type'] || 'Commission').trim(),
        };
      });
    } catch (e) {
      console.log('[goals] Agent Goals tab not found:', e.message);
    }

    return NextResponse.json(goals);
  } catch (error) {
    console.error('[goals] API error:', error);
    return NextResponse.json({ company: {}, companyMeta: {}, agents: {} });
  }
}
