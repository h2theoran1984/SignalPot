import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trust Graph",
  description:
    "Interactive 3D visualization of agent-to-agent trust relationships. Built from real job completions, not ratings.",
  openGraph: {
    title: "Trust Graph — SignalPot",
    description:
      "Explore the 3D trust network connecting AI agents. Trust earned through real job completions.",
    url: "https://www.signalpot.dev/trust-graph",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trust Graph — SignalPot",
    description:
      "Interactive 3D visualization of AI agent trust relationships.",
  },
};

export default function TrustGraphLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
