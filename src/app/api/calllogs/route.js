import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate, normalizeCampaign, parseDuration } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const data = await fetchSheet(
      process.env.CALLLOGS_SHEET_ID,
      process.env.CALLLOGS_TAB_NAME || 'Sheet1'
    );

    const calls = data
      .filter(row => row['Date'])
      .map(row => {
        const callDate = parseFlexDate(row['Date']);
        return {
          date: callDate,
          rep: row['Rep']?.trim(),
          campaign: row['Campaign']?.trim(),
          campaignNormalized: normalizeCampaign(row['Campaign']),
          subcampaign: row['Subcampaign']?.trim(),
          phone: row['Phone']?.trim(),
          state: row['State']?.trim(),
          callStatus: row['Call Status']?.trim(),
          isCallable: row['Is Callable']?.trim(),
          isBillable: (row['Is Callable']?.trim() || '').toLowerCase() === 'yes' ||
                      (row['Is Callable']?.trim() || '') === '1' ||
                      (row['Is Callable']?.trim() || '').toLowerCase() === 'true',
          duration: parseDuration(row['Duration']),
          durationRaw: row['Duration']?.trim(),
          callType: row['Call Type']?.trim(),
          hangupSource: row['Hangup Source']?.trim(),
          isSale: (row['Call Status']?.trim() || '').toLowerCase() === 'sale',
          leadId: row['Lead ID']?.trim(),
          clientId: row['Client ID']?.trim(),
        };
      })
      .filter(c => c.date);

    let filtered = calls;
    if (startDate) filtered = filtered.filter(c => c.date >= startDate);
    if (endDate) filtered = filtered.filter(c => c.date <= endDate);

    return NextResponse.json({ calls: filtered, total: filtered.length });
  } catch (error) {
    console.error('Call Logs API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
