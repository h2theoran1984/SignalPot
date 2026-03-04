import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 100,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          borderRadius: 36,
        }}
      >
        <span style={{ color: "#22d3ee", fontWeight: 700 }}>S</span>
        <span style={{ color: "#ffffff", fontWeight: 700 }}>P</span>
      </div>
    ),
    { ...size }
  );
}
