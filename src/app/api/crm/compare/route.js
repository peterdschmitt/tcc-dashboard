export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/crm/compare
 * Compares DetailedProduction (carrier report) against Application/Sales tracker
 * Returns record-level differences and economic impact analysis
 */
export async function GET() {
  try {
    // Fetch both data sources in parallel
    const [carrierData, salesData, commissionData] = await Promise.all([
      fetchSheet(process.env.CARRIER_REPORT_SHEET_ID, process.env.CARRIER_REPORT_TAB_NAME || 'Policies', 0),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1', 0),
      fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 0),
    ]);

    // ── Build carrier report lookup by policy number ──
    const carrierByPolicy = {};
    for (const cr of carrierData) {
      const pn = (cr['Policy No.'] || '').trim();
      if (!pn) continue;
      const annualPremium = parseFloat(cr['Annual Premium']) || 0;
      carrierByPolicy[pn] = {
        policyNo: pn,
        name: (cr['Insured'] || '').trim(),
        carrier: (cr['Carrier'] || '').trim(),
        product: (cr['Product'] || '').trim(),
        agent: (cr['Agent'] || '').trim(),
        status: (cr['Status'] || '').trim(),
        annualPremium,
        monthlyPremium: Math.round((annualPremium / 12) * 100) / 100,
        effectiveDate: parseFlexDate(cr['Effective']) || '',
        submittedDate: parseFlexDate(cr['Submitted']) || '',
        issuedDate: parseFlexDate(cr['Issued']) || '',
        state: (cr['Issued State'] || '').trim(),
      };
    }

    // ── Build application tracker lookup by policy number ──
    const appByPolicy = {};
    for (const sr of salesData) {
      const pn = (sr['Policy #'] || '').trim();
      if (!pn) continue;
      const premium = parseFloat(sr['Monthly Premium']) || 0;
      const carrierProductPayout = sr['Carrier + Product + Payout'] || '';
      const parts = carrierProductPayout.split(',').map(s => s.trim());
      const carrier = parts[0] || '';
      const product = parts[1] || '';

      // Determine placed status
      const placed = (sr['Placed?'] || sr['Outcome at Application Submission'] || '').trim();
      const isPlaced = ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(placed);

      // Calculate commission and GAR
      const isGIWL = /GIWL/i.test(product);
      const isCICA = /CICA/i.test(carrier);
      const commission = premium * (isGIWL ? 1.5 : 3);
      const advMonths = isCICA ? 6 : 9;
      const grossAdvRev = premium * advMonths;

      appByPolicy[pn] = {
        policyNo: pn,
        name: `${(sr['First Name'] || '').trim()} ${(sr['Last Name'] || '').trim()}`.trim(),
        carrier,
        product,
        agent: (sr['Agent'] || '').trim(),
        status: placed,
        isPlaced,
        monthlyPremium: premium,
        annualPremium: premium * 12,
        effectiveDate: parseFlexDate(sr['Effective Date']) || '',
        submittedDate: parseFlexDate(sr['Application Submitted Date']) || '',
        commission,
        grossAdvRev,
        state: (sr['State'] || '').trim(),
      };
    }

    // ── Compare ──
    const allPolicyNos = new Set([...Object.keys(carrierByPolicy), ...Object.keys(appByPolicy)]);

    const records = [];
    const summary = {
      totalCarrier: Object.keys(carrierByPolicy).length,
      totalApp: Object.keys(appByPolicy).length,
      matchedBoth: 0,
      carrierOnly: 0,
      appOnly: 0,
      statusMismatches: 0,
      premiumMismatches: 0,
      nameMismatches: 0,
    };

    // Status mapping: normalize carrier statuses to comparable app statuses
    function normalizeStatus(carrierStatus) {
      const s = (carrierStatus || '').toLowerCase();
      if (s === 'active') return 'Active - In Force';
      if (s === 'pending') return 'Submitted - Pending';
      if (s === 'canceled' || s === 'cancelled') return 'Declined';  // or could map differently
      if (s === 'declined') return 'Declined';
      return carrierStatus;
    }

    function statusCategory(status) {
      const s = (status || '').toLowerCase();
      if (['active', 'active - in force', 'advance released'].includes(s)) return 'active';
      if (['pending', 'submitted - pending'].includes(s)) return 'pending';
      if (['canceled', 'cancelled', 'declined', 'not taken', 'rejected', 'terminated', 'lapsed'].includes(s)) return 'terminated';
      return 'other';
    }

    // Economic impact accumulators
    const impact = {
      // Premium at risk: policies active in app but terminated per carrier
      premiumAtRisk: 0,
      policiesAtRisk: 0,
      garAtRisk: 0,         // Gross advanced revenue at risk
      commissionAtRisk: 0,  // Commission that may need to be clawed back

      // Untracked revenue: policies in carrier but missing from app
      untrackedPremium: 0,
      untrackedPolicies: 0,

      // Pending discrepancies: app says pending, carrier says something else
      pendingResolved: 0,
      pendingResolvedPremium: 0,

      // Premium differences on matched records
      totalPremiumDiff: 0,
      premiumDiffCount: 0,
    };

    for (const pn of allPolicyNos) {
      const cr = carrierByPolicy[pn];
      const ap = appByPolicy[pn];

      if (cr && ap) {
        summary.matchedBoth++;
        const record = {
          policyNo: pn,
          source: 'both',
          carrierName: cr.name,
          appName: ap.name,
          carrier: cr.carrier || ap.carrier,
          product: cr.product || ap.product,
          agent: cr.agent || ap.agent,
          differences: [],
        };

        // Status comparison
        const crCat = statusCategory(cr.status);
        const apCat = statusCategory(ap.status);
        if (crCat !== apCat) {
          summary.statusMismatches++;
          record.differences.push({
            field: 'Status',
            carrier: cr.status,
            app: ap.status,
            carrierCategory: crCat,
            appCategory: apCat,
            severity: 'high',
          });

          // Economic impact of status mismatch
          if (apCat === 'active' && crCat === 'terminated') {
            // App thinks it's active but carrier says terminated = revenue at risk
            impact.premiumAtRisk += ap.monthlyPremium;
            impact.policiesAtRisk++;
            impact.garAtRisk += ap.grossAdvRev;
            impact.commissionAtRisk += ap.commission;
          }
          if (apCat === 'pending' && crCat !== 'pending') {
            impact.pendingResolved++;
            impact.pendingResolvedPremium += ap.monthlyPremium;
          }
        }

        // Premium comparison
        const premDiff = Math.abs(cr.monthlyPremium - ap.monthlyPremium);
        if (premDiff > 0.50) {  // tolerance of $0.50
          summary.premiumMismatches++;
          record.differences.push({
            field: 'Monthly Premium',
            carrier: cr.monthlyPremium,
            app: ap.monthlyPremium,
            diff: cr.monthlyPremium - ap.monthlyPremium,
            severity: premDiff > 10 ? 'high' : 'medium',
          });
          impact.totalPremiumDiff += (cr.monthlyPremium - ap.monthlyPremium);
          impact.premiumDiffCount++;
        }

        // Name comparison
        if (cr.name && ap.name && cr.name.toLowerCase() !== ap.name.toLowerCase()) {
          summary.nameMismatches++;
          record.differences.push({
            field: 'Insured Name',
            carrier: cr.name,
            app: ap.name,
            severity: 'low',
          });
        }

        if (record.differences.length > 0) {
          records.push(record);
        }

      } else if (cr && !ap) {
        // In carrier report but NOT in application tracker
        summary.carrierOnly++;
        impact.untrackedPolicies++;
        impact.untrackedPremium += cr.monthlyPremium;
        records.push({
          policyNo: pn,
          source: 'carrier_only',
          carrierName: cr.name,
          appName: null,
          carrier: cr.carrier,
          product: cr.product,
          agent: cr.agent,
          carrierStatus: cr.status,
          monthlyPremium: cr.monthlyPremium,
          differences: [{ field: 'Missing from Application Tracker', carrier: cr.status, app: '—', severity: 'high' }],
        });

      } else if (!cr && ap) {
        // In application tracker but NOT in carrier report
        summary.appOnly++;
        records.push({
          policyNo: pn,
          source: 'app_only',
          carrierName: null,
          appName: ap.name,
          carrier: ap.carrier,
          product: ap.product,
          agent: ap.agent,
          appStatus: ap.status,
          monthlyPremium: ap.monthlyPremium,
          differences: [{ field: 'Missing from Carrier Report', carrier: '—', app: ap.status, severity: 'medium' }],
        });
      }
    }

    // Sort records by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    records.sort((a, b) => {
      const aMax = Math.min(...a.differences.map(d => severityOrder[d.severity] ?? 3));
      const bMax = Math.min(...b.differences.map(d => severityOrder[d.severity] ?? 3));
      return aMax - bMax;
    });

    // Round impact numbers
    Object.keys(impact).forEach(k => {
      if (typeof impact[k] === 'number') impact[k] = Math.round(impact[k] * 100) / 100;
    });

    return NextResponse.json({
      summary,
      impact,
      records,
      meta: {
        carrierReportDate: new Date().toISOString().split('T')[0],
        totalDiscrepancies: records.length,
      },
    });

  } catch (error) {
    console.error('[crm/compare] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
