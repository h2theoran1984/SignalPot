/**
 * Token + cost tracking for Architect pipeline steps.
 */

// Sonnet 4.6 pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-opus-4-6": { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
};

export interface StepUsage {
  step: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface PipelineUsage {
  steps: StepUsage[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
}

export function computeStepCost(
  step: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): StepUsage {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"];
  const cost = inputTokens * pricing.input + outputTokens * pricing.output;

  return {
    step,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
  };
}

export function aggregateUsage(steps: StepUsage[]): PipelineUsage {
  const totalInput = steps.reduce((s, u) => s + u.input_tokens, 0);
  const totalOutput = steps.reduce((s, u) => s + u.output_tokens, 0);
  const totalCost = steps.reduce((s, u) => s + u.cost_usd, 0);

  return {
    steps,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_tokens: totalInput + totalOutput,
    total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
  };
}
