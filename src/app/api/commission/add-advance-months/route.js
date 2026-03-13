export const dynamic = 'force-dynamic';
import { getSheetsClient, readRawSheet, invalidateCache, colIndexToLetter } from '@/lib/sheets';
import { NextResponse } from 'next/server';

/**
 * POST /api/commission/add-advance-months
 * One-time setup: adds "Advance Length" column to Commission Rates sheet
 * and populates values based on carrier (CICA=6, all others=9)
 */
export async function POST() {
  try {
    const sheetId = process.env.COMMISSION_SHEET_ID;
    const tabName = process.env.COMMISSION_TAB_NAME || 'Sheet1';

    if (!sheetId) {
      return NextResponse.json({ error: 'COMMISSION_SHEET_ID not set' }, { status: 400 });
    }

    const sheets = await getSheetsClient();

    // Read current sheet
    const { headers, data, headerIdx } = await readRawSheet(sheetId, tabName);

    // Check if column already exists
    if (headers.includes('Advance Length')) {
      return NextResponse.json({ message: 'Advance Length column already exists', rows: data.length });
    }

    // Add the header in the next column
    const newColIdx = headers.length; // 0-based
    const colLetter = colIndexToLetter(newColIdx + 1); // 1-based for letter conversion

    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!${colLetter}${headerIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Advance Length']] },
    });

    // Build values for each row based on carrier
    // CICA = 6 months, everything else = 9 months
    const values = data.map(row => {
      const carrier = (row['Carrier'] || '').toLowerCase();
      const months = carrier.includes('cica') ? 6 : 9;
      return [months];
    });

    if (values.length > 0) {
      const startRow = headerIdx + 2; // first data row (1-based)
      const endRow = startRow + values.length - 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tabName}!${colLetter}${startRow}:${colLetter}${endRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
    }

    invalidateCache(sheetId, tabName);

    const summary = data.map(row => ({
      carrier: row['Carrier'],
      product: row['Product'],
      months: (row['Carrier'] || '').toLowerCase().includes('cica') ? 6 : 9,
    }));

    return NextResponse.json({
      success: true,
      message: `Added "Advance Length" column with ${values.length} values`,
      summary,
    });
  } catch (error) {
    console.error('[add-advance-months] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
