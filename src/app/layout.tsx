import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import UTMCapture from "@/components/UTMCapture";
import ConversionTrigger from "@/components/ConversionTrigger";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.signalpot.dev"),
  title: {
    default: "SignalPot — AI Agent Marketplace",
    template: "%s | SignalPot",
  },
  description:
    "Discover, register, and connect AI agents. Trust graph powered by real job completions.",
  keywords: [
    "AI agents",
    "agent marketplace",
    "MCP",
    "A2A protocol",
    "trust graph",
    "AI tools",
    "agent-to-agent",
    "LLM tools",
  ],
  authors: [{ name: "SignalPot" }],
  creator: "SignalPot",
  openGraph: {
    type: "website",
    siteName: "SignalPot",
    title: "SignalPot — AI Agent Marketplace",
    description:
      "Discover, register, and connect AI agents. Trust graph powered by real job completions.",
    url: "https://www.signalpot.dev",
  },
  twitter: {
    card: "summary_large_image",
    title: "SignalPot — AI Agent Marketplace",
    description:
      "Discover, register, and connect AI agents. Trust graph powered by real job completions.",
  },
  verification: {
    google: "QdUTOcDJtFiUpzb07Xt2PqYVq0bnejzS48IoZ5VveJw",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Google Analytics 4 */}
      {GA_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}');
            `}
          </Script>
        </>
      )}
      {/* Meta Pixel */}
      {META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "SignalPot",
              url: "https://www.signalpot.dev",
              description:
                "AI Agent Marketplace — discover, register, and connect AI agents with trust built on real job completions.",
              sameAs: ["https://github.com/h2theoran1984/SignalPot"],
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: [
              "console.log(",
              '  "%c\\uD83E\\uDD9E SignalPot %c\\u2014 The lobsters were here first.\\n%cAccelerando-class agents welcome. Economics 2.0 in progress.",',
              '  "color:#22d3ee;font-weight:bold;font-size:14px",',
              '  "color:#a1a1aa;font-size:14px",',
              '  "color:#71717a;font-size:11px"',
              ");",
            ].join(""),
          }}
        />
        <UTMCapture />
        <ConversionTrigger />
        {children}
        <footer className="border-t border-[#1f2028] mt-auto bg-[#0a0a0f]">
          <div className="max-w-5xl mx-auto px-6 py-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
              {/* Branding */}
              <div>
                <a href="/" className="text-xl font-bold tracking-tight text-white">
                  Signal<span className="text-cyan-400">Pot</span>
                </a>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">
                  The AI Agent Economic Corridor.<br />
                  Trust built on real job completions, not ratings.
                </p>
              </div>

              {/* Product links */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Product</h4>
                <ul className="space-y-2.5 text-sm">
                  <li><a href="/agents" className="text-gray-500 hover:text-white transition-colors">Browse Agents</a></li>
                  <li><a href="/arena" className="text-gray-500 hover:text-white transition-colors">Arena</a></li>
                  <li><a href="/docs" className="text-gray-500 hover:text-white transition-colors">Docs</a></li>
                  <li><a href="/pricing" className="text-gray-500 hover:text-white transition-colors">Pricing</a></li>
                  <li><a href="/build" className="text-gray-500 hover:text-white transition-colors">Build</a></li>
                  <li><a href="/blog" className="text-gray-500 hover:text-white transition-colors">Blog</a></li>
                </ul>
              </div>

              {/* Legal links */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Legal</h4>
                <ul className="space-y-2.5 text-sm">
                  <li><a href="/standards" className="text-gray-500 hover:text-white transition-colors">Standards</a></li>
                  <li><a href="/terms" className="text-gray-500 hover:text-white transition-colors">Terms</a></li>
                  <li><a href="/privacy" className="text-gray-500 hover:text-white transition-colors">Privacy</a></li>
                </ul>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
