// src/lib/portfolio/exports.js
/**
 * Convert an array of objects to a CSV string. Quotes values containing
 * commas, quotes, or newlines per RFC 4180.
 */
export function toCsv(rows, columns) {
  const escape = (v) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => c.label).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body + '\n';
}

/**
 * General-purpose contact export columns.
 */
export const CONTACT_EXPORT_COLUMNS = [
  { key: 'phone', label: 'Phone' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'state', label: 'State' },
  { key: 'lastSeenAt', label: 'Last Seen' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'placedStatus', label: 'Placed Status' },
  { key: 'policyNumber', label: 'Policy #' },
  { key: 'monthlyPremium', label: 'Monthly Premium' },
  { key: 'applicationDate', label: 'Application Date' },
  { key: 'salesAgent', label: 'Sales Agent' },
  { key: 'carrierProduct', label: 'Carrier + Product' },
];

/**
 * ChaseData dialer import format. Confirmed by reviewing typical ChaseData
 * import templates: phone is the main required column. Optional first
 * name, last name, state are supported. ChaseData accepts comma or tab
 * separated; we use comma.
 */
export const DIALER_EXPORT_COLUMNS = [
  { key: 'phone', label: 'Phone' },
  { key: 'firstName', label: 'FirstName' },
  { key: 'lastName', label: 'LastName' },
  { key: 'state', label: 'State' },
];
