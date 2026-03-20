"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { Badge } from "@/components/ui/badge";

interface Secret {
  name: string;
  provider: string;
  rotation_days: number;
  age_days: number;
  days_since_rotation: number;
  days_until_due: number;
  last_rotated_at: string;
  created_at: string;
  status: "healthy" | "due" | "overdue";
}

const PROVIDERS = ["openai", "stripe", "github", "anthropic", "google", "other"] as const;

export default function KeyKeeperDashboard() {
  const router = useRouter();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Onboarding form state
  const [secretName, setSecretName] = useState("");
  const [provider, setProvider] = useState<string>("openai");
  const [generating, setGenerating] = useState(false);
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Rotation state
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateResult, setRotateResult] = useState<{
    name: string;
    message: string;
    intake_url?: string;
  } | null>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/keykeeper/secrets");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setSecrets(data.secrets ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setMagicLink(null);
    setCopied(false);
    setGenerating(true);

    try {
      const res = await fetch("/api/keykeeper/intake/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret_name: secretName.trim(),
          provider,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error ?? "Failed to generate link");
        return;
      }

      setMagicLink(data.url);
    } catch {
      setFormError("Network error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRotate(name: string) {
    setRotating(name);
    setRotateResult(null);

    try {
      const res = await fetch("/api/keykeeper/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate", secret_name: name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRotateResult({ name, message: data.error ?? "Rotation failed" });
        return;
      }

      setRotateResult({
        name,
        message: data.message,
        intake_url: data.intake_url,
      });
      await fetchSecrets();
    } catch {
      setRotateResult({ name, message: "Network error" });
    } finally {
      setRotating(null);
    }
  }

  function handleCopy() {
    if (magicLink) {
      navigator.clipboard.writeText(magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function resetForm() {
    setSecretName("");
    setProvider("openai");
    setMagicLink(null);
    setFormError(null);
    setCopied(false);
    setShowAdd(false);
  }

  function statusColor(status: string) {
    if (status === "healthy") return "text-emerald-400";
    if (status === "due") return "text-yellow-400";
    return "text-red-400";
  }

  function statusBadge(status: string) {
    if (status === "healthy")
      return (
        <Badge variant="status" status="active">
          healthy
        </Badge>
      );
    if (status === "due")
      return (
        <Badge variant="status" status="pending">
          due soon
        </Badge>
      );
    return (
      <Badge variant="status" status="failed">
        overdue
      </Badge>
    );
  }

  const hasSecrets = secrets.length > 0;
  const showOnboarding = !hasSecrets && !loading;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">KeyKeeper</h1>
            <p className="text-sm text-gray-500">
              Manage your encrypted credentials
            </p>
          </div>
          {hasSecrets && (
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold"
            >
              Add New Key
            </button>
          )}
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-[#111118] border border-[#1f2028] rounded-lg animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Onboarding / Add Form */}
        {(showOnboarding || showAdd) && !loading && (
          <div className="mb-8">
            {showOnboarding && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-2">
                  Store your first credential
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Name your key, pick the provider, and we&apos;ll generate a
                  secure one-time link to paste it.
                </p>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { step: "1", label: "Name it" },
                    { step: "2", label: "Pick provider" },
                    { step: "3", label: "Paste via link" },
                  ].map((s) => (
                    <div
                      key={s.step}
                      className="p-3 bg-[#111118] border border-[#1f2028] rounded-lg text-center"
                    >
                      <div className="w-6 h-6 rounded-full bg-cyan-400/10 text-cyan-400 font-bold text-xs flex items-center justify-center mx-auto mb-1">
                        {s.step}
                      </div>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={handleGenerate}
              className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1">
                    Secret Name
                  </label>
                  <input
                    type="text"
                    value={secretName}
                    onChange={(e) => setSecretName(e.target.value)}
                    placeholder="e.g. my-openai-key"
                    required
                    className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-sm font-mono text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-700 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1">
                    Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-sm text-white focus:outline-none focus:border-cyan-700 transition-colors"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {formError && (
                <p className="text-sm text-red-400 mb-3">{formError}</p>
              )}

              {magicLink ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-400">
                    Use this one-time link to submit your key value:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-xs text-cyan-400 font-mono truncate">
                      {magicLink}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="px-3 py-2 bg-[#1f2028] hover:bg-[#2d3044] text-xs text-white rounded-lg transition-colors whitespace-nowrap"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-gray-600">
                    This link expires in 30 minutes and can only be used once.
                    POST your key value as{" "}
                    <code className="text-gray-500">
                      {`{ "value": "sk-..." }`}
                    </code>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      fetchSecrets();
                    }}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Done — refresh list
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={generating || !secretName.trim()}
                    className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
                  >
                    {generating ? "Generating..." : "Generate Magic Link"}
                  </button>
                  {showAdd && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </form>
          </div>
        )}

        {/* Secrets table */}
        {hasSecrets && !loading && (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Provider</div>
              <div className="col-span-1 text-right">Age</div>
              <div className="col-span-2 text-right">Last Rotated</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {secrets.map((s) => (
              <div
                key={s.name}
                className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
              >
                <div className="col-span-3 font-mono text-sm text-white truncate">
                  {s.name}
                </div>
                <div className="col-span-2">
                  <Badge variant="tag">{s.provider}</Badge>
                </div>
                <div className="col-span-1 text-right text-sm text-gray-400">
                  {s.age_days}d
                </div>
                <div className="col-span-2 text-right text-sm text-gray-400">
                  {s.days_since_rotation === 0
                    ? "today"
                    : `${s.days_since_rotation}d ago`}
                </div>
                <div className="col-span-2 text-center">
                  {statusBadge(s.status)}
                </div>
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => handleRotate(s.name)}
                    disabled={rotating === s.name}
                    className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                      s.status === "overdue"
                        ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                        : "border-[#2d3044] text-gray-400 hover:text-white hover:bg-[#1f2028]"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {rotating === s.name ? "..." : "Rotate"}
                  </button>
                </div>

                {/* Rotation result inline */}
                {rotateResult?.name === s.name && (
                  <div className="col-span-12 mt-2 p-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg">
                    <p className="text-sm text-gray-300">
                      {rotateResult.message}
                    </p>
                    {rotateResult.intake_url && (
                      <div className="mt-2">
                        <code className="text-xs text-cyan-400 font-mono break-all">
                          {rotateResult.intake_url}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              rotateResult.intake_url!
                            );
                          }}
                          className="ml-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Summary */}
            <div className="flex items-center gap-4 pt-4 text-xs text-gray-600">
              <span>{secrets.length} secrets stored</span>
              <span className="text-emerald-400">
                {secrets.filter((s) => s.status === "healthy").length} healthy
              </span>
              {secrets.filter((s) => s.status === "due").length > 0 && (
                <span className="text-yellow-400">
                  {secrets.filter((s) => s.status === "due").length} due soon
                </span>
              )}
              {secrets.filter((s) => s.status === "overdue").length > 0 && (
                <span className="text-red-400">
                  {secrets.filter((s) => s.status === "overdue").length} overdue
                </span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
