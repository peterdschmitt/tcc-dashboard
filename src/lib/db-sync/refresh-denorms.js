// src/lib/db-sync/refresh-denorms.js
import { sql } from '../db.js';

/**
 * Recompute denormalized state on contacts:
 *   - last_seen_at = max(call_date) over the contact's calls
 *   - total_calls = count of calls
 *   - is_callable = latest call's is_callable
 *   - tags = ['publisher:<latest campaign>', 'state:<state>', 'callable:yes|no']
 *
 * Called after calls + policies are synced. Run as a single SQL UPDATE
 * for performance (vs. iterating per-contact in JS).
 */
export async function refreshContactDenorms() {
  const t0 = Date.now();
  await sql`
    UPDATE contacts c SET
      last_seen_at = stats.last_call,
      total_calls = stats.call_count,
      is_callable = stats.is_callable,
      tags = COALESCE(stats.tags, '{}'),
      updated_at = NOW()
    FROM (
      SELECT
        c.id AS contact_id,
        MAX(ca.call_date) AS last_call,
        COUNT(ca.id)::int AS call_count,
        BOOL_OR(ca.is_callable) AS is_callable,
        ARRAY(
          SELECT DISTINCT t FROM unnest(ARRAY[
            CASE WHEN c.state IS NOT NULL THEN 'state:' || c.state END,
            CASE WHEN BOOL_OR(ca.is_callable) THEN 'callable:yes' ELSE 'callable:no' END,
            CASE WHEN MAX(ca.campaign_code) IS NOT NULL THEN 'publisher:' || MAX(ca.campaign_code) END
          ]) AS t WHERE t IS NOT NULL
        ) AS tags
      FROM contacts c
      LEFT JOIN calls ca ON ca.contact_id = c.id
      GROUP BY c.id, c.state
    ) AS stats
    WHERE c.id = stats.contact_id
  `;
  return { elapsedMs: Date.now() - t0 };
}
