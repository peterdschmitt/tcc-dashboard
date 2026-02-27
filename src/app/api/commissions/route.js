import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const data = await fetchSheet(
      process.env.COMMISSION_SHEET_ID,
      process.env.COMMISSION_TAB_NAME || 'Sheet1'
    );

    const rates = data
      .filter(row => row['Carrier'] && row['Commission Rate'])
      .map(row => ({
        carrier: row['Carrier']?.trim(),
        product: row['Product']?.trim(),
        ageRange: row['Age range']?.trim() || 'n/a',
        commissionRate: parseFloat((row['Commission Rate'] || '0').replace('%', '')) / 100,
        advanceLength: row['Advance Length']?.trim() || '',
      }));

    return NextResponse.json({ rates });
  } catch (error) {
    console.error('Commission API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
