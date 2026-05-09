-- Migration: Add secure JWT auth support for burner email generation
-- Creates installation registry, generation logs, and helper RPCs.

-- 1. Installation registry for issuing JWTs
CREATE TABLE IF NOT EXISTS extension_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid UNIQUE NOT NULL,
  secret_hash text NOT NULL,
  secret_cipher text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_token_at timestamptz,
  is_blocked boolean NOT NULL DEFAULT false,
  blocked_reason text,
  daily_limit int NOT NULL DEFAULT 50,  -- 50 generations per day
  hourly_limit int NOT NULL DEFAULT 20  -- 20 generations per hour
);

-- Helpful index for lookups by installation_id (already unique but explicit)
CREATE INDEX IF NOT EXISTS idx_extension_installations_installation_id
  ON extension_installations(installation_id);

-- 2. Generation logs for accurate rate limiting
CREATE TABLE IF NOT EXISTS generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES extension_installations(installation_id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_logs_installation_time
  ON generation_logs(installation_id, generated_at DESC);

-- 3. Helper function: record a generation event
CREATE OR REPLACE FUNCTION log_generation_event(p_installation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO generation_logs (installation_id)
  VALUES (p_installation_id);
END;
$$;

-- 4. Helper function: check hourly/daily quota
CREATE OR REPLACE FUNCTION check_generation_limits(p_installation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  hourly_limit int;
  daily_limit int;
  hourly_used int;
  daily_used int;
  is_blocked boolean;
  blocked_reason text;
BEGIN
  SELECT
    ei.hourly_limit,
    ei.daily_limit,
    ei.is_blocked,
    COALESCE(ei.blocked_reason, '')
  INTO
    hourly_limit,
    daily_limit,
    is_blocked,
    blocked_reason
  FROM extension_installations ei
  WHERE ei.installation_id = p_installation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'unregistered'
    );
  END IF;

  IF is_blocked THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'blocked',
      'blocked_reason', blocked_reason
    );
  END IF;

  SELECT COUNT(*) INTO hourly_used
  FROM generation_logs
  WHERE installation_id = p_installation_id
    AND generated_at >= now() - interval '1 hour';

  SELECT COUNT(*) INTO daily_used
  FROM generation_logs
  WHERE installation_id = p_installation_id
    AND generated_at >= now() - interval '1 day';

  RETURN jsonb_build_object(
    'allowed', hourly_used < hourly_limit AND daily_used < daily_limit,
    'reason', CASE
      WHEN hourly_used >= hourly_limit THEN 'hourly_limit'
      WHEN daily_used >= daily_limit THEN 'daily_limit'
      ELSE NULL
    END,
    'hourly_limit', hourly_limit,
    'hourly_used', hourly_used,
    'hourly_remaining', GREATEST(hourly_limit - hourly_used, 0),
    'daily_limit', daily_limit,
    'daily_used', daily_used,
    'daily_remaining', GREATEST(daily_limit - daily_used, 0)
  );
END;
$$;


