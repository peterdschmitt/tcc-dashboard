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
    const type = searchParams.get('type');
    const dueDateStart = searchParams.get('dueDateStart');
    const dueDateEnd = searchParams.get('dueDateEnd');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const sortField = searchParams.get('sort') || 'Due Date';
    const sortDir = searchParams.get('dir') || 'asc';

    const tasksRaw = await fetchSheet(
      process.env.SALES_SHEET_ID,
      process.env.TASKS_TAB_NAME || 'Outreach Tasks',
      120
    );

    let tasks = tasksRaw
      .filter(r => r['Task ID'] && r['Type'])
      .map(r => ({
        taskId: r['Task ID']?.trim() || '',
        type: r['Type']?.trim() || '',
        entityId: r['Entity ID']?.trim() || '',
        entityType: r['Entity Type']?.trim() || '',
        assignedAgent: r['Assigned Agent']?.trim() || '',
        dueDate: parseFlexDate(r['Due Date']) || '',
        status: r['Status']?.trim() || 'Not Started',
        createdDate: parseFlexDate(r['Created Date']) || '',
        completedDate: parseFlexDate(r['Completed Date']) || '',
        method: r['Method']?.trim() || '',
        result: r['Result']?.trim() || '',
        notes: r['Notes']?.trim() || '',
        attempts: parseInt(r['Attempts']) || 0,
        _rowIndex: r._rowIndex,
      }));

    // Apply filters
    if (status && status.length > 0) {
      tasks = tasks.filter(t => status.includes(t.status));
    }
    if (agent) {
      tasks = tasks.filter(t => t.assignedAgent.toLowerCase().includes(agent.toLowerCase()));
    }
    if (type) {
      tasks = tasks.filter(t => t.type.toLowerCase().includes(type.toLowerCase()));
    }
    if (dueDateStart) {
      tasks = tasks.filter(t => t.dueDate >= dueDateStart);
    }
    if (dueDateEnd) {
      tasks = tasks.filter(t => t.dueDate <= dueDateEnd);
    }

    // Sort
    tasks.sort((a, b) => {
      let aVal = a[sortField === 'Due Date' ? 'dueDate' : sortField];
      let bVal = b[sortField === 'Due Date' ? 'dueDate' : sortField];

      if (typeof aVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Paginate
    const total = tasks.length;
    const startIdx = (page - 1) * limit;
    const paginatedTasks = tasks.slice(startIdx, startIdx + limit);

    return NextResponse.json({
      tasks: paginatedTasks,
      total,
      page,
      pageSize: limit,
    });
  } catch (error) {
    console.error('[crm/tasks] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { type, entityId, entityType, assignedAgent, dueDate, notes } = body;

    if (!type || !entityId || !entityType) {
      return NextResponse.json(
        { error: 'type, entityId, and entityType required' },
        { status: 400 }
      );
    }

    const taskId = randomUUID();
    const today = new Date().toISOString().split('T')[0];

    const headers = [
      'Task ID', 'Type', 'Entity ID', 'Entity Type', 'Assigned Agent',
      'Due Date', 'Status', 'Created Date', 'Completed Date', 'Method',
      'Result', 'Notes', 'Attempts',
    ];

    const values = {
      'Task ID': taskId,
      'Type': type,
      'Entity ID': entityId,
      'Entity Type': entityType,
      'Assigned Agent': assignedAgent || '',
      'Due Date': dueDate || '',
      'Status': 'Not Started',
      'Created Date': today,
      'Completed Date': '',
      'Method': '',
      'Result': '',
      'Notes': notes || '',
      'Attempts': '0',
    };

    await appendRow(
      process.env.SALES_SHEET_ID,
      process.env.TASKS_TAB_NAME || 'Outreach Tasks',
      headers,
      values
    );

    return NextResponse.json({
      taskId,
      type,
      entityId,
      entityType,
      assignedAgent: assignedAgent || '',
      dueDate: dueDate || '',
      status: 'Not Started',
      createdDate: today,
      notes: notes || '',
      attempts: 0,
    });
  } catch (error) {
    console.error('[crm/tasks] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
