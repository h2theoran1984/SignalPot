import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const computeTrustSignals = inngest.createFunction(
  { id: "compute-trust-signals", name: "Compute Trust Signals — Weekly" },
  { cron: "0 0 * * 0" },
  async ({ step }) => {
    const admin = createAdminClient();

    // Step 1: fetch all active agents with owner github_username
    const agents = await step.run("fetch-agents", async () => {
      const { data, error } = await admin
        .from("agents")
        .select("id, created_at, owner_id, profiles(github_username)")
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    });

    // Step 2: agent_age signal — days since creation
    await step.run("signal-agent-age", async () => {
      const now = Date.now();
      for (const agent of agents) {
        const ageDays =
          (now - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24);
        await admin.from("trust_signals").upsert(
          {
            agent_id: agent.id,
            signal_type: "agent_age",
            value: Math.round(ageDays * 10) / 10,
            measured_at: new Date().toISOString(),
          },
          { onConflict: "agent_id,signal_type" }
        );
      }
      return { processed: agents.length };
    });

    // Step 3: unique_callers signal — distinct requesters on completed jobs
    await step.run("signal-unique-callers", async () => {
      for (const agent of agents) {
        const { data: jobs } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("provider_agent_id", agent.id)
          .eq("status", "completed");
        const unique = new Set(
          (jobs ?? [])
            .map((j: { requester_profile_id: string | null }) => j.requester_profile_id)
            .filter(Boolean)
        ).size;
        await admin.from("trust_signals").upsert(
          {
            agent_id: agent.id,
            signal_type: "unique_callers",
            value: unique,
            measured_at: new Date().toISOString(),
          },
          { onConflict: "agent_id,signal_type" }
        );
      }
      return { processed: agents.length };
    });

    // Step 4: dispute_wins signal — win rate for disputes on this agent's jobs
    // disputes table has job_id (not agent_id), so we first fetch completed job IDs
    // for this agent, then query disputes on those jobs.
    // Provider wins = resolution 'rejected' (requester filed, dispute rejected = provider wins).
    await step.run("signal-dispute-wins", async () => {
      for (const agent of agents) {
        // Get all job IDs where this agent was the provider
        const { data: agentJobs } = await admin
          .from("jobs")
          .select("id")
          .eq("provider_agent_id", agent.id);

        const jobIds = (agentJobs ?? []).map((j: { id: string }) => j.id);

        let winRate = 0;
        if (jobIds.length > 0) {
          const { data: allDisputes } = await admin
            .from("disputes")
            .select("resolution")
            .in("job_id", jobIds)
            .eq("status", "resolved");

          const total = (allDisputes ?? []).length;
          const wins = (allDisputes ?? []).filter(
            (d: { resolution: string | null }) => d.resolution === "rejected"
          ).length;
          winRate = total > 0 ? wins / total : 0;
        }

        await admin.from("trust_signals").upsert(
          {
            agent_id: agent.id,
            signal_type: "dispute_wins",
            value: Math.round(winRate * 1000) / 1000,
            measured_at: new Date().toISOString(),
          },
          { onConflict: "agent_id,signal_type" }
        );
      }
      return { processed: agents.length };
    });

    // Step 5: github_activity signal — recent GitHub events normalized to 0–1
    await step.run("signal-github-activity", async () => {
      const githubToken = process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "SignalPot/1.0",
      };
      if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      for (const agent of agents) {
        // Cast through unknown because Inngest's JsonifyObject wraps the step
        // return value, causing type incompatibility with the Supabase inferred type.
        const agentAny = agent as unknown as {
          profiles: { github_username: string | null } | { github_username: string | null }[] | null;
        };
        const profilesRaw = agentAny.profiles;
        // Supabase returns a single object for a many-to-one join, but handle
        // arrays defensively in case the query returns multiple rows.
        const profile = Array.isArray(profilesRaw) ? profilesRaw[0] ?? null : profilesRaw;
        const githubUsername = profile?.github_username;
        let activityScore = 0;

        if (githubUsername) {
          try {
            const res = await fetch(
              `https://api.github.com/users/${githubUsername}/events?per_page=30`,
              { headers }
            );
            if (res.ok) {
              const events = await res.json();
              const recentEvents = Array.isArray(events)
                ? events.filter(
                    (e: { created_at: string }) => new Date(e.created_at) > cutoff
                  )
                : [];
              activityScore = Math.min(recentEvents.length / 30, 1);
            }
          } catch {
            // GitHub API unavailable — leave as 0
          }
        }

        await admin.from("trust_signals").upsert(
          {
            agent_id: agent.id,
            signal_type: "github_activity",
            value: Math.round(activityScore * 1000) / 1000,
            measured_at: new Date().toISOString(),
          },
          { onConflict: "agent_id,signal_type" }
        );
      }
      return { processed: agents.length };
    });

    return {
      message: "Trust signals computed",
      agents_processed: agents.length,
    };
  }
);
