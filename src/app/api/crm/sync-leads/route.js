export const dynamic = 'force-dynamic';
import { fetchSheet, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { parseFlexDate, normalizeCampaign, parseDuration } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * POST /api/crm/sync-leads
 *
 * Syncs billable calls → Leads tab.
 * For each unique phone number with at least one billable call:
 *   - If no matching lead exists in the Leads tab → create one
 *   - If a lead already exists → update attempts count, last contact, agent
 *
 * Query params:
 *   ?preview=true  — dry-run, returns what would be created/updated
 */
export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const preview = searchParams.get('preview') === 'true';

    // Fetch call logs, pricing (for billable calc), and existing leads
    const [callsRaw, pricingRaw, leadsRaw] = await Promise.all([
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.CALLLOGS_TAB_NAME || 'Report', 0),
      fetchSheet(process.env.GOALS_SHEET_ID, process.env.GOALS_PRICING_TAB || 'Publisher Pricing', 300),
      fetchSheet(process.env.CALLLOGS_SHEET_ID, process.env.LEADS_TAB_NAME || 'Leads', 0).catch(() => []),
    ]);

    // Build pricing lookup for billable determination
    const pricing = {};
    pricingRaw.forEach(r => {
      const code = (r['Campaign Code'] || '').trim();
      if (!code || (r['Status'] || '').trim() === 'Inactive') return;
      pricing[code] = {
        buffer: parseInt(r['Buffer (seconds)'] || r['Buffer'] || '0') || 0,
        pricePerCall: parseFloat((r['Price per Billable Call ($)'] || r['Price'] || '0').replace('$', '')) || 0,
      };
    });

    // Parse calls and determine billable status
    const calls = callsRaw
      .filter(r => r['Date'])
      .map(r => {
        const date = parseFlexDate(r['Date']);
        const rawCampaign = r['Campaign']?.trim() || '';
        const normalized = normalizeCampaign(rawCampaign);
        const priceInfo = pricing[normalized] || {};
        const callDuration = parseDuration(r['Duration']);
        const callTypeRaw = (r['Call Type'] || '').trim().toLowerCase();
        const overrideRaw = (r['Billable Override'] || '').trim().toUpperCase();
        const computedBillable = callTypeRaw === 'inbound' && callDuration > (priceInfo.buffer || 0);
        const isBillable = overrideRaw === 'N' ? false : overrideRaw === 'Y' ? true : computedBillable;

        // Normalize phone to last 10 digits
        const rawPhone = String(r['Phone'] || r['Phone Number'] || '').replace(/\.0$/, '').replace(/[^0-9]/g, '');
        const phone10 = rawPhone.slice(-10);

        return {
          date,
          phone: phone10,
          phoneRaw: r['Phone']?.trim() || '',
          rep: r['Rep']?.trim() || '',
          campaign: rawCampaign,
          campaignCode: normalized,
          callStatus: r['Call Status']?.trim() || '',
          callType: r['Call Type']?.trim() || '',
          duration: callDuration,
          isBillable,
          state: r['State']?.trim() || '',
          firstName: r['First']?.trim() || '',
          lastName: r['Last']?.trim() || '',
          leadId: r['Lead Id']?.toString().trim() || '',
          inboundSource: r['Inbound Source']?.trim() || '',
        };
      })
      .filter(c => c.date && c.isBillable && c.phone.length >= 10);

    console.log(`[sync-leads] Total calls: ${callsRaw.length}, Billable: ${calls.length}`);

    // Group billable calls by phone number
    const phoneGroups = {};
    for (const call of calls) {
      if (!phoneGroups[call.phone]) {
        phoneGroups[call.phone] = {
          phone: call.phone,
          phoneRaw: call.phoneRaw,
          calls: [],
          agents: new Set(),
          campaigns: new Set(),
          states: new Set(),
          firstName: '',
          lastName: '',
          latestDate: '',
          earliestDate: '',
          leadId: '',
        };
      }
      const g = phoneGroups[call.phone];
      g.calls.push(call);
      if (call.rep) g.agents.add(call.rep);
      if (call.campaign) g.campaigns.add(call.campaign);
      if (call.state) g.states.add(call.state);
      if (!g.firstName && call.firstName) g.firstName = call.firstName;
      if (!g.lastName && call.lastName) g.lastName = call.lastName;
      if (!g.leadId && call.leadId) g.leadId = call.leadId;
      if (!g.latestDate || call.date > g.latestDate) g.latestDate = call.date;
      if (!g.earliestDate || call.date < g.earliestDate) g.earliestDate = call.date;
    }

    // Build lookup of existing leads by phone (last 10 digits)
    const existingByPhone = {};
    const existingByLeadId = {};

    // Flexible column access for existing leads
    function col(row, ...names) {
      for (const n of names) {
        if (row[n] !== undefined && row[n] !== '') return row[n].trim();
      }
      const keys = Object.keys(row);
      for (const n of names) {
        const lower = n.toLowerCase();
        const match = keys.find(k => k.toLowerCase() === lower);
        if (match && row[match] !== undefined && row[match] !== '') return row[match].trim();
      }
      return '';
    }

    for (const r of leadsRaw) {
      const phone = col(r, 'Phone Number', 'Phone', 'Phone #').replace(/[^0-9]/g, '').slice(-10);
      const lid = col(r, 'Lead ID', 'Lead Id', 'LeadID', 'ID');
      if (phone) existingByPhone[phone] = r;
      if (lid) existingByLeadId[lid] = r;
    }

    // Determine new leads vs updates
    const toCreate = [];
    const toUpdate = [];

    for (const [phone, group] of Object.entries(phoneGroups)) {
      const existing = existingByPhone[phone] || (group.leadId ? existingByLeadId[group.leadId] : null);

      if (existing) {
        // Lead exists — update attempts and last contact
        toUpdate.push({
          phone,
          name: [group.firstName, group.lastName].filter(Boolean).join(' ') || 'Unknown',
          agent: [...group.agents][0] || '',
          attempts: group.calls.length,
          lastContact: group.latestDate,
          _rowIndex: existing._rowIndex,
          existingAttempts: parseInt(col(existing, 'Attempts', 'Attempt', 'Call Attempts')) || 0,
        });
      } else {
        // New lead
        const name = [group.firstName, group.lastName].filter(Boolean).join(' ');
        toCreate.push({
          leadId: group.leadId || `L-${phone}`,
          phone: formatPhone(phone),
          name: name || 'Unknown',
          leadSource: [...group.campaigns][0] || '',
          primaryAgent: [...group.agents][0] || '',
          status: 'New',
          firstContactDate: group.earliestDate,
          attempts: group.calls.length,
          state: [...group.states][0] || '',
          lastContact: group.latestDate,
        });
      }
    }

    console.log(`[sync-leads] Unique phones: ${Object.keys(phoneGroups).length}, New: ${toCreate.length}, Update: ${toUpdate.length}`);

    if (preview) {
      return NextResponse.json({
        preview: true,
        totalBillableCalls: calls.length,
        uniquePhones: Object.keys(phoneGroups).length,
        existingLeads: leadsRaw.length,
        newLeads: toCreate.length,
        updatedLeads: toUpdate.length,
        sampleNew: toCreate.slice(0, 10),
        sampleUpdate: toUpdate.slice(0, 10),
      });
    }

    // Write new leads to sheet
    const sheets = await getSheetsClient();
    const leadsTab = process.env.LEADS_TAB_NAME || 'Leads';
    const sheetId = process.env.CALLLOGS_SHEET_ID;

    const HEADERS = [
      'Lead ID', 'Phone Number', 'Name', 'Lead Source', 'Primary Agent',
      'Status', 'First Contact Date', 'Attempts', 'Notes', 'Tags',
      'Follow-Up Due', 'Policy Number', 'Do Not Call', 'State', 'Last Contact',
    ];

    // Ensure headers exist (if sheet is empty, write them first)
    if (leadsRaw.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${leadsTab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }

    // Batch append new leads
    if (toCreate.length > 0) {
      const rows = toCreate.map(l => [
        l.leadId,
        l.phone,
        l.name,
        l.leadSource,
        l.primaryAgent,
        l.status,
        l.firstContactDate,
        String(l.attempts),
        '', // Notes
        '', // Tags
        '', // Follow-Up Due
        '', // Policy Number
        'No', // Do Not Call
        l.state,
        l.lastContact,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: leadsTab,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
    }

    // Batch update existing leads (attempts count + last contact)
    if (toUpdate.length > 0) {
      // Find column indices for Attempts and Last Contact
      const headerRow = leadsRaw.length > 0 ? Object.keys(leadsRaw[0]).filter(k => k !== '_rowIndex') : HEADERS;

      const data = [];
      for (const u of toUpdate) {
        // Update Attempts column
        const attemptsColIdx = findColIndex(headerRow, 'Attempts', 'Attempt');
        const lastContactColIdx = findColIndex(headerRow, 'Last Contact', 'Last Contact Date');

        if (attemptsColIdx >= 0) {
          const colLetter = colIndexToLetter(attemptsColIdx + 1);
          data.push({
            range: `${leadsTab}!${colLetter}${u._rowIndex}`,
            values: [[String(Math.max(u.attempts, u.existingAttempts))]],
          });
        }
        if (lastContactColIdx >= 0 && u.lastContact) {
          const colLetter = colIndexToLetter(lastContactColIdx + 1);
          data.push({
            range: `${leadsTab}!${colLetter}${u._rowIndex}`,
            values: [[u.lastContact]],
          });
        }
      }

      if (data.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data,
          },
        });
      }
    }

    invalidateCache(sheetId, leadsTab);

    return NextResponse.json({
      success: true,
      totalBillableCalls: calls.length,
      uniquePhones: Object.keys(phoneGroups).length,
      newLeads: toCreate.length,
      updatedLeads: toUpdate.length,
    });
  } catch (error) {
    console.error('[sync-leads] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helpers
function formatPhone(digits) {
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return digits;
}

function colIndexToLetter(idx) {
  let result = '';
  let n = idx;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function findColIndex(headers, ...names) {
  for (const name of names) {
    const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}
