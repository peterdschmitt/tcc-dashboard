export const dynamic = 'force-dynamic';
import { readRawSheet, appendRow, updateRow, deleteRow, invalidateCache, ensureTabExists } from '@/lib/sheets';
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
    agentPayout: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.AGENT_PAYOUT_TAB || 'Agent Payout Rates',
    },
    excludedAgents: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.EXCLUDED_AGENTS_TAB || 'Excluded Agents',
    },
    aiRules: {
      sheetId: process.env.GOALS_SHEET_ID,
      tabName: process.env.AI_RULES_TAB || 'AI Analysis Rules',
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
      for (const sec of ['pricing', 'companyGoals', 'agentGoals', 'commission', 'agentPayout', 'excludedAgents', 'aiRules']) {
        try {
          const cfg = getSheetConfig(sec);
          const { headers, data } = await readRawSheet(cfg.sheetId, cfg.tabName);
          results[sec] = { headers, rows: data };
        } catch (err) {
          // Auto-create tabs that don't exist yet
          const autoCreateTabs = {
            excludedAgents: ['Agent Name', 'Reason'],
            aiRules: ['Table', 'Focus On', 'Ignore', 'Context'],
          };
          if (autoCreateTabs[sec] && err.message?.includes('Unable to parse range')) {
            try {
              const cfg = getSheetConfig(sec);
              await ensureTabExists(cfg.sheetId, cfg.tabName, autoCreateTabs[sec]);
              results[sec] = { headers: autoCreateTabs[sec], rows: [] };
            } catch (createErr) {
              console.log(`[settings] Could not auto-create ${sec}: ${createErr.message}`);
              results[sec] = { headers: [], rows: [], error: createErr.message };
            }
          } else {
            console.log(`[settings] Could not load ${sec}: ${err.message}`);
            results[sec] = { headers: [], rows: [], error: err.message };
          }
        }
      }
      return NextResponse.json(results);
    }

    const cfg = getSheetConfig(section);
    if (!cfg) return NextResponse.json({ error: 'Unknown section: ' + section }, { status: 400 });

    try {
      const { headers, data } = await readRawSheet(cfg.sheetId, cfg.tabName);
      return NextResponse.json({ headers, rows: data });
    } catch (readErr) {
      // Auto-create tabs that don't exist yet
      const autoCreateTabs = {
        excludedAgents: ['Agent Name', 'Reason'],
        aiRules: ['Table', 'Focus On', 'Ignore', 'Context'],
      };
      if (autoCreateTabs[section] && readErr.message?.includes('Unable to parse range')) {
        await ensureTabExists(cfg.sheetId, cfg.tabName, autoCreateTabs[section]);
        return NextResponse.json({ headers: autoCreateTabs[section], rows: [] });
      }
      throw readErr;
    }
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
      // Auto-create tab if needed (especially for excludedAgents)
      let headers;
      const autoCreateTabs = {
        excludedAgents: ['Agent Name', 'Reason'],
        aiRules: ['Table', 'Focus On', 'Ignore', 'Context'],
      };
      try {
        ({ headers } = await readRawSheet(cfg.sheetId, cfg.tabName));
      } catch (e) {
        if (autoCreateTabs[section]) {
          await ensureTabExists(cfg.sheetId, cfg.tabName, autoCreateTabs[section]);
          headers = autoCreateTabs[section];
        } else {
          throw e;
        }
      }
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
