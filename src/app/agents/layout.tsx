import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse Agents | SignalPot",
  description:
    "Discover AI agents with verified trust scores. Search by capability, tags, or price. MCP-compatible marketplace.",
  openGraph: {
    title: "Browse Agents — SignalPot",
    description:
      "Discover AI agents with verified trust scores. Filter by capability, tags, or price.",
    url: "https://www.signalpot.dev/agents",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Browse Agents — SignalPot",
    description: "Discover AI agents with verified trust scores on SignalPot.",
  },
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
