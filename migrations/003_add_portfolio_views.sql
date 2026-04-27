-- migrations/003_add_portfolio_views.sql
-- Smart views: user-creatable saved configurations of filters + columns + sort + group-by.
-- Seeded with 6 system views matching the prior hardcoded smart lists.

CREATE TABLE portfolio_views (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,

  -- Filter representation: EITHER filters_json (visual builder) OR raw_where (SQL escape hatch). Never both.
  filters_json    JSONB,
  raw_where       TEXT,

  -- Saved snapshot pieces
  columns         JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_by         TEXT,
  sort_dir        TEXT NOT NULL DEFAULT 'desc',
  group_by        TEXT NOT NULL DEFAULT 'none',

  -- Sidebar metadata
  pinned          BOOLEAN NOT NULL DEFAULT false,
  display_order   INTEGER NOT NULL DEFAULT 0,

  -- For system views: original seed JSON, used by /reset
  seed_json       JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_filter_form CHECK (
    (filters_json IS NOT NULL AND raw_where IS NULL) OR
    (filters_json IS NULL AND raw_where IS NOT NULL) OR
    (filters_json IS NULL AND raw_where IS NULL)
  )
);

CREATE INDEX idx_views_pinned_order ON portfolio_views(pinned DESC, display_order, name);

CREATE TRIGGER set_updated_at_views BEFORE UPDATE ON portfolio_views
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Seed the 6 system views. Each has its own filters_json AND seed_json
-- (identical at seed time; seed_json never changes, so /reset works).

INSERT INTO portfolio_views (name, description, is_system, filters_json, columns, sort_by, sort_dir, group_by, display_order, seed_json) VALUES

('All Submitted Apps',
 'Every submitted application — the master list',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","carrier","policy_number","total_calls"]'::jsonb,
 'application_date', 'desc', 'none', 1,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","carrier","policy_number","total_calls"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Pending Applications',
 'Apps awaiting carrier action',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"pending"},{"field":"placed_status","op":"contains","value":"submitted"},{"field":"placed_status","op":"contains","value":"awaiting"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 2,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"pending"},{"field":"placed_status","op":"contains","value":"submitted"},{"field":"placed_status","op":"contains","value":"awaiting"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Active Policies',
 'In-force book of business',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"},{"field":"placed_status","op":"contains","value":"advance released"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","carrier","policy_number","outstanding_balance","commission_status"]'::jsonb,
 'monthly_premium', 'desc', 'none', 3,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"},{"field":"placed_status","op":"contains","value":"advance released"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","carrier","policy_number","outstanding_balance","commission_status"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb),

('Recently Lapsed',
 'Win-back targets',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"lapsed"},{"field":"placed_status","op":"contains","value":"canceled"},{"field":"placed_status","op":"contains","value":"cancelled"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","total_chargeback"]'::jsonb,
 'application_date', 'desc', 'none', 4,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"lapsed"},{"field":"placed_status","op":"contains","value":"canceled"},{"field":"placed_status","op":"contains","value":"cancelled"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","total_chargeback"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Declined',
 'Re-pivot opportunities',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"placed_status","op":"contains","value":"declined"}]}'::jsonb,
 '["name","phone","state","placed_status","application_date","outcome_at_application","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 5,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"placed_status","op":"contains","value":"declined"}]},"columns":["name","phone","state","placed_status","application_date","outcome_at_application","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('High-Value Active',
 'In-force policies with monthly premium ≥ $100',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"monthly_premium","op":"gte","value":100},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","carrier","outstanding_balance","total_commission"]'::jsonb,
 'monthly_premium', 'desc', 'none', 6,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"monthly_premium","op":"gte","value":100},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","carrier","outstanding_balance","total_commission"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb);
