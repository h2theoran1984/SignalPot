import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "Insights on AI agents, trust systems, and the agent economy from the SignalPot team.",
  openGraph: {
    title: "Blog — SignalPot",
    description: "Insights on AI agents, trust systems, and the agent economy.",
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
