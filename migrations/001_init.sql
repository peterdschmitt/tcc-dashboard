-- migrations/001_init.sql
-- TCC Portfolio Foundation: 7 entity tables + supporting infrastructure.

-- Shared trigger function: bumps updated_at on row update
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- carriers (must come before products which FKs to it)
CREATE TABLE carriers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER set_updated_at_carriers BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- products (carrier × product)
CREATE TABLE products (
  id                      SERIAL PRIMARY KEY,
  carrier_id              INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  product_type            TEXT,
  payout_structure        TEXT,
  default_advance_months  INTEGER,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carrier_id, name)
);
CREATE INDEX idx_products_carrier ON products(carrier_id);
CREATE TRIGGER set_updated_at_products BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- campaigns (publishers + internal sources)
CREATE TABLE campaigns (
  id                          SERIAL PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,
  vendor                      TEXT,
  category                    TEXT,
  price_per_billable_call     NUMERIC(10, 2),
  buffer_seconds              INTEGER,
  status                      TEXT NOT NULL DEFAULT 'active',
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER set_updated_at_campaigns BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- agents
CREATE TABLE agents (
  id                  SERIAL PRIMARY KEY,
  canonical_name      TEXT NOT NULL UNIQUE,
  nicknames           TEXT[] NOT NULL DEFAULT '{}',
  email               TEXT,
  hire_date           DATE,
  status              TEXT NOT NULL DEFAULT 'active',
  daily_premium_goal  NUMERIC(10, 2),
  daily_apps_goal     INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agents_nicknames ON agents USING GIN (nicknames);
CREATE TRIGGER set_updated_at_agents BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- contacts (phone-keyed)
CREATE TABLE contacts (
  id              SERIAL PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE,
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  date_of_birth   DATE,
  gender          TEXT,
  address1        TEXT,
  city            TEXT,
  state           TEXT,
  postal_code     TEXT,
  country         TEXT DEFAULT 'US',
  first_seen_at   TIMESTAMPTZ,
  source          TEXT,
  last_seen_at    TIMESTAMPTZ,
  total_calls     INTEGER NOT NULL DEFAULT 0,
  is_callable     BOOLEAN,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contacts_state ON contacts(state);
CREATE INDEX idx_contacts_last_seen ON contacts(last_seen_at DESC);
CREATE INDEX idx_contacts_tags ON contacts USING GIN (tags);
CREATE TRIGGER set_updated_at_contacts BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- calls
CREATE TABLE calls (
  id                  SERIAL PRIMARY KEY,
  contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id         INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id            INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  call_date           TIMESTAMPTZ NOT NULL,
  campaign_code       TEXT,
  subcampaign         TEXT,
  rep_name            TEXT,
  phone_raw           TEXT,
  attempt_number      INTEGER,
  caller_id           TEXT,
  inbound_source     TEXT,
  lead_id             TEXT,
  client_id           TEXT,
  call_status         TEXT,
  is_callable         BOOLEAN,
  duration_seconds    INTEGER,
  call_type           TEXT,
  details             TEXT,
  hangup              TEXT,
  hold_time           TEXT,
  hangup_source       TEXT,
  recording_url       TEXT,
  import_date         TIMESTAMPTZ,
  row_hash            TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_date ON calls(call_date DESC);
CREATE INDEX idx_calls_campaign ON calls(campaign_id);
CREATE INDEX idx_calls_agent ON calls(agent_id);

-- policies
CREATE TABLE policies (
  id                              SERIAL PRIMARY KEY,
  contact_id                      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  carrier_id                      INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  product_id                      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sales_lead_source_campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id                        INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  policy_number                   TEXT,
  carrier_policy_number           TEXT,
  carrier_product_raw             TEXT,
  monthly_premium                 NUMERIC(10, 2),
  original_premium                NUMERIC(10, 2),
  face_amount                     NUMERIC(12, 2),
  term_length                     TEXT,
  placed_status                   TEXT,
  original_placed_status          TEXT,
  carrier_status                  TEXT,
  carrier_status_date             DATE,
  outcome_at_application          TEXT,
  application_date                DATE,
  effective_date                  DATE,
  last_carrier_sync_date          TIMESTAMPTZ,
  sales_lead_source_raw           TEXT,
  sales_agent_raw                 TEXT,
  sales_notes                     TEXT,
  carrier_sync_notes              TEXT,
  payment_type                    TEXT,
  payment_frequency               TEXT,
  draft_day                       TEXT,
  ssn_billing_match               TEXT,
  beneficiary_first_name          TEXT,
  beneficiary_last_name           TEXT,
  beneficiary_relationship        TEXT,
  source_row_hash                 TEXT NOT NULL UNIQUE,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_policies_contact ON policies(contact_id);
CREATE INDEX idx_policies_status ON policies(placed_status);
CREATE INDEX idx_policies_premium ON policies(monthly_premium);
CREATE INDEX idx_policies_carrier ON policies(carrier_id);
CREATE INDEX idx_policies_agent ON policies(agent_id);
CREATE INDEX idx_policies_app_date ON policies(application_date DESC);
CREATE TRIGGER set_updated_at_policies BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
