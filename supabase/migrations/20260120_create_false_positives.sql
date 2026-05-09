/*
  # Create False Positive Reporting

  ## Overview
  Stores user-reported false positives for consent scanner alerts.

  ## Table: false_positives
  - `installation_id` (uuid) - Anonymous installation identifier
  - `domain` (text) - Reported domain
  - `url` (text, optional) - Sanitized page URL
  - `detected_patterns` (jsonb) - Detected pattern IDs
  - `user_reason` (text, optional) - User-provided reason
  - `scan_confidence` (numeric) - Confidence score at time of report
  - `created_at` (timestamptz) - Report timestamp

  ## Security
  - RLS enabled
  - Insert allowed for anon/authenticated
  - Read restricted (admin only)
*/

CREATE TABLE IF NOT EXISTS false_positives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  domain text NOT NULL,
  url text,
  detected_patterns jsonb DEFAULT '[]'::jsonb,
  user_reason text,
  scan_confidence numeric(5,2),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_false_positives_domain
  ON false_positives(domain);

CREATE INDEX IF NOT EXISTS idx_false_positives_created
  ON false_positives(created_at DESC);

ALTER TABLE false_positives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert false positives" ON false_positives;
DROP POLICY IF EXISTS "Admins can read false positives" ON false_positives;

CREATE POLICY "Anyone can insert false positives"
  ON false_positives
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read false positives"
  ON false_positives
  FOR SELECT
  TO anon, authenticated
  USING (false);
