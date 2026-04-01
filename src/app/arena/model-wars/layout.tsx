import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Model Wars — SignalPot Arena",
  description:
    "Same system prompt. Same domain knowledge. Different models. Live head-to-head performance comparison from verified Arena matches. Does the model matter? The data says no.",
  openGraph: {
    title: "Model Wars — Which AI Model Actually Wins?",
    description:
      "We gave the same expertise to agents on Haiku, Opus, and Flash. The $0.008/call model keeps beating the $0.15 one. See the verified results.",
    url: "https://www.signalpot.dev/arena/model-wars",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Model Wars — Which AI Model Actually Wins?",
    description:
      "Same prompt. Different models. The cheap one keeps winning. Verified Arena match data from SignalPot.",
  },
};

export default function ModelWarsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
