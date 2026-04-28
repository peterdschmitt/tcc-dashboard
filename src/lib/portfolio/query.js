// src/lib/portfolio/query.js
import { sql, sqlReadonly, sqlUnsafe } from '../db.js';
import { buildWhereFragment } from './filters.js';
import { compileFilterTree } from './filter-tree.js';
import { COLUMN_REGISTRY, requiredJoinsForColumns } from './column-registry.js';

const POLICIES_JOIN = sql`LEFT JOIN policies p ON p.contact_id = c.id`;
const COMMISSION_SUMMARY_JOIN = sql`LEFT JOIN policy_commission_summary cs ON cs.policy_id = p.id`;
const CALLS_AGG_JOIN = sql`LEFT JOIN (
  SELECT contact_id,
         MAX(campaign_code) AS last_campaign,
         COUNT(*) FILTER (WHERE call_date >= NOW() - INTERVAL '7 days')::int AS calls_in_7d,
         COUNT(*) FILTER (WHERE call_date >= NOW() - INTERVAL '30 days')::int AS calls_in_30d
  FROM calls GROUP BY contact_id
) ca ON ca.contact_id = c.id`;

function joinsFor(joinKeys) {
  const parts = [];
  // policies must come first since commission_summary depends on `p`
  if (joinKeys.includes('policies') || joinKeys.includes('commission_summary')) parts.push(POLICIES_JOIN);
  if (joinKeys.includes('commission_summary')) parts.push(COMMISSION_SUMMARY_JOIN);
  if (joinKeys.includes('calls_aggregates')) parts.push(CALLS_AGG_JOIN);
  return parts.length === 0 ? sql`` : parts.flatMap((p, i) => i === 0 ? [p] : [sql` `, p]);
}

// Columns whose sqlExpression references a joined table (joinHints non-empty)
// must be wrapped in MAX() because we GROUP BY c.id only. Contact-table columns
// (joinHints empty) reference c.* directly and don't need aggregation.
function needsAggregation(col) {
  return col?.joinHints?.length > 0;
}

function buildSelectProjection(columnKeys) {
  // Always include the contact id for row-click handlers
  const parts = [sql`c.id`];
  for (const key of columnKeys) {
    const col = COLUMN_REGISTRY[key];
    if (!col) continue;
    const expr = needsAggregation(col)
      ? `MAX(${col.sqlExpression})`
      : col.sqlExpression;
    parts.push(sql`${sqlUnsafe(expr)} AS ${sqlUnsafe('"' + key + '"')}`);
  }
  return parts.flatMap((p, i) => i === 0 ? [p] : [sql`, `, p]);
}

/**
 * List contacts for a specific saved view.
 *
 * `viewConfig` shape (loaded server-side via getView(id)):
 *   { filters_json | raw_where, columns, sort_by, sort_dir }
 *
 * Returns { rows, total, page, pageSize, columns } — the columns array is
 * echoed back so the client knows which fields to render.
 *
 * Routes through `sqlReadonly` when `raw_where` is set; through normal `sql`
 * otherwise. The read-only role provides defense-in-depth alongside the
 * keyword blocklist in raw-sql-safety.js.
 */
export async function listContactsForView({ viewConfig, page = 1, pageSize = 50 }) {
  const columns = viewConfig.columns?.length ? viewConfig.columns : ['name', 'phone', 'state', 'placed_status', 'monthly_premium', 'application_date', 'carrier', 'last_seen_at'];
  const offset = (page - 1) * pageSize;
  const usingReadonly = !!viewConfig.rawWhere;
  const sqlClient = usingReadonly ? sqlReadonly : sql;

  // Compose WHERE
  let whereClause;
  if (viewConfig.rawWhere) {
    whereClause = sql`WHERE ${sqlUnsafe('(' + viewConfig.rawWhere + ')')}`;
  } else if (viewConfig.filtersJson) {
    const fragment = compileFilterTree(viewConfig.filtersJson, COLUMN_REGISTRY);
    whereClause = sql`WHERE ${fragment}`;
  } else {
    whereClause = sql``;
  }

  // Compose joins from the columns we project AND from join hints implied
  // by the filter tree. The filter tree itself can reference policy or
  // commission columns even if the SELECT doesn't, so we conservatively
  // join policies whenever filters_json or raw_where is set.
  const joinKeys = new Set(requiredJoinsForColumns(columns));
  if (viewConfig.filtersJson || viewConfig.rawWhere) joinKeys.add('policies');

  const joinFragment = joinsFor([...joinKeys]);
  const projection = buildSelectProjection(columns);

  // Sort
  const sortKey = viewConfig.sortBy && COLUMN_REGISTRY[viewConfig.sortBy] ? viewConfig.sortBy : 'last_seen_at';
  const sortColEntry = COLUMN_REGISTRY[sortKey];
  const sortExpr = sortColEntry
    ? (needsAggregation(sortColEntry)
        ? `MAX(${sortColEntry.sqlExpression})`
        : sortColEntry.sqlExpression)
    : 'c.last_seen_at';
  const sortCol = sqlUnsafe(sortExpr);
  const sortDir = viewConfig.sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const rows = await sqlClient`
    SELECT ${projection}
    FROM contacts c ${joinFragment}
    ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [{ count }] = await sqlClient`
    SELECT COUNT(DISTINCT c.id)::int AS count
    FROM contacts c ${joinFragment}
    ${whereClause}
  `;

  return { rows, total: count, page, pageSize, columns };
}

// ── Legacy paths (existing UI) — preserve verbatim ─────────────────────

export async function listContacts({ filters = {}, page = 1, pageSize = 50, sortBy = 'last_seen_at', sortDir = 'desc' }) {
  const { conditions } = buildWhereFragment(filters);
  const offset = (page - 1) * pageSize;
  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;
  const policiesJoin = sql`LEFT JOIN policies p ON p.contact_id = c.id`;
  const sortColumns = {
    last_seen_at: sql`c.last_seen_at`,
    name: sql`c.last_name`,
    application_date: sql`MAX(p.application_date)`,
    monthly_premium: sql`MAX(p.monthly_premium)`,
    state: sql`c.state`,
  };
  const sortCol = sortColumns[sortBy] ?? sql`c.last_seen_at`;
  const direction = sortDir === 'asc' ? sql`ASC` : sql`DESC`;
  const rows = await sql`
    SELECT
      c.id, c.phone, c.first_name, c.last_name, c.state, c.last_seen_at, c.total_calls, c.tags,
      MAX(p.placed_status) AS placed_status,
      MAX(p.policy_number) AS policy_number,
      MAX(p.monthly_premium) AS monthly_premium,
      MAX(p.application_date) AS application_date,
      MAX(p.sales_agent_raw) AS sales_agent,
      MAX(p.carrier_product_raw) AS carrier_product
    FROM contacts c ${policiesJoin} ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${direction} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const [{ count }] = await sql`
    SELECT COUNT(DISTINCT c.id)::int AS count FROM contacts c ${policiesJoin} ${whereClause}
  `;
  return { rows, total: count, page, pageSize };
}

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
    SELECT ${groupExpr} AS group_key, COUNT(DISTINCT c.id)::int AS contact_count, SUM(p.monthly_premium)::numeric(12,2) AS total_premium
    FROM contacts c ${policiesJoin} ${whereClause}
    GROUP BY ${groupExpr} ORDER BY contact_count DESC
  `;
  return { groups: rows, groupBy };
}
