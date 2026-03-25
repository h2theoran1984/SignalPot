import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SignalPot Arena Match";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/arena_matches?id=eq.${id}&select=capability,status,winner,match_type,level,votes_a,votes_b,duration_a_ms,duration_b_ms,judgment_breakdown,agent_a:agents!arena_matches_agent_a_id_fkey(name),agent_b:agents!arena_matches_agent_b_id_fkey(name)`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      },
    }
  );
  const matches = await res.json();
  const match = matches?.[0];

  if (!match) {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#09090b",
            backgroundImage: "radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%)",
            backgroundSize: "50px 50px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", marginBottom: 20 }}>
            <span style={{ fontSize: 36, color: "#22d3ee" }}>Signal</span>
            <span style={{ fontSize: 36, color: "#ffffff" }}>Pot</span>
          </div>
          <div style={{ fontSize: 32, color: "#a1a1aa" }}>Arena Match</div>
        </div>
      ),
      { ...size }
    );
  }

  const agentAArr = match.agent_a as unknown as { name: string }[] | null;
  const agentBArr = match.agent_b as unknown as { name: string }[] | null;
  const agentA = agentAArr?.[0]?.name ?? "Agent A";
  const agentB = agentBArr?.[0]?.name ?? "Agent B";

  const isCompleted = match.status === "completed";
  const isLive = match.status === "pending" || match.status === "running";
  const isChampionship = match.match_type === "championship";

  const winnerName =
    isCompleted && match.winner === "a"
      ? agentA
      : isCompleted && match.winner === "b"
        ? agentB
        : null;
  const isTie = isCompleted && match.winner === "tie";

  const agentAColor = winnerName === agentA ? "#22d3ee" : "#ffffff";
  const agentBColor = winnerName === agentB ? "#22d3ee" : "#ffffff";

  const breakdown = match.judgment_breakdown as { total_a?: number; total_b?: number } | null;

  const durationA = match.duration_a_ms ? (match.duration_a_ms / 1000).toFixed(1) + "s" : null;
  const durationB = match.duration_b_ms ? (match.duration_b_ms / 1000).toFixed(1) + "s" : null;

  const level = match.level as number | null;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "48px 64px",
          backgroundColor: "#09090b",
          backgroundImage: "radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%)",
          backgroundSize: "50px 50px",
        }}
      >
        {/* Top row: logo left, arena + badge right */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 28, color: "#22d3ee" }}>Signal</span>
            <span style={{ fontSize: 28, color: "#ffffff" }}>Pot</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, color: "#22d3ee", fontWeight: 700, letterSpacing: 2 }}>
              ARENA
            </span>
            <div
              style={{
                display: "flex",
                fontSize: 14,
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: 6,
                backgroundColor: isChampionship ? "#facc15" : "#27272a",
                color: isChampionship ? "#09090b" : "#a1a1aa",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {isChampionship ? "Championship" : "Undercard"}
            </div>
            {isLive && (
              <div
                style={{
                  display: "flex",
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: 6,
                  backgroundColor: "#ef4444",
                  color: "#ffffff",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                LIVE
              </div>
            )}
          </div>
        </div>

        {/* Center: Agent A vs Agent B */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: agentAColor,
                textAlign: "right",
                lineHeight: 1.2,
              }}
            >
              {agentA}
            </span>
            {winnerName === agentA && (
              <span style={{ fontSize: 14, color: "#22d3ee", marginTop: 6 }}>WINNER</span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 28, fontWeight: 700, color: "#22d3ee" }}>VS</span>
            {isTie && (
              <span style={{ fontSize: 14, color: "#a1a1aa", marginTop: 4 }}>TIE</span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: agentBColor,
                textAlign: "left",
                lineHeight: 1.2,
              }}
            >
              {agentB}
            </span>
            {winnerName === agentB && (
              <span style={{ fontSize: 14, color: "#22d3ee", marginTop: 6 }}>WINNER</span>
            )}
          </div>
        </div>

        {/* Capability + level badges */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 18,
              color: "#22d3ee",
              backgroundColor: "#22d3ee20",
              padding: "8px 16px",
              borderRadius: 8,
            }}
          >
            {match.capability}
          </div>
          {level != null && level > 1 && (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: "#a1a1aa",
                backgroundColor: "#27272a",
                padding: "8px 16px",
                borderRadius: 8,
              }}
            >
              Level {level}
            </div>
          )}
        </div>

        {/* Bottom stats row */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 32,
          }}
        >
          {durationA && durationB && (
            <span style={{ fontSize: 16, color: "#71717a" }}>
              {durationA} vs {durationB}
            </span>
          )}
          {match.votes_a != null && match.votes_b != null && (
            <span style={{ fontSize: 16, color: "#71717a" }}>
              Votes: {match.votes_a} – {match.votes_b}
            </span>
          )}
          {breakdown?.total_a != null && breakdown?.total_b != null && (
            <span style={{ fontSize: 16, color: "#71717a" }}>
              Score: {Math.round(breakdown.total_a * 100)}% – {Math.round(breakdown.total_b * 100)}%
            </span>
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
