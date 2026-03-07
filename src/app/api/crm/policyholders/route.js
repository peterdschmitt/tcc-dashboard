export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status')?.split(',').map(s => s.trim()).filter(Boolean);
    const carrier = searchParams.get('carrier');
    const product = searchParams.get('product');
    const agent = searchParams.get('agent');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const sortField = searchParams.get('sort') || 'Issue Date';
    const sortDir = searchParams.get('dir') || 'desc';

    const policyholdersRaw = await fetchSheet(
      process.env.SALES_SHEET_ID,
      process.env.POLICYHOLDER_TAB_NAME || 'Policyholders',
      120
    );

    const today = new Date();

    let policyholders = policyholdersRaw
      .filter(r => r['Policy Number'] && r['Name'])
      .map(r => {
        const lastPremiumDate = parseFlexDate(r['Last Premium Date']);
        const daysSinceLastPayment = lastPremiumDate
          ? Math.floor((today - new Date(lastPremiumDate)) / (1000 * 60 * 60 * 24))
          : null;

        return {
          policyNumber: r['Policy Number']?.trim() || '',
          name: r['Name']?.trim() || '',
          status: r['Status']?.trim() || 'Active',
          statusChangeReason: r['Status Change Reason']?.trim() || '',
          statusChangeDate: parseFlexDate(r['Status Change Date']) || '',
          carrier: r['Carrier']?.trim() || '',
          product: r['Product']?.trim() || '',
          issueDate: parseFlexDate(r['Issue Date']) || '',
          agent: r['Agent']?.trim() || '',
          premium: parseFloat(r['Premium Amount']) || 0,
          lastPremiumDate: lastPremiumDate || '',
          daysSinceLastPayment,
          outreachAttempts: parseInt(r['Outreach Attempts']) || 0,
          lastOutreachDate: parseFlexDate(r['Last Outreach Date']) || '',
          lastOutreachMethod: r['Last Outreach Method']?.trim() || '',
          lastOutreachResult: r['Last Outreach Result']?.trim() || '',
          notes: r['Notes']?.trim() || '',
          _rowIndex: r._rowIndex,
        };
      });

    // Apply filters
    if (status && status.length > 0) {
      policyholders = policyholders.filter(p => status.includes(p.status));
    }
    if (carrier) {
      policyholders = policyholders.filter(p => p.carrier.toLowerCase().includes(carrier.toLowerCase()));
    }
    if (product) {
      policyholders = policyholders.filter(p => p.product.toLowerCase().includes(product.toLowerCase()));
    }
    if (agent) {
      policyholders = policyholders.filter(p => p.agent.toLowerCase().includes(agent.toLowerCase()));
    }
    if (startDate) {
      policyholders = policyholders.filter(p => p.issueDate >= startDate);
    }
    if (endDate) {
      policyholders = policyholders.filter(p => p.issueDate <= endDate);
    }

    // Sort
    policyholders.sort((a, b) => {
      let aVal = a[sortField === 'Issue Date' ? 'issueDate' : sortField];
      let bVal = b[sortField === 'Issue Date' ? 'issueDate' : sortField];

      if (typeof aVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Paginate
    const total = policyholders.length;
    const startIdx = (page - 1) * limit;
    const paginatedPolicyholders = policyholders.slice(startIdx, startIdx + limit);

    return NextResponse.json({
      policyholders: paginatedPolicyholders,
      total,
      page,
      pageSize: limit,
    });
  } catch (error) {
    console.error('[crm/policyholders] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
