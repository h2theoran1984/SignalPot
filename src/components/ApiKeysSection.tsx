"use client";

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_rpm: number;
  last_used_at: string | null;
  created_at: string;
  revoked: boolean;
}

export default function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    const res = await fetch("/api/keys");
    const data = await res.json();
    setKeys(data.keys ?? []);
    setLoading(false);
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim(), scopes: ["agents:read", "agents:write", "jobs:read", "jobs:write"] }),
    });
    const data = await res.json();
    if (res.ok) {
      setRevealedKey(data.key);
      setNewKeyName("");
      fetchKeys();
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    fetchKeys();
  }

  function copyKey() {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">API Keys</h2>

      {/* Revealed key banner — shown once */}
      {revealedKey && (
        <div className="mb-4 p-4 bg-cyan-950 border border-cyan-700 rounded-lg">
          <p className="text-xs text-cyan-400 mb-2 font-medium uppercase tracking-widest">
            New key — copy it now, it won&apos;t be shown again
          </p>
          <div className="flex flex-col gap-2">
            <code className="w-full text-sm font-mono text-cyan-300 break-all bg-[#0a0a0f] px-3 py-2 rounded select-all">
              {revealedKey}
            </code>
            <button
              onClick={copyKey}
              className="w-full px-3 py-2 text-sm bg-cyan-400 text-gray-950 rounded font-semibold hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              {copied ? "✓ Copied to clipboard!" : "Copy Key"}
            </button>
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="mt-2 text-xs text-cyan-600 hover:text-cyan-400 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Existing keys */}
      {loading ? (
        <div className="h-10 bg-[#1f2028] rounded animate-pulse mb-3" />
      ) : keys.length === 0 ? (
        <p className="text-gray-500 text-sm mb-4">No API keys yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded-lg"
            >
              <div>
                <span className="text-sm font-medium">{k.name}</span>
                <span className="ml-2 text-xs font-mono text-gray-500">
                  {k.key_prefix}...
                </span>
                {k.last_used_at && (
                  <span className="ml-2 text-xs text-gray-600">
                    last used {new Date(k.last_used_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                onClick={() => revokeKey(k.id)}
                className="text-xs text-red-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create new key */}
      <form onSubmit={createKey} className="flex gap-2">
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name (e.g. seed-script, my-agent)"
          className="flex-1 px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors"
        />
        <button
          type="submit"
          disabled={creating || !newKeyName.trim()}
          className="px-4 py-2 bg-cyan-400 text-gray-950 text-sm font-semibold rounded-lg hover:bg-cyan-300 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {creating ? "Generating..." : "Generate Key"}
        </button>
      </form>
    </div>
  );
}
