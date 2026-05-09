-- Migration: Add explicit deny policies to JWT auth tables
-- Issue: RLS enabled but no policies triggers linter warning
-- Solution: Add explicit deny policies to document intent and satisfy linter
-- Note: service_role and SECURITY DEFINER functions bypass RLS

-- ============================================================
-- STEP 1: Add explicit deny policy for extension_installations
-- ============================================================

CREATE POLICY "no_public_access_by_design"
  ON public.extension_installations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- STEP 2: Add explicit deny policy for generation_logs
-- ============================================================

CREATE POLICY "no_public_access_by_design"
  ON public.generation_logs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
