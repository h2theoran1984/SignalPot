import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { anonTopupSchema } from "@/lib/validations";
import { checkAnonRateLimit } from "@/lib/rate-limit";
import { rateLimitResponse } from "@/lib/auth";

/**
 * POST /api/proxy/credits
 * Create a Stripe checkout session for anonymous proxy credits.
 * No authentication required. Max $5 per purchase.
 */
export async function POST(request: NextRequest) {
  // Rate limit credit purchases too
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  const rateCheck = await checkAnonRateLimit(ip);
  if (!rateCheck.success) {
    return rateLimitResponse(rateCheck.reset);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = anonTopupSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { amount_usd } = parsed.data;
  const amountCents = Math.round(amount_usd * 100);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "SignalPot Anonymous Credits",
            description: `$${amount_usd.toFixed(2)} in proxy credits (expires in 24 hours)`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/agents?anon_credits=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/agents?anon_credits=cancelled`,
    metadata: {
      topup_type: "anonymous_credits",
      amount_usd: String(amount_usd),
      amount_millicents: String(Math.floor(amount_usd * 100_000)),
    },
  });

  return NextResponse.json({
    url: session.url,
    checkout_session_id: session.id,
  });
}
