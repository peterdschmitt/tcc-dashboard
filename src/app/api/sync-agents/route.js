export const dynamic = 'force-dynamic';
import { fetchSheet, ensureAgentsExist, writeCell, deleteRow, invalidateCache } from '@/lib/sheets';
import { fuzzyMatchAgent } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
    const callsSheetId = process.env.CALLLOGS_SHEET_ID;
    const callsTab = process.env.CALLLOGS_TAB_NAME || 'Report';
    const goalsSheetId = process.env.GOALS_SHEET_ID;
    const agentTab = process.env.AGENT_GOALS_TAB || 'Agent Daily Goals';

    // Bust cache so we get the full historical dataset
    invalidateCache(salesSheetId, salesTab);
    invalidateCache(callsSheetId, callsTab);
    invalidateCache(goalsSheetId, agentTab);

    const [salesRaw, callsRaw, agentGoalsRaw] = await Promise.all([
      fetchSheet(salesSheetId, salesTab),
      fetchSheet(callsSheetId, callsTab),
      fetchSheet(goalsSheetId, agentTab).catch(() => []),
    ]);

    // Canonical agent names from the sales sheet
    const salesNames = [...new Set(
      salesRaw.map(r => (r['Agent'] || '').trim()).filter(Boolean)
    )];

    // Normalize call log rep names against sales names — collapses Bill→William, Kari M→Karina Maso, etc.
    const seen = new Set(salesNames.map(n => n.toLowerCase()));
    const combinedNames = [...salesNames];

    for (const row of callsRaw) {
      const rep = (row['Rep'] || '').trim();
      if (!rep) continue;
      const matched = fuzzyMatchAgent(rep, salesNames);
      const canonical = matched || rep;
      if (!seen.has(canonical.toLowerCase())) {
        seen.add(canonical.toLowerCase());
        combinedNames.push(canonical);
      }
    }

    console.log(`[sync-agents] ${salesNames.length} from sales + ${combinedNames.length - salesNames.length} unique from calls = ${combinedNames.length} total`);

    let currentGoals = agentGoalsRaw;
    let deletedCount = 0;

    // ── Step 1: Delete broken rows (Agent Name = "Commission" from earlier bug) ──
    const KNOWN_BAD_NAMES = new Set(['commission', 'salary', 'commission type', '']);
    const brokenRows = currentGoals
      .filter(r => {
        const name = (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim().toLowerCase();
        return name && KNOWN_BAD_NAMES.has(name);
      })
      .sort((a, b) => b._rowIndex - a._rowIndex);
    for (const row of brokenRows) {
      await deleteRow(goalsSheetId, agentTab, row._rowIndex);
    }
    if (brokenRows.length > 0) {
      console.log(`[sync-agents] Deleted ${brokenRows.length} broken row(s)`);
      deletedCount += brokenRows.length;
      invalidateCache(goalsSheetId, agentTab);
      currentGoals = await fetchSheet(goalsSheetId, agentTab).catch(() => []);
    }

    // ── Step 2: Delete duplicate rows (non-canonical names that resolve to a canonical) ──
    // e.g., "Bill Shansky" row → fuzzy-resolves to "William Shansky" → delete Bill's row
    // e.g., "Kari M" row → resolves to "Karina Maso" → delete Kari M row
    const canonicalSet = new Set(combinedNames.map(n => n.toLowerCase()));
    const duplicateRows = currentGoals
      .filter(r => {
        const name = (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim();
        if (!name) return false;
        if (canonicalSet.has(name.toLowerCase())) return false; // already a canonical name
        const resolved = fuzzyMatchAgent(name, combinedNames);
        // If fuzzy match resolves to a DIFFERENT canonical name → this row is a duplicate
        return resolved && resolved.toLowerCase() !== name.toLowerCase();
      })
      .sort((a, b) => b._rowIndex - a._rowIndex);
    for (const row of duplicateRows) {
      const name = row['Agent Name'] || row['Agent'] || row['Name'] || '';
      console.log(`[sync-agents] Deleting duplicate row: "${name}"`);
      await deleteRow(goalsSheetId, agentTab, row._rowIndex);
    }
    if (duplicateRows.length > 0) {
      deletedCount += duplicateRows.length;
      invalidateCache(goalsSheetId, agentTab);
      currentGoals = await fetchSheet(goalsSheetId, agentTab).catch(() => []);
    }

    // ── Step 3: Add any missing canonical agents ─────────────────────────────
    const existingNames = new Set(
      currentGoals.map(r => (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim().toLowerCase())
    );
    const missing = combinedNames.filter(n => !existingNames.has(n.toLowerCase()));
    await ensureAgentsExist(goalsSheetId, agentTab, combinedNames, currentGoals);

    // ── Step 4: Backfill Commission Type for any rows where it's blank ────────
    invalidateCache(goalsSheetId, agentTab);
    const freshGoals = await fetchSheet(goalsSheetId, agentTab);
    const needsBackfill = freshGoals.filter(r => {
      const name = (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim();
      return name && !(r['Commission Type'] || '').trim();
    });
    for (const row of needsBackfill) {
      await writeCell(goalsSheetId, agentTab, row._rowIndex, 'Commission Type', 'Commission');
    }
    if (needsBackfill.length > 0) {
      console.log(`[sync-agents] Backfilled Commission Type for ${needsBackfill.length} agents`);
    }

    return NextResponse.json({
      ok: true,
      total: combinedNames.length,
      added: missing.length,
      deleted: deletedCount,
      backfilled: needsBackfill.length,
      agents: missing,
    });
  } catch (error) {
    console.error('[sync-agents] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
