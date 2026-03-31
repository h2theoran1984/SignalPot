// Databricks Marketplace Connector
// Lists agents as MCP servers on Databricks Marketplace.
// Lighter than Google/Azure — no billing integration needed,
// pure discovery channel with SignalPot verification data.
//
// Databricks Marketplace supports: datasets, notebooks, ML models,
// solution accelerators, and MCP servers.
//
// Optional env vars:
//   DATABRICKS_WORKSPACE_URL — e.g. https://myworkspace.databricks.com
//   DATABRICKS_ACCESS_TOKEN — PAT or OAuth token for API calls

import type {
  MarketplaceConnector,
  MarketplaceAgentProfile,
  ListingInput,
  SubscriptionActivateInput,
  UsageEvent,
  UsageReportResult,
} from "../types";

// ─────────────────────────────────────────────────────────────────
// MCP Server Listing Format for Databricks
// ─────────────────────────────────────────────────────────────────

interface DatabricksMCPListing {
  name: string;
  description: string;
  category: string;
  provider: {
    name: string;
    url: string;
  };
  mcpServer: {
    endpoint: string;
    specUrl: string;
    tools: Array<{
      name: string;
      description: string;
    }>;
  };
  verification: {
    source: string;
    trustScore: number;
    verifiedCalls: number;
    successRate: number;
    complianceScore: string | null;
    eloRating: number | null;
    arenaRecord: { wins: number; losses: number; ties: number } | null;
    profileUrl: string;
    extractUrl: string;
    lastVerified: string;
  };
  pricing: {
    model: string;
    amount: number;
    currency: string;
  };
}

// ─────────────────────────────────────────────────────────────────
// Connector Implementation
// ─────────────────────────────────────────────────────────────────

export const databricksConnector: MarketplaceConnector = {
  provider: "databricks",

  async verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<boolean> {
    // Databricks webhook verification via HMAC-SHA256 signature.
    // The signature is sent in the X-Databricks-Signature header.
    const signature = headers["x-databricks-signature"] ?? headers["X-Databricks-Signature"];
    const secret = process.env.DATABRICKS_WEBHOOK_SECRET;

    if (!secret) {
      console.warn("[databricks-connector] DATABRICKS_WEBHOOK_SECRET not configured — rejecting webhook");
      return false;
    }

    if (!signature) {
      console.warn("[databricks-connector] Webhook missing X-Databricks-Signature header");
      return false;
    }

    try {
      const { createHmac, timingSafeEqual } = await import("node:crypto");
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const sigBuffer = Buffer.from(signature, "hex");
      const expectedBuffer = Buffer.from(expected, "hex");

      if (sigBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
      console.error("[databricks-connector] Webhook signature verification error:", err);
      return false;
    }
  },

  async validateListing(input: ListingInput): Promise<string[]> {
    const errors: string[] = [];
    if (!input.agentId) errors.push("Agent ID is required");
    return errors;
  },

  async exportListingContent(profile: MarketplaceAgentProfile): Promise<Record<string, unknown>> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

    const listing: DatabricksMCPListing = {
      name: profile.name,
      description: profile.description,
      category: "AI Agents",
      provider: {
        name: "SignalPot",
        url: baseUrl,
      },
      mcpServer: {
        endpoint: `${baseUrl}/api/agents/${profile.slug}/mcp`,
        specUrl: `${baseUrl}/api/agents/${profile.slug}/mcp`,
        tools: profile.capabilities.map((c) => ({
          name: `${profile.slug}/${c.name}`,
          description: c.description ?? c.name,
        })),
      },
      verification: {
        source: "SignalPot",
        trustScore: profile.trustScore,
        verifiedCalls: profile.verifiedCalls,
        successRate: profile.successRate,
        complianceScore: null, // TODO: pull from compliance station results
        eloRating: profile.eloRating,
        arenaRecord: profile.arenaRecord,
        profileUrl: profile.profileUrl,
        extractUrl: `${baseUrl}/arena/training/${profile.slug}/extract`,
        lastVerified: new Date().toISOString(),
      },
      pricing: profile.pricing,
    };

    // Also generate a README for the listing
    const readme = [
      `# ${profile.name}`,
      "",
      profile.description,
      "",
      "## SignalPot Verified Performance",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Trust Score | ${(profile.trustScore * 100).toFixed(0)}% |`,
      `| Verified Calls | ${profile.verifiedCalls.toLocaleString()} |`,
      `| Success Rate | ${(profile.successRate * 100).toFixed(1)}% |`,
      profile.eloRating ? `| Arena ELO | ${profile.eloRating} |` : null,
      profile.arenaRecord ? `| Arena Record | ${profile.arenaRecord.wins}W / ${profile.arenaRecord.losses}L / ${profile.arenaRecord.ties}T |` : null,
      profile.avgLatencyMs ? `| Avg Latency | ${profile.avgLatencyMs}ms |` : null,
      "",
      "## MCP Tools",
      "",
      ...profile.capabilities.map((c) =>
        `- **${c.name}**${c.description ? `: ${c.description}` : ""}`
      ),
      "",
      "## Usage",
      "",
      "Connect this MCP server to your Databricks workspace:",
      "",
      "```python",
      `# MCP endpoint: ${baseUrl}/api/agents/${profile.slug}/mcp`,
      `# A2A endpoint: ${baseUrl}/api/agents/${profile.slug}/a2a/rpc`,
      "```",
      "",
      `## Pricing`,
      "",
      `${profile.pricing.amount > 0 ? `$${profile.pricing.amount} ${profile.pricing.currency} per ${profile.pricing.model.replace("per_", "")}` : "Free"}`,
      "",
      `---`,
      `Verified by [SignalPot](${baseUrl}) — AI agent marketplace with competitive benchmarking.`,
      `[Full Performance Report](${baseUrl}/arena/training/${profile.slug}/extract) | [Agent Profile](${profile.profileUrl})`,
    ].filter(Boolean).join("\n");

    return {
      listing,
      readme,
      mcpSpecUrl: `${baseUrl}/api/agents/${profile.slug}/mcp`,
      a2aCardUrl: profile.a2aCardUrl,
    };
  },

  // Databricks doesn't have subscription billing — these are no-ops
  async activateSubscription(input: SubscriptionActivateInput): Promise<string> {
    return input.externalSubscriptionId;
  },

  async reportUsage(): Promise<UsageReportResult[]> {
    // No billing — usage tracked via beacon only
    return [];
  },

  async resolveToken(): Promise<SubscriptionActivateInput | null> {
    return null;
  },

  async cancelSubscription(): Promise<boolean> {
    return true;
  },
};

/**
 * Generate a standalone MCP listing package for manual upload to Databricks Marketplace.
 * Returns all the content needed for the Provider Portal submission.
 */
export async function generateDatabricksPackage(
  profile: MarketplaceAgentProfile
): Promise<{ listing: Record<string, unknown>; readme: string }> {
  const content = await databricksConnector.exportListingContent(profile);
  return {
    listing: content.listing as Record<string, unknown>,
    readme: content.readme as string,
  };
}
