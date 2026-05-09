-- Community CMP suggestion intake
CREATE TABLE IF NOT EXISTS cmp_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  page_url TEXT NOT NULL,
  cookie_names TEXT[] NOT NULL DEFAULT '{}',
  banner_selectors TEXT[] NOT NULL DEFAULT '{}',
  banner_text_snippet TEXT,
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmp_suggestions_domain ON cmp_suggestions (domain);
CREATE INDEX IF NOT EXISTS idx_cmp_suggestions_created_at ON cmp_suggestions (created_at DESC);

ALTER TABLE cmp_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role inserts cmp suggestions" ON cmp_suggestions;
CREATE POLICY "Service role inserts cmp suggestions"
ON cmp_suggestions
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role reads cmp suggestions" ON cmp_suggestions;
CREATE POLICY "Service role reads cmp suggestions"
ON cmp_suggestions
FOR SELECT
USING (auth.role() = 'service_role');
