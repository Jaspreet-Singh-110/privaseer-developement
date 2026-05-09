/*
  # Add structured reason to false positives

  Adds a machine-readable reason category so false positive aggregation can
  differentiate report intent and support better moderation workflows.
*/

ALTER TABLE false_positives
ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE false_positives
DROP CONSTRAINT IF EXISTS false_positives_reason_check;

ALTER TABLE false_positives
ADD CONSTRAINT false_positives_reason_check
CHECK (reason IN ('banner_compliant', 'no_banner_present', 'wrong_detection', 'other'));

CREATE INDEX IF NOT EXISTS idx_false_positives_reason_created
  ON false_positives(reason, created_at DESC);
