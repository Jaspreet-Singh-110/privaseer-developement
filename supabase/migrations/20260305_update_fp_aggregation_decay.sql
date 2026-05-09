/*
  # Update false positive aggregation with time decay and weighted confidence

  Changes:
  - Count only reports from the last 90 days.
  - Compute weighted override threshold using report volume and average scan confidence.
  - Remove stale overrides when a domain no longer meets the minimum reporter threshold.
*/

CREATE OR REPLACE FUNCTION aggregate_false_positive_reports(p_domain text)
RETURNS TABLE (
  report_count integer,
  override_threshold numeric,
  should_override boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_count integer := 0;
  v_avg_scan_confidence numeric(5,2) := NULL;
  v_override_threshold numeric(5,2) := NULL;
  v_confidence_factor numeric := 0;
  v_report_weight numeric := 0;
BEGIN
  SELECT
    COUNT(DISTINCT installation_id)::integer,
    AVG(scan_confidence)::numeric(5,2)
  INTO v_report_count, v_avg_scan_confidence
  FROM false_positives
  WHERE lower(domain) = lower(p_domain)
    AND created_at >= now() - interval '90 days';

  IF v_report_count >= 3 THEN
    v_confidence_factor := GREATEST(0, LEAST(1, COALESCE(v_avg_scan_confidence, 80) / 100));
    v_report_weight := LEAST(15, v_report_count * 3);
    v_override_threshold := LEAST(
      95,
      (80 + (v_report_weight * (1 - (v_confidence_factor * 0.3))))::numeric(5,2)
    );

    INSERT INTO domain_confidence_overrides (
      domain,
      override_threshold,
      report_count,
      avg_scan_confidence,
      last_updated
    )
    VALUES (
      lower(p_domain),
      v_override_threshold,
      v_report_count,
      v_avg_scan_confidence,
      now()
    )
    ON CONFLICT (domain)
    DO UPDATE SET
      override_threshold = EXCLUDED.override_threshold,
      report_count = EXCLUDED.report_count,
      avg_scan_confidence = EXCLUDED.avg_scan_confidence,
      last_updated = now();
  ELSE
    DELETE FROM domain_confidence_overrides
    WHERE lower(domain) = lower(p_domain);
  END IF;

  RETURN QUERY
  SELECT
    v_report_count,
    v_override_threshold,
    (v_report_count >= 3);
END;
$$;

REVOKE ALL ON FUNCTION aggregate_false_positive_reports(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aggregate_false_positive_reports(text) TO service_role;
