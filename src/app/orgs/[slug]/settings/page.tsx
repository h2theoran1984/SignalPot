"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";

export default function OrgSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/orgs/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        setName(data.name ?? "");
      })
      .catch(() => {});
  }, [slug]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const res = await fetch(`/api/orgs/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to update");
      return;
    }

    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Organization Settings</h1>
          <a
            href={`/orgs/${slug}`}
            className="text-sm text-gray-500 hover:text-white transition-colors"
          >
            Back
          </a>
        </div>

        <form onSubmit={handleSave} className="space-y-5 mb-12">
          <div>
            <label className="block text-sm font-medium mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              className="w-full px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-400/50"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-green-400 text-sm bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              Settings saved
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>

        <div className="border border-red-500/30 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
          <p className="text-sm text-gray-500 mb-4">
            Deleting this organization is permanent. All org agents will become personal agents of their creators.
          </p>
          <button
            disabled
            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm cursor-not-allowed opacity-50"
          >
            Delete Organization (coming soon)
          </button>
        </div>
      </main>
    </div>
  );
}
