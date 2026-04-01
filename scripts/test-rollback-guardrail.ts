import assert from "node:assert/strict";
import {
  evaluateRollbackDecision,
  type RollbackPolicy,
  type RollbackMetrics,
} from "@/lib/arena/rollback-guardrail";

const basePolicy: RollbackPolicy = {
  enabled: true,
  mode: "dry_run",
  minSampleSize: 20,
  maxErrorRate: 0.08,
  maxLatencyMs: 3000,
  minSuccessRate: 0.9,
  minTrustScore: 0.55,
  cooldownMinutes: 30,
};

function metrics(overrides: Partial<RollbackMetrics>): RollbackMetrics {
  return {
    sample_size: 30,
    error_rate: 0.03,
    avg_latency_ms: 1400,
    success_rate: 0.97,
    trust_score: 0.82,
    ...overrides,
  };
}

function run() {
  {
    const result = evaluateRollbackDecision({
      policy: basePolicy,
      metrics: metrics({}),
      inCooldown: false,
    });
    assert.equal(result.shouldTrigger, false);
    assert.equal(result.reasons.length, 0);
  }

  {
    const result = evaluateRollbackDecision({
      policy: basePolicy,
      metrics: metrics({ sample_size: 6, error_rate: 0.45 }),
      inCooldown: false,
    });
    assert.equal(result.shouldTrigger, false);
    assert.equal(result.skippedBySampleSize, true);
  }

  {
    const result = evaluateRollbackDecision({
      policy: basePolicy,
      metrics: metrics({ error_rate: 0.2, success_rate: 0.72 }),
      inCooldown: false,
    });
    assert.equal(result.shouldTrigger, true);
    assert.equal(result.reasons.some((r) => r.metric === "error_rate"), true);
    assert.equal(result.reasons.some((r) => r.metric === "success_rate"), true);
  }

  {
    const result = evaluateRollbackDecision({
      policy: basePolicy,
      metrics: metrics({ avg_latency_ms: 5200 }),
      inCooldown: true,
    });
    assert.equal(result.shouldTrigger, false);
    assert.equal(result.blockedByCooldown, true);
    assert.equal(result.reasons.some((r) => r.metric === "avg_latency_ms"), true);
  }

  {
    const result = evaluateRollbackDecision({
      policy: { ...basePolicy, enabled: false },
      metrics: metrics({ error_rate: 0.4 }),
      inCooldown: false,
    });
    assert.equal(result.shouldTrigger, false);
  }

  console.log("rollback guardrail decision tests passed");
}

run();
