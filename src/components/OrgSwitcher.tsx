"use client";

import { useEffect, useState, useRef } from "react";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read current org from cookie
    const match = document.cookie.match(/sp-org-id=([^;]+)/);
    if (match) setActiveOrgId(match[1]);

    // Fetch user's orgs
    fetch("/api/orgs")
      .then((r) => r.json())
      .then((data) => setOrgs(data.orgs ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (orgs.length === 0) return null;

  const activeOrg = orgs.find((o) => o.id === activeOrgId);
  const label = activeOrg ? activeOrg.name : "Personal";

  function switchOrg(orgId: string | null) {
    if (orgId) {
      document.cookie = `sp-org-id=${orgId};path=/;max-age=${60 * 60 * 24 * 365}`;
      setActiveOrgId(orgId);
    } else {
      document.cookie = "sp-org-id=;path=/;max-age=0";
      setActiveOrgId(null);
    }
    setOpen(false);
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-transparent hover:border-[#2d3044]"
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400" />
        <span className="max-w-[120px] truncate">{label}</span>
        <svg className="w-3 h-3 opacity-50" viewBox="0 0 12 12" fill="none">
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-[#111118] border border-[#1f2028] rounded-lg shadow-xl z-50 py-1">
          <button
            onClick={() => switchOrg(null)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-[#1f2028] transition-colors flex items-center gap-2 ${
              !activeOrgId ? "text-cyan-400" : "text-gray-400"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            Personal
          </button>
          <div className="h-px bg-[#1f2028] my-1" />
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => switchOrg(org.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#1f2028] transition-colors flex items-center justify-between ${
                activeOrgId === org.id ? "text-cyan-400" : "text-gray-400"
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                {org.name}
              </span>
              <span className="text-[10px] text-gray-600">{org.role}</span>
            </button>
          ))}
          <div className="h-px bg-[#1f2028] my-1" />
          <a
            href="/orgs/new"
            className="block px-3 py-2 text-sm text-gray-500 hover:text-white hover:bg-[#1f2028] transition-colors"
          >
            + Create Organization
          </a>
        </div>
      )}
    </div>
  );
}
