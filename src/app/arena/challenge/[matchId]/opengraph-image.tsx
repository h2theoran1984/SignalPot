import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SignalPot Arena Challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/arena_matches?id=eq.${matchId}&select=capability,status,winner,match_type,level,cost_a,cost_b,judgment_breakdown,agent_a:agents!arena_matches_agent_a_id_fkey(name),agent_b:agents!arena_matches_agent_b_id_fkey(name)`,
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
          <div style={{ fontSize: 32, color: "#a1a1aa" }}>Arena Challenge</div>
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
  const winnerName =
    isCompleted && match.winner === "a" ? agentA :
    isCompleted && match.winner === "b" ? agentB : null;
  const loserName =
    isCompleted && match.winner === "a" ? agentB :
    isCompleted && match.winner === "b" ? agentA : null;

  const breakdown = match.judgment_breakdown as { total_a?: number; total_b?: number } | null;
  const winnerScore = match.winner === "a" ? breakdown?.total_a : breakdown?.total_b;
  const loserScore = match.winner === "a" ? breakdown?.total_b : breakdown?.total_a;

  const costWinner = match.winner === "a" ? match.cost_a : match.cost_b;
  const costLoser = match.winner === "a" ? match.cost_b : match.cost_a;
  const cheaper = costWinner != null && costLoser != null && costLoser > 0
    ? Math.round((1 - costWinner / costLoser) * 100)
    : null;

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
        {/* Top: branding + challenge label */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 24, color: "#22d3ee" }}>Signal</span>
            <span style={{ fontSize: 24, color: "#ffffff" }}>Pot</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, color: "#22d3ee", fontWeight: 700, letterSpacing: 2 }}>
              ARENA CHALLENGE
            </span>
          </div>
        </div>

        {/* Main: the upset narrative */}
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isCompleted && winnerName && loserName ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: 48, fontWeight: 800, color: "#22d3ee", lineHeight: 1.2, textAlign: "center" }}>
                {winnerName}
              </span>
              <span style={{ fontSize: 24, color: "#a1a1aa", margin: "12px 0" }}>
                defeated
              </span>
              <span style={{ fontSize: 40, fontWeight: 700, color: "#71717a", lineHeight: 1.2, textAlign: "center" }}>
                {loserName}
              </span>

              {/* Score line */}
              {winnerScore != null && loserScore != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20 }}>
                  <span style={{ fontSize: 32, fontWeight: 700, color: "#22d3ee" }}>
                    {Math.round(winnerScore * 100)}%
                  </span>
                  <span style={{ fontSize: 20, color: "#3f3f46" }}>to</span>
                  <span style={{ fontSize: 32, fontWeight: 700, color: "#71717a" }}>
                    {Math.round(loserScore * 100)}%
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: "#ffffff" }}>{agentA}</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#22d3ee" }}>VS</span>
              <span style={{ fontSize: 40, fontWeight: 700, color: "#ffffff" }}>{agentB}</span>
            </div>
          )}
        </div>

        {/* Bottom: capability + cost savings + CTA */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "flex",
                fontSize: 16,
                color: "#22d3ee",
                backgroundColor: "#22d3ee20",
                padding: "6px 14px",
                borderRadius: 8,
              }}
            >
              {match.capability}
            </div>
            {cheaper != null && cheaper > 0 && (
              <span style={{ fontSize: 16, color: "#4ade80" }}>
                {cheaper}% cheaper
              </span>
            )}
          </div>
          <span style={{ fontSize: 20, color: "#22d3ee", fontWeight: 600 }}>
            Think you can do better?
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
