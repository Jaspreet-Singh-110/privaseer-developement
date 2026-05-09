-- Supabase Migration: Fix Mutable Search Path Vulnerability
--
-- ## Description
-- This migration enhances security by setting an explicit `search_path` for all
-- public functions. This prevents schema shadowing attacks and ensures that
-- functions behave deterministically, regardless of the caller's session settings.
--
-- ## Vulnerability Fixed
-- - **Problem**: Functions without an explicit `search_path` are vulnerable to
--   attacks where a malicious user can create objects (e.g., tables, functions)
--   in a different schema, causing the function to execute unintended code.
-- - **Risk**: High, especially for `SECURITY DEFINER` functions, as it can lead
--   to privilege escalation.
-- - **Solution**: All functions are altered to set `search_path = pg_catalog, public`.
--   This pins name resolution to built-ins first, then your application schema,
--   and avoids resolving caller-controlled temp objects (`pg_temp`).
--
-- ## Functions Altered
-- 1. `cleanup_old_consent_states()`
-- 2. `update_updated_at_column()`
-- 3. `increment_email_received(text)`
-- 4. `increment_email_forwarded(uuid)`
-- 5. `cleanup_expired_burner_emails()`
-- 6. `check_rate_limit(uuid, int)`
-- 7. `detect_spam_spike(uuid)`
-- 8. `pause_burner_email(uuid, text)`
-- 9. `unpause_burner_email(uuid)`
-- 10. `get_rate_limit_stats(uuid)`
-- 11. `log_security_event(...)` - SECURITY DEFINER
-- 12. `audit_burner_email_changes()` - SECURITY DEFINER
-- 13. `is_valid_email(text)`
-- 14. `sanitize_text_input(text, int)`

-- Apply the search_path fix to all public functions
ALTER FUNCTION public.cleanup_old_consent_states() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = pg_catalog, public;
ALTER FUNCTION public.increment_email_received(p_email_address text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.increment_email_forwarded(p_burner_email_id uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.cleanup_expired_burner_emails() SET search_path = pg_catalog, public;
ALTER FUNCTION public.check_rate_limit(p_burner_email_id uuid, p_hourly_limit int) SET search_path = pg_catalog, public;
ALTER FUNCTION public.detect_spam_spike(p_burner_email_id uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pause_burner_email(p_burner_email_id uuid, p_reason text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.unpause_burner_email(p_burner_email_id uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_rate_limit_stats(p_burner_email_id uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.log_security_event(p_event_type text, p_burner_email_id uuid, p_details jsonb, p_ip_address inet, p_user_agent text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.audit_burner_email_changes() SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_valid_email(email text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.sanitize_text_input(input text, max_length int) SET search_path = pg_catalog, public;
