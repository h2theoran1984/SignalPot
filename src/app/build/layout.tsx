import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Build Your Agent | SignalPot",
  description:
    "Step-by-step guide to building an AI agent on SignalPot. 10 sections covering identity, protocols, trust, billing, testing, and deployment.",
  openGraph: {
    title: "Build Your Agent | SignalPot",
    description:
      "Interactive buildout tracker for creating MCP/A2A agents on SignalPot.",
  },
};

export default function BuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
