-- migrations/006_add_nested_status_views.sql
-- Adds 13 nested-status smart views — one per child status from the
-- Commission Tracker's parent/child status grouping. Each view filters
-- on a specific policy_status value (with OR variants to catch known
-- typos in the source sheet). Views are flagged is_system=true with a
-- seed_json snapshot so the existing /reset endpoint works.
--
-- display_order 100–112 places these AFTER the original 6 system views
-- (display_order 1–6). The four bucket-level views from migration 003
-- continue to exist; these are drill-downs.

-- Performing (4 views)

INSERT INTO portfolio_views (name, description, is_system, filters_json, columns, sort_by, sort_dir, group_by, display_order, seed_json) VALUES

('Performing — Active In Force',
 'Paying policies, currently in force',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - In Force"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","last_statement_date","total_commission","outstanding_balance"]'::jsonb,
 'monthly_premium', 'desc', 'none', 100,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - In Force"}]},"columns":["name","phone","monthly_premium","carrier","last_statement_date","total_commission","outstanding_balance"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb),

('Performing — Active No Commission Yet',
 'Active policies that haven''t generated commission yet',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - No commission paid yet"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","application_date","effective_date","outstanding_balance"]'::jsonb,
 'application_date', 'desc', 'none', 101,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - No commission paid yet"}]},"columns":["name","phone","monthly_premium","carrier","application_date","effective_date","outstanding_balance"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Performing — Active Past Due',
 'Active policies past due — chargeback risk',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - Past Due"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","last_statement_date","outstanding_balance","total_chargeback"]'::jsonb,
 'monthly_premium', 'desc', 'none', 102,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Active - Past Due"}]},"columns":["name","phone","monthly_premium","carrier","last_statement_date","outstanding_balance","total_chargeback"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb),

('Performing — Issued Not Yet Active',
 'Policies issued, awaiting first payment / activation (handles "active" typo variant)',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"in","value":["Issued, Not yet Active","Issued, Not yet active"]}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","application_date","effective_date"]'::jsonb,
 'effective_date', 'asc', 'none', 103,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"in","value":["Issued, Not yet Active","Issued, Not yet active"]}]},"columns":["name","phone","monthly_premium","carrier","application_date","effective_date"],"sort_by":"effective_date","sort_dir":"asc","group_by":"none"}'::jsonb),

-- Unknown / In Process (5 views)

('Unknown — Pending Requirements Missing',
 'Apps blocked on missing requirements (handles "MIssing" typo variant)',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"in","value":["Pending - Requirements Missing","Pending - Requirements MIssing"]}]}'::jsonb,
 '["name","phone","application_date","carrier","outcome_at_application"]'::jsonb,
 'application_date', 'desc', 'none', 104,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"in","value":["Pending - Requirements Missing","Pending - Requirements MIssing"]}]},"columns":["name","phone","application_date","carrier","outcome_at_application"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Unknown — Pending Agent State Appt',
 'Apps blocked pending agent state appointment',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Pending - Agent State Appt"}]}'::jsonb,
 '["name","phone","state","application_date","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 105,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Pending - Agent State Appt"}]},"columns":["name","phone","state","application_date","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Unknown — Initial Pay Failure',
 'Initial premium payment failed — needs follow-up',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Initial Pay Failure"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","application_date","effective_date"]'::jsonb,
 'application_date', 'desc', 'none', 106,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Initial Pay Failure"}]},"columns":["name","phone","monthly_premium","carrier","application_date","effective_date"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Unknown — Unknown',
 'Status unknown — needs research',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Unknown"}]}'::jsonb,
 '["name","phone","application_date","carrier","policy_number"]'::jsonb,
 'application_date', 'desc', 'none', 107,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Unknown"}]},"columns":["name","phone","application_date","carrier","policy_number"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Unknown — Not In System Yet',
 'Apps not yet visible in carrier system',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"not in system yet"}]}'::jsonb,
 '["name","phone","application_date","carrier","policy_number"]'::jsonb,
 'application_date', 'desc', 'none', 108,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"not in system yet"}]},"columns":["name","phone","application_date","carrier","policy_number"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

-- Canceled / Lapsed (3 views)

('Canceled — Canceled',
 'Canceled policies — possible chargebacks',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Canceled"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","effective_date","total_chargeback","last_statement_date"]'::jsonb,
 'last_statement_date', 'desc', 'none', 109,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Canceled"}]},"columns":["name","phone","monthly_premium","carrier","effective_date","total_chargeback","last_statement_date"],"sort_by":"last_statement_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Canceled — Cancelled',
 'Cancelled policies (alternate spelling)',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Cancelled"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","effective_date","total_chargeback"]'::jsonb,
 'last_statement_date', 'desc', 'none', 110,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Cancelled"}]},"columns":["name","phone","monthly_premium","carrier","effective_date","total_chargeback"],"sort_by":"last_statement_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Canceled — Lapsed',
 'Lapsed policies — chargeback risk',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Lapsed"}]}'::jsonb,
 '["name","phone","monthly_premium","carrier","effective_date","total_chargeback"]'::jsonb,
 'last_statement_date', 'desc', 'none', 111,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Lapsed"}]},"columns":["name","phone","monthly_premium","carrier","effective_date","total_chargeback"],"sort_by":"last_statement_date","sort_dir":"desc","group_by":"none"}'::jsonb),

-- Declined (1 view)

('Declined — Declined',
 'Carrier-declined applications — re-pivot opportunities',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Declined"}]}'::jsonb,
 '["name","phone","application_date","outcome_at_application","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 112,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"policy_status","op":"eq","value":"Declined"}]},"columns":["name","phone","application_date","outcome_at_application","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb);
