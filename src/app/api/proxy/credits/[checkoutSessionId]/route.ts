import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/proxy/credits/[checkoutSessionId]
 * Exchange a Stripe checkout session ID for an anonymous session token.
 * Called after Stripe redirects back to the site.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ checkoutSessionId: string }> }
) {
  const { checkoutSessionId } = await params;

  // Rate limit to prevent session ID brute-force
  const forwarded = request.headers.get("x-forwarded-for");
  const callerIp = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "0.0.0.0";
  const rl = await checkIpRateLimit(callerIp);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) } }
    );
  }

  const admin = createAdminClient();

  // Check if session already exists for this Stripe checkout (idempotent)
  const { data: existing } = await admin
    .from("anonymous_sessions")
    .select("session_token, credit_balance_millicents, expires_at")
    .eq("stripe_session_id", checkoutSessionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      session_token: existing.session_token,
      credit_balance_millicents: existing.credit_balance_millicents,
      expires_at: existing.expires_at,
    });
  }

  // Verify payment with Stripe
  let stripeSession;
  try {
    stripeSession = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  } catch {
    return NextResponse.json(
      { error: "Invalid checkout session" },
      { status: 400 }
    );
  }

  if (stripeSession.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment not completed" },
      { status: 402 }
    );
  }

  // Convert cents to millicents (Stripe amount_total is in cents)
  const amountMillicents = (stripeSession.amount_total ?? 0) * 1000;

  if (amountMillicents <= 0) {
    return NextResponse.json(
      { error: "Invalid payment amount" },
      { status: 400 }
    );
  }

  // Create anonymous session with credits
  const { data: session, error } = await admin
    .from("anonymous_sessions")
    .insert({
      credit_balance_millicents: amountMillicents,
      ip_address: callerIp,
      stripe_session_id: checkoutSessionId,
    })
    .select("session_token, credit_balance_millicents, expires_at")
    .single();

  if (error) {
    // Handle race condition: another request already created the session
    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("anonymous_sessions")
        .select("session_token, credit_balance_millicents, expires_at")
        .eq("stripe_session_id", checkoutSessionId)
        .single();

      if (raced) {
        return NextResponse.json(raced);
      }
    }
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    session_token: session.session_token,
    credit_balance_millicents: session.credit_balance_millicents,
    expires_at: session.expires_at,
  });
}
