/*
  # Create domain confidence overrides

  Stores aggregate false-positive feedback per domain so the extension can
  dynamically raise alert thresholds for consistently misclassified sites.
*/

CREATE TABLE IF NOT EXISTS domain_confidence_overrides (
  domain text PRIMARY KEY,
  override_threshold numeric(5,2) NOT NULL,
  report_count integer NOT NULL DEFAULT 0,
  avg_scan_confidence numeric(5,2),
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_confidence_overrides_last_updated
  ON domain_confidence_overrides(last_updated DESC);

ALTER TABLE domain_confidence_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read domain confidence overrides" ON domain_confidence_overrides;
DROP POLICY IF EXISTS "No direct writes to domain confidence overrides" ON domain_confidence_overrides;

CREATE POLICY "Public can read domain confidence overrides"
  ON domain_confidence_overrides
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "No direct writes to domain confidence overrides"
  ON domain_confidence_overrides
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
