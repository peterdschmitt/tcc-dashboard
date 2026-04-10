export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '').slice(-10);
}

function parseDuration(raw) {
  if (!raw) return 0;
  // Handle HH:MM:SS or MM:SS
  const match = raw.match(/(\d+):(\d+)(?::(\d+))?/);
  if (match) {
    if (match[3] !== undefined) {
      return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    }
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  // Plain number = seconds
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : Math.round(n);
}

function isTruthy(val) {
  if (!val) return false;
  const v = String(val).trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'no' && v !== 'false' && v !== 'n/a' && v !== 'n' && v !== '-';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const sheetId = process.env.VA_SHEET_ID;
    if (!sheetId) {
      return NextResponse.json({ calls: [], meta: { totalCalls: 0, transfers: 0, transferRate: 0, byCampaign: {} } });
    }

    const raw = await fetchSheet(sheetId, process.env.VA_TAB_NAME || 'Sheet1');

    let rows = raw
      .filter(r => r['CALL DATE'] || r['Call Date'])
      .map(r => {
        const date = parseFlexDate(r['CALL DATE'] || r['Call Date']);
        return {
          recordingId: (r['RECORDING ID'] || r['Recording Id'] || r['Recording ID'] || '').trim(),
          date,
          agentName: (r['AGENT NAME'] || r['Agent Name'] || '').trim(),
          callerId: normalizePhone(r['CALLER ID'] || r['Caller Id'] || r['Caller ID']),
          campaign: (r['CAMPAIGN'] || r['Campaign'] || '').trim(),
          billable: isTruthy(r['BILLABLE'] || r['Billable']),
          duration: parseDuration(r['DURATION'] || r['Duration']),
          disposition: (r['DISPOSITION'] || r['Disposition'] || '').trim(),
          endCallSource: (r['END CALL SOURCE'] || r['End Call Source'] || '').trim(),
          leadReview: (r['LEAD REVIEW'] || r['Lead Review'] || '').trim(),
          intentConfirmation: isTruthy(r['Intent Confirmation']),
          collectDob: isTruthy(r['Collect DOB']),
          existingCoverage: isTruthy(r['Existing Coverage']),
          budgetQualification: isTruthy(r['Budget Qualification']),
          collectState: isTruthy(r['Collect State']),
          transferConfirmation: isTruthy(r['Transfer Confirmation']),
        };
      });

    // Date filter
    if (startDate) rows = rows.filter(r => r.date >= startDate);
    if (endDate) rows = rows.filter(r => r.date <= endDate);

    // Aggregates
    const totalCalls = rows.length;
    const transfers = rows.filter(r => r.transferConfirmation).length;
    const transferRate = totalCalls > 0 ? (transfers / totalCalls) * 100 : 0;
    const billableCalls = rows.filter(r => r.billable).length;

    // Screening step completion rates
    const screening = {
      intentConfirmation: totalCalls > 0 ? (rows.filter(r => r.intentConfirmation).length / totalCalls) * 100 : 0,
      collectDob: totalCalls > 0 ? (rows.filter(r => r.collectDob).length / totalCalls) * 100 : 0,
      existingCoverage: totalCalls > 0 ? (rows.filter(r => r.existingCoverage).length / totalCalls) * 100 : 0,
      budgetQualification: totalCalls > 0 ? (rows.filter(r => r.budgetQualification).length / totalCalls) * 100 : 0,
      collectState: totalCalls > 0 ? (rows.filter(r => r.collectState).length / totalCalls) * 100 : 0,
      transferConfirmation: transferRate,
    };

    // By campaign breakdown
    const byCampaign = {};
    rows.forEach(r => {
      const camp = r.campaign || 'Unknown';
      if (!byCampaign[camp]) byCampaign[camp] = { calls: 0, transfers: 0, billable: 0 };
      byCampaign[camp].calls++;
      if (r.transferConfirmation) byCampaign[camp].transfers++;
      if (r.billable) byCampaign[camp].billable++;
    });

    return NextResponse.json({
      calls: rows,
      meta: { totalCalls, transfers, transferRate, billableCalls, screening, byCampaign },
    });
  } catch (error) {
    console.error('[virtual-agent] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
