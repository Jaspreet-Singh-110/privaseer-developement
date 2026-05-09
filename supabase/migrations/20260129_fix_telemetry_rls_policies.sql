-- Migration: Fix overly permissive RLS policies on telemetry_events and user_feedback
-- Issue: INSERT policies use WITH CHECK(true), allowing unrestricted access
-- Solution: Deny anon/authenticated INSERT since service_role handles all access

-- ============================================================
-- STEP 1: Drop existing permissive INSERT policies on telemetry_events
-- ============================================================

DROP POLICY IF EXISTS "Allow anonymous telemetry submission" ON public.telemetry_events;
DROP POLICY IF EXISTS "Users can submit telemetry" ON public.telemetry_events;

-- ============================================================
-- STEP 2: Create explicit deny policies for telemetry_events
-- ============================================================

CREATE POLICY "deny_anon_insert"
  ON public.telemetry_events
  FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_insert"
  ON public.telemetry_events
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- ============================================================
-- STEP 3: Drop existing permissive INSERT policies on user_feedback
-- ============================================================

DROP POLICY IF EXISTS "Allow anonymous feedback submission" ON public.user_feedback;
DROP POLICY IF EXISTS "Users can submit feedback" ON public.user_feedback;

-- ============================================================
-- STEP 4: Create explicit deny policies for user_feedback
-- ============================================================

CREATE POLICY "deny_anon_insert"
  ON public.user_feedback
  FOR INSERT
  TO anon
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_insert"
  ON public.user_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
