import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate, normalizePlacedStatus, normalizeCampaign, parseDuration, fuzzyMatchAgent, calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

function advanceMonths(carrier) {
  if (!carrier) return 9;
  return carrier.toLowerCase().includes('cica') ? 6 : 9;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const [salesRaw, callsRaw, commRaw, pricingRaw] = await Promise.all([
      fetchSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1'),
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.CALLLOGS_TAB_NAME || 'Report'),
      fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1'),
      fetchSheet(process.env.GOALS_SHEET_ID, process.env.GOALS_PRICING_TAB || 'Publisher Pricing'),
    ]);

    const commissionRates = commRaw
      .filter(r => r['Carrier'] && r['Commission Rate'])
      .map(r => ({
        carrier: r['Carrier']?.trim(),
        product: r['Product']?.trim(),
        ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
        commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
      }));

    const pricing = {};
    pricingRaw.forEach(r => {
      const code = (r['Campaign Code'] || '').trim();
      if (!code || (r['Status'] || '').trim() === 'Inactive') return;
      pricing[code] = {
        vendor: (r['Vendor'] || '').trim(),
        pricePerCall: parseFloat((r['Price per Billable Call ($)'] || '0').replace(/[$,]/g, '')) || 0,
        buffer: parseInt(r['Buffer (seconds)'] || '0') || 0,
        category: (r['Category'] || '').trim(),
      };
    });

    console.log('[dashboard] Pricing loaded:', Object.entries(pricing).map(([k,v]) => k + '=$' + v.pricePerCall + '/buf=' + v.buffer + 's').join(', '));

    const allAgentNames = [...new Set(salesRaw.map(r => r['Agent']?.trim()).filter(Boolean))];

    console.log('[dashboard] Commission rates:', commissionRates.map(r => `${r.carrier}/${r.product}/${r.ageRange}=${(r.commissionRate*100).toFixed(0)}%`).join(', '));
    console.log('[dashboard] Sales columns:', salesRaw.length > 0 ? Object.keys(salesRaw[0]).join(', ') : 'NO DATA');
    console.log('[dashboard] First row carrier field:', salesRaw.length > 0 ? JSON.stringify(salesRaw[0]['Carrier + Product + Payout']) : 'N/A');

    let _dbgIdx = 0;
    let policies = salesRaw
      .filter(r => r['Agent'] && r['Application Submitted Date'])
      .map(r => {
        const submitDate = parseFlexDate(r['Application Submitted Date']);
        const dob = parseFlexDate(r['Date of Birth']);
        let age = null;
        if (dob) {
          const birthYear = parseInt(dob.slice(0, 4));
          if (birthYear > 1900) age = new Date().getFullYear() - birthYear;
        }
        const premium = parseFloat(r['Monthly Premium']) || 0;
        const carrierProductRaw = r['Carrier + Product + Payout'] || r['Carrier'] || '';
        const cpParts = carrierProductRaw.split(',').map(s => s.trim());
        const carrier = cpParts[0] || '';
        const product = cpParts.slice(1).join(', ').trim() || '';
        const isGIWL = (carrier + ' ' + product).toLowerCase().includes('giwl');
        const commission = isGIWL ? premium * 1.5 : premium * 3;
        const leadSource = r['Lead Source']?.trim() || '';
        const months = advanceMonths(carrier);
        const grossAdvancedRevenue = premium * months;

        if (_dbgIdx++ < 5) console.log(`[dashboard] Policy sample: carrier="${carrier}" product="${product}" premium=${premium} commission=${commission} ${isGIWL ? '(GIWL)' : ''}`);

        return {
          agent: r['Agent']?.trim(), leadSource, carrier, product,
          faceAmount: parseFloat(r['Face Amount']) || 0,
          premium, outcome: r['Outcome at Application Submission']?.trim(),
          benefit: '',
          placed: normalizePlacedStatus(r['Placed?']),
          submitDate, effectiveDate: parseFlexDate(r['Effective Date']),
          state: r['State']?.trim(), gender: r['Gender']?.trim(),
          age, commission, advanceMonths: months,
          grossAdvancedRevenue,
        };
      })
      .filter(p => p.submitDate);

    console.log('[dashboard] Policies:', policies.length, '| Placed:', policies.filter(p => ['Advance Released','Active - In Force','Submitted - Pending'].includes(p.placed)).length);
    console.log('[dashboard] Lead sources:', [...new Set(policies.map(p => p.leadSource))].join(', '));

    let calls = callsRaw
      .filter(r => r['Date'])
      .map(r => {
        const date = parseFlexDate(r['Date']);
        const rawCampaign = r['Campaign']?.trim() || '';
        const normalized = normalizeCampaign(rawCampaign);
        const rep = fuzzyMatchAgent(r['Rep']?.trim(), allAgentNames);
        const priceInfo = pricing[normalized] || {};
        const callDuration = parseDuration(r['Duration']);
        const isBillable = callDuration > (priceInfo.buffer || 0);
        return {
          date, rep, campaign: rawCampaign, campaignCode: normalized,
          vendor: priceInfo.vendor || '', isBillable,
          isSale: (r['Call Status'] || '').trim().toLowerCase() === 'sale',
          callStatus: r['Call Status']?.trim(),
          duration: callDuration,
          callType: r['Call Type']?.trim(),
          cost: isBillable ? (priceInfo.pricePerCall || 0) : 0,
          pricePerCall: priceInfo.pricePerCall || 0,
          state: r['State']?.trim(),
        };
      })
      .filter(c => c.date);

    if (startDate) { policies = policies.filter(p => p.submitDate >= startDate); calls = calls.filter(c => c.date >= startDate); }
    if (endDate) { policies = policies.filter(p => p.submitDate <= endDate); calls = calls.filter(c => c.date <= endDate); }

    const pnlByPublisher = {};
    calls.forEach(c => {
      const key = c.campaignCode || 'Unknown';
      if (!pnlByPublisher[key]) {
        pnlByPublisher[key] = { campaign: key, vendor: c.vendor, pricePerCall: c.pricePerCall,
          totalCalls: 0, billableCalls: 0, leadSpend: 0, sales: 0, totalPremium: 0,
          totalCommission: 0, placedCount: 0, totalFace: 0, appCount: 0, grossAdvancedRevenue: 0, agents: {} };
      }
      const p = pnlByPublisher[key];
      p.totalCalls++;
      if (c.isBillable) { p.billableCalls++; p.leadSpend += c.cost; }
      if (c.isSale) p.sales++;
      if (c.rep) {
        if (!p.agents[c.rep]) p.agents[c.rep] = { totalCalls: 0, billableCalls: 0, leadSpend: 0, sales: 0, totalPremium: 0, totalCommission: 0, placedCount: 0, appCount: 0, grossAdvancedRevenue: 0 };
        p.agents[c.rep].totalCalls++;
        if (c.isBillable) { p.agents[c.rep].billableCalls++; p.agents[c.rep].leadSpend += c.cost; }
        if (c.isSale) p.agents[c.rep].sales++;
      }
    });

    policies.forEach(pol => {
      const key = pol.leadSource || 'Unknown';
      if (!pnlByPublisher[key]) {
        pnlByPublisher[key] = { campaign: key, vendor: (pricing[key] || {}).vendor || '', pricePerCall: (pricing[key] || {}).pricePerCall || 0,
          totalCalls: 0, billableCalls: 0, leadSpend: 0, sales: 0, totalPremium: 0,
          totalCommission: 0, placedCount: 0, totalFace: 0, appCount: 0, grossAdvancedRevenue: 0, agents: {} };
      }
      const pub = pnlByPublisher[key];
      pub.appCount++;
      const isPlaced = ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(pol.placed);
      if (isPlaced) {
        pub.totalPremium += pol.premium;
        pub.totalCommission += pol.commission;
        pub.placedCount++;
        pub.totalFace += pol.faceAmount;
        pub.grossAdvancedRevenue += pol.grossAdvancedRevenue;
      }
      if (pol.agent) {
        if (!pub.agents[pol.agent]) pub.agents[pol.agent] = { totalCalls: 0, billableCalls: 0, leadSpend: 0, sales: 0, totalPremium: 0, totalCommission: 0, placedCount: 0, appCount: 0, grossAdvancedRevenue: 0 };
        pub.agents[pol.agent].appCount++;
        if (isPlaced) {
          pub.agents[pol.agent].totalPremium += pol.premium;
          pub.agents[pol.agent].totalCommission += pol.commission;
          pub.agents[pol.agent].placedCount++;
          pub.agents[pol.agent].grossAdvancedRevenue += pol.grossAdvancedRevenue;
        }
      }
    });

    const pnl = Object.values(pnlByPublisher).map(p => {
      const netRevenue = p.grossAdvancedRevenue - p.leadSpend - p.totalCommission;
      return { ...p,
        billableRate: p.totalCalls > 0 ? p.billableCalls / p.totalCalls * 100 : 0,
        rpc: p.totalCalls > 0 ? p.leadSpend / p.totalCalls : 0,
        closeRate: p.billableCalls > 0 ? p.placedCount / p.billableCalls * 100 : 0,
        cpa: p.placedCount > 0 ? p.leadSpend / p.placedCount : 0,
        avgPremium: p.placedCount > 0 ? p.totalPremium / p.placedCount : 0,
        premiumToCost: p.leadSpend > 0 ? p.totalPremium / p.leadSpend : 0,
        netRevenue,
        agentBreakdown: Object.entries(p.agents || {}).map(([name, a]) => ({
          agent: name, ...a,
          closeRate: a.billableCalls > 0 ? a.placedCount / a.billableCalls * 100 : 0,
          cpa: a.placedCount > 0 ? a.leadSpend / a.placedCount : 0,
          rpc: a.totalCalls > 0 ? a.leadSpend / a.totalCalls : 0,
          billableRate: a.totalCalls > 0 ? a.billableCalls / a.totalCalls * 100 : 0,
          avgPremium: a.placedCount > 0 ? a.totalPremium / a.placedCount : 0,
          netRevenue: a.grossAdvancedRevenue - a.leadSpend - a.totalCommission,
        })),
      };
    }).sort((a, b) => b.totalPremium - a.totalPremium);

    return NextResponse.json({
      policies, calls, pnl,
      meta: { policyCount: policies.length, callCount: calls.length, dateRange: { start: startDate, end: endDate } },
    });
  } catch (error) {
    console.error('Dashboard data API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
