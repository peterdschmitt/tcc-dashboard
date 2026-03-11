export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate, normalizePlacedStatus } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/crm/data-diff
 * Compares Sheet1 (original agent-submitted) vs Merged tab (carrier-corrected)
 * Returns only records with differences, plus summary stats
 */
export async function GET() {
  try {
    const mergedTab = process.env.SALES_TAB_NAME || 'Merged';

    const [sheet1Data, mergedData] = await Promise.all([
      fetchSheet(process.env.SALES_SHEET_ID, 'Sheet1', 120),
      fetchSheet(process.env.SALES_SHEET_ID, mergedTab, 120),
    ]);

    // Build lookup by row key: Policy # if present, else First+Last+Agent+SubmitDate
    function rowKey(r) {
      const pn = (r['Policy #'] || '').trim();
      if (pn) return `pol:${pn}`;
      const first = (r['First Name'] || '').trim().toLowerCase();
      const last = (r['Last Name'] || '').trim().toLowerCase();
      const agent = (r['Agent'] || '').trim().toLowerCase();
      const date = (r['Application Submitted Date'] || '').trim();
      return `name:${last}|${first}|${agent}|${date}`;
    }

    // Fields we care about comparing
    const COMPARE_FIELDS = [
      { key: 'Monthly Premium', label: 'Monthly Premium', format: 'currency' },
      { key: 'Placed?', label: 'Placed Status', format: 'text' },
      { key: 'Effective Date', label: 'Effective Date', format: 'text' },
      { key: 'Face Amount', label: 'Face Amount', format: 'currency' },
    ];

    // Index Sheet1 rows
    const sheet1Map = {};
    for (const row of sheet1Data) {
      const agent = (row['Agent'] || '').trim();
      const submitDate = (row['Application Submitted Date'] || '').trim();
      if (!agent || !submitDate) continue;
      const k = rowKey(row);
      sheet1Map[k] = row;
    }

    // Index Merged rows
    const mergedMap = {};
    for (const row of mergedData) {
      const agent = (row['Agent'] || '').trim();
      const submitDate = (row['Application Submitted Date'] || '').trim();
      if (!agent || !submitDate) continue;
      const k = rowKey(row);
      mergedMap[k] = row;
    }

    const allKeys = new Set([...Object.keys(sheet1Map), ...Object.keys(mergedMap)]);
    const records = [];
    let totalMatched = 0;
    let totalDiffs = 0;
    let premiumDiffTotal = 0;
    let statusDiffCount = 0;
    let sheet1Only = 0;
    let mergedOnly = 0;

    for (const k of allKeys) {
      const s1 = sheet1Map[k];
      const mg = mergedMap[k];

      if (s1 && !mg) {
        sheet1Only++;
        continue;
      }
      if (!s1 && mg) {
        mergedOnly++;
        continue;
      }

      totalMatched++;

      // Compare fields
      const diffs = [];
      for (const f of COMPARE_FIELDS) {
        let v1 = (s1[f.key] || '').toString().trim();
        let v2 = (mg[f.key] || '').toString().trim();

        if (f.format === 'currency') {
          const n1 = parseFloat(v1.replace(/[$,]/g, '')) || 0;
          const n2 = parseFloat(v2.replace(/[$,]/g, '')) || 0;
          if (Math.abs(n1 - n2) > 0.01) {
            diffs.push({
              field: f.label,
              sheet1: n1,
              merged: n2,
              diff: n2 - n1,
              format: 'currency',
            });
            if (f.key === 'Monthly Premium') premiumDiffTotal += (n2 - n1);
          }
        } else {
          if (v1 !== v2) {
            diffs.push({
              field: f.label,
              sheet1: v1 || '(empty)',
              merged: v2 || '(empty)',
              format: 'text',
            });
            if (f.key === 'Placed?') statusDiffCount++;
          }
        }
      }

      // Also check the audit columns on the Merged tab
      const carrierStatus = (mg['Carrier Status'] || '').trim();
      const syncNotes = (mg['Sync Notes'] || '').trim();
      const originalPremium = (mg['Original Premium'] || '').trim();
      const lastSyncDate = (mg['Last Sync Date'] || '').trim();
      const carrierPolicyNo = (mg['Carrier Policy #'] || '').trim();

      if (diffs.length > 0) {
        totalDiffs++;
        const premium1 = parseFloat((s1['Monthly Premium'] || '0').toString().replace(/[$,]/g, '')) || 0;
        const premium2 = parseFloat((mg['Monthly Premium'] || '0').toString().replace(/[$,]/g, '')) || 0;
        const carrierProductRaw = s1['Carrier + Product + Payout'] || '';
        const cpParts = carrierProductRaw.split(',').map(s => s.trim());

        records.push({
          policyNumber: (s1['Policy #'] || '').trim(),
          carrierPolicyNo,
          insured: `${(s1['First Name'] || '').trim()} ${(s1['Last Name'] || '').trim()}`.trim(),
          agent: (s1['Agent'] || '').trim(),
          carrier: cpParts[0] || '',
          product: cpParts.slice(1).join(', ').trim(),
          submitDate: parseFlexDate(s1['Application Submitted Date']),
          sheet1Premium: premium1,
          mergedPremium: premium2,
          sheet1Status: (s1['Placed?'] || '').trim(),
          mergedStatus: (mg['Placed?'] || '').trim(),
          carrierStatus,
          originalPremium: originalPremium ? parseFloat(originalPremium.replace(/[$,]/g, '')) || null : null,
          lastSyncDate,
          syncNotes,
          diffs,
        });
      }
    }

    // Sort by most recent submit date first
    records.sort((a, b) => (b.submitDate || '').localeCompare(a.submitDate || ''));

    // Summary by diff type
    const byField = {};
    for (const r of records) {
      for (const d of r.diffs) {
        if (!byField[d.field]) byField[d.field] = 0;
        byField[d.field]++;
      }
    }

    // Summary by agent
    const byAgent = {};
    for (const r of records) {
      if (!byAgent[r.agent]) byAgent[r.agent] = 0;
      byAgent[r.agent]++;
    }

    return NextResponse.json({
      records,
      summary: {
        totalSheet1: sheet1Data.length,
        totalMerged: mergedData.length,
        totalMatched,
        totalDiffs,
        premiumDiffTotal: Math.round(premiumDiffTotal * 100) / 100,
        statusDiffCount,
        sheet1Only,
        mergedOnly,
        byField,
        byAgent,
      },
    });
  } catch (error) {
    console.error('[crm/data-diff] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
