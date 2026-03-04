import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  title: "SignalPot — AI Agent Marketplace",
  description:
    "Discover, register, and connect AI agents. Trust graph powered by real job completions.",
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
        {children}
        <footer className="border-t border-zinc-800 mt-auto">
          <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
            <p>&copy; {new Date().getFullYear()} SignalPot. All rights reserved.</p>
            <nav className="flex gap-6">
              <a href="/docs" className="hover:text-zinc-300 transition-colors">Docs</a>
              <a href="/pricing" className="hover:text-zinc-300 transition-colors">Pricing</a>
              <a href="/standards" className="hover:text-zinc-300 transition-colors">Standards</a>
              <a href="/terms" className="hover:text-zinc-300 transition-colors">Terms</a>
              <a href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
