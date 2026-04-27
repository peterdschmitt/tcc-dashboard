/**
 * Single source of truth for "what columns can a portfolio view show or filter on?"
 * Used by:
 *   - the column picker UI (grouped by `category`, displayed by `label`)
 *   - the grid renderer (uses `formatter` + `alignment` for cell rendering)
 *   - the query layer (uses `sqlExpression` + `joinHints` to compose SELECT)
 *   - the filter builder (uses `dataType` to pick available ops + value editor)
 *
 * Adding a column: add an entry here. Ensure the table/view referenced in
 * sqlExpression is listed in joinHints so the query layer joins it.
 */
export const COLUMN_REGISTRY = {
  // ── Contact (14) ─────────────────────────────────────────
  name: { label: 'Name', category: 'Contact', sqlExpression: "TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))", dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  phone: { label: 'Phone', category: 'Contact', sqlExpression: 'c.phone', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  email: { label: 'Email', category: 'Contact', sqlExpression: 'c.email', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  dob: { label: 'Date of Birth', category: 'Contact', sqlExpression: 'c.date_of_birth', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: [] },
  gender: { label: 'Gender', category: 'Contact', sqlExpression: 'c.gender', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  address: { label: 'Address', category: 'Contact', sqlExpression: 'c.address1', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  city: { label: 'City', category: 'Contact', sqlExpression: 'c.city', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  state: { label: 'State', category: 'Contact', sqlExpression: 'c.state', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  zip: { label: 'Zip', category: 'Contact', sqlExpression: 'c.postal_code', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  country: { label: 'Country', category: 'Contact', sqlExpression: 'c.country', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  first_seen: { label: 'First Seen', category: 'Contact', sqlExpression: 'c.first_seen_at', dataType: 'date', formatter: 'datetime', alignment: 'left', joinHints: [] },
  source: { label: 'Source', category: 'Contact', sqlExpression: 'c.source', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  tags: { label: 'Tags', category: 'Contact', sqlExpression: 'c.tags', dataType: 'array', formatter: 'tags', alignment: 'left', joinHints: [] },
  total_calls: { label: 'Total Calls', category: 'Contact', sqlExpression: 'c.total_calls', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: [] },

  // ── Latest Policy (12) ───────────────────────────────────
  placed_status: { label: 'Status', category: 'Latest Policy', sqlExpression: 'p.placed_status', dataType: 'string', formatter: 'status_color', alignment: 'left', joinHints: ['policies'] },
  monthly_premium: { label: 'Premium', category: 'Latest Policy', sqlExpression: 'p.monthly_premium', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  original_premium: { label: 'Original Premium', category: 'Latest Policy', sqlExpression: 'p.original_premium', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  face_amount: { label: 'Face Amount', category: 'Latest Policy', sqlExpression: 'p.face_amount', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  term_length: { label: 'Term Length', category: 'Latest Policy', sqlExpression: 'p.term_length', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  application_date: { label: 'Application Date', category: 'Latest Policy', sqlExpression: 'p.application_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['policies'] },
  effective_date: { label: 'Effective Date', category: 'Latest Policy', sqlExpression: 'p.effective_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['policies'] },
  carrier: { label: 'Carrier', category: 'Latest Policy', sqlExpression: '(SELECT name FROM carriers WHERE id = p.carrier_id)', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  product: { label: 'Product', category: 'Latest Policy', sqlExpression: '(SELECT name FROM products WHERE id = p.product_id)', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  carrier_product_raw: { label: 'Carrier + Product', category: 'Latest Policy', sqlExpression: 'p.carrier_product_raw', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  policy_number: { label: 'Policy #', category: 'Latest Policy', sqlExpression: 'p.policy_number', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  outcome_at_application: { label: 'Outcome at Application', category: 'Latest Policy', sqlExpression: 'p.outcome_at_application', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },

  // ── Commission (9) ───────────────────────────────────────
  total_advance: { label: 'Total Advance', category: 'Commission', sqlExpression: 'cs.total_advance', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_commission: { label: 'Total Commission', category: 'Commission', sqlExpression: 'cs.total_commission', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_net_commission: { label: 'Net Commission', category: 'Commission', sqlExpression: 'cs.total_net_commission', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  outstanding_balance: { label: 'Outstanding Balance', category: 'Commission', sqlExpression: 'cs.outstanding_balance', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_chargeback: { label: 'Total Chargeback', category: 'Commission', sqlExpression: 'cs.total_chargeback', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_recovery: { label: 'Total Recovery', category: 'Commission', sqlExpression: 'cs.total_recovery', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  last_statement_date: { label: 'Last Statement Date', category: 'Commission', sqlExpression: 'cs.last_statement_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['commission_summary'] },
  last_transaction_type: { label: 'Last Transaction', category: 'Commission', sqlExpression: 'cs.last_transaction_type', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['commission_summary'] },
  commission_status: { label: 'Commission Status', category: 'Commission', sqlExpression: 'cs.commission_status', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['commission_summary'] },

  // ── Activity (5) ─────────────────────────────────────────
  last_seen_at: { label: 'Last Call', category: 'Activity', sqlExpression: 'c.last_seen_at', dataType: 'date', formatter: 'datetime', alignment: 'left', joinHints: [] },
  last_campaign: { label: 'Last Campaign', category: 'Activity', sqlExpression: 'ca.last_campaign', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['calls_aggregates'] },
  calls_in_7d: { label: 'Calls in 7d', category: 'Activity', sqlExpression: 'ca.calls_in_7d', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: ['calls_aggregates'] },
  calls_in_30d: { label: 'Calls in 30d', category: 'Activity', sqlExpression: 'ca.calls_in_30d', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: ['calls_aggregates'] },
  days_since_last_call: { label: 'Days Since Last Call', category: 'Activity', sqlExpression: "EXTRACT(DAY FROM NOW() - c.last_seen_at)::int", dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: [] },
};

const CATEGORY_ORDER = ['Contact', 'Latest Policy', 'Commission', 'Activity'];

/**
 * Group columns by category, preserving entry order within each group.
 * Returns: [{ category: 'Contact', columns: [{ key, label, ... }, ...] }, ...]
 */
export function columnsByCategory() {
  const groups = new Map(CATEGORY_ORDER.map(c => [c, []]));
  for (const [key, col] of Object.entries(COLUMN_REGISTRY)) {
    if (groups.has(col.category)) {
      groups.get(col.category).push({ key, ...col });
    }
  }
  return CATEGORY_ORDER.map(c => ({ category: c, columns: groups.get(c) }));
}

/**
 * Given a list of column keys, return the unique join hints needed.
 * Used by query.js to decide which optional joins to add to the SELECT.
 */
export function requiredJoinsForColumns(keys) {
  const out = new Set();
  for (const k of keys) {
    const col = COLUMN_REGISTRY[k];
    if (!col) continue;
    for (const j of col.joinHints) out.add(j);
  }
  return [...out];
}
