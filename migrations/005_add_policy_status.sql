-- migrations/005_add_policy_status.sql
-- Adds the cleaner Policy Status field (from the source Sales Tracker column
-- of the same name) to the policies table. Replaces the use of `placed_status`
-- (free-form agent notes, mostly null) for filtering and bucketing in the
-- Portfolio smart views feature.

ALTER TABLE policies ADD COLUMN policy_status TEXT;
CREATE INDEX idx_policies_policy_status ON policies(policy_status);
