// src/lib/ghl/note-formatter.js
/**
 * Format a single Call Log row as a multi-line activity note for GHL.
 * Recording and Details lines are omitted when blank; other lines always render.
 */
export function formatNote(row) {
  const v = (k) => (row[k] ?? '').toString().trim();
  const lines = [];

  // Header line: 📞 Date — Campaign / Subcampaign (Attempt #N)
  const header = `📞 ${v('Date')} — ${v('Campaign')} / ${v('Subcampaign')} (Attempt #${v('Attempt')})`;
  lines.push(header);

  lines.push(`   Status: ${v('Call Status')} | Type: ${v('Call Type')} | Duration: ${v('Duration')}s | Hold: ${v('HoldTime')}s`);
  lines.push(`   Rep: ${v('Rep')} | Caller ID: ${v('Caller ID')} | Hangup: ${v('Hangup')} via ${v('Hangup Source')}`);
  lines.push(`   Lead ID: ${v('Lead Id')} | Client ID: ${v('Client ID')}`);

  if (v('Details')) lines.push(`   Details: ${v('Details')}`);
  if (v('Recording')) lines.push(`   🎙️ ${v('Recording')}`);

  return lines.join('\n');
}
