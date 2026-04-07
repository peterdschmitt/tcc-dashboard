export const dynamic = 'force-dynamic';
import { readRawSheet, updateRow, appendRow, invalidateCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

// Effectuation settings are stored as rows in the Company Daily Goals tab:
//   Metric = "Effectuation Rate", Value = "70"
//   Metric = "Effectuation Enabled", Value = "1"

export async function POST(request) {
  try {
    const { effectuation_rate, effectuation_enabled } = await request.json();
    const sheetId = process.env.GOALS_SHEET_ID;
    const tabName = process.env.COMPANY_GOALS_TAB || 'Company Daily Goals';

    const { headers, data } = await readRawSheet(sheetId, tabName);
    const metricCol = headers.find(h => /metric/i.test(h)) || 'Metric';
    const valueCol = headers.find(h => /value|daily goal|target/i.test(h)) || 'Daily Goal';

    // Find or create the Effectuation Rate row
    const rateRow = data.find(r => /effectuation.?rate/i.test(r[metricCol] || ''));
    if (rateRow) {
      await updateRow(sheetId, tabName, rateRow._rowIndex, headers, { [metricCol]: 'Effectuation Rate', [valueCol]: String(effectuation_rate) });
    } else {
      await appendRow(sheetId, tabName, headers, { [metricCol]: 'Effectuation Rate', [valueCol]: String(effectuation_rate) });
    }

    // Find or create the Effectuation Enabled row
    const enabledRow = data.find(r => /effectuation.?enabled/i.test(r[metricCol] || ''));
    if (enabledRow) {
      await updateRow(sheetId, tabName, enabledRow._rowIndex, headers, { [metricCol]: 'Effectuation Enabled', [valueCol]: String(effectuation_enabled) });
    } else {
      await appendRow(sheetId, tabName, headers, { [metricCol]: 'Effectuation Enabled', [valueCol]: String(effectuation_enabled) });
    }

    // Invalidate caches so dashboard picks up new values
    invalidateCache(sheetId, tabName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[settings/effectuation] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
