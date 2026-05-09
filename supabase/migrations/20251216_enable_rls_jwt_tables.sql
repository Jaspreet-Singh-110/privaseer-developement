-- Migration: Enable RLS on JWT auth tables
-- These tables contain sensitive installation secrets and should never be
-- accessible via public REST API. Only Edge Functions with service_role
-- and SECURITY DEFINER RPCs should access them.

-- Enable RLS on extension_installations (no policies = deny all public access)
ALTER TABLE public.extension_installations ENABLE ROW LEVEL SECURITY;

-- Enable RLS on generation_logs (no policies = deny all public access)
ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owner (extra safety)
ALTER TABLE public.extension_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.generation_logs FORCE ROW LEVEL SECURITY;

-- No policies are created intentionally:
-- - service_role (used by Edge Functions) bypasses RLS
-- - SECURITY DEFINER functions run with owner privileges and bypass RLS
-- - anon and authenticated roles get zero access via REST API

-- Add a dummy policy to satisfy the security advisor
-- This policy allows NO access (false condition) but documents the intent
CREATE POLICY "no_public_access_by_design" ON public.extension_installations
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "no_public_access_by_design" ON public.generation_logs
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

