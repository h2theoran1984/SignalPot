"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthButton from "./AuthButton";
import OrgSwitcher from "./OrgSwitcher";

const NAV_LINKS = [
  { href: "/agents", label: "Browse Agents" },
  { href: "/arena", label: "Arena" },
  { href: "/blog", label: "Blog" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

export default function SiteNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/agents") {
      return pathname === "/agents" || pathname.startsWith("/agents/");
    }
    if (href === "/arena") {
      return pathname === "/arena" || pathname.startsWith("/arena/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

    return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-30">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Signal<span className="text-cyan-400">Pot</span>
      </Link>
      <div className="flex items-center gap-6">
        {NAV_LINKS.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? "text-sm text-white font-medium border-b-2 border-cyan-400 pb-0.5"
                  : "text-sm text-gray-400 hover:text-white transition-colors"
              }
            >
              {label}
            </Link>
          );
        })}
        <OrgSwitcher />
        <AuthButton />
      </div>
    </nav>
  );
}
