// Google Cloud Marketplace Connector
// Handles A2A agent card export, JWT-based signup flow,
// Procurement API for entitlements, and Service Control API for usage metering.
//
// Required env vars:
//   GCP_MARKETPLACE_PROJECT_ID — Google Cloud project ID
//   GCP_SERVICE_ACCOUNT_KEY — JSON key for the service account (base64 encoded)
//   GCP_MARKETPLACE_SERVICE_NAME — from Producer Portal billing integration

import { jwtVerify, importX509 } from "jose";
import type {
  MarketplaceConnector,
  MarketplaceAgentProfile,
  ListingInput,
  SubscriptionActivateInput,
  UsageEvent,
  UsageReportResult,
} from "../types";

// Google's public key URL for JWT verification
const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/cloud-commerce-partner@system.gserviceaccount.com";
const PROCUREMENT_API_BASE = "https://cloudcommerceprocurement.googleapis.com/v1";
const EXPECTED_ISSUER = "cloud-commerce-partner@system.gserviceaccount.com";

// ─────────────────────────────────────────────────────────────────
// Google Public Key Cache
// ─────────────────────────────────────────────────────────────────

let cachedCerts: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

async function getGooglePublicKeys(): Promise<Map<string, CryptoKey>> {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) {
    return cachedCerts.keys;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google certs: ${res.status}`);
  }

  // Parse Cache-Control max-age for cache duration
  const cacheControl = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) * 1000 : 3600_000;

  const certs: Record<string, string> = await res.json();
  const keys = new Map<string, CryptoKey>();

  for (const [kid, pem] of Object.entries(certs)) {
    keys.set(kid, await importX509(pem, "RS256"));
  }

  cachedCerts = { keys, expiresAt: Date.now() + maxAge };
  return keys;
}

// ─────────────────────────────────────────────────────────────────
// JWT Verification
// ─────────────────────────────────────────────────────────────────

interface GCPSignupJWT {
  sub: string;                    // Procurement account ID
  iss: string;                    // Google service account
  aud: string;                    // Your product domain
  exp: number;                    // Expiration
  iat: number;
  "google.user_identity"?: string;
  "google.roles"?: string[];
}

function getExpectedAudiences(): string[] {
  const configured = process.env.GCP_MARKETPLACE_WEBHOOK_AUDIENCE
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    return [siteUrl.replace(/\/$/, "")];
  }

  return [];
}

async function verifyGCPToken(token: string): Promise<GCPSignupJWT | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Decode header to get kid
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const kid = header.kid as string | undefined;

    if (!kid) {
      console.warn("[gcp-connector] JWT missing kid in header");
      return null;
    }

    // Fetch Google's public keys and find the matching one
    const keys = await getGooglePublicKeys();
    const key = keys.get(kid);

    if (!key) {
      console.warn(`[gcp-connector] No matching public key for kid: ${kid}`);
      return null;
    }

    const audiences = getExpectedAudiences();
    if (audiences.length === 0) {
      console.warn("[gcp-connector] Missing expected webhook audience");
      return null;
    }

    // Full RS256 signature verification + expiration check
    const { payload } = await jwtVerify(token, key, {
      issuer: EXPECTED_ISSUER,
      algorithms: ["RS256"],
      audience: audiences.length === 1 ? audiences[0] : audiences,
    });

    if (!payload.sub) {
      console.warn("[gcp-connector] JWT missing sub claim");
      return null;
    }

    return payload as unknown as GCPSignupJWT;
  } catch (err) {
    console.error("[gcp-connector] JWT verification failed:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Google Cloud Auth Helper
// ─────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!keyBase64) {
    console.warn("[gcp-connector] GCP_SERVICE_ACCOUNT_KEY not set");
    return null;
  }

  try {
    // Service account key-based auth
    // In production, use google-auth-library or workload identity federation
    // For now, return null to indicate auth is not configured
    // The adapter methods will handle this gracefully
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Connector Implementation
// ─────────────────────────────────────────────────────────────────

export const googleCloudConnector: MarketplaceConnector = {
  provider: "google_cloud",

  async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<boolean> {
    // GCP Pub/Sub webhooks include a Bearer token in the Authorization header.
    // Verify the JWT was issued by Google's push service account.
    const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      console.warn("[gcp-connector] Webhook missing Authorization header");
      return false;
    }

    const payload = await verifyGCPToken(token);
    if (!payload) {
      console.warn("[gcp-connector] Webhook JWT verification failed");
      return false;
    }

    return true;
  },

  async validateListing(input: ListingInput): Promise<string[]> {
    const errors: string[] = [];

    if (!input.agentId) errors.push("Agent ID is required");

    if (input.pricingModel === "usage_based" && !input.pricePerCall) {
      errors.push("Price per call is required for usage-based pricing");
    }

    if (input.pricingModel === "subscription" && !input.monthlyPrice) {
      errors.push("Monthly price is required for subscription pricing");
    }

    return errors;
  },

  async exportListingContent(profile: MarketplaceAgentProfile): Promise<Record<string, unknown>> {
    // Generate Google Cloud Marketplace-compatible listing content
    // This includes the A2A agent card + marketplace-specific metadata
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

    return {
      // A2A Agent Card (Google's required format)
      agentCard: {
        protocolVersion: "0.2.5",
        name: profile.name,
        description: profile.description,
        url: `${baseUrl}/api/agents/${profile.slug}/a2a/rpc`,
        version: "1.0",
        documentationUrl: profile.profileUrl,
        capabilities: {
          streaming: true,
          pushNotifications: true,
        },
        skills: profile.capabilities.map((c) => ({
          id: c.name,
          name: c.name,
          description: c.description ?? "",
        })),
        provider: {
          organization: "SignalPot",
          url: baseUrl,
        },
        // SignalPot verified extensions — the differentiator
        extensions: {
          signalpot: {
            trustScore: profile.trustScore,
            verifiedCalls: profile.verifiedCalls,
            successRate: profile.successRate,
            avgLatencyMs: profile.avgLatencyMs,
            eloRating: profile.eloRating,
            arenaRecord: profile.arenaRecord,
            costPerCall: profile.pricing.amount,
            profileUrl: profile.profileUrl,
          },
        },
      },

      // Marketplace listing metadata
      listing: {
        name: profile.name,
        description: profile.description,
        category: "AI & Machine Learning",
        subcategory: "AI Agents",
        pricing: {
          model: profile.pricing.model === "per_call" ? "USAGE_BASED" : "SUBSCRIPTION",
          usageDimensions: profile.pricing.model === "per_call" ? [{
            name: "api_calls",
            displayName: "API Calls",
            unit: "calls",
            pricePerUnit: profile.pricing.amount,
            currency: "USD",
          }] : undefined,
          monthlyPrice: profile.pricing.model !== "per_call" ? profile.pricing.amount : undefined,
        },
        highlights: [
          `${profile.verifiedCalls} verified calls with ${(profile.successRate * 100).toFixed(0)}% success rate`,
          `Trust score: ${(profile.trustScore * 100).toFixed(0)}%`,
          profile.eloRating ? `Arena ELO rating: ${profile.eloRating}` : null,
          profile.arenaRecord ? `Arena record: ${profile.arenaRecord.wins}W/${profile.arenaRecord.losses}L` : null,
          `Average latency: ${profile.avgLatencyMs ? `${profile.avgLatencyMs}ms` : "N/A"}`,
        ].filter(Boolean),
        signupUrl: `${baseUrl}/marketplace/activate?provider=google_cloud`,
        documentationUrl: profile.profileUrl,
        a2aCardUrl: profile.a2aCardUrl,
      },
    };
  },

  async activateSubscription(input: SubscriptionActivateInput, listingId: string): Promise<string> {
    // Called after JWT verification resolves the subscription details.
    // In production, this would also call the Procurement API to approve the account.
    const token = await getAccessToken();
    if (token) {
      try {
        // Approve the account in Procurement API
        await fetch(
          `${PROCUREMENT_API_BASE}/providers/signalpot/accounts/${input.externalCustomerId}:approve`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              approvalName: "signup",
              reason: "Auto-approved via SignalPot activation flow",
            }),
          }
        );
      } catch (err) {
        console.error("[gcp-connector] Procurement API approval failed:", err);
        // Don't throw — we still want to activate internally
      }
    }

    return input.externalSubscriptionId;
  },

  async reportUsage(events: UsageEvent[]): Promise<UsageReportResult[]> {
    const serviceName = process.env.GCP_MARKETPLACE_SERVICE_NAME;
    const token = await getAccessToken();

    if (!serviceName || !token) {
      // Not configured — mark all as errors
      return events.map(() => ({
        success: false,
        error: "GCP Marketplace service not configured (missing GCP_MARKETPLACE_SERVICE_NAME or auth)",
      }));
    }

    const results: UsageReportResult[] = [];

    for (const event of events) {
      try {
        // Report via Service Control API
        const res = await fetch(
          `https://servicecontrol.googleapis.com/v1/services/${serviceName}:report`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              operations: [{
                operationId: `${event.subscriptionId}-${event.timestamp}`,
                operationName: "signalpot.agent.call",
                consumerId: `project:${event.subscriptionId}`,
                startTime: event.timestamp,
                endTime: event.timestamp,
                metricValueSets: [{
                  metricName: `${serviceName}/${event.dimension}`,
                  metricValues: [{
                    int64Value: String(Math.ceil(event.quantity)),
                  }],
                }],
              }],
            }),
          }
        );

        if (res.ok) {
          results.push({ success: true });
        } else {
          const errBody = await res.text();
          results.push({ success: false, error: `Service Control API: ${res.status} ${errBody}` });
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
    const payload = await verifyGCPToken(token);
    if (!payload) return null;

    return {
      externalSubscriptionId: payload.sub,
      externalCustomerId: payload.sub,
      customerEmail: payload["google.user_identity"] ?? undefined,
      externalData: {
        roles: payload["google.roles"],
        iss: payload.iss,
        aud: payload.aud,
      },
    };
  },

  async cancelSubscription(externalSubscriptionId: string): Promise<boolean> {
    // In production, call Procurement API to cancel/reject the entitlement
    const token = await getAccessToken();
    if (!token) return false;

    try {
      const res = await fetch(
        `${PROCUREMENT_API_BASE}/providers/signalpot/entitlements/${externalSubscriptionId}:reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "Canceled by agent owner" }),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};
