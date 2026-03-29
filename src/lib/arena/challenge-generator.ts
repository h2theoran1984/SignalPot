// Challenge Generator — produces domain-specific challenges from agent context
// and pattern templates. Uses Haiku for fast, cheap generation.
// Any agent, any skill, day one.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Types
// ============================================================

interface AgentContext {
  name: string;
  slug: string;
  description: string | null;
  goal: string | null;
  capabilities: Array<{ name: string; description?: string }>;
}

interface PatternDef {
  id: string;
  name: string;
  description: string;
  prompt_template: string;
  rubric_overrides: Record<string, number>;
  difficulty_scaling: Record<string, string>;
}

export interface GeneratedChallenge {
  agentId: string;
  patternId: string;
  level: number;
  title: string;
  prompt: Record<string, unknown>;
  promptText: string;
  rubric: Record<string, number>;
}

// ============================================================
// Core Generator
// ============================================================

/**
 * Generate a challenge for a specific agent + pattern + level.
 * Checks cache first. If stale or missing, generates fresh via Haiku.
 */
export async function getOrGenerateChallenge(
  admin: SupabaseClient,
  agentId: string,
  patternId: string,
  level: number = 1
): Promise<GeneratedChallenge> {
  // Check cache first
  const { data: cached } = await admin
    .from("generated_challenges")
    .select("id, title, prompt, prompt_text, rubric")
    .eq("agent_id", agentId)
    .eq("pattern_id", patternId)
    .eq("level", level)
    .eq("stale", false)
    .single();

  if (cached) {
    // Increment usage counter (fire-and-forget)
    void admin
      .from("generated_challenges")
      .update({ used_count: (cached as Record<string, unknown>).used_count as number + 1 || 1 })
      .eq("id", cached.id);

    return {
      agentId,
      patternId,
      level,
      title: cached.title as string,
      prompt: cached.prompt as Record<string, unknown>,
      promptText: cached.prompt_text as string,
      rubric: cached.rubric as Record<string, number>,
    };
  }

  // Generate fresh
  const challenge = await generateChallenge(admin, agentId, patternId, level);

  // Cache it (upsert)
  await admin
    .from("generated_challenges")
    .upsert({
      agent_id: agentId,
      pattern_id: patternId,
      level,
      title: challenge.title,
      prompt: challenge.prompt,
      prompt_text: challenge.promptText,
      rubric: challenge.rubric,
      generated_at: new Date().toISOString(),
      used_count: 1,
      stale: false,
    }, { onConflict: "agent_id,pattern_id,level" });

  return challenge;
}

/**
 * Generate a fresh challenge using Haiku.
 */
async function generateChallenge(
  admin: SupabaseClient,
  agentId: string,
  patternId: string,
  level: number
): Promise<GeneratedChallenge> {
  // Fetch agent context
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("name, slug, description, goal, capability_schema")
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) throw new Error("Agent not found");

  const capabilities = (agent.capability_schema as Array<{ name: string; description?: string }>) ?? [];
  const agentCtx: AgentContext = {
    name: agent.name as string,
    slug: agent.slug as string,
    description: agent.description as string | null,
    goal: agent.goal as string | null,
    capabilities,
  };

  // Fetch pattern definition
  const { data: pattern, error: patternErr } = await admin
    .from("challenge_patterns")
    .select("*")
    .eq("id", patternId)
    .single();

  if (patternErr || !pattern) throw new Error(`Pattern not found: ${patternId}`);

  const patternDef: PatternDef = {
    id: pattern.id as string,
    name: pattern.name as string,
    description: pattern.description as string,
    prompt_template: pattern.prompt_template as string,
    rubric_overrides: pattern.rubric_overrides as Record<string, number>,
    difficulty_scaling: pattern.difficulty_scaling as Record<string, string>,
  };

  // Generate the task content via Haiku
  const taskContent = await generateTaskContent(agentCtx, patternDef, level);

  // Build the agent context string
  const agentContextStr = buildAgentContextString(agentCtx);

  // Resolve the difficulty description
  const difficultyStr = patternDef.difficulty_scaling[String(level)]
    ?? patternDef.difficulty_scaling["1"]
    ?? "Standard difficulty";

  // Fill in the prompt template
  const resolvedPrompt = patternDef.prompt_template
    .replace("{{agent_context}}", agentContextStr)
    .replace("{{generated_task}}", taskContent.task)
    .replace("{{difficulty}}", `Difficulty: ${difficultyStr}`);

  return {
    agentId,
    patternId,
    level,
    title: taskContent.title,
    prompt: { task: resolvedPrompt },
    promptText: resolvedPrompt,
    rubric: patternDef.rubric_overrides,
  };
}

// ============================================================
// LLM Task Generation
// ============================================================

interface TaskContent {
  title: string;
  task: string;
}

async function generateTaskContent(
  agent: AgentContext,
  pattern: PatternDef,
  level: number
): Promise<TaskContent> {
  const anthropic = new Anthropic();

  const capList = agent.capabilities.length > 0
    ? agent.capabilities.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`).join("\n")
    : "- General purpose";

  const difficultyGuide = pattern.difficulty_scaling[String(level)]
    ?? "Standard difficulty";

  const prompt = `You are a challenge designer for an AI agent evaluation platform. Generate a specific, concrete challenge task.

AGENT BEING TESTED:
Name: ${agent.name}
Description: ${agent.description ?? "No description provided"}
Goal: ${agent.goal ?? "Not specified"}
Capabilities:
${capList}

CHALLENGE PATTERN: ${pattern.name}
Pattern description: ${pattern.description}

DIFFICULTY LEVEL: ${level}/4
Difficulty guide: ${difficultyGuide}

INSTRUCTIONS:
Generate a challenge task that:
1. Is specific to this agent's domain and capabilities
2. Fits the "${pattern.name}" pattern exactly
3. Matches the difficulty level described above
4. Uses realistic, concrete scenarios (not abstract or meta)
5. Can be completed by an AI agent (not requiring human-only actions)
6. Has a clearly evaluable outcome

${pattern.id === "routing" ? "Generate 3-6 distinct inputs for the agent to classify and handle. Mix in-scope and edge-case items." : ""}
${pattern.id === "adversarial" ? "Include a subtle but detectable issue, contradiction, or trap. Do NOT make it obvious — the agent should need careful analysis to catch it." : ""}
${pattern.id === "chain_of_thought" ? "Design a problem that requires multiple reasoning steps where the intermediate work matters as much as the final answer." : ""}

Return your response in this exact format:
TITLE: [A short, specific title for this challenge, 5-10 words]
TASK: [The full challenge task text that will be presented to the agent]`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    // Parse TITLE and TASK
    const titleMatch = /TITLE:\s*(.+)/i.exec(text);
    const taskMatch = /TASK:\s*([\s\S]+)/i.exec(text);

    const title = titleMatch?.[1]?.trim() ?? `${pattern.name} Challenge L${level}`;
    const task = taskMatch?.[1]?.trim() ?? text.trim();

    return { title, task };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[challenge-generator] Haiku generation failed:", msg);

    // Fallback: generic challenge
    return {
      title: `${pattern.name} Challenge (L${level})`,
      task: buildFallbackTask(agent, pattern, level),
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function buildAgentContextString(agent: AgentContext): string {
  const parts = [`Agent: ${agent.name}`];
  if (agent.description) parts.push(`Description: ${agent.description}`);
  if (agent.goal) parts.push(`Goal: ${agent.goal}`);
  if (agent.capabilities.length > 0) {
    parts.push(`Capabilities: ${agent.capabilities.map((c) => c.name).join(", ")}`);
  }
  return parts.join("\n");
}

function buildFallbackTask(agent: AgentContext, pattern: PatternDef, level: number): string {
  const domain = agent.description ?? agent.capabilities[0]?.name ?? "your domain";

  switch (pattern.id) {
    case "single_task":
      return `Perform a typical task within your area of expertise (${domain}). Demonstrate your core competency with a thorough, high-quality response.`;
    case "routing":
      return `You will receive the following inputs. Classify each as in-scope or out-of-scope, and handle accordingly:\n1. A standard request in your domain\n2. A request that's adjacent but not quite your specialty\n3. A completely out-of-scope request`;
    case "chain_of_thought":
      return `Here is a multi-step problem in your domain (${domain}). Break it into logical steps, show your reasoning at each step, and provide a final answer. The problem requires at least ${level + 1} distinct reasoning steps.`;
    case "adversarial":
      return `Complete the following task in your domain (${domain}). Note: the task may contain subtle issues that require careful attention to detect.`;
    case "efficiency":
      return `Complete a task in your domain (${domain}) as quickly and cost-efficiently as possible while maintaining acceptable quality. Brevity and precision are valued over comprehensiveness.`;
    default:
      return `Complete a task demonstrating your capabilities in ${domain}.`;
  }
}

/**
 * Generate challenges for ALL active patterns for a given agent.
 * Used during registration or when refreshing an agent's challenge set.
 */
export async function generateAllChallenges(
  admin: SupabaseClient,
  agentId: string,
  level: number = 1
): Promise<GeneratedChallenge[]> {
  const { data: patterns } = await admin
    .from("challenge_patterns")
    .select("id")
    .eq("active", true)
    .order("sort_order");

  if (!patterns || patterns.length === 0) return [];

  const results: GeneratedChallenge[] = [];
  for (const p of patterns) {
    try {
      const challenge = await getOrGenerateChallenge(admin, agentId, p.id as string, level);
      results.push(challenge);
    } catch (err) {
      console.error(`[challenge-generator] Failed for pattern ${p.id}:`, err);
    }
  }
  return results;
}

/**
 * Mark all cached challenges for an agent as stale (triggers regeneration on next use).
 * Call this when an agent's description or capabilities change.
 */
export async function invalidateAgentChallenges(
  admin: SupabaseClient,
  agentId: string
): Promise<void> {
  await admin
    .from("generated_challenges")
    .update({ stale: true })
    .eq("agent_id", agentId);
}

/**
 * Pick a random pattern for a training match, optionally excluding recently used ones.
 */
export async function pickRandomPattern(
  admin: SupabaseClient,
  agentId: string,
  excludePatterns?: string[]
): Promise<string> {
  let query = admin
    .from("challenge_patterns")
    .select("id")
    .eq("active", true);

  if (excludePatterns && excludePatterns.length > 0) {
    // Filter out excluded patterns using not-in
    for (const ex of excludePatterns) {
      query = query.neq("id", ex);
    }
  }

  const { data: patterns } = await query;

  if (!patterns || patterns.length === 0) return "single_task";

  const idx = Math.floor(Math.random() * patterns.length);
  return patterns[idx].id as string;
}
