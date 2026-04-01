export type ReliabilityBand = "elite" | "strong" | "watch" | "critical" | "unknown";

export interface ReliabilityInputs {
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  trustScore: number;
  healthComponent: number;
}

export interface ReliabilityResult {
  score: number;
  band: ReliabilityBand;
  drivers: {
    success_component: number;
    error_component: number;
    latency_component: number;
    trust_component: number;
    health_component: number;
  };
}

function clampRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function latencyComponent(avgLatencyMs: number): number {
  if (!Number.isFinite(avgLatencyMs) || avgLatencyMs <= 0) return 1;
  if (avgLatencyMs <= 500) return 1;
  if (avgLatencyMs >= 6000) return 0;
  return 1 - (avgLatencyMs - 500) / 5500;
}

export function reliabilityBand(score: number): ReliabilityBand {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 0.9) return "elite";
  if (score >= 0.75) return "strong";
  if (score >= 0.5) return "watch";
  return "critical";
}

export function computeReliabilityScore(input: ReliabilityInputs): ReliabilityResult {
  const success = clampRate(input.successRate);
  const error = 1 - clampRate(input.errorRate);
  const latency = latencyComponent(input.avgLatencyMs);
  const trust = clampRate(input.trustScore);
  const health = clampRate(input.healthComponent);

  const weights = {
    success: 0.4,
    error: 0.15,
    latency: 0.15,
    trust: 0.2,
    health: 0.1,
  };

  const score =
    success * weights.success +
    error * weights.error +
    latency * weights.latency +
    trust * weights.trust +
    health * weights.health;

  const rounded = Math.round(score * 10000) / 10000;

  return {
    score: rounded,
    band: reliabilityBand(rounded),
    drivers: {
      success_component: Math.round(success * 10000) / 10000,
      error_component: Math.round(error * 10000) / 10000,
      latency_component: Math.round(latency * 10000) / 10000,
      trust_component: Math.round(trust * 10000) / 10000,
      health_component: Math.round(health * 10000) / 10000,
    },
  };
}

export function healthToComponent(
  healthStatus: string | null,
  healthScore: number | null
): number {
  if (healthScore != null && Number.isFinite(healthScore)) {
    return clampRate(healthScore);
  }

  switch (healthStatus) {
    case "healthy":
      return 0.92;
    case "warning":
      return 0.7;
    case "degrading":
      return 0.35;
    default:
      return 0.6;
  }
}

export function explainDelta(current: ReliabilityResult, previous: ReliabilityResult | null): string {
  if (!previous) {
    return "Initial reliability baseline established.";
  }

  const delta = current.score - previous.score;
  const direction = delta >= 0 ? "improved" : "declined";
  const abs = Math.abs(delta);

  const ranked = [
    {
      key: "success rate",
      delta: current.drivers.success_component - previous.drivers.success_component,
    },
    {
      key: "error pressure",
      delta: current.drivers.error_component - previous.drivers.error_component,
    },
    {
      key: "latency",
      delta: current.drivers.latency_component - previous.drivers.latency_component,
    },
    {
      key: "trust",
      delta: current.drivers.trust_component - previous.drivers.trust_component,
    },
    {
      key: "health",
      delta: current.drivers.health_component - previous.drivers.health_component,
    },
  ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const lead = ranked[0];
  const leadDirection = lead.delta >= 0 ? "up" : "down";

  return `Reliability ${direction} by ${(abs * 100).toFixed(1)} points, led by ${lead.key} moving ${leadDirection}.`;
}
