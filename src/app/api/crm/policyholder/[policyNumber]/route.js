export const dynamic = 'force-dynamic';
import { fetchSheet, writeCell, appendRow, invalidateCache } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export async function GET(request, { params }) {
  try {
    const { policyNumber } = params;

    const [policyholdersRaw, salesRaw, tasksRaw] = await Promise.all([
      fetchSheet(process.env.SALES_SHEET_ID, process.env.POLICYHOLDER_TAB_NAME || 'Policyholders', 120),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1', 120),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.TASKS_TAB_NAME || 'Tasks', 120),
    ]);

    // Find policyholder
    const polRow = policyholdersRaw.find(r => r['Policy Number']?.trim() === policyNumber);
    if (!polRow) {
      return NextResponse.json({ error: 'Policyholder not found' }, { status: 404 });
    }

    const today = new Date();
    const lastPremiumDate = parseFlexDate(polRow['Last Premium Date']);
    const daysSinceLastPayment = lastPremiumDate
      ? Math.floor((today - new Date(lastPremiumDate)) / (1000 * 60 * 60 * 24))
      : null;

    const policyholder = {
      policyNumber: polRow['Policy Number']?.trim() || '',
      name: polRow['Name']?.trim() || '',
      status: polRow['Status']?.trim() || 'Active',
      statusChangeReason: polRow['Status Change Reason']?.trim() || '',
      statusChangeDate: parseFlexDate(polRow['Status Change Date']) || '',
      carrier: polRow['Carrier']?.trim() || '',
      product: polRow['Product']?.trim() || '',
      issueDate: parseFlexDate(polRow['Issue Date']) || '',
      agent: polRow['Agent']?.trim() || '',
      premium: parseFloat(polRow['Premium Amount']) || 0,
      lastPremiumDate: lastPremiumDate || '',
      daysSinceLastPayment,
      outreachAttempts: parseInt(polRow['Outreach Attempts']) || 0,
      lastOutreachDate: parseFlexDate(polRow['Last Outreach Date']) || '',
      lastOutreachMethod: polRow['Last Outreach Method']?.trim() || '',
      lastOutreachResult: polRow['Last Outreach Result']?.trim() || '',
      notes: polRow['Notes']?.trim() || '',
      _rowIndex: polRow._rowIndex,
    };

    // Find linked policy from sales sheet
    let policyDetails = null;
    const saleRow = salesRaw.find(r => r['Policy #']?.trim() === policyNumber);
    if (saleRow) {
      policyDetails = {
        policyNumber: saleRow['Policy #']?.trim() || '',
        carrier: saleRow['Carrier']?.trim() || '',
        product: saleRow['Carrier + Product + Payout']?.split(',')[1]?.trim() || '',
        effectiveDate: parseFlexDate(saleRow['Effective Date']) || '',
        status: saleRow['Placed?']?.trim() || '',
        premium: parseFloat(saleRow['Monthly Premium']) || 0,
        faceAmount: parseFloat(saleRow['Face Amount']) || 0,
      };
    }

    // Find outreach history (tasks linked to this policy)
    const outreachHistory = tasksRaw
      .filter(t => t['Entity ID']?.trim() === policyNumber && t['Entity Type']?.trim() === 'Policy')
      .map(t => ({
        taskId: t['Task ID']?.trim() || '',
        type: t['Type']?.trim() || '',
        status: t['Status']?.trim() || '',
        createdDate: parseFlexDate(t['Created Date']) || '',
        dueDate: parseFlexDate(t['Due Date']) || '',
        completedDate: parseFlexDate(t['Completed Date']) || '',
        assignedAgent: t['Assigned Agent']?.trim() || '',
        method: t['Method']?.trim() || '',
        result: t['Result']?.trim() || '',
        notes: t['Notes']?.trim() || '',
        attempts: parseInt(t['Attempts']) || 0,
      }))
      .sort((a, b) => b.createdDate.localeCompare(a.createdDate));

    return NextResponse.json({
      policyholder,
      policyDetails,
      outreachHistory,
    });
  } catch (error) {
    console.error('[crm/policyholder] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { policyNumber } = params;
    const body = await request.json();

    const policyholdersRaw = await fetchSheet(
      process.env.SALES_SHEET_ID,
      process.env.POLICYHOLDER_TAB_NAME || 'Policyholders',
      120
    );

    const polRow = policyholdersRaw.find(r => r['Policy Number']?.trim() === policyNumber);
    if (!polRow) {
      return NextResponse.json({ error: 'Policyholder not found' }, { status: 404 });
    }

    const rowIndex = polRow._rowIndex;
    const today = new Date().toISOString().split('T')[0];

    // Update fields
    const updates = {
      status: body.status,
      statusChangeReason: body.statusChangeReason,
      lastPremiumDate: body.lastPremiumDate,
      lastOutreachDate: body.lastOutreachDate,
      lastOutreachMethod: body.lastOutreachMethod,
      lastOutreachResult: body.lastOutreachResult,
      notes: body.notes,
    };

    const colMap = {
      status: 'Status',
      statusChangeReason: 'Status Change Reason',
      lastPremiumDate: 'Last Premium Date',
      lastOutreachDate: 'Last Outreach Date',
      lastOutreachMethod: 'Last Outreach Method',
      lastOutreachResult: 'Last Outreach Result',
      notes: 'Notes',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        await writeCell(
          process.env.SALES_SHEET_ID,
          process.env.POLICYHOLDER_TAB_NAME || 'Policyholders',
          rowIndex,
          colMap[key],
          value ?? ''
        );
      }
    }

    // If status changed to Lapsed, set status change date and create win-back task
    if (body.status === 'Lapsed') {
      await writeCell(
        process.env.SALES_SHEET_ID,
        process.env.POLICYHOLDER_TAB_NAME || 'Policyholders',
        rowIndex,
        'Status Change Date',
        today
      );

      // Create win-back task
      const taskId = randomUUID();
      const taskHeaders = [
        'Task ID', 'Type', 'Entity ID', 'Entity Type', 'Assigned Agent',
        'Due Date', 'Status', 'Created Date', 'Completed Date', 'Method',
        'Result', 'Notes', 'Attempts',
      ];

      const taskValues = {
        'Task ID': taskId,
        'Type': 'Win-Back',
        'Entity ID': policyNumber,
        'Entity Type': 'Policy',
        'Assigned Agent': polRow['Agent']?.trim() || '',
        'Due Date': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        'Status': 'Not Started',
        'Created Date': today,
        'Completed Date': '',
        'Method': '',
        'Result': '',
        'Notes': `Auto-created win-back task for lapsed policy ${policyNumber}`,
        'Attempts': '0',
      };

      await appendRow(
        process.env.SALES_SHEET_ID,
        process.env.TASKS_TAB_NAME || 'Tasks',
        taskHeaders,
        taskValues
      );

      invalidateCache(process.env.SALES_SHEET_ID, process.env.TASKS_TAB_NAME || 'Tasks');
    }

    // If outreach is being logged, increment attempts
    if (body.lastOutreachDate || body.lastOutreachMethod) {
      const currentAttempts = parseInt(polRow['Outreach Attempts']) || 0;
      await writeCell(
        process.env.SALES_SHEET_ID,
        process.env.POLICYHOLDER_TAB_NAME || 'Policyholders',
        rowIndex,
        'Outreach Attempts',
        (currentAttempts + 1).toString()
      );
    }

    invalidateCache(process.env.SALES_SHEET_ID, process.env.POLICYHOLDER_TAB_NAME || 'Policyholders');

    return NextResponse.json({
      policyNumber,
      ...updates,
      statusChangeDate: body.status === 'Lapsed' ? today : '',
    });
  } catch (error) {
    console.error('[crm/policyholder] PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
