/*
  # Aggregate false positive reports

  Creates an RPC used by the report-false-positive edge function.
  It counts unique reporters by domain and upserts confidence overrides
  when enough independent reports are present.
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
BEGIN
  SELECT
    COUNT(DISTINCT installation_id)::integer,
    AVG(scan_confidence)::numeric(5,2)
  INTO v_report_count, v_avg_scan_confidence
  FROM false_positives
  WHERE lower(domain) = lower(p_domain);

  IF v_report_count >= 3 THEN
    v_override_threshold := LEAST(95, 80 + (v_report_count * 2));

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
