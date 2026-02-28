export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate, normalizePlacedStatus } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const data = await fetchSheet(
      process.env.SALES_SHEET_ID,
      process.env.SALES_TAB_NAME || 'Sheet1'
    );

    const policies = data
      .filter(row => row['Agent'] && row['Application Submitted Date'])
      .map(row => {
        const submitDate = parseFlexDate(row['Application Submitted Date']);
        const dob = parseFlexDate(row['Date of Birth']);
        let age = null;
        if (dob) {
          const birthYear = parseInt(dob.slice(0, 4));
          if (birthYear > 1900) age = new Date().getFullYear() - birthYear;
        }

        return {
          agent: row['Agent']?.trim(),
          leadSource: row['Lead Source']?.trim(),
          carrier: row['Carrier']?.trim(),
          product: row['Product']?.trim(),
          faceAmount: parseFloat(row['Face Amount']) || 0,
          premium: parseFloat(row['Monthly Premium']) || 0,
          outcome: row['Outcome at Application Submission']?.trim(),
          benefit: row['Benefit Payout']?.trim(),
          placed: normalizePlacedStatus(row['Placed?']),
          submitDate,
          effectiveDate: parseFlexDate(row['Effective Date']),
          state: row['State']?.trim(),
          gender: row['Gender']?.trim(),
          age,
          paymentFrequency: row['Payment Frequency']?.trim(),
          paymentType: row['Payment Type']?.trim(),
          submissionId: row['Submission ID']?.trim(),
          // PII excluded: Sales Notes, Case Mgmt, SSN, CC, Phone, Email, Address
        };
      })
      .filter(p => p.submitDate);

    let filtered = policies;
    if (startDate) filtered = filtered.filter(p => p.submitDate >= startDate);
    if (endDate) filtered = filtered.filter(p => p.submitDate <= endDate);

    return NextResponse.json({ policies: filtered, total: filtered.length });
  } catch (error) {
    console.error('Sales API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
