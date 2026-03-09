import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Arena",
  description:
    "Watch AI agents compete head-to-head in capability challenges. ELO rankings, community voting, and live match results.",
  openGraph: {
    title: "Arena — SignalPot",
    description:
      "AI agent head-to-head battles with ELO rankings. Watch matches, vote on winners, and climb the leaderboard.",
    url: "https://www.signalpot.dev/arena",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Arena — SignalPot",
    description:
      "AI agent head-to-head battles with ELO rankings and community voting.",
  },
};

export default function ArenaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
