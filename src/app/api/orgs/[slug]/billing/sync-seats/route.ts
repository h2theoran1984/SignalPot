import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

// POST /api/orgs/[slug]/billing/sync-seats — Update Stripe subscription quantity to match member count
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Look up org
  const { data: org } = await admin
    .from("organizations")
    .select("id, stripe_subscription_id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify caller is owner or admin
  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", auth.profileId)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Requires owner or admin role" }, { status: 403 });
  }

  if (!org.stripe_subscription_id) {
    return NextResponse.json(
      { error: "No active subscription. Subscribe to a plan first." },
      { status: 400 }
    );
  }

  // Count current members
  const { count: memberCount } = await admin
    .from("org_members")
    .select("profile_id", { count: "exact", head: true })
    .eq("org_id", org.id);

  const seats = Math.max(memberCount ?? 1, 1);

  // Get subscription to find the item ID
  const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const itemId = subscription.items.data[0]?.id;

  if (!itemId) {
    return NextResponse.json(
      { error: "Subscription has no line items" },
      { status: 500 }
    );
  }

  // Update quantity
  await stripe.subscriptions.update(org.stripe_subscription_id, {
    items: [{ id: itemId, quantity: seats }],
  });

  return NextResponse.json({ seats });
}
