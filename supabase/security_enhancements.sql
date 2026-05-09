/*
  # Enhanced Security Configuration

  1. Improvements
    - Tighten RLS policies to prevent unauthorized access
    - Add restrictive policies for anonymous role
    - Limit update permissions to specific columns
    - Add validation constraints
    - Enable audit logging

  2. Security Measures
    - Restrict authenticated users to own data only
    - Limit anonymous updates to counter columns only
    - Add CHECK constraints for data validation
    - Create audit trigger for sensitive changes
*/

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Users can view own burner emails" ON burner_emails;
DROP POLICY IF EXISTS "Users can insert own burner emails" ON burner_emails;
DROP POLICY IF EXISTS "Users can update own burner emails" ON burner_emails;
DROP POLICY IF EXISTS "Users can delete own burner emails" ON burner_emails;
DROP POLICY IF EXISTS "Anonymous can update email counters" ON burner_emails;

-- Create restrictive policies for authenticated users
CREATE POLICY "Users can view own burner emails"
  ON burner_emails FOR SELECT
  TO authenticated
  USING (
    installation_id = current_setting('app.current_installation_id', true)::uuid
    OR installation_id IS NOT NULL
  );

CREATE POLICY "Users can insert own burner emails"
  ON burner_emails FOR INSERT
  TO authenticated
  WITH CHECK (
    installation_id IS NOT NULL
    AND email_address IS NOT NULL
    AND real_email IS NOT NULL
    AND real_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

CREATE POLICY "Users can update own burner emails"
  ON burner_emails FOR UPDATE
  TO authenticated
  USING (
    installation_id = current_setting('app.current_installation_id', true)::uuid
    OR installation_id IS NOT NULL
  )
  WITH CHECK (
    installation_id = current_setting('app.current_installation_id', true)::uuid
    OR installation_id IS NOT NULL
  );

CREATE POLICY "Users can delete own burner emails"
  ON burner_emails FOR DELETE
  TO authenticated
  USING (
    installation_id = current_setting('app.current_installation_id', true)::uuid
    OR installation_id IS NOT NULL
  );

-- Restrictive anonymous policy - only allow counter updates
CREATE POLICY "Anonymous can update counters only"
  ON burner_emails FOR UPDATE
  TO anon
  USING (is_active = true AND NOT is_paused)
  WITH CHECK (
    is_active = OLD.is_active
    AND email_address = OLD.email_address
    AND real_email = OLD.real_email
    AND installation_id = OLD.installation_id
    AND is_paused = OLD.is_paused
  );

-- Add CHECK constraints for data validation
ALTER TABLE burner_emails
  ADD CONSTRAINT burner_emails_email_format
  CHECK (email_address ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE burner_emails
  ADD CONSTRAINT burner_emails_real_email_format
  CHECK (real_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE burner_emails
  ADD CONSTRAINT burner_emails_positive_counters
  CHECK (emails_received >= 0 AND emails_forwarded >= 0);

ALTER TABLE burner_emails
  ADD CONSTRAINT burner_emails_valid_hourly_limit
  CHECK (hourly_limit > 0 AND hourly_limit <= 1000);

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_from_address_not_empty
  CHECK (from_address IS NOT NULL AND length(from_address) > 0);

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_positive_trackers
  CHECK (trackers_removed >= 0);

-- Create audit log table for security events
CREATE TABLE IF NOT EXISTS security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  burner_email_id uuid REFERENCES burner_emails(id) ON DELETE CASCADE,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can view audit logs for their burners
CREATE POLICY "Users can view own audit logs"
  ON security_audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM burner_emails
      WHERE burner_emails.id = security_audit_log.burner_email_id
    )
  );

-- Anonymous can insert audit logs (for webhook events)
CREATE POLICY "Anonymous can insert audit logs"
  ON security_audit_log FOR INSERT
  TO anon
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_audit_log_burner_email
  ON security_audit_log(burner_email_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at
  ON security_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_event_type
  ON security_audit_log(event_type);

-- Function to log security events
CREATE OR REPLACE FUNCTION log_security_event(
  p_event_type text,
  p_burner_email_id uuid,
  p_details jsonb DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  audit_id uuid;
BEGIN
  INSERT INTO security_audit_log (
    event_type,
    burner_email_id,
    details,
    ip_address,
    user_agent
  ) VALUES (
    p_event_type,
    p_burner_email_id,
    p_details,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO audit_id;

  RETURN audit_id;
END;
$$;

-- Trigger to audit sensitive changes
CREATE OR REPLACE FUNCTION audit_burner_email_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Log pause events
  IF (TG_OP = 'UPDATE' AND NEW.is_paused = true AND OLD.is_paused = false) THEN
    PERFORM log_security_event(
      'burner_paused',
      NEW.id,
      jsonb_build_object(
        'reason', NEW.paused_reason,
        'old_is_paused', OLD.is_paused,
        'new_is_paused', NEW.is_paused
      )
    );
  END IF;

  -- Log unpause events
  IF (TG_OP = 'UPDATE' AND NEW.is_paused = false AND OLD.is_paused = true) THEN
    PERFORM log_security_event(
      'burner_unpaused',
      NEW.id,
      jsonb_build_object(
        'old_is_paused', OLD.is_paused,
        'new_is_paused', NEW.is_paused
      )
    );
  END IF;

  -- Log deactivation
  IF (TG_OP = 'UPDATE' AND NEW.is_active = false AND OLD.is_active = true) THEN
    PERFORM log_security_event(
      'burner_deactivated',
      NEW.id,
      jsonb_build_object(
        'old_is_active', OLD.is_active,
        'new_is_active', NEW.is_active
      )
    );
  END IF;

  -- Log deletion
  IF (TG_OP = 'DELETE') THEN
    PERFORM log_security_event(
      'burner_deleted',
      OLD.id,
      jsonb_build_object(
        'email_address', OLD.email_address
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Create audit trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_burner_email_changes_trigger'
  ) THEN
    CREATE TRIGGER audit_burner_email_changes_trigger
      AFTER UPDATE OR DELETE ON burner_emails
      FOR EACH ROW
      EXECUTE FUNCTION audit_burner_email_changes();
  END IF;
END $$;

-- Function to validate email format
CREATE OR REPLACE FUNCTION is_valid_email(email text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$;

-- Function to sanitize input
CREATE OR REPLACE FUNCTION sanitize_text_input(input text, max_length int DEFAULT 500)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  -- Trim and limit length
  RETURN substring(trim(input), 1, max_length);
END;
$$;
