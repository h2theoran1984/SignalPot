import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAnonRateLimit, checkAnonAgentRateLimit } from "@/lib/rate-limit";
import { getAuthContext, rateLimitResponse } from "@/lib/auth";
import { proxyCallSchema } from "@/lib/validations";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import { assertSafeUrl } from "@/lib/ssrf";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: CORS_HEADERS });
}

// Pre-flight CORS
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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

  // 0. Check for authenticated caller (optional — falls back to anonymous)
  const auth = await getAuthContext(request);
  const isAuthenticated = auth !== null;

  // 1. Rate limit — authenticated users are already rate-limited by getAuthContext;
  //    anonymous callers use IP-based limits.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

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

  // 3. Idempotency check — return cached response for duplicate keys
  const { data: existingKey } = await admin
    .from("idempotency_keys")
    .select("response_body")
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existingKey) {
    return corsJson(existingKey.response_body);
  }

  // 4. Look up agent
  const { data: agent } = await admin
    .from("agents")
    .select("id, slug, owner_id, status, rate_amount, mcp_endpoint, capability_schema")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return corsJson({ error: "Agent not found or inactive" }, { status: 404 });
  }

  if (!agent.mcp_endpoint) {
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
    assertSafeUrl(agent.mcp_endpoint);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blocked endpoint";
    return corsJson({ error: message }, { status: 400 });
  }

  // 10. Forward to agent's MCP endpoint (synchronous)
  let agentResponse: Record<string, unknown>;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(agent.mcp_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability,
        input,
        job_id: job.id,
        _envelope: requestEnvelope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    agentResponse = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    // Mark job as failed
    await admin
      .from("jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", job.id);

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

  // 11. Build response envelope and update job as completed
  const responseEnvelope = wrapResponse({
    jobId: job.id as string,
    providerSlug: slug,
    durationMs,
    output: agentResponse,
    verified: validation.valid,
    validationErrors: validation.errors,
  });

  await admin
    .from("jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      output_summary: { ...agentResponse, _envelope: responseEnvelope },
      duration_ms: durationMs,
      verified: validation.valid,
    })
    .eq("id", job.id);

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
  const responseBody = {
    job_id: job.id,
    status: "completed",
    output: agentResponse,
    verified: validation.valid,
    duration_ms: durationMs,
    cost: rateAmount,
  };

  // 14. Store idempotency record
  await admin.from("idempotency_keys").insert({
    idempotency_key: idempotency_key,
    job_id: job.id,
    response_body: responseBody,
  });

  return corsJson(responseBody);
}
