/*
  # Create scoring configuration table

  Stores remotely managed scoring weights and factor caps so the extension
  can tune scoring behavior without shipping a full extension update.
*/

CREATE TABLE IF NOT EXISTS scoring_config (
  id bigint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version text NOT NULL,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scoring_config_updated_at
  ON scoring_config(updated_at DESC);

INSERT INTO scoring_config (id, version, config)
VALUES (
  1,
  '1.0',
  '{
    "version": "1.0",
    "riskWeights": {
      "analytics": 1,
      "advertising": 2,
      "social": 2,
      "fingerprinting": 5,
      "beacons": 2,
      "cryptomining": 10,
      "malware": 20,
      "unknown": 1
    },
    "creditFactors": {
      "protectionMultiplier": 50,
      "protectionCap": 150,
      "cleanBrowsingMultiplier": 10,
      "cleanBrowsingCap": 100,
      "highRiskCap": -200,
      "violationMultiplier": 25,
      "violationCap": -100,
      "dailyHighRiskCap": 30
    },
    "decay": {
      "enabled": true,
      "base": 0.5,
      "maxOccurrences": 4
    }
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read scoring config" ON scoring_config;
DROP POLICY IF EXISTS "No direct writes to scoring config" ON scoring_config;

CREATE POLICY "Public can read scoring config"
  ON scoring_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "No direct writes to scoring config"
  ON scoring_config
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
