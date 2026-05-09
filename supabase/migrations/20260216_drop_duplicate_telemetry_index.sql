-- Migration: Drop duplicate index on telemetry_events.event_type
-- Issue: idx_telemetry_events_type is a duplicate of idx_telemetry_events_event_type
-- Both indexes cover the same column(s) with the same ordering, wasting
-- disk space and adding unnecessary write overhead.
-- Solution: Keep idx_telemetry_events_event_type (defined in original migration)
-- and drop the duplicate idx_telemetry_events_type.

-- ============================================================
-- STEP 1: Drop the duplicate index
-- ============================================================

DROP INDEX IF EXISTS public.idx_telemetry_events_type;

-- ============================================================
-- Verification (run manually after applying):
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'telemetry_events';
-- Expected: idx_telemetry_events_event_type should remain;
--           idx_telemetry_events_type should be gone.
-- ============================================================
