import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const topupSchema = z.object({
  amount_usd: z.number().min(1).max(1000),
  payment_method: z.enum(["card", "crypto"]),
});

// POST /api/billing/topup — Create Stripe Checkout session for credit top-up
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = topupSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { amount_usd, payment_method } = result.data;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? profile?.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    // Atomic upsert: only set if still null (prevents race with concurrent requests)
    const { data: updated } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id)
      .is("stripe_customer_id", null)
      .select("stripe_customer_id")
      .single();

    // If another request already set a customer ID, use that one instead
    if (!updated) {
      const { data: existing } = await admin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();
      customerId = existing!.stripe_customer_id;
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://signalpot.dev";

  // Amount in cents for Stripe
  const amountCents = Math.round(amount_usd * 100);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "SignalPot Credits",
            description: `$${amount_usd.toFixed(2)} credit top-up`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    // Enable USDC crypto if requested (must be enabled in Stripe dashboard)
    ...(payment_method === "crypto"
      ? { payment_method_types: ["card", "us_bank_account"] as const }
      : {}),
    success_url: `${siteUrl}/dashboard?billing=topup_success`,
    cancel_url: `${siteUrl}/dashboard?billing=topup_cancelled`,
    metadata: {
      supabase_user_id: user.id,
      topup_type: "credits",
      amount_usd: String(amount_usd),
      amount_millicents: String(Math.floor(amount_usd * 100_000)),
    },
  });

  return NextResponse.json({ url: session.url });
}
