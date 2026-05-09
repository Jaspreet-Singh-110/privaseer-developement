-- Dynamic CMP configuration registry
CREATE TABLE IF NOT EXISTS cmp_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cmp_name TEXT NOT NULL UNIQUE,
  cookie_patterns TEXT[] NOT NULL DEFAULT '{}',
  banner_selectors TEXT[] NOT NULL DEFAULT '{}',
  consent_parsers JSONB NOT NULL DEFAULT '{}'::jsonb,
  version TEXT NOT NULL DEFAULT '1.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmp_configs_active ON cmp_configs (is_active);

ALTER TABLE cmp_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages cmp configs" ON cmp_configs;
CREATE POLICY "Service role manages cmp configs"
ON cmp_configs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Seed core configs mirroring current bundled detectors.
INSERT INTO cmp_configs (cmp_name, cookie_patterns, banner_selectors, consent_parsers, version, is_active)
VALUES
  (
    'onetrust',
    ARRAY['OptanonConsent', 'OptanonAlertBoxClosed', 'eupubconsent-v2'],
    ARRAY['#onetrust-banner-sdk', '.onetrust-banner', '[data-onetrust]'],
    '{"OptanonConsent":"onetrust","OptanonAlertBoxClosed":"onetrust"}'::jsonb,
    '1.0',
    TRUE
  ),
  (
    'cookiebot',
    ARRAY['CookieConsent', 'CookiebotConsent', 'CookieConsentBulkSetting'],
    ARRAY['#CybotCookiebotDialog', '[data-cookieconsent]'],
    '{"CookieConsent":"cookiebot","CookiebotConsent":"cookiebot"}'::jsonb,
    '1.0',
    TRUE
  ),
  (
    'termly',
    ARRAY['termly-consent', 't_privacy_consent', 't_cookie_consent'],
    ARRAY['[data-termly]', '#termly-code-snippet-support'],
    '{"termly-consent":"generic"}'::jsonb,
    '1.0',
    TRUE
  )
ON CONFLICT (cmp_name) DO NOTHING;
