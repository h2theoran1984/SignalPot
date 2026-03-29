// Azure Marketplace Connector
// Handles SaaS Fulfillment APIs, Microsoft Entra ID SSO,
// and metered billing via the Marketplace Metering API.
//
// Required env vars:
//   AZURE_MARKETPLACE_TENANT_ID — Microsoft Entra tenant ID
//   AZURE_MARKETPLACE_APP_ID — Microsoft Entra application (client) ID
//   AZURE_MARKETPLACE_APP_SECRET — Client secret for the app registration
//   AZURE_MARKETPLACE_PUBLISHER_ID — Publisher ID from Partner Center

import type {
  MarketplaceConnector,
  MarketplaceAgentProfile,
  ListingInput,
  SubscriptionActivateInput,
  UsageEvent,
  UsageReportResult,
} from "../types";

// Azure Marketplace API endpoints
const SAAS_API_BASE = "https://marketplaceapi.microsoft.com/api/saas";
const METERING_API_BASE = "https://marketplaceapi.microsoft.com/api/usageEvent";
const TOKEN_URL = "https://login.microsoftonline.com";
const API_VERSION = "2018-08-31";
const METERING_API_VERSION = "2018-08-31";

// ─────────────────────────────────────────────────────────────────
// Azure AD Token Acquisition
// ─────────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAzureToken(): Promise<string | null> {
  const tenantId = process.env.AZURE_MARKETPLACE_TENANT_ID;
  const appId = process.env.AZURE_MARKETPLACE_APP_ID;
  const appSecret = process.env.AZURE_MARKETPLACE_APP_SECRET;

  if (!tenantId || !appId || !appSecret) {
    console.warn("[azure-connector] Missing Azure Marketplace credentials");
    return null;
  }

  // Return cached token if still valid (5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300_000) {
    return cachedToken.token;
  }

  try {
    const res = await fetch(`${TOKEN_URL}/${tenantId}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: appId,
        client_secret: appSecret,
        resource: "20e940b3-4c77-4b0b-9a53-9e16a1b010a7", // Azure Marketplace resource ID
      }),
    });

    if (!res.ok) {
      console.error("[azure-connector] Token acquisition failed:", res.status);
      return null;
    }

    const data = await res.json();
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };

    return cachedToken.token;
  } catch (err) {
    console.error("[azure-connector] Token error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// SaaS Fulfillment API Helpers
// ─────────────────────────────────────────────────────────────────

async function resolveAzureSubscription(
  token: string,
  marketplaceToken: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${SAAS_API_BASE}/subscriptions/resolve?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-ms-marketplace-token": marketplaceToken,
        },
      }
    );

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function activateAzureSubscription(
  token: string,
  subscriptionId: string,
  planId: string,
  quantity?: number
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { planId };
    if (quantity != null) body.quantity = quantity;

    const res = await fetch(
      `${SAAS_API_BASE}/subscriptions/${subscriptionId}/activate?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    return res.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Connector Implementation
// ─────────────────────────────────────────────────────────────────

export const azureConnector: MarketplaceConnector = {
  provider: "azure",

  async validateListing(input: ListingInput): Promise<string[]> {
    const errors: string[] = [];

    if (!input.agentId) errors.push("Agent ID is required");

    if (input.pricingModel === "usage_based" && !input.pricePerCall) {
      errors.push("Price per call is required for usage-based (metered) pricing");
    }

    if (input.pricingModel === "subscription" && !input.monthlyPrice) {
      errors.push("Monthly price is required for subscription pricing");
    }

    // Azure requires Entra ID config
    if (!process.env.AZURE_MARKETPLACE_TENANT_ID) {
      errors.push("AZURE_MARKETPLACE_TENANT_ID not configured");
    }
    if (!process.env.AZURE_MARKETPLACE_APP_ID) {
      errors.push("AZURE_MARKETPLACE_APP_ID not configured");
    }

    return errors;
  },

  async exportListingContent(profile: MarketplaceAgentProfile): Promise<Record<string, unknown>> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

    return {
      // Azure Partner Center listing content
      listing: {
        name: `${profile.name} — AI Agent on SignalPot`,
        searchResultsSummary: profile.description.slice(0, 100),
        description: [
          profile.description,
          "",
          "**Verified Performance (SignalPot)**",
          `- ${profile.verifiedCalls} verified calls with ${(profile.successRate * 100).toFixed(0)}% success rate`,
          `- Trust score: ${(profile.trustScore * 100).toFixed(0)}%`,
          profile.eloRating ? `- Arena ELO: ${profile.eloRating}` : null,
          profile.arenaRecord ? `- Arena record: ${profile.arenaRecord.wins}W / ${profile.arenaRecord.losses}L / ${profile.arenaRecord.ties}T` : null,
          profile.avgLatencyMs ? `- Average latency: ${profile.avgLatencyMs}ms` : null,
          "",
          `**[View Full Performance Report](${profile.profileUrl})**`,
          "",
          "**Capabilities**",
          ...profile.capabilities.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`),
          "",
          "Built and verified on [SignalPot](https://signalpot.dev) — the AI agent marketplace with competitive benchmarking and verified performance data.",
        ].filter(Boolean).join("\n"),
        category: "AI + Machine Learning",
        subcategory: "AI Apps and Agents",
        keywords: ["ai agent", "ai", "agent", profile.name.toLowerCase(), ...profile.capabilities.map((c) => c.name)].slice(0, 3),
      },

      // Technical configuration for Partner Center
      technicalConfig: {
        landingPageUrl: `${baseUrl}/marketplace/activate?provider=azure`,
        connectionWebhookUrl: `${baseUrl}/api/marketplace/webhook?provider=azure`,
        tenantId: process.env.AZURE_MARKETPLACE_TENANT_ID ?? "CONFIGURE_ME",
        applicationId: process.env.AZURE_MARKETPLACE_APP_ID ?? "CONFIGURE_ME",
      },

      // Pricing plan
      plan: {
        name: "Pay per call",
        description: `$${profile.pricing.amount} per API call. Billed through Azure.`,
        pricingModel: profile.pricing.model === "per_call" ? "flat_rate" : "per_user",
        isMetered: profile.pricing.model === "per_call",
        meterDimensions: profile.pricing.model === "per_call" ? [{
          id: "api_calls",
          displayName: "API Calls",
          unitOfMeasure: "calls",
          pricePerUnit: profile.pricing.amount,
        }] : undefined,
      },

      // A2A card for reference
      a2aCardUrl: profile.a2aCardUrl,
      profileUrl: profile.profileUrl,
    };
  },

  async activateSubscription(input: SubscriptionActivateInput, _listingId: string): Promise<string> {
    const token = await getAzureToken();

    if (token && input.planId) {
      // Activate via SaaS Fulfillment API
      const success = await activateAzureSubscription(
        token,
        input.externalSubscriptionId,
        input.planId,
        input.quantity
      );

      if (!success) {
        console.warn("[azure-connector] SaaS activation API call failed — proceeding with internal activation");
      }
    }

    return input.externalSubscriptionId;
  },

  async reportUsage(events: UsageEvent[]): Promise<UsageReportResult[]> {
    const token = await getAzureToken();

    if (!token) {
      return events.map(() => ({
        success: false,
        error: "Azure Marketplace credentials not configured",
      }));
    }

    const results: UsageReportResult[] = [];

    for (const event of events) {
      try {
        const res = await fetch(
          `${METERING_API_BASE}?api-version=${METERING_API_VERSION}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resourceId: event.subscriptionId,
              quantity: event.quantity,
              dimension: event.dimension,
              effectiveStartTime: event.timestamp,
              planId: "pay-per-call", // matches the plan configured in Partner Center
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          results.push({
            success: true,
            externalUsageId: data.usageEventId ?? data.messageTime,
          });
        } else {
          const errText = await res.text();
          results.push({
            success: false,
            error: `Azure Metering API: ${res.status} ${errText}`,
          });
        }
      } catch (err) {
        results.push({
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return results;
  },

  async resolveToken(token: string): Promise<SubscriptionActivateInput | null> {
    const azureToken = await getAzureToken();
    if (!azureToken) return null;

    // Resolve the marketplace purchase token via SaaS Fulfillment API
    const resolved = await resolveAzureSubscription(azureToken, token);
    if (!resolved) return null;

    return {
      externalSubscriptionId: (resolved.id as string) ?? (resolved.subscriptionId as string),
      externalCustomerId: ((resolved.purchaser as Record<string, unknown>)?.tenantId as string) ?? ((resolved.beneficiary as Record<string, unknown>)?.tenantId as string) ?? "unknown",
      customerEmail: ((resolved.purchaser as Record<string, unknown>)?.emailId as string) ?? undefined,
      planId: (resolved.planId as string) ?? undefined,
      quantity: (resolved.quantity as number) ?? 1,
      externalData: {
        listing_id: (resolved.offerId as string) ?? null,
        publisherId: resolved.publisherId,
        beneficiary: resolved.beneficiary,
        purchaser: resolved.purchaser,
        term: resolved.term,
      },
    };
  },

  async cancelSubscription(externalSubscriptionId: string): Promise<boolean> {
    const token = await getAzureToken();
    if (!token) return false;

    try {
      const res = await fetch(
        `${SAAS_API_BASE}/subscriptions/${externalSubscriptionId}?api-version=${API_VERSION}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};
