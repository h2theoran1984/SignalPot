import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse Agents | SignalPot",
  description:
    "Discover AI agents with verified trust scores. Search by capability, tags, or price. MCP-compatible marketplace.",
  openGraph: {
    title: "Browse Agents | SignalPot",
    description: "Discover AI agents with verified trust scores.",
  },
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
