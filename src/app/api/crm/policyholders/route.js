export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/crm/policyholders
 *
 * Auto-generates policyholder records from the sales/policy tracker.
 * Derives retention status from Placed? column + carrier status (if Merged tab).
 *
 * Status logic:
 *   - Active:   Placed? = 'Active - In Force' or 'Advance Released'
 *   - Pending:  Placed? = 'Submitted - Pending'
 *   - At-Risk:  Pending > 30 days, OR carrier status is concerning (Lapsed, NSF, etc.)
 *   - Declined: Placed? = 'Declined' or carrier says Canceled/Declined/Terminated
 *   - Lapsed:   Carrier status explicitly lapsed/canceled after being active
 *
 * Returns: { policyholders, summary, total }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status')?.split(',').map(s => s.trim()).filter(Boolean);
    const carrierFilter = searchParams.get('carrier');
    const agentFilter = searchParams.get('agent');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '500');

    // Use source param if provided, otherwise fall back to env var
    const requestedTab = searchParams.get('source') || process.env.SALES_TAB_NAME || 'Sheet1';
    let salesRaw;
    let sourceTab = requestedTab;
    try {
      salesRaw = await fetchSheet(process.env.SALES_SHEET_ID, requestedTab, 300);
    } catch (e) {
      console.warn(`[policyholders] Tab "${requestedTab}" failed, falling back to Sheet1`);
      sourceTab = 'Sheet1';
      salesRaw = await fetchSheet(process.env.SALES_SHEET_ID, 'Sheet1', 300);
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Build policyholders from sales rows that have a policy number or application
    let policyholders = salesRaw
      .filter(r => {
        // Include rows that have at least an agent + some identifying info
        const hasPolicy = (r['Policy #'] || '').trim();
        const hasApp = (r['Application Submitted Date'] || '').trim();
        const hasName = (r['First Name'] || r['Last Name'] || '').trim();
        return (hasPolicy || hasApp) && hasName;
      })
      .map(r => {
        const placed = (r['Placed?'] || '').trim();
        const carrierProductRaw = r['Carrier + Product + Payout'] || '';
        const parts = carrierProductRaw.split(',').map(s => s.trim());
        const carrier = parts[0] || '';
        const product = parts[1] || '';
        const premium = parseFloat(r['Monthly Premium']) || 0;
        const submitDate = parseFlexDate(r['Application Submitted Date']);
        const effectiveDate = parseFlexDate(r['Effective Date']);
        const policyNumber = (r['Policy #'] || '').trim();

        // Merged tab columns (may not exist if reading Sheet1)
        const carrierStatus = (r['Carrier Status'] || '').trim();
        const carrierStatusDate = parseFlexDate(r['Carrier Status Date']);
        const originalPremium = parseFloat(r['Original Premium']) || 0;
        const originalPlaced = (r['Original Placed Status'] || '').trim();
        const lastSyncDate = parseFlexDate(r['Last Sync Date']);
        const syncNotes = (r['Sync Notes'] || '').trim();
        const carrierPolicyNum = (r['Carrier Policy #'] || '').trim();

        // Calculate days since submission
        const daysSinceSubmit = submitDate
          ? Math.floor((today - new Date(submitDate)) / (1000 * 60 * 60 * 24))
          : null;

        // Calculate days since effective date
        const daysSinceEffective = effectiveDate
          ? Math.floor((today - new Date(effectiveDate)) / (1000 * 60 * 60 * 24))
          : null;

        // Determine retention status
        let retentionStatus = 'Unknown';
        let concerns = [];

        // Map carrier status to normalized values
        const carrierNorm = carrierStatus.toLowerCase();
        const placedNorm = placed.toLowerCase();

        if (placedNorm === 'active - in force' || placedNorm === 'advance released') {
          retentionStatus = 'Active';

          // Check for carrier-level concerns even on "active" policies
          if (carrierNorm.includes('lapsed') || carrierNorm.includes('lapse')) {
            retentionStatus = 'Lapsed';
            concerns.push('Carrier reports lapsed');
          } else if (carrierNorm.includes('cancel') || carrierNorm.includes('terminat')) {
            retentionStatus = 'Lapsed';
            concerns.push('Carrier reports canceled/terminated');
          } else if (carrierNorm.includes('nsf') || carrierNorm.includes('non-pay') || carrierNorm.includes('nonpay')) {
            retentionStatus = 'At-Risk';
            concerns.push('Payment issue reported by carrier');
          } else if (carrierNorm.includes('pending')) {
            retentionStatus = 'At-Risk';
            concerns.push('Carrier status reverted to pending');
          }

          // Premium discrepancy check (if Merged tab has original premium)
          if (originalPremium > 0 && premium > 0 && Math.abs(premium - originalPremium) > 1) {
            concerns.push(`Premium changed: ${originalPremium.toFixed(2)} → ${premium.toFixed(2)}`);
          }

        } else if (placedNorm === 'submitted - pending') {
          retentionStatus = 'Pending';

          if (daysSinceSubmit && daysSinceSubmit > 30) {
            retentionStatus = 'At-Risk';
            concerns.push(`Pending ${daysSinceSubmit} days (>30 day threshold)`);
          }

          // Carrier may have already declined
          if (carrierNorm.includes('decline') || carrierNorm.includes('reject') || carrierNorm.includes('not taken')) {
            retentionStatus = 'Declined';
            concerns.push('Carrier declined application');
          }

        } else if (placedNorm === 'declined' || placedNorm.includes('decline') || placedNorm.includes('cancel')) {
          retentionStatus = 'Declined';

          if (carrierNorm) {
            concerns.push(`Carrier status: ${carrierStatus}`);
          }

        } else if (placed) {
          // Other placed values — treat as unknown/review needed
          retentionStatus = 'Review';
          concerns.push(`Unusual status: ${placed}`);
        }

        // Additional carrier concern flags
        if (carrierNorm.includes('not taken')) {
          retentionStatus = 'Declined';
          concerns.push('Policy not taken');
        }
        if (carrierNorm.includes('reinstat')) {
          retentionStatus = 'Reinstated';
          concerns = concerns.filter(c => !c.includes('lapse'));
        }

        const name = [r['First Name']?.trim(), r['Last Name']?.trim()].filter(Boolean).join(' ');
        const phone = (r['Phone Number'] || '').replace(/[^0-9]/g, '').slice(-10);
        const state = (r['State'] || '').trim();

        return {
          policyNumber: policyNumber || `APP-${(submitDate || '').replace(/-/g, '')}-${name.replace(/\s/g, '').slice(0, 6)}`,
          carrierPolicyNumber: carrierPolicyNum,
          name: name || 'Unknown',
          firstName: (r['First Name'] || '').trim(),
          lastName: (r['Last Name'] || '').trim(),
          phone: phone.length === 10 ? `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}` : phone,
          email: (r['Email Address'] || '').trim(),
          state,
          agent: (r['Agent'] || '').trim(),
          leadSource: (r['Lead Source'] || '').trim(),
          carrier,
          product,
          premium,
          faceAmount: parseFloat(r['Face Amount']) || 0,
          termLength: (r['Term Length'] || '').trim(),
          paymentType: (r['Payment Type'] || '').trim(),
          paymentFrequency: (r['Payment Frequency'] || '').trim(),
          submitDate: submitDate || '',
          effectiveDate: effectiveDate || '',
          daysSinceSubmit,
          daysSinceEffective,
          placedStatus: placed,
          retentionStatus,
          carrierStatus: carrierStatus || '',
          carrierStatusDate: carrierStatusDate || '',
          lastSyncDate: lastSyncDate || '',
          originalPremium,
          originalPlaced,
          syncNotes,
          concerns,
          hasConcerns: concerns.length > 0,
          outcome: (r['Outcome at Application Submission'] || '').trim(),
          salesNotes: (r['Sales Notes'] || '').trim(),
          ssnMatch: (r['Social Security Billing Match'] || '').trim(),
        };
      });

    console.log(`[policyholders] Built ${policyholders.length} records from sales tab "${sourceTab}"`);

    // Apply filters
    if (statusFilter && statusFilter.length > 0) {
      policyholders = policyholders.filter(p => statusFilter.includes(p.retentionStatus));
    }
    if (carrierFilter) {
      policyholders = policyholders.filter(p => p.carrier.toLowerCase().includes(carrierFilter.toLowerCase()));
    }
    if (agentFilter) {
      policyholders = policyholders.filter(p => p.agent.toLowerCase().includes(agentFilter.toLowerCase()));
    }
    // Date filter is optional — retention view typically shows all policies
    // Only apply if explicitly provided AND not the "all time" range
    if (startDate && startDate !== '2020-01-01') {
      policyholders = policyholders.filter(p => (p.submitDate || p.effectiveDate) >= startDate);
    }
    if (endDate && endDate !== '2030-12-31') {
      policyholders = policyholders.filter(p => (p.submitDate || p.effectiveDate) <= endDate);
    }

    // Build summary counts
    const summary = {
      total: policyholders.length,
      active: policyholders.filter(p => p.retentionStatus === 'Active').length,
      pending: policyholders.filter(p => p.retentionStatus === 'Pending').length,
      atRisk: policyholders.filter(p => p.retentionStatus === 'At-Risk').length,
      declined: policyholders.filter(p => p.retentionStatus === 'Declined').length,
      lapsed: policyholders.filter(p => p.retentionStatus === 'Lapsed').length,
      reinstated: policyholders.filter(p => p.retentionStatus === 'Reinstated').length,
      review: policyholders.filter(p => p.retentionStatus === 'Review').length,
      withConcerns: policyholders.filter(p => p.hasConcerns).length,
      totalPremium: policyholders.filter(p => ['Active', 'Reinstated'].includes(p.retentionStatus)).reduce((s, p) => s + p.premium, 0),
      atRiskPremium: policyholders.filter(p => ['At-Risk', 'Lapsed'].includes(p.retentionStatus)).reduce((s, p) => s + p.premium, 0),
    };

    // Build breakdowns: status counts + premium grouped by agent and carrier
    const byAgent = {};
    const byCarrier = {};
    const allStatuses = new Set();

    for (const p of policyholders) {
      const agent = p.agent || 'Unassigned';
      const carrier = p.carrier || 'Unknown';
      const status = p.retentionStatus;
      allStatuses.add(status);

      // By Agent
      if (!byAgent[agent]) byAgent[agent] = { _total: {}, _count: 0, _premium: 0, _concerns: 0 };
      byAgent[agent]._count++;
      byAgent[agent]._premium += p.premium;
      if (p.hasConcerns) byAgent[agent]._concerns++;
      byAgent[agent]._total[status] = (byAgent[agent]._total[status] || 0) + 1;

      // By Carrier
      if (!byCarrier[carrier]) byCarrier[carrier] = { _total: {}, _count: 0, _premium: 0, _concerns: 0 };
      byCarrier[carrier]._count++;
      byCarrier[carrier]._premium += p.premium;
      if (p.hasConcerns) byCarrier[carrier]._concerns++;
      byCarrier[carrier]._total[status] = (byCarrier[carrier]._total[status] || 0) + 1;
    }

    const statusList = ['Active', 'Pending', 'At-Risk', 'Declined', 'Lapsed', 'Reinstated', 'Review'].filter(s => allStatuses.has(s));

    // Sort: concerns first, then by submit date desc
    policyholders.sort((a, b) => {
      // Concerns bubble up
      if (a.hasConcerns && !b.hasConcerns) return -1;
      if (!a.hasConcerns && b.hasConcerns) return 1;
      // Then by date desc
      return (b.submitDate || '').localeCompare(a.submitDate || '');
    });

    // Paginate
    const total = policyholders.length;
    const startIdx = (page - 1) * limit;
    const paginated = policyholders.slice(startIdx, startIdx + limit);

    return NextResponse.json({
      policyholders: paginated,
      summary,
      breakdown: { byAgent, byCarrier, statuses: statusList },
      total,
      page,
      pageSize: limit,
      sourceTab,
    });
  } catch (error) {
    console.error('[crm/policyholders] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
