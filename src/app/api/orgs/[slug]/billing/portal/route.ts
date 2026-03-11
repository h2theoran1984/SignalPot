import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

// POST /api/orgs/[slug]/billing/portal — Open Stripe Customer Portal for org
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Look up org
  const { data: org } = await admin
    .from("organizations")
    .select("id, stripe_customer_id")
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

  if (!org.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing account found. Subscribe to a plan first." },
      { status: 400 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://signalpot.dev";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${siteUrl}/orgs/${slug}/settings`,
  });

  return NextResponse.json({ url: portalSession.url });
}
