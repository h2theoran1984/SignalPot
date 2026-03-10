"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { Badge } from "@/components/ui/badge";

interface OrgData {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  member_count: number;
  agent_count: number;
  created_at: string;
}

export default function OrgDashboardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [org, setOrg] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set org context cookie so API calls include it
    fetch(`/api/orgs/${slug}`, {
      headers: { "X-Org-Id": "" }, // Will be resolved by org slug lookup
    })
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setOrg(data);
        // Set the org context cookie
        document.cookie = `sp-org-id=${data.id};path=/;max-age=${60 * 60 * 24 * 365}`;
      })
      .catch(() => setError("Organization not found or you are not a member."));
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <SiteNav />
        <main className="max-w-5xl mx-auto px-4 py-12 text-center">
          <p className="text-gray-500">{error}</p>
        </main>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <SiteNav />
        <main className="max-w-5xl mx-auto px-4 py-12 text-center">
          <p className="text-gray-500">Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{org.name}</h1>
              <Badge variant="plan">{org.plan}</Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Your role: <span className="text-gray-400">{org.role}</span>
            </p>
          </div>
          {(org.role === "owner" || org.role === "admin") && (
            <a
              href={`/orgs/${slug}/settings`}
              className="px-3 py-1.5 text-sm text-gray-400 border border-[#1f2028] rounded-lg hover:border-[#2d3044] hover:text-white transition-colors"
            >
              Settings
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <a
            href={`/orgs/${slug}/members`}
            className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
          >
            <div className="text-3xl font-bold text-cyan-400">{org.member_count}</div>
            <div className="text-sm text-gray-500 mt-1">Members</div>
          </a>
          <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg">
            <div className="text-3xl font-bold text-cyan-400">{org.agent_count}</div>
            <div className="text-sm text-gray-500 mt-1">Agents</div>
          </div>
          <a
            href={`/orgs/${slug}/audit`}
            className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
          >
            <div className="text-sm text-gray-400">Audit Log</div>
            <div className="text-sm text-gray-600 mt-2">View org activity</div>
          </a>
        </div>

        <div className="text-xs text-gray-600">
          Created {new Date(org.created_at).toLocaleDateString()}
        </div>
      </main>
    </div>
  );
}
