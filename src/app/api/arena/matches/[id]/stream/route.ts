// GET /api/arena/matches/[id]/stream — SSE streaming for live arena matches
// Public (no auth required) — anyone can spectate
// Follows the A2A streaming pattern from src/app/api/agents/[slug]/a2a/rpc/stream/route.ts

import { createAdminClient } from "@/lib/supabase/admin";
import type { ArenaStreamEvent } from "@/lib/arena/types";

export const dynamic = "force-dynamic";

function sseEvent(data: ArenaStreamEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();

  // Verify match exists
  const { data: initialMatch } = await admin
    .from("arena_matches")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!initialMatch) {
    return new Response(
      JSON.stringify({ error: "Match not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);

      let lastStatus = "";
      let lastResponseA = false;
      let lastResponseB = false;
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes max (polling every 1s)
      let heartbeatCounter = 0;

      const poll = async () => {
        if (attempts >= maxAttempts) {
          controller.enqueue(encode(sseEvent({ type: "heartbeat", timestamp: new Date().toISOString() })));
          try { controller.close(); } catch { /* already closed */ }
          return;
        }

        try {
          const { data: match } = await admin
            .from("arena_matches")
            .select("status, started_at, response_a, response_b, duration_a_ms, duration_b_ms, verified_a, verified_b, voting_ends_at, winner, votes_a, votes_b, votes_tie, completed_at, match_type, judgment_reasoning, judgment_confidence, judgment_source")
            .eq("id", id)
            .single();

          if (!match) {
            controller.enqueue(encode(sseEvent({ type: "match_failed", error: "Match not found" })));
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          // Emit events based on state changes
          if (match.status !== lastStatus) {
            if (match.status === "running" && lastStatus !== "running") {
              controller.enqueue(encode(sseEvent({
                type: "match_started",
                match_id: id,
                started_at: match.started_at ?? new Date().toISOString(),
              })));
            }

            if (match.status === "judging" && lastStatus !== "judging") {
              controller.enqueue(encode(sseEvent({
                type: "judging_started",
                match_id: id,
              })));
            }

            if (match.status === "voting" && lastStatus !== "voting") {
              controller.enqueue(encode(sseEvent({
                type: "voting_open",
                voting_ends_at: match.voting_ends_at ?? new Date().toISOString(),
              })));
            }

            if (match.status === "completed") {
              // If this was an undercard with judgment, emit judgment_rendered first
              if (match.judgment_reasoning && lastStatus === "judging") {
                controller.enqueue(encode(sseEvent({
                  type: "judgment_rendered",
                  winner: match.winner ?? "tie",
                  reasoning: match.judgment_reasoning as string,
                  confidence: (match.judgment_confidence as number) ?? 0,
                })));
              }

              controller.enqueue(encode(sseEvent({
                type: "match_completed",
                winner: match.winner,
                votes_a: match.votes_a,
                votes_b: match.votes_b,
                votes_tie: match.votes_tie,
              })));
              try { controller.close(); } catch { /* already closed */ }
              return;
            }

            if (match.status === "failed") {
              controller.enqueue(encode(sseEvent({ type: "match_failed", error: "Match execution failed" })));
              try { controller.close(); } catch { /* already closed */ }
              return;
            }

            lastStatus = match.status;
          }

          // Emit individual agent responses as they arrive
          if (match.response_a && !lastResponseA) {
            lastResponseA = true;
            controller.enqueue(encode(sseEvent({
              type: "agent_response",
              side: "a",
              response: match.response_a as Record<string, unknown>,
              duration_ms: match.duration_a_ms ?? 0,
              verified: match.verified_a ?? false,
            })));
          }

          if (match.response_b && !lastResponseB) {
            lastResponseB = true;
            controller.enqueue(encode(sseEvent({
              type: "agent_response",
              side: "b",
              response: match.response_b as Record<string, unknown>,
              duration_ms: match.duration_b_ms ?? 0,
              verified: match.verified_b ?? false,
            })));
          }

          // Heartbeat every 15 seconds
          heartbeatCounter++;
          if (heartbeatCounter % 15 === 0) {
            controller.enqueue(encode(sseEvent({ type: "heartbeat", timestamp: new Date().toISOString() })));
          }

          attempts++;
          setTimeout(poll, 1000);
        } catch {
          controller.enqueue(encode(sseEvent({ type: "match_failed", error: "Internal error" })));
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      // Start polling after a short delay
      setTimeout(poll, 300);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
