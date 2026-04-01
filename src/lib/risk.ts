export type RiskConfidence = "low" | "medium" | "high";

export interface RiskSnapshot {
  confidence: RiskConfidence;
  reason_code: string;
}

export function scoreSuccessfulResult(params: {
  validated: boolean;
  durationMs: number;
}): RiskSnapshot {
  if (!params.validated) {
    return { confidence: "low", reason_code: "schema_validation_failed" };
  }

  if (params.durationMs >= 20_000) {
    return { confidence: "medium", reason_code: "slow_response" };
  }

  return { confidence: "high", reason_code: "validated_output" };
}

export function scoreFailedResult(): RiskSnapshot {
  return { confidence: "low", reason_code: "upstream_error" };
}
