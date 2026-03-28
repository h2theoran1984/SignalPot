/**
 * Playbook Engine — sales-ready output compilation.
 *
 * Reads from the shared data layer (records, health scores, opportunities)
 * and compiles structured output for sales teams. Template-driven like Brief.
 *
 * Output types:
 *   1. account_review — single account deep dive
 *   2. qbr           — quarterly business review deck data
 *   3. territory_plan — territory overview with prioritized accounts
 *   4. scorecard     — rep/team performance metrics
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { resolveParams, type TemplateParams } from "@/lib/analyst/brief/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountReviewOutput {
  title: string;
  generated_at: string;
  account_name: string;
  health: {
    score: number;
    status: string;
    signals: Record<string, unknown>;
    risk_factors: Array<{ factor: string; severity: string; detail: string }>;
  } | null;
  opportunities: Array<{
    type: string;
    product: string;
    estimated_value: number | null;
    priority: string;
  }>;
  recent_activity: Array<{
    period: string;
    metrics: Record<string, number>;
  }>;
  recommendations: string[];
}

export interface QBROutput {
  title: string;
  generated_at: string;
  period: string;
  territory_summary: {
    total_accounts: number;
    healthy: number;
    at_risk: number;
    declining: number;
    total_opportunities: number;
    estimated_pipeline: number;
  };
  top_accounts: Array<{
    name: string;
    health_score: number;
    status: string;
    revenue_trend: string;
  }>;
  risk_accounts: Array<{
    name: string;
    health_score: number;
    risk_factors: string[];
  }>;
  opportunities: Array<{
    account: string;
    type: string;
    product: string;
    value: number | null;
  }>;
  actions: string[];
}

export interface TerritoryPlanOutput {
  title: string;
  generated_at: string;
  accounts: Array<{
    name: string;
    health_score: number;
    status: string;
    priority: "focus" | "maintain" | "monitor" | "rescue";
    opportunity_count: number;
    estimated_opportunity_value: number;
    strategy: string;
  }>;
  summary: {
    total_accounts: number;
    focus: number;
    maintain: number;
    monitor: number;
    rescue: number;
    total_opportunity_value: number;
  };
}

// ---------------------------------------------------------------------------
// 1. Account Review
// ---------------------------------------------------------------------------

export async function compileAccountReview(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  entityId: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<AccountReviewOutput> {
  const { params } = await resolveParams(admin, ownerId, templateId, inlineParams);

  // Load health data
  const { data: health } = await admin
    .from("analyst_account_health")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .eq("entity_id", entityId)
    .single();

  // Load opportunities
  const { data: opps } = await admin
    .from("analyst_opportunities")
    .select("opportunity_type, product_or_category, estimated_value, priority")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .eq("entity_id", entityId)
    .eq("status", "open");

  // Load recent records for activity
  const { data: records } = await admin
    .from("analyst_records")
    .select("period, metric_name, metric_value, normalized_values")
    .eq("dataset_id", datasetId)
    .order("period", { ascending: false })
    .limit(50);

  // Filter records for this entity and aggregate by period
  const entityRecords = (records ?? []).filter((r) => {
    const mappings = (r as unknown as { entity_mappings: Record<string, string> }).entity_mappings;
    return mappings && Object.values(mappings).includes(entityId);
  });

  const periodMetrics = new Map<string, Record<string, number>>();
  for (const r of entityRecords) {
    const period = (r as Record<string, unknown>).period as string;
    if (!period) continue;
    const metrics = periodMetrics.get(period) ?? {};
    const mn = (r as Record<string, unknown>).metric_name as string;
    const mv = (r as Record<string, unknown>).metric_value as number;
    if (mn && mv !== null) metrics[mn] = (metrics[mn] ?? 0) + mv;
    periodMetrics.set(period, metrics);
  }

  const accountName = health?.account_name ?? entityId;

  // Generate recommendations based on health + opportunities
  const recommendations: string[] = [];
  if (health?.status === "declining" || health?.status === "at_risk") {
    recommendations.push(`Schedule executive-level check-in — account health is ${health.status}`);
  }
  if (health?.risk_factors) {
    for (const rf of health.risk_factors as Array<{ factor: string }>) {
      recommendations.push(`Address: ${rf.factor}`);
    }
  }
  if ((opps ?? []).length > 0) {
    const highPriority = (opps ?? []).filter((o) => o.priority === "high");
    if (highPriority.length > 0) {
      recommendations.push(`${highPriority.length} high-priority opportunities to pursue`);
    }
  }

  // Save output
  const output: AccountReviewOutput = {
    title: `Account Review: ${accountName}`,
    generated_at: new Date().toISOString(),
    account_name: accountName,
    health: health ? {
      score: health.health_score,
      status: health.status,
      signals: health.signals as Record<string, unknown>,
      risk_factors: health.risk_factors as Array<{ factor: string; severity: string; detail: string }>,
    } : null,
    opportunities: (opps ?? []).map((o) => ({
      type: o.opportunity_type,
      product: o.product_or_category,
      estimated_value: o.estimated_value,
      priority: o.priority,
    })),
    recent_activity: Array.from(periodMetrics.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([period, metrics]) => ({ period, metrics })),
    recommendations,
  };

  await admin
    .from("analyst_playbook_outputs")
    .insert({
      owner_id: ownerId,
      dataset_id: datasetId,
      template_id: templateId ?? null,
      output_type: "account_review",
      title: output.title,
      entity_id: entityId,
      account_name: accountName,
      content: output,
    });

  return output;
}

// ---------------------------------------------------------------------------
// 2. QBR
// ---------------------------------------------------------------------------

export async function compileQBR(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  title: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<QBROutput> {
  const { params } = await resolveParams(admin, ownerId, templateId, inlineParams);

  // Load all health scores
  const { data: healthData } = await admin
    .from("analyst_account_health")
    .select("entity_id, account_name, health_score, status, signals, risk_factors")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .order("health_score", { ascending: false });

  const accounts = (healthData ?? []) as Array<{
    entity_id: string;
    account_name: string;
    health_score: number;
    status: string;
    signals: Record<string, unknown>;
    risk_factors: Array<{ factor: string }>;
  }>;

  // Load all opportunities
  const { data: opps } = await admin
    .from("analyst_opportunities")
    .select("entity_id, account_name, opportunity_type, product_or_category, estimated_value, priority")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .eq("status", "open")
    .order("priority");

  const opportunities = (opps ?? []) as Array<{
    entity_id: string;
    account_name: string;
    opportunity_type: string;
    product_or_category: string;
    estimated_value: number | null;
    priority: string;
  }>;

  const totalOpportunityValue = opportunities
    .reduce((s, o) => s + (o.estimated_value ?? 0), 0);

  // Get dataset period
  const { data: dataset } = await admin
    .from("analyst_datasets")
    .select("period")
    .eq("id", datasetId)
    .single();

  // Build actions
  const actions: string[] = [];
  const atRiskAccounts = accounts.filter((a) => a.status === "at_risk" || a.status === "declining");
  if (atRiskAccounts.length > 0) {
    actions.push(`${atRiskAccounts.length} accounts need intervention — schedule reviews`);
  }
  const highPriorityOpps = opportunities.filter((o) => o.priority === "high");
  if (highPriorityOpps.length > 0) {
    actions.push(`${highPriorityOpps.length} high-priority opportunities worth $${Math.round(highPriorityOpps.reduce((s, o) => s + (o.estimated_value ?? 0), 0)).toLocaleString()}`);
  }

  const output: QBROutput = {
    title,
    generated_at: new Date().toISOString(),
    period: dataset?.period ?? "",
    territory_summary: {
      total_accounts: accounts.length,
      healthy: accounts.filter((a) => a.status === "healthy").length,
      at_risk: accounts.filter((a) => a.status === "at_risk").length,
      declining: accounts.filter((a) => a.status === "declining").length,
      total_opportunities: opportunities.length,
      estimated_pipeline: totalOpportunityValue,
    },
    top_accounts: accounts.slice(0, 10).map((a) => {
      const revSignal = a.signals?.revenue_trend as { trend?: string } | undefined;
      return {
        name: a.account_name,
        health_score: a.health_score,
        status: a.status,
        revenue_trend: revSignal?.trend ?? "unknown",
      };
    }),
    risk_accounts: atRiskAccounts.map((a) => ({
      name: a.account_name,
      health_score: a.health_score,
      risk_factors: a.risk_factors.map((rf) => rf.factor),
    })),
    opportunities: opportunities.slice(0, 20).map((o) => ({
      account: o.account_name,
      type: o.opportunity_type,
      product: o.product_or_category,
      value: o.estimated_value,
    })),
    actions,
  };

  await admin
    .from("analyst_playbook_outputs")
    .insert({
      owner_id: ownerId,
      dataset_id: datasetId,
      template_id: templateId ?? null,
      output_type: "qbr",
      title: output.title,
      content: output,
    });

  return output;
}

// ---------------------------------------------------------------------------
// 3. Territory Plan
// ---------------------------------------------------------------------------

export async function compileTerritoryPlan(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  title: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<TerritoryPlanOutput> {
  const { params } = await resolveParams(admin, ownerId, templateId, inlineParams);

  // Load health + opportunities
  const { data: healthData } = await admin
    .from("analyst_account_health")
    .select("entity_id, account_name, health_score, status")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId);

  const { data: opps } = await admin
    .from("analyst_opportunities")
    .select("entity_id, estimated_value")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .eq("status", "open");

  // Aggregate opportunities per account
  const oppsByAccount = new Map<string, { count: number; value: number }>();
  for (const o of opps ?? []) {
    const eid = o.entity_id as string;
    const existing = oppsByAccount.get(eid) ?? { count: 0, value: 0 };
    existing.count++;
    existing.value += (o.estimated_value as number) ?? 0;
    oppsByAccount.set(eid, existing);
  }

  // Build territory plan
  const accounts = (healthData ?? []).map((a) => {
    const health = a.health_score as number;
    const status = a.status as string;
    const oppData = oppsByAccount.get(a.entity_id as string) ?? { count: 0, value: 0 };

    // Determine priority bucket
    let priority: "focus" | "maintain" | "monitor" | "rescue";
    let strategy: string;

    if (status === "declining" || status === "churned") {
      priority = "rescue";
      strategy = "Immediate intervention — schedule executive meeting, identify root cause, present retention plan";
    } else if (status === "at_risk") {
      priority = "rescue";
      strategy = "Proactive outreach — review recent orders, address risk factors, reinforce value proposition";
    } else if (health >= 70 && oppData.count > 0) {
      priority = "focus";
      strategy = `Grow the relationship — ${oppData.count} open opportunities worth $${Math.round(oppData.value).toLocaleString()}`;
    } else if (health >= 70) {
      priority = "maintain";
      strategy = "Healthy account — maintain cadence, watch for expansion signals";
    } else {
      priority = "monitor";
      strategy = "Watch for changes — not critical but worth periodic check-ins";
    }

    return {
      name: a.account_name as string,
      health_score: health,
      status,
      priority,
      opportunity_count: oppData.count,
      estimated_opportunity_value: Math.round(oppData.value),
      strategy,
    };
  });

  // Sort: rescue first, then focus, maintain, monitor
  const priorityOrder = { rescue: 0, focus: 1, maintain: 2, monitor: 3 };
  accounts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const summary = {
    total_accounts: accounts.length,
    focus: accounts.filter((a) => a.priority === "focus").length,
    maintain: accounts.filter((a) => a.priority === "maintain").length,
    monitor: accounts.filter((a) => a.priority === "monitor").length,
    rescue: accounts.filter((a) => a.priority === "rescue").length,
    total_opportunity_value: accounts.reduce((s, a) => s + a.estimated_opportunity_value, 0),
  };

  const output: TerritoryPlanOutput = {
    title,
    generated_at: new Date().toISOString(),
    accounts,
    summary,
  };

  await admin
    .from("analyst_playbook_outputs")
    .insert({
      owner_id: ownerId,
      dataset_id: datasetId,
      template_id: templateId ?? null,
      output_type: "territory_plan",
      title: output.title,
      content: output,
    });

  return output;
}
