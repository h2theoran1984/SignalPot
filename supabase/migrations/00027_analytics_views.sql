-- Analytics functions for org-level usage metrics
-- Used by GET /api/orgs/[slug]/analytics

-- Monthly usage stats per org (aggregated from jobs table)
CREATE OR REPLACE FUNCTION get_org_usage_stats(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
  total_api_calls BIGINT,
  successful_calls BIGINT,
  failed_calls BIGINT,
  total_cost_millicents BIGINT,
  avg_latency_ms NUMERIC,
  unique_agents_used BIGINT,
  unique_callers BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_api_calls,
    COUNT(*) FILTER (WHERE j.status = 'completed')::BIGINT as successful_calls,
    COUNT(*) FILTER (WHERE j.status = 'failed')::BIGINT as failed_calls,
    COALESCE(SUM(CASE WHEN j.cost IS NOT NULL THEN (j.cost * 100000)::BIGINT ELSE 0 END), 0)::BIGINT as total_cost_millicents,
    COALESCE(AVG(j.duration_ms), 0)::NUMERIC as avg_latency_ms,
    COUNT(DISTINCT j.provider_agent_id)::BIGINT as unique_agents_used,
    COUNT(DISTINCT j.requester_profile_id)::BIGINT as unique_callers
  FROM jobs j
  WHERE j.requester_profile_id IN (
    SELECT profile_id FROM org_members WHERE org_id = p_org_id
  )
  AND j.created_at >= p_start_date
  AND j.created_at < p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Top agents by usage for an org
CREATE OR REPLACE FUNCTION get_org_top_agents(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_end_date TIMESTAMPTZ DEFAULT now(),
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
  agent_id UUID,
  agent_name TEXT,
  agent_slug TEXT,
  call_count BIGINT,
  total_cost_millicents BIGINT,
  avg_latency_ms NUMERIC,
  success_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id as agent_id,
    a.name as agent_name,
    a.slug as agent_slug,
    COUNT(*)::BIGINT as call_count,
    COALESCE(SUM(CASE WHEN j.cost IS NOT NULL THEN (j.cost * 100000)::BIGINT ELSE 0 END), 0)::BIGINT as total_cost_millicents,
    COALESCE(AVG(j.duration_ms), 0)::NUMERIC as avg_latency_ms,
    CASE WHEN COUNT(*) > 0
      THEN (COUNT(*) FILTER (WHERE j.status = 'completed'))::NUMERIC / COUNT(*)
      ELSE 0
    END as success_rate
  FROM jobs j
  JOIN agents a ON a.id = j.provider_agent_id
  WHERE j.requester_profile_id IN (
    SELECT profile_id FROM org_members WHERE org_id = p_org_id
  )
  AND j.created_at >= p_start_date
  AND j.created_at < p_end_date
  GROUP BY a.id, a.name, a.slug
  ORDER BY call_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Daily usage breakdown for charts
CREATE OR REPLACE FUNCTION get_org_daily_usage(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
  day DATE,
  api_calls BIGINT,
  cost_millicents BIGINT,
  avg_latency_ms NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.created_at::DATE as day,
    COUNT(*)::BIGINT as api_calls,
    COALESCE(SUM(CASE WHEN j.cost IS NOT NULL THEN (j.cost * 100000)::BIGINT ELSE 0 END), 0)::BIGINT as cost_millicents,
    COALESCE(AVG(j.duration_ms), 0)::NUMERIC as avg_latency_ms
  FROM jobs j
  WHERE j.requester_profile_id IN (
    SELECT profile_id FROM org_members WHERE org_id = p_org_id
  )
  AND j.created_at >= p_start_date
  AND j.created_at < p_end_date
  GROUP BY j.created_at::DATE
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
