// GET/POST /api/marketplace/listings — Manage marketplace listings for agents.
// GET: List all marketplace listings for the authenticated user's agents.
// POST: Create a new marketplace listing draft.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createListing,
  getAgentListings,
  buildAgentProfile,
} from "@/lib/marketplace/service";
import { getConnector } from "@/lib/marketplace/service";
import type { MarketplaceProvider } from "@/lib/marketplace/types";

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId) {
    return NextResponse.json({ error: "Missing agent_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify ownership
  const { data: agent } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq("id", agentId)
    .single();

  if (!agent || agent.owner_id !== auth.profileId) {
    return NextResponse.json({ error: "Agent not found or not owned" }, { status: 403 });
  }

  const listings = await getAgentListings(admin, agentId);
  return NextResponse.json(listings);
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentId = body.agent_id as string;
  const provider = body.provider as MarketplaceProvider;
  const pricingModel = body.pricing_model as string;

  if (!agentId || !provider || !pricingModel) {
    return NextResponse.json(
      { error: "Missing required fields: agent_id, provider, pricing_model" },
      { status: 400 }
    );
  }

  const validProviders = ["google_cloud", "azure", "aws"];
  if (!validProviders.includes(provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify ownership
  const { data: agent } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq("id", agentId)
    .single();

  if (!agent || agent.owner_id !== auth.profileId) {
    return NextResponse.json({ error: "Agent not found or not owned" }, { status: 403 });
  }

  try {
    const listing = await createListing(admin, provider, {
      agentId,
      pricingModel: pricingModel as "usage_based" | "subscription" | "free",
      pricePerCall: body.price_per_call as number | undefined,
      monthlyPrice: body.monthly_price as number | undefined,
      providerConfig: body.provider_config as Record<string, unknown> | undefined,
    });

    // Also generate the agent profile for export
    const profile = await buildAgentProfile(admin, agentId);

    // If a connector is registered, generate export content
    const connector = getConnector(provider);
    let exportContent: Record<string, unknown> | null = null;
    if (connector) {
      exportContent = await connector.exportListingContent(profile);
    }

    return NextResponse.json({ listing, profile, exportContent }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
