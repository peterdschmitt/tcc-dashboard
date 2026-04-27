-- migrations/004_add_commission_ledger.sql
-- Per-transaction commission ledger synced from Google Sheets, plus a
-- per-policy aggregation view used by the Portfolio smart-views feature.

CREATE TABLE commission_ledger (
  id                      SERIAL PRIMARY KEY,
  policy_id               INTEGER REFERENCES policies(id) ON DELETE SET NULL,
  carrier_id              INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  agent_id                INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  -- Identifiers from the source row (kept as raw text for fallback matching)
  transaction_id          TEXT,
  source_policy_number    TEXT,
  matched_policy_number   TEXT,
  carrier_name_raw        TEXT,
  insured_name_raw        TEXT,
  agent_name_raw          TEXT,
  agent_id_raw            TEXT,
  product_raw             TEXT,

  -- Transaction details
  transaction_type        TEXT,
  description             TEXT,
  statement_date          DATE,
  processing_date         DATE,
  issue_date              DATE,

  -- Money fields
  premium                 NUMERIC(12, 2),
  commission_pct          NUMERIC(7, 4),
  advance_pct             NUMERIC(7, 4),
  advance_amount          NUMERIC(12, 2),
  commission_amount       NUMERIC(12, 2),
  net_commission          NUMERIC(12, 2),
  outstanding_balance     NUMERIC(12, 2),
  chargeback_amount       NUMERIC(12, 2),
  recovery_amount         NUMERIC(12, 2),
  net_impact              NUMERIC(12, 2),

  -- Match metadata
  match_type              TEXT,
  match_confidence        TEXT,
  status                  TEXT,
  statement_file          TEXT,
  notes                   TEXT,

  -- Idempotency + housekeeping
  source_row_hash         TEXT NOT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_policy ON commission_ledger(policy_id);
CREATE INDEX idx_ledger_carrier ON commission_ledger(carrier_id);
CREATE INDEX idx_ledger_agent ON commission_ledger(agent_id);
CREATE INDEX idx_ledger_statement_date ON commission_ledger(statement_date);
CREATE INDEX idx_ledger_status ON commission_ledger(status);

CREATE TRIGGER set_updated_at_ledger BEFORE UPDATE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE VIEW policy_commission_summary AS
SELECT
  p.id AS policy_id,
  p.policy_number,
  COALESCE(SUM(cl.advance_amount),       0)::numeric(14, 2) AS total_advance,
  COALESCE(SUM(cl.commission_amount),    0)::numeric(14, 2) AS total_commission,
  COALESCE(SUM(cl.net_commission),       0)::numeric(14, 2) AS total_net_commission,
  COALESCE(SUM(cl.chargeback_amount),    0)::numeric(14, 2) AS total_chargeback,
  COALESCE(SUM(cl.recovery_amount),      0)::numeric(14, 2) AS total_recovery,
  COALESCE(SUM(cl.net_impact),           0)::numeric(14, 2) AS total_net_impact,
  (SELECT outstanding_balance FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS outstanding_balance,
  MAX(cl.statement_date) AS last_statement_date,
  (SELECT transaction_type FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS last_transaction_type,
  (SELECT status FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS commission_status,
  COUNT(cl.id)::int AS ledger_row_count
FROM policies p
LEFT JOIN commission_ledger cl ON cl.policy_id = p.id
GROUP BY p.id, p.policy_number;
