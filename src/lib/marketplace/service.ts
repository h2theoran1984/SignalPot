// Marketplace Service — shared business logic for all marketplace integrations.
// Handles listing CRUD, subscription lifecycle, and usage event recording.
// Marketplace-specific behavior is delegated to connector adapters.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MarketplaceProvider,
  MarketplaceListing,
  ListingInput,
  MarketplaceSubscription,
  SubscriptionActivateInput,
  SubscriptionStatus,
  UsageEvent,
  MarketplaceAgentProfile,
  MarketplaceConnector,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Connector Registry
// ─────────────────────────────────────────────────────────────────

const connectors = new Map<MarketplaceProvider, MarketplaceConnector>();

export function registerConnector(connector: MarketplaceConnector): void {
  connectors.set(connector.provider, connector);
}

export function getConnector(provider: MarketplaceProvider): MarketplaceConnector | null {
  return connectors.get(provider) ?? null;
}

// ─────────────────────────────────────────────────────────────────
// Listing Management
// ─────────────────────────────────────────────────────────────────

export async function createListing(
  admin: SupabaseClient,
  provider: MarketplaceProvider,
  input: ListingInput
): Promise<MarketplaceListing> {
  const connector = getConnector(provider);
  if (connector) {
    const errors = await connector.validateListing(input);
    if (errors.length > 0) {
      throw new Error(`Listing validation failed: ${errors.join(", ")}`);
    }
  }

  const { data, error } = await admin
    .from("marketplace_listings")
    .insert({
      agent_id: input.agentId,
      provider,
      status: "draft",
      pricing_model: input.pricingModel,
      price_per_call: input.pricePerCall ?? null,
      monthly_price: input.monthlyPrice ?? null,
      provider_config: input.providerConfig ?? {},
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to create listing: ${error?.message}`);

  return mapListing(data);
}

export async function getListing(
  admin: SupabaseClient,
  agentId: string,
  provider: MarketplaceProvider
): Promise<MarketplaceListing | null> {
  const { data } = await admin
    .from("marketplace_listings")
    .select("*")
    .eq("agent_id", agentId)
    .eq("provider", provider)
    .single();

  return data ? mapListing(data) : null;
}

export async function getAgentListings(
  admin: SupabaseClient,
  agentId: string
): Promise<MarketplaceListing[]> {
  const { data } = await admin
    .from("marketplace_listings")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at");

  return (data ?? []).map(mapListing);
}

export async function updateListingStatus(
  admin: SupabaseClient,
  listingId: string,
  status: MarketplaceListing["status"],
  externalId?: string,
  externalUrl?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (externalId) update.external_id = externalId;
  if (externalUrl) update.external_url = externalUrl;
  if (status === "pending_review") update.submitted_at = new Date().toISOString();
  if (status === "active") update.approved_at = new Date().toISOString();

  await admin.from("marketplace_listings").update(update).eq("id", listingId);
}

// ─────────────────────────────────────────────────────────────────
// Agent Profile Builder (for marketplace export)
// ─────────────────────────────────────────────────────────────────

export async function buildAgentProfile(
  admin: SupabaseClient,
  agentId: string
): Promise<MarketplaceAgentProfile> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  const [agentResult, trustResult, eloResult, telemetryResult, arenaResult] = await Promise.all([
    admin.from("agents").select("*").eq("id", agentId).single(),
    admin.from("trust_edges").select("trust_score")
      .eq("target_agent_id", agentId)
      .order("trust_score", { ascending: false })
      .limit(1).maybeSingle(),
    admin.from("arena_ratings").select("elo, wins, losses, ties")
      .eq("agent_id", agentId)
      .order("elo", { ascending: false })
      .limit(1).maybeSingle(),
    admin.from("agent_telemetry").select("success")
      .eq("agent_id", agentId)
      .in("event", ["call_completed", "call_failed"]),
    admin.from("arena_matches").select("winner, agent_a_id")
      .eq("status", "completed")
      .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`),
  ]);

  const agent = agentResult.data;
  if (!agent) throw new Error("Agent not found");

  const capabilities = (agent.capability_schema as Array<{ name: string; description?: string }>) ?? [];
  const telemetry = telemetryResult.data ?? [];
  const verifiedCalls = telemetry.length;
  const successRate = verifiedCalls > 0
    ? telemetry.filter((r) => r.success).length / verifiedCalls
    : 0;

  let arenaRecord: MarketplaceAgentProfile["arenaRecord"] = null;
  if (arenaResult.data && arenaResult.data.length > 0) {
    let wins = 0, losses = 0, ties = 0;
    for (const m of arenaResult.data) {
      const side = m.agent_a_id === agentId ? "a" : "b";
      if (m.winner === "tie") ties++;
      else if (m.winner === side) wins++;
      else losses++;
    }
    arenaRecord = { wins, losses, ties };
  }

  return {
    name: agent.name as string,
    slug: agent.slug as string,
    description: (agent.description as string) ?? "",
    capabilities,
    pricing: {
      model: (agent.rate_type as string) ?? "per_call",
      amount: Number(agent.rate_amount) || 0,
      currency: "USD",
    },
    trustScore: ((trustResult.data?.trust_score as number) ?? 0),
    verifiedCalls,
    successRate: Math.round(successRate * 10000) / 10000,
    avgLatencyMs: (agent.avg_latency_ms as number) ?? null,
    eloRating: (eloResult.data?.elo as number) ?? null,
    arenaRecord,
    profileUrl: `${baseUrl}/agents/${agent.slug}`,
    a2aCardUrl: `${baseUrl}/api/agents/${agent.slug}/a2a`,
  };
}

// ─────────────────────────────────────────────────────────────────
// Subscription Lifecycle
// ─────────────────────────────────────────────────────────────────

export async function activateSubscription(
  admin: SupabaseClient,
  listingId: string,
  input: SubscriptionActivateInput
): Promise<MarketplaceSubscription> {
  // Look up the listing
  const { data: listing } = await admin
    .from("marketplace_listings")
    .select("id, agent_id, provider")
    .eq("id", listingId)
    .single();

  if (!listing) throw new Error("Listing not found");

  const { data, error } = await admin
    .from("marketplace_subscriptions")
    .upsert({
      listing_id: listingId,
      agent_id: listing.agent_id,
      provider: listing.provider,
      external_subscription_id: input.externalSubscriptionId,
      external_customer_id: input.externalCustomerId,
      customer_name: input.customerName ?? null,
      customer_email: input.customerEmail ?? null,
      status: "active",
      plan_id: input.planId ?? null,
      quantity: input.quantity ?? 1,
      external_data: input.externalData ?? {},
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,external_subscription_id" })
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to activate subscription: ${error?.message}`);

  return mapSubscription(data);
}

export async function updateSubscriptionStatus(
  admin: SupabaseClient,
  subscriptionId: string,
  status: SubscriptionStatus
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "canceled") update.canceled_at = new Date().toISOString();

  await admin.from("marketplace_subscriptions").update(update).eq("id", subscriptionId);
}

export async function getSubscriptionByExternalId(
  admin: SupabaseClient,
  provider: MarketplaceProvider,
  externalSubscriptionId: string
): Promise<MarketplaceSubscription | null> {
  const { data } = await admin
    .from("marketplace_subscriptions")
    .select("*")
    .eq("provider", provider)
    .eq("external_subscription_id", externalSubscriptionId)
    .single();

  return data ? mapSubscription(data) : null;
}

export async function getActiveSubscription(
  admin: SupabaseClient,
  agentId: string,
  provider: MarketplaceProvider,
  externalCustomerId: string
): Promise<MarketplaceSubscription | null> {
  const { data } = await admin
    .from("marketplace_subscriptions")
    .select("*")
    .eq("agent_id", agentId)
    .eq("provider", provider)
    .eq("external_customer_id", externalCustomerId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return data ? mapSubscription(data) : null;
}

// ─────────────────────────────────────────────────────────────────
// Usage Metering
// ─────────────────────────────────────────────────────────────────

export async function recordUsageEvent(
  admin: SupabaseClient,
  subscriptionId: string,
  dimension: string = "api_calls",
  quantity: number = 1
): Promise<void> {
  // Look up subscription to get listing/provider
  const { data: sub } = await admin
    .from("marketplace_subscriptions")
    .select("listing_id, provider")
    .eq("id", subscriptionId)
    .single();

  if (!sub) return;

  await admin.from("marketplace_usage_events").insert({
    subscription_id: subscriptionId,
    listing_id: sub.listing_id,
    provider: sub.provider,
    dimension,
    quantity,
    usage_timestamp: new Date().toISOString(),
  });
}

/**
 * Report all pending usage events for a provider.
 * Called by the Inngest cron job.
 */
export async function reportPendingUsage(
  admin: SupabaseClient,
  provider: MarketplaceProvider,
  batchSize: number = 100
): Promise<{ reported: number; errors: number }> {
  const connector = getConnector(provider);
  if (!connector) return { reported: 0, errors: 0 };

  const { data: events } = await admin
    .from("marketplace_usage_events")
    .select("id, subscription_id, dimension, quantity, usage_timestamp")
    .eq("provider", provider)
    .eq("reported", false)
    .order("usage_timestamp")
    .limit(batchSize);

  if (!events || events.length === 0) return { reported: 0, errors: 0 };

  const usageEvents: (UsageEvent & { id: string })[] = events.map((e) => ({
    id: e.id as string,
    subscriptionId: e.subscription_id as string,
    dimension: e.dimension as string,
    quantity: e.quantity as number,
    timestamp: e.usage_timestamp as string,
  }));

  const results = await connector.reportUsage(usageEvents);

  let reported = 0;
  let errors = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const eventId = usageEvents[i].id;

    if (result.success) {
      await admin
        .from("marketplace_usage_events")
        .update({
          reported: true,
          reported_at: new Date().toISOString(),
          external_usage_id: result.externalUsageId ?? null,
        })
        .eq("id", eventId);
      reported++;
    } else {
      await admin
        .from("marketplace_usage_events")
        .update({ report_error: result.error ?? "Unknown error" })
        .eq("id", eventId);
      errors++;
    }
  }

  return { reported, errors };
}

// ─────────────────────────────────────────────────────────────────
// Row Mappers
// ─────────────────────────────────────────────────────────────────

function mapListing(row: Record<string, unknown>): MarketplaceListing {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    provider: row.provider as MarketplaceProvider,
    status: row.status as MarketplaceListing["status"],
    externalId: row.external_id as string | null,
    externalUrl: row.external_url as string | null,
    pricingModel: row.pricing_model as "usage_based" | "subscription" | "free",
    pricePerCall: row.price_per_call as number | null,
    monthlyPrice: row.monthly_price as number | null,
    providerConfig: (row.provider_config as Record<string, unknown>) ?? {},
    submittedAt: row.submitted_at as string | null,
    approvedAt: row.approved_at as string | null,
  };
}

function mapSubscription(row: Record<string, unknown>): MarketplaceSubscription {
  return {
    id: row.id as string,
    listingId: row.listing_id as string,
    agentId: row.agent_id as string,
    provider: row.provider as MarketplaceProvider,
    externalCustomerId: row.external_customer_id as string,
    customerName: row.customer_name as string | null,
    customerEmail: row.customer_email as string | null,
    status: row.status as SubscriptionStatus,
    planId: row.plan_id as string | null,
    quantity: (row.quantity as number) ?? 1,
    externalSubscriptionId: row.external_subscription_id as string,
    externalData: (row.external_data as Record<string, unknown>) ?? {},
    activatedAt: row.activated_at as string | null,
    canceledAt: row.canceled_at as string | null,
  };
}
