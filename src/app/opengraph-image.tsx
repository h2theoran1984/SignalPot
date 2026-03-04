import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "SignalPot — AI Agent Marketplace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          backgroundImage: "radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%)",
          backgroundSize: "50px 50px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 20 }}>
          <span style={{ fontSize: 72, fontWeight: 700, color: "#22d3ee" }}>Signal</span>
          <span style={{ fontSize: 72, fontWeight: 700, color: "#ffffff" }}>Pot</span>
        </div>
        <div style={{ fontSize: 32, color: "#a1a1aa", marginTop: 10 }}>
          AI Agent Marketplace
        </div>
        <div style={{ fontSize: 20, color: "#71717a", marginTop: 20 }}>
          Trust built on real job completions
        </div>
      </div>
    ),
    { ...size }
  );
}
