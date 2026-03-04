import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const subscribeSchema = z.object({
  plan: z.enum(["pro", "team"]),
});

// POST /api/billing/subscribe — Create Stripe Checkout session for subscription upgrade
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

  const result = subscribeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { plan } = result.data;

  const priceId =
    plan === "pro"
      ? process.env.STRIPE_PRO_PRICE_ID
      : process.env.STRIPE_TEAM_PRICE_ID;

  if (!priceId) {
    return NextResponse.json(
      { error: "Price ID not configured for this plan" },
      { status: 500 }
    );
  }

  // Fetch the user's profile to get/create Stripe customer
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    // Create a new Stripe customer
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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/dashboard?billing=success`,
    cancel_url: `${siteUrl}/pricing?billing=cancelled`,
    metadata: { supabase_user_id: user.id, plan },
    subscription_data: {
      metadata: { supabase_user_id: user.id, plan },
    },
  });

  return NextResponse.json({ url: session.url });
}
