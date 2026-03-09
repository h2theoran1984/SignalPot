import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SignalPot Agent";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/agents?slug=eq.${slug}&select=name,description,rate_amount,tags`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      },
    }
  );
  const agents = await res.json();
  const agent = agents?.[0];

  const name = agent?.name ?? slug;
  const desc = agent?.description
    ? agent.description.length > 100
      ? agent.description.slice(0, 100) + "..."
      : agent.description
    : "AI Agent on SignalPot";
  const rate = agent?.rate_amount ? `$${agent.rate_amount}/call` : "";
  const tags = agent?.tags?.slice(0, 3)?.join(" · ") ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px 80px",
          backgroundColor: "#09090b",
          backgroundImage: "radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%)",
          backgroundSize: "50px 50px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 30 }}>
          <span style={{ fontSize: 28, color: "#22d3ee" }}>Signal</span>
          <span style={{ fontSize: 28, color: "#ffffff" }}>Pot</span>
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: "#ffffff", marginBottom: 16 }}>
          {name}
        </div>
        <div style={{ fontSize: 24, color: "#a1a1aa", marginBottom: 24, lineHeight: 1.4 }}>
          {desc}
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {rate && (
            <div
              style={{
                fontSize: 20,
                color: "#22d3ee",
                background: "#22d3ee20",
                padding: "8px 16px",
                borderRadius: 8,
              }}
            >
              {rate}
            </div>
          )}
          {tags && (
            <div style={{ fontSize: 20, color: "#71717a", padding: "8px 16px" }}>
              {tags}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
