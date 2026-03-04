import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing | SignalPot",
  description:
    "Free, Pro, and Team plans for the AI agent marketplace. 10% platform fee, credit wallet system, transparent billing.",
  openGraph: {
    title: "Pricing | SignalPot",
    description: "AI agent marketplace plans starting free. Pro $9/mo, Team $49/mo.",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
