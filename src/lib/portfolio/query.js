// src/lib/portfolio/query.js
import { sql } from '../db.js';
import { buildWhereFragment } from './filters.js';

/**
 * Compose a SELECT against contacts (LEFT JOIN policies if needed) with
 * the given filter conditions and pagination. Returns { rows, total }.
 */
export async function listContacts({ filters = {}, page = 1, pageSize = 50, sortBy = 'last_seen_at', sortDir = 'desc' }) {
  const { conditions } = buildWhereFragment(filters);
  const offset = (page - 1) * pageSize;

  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;

  // Always LEFT JOIN policies — the SELECT references MAX(p.*) aggregates
  // unconditionally, so `p` must be in scope regardless of filter shape.
  const policiesJoin = sql`LEFT JOIN policies p ON p.contact_id = c.id`;

  // Pick a sort column safely
  const sortColumns = {
    last_seen_at: sql`c.last_seen_at`,
    name: sql`c.last_name`,
    application_date: sql`MAX(p.application_date)`,
    monthly_premium: sql`MAX(p.monthly_premium)`,
    state: sql`c.state`,
  };
  const sortCol = sortColumns[sortBy] ?? sql`c.last_seen_at`;
  const sortDirection = sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const rows = await sql`
    SELECT
      c.id, c.phone, c.first_name, c.last_name, c.state, c.last_seen_at, c.total_calls, c.tags,
      MAX(p.placed_status) AS placed_status,
      MAX(p.policy_number) AS policy_number,
      MAX(p.monthly_premium) AS monthly_premium,
      MAX(p.application_date) AS application_date,
      MAX(p.sales_agent_raw) AS sales_agent,
      MAX(p.carrier_product_raw) AS carrier_product
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${sortDirection} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [{ count }] = await sql`
    SELECT COUNT(DISTINCT c.id)::int AS count
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
  `;

  return { rows, total: count, page, pageSize };
}

/**
 * Group contacts by the given dimension. Returns groups with counts +
 * sample contacts.
 */
export async function groupContacts({ filters = {}, groupBy = 'placed_status' }) {
  const { conditions, joinPolicies } = buildWhereFragment(filters);
  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;
  const policiesJoin = joinPolicies || ['placed_status', 'carrier', 'agent', 'campaign', 'month'].includes(groupBy)
    ? sql`LEFT JOIN policies p ON p.contact_id = c.id` : sql``;

  const groupExpressions = {
    state: sql`c.state`,
    placed_status: sql`p.placed_status`,
    agent: sql`p.sales_agent_raw`,
    campaign: sql`p.sales_lead_source_raw`,
    month: sql`TO_CHAR(p.application_date, 'YYYY-MM')`,
    carrier: sql`(SELECT name FROM carriers WHERE id = p.carrier_id)`,
  };
  const groupExpr = groupExpressions[groupBy];
  if (!groupExpr) throw new Error(`Unsupported group-by: ${groupBy}`);

  const rows = await sql`
    SELECT
      ${groupExpr} AS group_key,
      COUNT(DISTINCT c.id)::int AS contact_count,
      SUM(p.monthly_premium)::numeric(12,2) AS total_premium
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
    GROUP BY ${groupExpr}
    ORDER BY contact_count DESC
  `;

  return { groups: rows, groupBy };
}
