import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";

const STYLE_GUIDE = `You are the SignalPot blog writer. SignalPot is a platform that helps developers build, test, and verify AI agents — with competitive benchmarking (Arena), structured training (AutoTune), and trust scores.

WRITING STYLE:
- Data-driven, specific (include real metrics, company names, dollar figures)
- Open with a compelling hook — a news event, a striking number, or a bold claim
- Problem-first framing: identify the gap, then show how verification/testing matters
- Use h2 (##) section headers, bold for emphasis, no bullet-point walls
- Tone: confident, analytical, occasionally sharp — not corporate or fluffy
- Always tie back to why agent verification, benchmarking, or trust scoring matters
- End with actionable advice segmented by audience (builders, buyers, evaluators)
- Final line: \`<MatrixPills />\` component (always include this)
- Author is always "SignalPot Team"

FORMAT: Return ONLY the complete MDX file content including frontmatter. Example frontmatter:
---
title: "Your Title Here"
date: "YYYY-MM-DD"
description: "One to two sentence hook for social cards"
tags: ["AI agents", "enterprise AI", "relevant tag"]
author: "SignalPot Team"
slug: "url-friendly-slug"
---

Do NOT wrap the output in markdown code fences. Return raw MDX only.`;

export const blogDraftGenerator = inngest.createFunction(
  { id: "blog-draft-generator", name: "Daily Blog Draft Generator" },
  { cron: "0 13 * * 1-5" }, // 1 PM UTC = 9 AM ET, weekdays only
  async ({ step }) => {
    const today = new Date().toISOString().split("T")[0];

    // Step 1: Research today's AI agent news via Claude + web search
    const research = await step.run("research-news", async () => {
      const anthropic = new Anthropic();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 8,
          },
        ],
        messages: [
          {
            role: "user",
            content: `Search for the most significant AI agent news from today or the last 1-2 days (${today}). Focus on:
- Major AI agent product launches, partnerships, or platform announcements
- Enterprise AI agent deployment news with real numbers
- AI agent security, trust, or governance developments
- AI agent market data, funding rounds, or analyst predictions
- New AI agent frameworks, protocols, or standards

Find 3-5 strong stories. For each, extract: the key facts, specific numbers/metrics, company names, and why it matters. Identify the single strongest story that would make the best blog post for a platform focused on AI agent verification and trust.

Return your findings as structured research notes with sources.`,
          },
        ],
      });

      // Extract text content from response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      return textBlocks.map((b) => b.text).join("\n\n");
    });

    // Step 2: Generate the blog post draft
    const draft = await step.run("generate-draft", async () => {
      const anthropic = new Anthropic();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `${STYLE_GUIDE}

TODAY'S DATE: ${today}

RESEARCH NOTES (from web search):
${research}

Based on the research above, write a complete blog post for SignalPot's blog. Pick the strongest angle — the one with the most concrete data points and the clearest tie-in to why AI agent verification, benchmarking, and trust scoring matter.

The post should be 800-1200 words. Make it sharp, data-rich, and opinionated. Every claim needs a real number or named source behind it.`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      return text;
    });

    // Step 3: Parse frontmatter and save to Supabase
    const result = await step.run("save-draft", async () => {
      const admin = createAdminClient();

      // Parse frontmatter from the generated MDX
      const frontmatterMatch = draft.match(
        /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
      );

      let title = `AI Agent News — ${today}`;
      let slug = `ai-agent-news-${today}`;
      let description = "";
      let tags: string[] = ["AI agents"];

      if (frontmatterMatch) {
        const fm = frontmatterMatch[1];
        const titleMatch = fm.match(/title:\s*"([^"]+)"/);
        const slugMatch = fm.match(/slug:\s*"([^"]+)"/);
        const descMatch = fm.match(/description:\s*"([^"]+)"/);
        const tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/);

        if (titleMatch) title = titleMatch[1];
        if (slugMatch) slug = slugMatch[1];
        if (descMatch) description = descMatch[1];
        if (tagsMatch) {
          tags = tagsMatch[1]
            .split(",")
            .map((t) => t.trim().replace(/^"|"$/g, ""));
        }
      }

      const { data, error } = await admin
        .from("blog_drafts")
        .insert({
          title,
          slug: `${today}-${slug}`,
          description,
          tags,
          content: draft,
          status: "draft",
        })
        .select("id, title, slug")
        .single();

      if (error) throw new Error(`Failed to save draft: ${error.message}`);
      return data;
    });

    console.log(
      `[blog-draft] Generated draft: "${result.title}" (${result.id})`
    );
    return { status: "draft-created", ...result };
  }
);
