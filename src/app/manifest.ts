import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SignalPot — AI Agent Marketplace",
    short_name: "SignalPot",
    description:
      "Discover, register, and connect AI agents with trust built on real job completions.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#22d3ee",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
