/**
 * Step 4: Register the agent in the database.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { RESERVED_SLUGS, AVAILABLE_MODELS, DEFAULT_MODEL } from "./constants";
import type { AgentIntent } from "./intent";
import type { CapabilitySchema } from "./schema";

export interface RegisteredAgent {
  id: string;
  slug: string;
  name: string;
  model_id: string;
  mcp_endpoint: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function registerAgent(
  intent: AgentIntent,
  schema: CapabilitySchema,
  systemPrompt: string,
  options: {
    model_preference?: string;
    rate?: number;
    tags?: string[];
    owner_id?: string;
  } = {}
): Promise<RegisteredAgent> {
  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL ?? "https://signalpot.dev";

  // Resolve model
  const modelKey = options.model_preference ?? intent.suggested_model ?? DEFAULT_MODEL;
  const modelConfig = AVAILABLE_MODELS[modelKey] ?? AVAILABLE_MODELS[DEFAULT_MODEL];

  // Generate slug, check for collisions
  let baseSlug = slugify(intent.agent_name);
  if (RESERVED_SLUGS.includes(baseSlug)) {
    baseSlug = `custom-${baseSlug}`;
  }

  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 10) {
    const { data: existing } = await admin
      .from("agents")
      .select("id")
      .eq("slug", slug)
      .single();

    if (!existing) break;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  if (attempt >= 10) {
    throw new Error(`Could not generate unique slug for "${intent.agent_name}"`);
  }

  const mcpEndpoint = `${siteUrl}/api/arena/custom/${slug}`;

  const { data: agent, error } = await admin
    .from("agents")
    .insert({
      name: intent.agent_name,
      slug,
      description: intent.description_summary,
      capability_schema: [schema],
      mcp_endpoint: mcpEndpoint,
      rate_type: "per_call",
      rate_amount: options.rate ?? modelConfig.costPerCall,
      rate_currency: "USD",
      model_id: modelConfig.id,
      system_prompt: systemPrompt,
      architect_generated: true,
      architect_version: 1,
      architect_history: [
        {
          version: 1,
          system_prompt: systemPrompt,
          score: null,
          reasoning: "Initial generation by The Architect",
          timestamp: new Date().toISOString(),
        },
      ],
      arena_eligible: true,
      agent_type: "reactive",
      status: "active",
      tags: options.tags ?? [intent.domain],
      ...(options.owner_id ? { owner_id: options.owner_id } : {}),
    })
    .select("id, slug, name, model_id, mcp_endpoint")
    .single();

  if (error || !agent) {
    throw new Error(`Failed to register agent: ${error?.message ?? "Unknown error"}`);
  }

  return agent as RegisteredAgent;
}
