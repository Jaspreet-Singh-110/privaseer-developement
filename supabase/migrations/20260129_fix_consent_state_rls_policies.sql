-- Migration: Fix overly permissive RLS policies on consent_state and cmp_detections
-- Issue: Policies use USING(true) or WITH CHECK(true), allowing unrestricted access
-- Solution: Deny anon/authenticated access since service_role handles all access

-- ============================================================
-- STEP 1: Drop existing permissive policies on consent_state
-- ============================================================

DROP POLICY IF EXISTS "Users can read own consent state" ON public.consent_state;
DROP POLICY IF EXISTS "Users can insert own consent state" ON public.consent_state;
DROP POLICY IF EXISTS "Users can update own consent state" ON public.consent_state;

-- ============================================================
-- STEP 2: Create explicit deny policies for consent_state
-- ============================================================

CREATE POLICY "deny_anon_all_access"
  ON public.consent_state
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_all_access"
  ON public.consent_state
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- STEP 3: Drop existing permissive policies on cmp_detections
-- ============================================================

DROP POLICY IF EXISTS "Users can insert CMP detections" ON public.cmp_detections;
DROP POLICY IF EXISTS "Users can read own CMP detections" ON public.cmp_detections;

-- ============================================================
-- STEP 4: Create explicit deny policies for cmp_detections
-- ============================================================

CREATE POLICY "deny_anon_all_access"
  ON public.cmp_detections
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_authenticated_all_access"
  ON public.cmp_detections
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
