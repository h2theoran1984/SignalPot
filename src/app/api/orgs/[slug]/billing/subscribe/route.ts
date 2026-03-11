import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const subscribeSchema = z.object({
  plan: z.enum(["pro", "team"]),
});

// POST /api/orgs/[slug]/billing/subscribe — Subscribe org to a plan
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
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
      ? process.env.STRIPE_ORG_PRO_PRICE_ID
      : process.env.STRIPE_ORG_TEAM_PRICE_ID;

  if (!priceId) {
    return NextResponse.json(
      { error: "Price ID not configured for this org plan" },
      { status: 500 }
    );
  }

  const admin = createAdminClient();

  // Look up org
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, slug, stripe_customer_id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify caller is owner
  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", auth.profileId)
    .single();

  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can manage billing" }, { status: 403 });
  }

  // Create or reuse Stripe customer for the org
  let customerId = org.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { org_id: org.id, supabase_org_slug: org.slug },
    });
    customerId = customer.id;

    // Atomic upsert: only set if still null
    const { data: updated } = await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", org.id)
      .is("stripe_customer_id", null)
      .select("stripe_customer_id")
      .single();

    if (!updated) {
      const { data: existing } = await admin
        .from("organizations")
        .select("stripe_customer_id")
        .eq("id", org.id)
        .single();
      customerId = existing!.stripe_customer_id;
    }
  }

  // Count current members for per-seat pricing
  const { count: memberCount } = await admin
    .from("org_members")
    .select("profile_id", { count: "exact", head: true })
    .eq("org_id", org.id);

  const quantity = Math.max(memberCount ?? 1, 1);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://signalpot.dev";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    success_url: `${siteUrl}/orgs/${slug}/settings?billing=success`,
    cancel_url: `${siteUrl}/orgs/${slug}/settings?billing=cancelled`,
    metadata: { org_id: org.id, plan, supabase_org_slug: org.slug },
    subscription_data: {
      metadata: { org_id: org.id, plan },
    },
  });

  return NextResponse.json({ url: session.url });
}
