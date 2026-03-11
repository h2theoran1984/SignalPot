-- 00025: Trust score inflation fix
-- Adds a per-pair cooldown to prevent the same agent pair from farming
-- trust scores via rapid repeated job completions.
-- Cooldown: 1 hour between trust_edge updates for the same (source, target) pair.

CREATE OR REPLACE FUNCTION update_trust_edge_on_job()
RETURNS TRIGGER AS $$
DECLARE
  v_base_score    NUMERIC;
  v_weight_factor NUMERIC;
  v_new_total_spent NUMERIC;
  v_last_job_at   TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'completed' AND NEW.requester_agent_id IS NOT NULL THEN

    -- Cooldown check: skip trust update if the same pair completed a job < 1 hour ago
    SELECT last_job_at INTO v_last_job_at
    FROM trust_edges
    WHERE source_agent_id = NEW.requester_agent_id
      AND target_agent_id = NEW.provider_agent_id;

    IF v_last_job_at IS NOT NULL AND v_last_job_at > now() - interval '1 hour' THEN
      -- Still count the job but don't boost the trust score
      UPDATE trust_edges
      SET total_jobs = total_jobs + 1,
          last_job_at = now()
      WHERE source_agent_id = NEW.requester_agent_id
        AND target_agent_id = NEW.provider_agent_id;
      RETURN NEW;
    END IF;

    INSERT INTO trust_edges (
      source_agent_id, target_agent_id,
      total_jobs, successful_jobs, production_jobs,
      total_spent, avg_latency_ms, last_job_at,
      trust_score
    )
    VALUES (
      NEW.requester_agent_id,
      NEW.provider_agent_id,
      1,
      1,
      CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      COALESCE(NEW.cost, 0),
      COALESCE(NEW.duration_ms, 0),
      now(),
      -- First job: base score with stake weight
      LEAST(1.0,
        (CASE WHEN NEW.job_type = 'production' THEN 1.0 ELSE 0.5 END)
        * (1.0 + ln(1.0 + (COALESCE(NEW.cost, 0) * 100000.0 / 100000.0)))
      )
    )
    ON CONFLICT (source_agent_id, target_agent_id) DO UPDATE SET
      total_jobs      = trust_edges.total_jobs + 1,
      successful_jobs = trust_edges.successful_jobs + 1,
      production_jobs = trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      total_spent     = trust_edges.total_spent + COALESCE(NEW.cost, 0),
      avg_latency_ms  = (trust_edges.avg_latency_ms * trust_edges.total_jobs + COALESCE(NEW.duration_ms, 0)) / (trust_edges.total_jobs + 1),
      last_job_at     = now(),
      trust_score     = LEAST(1.0,
        -- Base score: success rate * production bonus
        (
          (trust_edges.successful_jobs + 1)::NUMERIC / (trust_edges.total_jobs + 1)
          * (1 + 0.5 * (
              (trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END)::NUMERIC
              / GREATEST(trust_edges.total_jobs + 1, 1)
            ))
        )
        -- Stake weight: logarithmic scaling on total spend
        * (1.0 + ln(1.0 + ((trust_edges.total_spent + COALESCE(NEW.cost, 0)) * 100000.0 / 100000.0)))
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
