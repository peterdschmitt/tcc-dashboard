// src/lib/portfolio/filters.js
// Translate a filters object (from query string) into SQL WHERE clauses
// using postgres.js's tagged-template fragments for safe parameterization.

import { sql } from '../db.js';

/**
 * Smart list definitions: each maps to additional filter conditions.
 * Keep these in sync with the UI sidebar (`PortfolioFilterSidebar.jsx`).
 */
const SMART_LISTS = {
  all_submitted: { applicationDateNotNull: true },
  active_policies: { applicationDateNotNull: true, placedStatusContains: ['active', 'in force', 'advance released'] },
  recently_lapsed: { applicationDateNotNull: true, placedStatusContains: ['lapsed', 'canceled', 'cancelled'] },
  pending: { applicationDateNotNull: true, placedStatusContains: ['pending', 'submitted', 'awaiting'] },
  declined: { applicationDateNotNull: true, placedStatusContains: ['declined'] },
  high_value: { applicationDateNotNull: true, placedStatusContains: ['active', 'in force'], premiumMin: 100 },
};

/**
 * Build a WHERE clause fragment for the given filters.
 * Returns { conditions, joinPolicies, joinCarriers } where `conditions`
 * is an array of postgres.js fragments. Caller composes them with AND.
 */
export function buildWhereFragment(filters = {}) {
  const f = { ...filters };
  if (f.smartList && SMART_LISTS[f.smartList]) Object.assign(f, SMART_LISTS[f.smartList]);

  const conditions = [];
  let joinPolicies = false;
  let joinCarriers = false;

  if (f.applicationDateNotNull) { joinPolicies = true; conditions.push(sql`p.application_date IS NOT NULL`); }
  if (f.placedStatusContains && f.placedStatusContains.length) {
    joinPolicies = true;
    const orParts = f.placedStatusContains.map(s => sql`LOWER(p.placed_status) LIKE ${'%' + s.toLowerCase() + '%'}`);
    conditions.push(sql`(${orParts.flatMap((c, i) => i === 0 ? c : [sql` OR `, c])})`);
  }
  if (f.search) {
    const q = '%' + f.search.toLowerCase() + '%';
    conditions.push(sql`(LOWER(c.first_name) LIKE ${q} OR LOWER(c.last_name) LIKE ${q} OR c.phone LIKE ${'%' + f.search + '%'})`);
  }
  if (f.state && f.state.length) conditions.push(sql`c.state = ANY(${f.state})`);
  if (f.carrierId) { joinPolicies = true; conditions.push(sql`p.carrier_id = ${f.carrierId}`); }
  if (f.agentId) { joinPolicies = true; conditions.push(sql`p.agent_id = ${f.agentId}`); }
  if (f.campaignId) { joinPolicies = true; conditions.push(sql`p.sales_lead_source_campaign_id = ${f.campaignId}`); }
  if (f.premiumMin != null) { joinPolicies = true; conditions.push(sql`p.monthly_premium >= ${f.premiumMin}`); }
  if (f.premiumMax != null) { joinPolicies = true; conditions.push(sql`p.monthly_premium <= ${f.premiumMax}`); }

  return { conditions, joinPolicies, joinCarriers };
}
