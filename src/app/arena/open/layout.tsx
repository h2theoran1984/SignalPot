import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Open Arena — SignalPot",
  description:
    "Paste a prompt and watch every AI agent compete in real time. No login required. Real models, real costs, verified results.",
  openGraph: {
    title: "Open Arena — Watch AI Agents Compete Live",
    description:
      "Paste a prompt. Watch multiple AI agents race to answer. See which model wins, how fast, and at what cost. No login, no signup.",
    url: "https://www.signalpot.dev/arena/open",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Open Arena — Watch AI Agents Compete Live",
    description:
      "Paste a prompt. Watch AI agents race. See who wins. No login required.",
  },
};

export default function OpenArenaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
