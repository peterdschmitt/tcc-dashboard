export const dynamic = 'force-dynamic';
import { fetchSheet, readRawSheet, appendRow, writeCell, invalidateCache } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// ─── Carrier Report → Policyholder field mapping ───────────────────────
const CARRIER_REPORT_MAP = {
  'Policy No.':      'Policy Number',
  'Carrier':         'Carrier',
  'Agent':           'Agent',
  'Product':         'Product',
  'Annual Premium':  'Premium Amount',  // annual → will convert to monthly
  'Status':          'Carrier Status',  // carrier's status label
  'Issued State':    'Issued State',
  'Submitted':       'Submitted Date',
  'Effective':       'Effective Date',
  'Issued':          'Issue Date',
  'Insured':         'Name',
  'Birthdate':       'Birthdate',
  'Phone':           'Phone',
  'Email':           'Email',
  'Address 1':       'Address 1',
  'Address 2':       'Address 2',
  'City':            'City',
  'State':           'State',
  'Zip':             'Zip',
  'Writing No.':     'Writing No',
  'Split':           'Split',
  'Enrollment':      'Enrollment',
  'MS Plan':         'MS Plan',
  'Notes':           'Carrier Notes',
};

// Map carrier status labels to CRM retention statuses
function mapCarrierStatus(carrierStatus, currentCrmStatus) {
  const s = (carrierStatus || '').trim().toLowerCase();
  if (s === 'active')    return 'Active';
  if (s === 'pending')   return 'Pending';
  if (s === 'canceled' || s === 'cancelled' || s === 'terminated' || s === 'lapsed')  return 'Lapsed';
  if (s === 'declined' || s === 'not taken' || s === 'rejected')  return 'Declined';
  if (s === 'reinstated') return 'Reinstated';
  // If unknown, keep existing CRM status or default to the carrier value
  return currentCrmStatus || carrierStatus || 'Unknown';
}

// Determine if this is a status change that should trigger a retention event
function isLapseEvent(prevCrmStatus, newCrmStatus) {
  const wasActive = ['Active', 'Pending', 'Reinstated'].includes(prevCrmStatus);
  const isNowLapsed = ['Lapsed', 'Declined'].includes(newCrmStatus);
  return wasActive && isNowLapsed;
}

function isReinstatement(prevCrmStatus, newCrmStatus) {
  const wasInactive = ['Lapsed', 'Declined', 'Win-Back', 'At-Risk'].includes(prevCrmStatus);
  return wasInactive && newCrmStatus === 'Reinstated';
}

// ─── GET: Fetch sync status ────────────────────────────────────────────
export async function GET() {
  try {
    // Read the sync log from Business Health tab (or a dedicated sync log)
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
    } catch (e) {
      // Sync log tab may not exist yet
    }

    return NextResponse.json({ lastSync });
  } catch (error) {
    console.error('[crm/carrier-sync] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── POST: Run carrier report sync ────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    // ── 1. Read the carrier report ─────────────────────────────────────
    const carrierSheetId = process.env.CARRIER_REPORT_SHEET_ID;
    const carrierTab = process.env.CARRIER_REPORT_TAB_NAME || 'Policies';
    if (!carrierSheetId) {
      return NextResponse.json(
        { error: 'CARRIER_REPORT_SHEET_ID not configured' },
        { status: 400 }
      );
    }

    console.log('[carrier-sync] Starting sync...');
    const carrierData = await fetchSheet(carrierSheetId, carrierTab, 0); // no cache
    invalidateCache(carrierSheetId, carrierTab);

    if (!carrierData || carrierData.length === 0) {
      return NextResponse.json({ error: 'Carrier report is empty' }, { status: 400 });
    }
    console.log(`[carrier-sync] Read ${carrierData.length} rows from carrier report`);

    // ── 2. Read existing policyholders ─────────────────────────────────
    const salesSheetId = process.env.SALES_SHEET_ID;
    const phTab = process.env.POLICYHOLDER_TAB_NAME || 'Policyholders';

    let existingPH = [];
    let phHeaders = [];
    try {
      const raw = await readRawSheet(salesSheetId, phTab);
      existingPH = raw.data || [];
      phHeaders = raw.headers || [];
    } catch (e) {
      console.log('[carrier-sync] Policyholders tab not found or empty, will create entries');
    }

    // Build lookup by Policy Number
    const phByPolicy = {};
    existingPH.forEach(row => {
      const pn = (row['Policy Number'] || '').trim();
      if (pn) phByPolicy[pn] = row;
    });

    // ── 3. Read existing tasks for auto-creating lapse tasks ───────────
    const tasksTab = process.env.TASKS_TAB_NAME || 'Outreach Tasks';

    // ── 4. Ensure Policyholders tab has all needed headers ─────────────
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

    // ── 5. Process each carrier report row ─────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const results = {
      processed: 0,
      newPolicies: 0,
      updated: 0,
      statusChanges: [],
      lapseEvents: [],
      reinstatements: [],
      errors: [],
    };

    for (const cr of carrierData) {
      results.processed++;
      const policyNo = (cr['Policy No.'] || '').trim();
      if (!policyNo) {
        results.errors.push({ row: cr._rowIndex, error: 'Missing Policy No.' });
        continue;
      }

      try {
        const carrierStatus = (cr['Status'] || '').trim();
        const newCrmStatus = mapCarrierStatus(carrierStatus);
        const annualPremium = parseFloat(cr['Annual Premium']) || 0;
        const monthlyPremium = Math.round((annualPremium / 12) * 100) / 100;

        const existing = phByPolicy[policyNo];

        if (!existing) {
          // ── NEW POLICY: Insert into Policyholders ──────────────────
          if (!dryRun) {
            const newRow = {};
            POLICYHOLDER_HEADERS.forEach(h => { newRow[h] = ''; });
            newRow['Policy Number'] = policyNo;
            newRow['Name'] = (cr['Insured'] || '').trim();
            newRow['Status'] = newCrmStatus;
            newRow['Carrier Status'] = carrierStatus;
            newRow['Carrier'] = (cr['Carrier'] || '').trim();
            newRow['Product'] = (cr['Product'] || '').trim();
            newRow['Agent'] = (cr['Agent'] || '').trim();
            newRow['Premium Amount'] = monthlyPremium.toString();
            newRow['Issue Date'] = parseFlexDate(cr['Issued']) || '';
            newRow['Effective Date'] = parseFlexDate(cr['Effective']) || '';
            newRow['Submitted Date'] = parseFlexDate(cr['Submitted']) || '';
            newRow['Phone'] = (cr['Phone'] || '').trim();
            newRow['Email'] = (cr['Email'] || '').trim();
            newRow['Birthdate'] = (cr['Birthdate'] || '').trim();
            newRow['Address 1'] = (cr['Address 1'] || '').trim();
            newRow['Address 2'] = (cr['Address 2'] || cr['Address2'] || '').trim();
            newRow['City'] = (cr['City'] || '').trim();
            newRow['State'] = (cr['State'] || cr['Issued State'] || '').trim();
            newRow['Zip'] = (cr['Zip'] || '').trim();
            newRow['Writing No'] = (cr['Writing No.'] || '').trim();
            newRow['Split'] = (cr['Split'] || '').trim();
            newRow['Issued State'] = (cr['Issued State'] || '').trim();
            newRow['Enrollment'] = (cr['Enrollment'] || '').trim();
            newRow['MS Plan'] = (cr['MS Plan'] || '').trim();
            newRow['Carrier Notes'] = (cr['Notes'] || '').trim();
            newRow['Last Sync Date'] = today;
            newRow['Status Change Date'] = today;

            await appendRow(salesSheetId, phTab, POLICYHOLDER_HEADERS, newRow);

            // If new policy arrives already canceled/declined, trigger lapse event
            if (['Lapsed', 'Declined'].includes(newCrmStatus)) {
              const taskRow = {
                'Task ID': randomUUID(),
                'Type': 'Win-Back',
                'Entity ID': policyNo,
                'Entity Type': 'Policy',
                'Assigned Agent': (cr['Agent'] || '').trim(),
                'Due Date': getFutureDate(7),
                'Status': 'Not Started',
                'Created Date': today,
                'Completed Date': '',
                'Method': '',
                'Result': '',
                'Notes': `Auto-created: New policy ${policyNo} imported with ${carrierStatus} status`,
                'Attempts': '0',
              };
              await appendRow(salesSheetId, tasksTab, TASKS_HEADERS, taskRow);
              results.lapseEvents.push({
                policyNumber: policyNo,
                name: (cr['Insured'] || '').trim(),
                carrier: (cr['Carrier'] || '').trim(),
                carrierStatus,
                premium: monthlyPremium,
              });
            }
          }
          results.newPolicies++;

        } else {
          // ── EXISTING POLICY: Compare & update ──────────────────────
          const prevCrmStatus = (existing['Status'] || '').trim();
          const prevCarrierStatus = (existing['Carrier Status'] || '').trim();
          const rowIdx = existing._rowIndex;
          let changed = false;

          // Always update carrier status and sync date
          if (!dryRun) {
            if (carrierStatus !== prevCarrierStatus) {
              await writeCell(salesSheetId, phTab, rowIdx, 'Carrier Status', carrierStatus);
            }
            await writeCell(salesSheetId, phTab, rowIdx, 'Last Sync Date', today);

            // Update contact info if carrier has newer data
            const contactFields = [
              ['Phone', 'Phone'], ['Email', 'Email'],
              ['Address 1', 'Address 1'], ['City', 'City'],
              ['State', 'State'], ['Zip', 'Zip'],
            ];
            for (const [crField, phField] of contactFields) {
              const newVal = (cr[crField] || '').trim();
              const oldVal = (existing[phField] || '').trim();
              if (newVal && newVal !== 'NA' && newVal !== oldVal) {
                await writeCell(salesSheetId, phTab, rowIdx, phField, newVal);
              }
            }

            // Update premium if changed
            if (monthlyPremium > 0 && monthlyPremium !== parseFloat(existing['Premium Amount'] || '0')) {
              await writeCell(salesSheetId, phTab, rowIdx, 'Premium Amount', monthlyPremium.toString());
            }
          }

          // ── Detect status changes ──────────────────────────────────
          if (carrierStatus !== prevCarrierStatus) {
            const newMappedStatus = mapCarrierStatus(carrierStatus, prevCrmStatus);

            // Only update CRM status if it's a meaningful carrier-driven change
            // Don't overwrite manual CRM statuses like "Win-Back" if carrier still says "Canceled"
            const shouldUpdateCrmStatus =
              newMappedStatus !== prevCrmStatus &&
              !['Win-Back'].includes(prevCrmStatus); // Preserve manual retention statuses

            if (shouldUpdateCrmStatus) {
              if (!dryRun) {
                await writeCell(salesSheetId, phTab, rowIdx, 'Status', newMappedStatus);
                await writeCell(salesSheetId, phTab, rowIdx, 'Status Change Date', today);
                await writeCell(salesSheetId, phTab, rowIdx, 'Status Change Reason',
                  `Carrier status changed: ${prevCarrierStatus} → ${carrierStatus}`);
              }

              results.statusChanges.push({
                policyNumber: policyNo,
                name: (existing['Name'] || cr['Insured'] || '').trim(),
                carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                agent: (existing['Agent'] || cr['Agent'] || '').trim(),
                previousStatus: prevCrmStatus,
                newStatus: newMappedStatus,
                carrierStatusFrom: prevCarrierStatus,
                carrierStatusTo: carrierStatus,
                premium: monthlyPremium,
              });

              // ── Auto-create Win-Back task on lapse ─────────────────
              if (isLapseEvent(prevCrmStatus, newMappedStatus)) {
                if (!dryRun) {
                  const taskRow = {
                    'Task ID': randomUUID(),
                    'Type': 'Win-Back',
                    'Entity ID': policyNo,
                    'Entity Type': 'Policy',
                    'Assigned Agent': (existing['Agent'] || cr['Agent'] || '').trim(),
                    'Due Date': getFutureDate(7),
                    'Status': 'Not Started',
                    'Created Date': today,
                    'Completed Date': '',
                    'Method': '',
                    'Result': '',
                    'Notes': `Auto-created: Carrier status changed from ${prevCarrierStatus} to ${carrierStatus}`,
                    'Attempts': '0',
                  };
                  await appendRow(salesSheetId, tasksTab, TASKS_HEADERS, taskRow);
                }

                results.lapseEvents.push({
                  policyNumber: policyNo,
                  name: (existing['Name'] || cr['Insured'] || '').trim(),
                  carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                  agent: (existing['Agent'] || cr['Agent'] || '').trim(),
                  previousStatus: prevCrmStatus,
                  newStatus: newMappedStatus,
                  premium: monthlyPremium,
                });
              }

              // ── Detect reinstatements ──────────────────────────────
              if (isReinstatement(prevCrmStatus, newMappedStatus)) {
                results.reinstatements.push({
                  policyNumber: policyNo,
                  name: (existing['Name'] || cr['Insured'] || '').trim(),
                  carrier: (existing['Carrier'] || cr['Carrier'] || '').trim(),
                  previousStatus: prevCrmStatus,
                  newStatus: newMappedStatus,
                  premium: monthlyPremium,
                });
              }

              changed = true;
            }
          }

          if (changed) results.updated++;
        }
      } catch (err) {
        console.error(`[carrier-sync] Error processing policy ${policyNo}:`, err.message);
        results.errors.push({ policyNumber: policyNo, error: err.message });
      }
    }

    // ── 6. Log the sync ────────────────────────────────────────────────
    if (!dryRun) {
      try {
        const syncSheetId = process.env.GOALS_SHEET_ID;
        const syncTab = process.env.SYNC_LOG_TAB_NAME || 'Sync Log';
        const SYNC_HEADERS = [
          'Sync Date', 'Policies Processed', 'New Policies', 'Updated',
          'Status Changes', 'Lapse Events', 'Reinstatements', 'Errors', 'Details',
        ];
        const syncRow = {
          'Sync Date': new Date().toISOString(),
          'Policies Processed': results.processed.toString(),
          'New Policies': results.newPolicies.toString(),
          'Updated': results.updated.toString(),
          'Status Changes': results.statusChanges.length.toString(),
          'Lapse Events': results.lapseEvents.length.toString(),
          'Reinstatements': results.reinstatements.length.toString(),
          'Errors': results.errors.length.toString(),
          'Details': JSON.stringify({
            statusChanges: results.statusChanges.map(sc => `${sc.policyNumber}: ${sc.previousStatus}→${sc.newStatus}`),
            lapseEvents: results.lapseEvents.map(le => le.policyNumber),
            reinstatements: results.reinstatements.map(r => r.policyNumber),
            errors: results.errors.map(e => `${e.policyNumber || e.row}: ${e.error}`),
          }),
        };
        await appendRow(syncSheetId, syncTab, SYNC_HEADERS, syncRow);
      } catch (logErr) {
        console.warn('[carrier-sync] Could not log sync:', logErr.message);
      }

      // Invalidate caches so dashboard picks up changes immediately
      invalidateCache(salesSheetId, phTab);
      invalidateCache(salesSheetId, tasksTab);
    }

    console.log(`[carrier-sync] Complete: ${results.processed} processed, ${results.newPolicies} new, ${results.updated} updated, ${results.statusChanges.length} status changes, ${results.lapseEvents.length} lapse events`);

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        processed: results.processed,
        newPolicies: results.newPolicies,
        updated: results.updated,
        statusChanges: results.statusChanges.length,
        lapseEvents: results.lapseEvents.length,
        reinstatements: results.reinstatements.length,
        errors: results.errors.length,
      },
      details: {
        statusChanges: results.statusChanges,
        lapseEvents: results.lapseEvents,
        reinstatements: results.reinstatements,
        errors: results.errors,
      },
    });

  } catch (error) {
    console.error('[crm/carrier-sync] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
