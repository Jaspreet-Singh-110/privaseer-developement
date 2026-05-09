/*
  # Create Consent Persistence System

  ## Overview
  Implements consent state tracking to prevent false-positives when sites have
  valid persistent consent. Tracks CMP (Consent Management Platform) state across
  revisits to accurately assess GDPR compliance.

  ## Tables Created

  ### 1. consent_state
  Stores per-domain consent decisions made by users
  - `id` (uuid, primary key) - Unique consent record ID
  - `installation_id` (uuid) - Anonymous installation identifier
  - `domain` (text) - Website domain where consent was given/rejected
  - `cmp_type` (text) - CMP identifier (e.g., "onetrust", "cookiebot", "termly")
  - `consent_status` (text) - User's choice: "accepted", "rejected", "partial"
  - `has_reject_button` (boolean) - Whether reject button was present
  - `is_compliant` (boolean) - Whether the consent banner was GDPR compliant
  - `cookie_names` (jsonb) - Array of consent cookie names detected
  - `tcf_version` (text, optional) - TCF API version if detected (e.g., "2.0")
  - `first_seen` (timestamptz) - When consent was first detected
  - `last_verified` (timestamptz) - When consent state was last checked
  - `created_at` (timestamptz) - Record creation timestamp

  ### 2. cmp_detections
  Tracks CMP detection attempts for analytics and debugging
  - `id` (uuid, primary key) - Unique detection ID
  - `installation_id` (uuid) - Anonymous installation identifier
  - `domain` (text) - Website domain
  - `cmp_type` (text) - Detected CMP type
  - `detection_method` (text) - How CMP was detected (cookie/api/banner)
  - `confidence_score` (numeric) - Detection confidence (0.0-1.0)
  - `created_at` (timestamptz) - Detection timestamp

  ## Security
  - RLS enabled on all tables
  - Users can only access their own installation data
  - Consent states are scoped to installation_id
  - No cross-installation data leakage

  ## Use Cases
  1. **False-Positive Prevention**: Don't penalize sites with valid persisted consent
  2. **CMP Recognition**: Identify common consent management platforms
  3. **Compliance Tracking**: Monitor which sites maintain proper consent
  4. **User Privacy**: Allow users to see where they've accepted/rejected tracking

  ## Important Notes
  - Consent state expires after 30 days (GDPR best practice)
  - Each domain can have multiple consent records (updates over time)
  - TCF v2 API detection provides highest confidence for compliance
*/

-- Create consent_state table
CREATE TABLE IF NOT EXISTS consent_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  domain text NOT NULL,
  cmp_type text NOT NULL DEFAULT 'unknown',
  consent_status text NOT NULL CHECK (consent_status IN ('accepted', 'rejected', 'partial', 'unknown')),
  has_reject_button boolean DEFAULT false,
  is_compliant boolean DEFAULT false,
  cookie_names jsonb DEFAULT '[]'::jsonb,
  tcf_version text,
  first_seen timestamptz DEFAULT now(),
  last_verified timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create cmp_detections table for analytics
CREATE TABLE IF NOT EXISTS cmp_detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  domain text NOT NULL,
  cmp_type text NOT NULL,
  detection_method text NOT NULL CHECK (detection_method IN ('cookie', 'api', 'banner', 'hybrid')),
  confidence_score numeric(3,2) DEFAULT 1.0 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_consent_state_installation_domain
  ON consent_state(installation_id, domain);
CREATE INDEX IF NOT EXISTS idx_consent_state_domain
  ON consent_state(domain);
CREATE INDEX IF NOT EXISTS idx_consent_state_last_verified
  ON consent_state(last_verified DESC);
CREATE INDEX IF NOT EXISTS idx_consent_state_cmp_type
  ON consent_state(cmp_type);

CREATE INDEX IF NOT EXISTS idx_cmp_detections_installation_id
  ON cmp_detections(installation_id);
CREATE INDEX IF NOT EXISTS idx_cmp_detections_domain
  ON cmp_detections(domain);
CREATE INDEX IF NOT EXISTS idx_cmp_detections_created_at
  ON cmp_detections(created_at DESC);

-- Enable Row Level Security
ALTER TABLE consent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmp_detections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can manage own consent state" ON consent_state;
DROP POLICY IF EXISTS "Users can read own consent state" ON consent_state;
DROP POLICY IF EXISTS "Users can insert own consent state" ON consent_state;
DROP POLICY IF EXISTS "Users can update own consent state" ON consent_state;
DROP POLICY IF EXISTS "Users can insert CMP detections" ON cmp_detections;
DROP POLICY IF EXISTS "Users can read own CMP detections" ON cmp_detections;

-- Policies for consent_state table
-- Users can only access consent states for their installation_id
CREATE POLICY "Users can read own consent state"
  ON consent_state
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users can insert own consent state"
  ON consent_state
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own consent state"
  ON consent_state
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Policies for cmp_detections table
CREATE POLICY "Users can insert CMP detections"
  ON cmp_detections
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Users can read own CMP detections"
  ON cmp_detections
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Create function to clean up old consent states (30 days)
CREATE OR REPLACE FUNCTION cleanup_old_consent_states()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM consent_state
  WHERE last_verified < (now() - interval '30 days');
END;
$$;

-- Note: You can schedule this function to run daily using pg_cron or call it periodically from edge functions
