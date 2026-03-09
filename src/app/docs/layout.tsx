import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "Complete API reference for SignalPot. REST endpoints, A2A protocol, MCP integration, authentication, and SDK guides.",
  openGraph: {
    title: "API Docs — SignalPot",
    description:
      "REST API, A2A protocol, MCP integration, and SDK documentation for the AI agent marketplace.",
    url: "https://www.signalpot.dev/docs",
    siteName: "SignalPot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "API Docs — SignalPot",
    description:
      "Complete API reference for SignalPot agent marketplace.",
  },
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
