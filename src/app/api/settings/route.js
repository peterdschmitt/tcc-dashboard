export const dynamic = 'force-dynamic';
export const dynamic = 'force-dynamic';
import { readRawSheet, appendRow, updateRow, deleteRow, invalidateCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

// Map section names to sheet IDs and tab names
function getSheetConfig(section) {
  const configs = {
    pricing: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.GOALS_PRICING_TAB || 'Publisher Pricing',
    },
    companyGoals: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.COMPANY_GOALS_TAB || 'Company Daily Goals',
    },
    agentGoals: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.AGENT_GOALS_TAB || 'Agent Daily Goals',
    },
    commission: {
      sheetId: process.env.COMMISSION_SHEET_ID,
      tabName: process.env.COMMISSION_TAB_NAME || 'Sheet1',
    },
  };
  return configs[section];
}

// GET — read a section
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const section = searchParams.get('section');

    if (section === 'all') {
      // Load all sections at once
      const results = {};
      for (const sec of ['pricing', 'companyGoals', 'agentGoals', 'commission']) {
        try {
          const cfg = getSheetConfig(sec);
          const { headers, data } = await readRawSheet(cfg.sheetId, cfg.tabName);
          results[sec] = { headers, rows: data };
        } catch (err) {
          console.log(`[settings] Could not load ${sec}: ${err.message}`);
          results[sec] = { headers: [], rows: [], error: err.message };
        }
      }
      return NextResponse.json(results);
    }

    const cfg = getSheetConfig(section);
    if (!cfg) return NextResponse.json({ error: 'Unknown section: ' + section }, { status: 400 });

    const { headers, data } = await readRawSheet(cfg.sheetId, cfg.tabName);
    return NextResponse.json({ headers, rows: data });
  } catch (error) {
    console.error('[settings] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — add, update, or delete a row
export async function POST(request) {
  try {
    const body = await request.json();
    const { section, action, rowData, rowNumber } = body;

    const cfg = getSheetConfig(section);
    if (!cfg) return NextResponse.json({ error: 'Unknown section: ' + section }, { status: 400 });

    if (action === 'add') {
      // Read current headers to know column order
      const { headers } = await readRawSheet(cfg.sheetId, cfg.tabName);
      await appendRow(cfg.sheetId, cfg.tabName, headers, rowData);
      return NextResponse.json({ success: true, action: 'added' });
    }

    if (action === 'update') {
      if (!rowNumber) return NextResponse.json({ error: 'rowNumber required for update' }, { status: 400 });
      const { headers } = await readRawSheet(cfg.sheetId, cfg.tabName);
      await updateRow(cfg.sheetId, cfg.tabName, rowNumber, headers, rowData);
      return NextResponse.json({ success: true, action: 'updated' });
    }

    if (action === 'delete') {
      if (!rowNumber) return NextResponse.json({ error: 'rowNumber required for delete' }, { status: 400 });
      await deleteRow(cfg.sheetId, cfg.tabName, rowNumber);
      return NextResponse.json({ success: true, action: 'deleted' });
    }

    return NextResponse.json({ error: 'Unknown action: ' + action }, { status: 400 });
  } catch (error) {
    console.error('[settings] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
