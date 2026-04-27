// src/lib/portfolio/policy-status-buckets.js
// Canonical 4-bucket grouping for policy statuses, mirroring the existing
// Commission Tracker UI (src/components/CommissionSidebar.jsx).

export const STATUS_BUCKETS = {
  performing: {
    label: 'Performing',
    color: '#4ade80', // green
    description: 'Paying now or expected to pay',
    statuses: ['Active - In Force', 'Active - No commission paid yet', 'Active - Past Due', 'Issued, Not yet Active', 'Issued, Not yet active'],
  },
  unknown: {
    label: 'Unknown / In Process',
    color: '#facc15', // yellow
    description: 'Awaiting resolution — could go either way',
    statuses: ['Pending - Requirements Missing', 'Pending - Requirements MIssing', 'Pending - Agent State Appt', 'Initial Pay Failure', 'Unknown', 'not in system yet'],
  },
  canceled: {
    label: 'Canceled / Lapsed',
    color: '#f87171', // red
    description: 'Was active, then canceled — often triggers chargebacks',
    statuses: ['Canceled', 'Cancelled', 'Lapsed'],
  },
  declined: {
    label: 'Declined',
    color: '#fb923c', // orange
    description: 'Carrier rejected — never took effect',
    statuses: ['Declined'],
  },
};

/**
 * Map a granular policy status string to its bucket key (or null if unmapped).
 */
export function bucketForStatus(status) {
  if (!status) return null;
  for (const [key, b] of Object.entries(STATUS_BUCKETS)) {
    if (b.statuses.includes(status)) return key;
  }
  return null;
}

/**
 * Build a SQL CASE expression that maps a column reference to a bucket key.
 * Used by the column registry to expose `policy_status_bucket` as a derived column.
 *
 *   sqlExpression: caseExprForBucket('p.policy_status')
 *
 * Returns a CASE expression as a string ready to interpolate into postgres.js
 * via sqlUnsafe (the input is hardcoded — never user input — so this is safe).
 */
export function caseExprForBucket(columnRef) {
  const branches = Object.entries(STATUS_BUCKETS).map(([key, b]) => {
    const inList = b.statuses.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
    return `WHEN ${columnRef} IN (${inList}) THEN '${key}'`;
  }).join(' ');
  return `(CASE ${branches} ELSE NULL END)`;
}
