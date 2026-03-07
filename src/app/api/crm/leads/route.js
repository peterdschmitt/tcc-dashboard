export const dynamic = 'force-dynamic';
import { fetchSheet, appendRow, invalidateCache } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status')?.split(',').map(s => s.trim()).filter(Boolean);
    const agent = searchParams.get('agent');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const sortField = searchParams.get('sort') || 'First Contact Date';
    const sortDir = searchParams.get('dir') || 'desc';

    const leadsRaw = await fetchSheet(
      process.env.CALLLOGS_SHEET_ID,
      process.env.LEADS_TAB_NAME || 'Leads',
      120
    );

    let leads = leadsRaw
      .filter(r => r['Lead ID'] && r['Phone Number'])
      .map(r => ({
        leadId: r['Lead ID']?.trim() || '',
        phone: r['Phone Number']?.trim() || '',
        name: r['Name']?.trim() || '',
        leadSource: r['Lead Source']?.trim() || '',
        primaryAgent: r['Primary Agent']?.trim() || '',
        status: r['Status']?.trim() || 'New',
        firstContactDate: parseFlexDate(r['First Contact Date']) || '',
        attempts: parseInt(r['Attempts']) || 0,
        notes: r['Notes']?.trim() || '',
        tags: r['Tags']?.trim() || '',
        followUpDue: r['Follow-Up Due']?.trim() || '',
        policyNumber: r['Policy Number']?.trim() || '',
        doNotCall: (r['Do Not Call'] || '').toLowerCase() === 'yes',
        _rowIndex: r._rowIndex,
      }));

    // Apply filters
    if (status && status.length > 0) {
      leads = leads.filter(l => status.includes(l.status));
    }
    if (agent) {
      leads = leads.filter(l => l.primaryAgent.toLowerCase().includes(agent.toLowerCase()));
    }
    if (startDate) {
      leads = leads.filter(l => l.firstContactDate >= startDate);
    }
    if (endDate) {
      leads = leads.filter(l => l.firstContactDate <= endDate);
    }

    // Sort
    leads.sort((a, b) => {
      let aVal = a[sortField === 'First Contact Date' ? 'firstContactDate' : sortField];
      let bVal = b[sortField === 'First Contact Date' ? 'firstContactDate' : sortField];

      if (typeof aVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Paginate
    const total = leads.length;
    const startIdx = (page - 1) * limit;
    const paginatedLeads = leads.slice(startIdx, startIdx + limit);

    return NextResponse.json({
      leads: paginatedLeads,
      total,
      page,
      pageSize: limit,
    });
  } catch (error) {
    console.error('[crm/leads] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, name, leadSource, primaryAgent, notes, tags } = body;

    if (!phone || !name) {
      return NextResponse.json({ error: 'Phone and name required' }, { status: 400 });
    }

    const leadId = randomUUID();
    const today = new Date().toISOString().split('T')[0];

    const headers = [
      'Lead ID', 'Phone Number', 'Name', 'Lead Source', 'Primary Agent',
      'Status', 'First Contact Date', 'Attempts', 'Notes', 'Tags',
      'Follow-Up Due', 'Policy Number', 'Do Not Call',
    ];

    const values = {
      'Lead ID': leadId,
      'Phone Number': phone,
      'Name': name,
      'Lead Source': leadSource || '',
      'Primary Agent': primaryAgent || '',
      'Status': 'New',
      'First Contact Date': today,
      'Attempts': '0',
      'Notes': notes || '',
      'Tags': tags || '',
      'Follow-Up Due': '',
      'Policy Number': '',
      'Do Not Call': 'No',
    };

    await appendRow(
      process.env.CALLLOGS_SHEET_ID,
      process.env.LEADS_TAB_NAME || 'Leads',
      headers,
      values
    );

    return NextResponse.json({
      leadId,
      phone,
      name,
      leadSource: leadSource || '',
      primaryAgent: primaryAgent || '',
      status: 'New',
      firstContactDate: today,
      attempts: 0,
      notes: notes || '',
      tags: tags || '',
    });
  } catch (error) {
    console.error('[crm/leads] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
