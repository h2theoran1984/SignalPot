// Marketplace Connector Types — shared interfaces for all marketplace integrations.
// Each marketplace adapter implements MarketplaceConnector.

export type MarketplaceProvider = "google_cloud" | "azure" | "aws" | "databricks";
export type ListingStatus = "draft" | "pending_review" | "active" | "suspended" | "delisted";
export type SubscriptionStatus = "pending" | "active" | "suspended" | "canceled" | "expired";

// ─────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  agentId: string;
  provider: MarketplaceProvider;
  status: ListingStatus;
  externalId: string | null;
  externalUrl: string | null;
  pricingModel: "usage_based" | "subscription" | "free";
  pricePerCall: number | null;
  monthlyPrice: number | null;
  providerConfig: Record<string, unknown>;
  submittedAt: string | null;
  approvedAt: string | null;
}

export interface ListingInput {
  agentId: string;
  pricingModel: "usage_based" | "subscription" | "free";
  pricePerCall?: number;
  monthlyPrice?: number;
  providerConfig?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────
// Subscription
// ─────────────────────────────────────────────────────────────────

export interface MarketplaceSubscription {
  id: string;
  listingId: string;
  agentId: string;
  provider: MarketplaceProvider;
  externalCustomerId: string;
  customerName: string | null;
  customerEmail: string | null;
  status: SubscriptionStatus;
  planId: string | null;
  quantity: number;
  externalSubscriptionId: string;
  externalData: Record<string, unknown>;
  activatedAt: string | null;
  canceledAt: string | null;
}

export interface SubscriptionActivateInput {
  externalSubscriptionId: string;
  externalCustomerId: string;
  customerName?: string;
  customerEmail?: string;
  planId?: string;
  quantity?: number;
  externalData?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────
// Usage Metering
// ─────────────────────────────────────────────────────────────────

export interface UsageEvent {
  subscriptionId: string;
  dimension: string;
  quantity: number;
  timestamp: string;
}

export interface UsageReportResult {
  success: boolean;
  externalUsageId?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────
// Agent Card Export (for marketplace listing content)
// ─────────────────────────────────────────────────────────────────

export interface MarketplaceAgentProfile {
  name: string;
  slug: string;
  description: string;
  capabilities: Array<{ name: string; description?: string }>;
  pricing: { model: string; amount: number; currency: string };
  trustScore: number;
  verifiedCalls: number;
  successRate: number;
  avgLatencyMs: number | null;
  eloRating: number | null;
  arenaRecord: { wins: number; losses: number; ties: number } | null;
  profileUrl: string;
  a2aCardUrl: string;
}

// ─────────────────────────────────────────────────────────────────
// Connector Interface — each marketplace adapter implements this
// ─────────────────────────────────────────────────────────────────

export interface MarketplaceConnector {
  /** Which marketplace this connector handles */
  provider: MarketplaceProvider;

  /**
   * Verify the webhook signature/authenticity for this marketplace.
   * Returns true if the request is verified, false otherwise.
   * Receives the raw request body and headers for signature verification.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<boolean>;

  /**
   * Validate that the listing has all required fields for this marketplace.
   * Returns validation errors or empty array if valid.
   */
  validateListing(listing: ListingInput): Promise<string[]>;

  /**
   * Generate the marketplace-specific listing content (agent card, metadata, etc.)
   * ready for submission/upload.
   */
  exportListingContent(agentProfile: MarketplaceAgentProfile): Promise<Record<string, unknown>>;

  /**
   * Handle an incoming subscription activation webhook/callback from the marketplace.
   * Returns the internal subscription ID.
   */
  activateSubscription(input: SubscriptionActivateInput, listingId: string): Promise<string>;

  /**
   * Report usage events to the marketplace's metering API.
   */
  reportUsage(events: UsageEvent[]): Promise<UsageReportResult[]>;

  /**
   * Resolve a marketplace purchase token into subscription details.
   * Used by the landing page to complete onboarding.
   */
  resolveToken(token: string): Promise<SubscriptionActivateInput | null>;

  /**
   * Cancel a subscription on the marketplace side.
   */
  cancelSubscription(externalSubscriptionId: string): Promise<boolean>;
}
