export const dynamic = 'force-dynamic';
import { fetchSheet, readRawSheet, getSheetsClient, invalidateCache, colIndexToLetter } from '@/lib/sheets';
import { parseFlexDate, fuzzyMatchPolicyholder, mapCarrierStatusToPlaced } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// Map carrier status labels to CRM retention statuses
function mapCarrierStatus(carrierStatus, currentCrmStatus) {
  const s = (carrierStatus || '').trim().toLowerCase();
  if (s === 'active')    return 'Active';
  if (s === 'pending')   return 'Pending';
  if (s === 'canceled' || s === 'cancelled' || s === 'terminated' || s === 'lapsed')  return 'Lapsed';
  if (s === 'declined' || s === 'not taken' || s === 'rejected')  return 'Declined';
  if (s === 'reinstated') return 'Reinstated';
  return currentCrmStatus || carrierStatus || 'Unknown';
}

function isLapseEvent(prev, next) {
  return ['Active', 'Pending', 'Reinstated'].includes(prev) && ['Lapsed', 'Declined'].includes(next);
}
function isReinstatement(prev, next) {
  return ['Lapsed', 'Declined', 'Win-Back', 'At-Risk'].includes(prev) && next === 'Reinstated';
}
function getFutureDate(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const POLICYHOLDER_HEADERS = [
  'Policy Number', 'Name', 'Status', 'Carrier Status', 'Status Change Reason',
  'Status Change Date', 'Carrier', 'Product', 'Issue Date', 'Effective Date',
  'Submitted Date', 'Agent', 'Premium Amount', 'Last Premium Date',
  'Outreach Attempts', 'Last Outreach Date', 'Last Outreach Method',
  'Last Outreach Result', 'Notes', 'Phone', 'Email', 'Birthdate',
  'Address 1', 'Address 2', 'City', 'State', 'Zip',
  'Writing No', 'Split', 'Issued State', 'Enrollment', 'MS Plan',
  'Carrier Notes', 'Last Sync Date',
];

const TASKS_HEADERS = [
  'Task ID', 'Type', 'Entity ID', 'Entity Type', 'Assigned Agent',
  'Due Date', 'Status', 'Created Date', 'Completed Date',
  'Method', 'Result', 'Notes', 'Attempts',
];

// ─── GET: Fetch sync status ────────────────────────────────────────────
export async function GET() {
  try {
    const sheetId = process.env.GOALS_SHEET_ID;
    const syncTab = process.env.SYNC_LOG_TAB_NAME || 'Sync Log';
    let lastSync = null;
    try {
      const syncLog = await fetchSheet(sheetId, syncTab, 60);
      if (syncLog.length > 0) {
        const last = syncLog[syncLog.length - 1];
        lastSync = {
          date: last['Sync Date'] || '',
          policiesProcessed: parseInt(last['Policies Processed']) || 0,
          newPolicies: parseInt(last['New Policies']) || 0,
          statusChanges: parseInt(last['Status Changes']) || 0,
          lapseEvents: parseInt(last['Lapse Events']) || 0,
          reinstatements: parseInt(last['Reinstatements']) || 0,
          errors: parseInt(last['Errors']) || 0,
        };
      }
    } catch (e) { /* Sync log tab may not exist yet */ }
    return NextResponse.json({ lastSync });
  } catch (error) {
    console.error('[crm/carrier-sync] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── POST: Run carrier report sync (BATCHED) ──────────────────────────
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const updateMerged = body.updateMerged === true;

    const carrierSheetId = process.env.CARRIER_REPORT_SHEET_ID;
    const carrierTab = process.env.CARRIER_REPORT_TAB_NAME || 'Policies';
    if (!carrierSheetId) {
      return NextResponse.json({ error: 'CARRIER_REPORT_SHEET_ID not configured' }, { status: 400 });
    }

    const salesSheetId = process.env.SALES_SHEET_ID;
    const phTab = process.env.POLICYHOLDER_TAB_NAME || 'Policyholders';
    const tasksTab = process.env.TASKS_TAB_NAME || 'Outreach Tasks';
    const today = new Date().toISOString().split('T')[0];

    console.log('[carrier-sync] Starting sync...');

    // ── 1. Read carrier report and existing policyholders in parallel ───
    const [carrierData, existingRaw] = await Promise.all([
      fetchSheet(carrierSheetId, carrierTab, 0),
      readRawSheet(salesSheetId, phTab).catch(() => ({ headers: [], data: [] })),
    ]);
    invalidateCache(carrierSheetId, carrierTab);

    if (!carrierData || carrierData.length === 0) {
      return NextResponse.json({ error: 'Carrier report is empty' }, { status: 400 });
    }

    const existingPH = existingRaw.data || [];
    console.log(`[carrier-sync] ${carrierData.length} carrier rows, ${existingPH.length} existing policyholders`);

    // Build lookup by Policy Number
    const phByPolicy = {};
    existingPH.forEach(row => {
      const pn = (row['Policy Number'] || '').trim();
      if (pn) phByPolicy[pn] = row;
    });

    // ── 2. Process all rows in memory (no API calls yet) ───────────────
    const newRows = [];       // rows to append to Policyholders
    const updateBatch = [];   // {range, values} for batch update
    const newTasks = [];      // rows to append to Outreach Tasks
    const results = {
      processed: 0, newPolicies: 0, updated: 0,
      statusChanges: [], lapseEvents: [], reinstatements: [], errors: [],
    };

    for (const cr of carrierData) {
      results.processed++;
      const policyNo = (cr['Policy No.'] || '').trim();
      if (!policyNo) { results.errors.push({ row: cr._rowIndex, error: 'Missing Policy No.' }); continue; }

      try {
        const carrierStatus = (cr['Status'] || '').trim();
        const newCrmStatus = mapCarrierStatus(carrierStatus);
        const annualPremium = parseFloat(cr['Annual Premium']) || 0;
        const monthlyPremium = Math.round((annualPremium / 12) * 100) / 100;
        const existing = phByPolicy[policyNo];

        if (!existing) {
          // ── NEW POLICY ─────────────────────────────────────────────
          const row = POLICYHOLDER_HEADERS.map(h => '');
          const set = (h, v) => { const i = POLICYHOLDER_HEADERS.indexOf(h); if (i >= 0) row[i] = v; };
          set('Policy Number', policyNo);
          set('Name', (cr['Insured'] || '').trim());
          set('Status', newCrmStatus);
          set('Carrier Status', carrierStatus);
          set('Carrier', (cr['Carrier'] || '').trim());
          set('Product', (cr['Product'] || '').trim());
          set('Agent', (cr['Agent'] || '').trim());
          set('Premium Amount', monthlyPremium.toString());
          set('Issue Date', parseFlexDate(cr['Issued']) || '');
          set('Effective Date', parseFlexDate(cr['Effective']) || '');
          set('Submitted Date', parseFlexDate(cr['Submitted']) || '');
          set('Phone', (cr['Phone'] || '').trim());
          set('Email', (cr['Email'] || '').trim());
          set('Birthdate', (cr['Birthdate'] || '').trim());
          set('Address 1', (cr['Address 1'] || '').trim());
          set('Address 2', (cr['Address 2'] || '').trim());
          set('City', (cr['City'] || '').trim());
          set('State', (cr['State'] || cr['Issued State'] || '').trim());
          set('Zip', (cr['Zip'] || '').trim());
          set('Writing No', (cr['Writing No.'] || '').trim());
          set('Split', (cr['Split'] || '').trim());
          set('Issued State', (cr['Issued State'] || '').trim());
          set('Enrollment', (cr['Enrollment'] || '').trim());
          set('MS Plan', (cr['MS Plan'] || '').trim());
          set('Carrier Notes', (cr['Notes'] || '').trim());
          set('Last Sync Date', today);
          set('Status Change Date', today);
          newRows.push(row);

          if (['Lapsed', 'Declined'].includes(newCrmStatus)) {
            newTasks.push(makeTaskRow(policyNo, (cr['Agent'] || '').trim(), today,
              `Auto-created: New policy ${policyNo} imported with ${carrierStatus} status`));
            results.lapseEvents.push({
              policyNumber: policyNo, name: (cr['Insured'] || '').trim(),
              carrier: (cr['Carrier'] || '').trim(), carrierStatus, premium: monthlyPremium,
            });
          }
          results.newPolicies++;

        } else {
          // ── EXISTING POLICY: build update row ──────────────────────
          const prevCrmStatus = (existing['Status'] || '').trim();
          const prevCarrierStatus = (existing['Carrier Status'] || '').trim();
          const rowIdx = existing._rowIndex;

          // Build the full updated row array from existing data + carrier updates
          const updatedRow = POLICYHOLDER_HEADERS.map(h => existing[h] || '');
          const setU = (h, v) => { const i = POLICYHOLDER_HEADERS.indexOf(h); if (i >= 0) updatedRow[i] = v; };

          // Always update sync date and carrier status
          setU('Carrier Status', carrierStatus);
          setU('Last Sync Date', today);

          // Carrier report is source of truth — overwrite all carrier-provided fields
          const carrierOverrides = {
            'Phone': 'Phone', 'Email': 'Email', 'Address 1': 'Address 1',
            'Address 2': 'Address 2', 'City': 'City', 'State': 'State', 'Zip': 'Zip',
            'Insured': 'Name', 'Carrier': 'Carrier', 'Product': 'Product',
            'Agent': 'Agent', 'Birthdate': 'Birthdate',
            'Writing No.': 'Writing No', 'Split': 'Split',
            'Issued State': 'Issued State', 'Enrollment': 'Enrollment',
            'MS Plan': 'MS Plan', 'Notes': 'Carrier Notes',
          };
          for (const [crField, phField] of Object.entries(carrierOverrides)) {
            const newVal = (cr[crField] || '').trim();
            if (newVal && newVal !== 'NA') {
              setU(phField, newVal);
            }
          }

          // Carrier dates are truth
          const issuedDate = parseFlexDate(cr['Issued']);
          if (issuedDate) setU('Issue Date', issuedDate);
          const effectiveDate = parseFlexDate(cr['Effective']);
          if (effectiveDate) setU('Effective Date', effectiveDate);
          const submittedDate = parseFlexDate(cr['Submitted']);
          if (submittedDate) setU('Submitted Date', submittedDate);

          // Update premium if carrier provides it (carrier is truth)
          if (monthlyPremium > 0) {
            setU('Premium Amount', monthlyPremium.toString());
          }

          // Detect status changes
          let changed = false;
          if (carrierStatus !== prevCarrierStatus) {
            const newMappedStatus = mapCarrierStatus(carrierStatus, prevCrmStatus);
            const shouldUpdate = newMappedStatus !== prevCrmStatus && !['Win-Back'].includes(prevCrmStatus);

            if (shouldUpdate) {
              setU('Status', newMappedStatus);
              setU('Status Change Date', today);
              setU('Status Change Reason', `Carrier: ${prevCarrierStatus} → ${carrierStatus}`);

              results.statusChanges.push({
                policyNumber: policyNo,
                name: (existing['Name'] || cr['Insured'] || '').trim(),
                carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                agent: (existing['Agent'] || cr['Agent'] || '').trim(),
                previousStatus: prevCrmStatus, newStatus: newMappedStatus,
                carrierStatusFrom: prevCarrierStatus, carrierStatusTo: carrierStatus,
                premium: monthlyPremium,
              });

              if (isLapseEvent(prevCrmStatus, newMappedStatus)) {
                newTasks.push(makeTaskRow(policyNo, (existing['Agent'] || cr['Agent'] || '').trim(), today,
                  `Auto-created: Carrier status ${prevCarrierStatus} → ${carrierStatus}`));
                results.lapseEvents.push({
                  policyNumber: policyNo, name: (existing['Name'] || cr['Insured'] || '').trim(),
                  carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                  agent: (existing['Agent'] || cr['Agent'] || '').trim(),
                  previousStatus: prevCrmStatus, newStatus: newMappedStatus, premium: monthlyPremium,
                });
              }
              if (isReinstatement(prevCrmStatus, newMappedStatus)) {
                results.reinstatements.push({
                  policyNumber: policyNo, name: (existing['Name'] || cr['Insured'] || '').trim(),
                  carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                  previousStatus: prevCrmStatus, newStatus: newMappedStatus, premium: monthlyPremium,
                });
              }
              changed = true;
            }
          }

          // Queue the row update (single API call per row, but we batch them)
          const lastCol = colIndexToLetter(POLICYHOLDER_HEADERS.length);
          updateBatch.push({
            range: `'${phTab}'!A${rowIdx}:${lastCol}${rowIdx}`,
            values: [updatedRow],
          });
          if (changed) results.updated++;
        }
      } catch (err) {
        console.error(`[carrier-sync] Error on ${policyNo}:`, err.message);
        results.errors.push({ policyNumber: policyNo, error: err.message });
      }
    }

    // ── 3. Execute all writes in 3 batch API calls ─────────────────────
    if (!dryRun) {
      const sheets = await getSheetsClient();

      // Batch 1: Append all new policyholder rows at once
      if (newRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: salesSheetId,
          range: phTab,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: newRows },
        });
        console.log(`[carrier-sync] Appended ${newRows.length} new policyholders`);
      }

      // Batch 2: Update all existing rows at once
      if (updateBatch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: salesSheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updateBatch,
          },
        });
        console.log(`[carrier-sync] Updated ${updateBatch.length} existing policyholders`);
      }

      // Batch 3: Append all new tasks at once
      if (newTasks.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: salesSheetId,
          range: tasksTab,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: newTasks },
        });
        console.log(`[carrier-sync] Created ${newTasks.length} outreach tasks`);
      }

      // Log the sync
      try {
        const syncSheetId = process.env.GOALS_SHEET_ID;
        const syncTab = process.env.SYNC_LOG_TAB_NAME || 'Sync Log';
        const SYNC_HEADERS = [
          'Sync Date', 'Policies Processed', 'New Policies', 'Updated',
          'Status Changes', 'Lapse Events', 'Reinstatements', 'Errors', 'Details',
        ];
        const syncVals = [
          new Date().toISOString(), results.processed, results.newPolicies, results.updated,
          results.statusChanges.length, results.lapseEvents.length, results.reinstatements.length,
          results.errors.length,
          JSON.stringify({
            statusChanges: results.statusChanges.map(sc => `${sc.policyNumber}: ${sc.previousStatus}→${sc.newStatus}`),
            lapseEvents: results.lapseEvents.map(le => le.policyNumber),
            errors: results.errors.map(e => `${e.policyNumber || e.row}: ${e.error}`),
          }),
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId: syncSheetId,
          range: syncTab,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [syncVals] },
        });
      } catch (logErr) {
        console.warn('[carrier-sync] Could not log sync:', logErr.message);
      }

      invalidateCache(salesSheetId, phTab);
      invalidateCache(salesSheetId, tasksTab);
    }

    console.log(`[carrier-sync] Done: ${results.processed} processed, ${results.newPolicies} new, ${results.updated} updated, ${results.statusChanges.length} changes, ${results.lapseEvents.length} lapses`);

    // ── 4. Merged tab sync (if requested) ─────────────────────────
    let mergedResults = null;
    if (updateMerged) {
      try {
        mergedResults = await syncMergedTab(carrierData, dryRun);
        console.log(`[carrier-sync] Merged: ${mergedResults.matched} matched, ${mergedResults.updated} updated, ${mergedResults.unmatched} unmatched`);
      } catch (mergedErr) {
        console.error('[carrier-sync] Merged tab error:', mergedErr.message);
        mergedResults = { error: mergedErr.message };
      }
    }

    return NextResponse.json({
      success: true, dryRun,
      summary: {
        processed: results.processed, newPolicies: results.newPolicies,
        updated: results.updated, statusChanges: results.statusChanges.length,
        lapseEvents: results.lapseEvents.length, reinstatements: results.reinstatements.length,
        errors: results.errors.length,
      },
      details: {
        statusChanges: results.statusChanges,
        lapseEvents: results.lapseEvents,
        reinstatements: results.reinstatements,
        errors: results.errors,
      },
      merged: mergedResults,
    });

  } catch (error) {
    console.error('[crm/carrier-sync] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function makeTaskRow(policyNo, agent, today, notes) {
  return TASKS_HEADERS.map(h => {
    if (h === 'Task ID') return randomUUID();
    if (h === 'Type') return 'Win-Back';
    if (h === 'Entity ID') return policyNo;
    if (h === 'Entity Type') return 'Policy';
    if (h === 'Assigned Agent') return agent;
    if (h === 'Due Date') return getFutureDate(7);
    if (h === 'Status') return 'Not Started';
    if (h === 'Created Date') return today;
    if (h === 'Notes') return notes;
    if (h === 'Attempts') return '0';
    return '';
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Merged Tab Sync — creates/updates carrier-corrected economics tab
// ═══════════════════════════════════════════════════════════════════════

const AUDIT_COLS = [
  'Original Premium', 'Original Placed Status', 'Carrier Policy #',
  'Carrier Status', 'Carrier Status Date', 'Last Sync Date', 'Sync Notes',
];

const CHANGE_HISTORY_HEADERS = [
  'Date', 'Policy #', 'Carrier Policy #', 'Insured Name', 'Agent',
  'Field Changed', 'Old Value', 'New Value', 'Source',
];

async function syncMergedTab(carrierData, dryRun) {
  const salesSheetId = process.env.SALES_SHEET_ID;
  const mergedTab = 'Merged';
  const changeHistoryTab = process.env.CHANGE_HISTORY_TAB || 'Change History';
  const today = new Date().toISOString().split('T')[0];

  // 1. Read original Sheet1 (always the baseline source)
  const salesRaw = await readRawSheet(salesSheetId, 'Sheet1');

  // 2. Try to read existing Merged tab
  let mergedRaw = null;
  try {
    mergedRaw = await readRawSheet(salesSheetId, mergedTab);
    if (!mergedRaw.data || mergedRaw.data.length === 0) mergedRaw = null;
  } catch (e) {
    mergedRaw = null;
  }

  const sheets = await getSheetsClient();
  let tabCreated = false;

  // 3. Create Merged tab from Sheet1 if it doesn't exist
  if (!mergedRaw) {
    tabCreated = true;
    if (!dryRun) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: salesSheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: mergedTab } } }] },
        });
      } catch (e) {
        if (!e.message?.includes('already exists')) throw e;
      }

      const allHeaders = [...salesRaw.headers, ...AUDIT_COLS];
      const allRows = salesRaw.data.map(row => {
        const vals = salesRaw.headers.map(h => row[h] || '');
        return [...vals, ...AUDIT_COLS.map(() => '')];
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: salesSheetId,
        range: `'${mergedTab}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [allHeaders, ...allRows] },
      });
      console.log(`[merged-sync] Created Merged tab: ${allRows.length} rows from Sheet1`);

      // Re-read to get row indices
      mergedRaw = await readRawSheet(salesSheetId, mergedTab);
    } else {
      // Dry run: simulate with salesRaw + empty audit cols
      mergedRaw = {
        headers: [...salesRaw.headers, ...AUDIT_COLS],
        data: salesRaw.data,
      };
    }
  }

  // 4. Ensure Change History tab exists
  if (!dryRun) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: salesSheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: changeHistoryTab } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: salesSheetId,
        range: `'${changeHistoryTab}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [CHANGE_HISTORY_HEADERS] },
      });
    } catch (e) {
      if (!e.message?.includes('already exists')) { /* ignore */ }
    }
  }

  // 5. Match carrier records → merged rows, detect differences
  const mergedData = mergedRaw.data;
  const mergedHeaders = mergedRaw.headers;

  const colLetter = (headerName) => {
    const idx = mergedHeaders.indexOf(headerName);
    return idx >= 0 ? colIndexToLetter(idx + 1) : null;
  };

  const results = {
    tabCreated,
    totalCarrier: carrierData.length,
    totalMerged: mergedData.length,
    matched: 0, unmatched: 0, updated: 0, unchanged: 0,
    changes: [],
    unmatchedRecords: [],
    impact: {
      premiumChange: 0, statusChanges: 0,
      phantomRevenue: 0, policiesAtRisk: 0,
      pipelineOverstated: 0,
    },
  };

  const updateBatch = [];
  const changeHistoryRows = [];

  for (const cr of carrierData) {
    const carrierPolicyNo = (cr['Policy No.'] || '').trim();
    if (!carrierPolicyNo) continue;

    const match = fuzzyMatchPolicyholder(cr, mergedData);
    if (!match) {
      results.unmatched++;
      results.unmatchedRecords.push({
        carrierPolicyNo,
        name: (cr['Insured'] || '').trim(),
        carrier: (cr['Carrier'] || '').trim(),
        status: (cr['Status'] || '').trim(),
        premium: Math.round(((parseFloat(cr['Annual Premium']) || 0) / 12) * 100) / 100,
      });
      continue;
    }

    results.matched++;
    const row = match.row;
    const rowIdx = row._rowIndex;
    const insuredName = `${row['First Name'] || ''} ${row['Last Name'] || ''}`.trim();

    // Compare economics
    const carrierAnnual = parseFloat(cr['Annual Premium']) || 0;
    const carrierMonthly = Math.round((carrierAnnual / 12) * 100) / 100;
    const currentMonthly = parseFloat(row['Monthly Premium']) || 0;

    const carrierStatus = (cr['Status'] || '').trim();
    const mappedPlaced = mapCarrierStatusToPlaced(carrierStatus);
    const currentPlaced = (row['Placed?'] || '').trim();

    const premDiff = carrierMonthly > 0 && Math.abs(carrierMonthly - currentMonthly) > 0.50;
    const statusDiff = mappedPlaced !== currentPlaced;

    // Always update carrier audit columns (Carrier Policy #, Carrier Status, date, sync date)
    const auditAlways = {
      'Carrier Policy #': carrierPolicyNo,
      'Carrier Status': carrierStatus,
      'Carrier Status Date': today,
      'Last Sync Date': today,
    };
    for (const [header, value] of Object.entries(auditAlways)) {
      const col = colLetter(header);
      if (col) updateBatch.push({ range: `'${mergedTab}'!${col}${rowIdx}`, values: [[value]] });
    }

    if (!premDiff && !statusDiff) {
      results.unchanged++;
      continue;
    }

    // ── Differences found ────────────────────────────────────────
    results.updated++;
    const notesParts = [];

    if (premDiff) {
      // Preserve original premium (only on first change)
      if (!(row['Original Premium'] || '').trim()) {
        const col = colLetter('Original Premium');
        if (col) updateBatch.push({ range: `'${mergedTab}'!${col}${rowIdx}`, values: [[currentMonthly.toString()]] });
      }
      // Update Monthly Premium with carrier value
      const col = colLetter('Monthly Premium');
      if (col) updateBatch.push({ range: `'${mergedTab}'!${col}${rowIdx}`, values: [[carrierMonthly.toString()]] });

      notesParts.push(`Premium $${currentMonthly}→$${carrierMonthly}`);
      results.impact.premiumChange += (carrierMonthly - currentMonthly);

      changeHistoryRows.push([
        today, row['Policy #'] || '', carrierPolicyNo, insuredName,
        row['Agent'] || '', 'Monthly Premium',
        `$${currentMonthly}`, `$${carrierMonthly}`, 'Carrier Sync',
      ]);
    }

    if (statusDiff) {
      // Preserve original status (only on first change)
      if (!(row['Original Placed Status'] || '').trim()) {
        const col = colLetter('Original Placed Status');
        if (col) updateBatch.push({ range: `'${mergedTab}'!${col}${rowIdx}`, values: [[currentPlaced]] });
      }
      // Update Placed? with carrier-mapped status
      const col = colLetter('Placed?');
      if (col) updateBatch.push({ range: `'${mergedTab}'!${col}${rowIdx}`, values: [[mappedPlaced]] });

      notesParts.push(`Status ${currentPlaced}→${mappedPlaced}`);
      results.impact.statusChanges++;

      // Phantom revenue: app says active, carrier says terminated
      const wasPlaced = ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(currentPlaced);
      const nowDeclined = mappedPlaced === 'Declined';
      if (wasPlaced && nowDeclined) {
        results.impact.phantomRevenue += currentMonthly;
        results.impact.policiesAtRisk++;
      }
      // Pipeline overstatement: app says pending, carrier says terminated
      if (currentPlaced === 'Submitted - Pending' && nowDeclined) {
        results.impact.pipelineOverstated += currentMonthly;
      }

      changeHistoryRows.push([
        today, row['Policy #'] || '', carrierPolicyNo, insuredName,
        row['Agent'] || '', 'Placed?',
        currentPlaced, mappedPlaced, 'Carrier Sync',
      ]);
    }

    // Update Sync Notes (prepend newest, keep last 500 chars)
    const snCol = colLetter('Sync Notes');
    if (snCol) {
      const existingNotes = (row['Sync Notes'] || '').trim();
      const newNote = `${today}: ${notesParts.join(', ')}`;
      const combined = existingNotes ? `${newNote}; ${existingNotes}` : newNote;
      const truncated = combined.length > 500 ? combined.substring(0, 497) + '...' : combined;
      updateBatch.push({ range: `'${mergedTab}'!${snCol}${rowIdx}`, values: [[truncated]] });
    }

    results.changes.push({
      salesPolicyNo: row['Policy #'] || '',
      carrierPolicyNo,
      name: insuredName,
      agent: row['Agent'] || '',
      matchType: match.matchType,
      confidence: match.confidence,
      premiumChange: premDiff ? { from: currentMonthly, to: carrierMonthly } : null,
      statusChange: statusDiff ? { from: currentPlaced, to: mappedPlaced, carrierStatus } : null,
    });
  }

  // 6. Execute writes
  if (!dryRun) {
    if (updateBatch.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: salesSheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: updateBatch },
      });
      console.log(`[merged-sync] Batch updated ${updateBatch.length} cells`);
    }

    if (changeHistoryRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: salesSheetId,
        range: `'${changeHistoryTab}'`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: changeHistoryRows },
      });
      console.log(`[merged-sync] Appended ${changeHistoryRows.length} change history entries`);
    }

    invalidateCache(salesSheetId, mergedTab);
  }

  // Round impact numbers
  results.impact.premiumChange = Math.round(results.impact.premiumChange * 100) / 100;
  results.impact.phantomRevenue = Math.round(results.impact.phantomRevenue * 100) / 100;
  results.impact.pipelineOverstated = Math.round(results.impact.pipelineOverstated * 100) / 100;

  return results;
}
