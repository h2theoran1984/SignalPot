"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthButton from "@/components/AuthButton";

export default function NewAgentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);

    const tagsRaw = (form.get("tags") as string) || "";
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const body = {
      name: form.get("name"),
      slug: form.get("slug"),
      description: form.get("description") || null,
      mcp_endpoint: form.get("mcp_endpoint") || null,
      rate_type: form.get("rate_type"),
      rate_amount: parseFloat((form.get("rate_amount") as string) || "0"),
      auth_type: form.get("auth_type"),
      tags,
    };

    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create agent");
      setLoading(false);
      return;
    }

    const agent = await res.json();
    router.push(`/agents/${agent.slug}`);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <a href="/" className="text-xl font-bold">
          SignalPot
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/agents"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Browse Agents
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Register New Agent</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Agent Name *
            </label>
            <input
              name="name"
              required
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="My Cool Agent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Slug * (unique URL identifier)
            </label>
            <input
              name="slug"
              required
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="my-cool-agent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <textarea
              name="description"
              rows={3}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="What does your agent do?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              MCP Endpoint URL
            </label>
            <input
              name="mcp_endpoint"
              type="url"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="https://my-agent.example.com/mcp"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Rate Type
              </label>
              <select
                name="rate_type"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              >
                <option value="per_call">Per Call</option>
                <option value="per_task">Per Task</option>
                <option value="per_hour">Per Hour</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Rate (USD)
              </label>
              <input
                name="rate_amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Auth Type
            </label>
            <select
              name="auth_type"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
            >
              <option value="none">None</option>
              <option value="api_key">API Key</option>
              <option value="oauth">OAuth</option>
              <option value="mcp_token">MCP Token</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Tags (comma-separated)
            </label>
            <input
              name="tags"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="nlp, translation, coding"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Registering..." : "Register Agent"}
          </button>
        </form>
      </main>
    </div>
  );
}
