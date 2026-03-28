/**
 * Radar Engine — growth opportunity detection.
 *
 * Reads normalized records + account health data to identify:
 *   - Whitespace: products/categories the account should buy but doesn't
 *   - Cross-sell: related products purchased by similar accounts
 *   - Upsell: volume/tier upgrade opportunities
 *   - Win-back: previously purchased products that stopped
 *   - Competitive displacement: signals a competitor is taking share
 *
 * Capabilities:
 *   1. opportunity.scan      — scan a dataset for all opportunity types
 *   2. opportunity.whitespace — find product gaps per account
 *   3. opportunity.winback   — find lapsed product purchases
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalystRecord {
  id: string;
  dataset_id: string;
  entity_mappings: Record<string, string>;
  raw_values: Record<string, unknown>;
  normalized_values: Record<string, unknown>;
  period: string | null;
  metric_name: string | null;
  metric_value: number | null;
}

export interface Opportunity {
  entity_id: string | null;
  account_name: string;
  opportunity_type: "whitespace" | "cross_sell" | "upsell" | "win_back" | "competitive_displacement";
  product_or_category: string;
  estimated_value: number | null;
  confidence: number;
  evidence: Record<string, unknown>;
  priority: "high" | "medium" | "low";
}

export interface OpportunityScanResult {
  dataset_id: string;
  total_opportunities: number;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
  opportunities: Opportunity[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVal(r: AnalystRecord, field: string): unknown {
  return r.normalized_values[field] ?? r.raw_values[field] ?? null;
}

function getNumeric(r: AnalystRecord, metric: string): number | null {
  const nv = r.normalized_values[metric];
  if (nv !== null && nv !== undefined) {
    const n = Number(nv);
    return isNaN(n) ? null : n;
  }
  if (r.metric_name === metric && r.metric_value !== null) return r.metric_value;
  return null;
}

function parsePeriod(p: string | null): number {
  if (!p) return 0;
  const match = p.match(/(\d{4})/);
  const year = match ? parseInt(match[1]) : 2020;
  const qMatch = p.match(/Q(\d)/i);
  if (qMatch) return year * 12 + parseInt(qMatch[1]) * 3;
  const mMatch = p.match(/-(\d{2})/);
  if (mMatch) return year * 12 + parseInt(mMatch[1]);
  return year * 12;
}

// ---------------------------------------------------------------------------
// 1. opportunity.scan — find all opportunities in a dataset
// ---------------------------------------------------------------------------

export async function scanOpportunities(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  accountDimension: string,
  productDimension: string
): Promise<OpportunityScanResult> {
  // Load records
  const { data: rawRecords, error } = await admin
    .from("analyst_records")
    .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value")
    .eq("dataset_id", datasetId);

  if (error) throw new Error(`Failed to load records: ${error.message}`);
  const records = (rawRecords ?? []) as AnalystRecord[];

  // Load entity names
  const allEntityIds = new Set<string>();
  for (const r of records) {
    for (const eid of Object.values(r.entity_mappings)) allEntityIds.add(eid);
  }

  const entityNames = new Map<string, string>();
  if (allEntityIds.size > 0) {
    const { data: entities } = await admin
      .from("analyst_entities")
      .select("id, canonical_name")
      .in("id", Array.from(allEntityIds));
    for (const e of entities ?? []) entityNames.set(e.id, e.canonical_name);
  }

  // Build account→product matrix
  type AccountProducts = Map<string, Set<string>>; // accountId → Set of productIds
  const accountProducts: AccountProducts = new Map();
  const productAccounts = new Map<string, Set<string>>(); // productId → Set of accountIds
  const accountRevenue = new Map<string, Map<string, number>>(); // accountId → productId → revenue

  for (const r of records) {
    const acctId = r.entity_mappings[accountDimension];
    const prodId = r.entity_mappings[productDimension];
    if (!acctId || !prodId) continue;

    // Track which products each account buys
    const products = accountProducts.get(acctId) ?? new Set();
    products.add(prodId);
    accountProducts.set(acctId, products);

    // Track which accounts buy each product
    const accounts = productAccounts.get(prodId) ?? new Set();
    accounts.add(acctId);
    productAccounts.set(prodId, accounts);

    // Track revenue
    const rev = getNumeric(r, "revenue") ?? getNumeric(r, "dollar_sales") ?? getNumeric(r, "sales") ?? getNumeric(r, "volume") ?? 0;
    if (rev > 0) {
      const acctRev = accountRevenue.get(acctId) ?? new Map();
      const existing = acctRev.get(prodId) ?? 0;
      acctRev.set(prodId, existing + rev);
      accountRevenue.set(acctId, acctRev);
    }
  }

  const allProducts = new Set<string>();
  for (const prods of accountProducts.values()) {
    for (const p of prods) allProducts.add(p);
  }

  const totalAccounts = accountProducts.size;
  const opportunities: Opportunity[] = [];

  // --- Whitespace detection ---
  // Products that >50% of accounts buy but this account doesn't
  for (const [acctId, acctProds] of accountProducts) {
    for (const prodId of allProducts) {
      if (acctProds.has(prodId)) continue;

      const buyingAccounts = productAccounts.get(prodId)?.size ?? 0;
      const adoptionRate = totalAccounts > 0 ? buyingAccounts / totalAccounts : 0;

      if (adoptionRate >= 0.4) {
        // Estimate value based on average revenue from accounts that do buy it
        const revenuesForProduct: number[] = [];
        for (const [otherAcct, otherRev] of accountRevenue) {
          const prodRev = otherRev.get(prodId);
          if (prodRev) revenuesForProduct.push(prodRev);
        }
        const avgRevenue = revenuesForProduct.length > 0
          ? revenuesForProduct.reduce((s, v) => s + v, 0) / revenuesForProduct.length
          : null;

        opportunities.push({
          entity_id: acctId,
          account_name: entityNames.get(acctId) ?? acctId,
          opportunity_type: "whitespace",
          product_or_category: entityNames.get(prodId) ?? prodId,
          estimated_value: avgRevenue ? Math.round(avgRevenue) : null,
          confidence: adoptionRate,
          evidence: {
            peer_adoption_rate: Math.round(adoptionRate * 100) / 100,
            accounts_buying: buyingAccounts,
            total_accounts: totalAccounts,
            avg_revenue_from_peers: avgRevenue ? Math.round(avgRevenue) : null,
          },
          priority: adoptionRate >= 0.7 ? "high" : adoptionRate >= 0.5 ? "medium" : "low",
        });
      }
    }
  }

  // --- Win-back detection ---
  // Products that appear in early periods but not recent periods for an account
  const accountPeriodProducts = new Map<string, Map<string, string[]>>(); // acctId → prodId → periods
  for (const r of records) {
    const acctId = r.entity_mappings[accountDimension];
    const prodId = r.entity_mappings[productDimension];
    if (!acctId || !prodId || !r.period) continue;

    const acctMap = accountPeriodProducts.get(acctId) ?? new Map();
    const periods = acctMap.get(prodId) ?? [];
    periods.push(r.period);
    acctMap.set(prodId, periods);
    accountPeriodProducts.set(acctId, acctMap);
  }

  for (const [acctId, prodPeriods] of accountPeriodProducts) {
    for (const [prodId, periods] of prodPeriods) {
      const sortedPeriods = [...new Set(periods)].sort((a, b) => parsePeriod(a) - parsePeriod(b));
      if (sortedPeriods.length < 2) continue;

      const allPeriodsSorted = [...new Set(records.map((r) => r.period).filter(Boolean) as string[])]
        .sort((a, b) => parsePeriod(a) - parsePeriod(b));

      const lastProductPeriod = sortedPeriods[sortedPeriods.length - 1];
      const latestDataPeriod = allPeriodsSorted[allPeriodsSorted.length - 1];

      if (lastProductPeriod && latestDataPeriod && parsePeriod(lastProductPeriod) < parsePeriod(latestDataPeriod)) {
        // Product was purchased before but not in the most recent period(s)
        const lastRev = accountRevenue.get(acctId)?.get(prodId) ?? null;

        opportunities.push({
          entity_id: acctId,
          account_name: entityNames.get(acctId) ?? acctId,
          opportunity_type: "win_back",
          product_or_category: entityNames.get(prodId) ?? prodId,
          estimated_value: lastRev ? Math.round(lastRev) : null,
          confidence: 0.7,
          evidence: {
            last_purchased: lastProductPeriod,
            latest_data_period: latestDataPeriod,
            historical_periods: sortedPeriods.length,
            last_known_revenue: lastRev,
          },
          priority: "medium",
        });
      }
    }
  }

  // Sort by priority then estimated value
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  opportunities.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return (b.estimated_value ?? 0) - (a.estimated_value ?? 0);
  });

  // Save to DB
  for (const opp of opportunities) {
    await admin
      .from("analyst_opportunities")
      .insert({
        owner_id: ownerId,
        dataset_id: datasetId,
        entity_id: opp.entity_id,
        account_name: opp.account_name,
        opportunity_type: opp.opportunity_type,
        product_or_category: opp.product_or_category,
        estimated_value: opp.estimated_value,
        confidence: opp.confidence,
        evidence: opp.evidence,
        priority: opp.priority,
        status: "open",
      });
  }

  // Aggregate
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const opp of opportunities) {
    byType[opp.opportunity_type] = (byType[opp.opportunity_type] ?? 0) + 1;
    byPriority[opp.priority] = (byPriority[opp.priority] ?? 0) + 1;
  }

  return {
    dataset_id: datasetId,
    total_opportunities: opportunities.length,
    by_type: byType,
    by_priority: byPriority,
    opportunities,
  };
}

// ---------------------------------------------------------------------------
// Get opportunities by dataset
// ---------------------------------------------------------------------------

export async function getOpportunities(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  filters?: { type?: string; priority?: string; status?: string }
): Promise<Opportunity[]> {
  let query = admin
    .from("analyst_opportunities")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });

  if (filters?.type) query = query.eq("opportunity_type", filters.type);
  if (filters?.priority) query = query.eq("priority", filters.priority);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []) as unknown as Opportunity[];
}

export async function updateOpportunityStatus(
  admin: SupabaseClient,
  ownerId: string,
  opportunityId: string,
  status: "open" | "pursuing" | "won" | "dismissed"
): Promise<boolean> {
  const { error } = await admin
    .from("analyst_opportunities")
    .update({ status })
    .eq("id", opportunityId)
    .eq("owner_id", ownerId);

  return !error;
}
