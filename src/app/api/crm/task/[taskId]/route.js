export const dynamic = 'force-dynamic';
import { fetchSheet, writeCell, invalidateCache } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function PUT(request, { params }) {
  try {
    const { taskId } = params;
    const body = await request.json();

    const tasksRaw = await fetchSheet(
      process.env.SALES_SHEET_ID,
      process.env.TASKS_TAB_NAME || 'Outreach Tasks',
      120
    );

    const taskRow = tasksRaw.find(r => r['Task ID']?.trim() === taskId);
    if (!taskRow) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const rowIndex = taskRow._rowIndex;
    const today = new Date().toISOString().split('T')[0];

    // Update fields
    const updates = {
      status: body.status,
      outcome: body.outcome,
      completedDate: body.completedDate,
      method: body.method,
      notes: body.notes,
      attempts: body.attempts,
    };

    const colMap = {
      status: 'Status',
      outcome: 'Result',
      completedDate: 'Completed Date',
      method: 'Method',
      notes: 'Notes',
      attempts: 'Attempts',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        await writeCell(
          process.env.SALES_SHEET_ID,
          process.env.TASKS_TAB_NAME || 'Outreach Tasks',
          rowIndex,
          colMap[key],
          value ?? ''
        );
      }
    }

    // If status is Completed and no completedDate provided, set it to today
    if (body.status === 'Completed' && !body.completedDate) {
      await writeCell(
        process.env.SALES_SHEET_ID,
        process.env.TASKS_TAB_NAME || 'Outreach Tasks',
        rowIndex,
        'Completed Date',
        today
      );
    }

    invalidateCache(process.env.SALES_SHEET_ID, process.env.TASKS_TAB_NAME || 'Outreach Tasks');

    return NextResponse.json({
      taskId,
      ...updates,
      completedDate: body.status === 'Completed' && !body.completedDate ? today : body.completedDate,
    });
  } catch (error) {
    console.error('[crm/task] PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
