-- migrations/002_add_sync_state.sql
-- Track per-source sync watermarks so the cron can do incremental sync.

CREATE TABLE sync_state (
  source_key      TEXT PRIMARY KEY,    -- e.g. 'sales_tracker', 'call_logs', 'campaigns'
  last_sync_at    TIMESTAMPTZ,
  last_watermark  TEXT,                -- arbitrary string (e.g. max import_date)
  last_run_status TEXT,                -- 'success' | 'partial' | 'error'
  last_error      TEXT,
  rows_processed  INTEGER NOT NULL DEFAULT 0,
  rows_errored    INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_sync_state BEFORE UPDATE ON sync_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
