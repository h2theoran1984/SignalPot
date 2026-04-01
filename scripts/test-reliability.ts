import assert from "node:assert/strict";
import {
  computeReliabilityScore,
  explainDelta,
  healthToComponent,
} from "@/lib/reliability";

function run() {
  const good = computeReliabilityScore({
    successRate: 0.98,
    errorRate: 0.02,
    avgLatencyMs: 700,
    trustScore: 0.92,
    healthComponent: 0.9,
  });

  const bad = computeReliabilityScore({
    successRate: 0.65,
    errorRate: 0.35,
    avgLatencyMs: 5400,
    trustScore: 0.42,
    healthComponent: 0.3,
  });

  assert.equal(good.band === "elite" || good.band === "strong", true);
  assert.equal(bad.band === "watch" || bad.band === "critical", true);
  assert.equal(good.score > bad.score, true);

  assert.equal(healthToComponent("healthy", null) > healthToComponent("degrading", null), true);
  assert.equal(healthToComponent(null, 0.83), 0.83);

  const explanation = explainDelta(good, bad);
  assert.equal(explanation.includes("Reliability"), true);

  console.log("reliability scoring tests passed");
}

run();
