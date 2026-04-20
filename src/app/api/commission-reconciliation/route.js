export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

// Parse "MM-DD-YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" → "YYYY-MM-DD"
function toISO(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return s;
}
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start') || '';
    const end   = searchParams.get('end')   || '';

    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab    = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

    const [salesRows, ledgerRows, commRows] = await Promise.all([
      fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
      fetchSheet(salesSheetId, ledgerTab, 60),
      fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 3600),
    ]);

    // Commission rate lookup
    const commRates = commRows.map(r => ({
      carrier: r['Carrier']?.trim(),
      product: r['Product']?.trim(),
      ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
      commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
    }));

    // Build one reconciliation row per policy from the sales tracker
    const byPolicy = {};
    for (const sr of salesRows) {
      const pn = (sr['Policy #'] || '').trim();
      if (!pn) continue;
      const parts = (sr['Carrier + Product + Payout'] || '').split(',');
      const carrier = (parts[0] || '').trim();
      const product = (parts[1] || '').trim();
      const premium = num(sr['Monthly Premium']);
      const cr = calcCommission(premium, carrier, product, 0, commRates);
      const advanceMonths = cr.advanceMonths || 9;
      const isGIWL = /giwl/i.test(product);
      const commMult = isGIWL ? 1.5 : 3;
      const commission = cr.matched ? premium * cr.rate * commMult : premium * commMult;
      const gar = cr.matched ? premium * cr.rate * advanceMonths : premium * advanceMonths;

      byPolicy[pn] = {
        policyNumber: pn,
        submissionDate: toISO(sr['Application Submitted Date']),
        effectiveDate: toISO(sr['Effective Date']),
        agent: (sr['Agent'] || '').trim(),
        client: `${(sr['First Name'] || '').trim()} ${(sr['Last Name'] || '').trim()}`.trim(),
        leadSource: (sr['Lead Source'] || '').trim(),
        carrier,
        product,
        premium: Math.round(premium * 100) / 100,
        commission: Math.round(commission * 100) / 100,
        gar: Math.round(gar * 100) / 100,
        // Carrier fields (filled below)
        carrierAdvance: 0,
        advanceDate: '',
        chargeBack: 0,
        chargeBackDate: '',
        ledgerEntries: 0,
        entries: [],          // per-entry detail: date, type, amount, file
        statementFiles: [],   // unique filenames touching this policy
      };
    }

    // Walk the ledger. For each row, classify as advance or chargeback.
    //  * Advance entries: "Advance Amount" > 0 OR "Commission Amount" > 0
    //  * Chargeback entries: "Chargeback Amount" > 0 OR "Commission Amount" < 0
    //
    // Aggregate per matched policy, track latest dates.
    const orphans = [];
    for (const lr of ledgerRows) {
      const matchedPn = (lr['Matched Policy #'] || '').trim();
      const rawPn     = (lr['Policy #'] || '').trim();
      const commAmt   = num(lr['Commission Amount']);
      const advAmt    = num(lr['Advance Amount']);
      const cbAmt     = num(lr['Chargeback Amount']);
      const statementDate = toISO(lr['Statement Date']);
      const processingDate = toISO(lr['Processing Date']) || statementDate;

      const isAdvance = advAmt > 0 || commAmt > 0;
      const isChargeback = cbAmt > 0 || commAmt < 0;

      const statementFile = (lr['Statement File'] || '').trim();
      const transactionType = (lr['Transaction Type'] || '').trim();

      const row = byPolicy[matchedPn];
      if (row) {
        const entryAmt = isChargeback
          ? -(cbAmt > 0 ? cbAmt : Math.abs(commAmt))
          : (advAmt > 0 ? advAmt : commAmt);
        row.entries.push({
          date: processingDate,
          statementDate,
          type: isChargeback ? 'chargeback' : 'advance',
          transactionType,
          amount: Math.round(entryAmt * 100) / 100,
          statementFile,
        });
        if (statementFile && !row.statementFiles.includes(statementFile)) {
          row.statementFiles.push(statementFile);
        }
        if (isAdvance) {
          row.carrierAdvance += advAmt > 0 ? advAmt : commAmt;
          if (processingDate && (!row.advanceDate || processingDate > row.advanceDate)) {
            row.advanceDate = processingDate;
          }
        }
        if (isChargeback) {
          row.chargeBack += cbAmt > 0 ? cbAmt : Math.abs(commAmt);
          if (processingDate && (!row.chargeBackDate || processingDate > row.chargeBackDate)) {
            row.chargeBackDate = processingDate;
          }
        }
        row.ledgerEntries++;
      } else {
        orphans.push({
          policyNumber: rawPn,
          insuredName: (lr['Insured Name'] || '').trim(),
          agent: (lr['Agent'] || '').trim(),
          carrier: (lr['Carrier'] || '').trim(),
          transactionType: (lr['Transaction Type'] || '').trim(),
          commissionAmount: commAmt,
          advanceAmount: advAmt,
          chargebackAmount: cbAmt,
          statementDate,
          processingDate,
          statementFile: (lr['Statement File'] || '').trim(),
          matchType: (lr['Match Type'] || 'none').trim(),
        });
      }
    }

    let rows = Object.values(byPolicy).map(r => ({
      ...r,
      carrierAdvance: Math.round(r.carrierAdvance * 100) / 100,
      chargeBack: Math.round(r.chargeBack * 100) / 100,
      netReceived: Math.round((r.carrierAdvance - r.chargeBack) * 100) / 100,
      variance: Math.round((r.carrierAdvance - r.chargeBack - r.commission) * 100) / 100, // received vs expected
    }));

    // Date filter on submission date
    if (start) rows = rows.filter(r => !r.submissionDate || r.submissionDate >= start);
    if (end)   rows = rows.filter(r => !r.submissionDate || r.submissionDate <= end);

    rows.sort((a, b) => (b.submissionDate || '').localeCompare(a.submissionDate || ''));

    const totals = rows.reduce((t, r) => ({
      premium: t.premium + r.premium,
      commission: t.commission + r.commission,
      gar: t.gar + r.gar,
      advance: t.advance + r.carrierAdvance,
      chargeback: t.chargeback + r.chargeBack,
      net: t.net + r.netReceived,
      variance: t.variance + r.variance,
    }), { premium: 0, commission: 0, gar: 0, advance: 0, chargeback: 0, net: 0, variance: 0 });

    return NextResponse.json({
      rows,
      orphans,
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      counts: {
        total: rows.length,
        withAdvance: rows.filter(r => r.carrierAdvance > 0).length,
        withChargeback: rows.filter(r => r.chargeBack > 0).length,
        awaiting: rows.filter(r => r.ledgerEntries === 0).length,
        orphans: orphans.length,
      },
    });
  } catch (err) {
    console.error('[commission-reconciliation] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
