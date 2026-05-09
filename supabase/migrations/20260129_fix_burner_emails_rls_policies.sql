-- Migration: Fix overly permissive RLS policies on burner_emails and email_logs
-- Issue: Policies use USING(true) or WITH CHECK(true), allowing unrestricted access
-- Solution: Deny anon/authenticated access since service_role handles access

-- ============================================================
-- STEP 1: Drop existing permissive policies on burner_emails
-- ============================================================

DROP POLICY IF EXISTS "Users can create burner emails" ON public.burner_emails;
DROP POLICY IF EXISTS "Users can view own burner emails" ON public.burner_emails;
DROP POLICY IF EXISTS "Users can update own burner emails" ON public.burner_emails;
DROP POLICY IF EXISTS "Users can delete own burner emails" ON public.burner_emails;
DROP POLICY IF EXISTS "Users can insert own burner emails" ON public.burner_emails;
DROP POLICY IF EXISTS "Anonymous can select burner emails for webhook" ON public.burner_emails;
DROP POLICY IF EXISTS "Anonymous can update email counters" ON public.burner_emails;

-- ============================================================
-- STEP 2: Create explicit deny policies for burner_emails
-- ============================================================

CREATE POLICY "deny_anon_all_access"
  ON public.burner_emails
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_all_access"
  ON public.burner_emails
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- STEP 3: Fix email_logs INSERT policy
-- ============================================================

DROP POLICY IF EXISTS "Anonymous can insert email logs" ON public.email_logs;

CREATE POLICY "deny_anon_insert_email_logs"
  ON public.email_logs
  FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_insert_email_logs"
  ON public.email_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
