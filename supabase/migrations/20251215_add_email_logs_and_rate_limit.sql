-- Add email_logs table and rate-limit functions
-- This ensures the inbound-email function can log emails and perform rate limiting

-- Create email_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  burner_email_id uuid REFERENCES burner_emails(id) ON DELETE CASCADE,
  from_address text NOT NULL,
  subject text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  forwarded boolean NOT NULL DEFAULT false,
  forwarded_at timestamptz,
  error_message text,
  trackers_removed int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_logs_burner_email
  ON email_logs(burner_email_id);

CREATE INDEX IF NOT EXISTS idx_email_logs_received
  ON email_logs(received_at DESC);

-- Enable Row Level Security
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own email logs" ON email_logs;
DROP POLICY IF EXISTS "Anonymous can insert email logs" ON email_logs;

-- Policies for email_logs
CREATE POLICY "Users can view own email logs"
  ON email_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM burner_emails
      WHERE burner_emails.id = email_logs.burner_email_id
    )
  );

CREATE POLICY "Anonymous can insert email logs"
  ON email_logs FOR INSERT
  TO anon
  WITH CHECK (true);

-- Add rate limiting columns to burner_emails if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'emails_received'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN emails_received int NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'emails_forwarded'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN emails_forwarded int NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'last_email_at'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN last_email_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'hourly_limit'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN hourly_limit int DEFAULT 50;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'is_paused'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN is_paused boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'paused_reason'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN paused_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'burner_emails' AND column_name = 'paused_at'
  ) THEN
    ALTER TABLE burner_emails ADD COLUMN paused_at timestamptz;
  END IF;
END $$;

-- Function to increment email received counter
CREATE OR REPLACE FUNCTION increment_email_received(p_email_address text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result jsonb;
BEGIN
  UPDATE burner_emails
  SET 
    emails_received = emails_received + 1,
    last_email_at = now()
  WHERE email_address = p_email_address
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING jsonb_build_object(
    'id', id,
    'email_address', email_address,
    'real_email', real_email,
    'is_active', is_active
  ) INTO result;

  RETURN result;
END;
$$;

-- Function to increment forwarded counter
CREATE OR REPLACE FUNCTION increment_email_forwarded(p_burner_email_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE burner_emails
  SET emails_forwarded = emails_forwarded + 1
  WHERE id = p_burner_email_id;
END;
$$;

-- Function to check rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_burner_email_id uuid,
  p_hourly_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  emails_in_last_hour int;
  is_paused boolean;
  result jsonb;
BEGIN
  -- Get current pause status
  SELECT burner_emails.is_paused INTO is_paused
  FROM burner_emails
  WHERE id = p_burner_email_id;

  -- If paused, return immediately
  IF is_paused THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'paused',
      'emails_in_last_hour', 0
    );
  END IF;

  -- Count emails in last hour
  SELECT COUNT(*) INTO emails_in_last_hour
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '1 hour';

  -- Check if limit exceeded
  IF emails_in_last_hour >= p_hourly_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limit',
      'emails_in_last_hour', emails_in_last_hour,
      'hourly_limit', p_hourly_limit
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'emails_in_last_hour', emails_in_last_hour,
    'hourly_limit', p_hourly_limit
  );
END;
$$;

-- Function to detect spam spike
CREATE OR REPLACE FUNCTION detect_spam_spike(
  p_burner_email_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  emails_last_5min int;
  emails_last_15min int;
  emails_last_hour int;
  is_spike boolean := false;
  spike_reason text;
  result jsonb;
BEGIN
  -- Count emails in different time windows
  SELECT COUNT(*) INTO emails_last_5min
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '5 minutes';

  SELECT COUNT(*) INTO emails_last_15min
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '15 minutes';

  SELECT COUNT(*) INTO emails_last_hour
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '1 hour';

  -- Spike detection rules
  IF emails_last_5min >= 10 THEN
    is_spike := true;
    spike_reason := 'High frequency: 10+ emails in 5 minutes';
  ELSIF emails_last_15min >= 25 THEN
    is_spike := true;
    spike_reason := 'Sustained high rate: 25+ emails in 15 minutes';
  ELSIF emails_last_hour >= 100 THEN
    is_spike := true;
    spike_reason := 'Excessive volume: 100+ emails in 1 hour';
  END IF;

  RETURN jsonb_build_object(
    'is_spike', is_spike,
    'reason', spike_reason,
    'emails_last_5min', emails_last_5min,
    'emails_last_15min', emails_last_15min,
    'emails_last_hour', emails_last_hour
  );
END;
$$;

-- Function to pause burner email
CREATE OR REPLACE FUNCTION pause_burner_email(
  p_burner_email_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE burner_emails
  SET
    is_paused = true,
    paused_reason = p_reason,
    paused_at = NOW()
  WHERE id = p_burner_email_id;
END;
$$;

-- Function to unpause burner email
CREATE OR REPLACE FUNCTION unpause_burner_email(
  p_burner_email_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE burner_emails
  SET
    is_paused = false,
    paused_reason = NULL,
    paused_at = NULL
  WHERE id = p_burner_email_id;
END;
$$;

-- Function to get rate limit stats
CREATE OR REPLACE FUNCTION get_rate_limit_stats(
  p_burner_email_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result jsonb;
  emails_last_hour int;
  emails_last_24h int;
  hourly_limit int;
  is_paused boolean;
  paused_reason text;
BEGIN
  -- Get burner email info
  SELECT
    burner_emails.hourly_limit,
    burner_emails.is_paused,
    burner_emails.paused_reason
  INTO hourly_limit, is_paused, paused_reason
  FROM burner_emails
  WHERE id = p_burner_email_id;

  -- Count recent emails
  SELECT COUNT(*) INTO emails_last_hour
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '1 hour';

  SELECT COUNT(*) INTO emails_last_24h
  FROM email_logs
  WHERE burner_email_id = p_burner_email_id
    AND received_at >= NOW() - INTERVAL '24 hours';

  RETURN jsonb_build_object(
    'hourly_limit', hourly_limit,
    'emails_last_hour', emails_last_hour,
    'emails_last_24h', emails_last_24h,
    'is_paused', is_paused,
    'paused_reason', paused_reason,
    'remaining_hour', GREATEST(0, hourly_limit - emails_last_hour)
  );
END;
$$;

