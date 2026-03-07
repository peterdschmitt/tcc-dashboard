export const dynamic = 'force-dynamic';
import { fetchSheet, writeCell, invalidateCache } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { leadId } = params;

    const [leadsRaw, callsRaw, salesRaw] = await Promise.all([
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.LEADS_TAB_NAME || 'Leads', 120),
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.CALLLOGS_TAB_NAME || 'Report', 120),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1', 120),
    ]);

    // Find lead
    const leadRow = leadsRaw.find(r => r['Lead ID']?.trim() === leadId);
    if (!leadRow) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const lead = {
      leadId: leadRow['Lead ID']?.trim() || '',
      phone: leadRow['Phone Number']?.trim() || '',
      name: leadRow['Name']?.trim() || '',
      leadSource: leadRow['Lead Source']?.trim() || '',
      primaryAgent: leadRow['Primary Agent']?.trim() || '',
      status: leadRow['Status']?.trim() || 'New',
      firstContactDate: parseFlexDate(leadRow['First Contact Date']) || '',
      attempts: parseInt(leadRow['Attempts']) || 0,
      notes: leadRow['Notes']?.trim() || '',
      tags: leadRow['Tags']?.trim() || '',
      followUpDue: leadRow['Follow-Up Due']?.trim() || '',
      policyNumber: leadRow['Policy Number']?.trim() || '',
      doNotCall: (leadRow['Do Not Call'] || '').toLowerCase() === 'yes',
      _rowIndex: leadRow._rowIndex,
    };

    // Find recent calls by phone number
    const recentCalls = callsRaw
      .filter(c => {
        const callPhone = (c['Phone'] || c['Phone Number'] || '')
          .replace(/\D/g, '')
          .slice(-10);
        const leadPhone = lead.phone.replace(/\D/g, '').slice(-10);
        return callPhone === leadPhone;
      })
      .map(c => ({
        date: parseFlexDate(c['Date']) || '',
        rep: c['Rep']?.trim() || '',
        campaign: c['Campaign']?.trim() || '',
        duration: parseInt(c['Duration']) || 0,
        callStatus: c['Call Status']?.trim() || '',
        callType: c['Call Type']?.trim() || '',
        state: c['State']?.trim() || '',
        phone: c['Phone']?.trim() || '',
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    // Find linked policy if Policy Number is set
    let policy = null;
    if (lead.policyNumber) {
      const policyRow = salesRaw.find(r => r['Policy #']?.trim() === lead.policyNumber);
      if (policyRow) {
        policy = {
          policyNumber: policyRow['Policy #']?.trim() || '',
          carrier: policyRow['Carrier']?.trim() || '',
          effectiveDate: parseFlexDate(policyRow['Effective Date']) || '',
          status: policyRow['Placed?']?.trim() || '',
          premium: parseFloat(policyRow['Monthly Premium']) || 0,
          faceAmount: parseFloat(policyRow['Face Amount']) || 0,
        };
      }
    }

    return NextResponse.json({
      lead,
      recentCalls,
      policy,
    });
  } catch (error) {
    console.error('[crm/lead] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { leadId } = params;
    const body = await request.json();

    const leadsRaw = await fetchSheet(
      process.env.CALLLOGS_SHEET_ID,
      process.env.LEADS_TAB_NAME || 'Leads',
      120
    );

    const leadRow = leadsRaw.find(r => r['Lead ID']?.trim() === leadId);
    if (!leadRow) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const rowIndex = leadRow._rowIndex;
    const today = new Date().toISOString().split('T')[0];

    // Validate status change to Converted
    if (body.status === 'Converted' && !body.policyNumber) {
      return NextResponse.json({ error: 'Policy number required for Converted status' }, { status: 400 });
    }

    // Update fields
    const updates = {
      status: body.status,
      primaryAgent: body.primaryAgent,
      notes: body.notes,
      tags: body.tags,
      followUpDue: body.followUpDue,
      policyNumber: body.policyNumber,
      doNotCall: body.doNotCall ? 'Yes' : 'No',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const colNames = {
          status: 'Status',
          primaryAgent: 'Primary Agent',
          notes: 'Notes',
          tags: 'Tags',
          followUpDue: 'Follow-Up Due',
          policyNumber: 'Policy Number',
          doNotCall: 'Do Not Call',
        };
        if (value !== undefined) {
          await writeCell(
            process.env.CALLLOGS_SHEET_ID,
            process.env.LEADS_TAB_NAME || 'Leads',
            rowIndex,
            colNames[key],
            value ?? ''
          );
        }
      }
    }

    // If status changed to Converted, set conversion date
    if (body.status === 'Converted') {
      await writeCell(
        process.env.CALLLOGS_SHEET_ID,
        process.env.LEADS_TAB_NAME || 'Leads',
        rowIndex,
        'Conversion Date',
        today
      );
    }

    invalidateCache(process.env.CALLLOGS_SHEET_ID, process.env.LEADS_TAB_NAME || 'Leads');

    return NextResponse.json({
      leadId,
      ...updates,
      conversionDate: body.status === 'Converted' ? today : '',
    });
  } catch (error) {
    console.error('[crm/lead] PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
