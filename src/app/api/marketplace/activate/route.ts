// POST /api/marketplace/activate — Resolve a marketplace purchase token
// and activate the subscription. Called by the landing page after redirect.

import "@/lib/marketplace/init"; // Register connectors
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getConnector,
  activateSubscription,
} from "@/lib/marketplace/service";
import type { MarketplaceProvider } from "@/lib/marketplace/types";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = body.provider as MarketplaceProvider;
  const token = body.token as string;

  if (!provider || !token) {
    return NextResponse.json({ error: "Missing provider or token" }, { status: 400 });
  }

  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json(
      { error: `Marketplace connector for ${provider} is not configured yet` },
      { status: 501 }
    );
  }

  const admin = createAdminClient();

  try {
    // Resolve the marketplace token into subscription details
    const resolved = await connector.resolveToken(token);
    if (!resolved) {
      return NextResponse.json({ error: "Invalid or expired marketplace token" }, { status: 400 });
    }

    // Find the listing for this provider
    // The token resolution should give us enough info to match a listing
    // For now, we look up by the external data or require listing_id in the token
    const listingId = (resolved.externalData?.listing_id as string) ?? null;

    if (!listingId) {
      return NextResponse.json(
        { error: "Could not determine which listing this purchase belongs to" },
        { status: 400 }
      );
    }

    // Activate the subscription
    const sub = await activateSubscription(admin, listingId, resolved);

    // Fetch agent info for the response
    const { data: agent } = await admin
      .from("agents")
      .select("name, slug")
      .eq("id", sub.agentId)
      .single();

    return NextResponse.json({
      subscription_id: sub.id,
      agent_name: agent?.name ?? "Unknown Agent",
      agent_slug: agent?.slug ?? "unknown",
      provider: sub.provider,
      plan_id: sub.planId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[marketplace-activate] Error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
