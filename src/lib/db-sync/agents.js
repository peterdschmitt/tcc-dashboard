// src/lib/db-sync/agents.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Sync agents from:
 *   - Goals sheet "Agent Daily Goals" tab (canonical names + goals)
 *   - Sales Tracker `Agent` column (any agent who's written a policy)
 *   - Call Logs `Rep` column (any rep who's worked a call)
 *
 * Strategy: collect ALL distinct names from these three sources, upsert
 * by canonical_name. The Goals tab is authoritative for canonical_name +
 * goals; other sources contribute names that go into nicknames if they
 * don't match the canonical list directly.
 *
 * Returns { processed, inserted, updated }.
 */
export async function syncAgents() {
  const goalsId = process.env.GOALS_SHEET_ID;
  const goalsTab = process.env.GOALS_AGENT_TAB || 'Agent Daily Goals';
  const salesId = process.env.SALES_SHEET_ID;
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
  const callLogsId = process.env.CALLLOGS_SHEET_ID;
  const callLogsTab = process.env.CALLLOGS_TAB_NAME || 'Report';

  // Authoritative list from Goals
  const { data: goalsData } = await readRawSheet(goalsId, goalsTab);
  const canonical = new Map(); // name → { goals }
  for (const row of goalsData) {
    const name = (row['Agent Name'] ?? '').trim();
    if (!name) continue;
    canonical.set(name, {
      dailyPremiumGoal: parseFloat((row['Premium/Day ($)'] ?? '0').toString().replace(/[^0-9.]/g, '')) || null,
      dailyAppsGoal: parseInt(row['Apps/Day'] ?? '0', 10) || null,
    });
  }

  // Other names from Sales + Call Logs
  const otherNames = new Set();
  const { data: salesData } = await readRawSheet(salesId, salesTab);
  for (const row of salesData) {
    const n = (row['Agent'] ?? '').trim();
    if (n && !canonical.has(n)) otherNames.add(n);
  }
  const { data: callData } = await readRawSheet(callLogsId, callLogsTab);
  for (const row of callData) {
    const n = (row['Rep'] ?? '').trim();
    if (n && !canonical.has(n)) otherNames.add(n);
  }

  let inserted = 0, updated = 0;

  // Insert canonical agents
  for (const [name, goals] of canonical) {
    const r = await sql`
      INSERT INTO agents (canonical_name, daily_premium_goal, daily_apps_goal)
      VALUES (${name}, ${goals.dailyPremiumGoal}, ${goals.dailyAppsGoal})
      ON CONFLICT (canonical_name) DO UPDATE SET
        daily_premium_goal = EXCLUDED.daily_premium_goal,
        daily_apps_goal = EXCLUDED.daily_apps_goal,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  // Insert non-canonical names. They go in as their own row with no goals;
  // an operator can later merge them by hand if they're nicknames of a canonical agent.
  for (const name of otherNames) {
    const r = await sql`
      INSERT INTO agents (canonical_name)
      VALUES (${name})
      ON CONFLICT (canonical_name) DO NOTHING
      RETURNING id
    `;
    if (r.length > 0) inserted++;
  }

  return { processed: canonical.size + otherNames.size, inserted, updated };
}
