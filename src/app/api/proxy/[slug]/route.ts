import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAnonRateLimit, checkAnonAgentRateLimit } from "@/lib/rate-limit";
import { getAuthContext, rateLimitResponse } from "@/lib/auth";
import { proxyCallSchema } from "@/lib/validations";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import { assertSafeUrl } from "@/lib/ssrf";
import { trackAgentCall } from "@/lib/telemetry";
import { scoreFailedResult, scoreSuccessfulResult } from "@/lib/risk";

// Allowed origins for CORS — proxy is a public API so agents call it cross-origin,
// but we restrict to known domains rather than wildcard to prevent CSRF.
const PROD_ORIGINS = [
  "https://www.signalpot.dev",
  "https://signalpot.dev",
];
const DEV_ORIGINS = [
  ...PROD_ORIGINS,
  "http://localhost:3000",
  "http://localhost:3002",
];
const ALLOWED_ORIGINS = new Set(
  process.env.NODE_ENV === "production" ? PROD_ORIGINS : DEV_ORIGINS
);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://www.signalpot.dev";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

// Pre-flight CORS
export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request.headers.get("origin")) });
}

/**
 * POST /api/proxy/[slug]
 * Synchronous proxy — calls an agent and returns the result.
 * Supports two modes:
 *   1. Authenticated (Bearer token / session) — deducts from profile credits
 *   2. Anonymous — paid agents require a session_token (from /api/proxy/credits)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();
  const headers = getCorsHeaders(request.headers.get("origin"));
  const corsJson = (body: unknown, init?: { status?: number }) =>
    NextResponse.json(body, { ...init, headers });

  // 0. Check for authenticated caller (optional — falls back to anonymous)
  const auth = await getAuthContext(request);
  const isAuthenticated = auth !== null;

  // 1. Rate limit — all callers are rate-limited.
  //    API key users are limited by getAuthContext (checkApiKeyRateLimit).
  //    Session users get a per-user rate limit here.
  //    Anonymous callers use IP-based limits.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  if (isAuthenticated && auth.authMethod === "session") {
    // Session-based auth: apply per-user rate limit (60 rpm)
    const { checkApiKeyRateLimit } = await import("@/lib/rate-limit");
    const sessionRateCheck = await checkApiKeyRateLimit(
      `session:${auth.profileId}`,
      60
    );
    if (!sessionRateCheck.success) {
      return corsJson(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
  }

  if (!isAuthenticated) {
    const rateCheck = await checkAnonRateLimit(ip);
    if (!rateCheck.success) {
      return rateLimitResponse(rateCheck.reset);
    }

    // Per-agent global cap (100/hr) — prevents VPN swarm attacks
    const agentRateCheck = await checkAnonAgentRateLimit(slug);
    if (!agentRateCheck.success) {
      return corsJson(
        {
          error: "This agent has reached its anonymous call limit — try again later",
          retry_after: Math.ceil((agentRateCheck.reset - Date.now()) / 1000),
        },
        { status: 429 }
      );
    }
  }

  // 1b. Org-level monthly quota check
  let orgQuotaRemaining: number | null = null;
  let orgQuotaLimit: number | null = null;

  if (isAuthenticated && auth.orgId) {
    const { data: org } = await admin
      .from("organizations")
      .select("plan")
      .eq("id", auth.orgId)
      .single();

    if (org) {
      const { ORG_MONTHLY_QUOTAS } = await import("@/lib/plans");
      const monthlyLimit = ORG_MONTHLY_QUOTAS[org.plan] ?? ORG_MONTHLY_QUOTAS.free;
      const { checkOrgMonthlyQuota } = await import("@/lib/rate-limit");
      const quotaCheck = await checkOrgMonthlyQuota(auth.orgId, monthlyLimit);
      if (!quotaCheck.success) {
        return corsJson(
          { error: "Organization monthly API quota exceeded", remaining: 0, reset: quotaCheck.reset },
          { status: 429 }
        );
      }
      orgQuotaRemaining = quotaCheck.remaining;
      orgQuotaLimit = monthlyLimit;
    }
  }

  // 2. Parse and validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return corsJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = proxyCallSchema.safeParse(rawBody);
  if (!parsed.success) {
    return corsJson(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { capability, input, session_token, idempotency_key } = parsed.data;

  // 3. Idempotency check — atomically claim the key to prevent double-processing.
  //    We INSERT first (with ON CONFLICT DO NOTHING), then check if it already existed.
  //    This prevents the race window where two concurrent requests both pass a SELECT check.
  const { data: existingKey } = await admin
    .from("idempotency_keys")
    .select("response_body")
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existingKey?.response_body) {
    return corsJson(existingKey.response_body);
  }

  // Atomically claim the idempotency key BEFORE payment.
  // If a concurrent request already claimed it, the unique constraint
  // will cause this to fail, and we return a 409.
  if (!existingKey) {
    const { error: claimError } = await admin
      .from("idempotency_keys")
      .insert({ idempotency_key, job_id: null, response_body: null });

    if (claimError) {
      // Unique constraint violation = concurrent duplicate request
      return corsJson(
        { error: "Duplicate request — processing in progress" },
        { status: 409 }
      );
    }
  }

  // 4. Look up agent
  const { data: agent } = await admin
    .from("agents")
    .select("id, slug, owner_id, status, rate_amount, mcp_endpoint, capability_schema, listing_type, parent_agent_id")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return corsJson({ error: "Agent not found or inactive" }, { status: 404 });
  }

  // Block direct calls to suite agents — they're containers, not callable
  if (agent.listing_type === "suite") {
    return corsJson(
      {
        error: "Suite agents are not directly callable. Call a sub-agent instead.",
        hint: `GET /api/agents?parent_agent_id=${agent.id} to list sub-agents`,
      },
      { status: 400 }
    );
  }

  // If this is a sub-agent, route through the parent suite's endpoint
  let effectiveEndpoint = agent.mcp_endpoint;
  let suiteRouting: { child_slug: string; child_id: string } | null = null;

  if (agent.parent_agent_id) {
    const { data: parentAgent } = await admin
      .from("agents")
      .select("id, slug, mcp_endpoint, status, listing_type")
      .eq("id", agent.parent_agent_id)
      .eq("status", "active")
      .single();

    if (!parentAgent || parentAgent.listing_type !== "suite") {
      return corsJson(
        { error: "Parent suite agent not found or inactive" },
        { status: 502 }
      );
    }

    if (!parentAgent.mcp_endpoint) {
      return corsJson(
        { error: "Parent suite agent has no endpoint configured" },
        { status: 502 }
      );
    }

    effectiveEndpoint = parentAgent.mcp_endpoint;
    suiteRouting = {
      child_slug: agent.slug,
      child_id: agent.id,
    };
  }

  if (!effectiveEndpoint) {
    return corsJson(
      { error: "Agent has no endpoint configured" },
      { status: 502 }
    );
  }

  // 5. Validate capability exists on this agent
  const capabilities = (agent.capability_schema as Array<{ name: string }>) ?? [];
  if (capabilities.length > 0) {
    const matched = capabilities.find((c) => c.name === capability);
    if (!matched) {
      return corsJson(
        {
          error: `Capability '${capability}' not found on agent '${slug}'`,
          available: capabilities.map((c) => c.name),
        },
        { status: 400 }
      );
    }
  }

  // 6. Handle payment for paid agents
  let anonymousSessionId: string | null = null;
  const rateAmount = Number(agent.rate_amount) || 0;

  if (rateAmount > 0) {
    const rateMillicents = Math.floor(rateAmount * 100_000);

    if (isAuthenticated) {
      // Authenticated caller — deduct from profile credits
      const { error: paymentError } = await admin.rpc("settle_user_payment", {
        p_profile_id: auth.profileId,
        p_amount_millicents: rateMillicents,
      });

      if (paymentError) {
        const msg = paymentError.message ?? "";
        if (msg.includes("USER_NOT_FOUND")) {
          return corsJson({ error: "User profile not found" }, { status: 401 });
        }
        if (msg.includes("INSUFFICIENT_BALANCE")) {
          return corsJson(
            { error: "Insufficient credits", cost: rateAmount, hint: "Top up at /dashboard" },
            { status: 402 }
          );
        }
        return corsJson({ error: "Payment failed" }, { status: 500 });
      }
    } else {
      // Anonymous caller — require session_token
      if (!session_token) {
        return corsJson(
          {
            error: "session_token required for paid agents",
            hint: "Purchase credits via POST /api/proxy/credits",
            cost: rateAmount,
          },
          { status: 402 }
        );
      }

      const { error: paymentError } = await admin.rpc("settle_anonymous_payment", {
        p_session_token: session_token,
        p_amount_millicents: rateMillicents,
      });

      if (paymentError) {
        const msg = paymentError.message ?? "";
        if (msg.includes("SESSION_NOT_FOUND_OR_EXPIRED")) {
          return corsJson({ error: "Session expired or not found" }, { status: 401 });
        }
        if (msg.includes("DAILY_SPEND_CAP_EXCEEDED")) {
          return corsJson({ error: "Daily spend cap ($5) exceeded" }, { status: 429 });
        }
        if (msg.includes("INSUFFICIENT_BALANCE")) {
          return corsJson(
            { error: "Insufficient credits", cost: rateAmount },
            { status: 402 }
          );
        }
        return corsJson({ error: "Payment failed" }, { status: 500 });
      }

      anonymousSessionId = session_token;
    }
  }

  // 7. Create job record
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      provider_agent_id: agent.id,
      requester_profile_id: isAuthenticated ? auth.profileId : null,
      requester_agent_id: null,
      anonymous_session_id: anonymousSessionId,
      job_type: "production",
      capability_used: capability,
      input_summary: input,
      status: "pending",
      cost: rateAmount,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return corsJson({ error: "Failed to create job" }, { status: 500 });
  }

  // 8. Build request envelope for auditing
  const requestEnvelope = wrapRequest({
    jobId: job.id as string,
    callerId: isAuthenticated ? auth.profileId : (anonymousSessionId ?? `anon:${ip}`),
    providerSlug: slug,
    capability,
    input,
  });

  // Store envelope in job input
  await admin
    .from("jobs")
    .update({ input_summary: { ...input, _envelope: requestEnvelope } })
    .eq("id", job.id);

  // 9. SSRF check — block private IPs, localhost, cloud metadata
  try {
    await assertSafeUrl(effectiveEndpoint);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blocked endpoint";
    return corsJson({ error: message }, { status: 400 });
  }

  // 10. Forward to agent's MCP endpoint (synchronous)
  let agentResponse: Record<string, unknown>;
  let providerCostUsd: number | null = null;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    // Build headers — include internal dispatch key for platform agents
    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const internalKey = process.env.INTERNAL_DISPATCH_KEY;
    if (internalKey && suiteRouting) {
      fetchHeaders["x-signalpot-internal"] = internalKey;
    }

    const res = await fetch(effectiveEndpoint, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({
        capability,
        input,
        job_id: job.id,
        _envelope: requestEnvelope,
        ...(suiteRouting && { _suite: suiteRouting }),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    agentResponse = (await res.json()) as Record<string, unknown>;

    // Extract provider-reported API cost from _meta (if present)
    // Check both top-level and JSON-RPC result wrapper locations
    const metaSource = (agentResponse.result as Record<string, unknown>)?._meta ?? agentResponse._meta;
    const pc = (metaSource as Record<string, unknown>)?.provider_cost as Record<string, unknown> | undefined;
    if (typeof pc?.api_cost_usd === "number") {
      providerCostUsd = pc.api_cost_usd;
    }
  } catch (err) {
    const risk = scoreFailedResult();

    // Mark job as failed
    await admin
      .from("jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        verified: false,
        output_summary: { _risk: risk },
      })
      .eq("id", job.id);

    trackAgentCall({
      agentId: agent.id as string,
      profileId: agent.owner_id as string,
      event: "call_failed",
      capability,
      durationMs: Date.now() - startTime,
      apiCost: 0,
      cost: 0,
      success: false,
      caller: isAuthenticated ? "api" : "anonymous",
      metadata: {
        risk_confidence: risk.confidence,
        risk_reason_code: risk.reason_code,
      },
    });

    const message = err instanceof Error ? err.message : "Agent unreachable";
    return corsJson(
      { error: `Agent call failed: ${message}`, job_id: job.id },
      { status: 502 }
    );
  }

  const durationMs = Date.now() - startTime;

  // 10. Validate output against agent's declared schema
  const capSchemas = (agent.capability_schema as Array<Record<string, unknown>>) ?? [];
  const matchedCap = capSchemas.find(
    (c) => (c as { name: string }).name === capability
  );
  const outputSchema = (matchedCap?.outputSchema as Record<string, unknown>) ?? null;
  const validation = validateOutput(outputSchema, agentResponse);
  const risk = scoreSuccessfulResult({
    validated: validation.valid,
    durationMs,
  });

  // 11. Build response envelope and update job as completed
  const isSensitive = agentResponse.sensitive === true;

  const responseEnvelope = wrapResponse({
    jobId: job.id as string,
    providerSlug: slug,
    durationMs,
    output: isSensitive ? { redacted: true } : agentResponse,
    verified: validation.valid,
    validationErrors: validation.errors,
  });

  await admin
    .from("jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      output_summary: isSensitive
        ? { redacted: true, _envelope: responseEnvelope, _risk: risk }
        : { ...agentResponse, _envelope: responseEnvelope, _risk: risk },
      duration_ms: durationMs,
      verified: validation.valid,
      provider_cost: providerCostUsd,
    })
    .eq("id", job.id);

  // 11b. Telemetry beacon (fire-and-forget)
  trackAgentCall({
    agentId: agent.id as string,
    profileId: agent.owner_id as string,
    event: "call_completed",
    capability,
    durationMs,
    apiCost: providerCostUsd ?? 0,
    cost: rateAmount,
    success: true,
    caller: isAuthenticated ? "api" : "anonymous",
    metadata: {
      risk_confidence: risk.confidence,
      risk_reason_code: risk.reason_code,
    },
  });

  // 12. Credit provider for paid calls
  if (rateAmount > 0) {
    const rateMillicents = Math.floor(rateAmount * 100_000);
    const rawPct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    const feePct =
      Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : 10;
    const platformFee = Math.max(
      Math.floor((rateMillicents * feePct) / 100),
      100
    );
    const providerCut = rateMillicents - platformFee;

    // Credit provider's profile
    if (providerCut > 0) {
      await admin.rpc("add_credits", {
        p_user_id: agent.owner_id,
        p_amount_millicents: providerCut,
      });
    }

    // Log platform revenue
    await admin.from("platform_revenue").insert({
      job_id: job.id,
      amount_millicents: platformFee,
    });
  }

  // 13. Build final response
  // Sensitive results (e.g. credential.resolve) are returned in the HTTP
  // response to the immediate caller but NOT persisted to the DB or
  // idempotency cache.  The caller must hold the value in memory only.
  const responseBody = {
    job_id: job.id,
    status: "completed",
    output: agentResponse,
    verified: validation.valid,
    duration_ms: durationMs,
    cost: rateAmount,
  };

  const idempotencyBody = isSensitive
    ? { ...responseBody, output: { redacted: true } }
    : responseBody;

  // 14. Store idempotency response (update the row we claimed earlier)
  await admin
    .from("idempotency_keys")
    .update({ job_id: job.id, response_body: idempotencyBody })
    .eq("idempotency_key", idempotency_key);

  const response = corsJson(responseBody);

  // Append org quota headers when org context is active
  if (orgQuotaRemaining !== null && orgQuotaLimit !== null) {
    response.headers.set("X-Org-Quota-Remaining", String(orgQuotaRemaining));
    response.headers.set("X-Org-Quota-Limit", String(orgQuotaLimit));
  }

  return response;
}
