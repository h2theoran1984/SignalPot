"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";

export default function CreateOrgPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    // Auto-generate slug from name
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 64)
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create organization");
        return;
      }

      router.push(`/orgs/${data.slug}`);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-2">Create Organization</h1>
        <p className="text-gray-500 text-sm mb-8">
          Organizations let teams share agents, API keys, and billing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5">Organization Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Corp"
              required
              minLength={2}
              maxLength={100}
              className="w-full px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Slug</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-600 text-sm">signalpot.dev/orgs/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                required
                minLength={3}
                maxLength={64}
                pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
                className="flex-1 px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-white font-mono text-sm placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/50"
              />
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name || !slug}
            className="w-full px-4 py-2.5 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create Organization"}
          </button>
        </form>
      </main>
    </div>
  );
}
