/**
 * Synthetic prompt generator for arena matches.
 * Generates capability-aware test data so users don't need to write prompts manually.
 */

const MEETING_TRANSCRIPTS = [
  `Meeting: Q3 Sprint Planning — March 9, 2026
Attendees: Sarah (PM), Jake (Engineering), Lisa (Design), Tom (QA)

Sarah: Let's get started. We need to finalize the v2.1 release scope by Friday. Jake, where are we on the API migration?

Jake: The REST-to-GraphQL migration is about 70% done. I need Lisa's updated component specs before I can wire up the new dashboard endpoints. Realistically I need those by Wednesday.

Lisa: I can have the dashboard specs ready by Tuesday EOD. But I'm blocked on the brand guidelines update from marketing — Tom, did they send those over?

Tom: Not yet. I'll ping Maria today and escalate if we don't hear back by tomorrow noon. Also, I found three critical bugs in the payment flow during last week's regression. We need to decide if those are release blockers.

Sarah: Yes, payment bugs are blockers. Jake, can you triage those today and give estimates?

Jake: Will do. I'll have severity assessments by end of day.

Sarah: Great. Lisa, once you finish the specs, can you also do a quick UX audit on the onboarding flow? We got complaints from two enterprise clients.

Lisa: Sure, I'll slot that for Thursday.

Sarah: Perfect. Let's reconvene Wednesday at 2pm for a checkpoint. Everyone clear on next steps?

All: Yes.`,

  `Meeting: Product Roadmap Review — March 5, 2026
Attendees: Mike (CEO), Angela (CTO), Dev (Head of Product), Priya (Marketing)

Mike: Alright, let's align on Q2 priorities. Angela, what's engineering capacity looking like?

Angela: We have 3 full squads available. One is finishing the auth overhaul, should be done by mid-April. The other two are free from April 1st.

Dev: Perfect. I've got three big bets for Q2: the AI copilot feature, the enterprise SSO integration, and the mobile app redesign. We can't do all three with two squads.

Mike: Which has the highest revenue impact?

Dev: Enterprise SSO, hands down. We've lost four deals in the last quarter because we don't support SAML. But the AI copilot is what gets us press coverage and developer excitement.

Priya: From a marketing perspective, the AI copilot is a much better story. We have the developer conference in May and I need something to announce.

Angela: SSO is a 6-week project max. The copilot is at least 10 weeks for an MVP. If we start SSO first, we can ship it before the conference and still have the copilot in beta by late June.

Mike: That works. Let's do SSO first, copilot second. Dev, can you have the SSO spec finalized by next Friday?

Dev: Absolutely. I'll have it to Angela by Thursday.

Priya: I'll start drafting the conference talk around both features. Angela, I'll need a technical deep-dive session with your team by April 10th.

Angela: Done. I'll have Jake set that up.

Mike: Good. Mobile redesign moves to Q3. Any objections? No? Meeting adjourned.`,

  `Meeting: Incident Postmortem — Outage March 7, 2026
Attendees: Rachel (SRE Lead), Carlos (Backend), Nina (Frontend), Sam (Support)

Rachel: This is the postmortem for yesterday's 47-minute outage affecting the checkout flow. Timeline: alert fired at 14:23 UTC, we declared an incident at 14:31, mitigation at 14:52, full resolution at 15:10. Carlos, walk us through the root cause.

Carlos: The connection pool for the payments database hit its max limit. We had a slow query that was introduced in Tuesday's deploy — a missing index on the orders table for the new filtering feature. Under normal load it was fine, but we had a traffic spike from the flash sale and connections started queuing.

Nina: I got the first user reports around 14:25 on the frontend side. Checkout was spinning indefinitely. We should probably add a timeout with a user-friendly error message for that.

Rachel: Agreed. Sam, how many tickets came in?

Sam: 73 tickets in 45 minutes. We had a macro ready by 14:40 and cleared the queue by 16:00. Eight customers are asking for compensation — three had their payment charged but order not confirmed.

Rachel: Those three are priority one. Carlos, can you verify their order status today?

Carlos: Yes. I'll cross-reference the payment gateway logs with our orders table and fix any stuck transactions by end of day.

Rachel: Good. Action items: Carlos adds the missing index and implements connection pool alerting. Nina adds a 10-second timeout on checkout API calls with a retry prompt. Sam drafts a communication template for affected customers. I'll update our runbook for database connection pool incidents. All due by next Wednesday.

Sam: Should we offer the eight customers a credit or discount?

Rachel: Let's offer 15% off their next order. Sam, draft the email and I'll approve it.

All: Understood. Let's close this out.`,
];

const SENTIMENT_TEXTS = [
  "Our team just shipped the biggest feature release of the year and the customer feedback has been overwhelmingly positive. The CEO personally thanked the engineering team in an all-hands meeting. Morale is at an all-time high and we're already planning the next iteration based on user requests.",

  "The migration project has been nothing but delays and cost overruns. Three key engineers quit in the last month, the vendor keeps missing deadlines, and stakeholders are losing patience. We need a completely new approach or this project is going to be cancelled.",

  "The quarterly results were mixed. Revenue grew 12% which beat expectations, but customer churn increased to 8.5% from 6.2% last quarter. The new pricing tier is attracting smaller customers but our enterprise segment is flat. We need to investigate why large accounts aren't expanding.",
];

const TEXT_PASSAGES = [
  "Retrieval-Augmented Generation (RAG) has become the dominant pattern for building LLM-powered applications that need access to current or proprietary data. Rather than fine-tuning a model on specific data, RAG retrieves relevant documents at query time and includes them in the context window. This approach offers several advantages: the knowledge base can be updated without retraining, sources can be cited for transparency, and the system avoids hallucinating facts that contradict the source material. However, RAG systems face challenges around chunking strategies, embedding model selection, re-ranking relevance, and handling multi-hop queries where the answer requires synthesizing information from multiple documents.",

  "The shift to edge computing in 2025-2026 has fundamentally changed how applications are deployed. Instead of routing all requests to centralized cloud data centers, code now runs at edge locations within 50ms of end users. Frameworks like Next.js, Cloudflare Workers, and Deno Deploy have made this accessible to individual developers. The tradeoffs are real though — edge functions have limited CPU time, smaller memory budgets, and cannot maintain persistent connections. Database access from the edge typically requires specialized solutions like connection pooling services or edge-native databases that replicate globally.",

  "Open source AI models have reached a quality inflection point. Models like Llama 3, Mistral, and their derivatives now perform competitively with proprietary models on many benchmarks. This has created a viable self-hosting option for companies with strict data privacy requirements or high-volume inference needs. The total cost of ownership calculation has shifted — while API-based models are simpler to operate, self-hosted models on optimized infrastructure can be 3-10x cheaper at scale. The tooling ecosystem around deployment (vLLM, TensorRT-LLM) and fine-tuning (LoRA, QLoRA) has matured significantly.",
];

const GITHUB_REPOS = [
  { owner: "vercel", repo: "next.js" },
  { owner: "anthropics", repo: "anthropic-sdk-python" },
  { owner: "denoland", repo: "deno" },
];

const CODE_SNIPPETS = [
  { language: "python", code: "def fibonacci(n):\n    if n <= 1:\n        return n\n    a, b = 0, 1\n    for _ in range(2, n + 1):\n        a, b = b, a + b\n    return b\n\nprint([fibonacci(i) for i in range(15)])" },
  { language: "python", code: "from collections import Counter\n\ndef top_words(text, n=5):\n    words = text.lower().split()\n    return Counter(words).most_common(n)\n\nsample = 'the quick brown fox jumps over the lazy dog the fox'\nprint(top_words(sample))" },
  { language: "python", code: "import json\n\ndef flatten(obj, prefix=''):\n    items = {}\n    for k, v in obj.items():\n        key = f'{prefix}.{k}' if prefix else k\n        if isinstance(v, dict):\n            items.update(flatten(v, key))\n        else:\n            items[key] = v\n    return items\n\nprint(json.dumps(flatten({'a': 1, 'b': {'c': 2, 'd': {'e': 3}}}), indent=2))" },
];

const SEARCH_QUERIES = [
  { query: "recent developments in autonomous AI agents 2026", max_results: 5 },
  { query: "best practices for LLM-powered application security", max_results: 5 },
  { query: "edge computing deployment patterns for real-time applications", max_results: 5 },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a synthetic prompt payload based on the capability being tested.
 * Returns { text, description } where text is the main content and description
 * is a brief human-readable label for the match.
 */
export function generateSyntheticPrompt(capability: string): {
  prompt: Record<string, unknown>;
  description: string;
} {
  // Normalize capability: "signalpot/meeting-summary@v1" → "meeting-summary"
  let verb = capability;
  if (verb.includes("/")) {
    verb = verb.split("/").pop()?.split("@")[0] ?? verb;
  }

  switch (verb) {
    case "meeting-summary":
    case "action-items": {
      const transcript = pickRandom(MEETING_TRANSCRIPTS);
      return {
        prompt: { text: transcript },
        description: "Summarize a meeting transcript",
      };
    }

    case "sentiment": {
      const text = pickRandom(SENTIMENT_TEXTS);
      return {
        prompt: { text },
        description: "Analyze text sentiment",
      };
    }

    case "text-summary":
    case "summarize": {
      const text = pickRandom(TEXT_PASSAGES);
      return {
        prompt: { text },
        description: "Summarize a text passage",
      };
    }

    case "github-summary": {
      const repo = pickRandom(GITHUB_REPOS);
      return {
        prompt: { repo_url: `https://github.com/${repo.owner}/${repo.repo}` },
        description: `Summarize ${repo.owner}/${repo.repo}`,
      };
    }

    case "run":
    case "validate": {
      const snippet = pickRandom(CODE_SNIPPETS);
      return {
        prompt: snippet,
        description: "Execute a code snippet",
      };
    }

    case "search":
    case "scrape":
    case "lookup": {
      const query = pickRandom(SEARCH_QUERIES);
      return {
        prompt: query,
        description: query.query,
      };
    }

    default: {
      // Fallback: use a meeting transcript — it works for most text-based capabilities
      const transcript = pickRandom(MEETING_TRANSCRIPTS);
      return {
        prompt: { text: transcript },
        description: "Process a meeting transcript",
      };
    }
  }
}
