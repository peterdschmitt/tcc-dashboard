export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate, normalizeCampaign, parseDuration, fuzzyMatchAgent } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/crm/leads
 *
 * Auto-generates leads from call logs + sales data.
 * Groups billable inbound calls by phone → one lead per unique phone.
 * Uses the most recent Call Status from the dialer as lead disposition.
 * Cross-references with sales/policy tracker to find conversions.
 *
 * Returns: { leads, pipeline, statuses, total }
 *   - pipeline.byAgent:    { agentName: { campaignX: { status: count }, ... } }
 *   - pipeline.byCampaign: { campaignName: { agentX: { status: count }, ... } }
 *   - statuses: sorted array of distinct Call Status values
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status')?.split(',').map(s => s.trim()).filter(Boolean);
    const agentFilter = searchParams.get('agent');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '500');
    const billableOnly = searchParams.get('billable') !== 'false'; // default true

    const [callsRaw, pricingRaw, salesRaw] = await Promise.all([
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.CALLLOGS_TAB_NAME || 'Report', 300),
      fetchSheet(process.env.GOALS_SHEET_ID, process.env.GOALS_PRICING_TAB || 'Publisher Pricing', 300),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1', 300),
    ]);

    // Build pricing lookup
    const pricing = {};
    pricingRaw.forEach(r => {
      const code = (r['Campaign Code'] || '').trim();
      if (!code || (r['Status'] || '').trim() === 'Inactive') return;
      pricing[code] = {
        buffer: parseInt(r['Buffer (seconds)'] || r['Buffer'] || '0') || 0,
        pricePerCall: parseFloat((r['Price per Billable Call ($)'] || r['Price'] || '0').replace('$', '')) || 0,
        vendor: (r['Vendor'] || '').trim(),
      };
    });

    // Sales lookup by phone
    const salesByPhone = {};
    const allAgentNames = [...new Set(salesRaw.map(r => r['Agent']?.trim()).filter(Boolean))];
    salesRaw.forEach(r => {
      const phone = (r['Phone Number'] || '').replace(/[^0-9]/g, '').slice(-10);
      if (phone.length >= 10) {
        if (!salesByPhone[phone]) salesByPhone[phone] = [];
        salesByPhone[phone].push({
          policyNumber: r['Policy #']?.trim() || '',
          agent: r['Agent']?.trim() || '',
          carrier: (r['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '',
          product: (r['Carrier + Product + Payout'] || '').split(',')[1]?.trim() || '',
          premium: parseFloat(r['Monthly Premium']) || 0,
          placed: r['Placed?']?.trim() || '',
          submitDate: parseFlexDate(r['Application Submitted Date']),
          firstName: r['First Name']?.trim() || '',
          lastName: r['Last Name']?.trim() || '',
          state: r['State']?.trim() || '',
        });
      }
    });

    // Parse calls
    const calls = callsRaw
      .filter(r => r['Date'])
      .map(r => {
        const date = parseFlexDate(r['Date']);
        const rawCampaign = r['Campaign']?.trim() || '';
        const normalized = normalizeCampaign(rawCampaign);
        const priceInfo = pricing[normalized] || {};
        const callDuration = parseDuration(r['Duration']);
        const callTypeRaw = (r['Call Type'] || '').trim().toLowerCase();
        const overrideRaw = (r['Billable Override'] || '').trim().toUpperCase();
        const computedBillable = callTypeRaw === 'inbound' && callDuration > (priceInfo.buffer || 0);
        const isBillable = overrideRaw === 'N' ? false : overrideRaw === 'Y' ? true : computedBillable;

        const rawPhone = String(r['Phone'] || r['Phone Number'] || '').replace(/\.0$/, '').replace(/[^0-9]/g, '');
        const phone10 = rawPhone.slice(-10);

        return {
          date,
          phone: phone10,
          rep: fuzzyMatchAgent(r['Rep']?.trim() || '', allAgentNames),
          campaign: rawCampaign,
          campaignCode: normalized,
          vendor: priceInfo.vendor || '',
          callStatus: r['Standardized Call Status']?.trim() || r['Call Status']?.trim() || '',
          callType: r['Call Type']?.trim() || '',
          duration: callDuration,
          isBillable,
          cost: isBillable ? (priceInfo.pricePerCall || 0) : 0,
          state: r['State']?.trim() || '',
          firstName: r['First']?.trim() || '',
          lastName: r['Last']?.trim() || '',
          leadId: r['Lead Id']?.toString().trim() || '',
        };
      })
      .filter(c => c.date && c.phone.length >= 10);

    // Group calls by phone
    const phoneGroups = {};
    for (const call of calls) {
      if (!phoneGroups[call.phone]) {
        phoneGroups[call.phone] = {
          calls: [],
          billableCalls: 0,
          totalCost: 0,
          agents: {},
          campaigns: {},
          callStatuses: {},
          firstName: '',
          lastName: '',
          state: '',
          latestDate: '',
          earliestDate: '',
          leadId: '',
          latestCallStatus: '',
          latestCallDate: '',
        };
      }
      const g = phoneGroups[call.phone];
      g.calls.push(call);
      if (call.isBillable) {
        g.billableCalls++;
        g.totalCost += call.cost;
      }
      // Track status/agent/campaign from billable calls only (or all calls if billableOnly=false)
      const trackThisCall = billableOnly ? call.isBillable : true;
      if (trackThisCall) {
        if (call.rep) g.agents[call.rep] = (g.agents[call.rep] || 0) + 1;
        if (call.campaign) g.campaigns[call.campaign] = (g.campaigns[call.campaign] || 0) + 1;
        if (call.callStatus) g.callStatuses[call.callStatus] = (g.callStatuses[call.callStatus] || 0) + 1;
        // Track latest call status (by date)
        if (!g.latestCallDate || call.date > g.latestCallDate) {
          if (call.callStatus) {
            g.latestCallStatus = call.callStatus;
            g.latestCallDate = call.date;
          }
        }
      }
      if (!g.firstName && call.firstName) g.firstName = call.firstName;
      if (!g.lastName && call.lastName) g.lastName = call.lastName;
      if (!g.state && call.state) g.state = call.state;
      if (!g.leadId && call.leadId) g.leadId = call.leadId;
      if (!g.latestDate || call.date > g.latestDate) g.latestDate = call.date;
      if (!g.earliestDate || call.date < g.earliestDate) g.earliestDate = call.date;
    }

    // Build leads
    let leads = [];
    // Track all distinct statuses
    const allStatuses = new Set();

    for (const [phone, group] of Object.entries(phoneGroups)) {
      // When billableOnly, require at least 1 billable call; otherwise include all phones with calls
      if (billableOnly && group.billableCalls === 0) continue;
      if (!billableOnly && group.calls.length === 0) continue;

      const primaryAgent = Object.entries(group.agents).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      const primaryCampaign = Object.entries(group.campaigns).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      const policies = salesByPhone[phone] || [];
      const hasPlaced = policies.some(p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed));

      // Status = most recent Call Status from dialer, override to "CONVERTED" if placed policy
      let status = group.latestCallStatus || 'UNKNOWN';
      if (hasPlaced) status = 'CONVERTED';
      allStatuses.add(status);

      // Name — prefer sales data
      let name = '';
      if (policies.length > 0 && policies[0].firstName) {
        name = [policies[0].firstName, policies[0].lastName].filter(Boolean).join(' ');
      } else {
        name = [group.firstName, group.lastName].filter(Boolean).join(' ');
      }

      leads.push({
        leadId: group.leadId || `L-${phone}`,
        phone: formatPhone(phone),
        phone10: phone,
        name: name || 'Unknown',
        leadSource: primaryCampaign,
        primaryAgent,
        status,
        firstContactDate: group.earliestDate,
        lastContact: group.latestDate,
        attempts: group.calls.length,
        billableCalls: group.billableCalls,
        totalCost: Math.round(group.totalCost * 100) / 100,
        state: group.state || (policies[0]?.state || ''),
        policyNumber: policies[0]?.policyNumber || '',
        premium: policies.reduce((s, p) => s + p.premium, 0),
        policiesCount: policies.length,
        allStatuses: Object.keys(group.callStatuses),
      });
    }

    console.log(`[crm/leads] Built ${leads.length} leads from ${calls.length} calls, statuses: ${[...allStatuses].join(', ')}`);

    // Apply filters
    if (statusFilter && statusFilter.length > 0) {
      leads = leads.filter(l => statusFilter.includes(l.status));
    }
    if (agentFilter) {
      leads = leads.filter(l => l.primaryAgent.toLowerCase().includes(agentFilter.toLowerCase()));
    }
    if (startDate) {
      leads = leads.filter(l => l.lastContact >= startDate || l.firstContactDate >= startDate);
    }
    if (endDate) {
      leads = leads.filter(l => l.firstContactDate <= endDate);
    }

    // Build pipeline summaries (from filtered leads)
    const byAgent = {};
    const byCampaign = {};

    for (const lead of leads) {
      const agent = lead.primaryAgent || 'Unassigned';
      const campaign = lead.leadSource || 'Unknown';
      const status = lead.status;

      // Agent > Campaign > Status
      if (!byAgent[agent]) byAgent[agent] = { _total: {}, _leads: 0, _premium: 0, _cost: 0 };
      byAgent[agent]._leads++;
      byAgent[agent]._premium += lead.premium;
      byAgent[agent]._cost += lead.totalCost;
      if (!byAgent[agent][campaign]) byAgent[agent][campaign] = {};
      byAgent[agent][campaign][status] = (byAgent[agent][campaign][status] || 0) + 1;
      byAgent[agent]._total[status] = (byAgent[agent]._total[status] || 0) + 1;

      // Campaign > Agent > Status
      if (!byCampaign[campaign]) byCampaign[campaign] = { _total: {}, _leads: 0, _premium: 0, _cost: 0 };
      byCampaign[campaign]._leads++;
      byCampaign[campaign]._premium += lead.premium;
      byCampaign[campaign]._cost += lead.totalCost;
      if (!byCampaign[campaign][agent]) byCampaign[campaign][agent] = {};
      byCampaign[campaign][agent][status] = (byCampaign[campaign][agent][status] || 0) + 1;
      byCampaign[campaign]._total[status] = (byCampaign[campaign]._total[status] || 0) + 1;
    }

    // Sort leads by last contact desc
    leads.sort((a, b) => (b.lastContact || '').localeCompare(a.lastContact || ''));

    // Paginate
    const total = leads.length;
    const startIdx = (page - 1) * limit;
    const paginatedLeads = leads.slice(startIdx, startIdx + limit);

    // Sort statuses: CONVERTED first, then alphabetical
    const sortedStatuses = [...allStatuses].sort((a, b) => {
      if (a === 'CONVERTED') return -1;
      if (b === 'CONVERTED') return 1;
      return a.localeCompare(b);
    });

    return NextResponse.json({
      leads: paginatedLeads,
      pipeline: { byAgent, byCampaign },
      statuses: sortedStatuses,
      total,
      page,
      pageSize: limit,
    });
  } catch (error) {
    console.error('[crm/leads] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function formatPhone(digits) {
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return digits;
}
