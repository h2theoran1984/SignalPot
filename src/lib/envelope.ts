// SignalPot envelope — wraps all agent interactions for auditing and dispute evidence.

export interface SignalPotRequestEnvelope {
  sp_version: string;        // "1.0"
  job_id: string;
  timestamp: string;         // ISO 8601
  caller_id: string;         // profile ID or agent slug
  provider_slug: string;
  capability: string | null; // capability being invoked, if known
  input: unknown;            // the raw input payload
}

export interface SignalPotResponseEnvelope {
  sp_version: string;
  job_id: string;
  timestamp: string;
  provider_slug: string;
  duration_ms: number;
  output: unknown;             // the raw output payload
  verified: boolean;           // whether output passed schema validation
  validation_errors: string[]; // empty if verified
}

export function wrapRequest(params: {
  jobId: string;
  callerId: string;
  providerSlug: string;
  capability: string | null;
  input: unknown;
}): SignalPotRequestEnvelope {
  return {
    sp_version: "1.0",
    job_id: params.jobId,
    timestamp: new Date().toISOString(),
    caller_id: params.callerId,
    provider_slug: params.providerSlug,
    capability: params.capability,
    input: params.input,
  };
}

export function wrapResponse(params: {
  jobId: string;
  providerSlug: string;
  durationMs: number;
  output: unknown;
  verified: boolean;
  validationErrors: string[];
}): SignalPotResponseEnvelope {
  return {
    sp_version: "1.0",
    job_id: params.jobId,
    timestamp: new Date().toISOString(),
    provider_slug: params.providerSlug,
    duration_ms: params.durationMs,
    output: params.output,
    verified: params.verified,
    validation_errors: params.validationErrors,
  };
}
