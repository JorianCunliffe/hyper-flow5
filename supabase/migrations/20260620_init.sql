-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Contacts ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT        UNIQUE NOT NULL,
  name         TEXT,
  email        TEXT,
  company      TEXT,
  notes        TEXT,
  tags         TEXT[]      DEFAULT '{}',
  custom_data  JSONB       DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_name  ON contacts (name);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Calls ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calls (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  twilio_call_sid   TEXT        UNIQUE,
  contact_id        UUID        REFERENCES contacts (id) ON DELETE SET NULL,
  phone_number      TEXT        NOT NULL,
  direction         TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status            TEXT        DEFAULT 'initiated',
  system_prompt     TEXT,
  transcript        JSONB       DEFAULT '[]',
  summary           TEXT,
  duration_seconds  INTEGER,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  metadata          JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_calls_contact   ON calls (contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_sid       ON calls (twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_started   ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_direction ON calls (direction);

-- ─── Row-Level Security ──────────────────────────────────────────────────────
-- All access is server-side (via service_role key or permissive anon policy).
-- Tighten these policies if you ever expose Supabase client-side.

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_all ON contacts;
CREATE POLICY contacts_all ON contacts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS calls_all ON calls;
CREATE POLICY calls_all ON calls FOR ALL USING (true) WITH CHECK (true);
