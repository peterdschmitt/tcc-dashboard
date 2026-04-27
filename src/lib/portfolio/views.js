// src/lib/portfolio/views.js

import { sql } from '../db.js';
import { COLUMN_REGISTRY } from './column-registry.js';
import { isRawWhereSafe } from './raw-sql-safety.js';

const VALID_SORT_DIRS = ['asc', 'desc'];
const VALID_GROUP_BYS = ['none', 'state', 'placed_status', 'agent', 'campaign', 'month', 'carrier'];

/**
 * Validate an inbound payload (from the API request body) before persisting.
 * Throws Error with a human-readable message on invalid input.
 */
export function validateViewPayload(p) {
  if (!p || typeof p !== 'object') throw new Error('Payload must be an object');
  const name = (p.name ?? '').toString().trim();
  if (!name) throw new Error('View name is required');
  if (!Array.isArray(p.columns) || p.columns.length === 0) throw new Error('At least one column is required');
  for (const k of p.columns) {
    if (!COLUMN_REGISTRY[k]) throw new Error(`Unknown column key: ${k}`);
  }
  if (p.sort_dir && !VALID_SORT_DIRS.includes(p.sort_dir)) {
    throw new Error(`Invalid sort_dir: ${p.sort_dir}`);
  }
  if (p.group_by && !VALID_GROUP_BYS.includes(p.group_by)) {
    throw new Error(`Invalid group_by: ${p.group_by}`);
  }
  if (p.sort_by && !COLUMN_REGISTRY[p.sort_by]) {
    throw new Error(`Unknown sort_by column: ${p.sort_by}`);
  }
  if (p.filters_json && p.raw_where) {
    throw new Error('Cannot set both filters_json and raw_where on a single view');
  }
  if (p.raw_where) {
    const check = isRawWhereSafe(p.raw_where);
    if (!check.ok) throw new Error(`Unsafe raw_where: ${check.reason}`);
  }
}

/**
 * Convert a validated payload into the row shape for INSERT/UPDATE.
 */
export function normalizeViewForDb(p) {
  return {
    name: p.name.trim(),
    description: p.description?.trim() || null,
    filtersJson: p.filters_json ?? null,
    rawWhere: p.raw_where?.trim() || null,
    columns: p.columns,
    sortBy: p.sort_by ?? null,
    sortDir: p.sort_dir ?? 'desc',
    groupBy: p.group_by ?? 'none',
    pinned: !!p.pinned,
    displayOrder: typeof p.display_order === 'number' ? p.display_order : 0,
  };
}

/**
 * List all views for the sidebar. Sorted: pinned first, then display_order, then name.
 */
export async function listViews() {
  return await sql`
    SELECT id, name, description, is_system, pinned, display_order, sort_by, sort_dir, group_by,
           jsonb_array_length(columns) AS column_count
    FROM portfolio_views
    ORDER BY pinned DESC, display_order, name
  `;
}

/**
 * Load a single view by id, including its full filters/columns/raw_where.
 */
export async function getView(id) {
  const [row] = await sql`SELECT * FROM portfolio_views WHERE id = ${id}`;
  return row ?? null;
}

/**
 * Create a view. Caller must have already called validateViewPayload.
 */
export async function createView(p) {
  const v = normalizeViewForDb(p);
  const [row] = await sql`
    INSERT INTO portfolio_views (name, description, filters_json, raw_where, columns, sort_by, sort_dir, group_by, pinned, display_order)
    VALUES (${v.name}, ${v.description}, ${v.filtersJson}, ${v.rawWhere}, ${v.columns}, ${v.sortBy}, ${v.sortDir}, ${v.groupBy}, ${v.pinned}, ${v.displayOrder})
    RETURNING id
  `;
  return row.id;
}

/**
 * Update a view by id. Caller must have already called validateViewPayload.
 */
export async function updateView(id, p) {
  const v = normalizeViewForDb(p);
  await sql`
    UPDATE portfolio_views SET
      name = ${v.name},
      description = ${v.description},
      filters_json = ${v.filtersJson},
      raw_where = ${v.rawWhere},
      columns = ${v.columns},
      sort_by = ${v.sortBy},
      sort_dir = ${v.sortDir},
      group_by = ${v.groupBy},
      pinned = ${v.pinned},
      display_order = ${v.displayOrder},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * Delete a view. Returns { ok, reason } — if the view is_system, returns ok:false.
 */
export async function deleteView(id) {
  const [row] = await sql`SELECT is_system FROM portfolio_views WHERE id = ${id}`;
  if (!row) return { ok: false, reason: 'View not found' };
  if (row.isSystem) return { ok: false, reason: 'System views cannot be deleted; use reset instead' };
  await sql`DELETE FROM portfolio_views WHERE id = ${id}`;
  return { ok: true };
}

/**
 * Reset a system view's mutable fields back to its seed_json.
 */
export async function resetSystemView(id) {
  const [row] = await sql`SELECT is_system, seed_json FROM portfolio_views WHERE id = ${id}`;
  if (!row) return { ok: false, reason: 'View not found' };
  if (!row.isSystem) return { ok: false, reason: 'Only system views can be reset' };
  if (!row.seedJson) return { ok: false, reason: 'No seed available' };
  const s = row.seedJson;
  await sql`
    UPDATE portfolio_views SET
      filters_json = ${s.filters_json ?? null},
      raw_where = ${s.raw_where ?? null},
      columns = ${s.columns ?? []},
      sort_by = ${s.sort_by ?? null},
      sort_dir = ${s.sort_dir ?? 'desc'},
      group_by = ${s.group_by ?? 'none'},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { ok: true };
}
