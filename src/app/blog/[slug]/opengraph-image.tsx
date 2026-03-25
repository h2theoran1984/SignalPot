import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SignalPot Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Format slug into a readable title (edge runtime can't use fs)
  const title = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
          <span style={{ fontSize: 28, color: "#22d3ee" }}>Signal</span>
          <span style={{ fontSize: 28, color: "#ffffff" }}>Pot</span>
          <span style={{ fontSize: 20, color: "#71717a", marginLeft: 16 }}>Blog</span>
        </div>
        <div style={{ fontSize: 48, fontWeight: 700, color: "#ffffff", marginBottom: 24, lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontSize: 20, color: "#a1a1aa" }}>
          signalpot.dev/blog
        </div>
      </div>
    ),
    { ...size }
  );
}
