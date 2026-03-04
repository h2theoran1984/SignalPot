"use client";

import { useState, useEffect, useCallback } from "react";

interface CapabilitySpec {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  examples?: Array<{ input: unknown; output: unknown }>;
}

interface AgentPlaygroundProps {
  agentSlug: string;
  capabilities: CapabilitySpec[];
  rateAmount: number;
}

interface ProxyResponse {
  job_id: string;
  status: string;
  output: Record<string, unknown>;
  verified: boolean;
  duration_ms: number;
  cost: number;
}

function isStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname.endsWith(".stripe.com") || u.hostname === "stripe.com")
    );
  } catch {
    return false;
  }
}

export default function AgentPlayground({
  agentSlug,
  capabilities,
  rateAmount,
}: AgentPlaygroundProps) {
  const [selectedCapability, setSelectedCapability] = useState(
    capabilities[0]?.name ?? ""
  );
  const [inputJson, setInputJson] = useState("{}");
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [buyingCredits, setBuyingCredits] = useState(false);

  const isPaid = rateAmount > 0;
  const needsCredits = isPaid && !sessionToken;

  // Pre-populate input from capability examples
  useEffect(() => {
    const cap = capabilities.find((c) => c.name === selectedCapability);
    if (cap?.examples?.[0]?.input) {
      setInputJson(JSON.stringify(cap.examples[0].input, null, 2));
    } else {
      setInputJson("{}");
    }
  }, [selectedCapability, capabilities]);

  // Check for returning from Stripe + restore session from localStorage
  const fetchSessionToken = useCallback(
    async (checkoutSessionId: string) => {
      try {
        const res = await fetch(
          `/api/proxy/credits/${checkoutSessionId}`
        );
        const data = await res.json();
        if (data.session_token) {
          setSessionToken(data.session_token);
          setCreditBalance(data.credit_balance_millicents);
          localStorage.setItem(
            "sp_anon_session",
            JSON.stringify(data)
          );
        }
      } catch {
        // Silent fail — user can try buying credits again
      }
    },
    []
  );

  useEffect(() => {
    // Check URL for Stripe redirect
    const params = new URLSearchParams(window.location.search);
    const stripeSessionId = params.get("session_id");
    if (stripeSessionId && params.get("anon_credits") === "success") {
      fetchSessionToken(stripeSessionId);
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete("session_id");
      url.searchParams.delete("anon_credits");
      window.history.replaceState({}, "", url.toString());
    }

    // Restore from localStorage
    const stored = localStorage.getItem("sp_anon_session");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (new Date(parsed.expires_at) > new Date()) {
          setSessionToken(parsed.session_token);
          setCreditBalance(parsed.credit_balance_millicents);
        } else {
          localStorage.removeItem("sp_anon_session");
        }
      } catch {
        localStorage.removeItem("sp_anon_session");
      }
    }
  }, [fetchSessionToken]);

  async function handleBuyCredits() {
    setBuyingCredits(true);
    try {
      const res = await fetch("/api/proxy/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: 5 }),
      });
      const data = await res.json();
      if (data.url && isStripeUrl(data.url)) {
        window.location.href = data.url;
      } else {
        setError("Failed to create checkout session");
      }
    } catch {
      setError("Failed to connect to payment service");
    } finally {
      setBuyingCredits(false);
    }
  }

  async function handleTryIt() {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      let parsedInput: Record<string, unknown>;
      try {
        parsedInput = JSON.parse(inputJson);
      } catch {
        setError("Invalid JSON input — check your syntax");
        return;
      }

      const idempotencyKey = `${agentSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const res = await fetch(`/api/proxy/${agentSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: selectedCapability,
          input: parsedInput,
          session_token: sessionToken ?? undefined,
          idempotency_key: idempotencyKey,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          setError(
            data.error ?? "Credits required — purchase credits to use this agent"
          );
        } else if (res.status === 429) {
          setError("Rate limit reached — please wait a moment and try again");
        } else if (res.status === 502) {
          setError(data.error ?? "Agent is currently unreachable");
        } else {
          setError(data.error ?? `Request failed (${res.status})`);
        }
      } else {
        setResponse(data as ProxyResponse);
        // Update local balance display
        if (sessionToken && rateAmount > 0) {
          const newBalance =
            (creditBalance ?? 0) - Math.floor(rateAmount * 100_000);
          setCreditBalance(Math.max(0, newBalance));
          // Update localStorage
          const stored = localStorage.getItem("sp_anon_session");
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              parsed.credit_balance_millicents = Math.max(0, newBalance);
              localStorage.setItem(
                "sp_anon_session",
                JSON.stringify(parsed)
              );
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  const balanceDisplay =
    creditBalance !== null
      ? `$${(creditBalance / 100_000).toFixed(3)}`
      : null;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">Try It</h2>
      <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 uppercase tracking-widest">
              Playground
            </span>
            {isPaid && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">
                ${rateAmount}/call
              </span>
            )}
            {!isPaid && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                Free
              </span>
            )}
          </div>
          {sessionToken && balanceDisplay && (
            <span className="text-xs font-mono text-gray-400">
              Balance: {balanceDisplay}
            </span>
          )}
        </div>

        {/* Capability selector */}
        {capabilities.length > 1 && (
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">
              Capability
            </label>
            <select
              value={selectedCapability}
              onChange={(e) => setSelectedCapability(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-cyan-400/50"
            >
              {capabilities.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {capabilities.length === 1 && (
          <div className="text-sm font-mono text-cyan-400">
            {capabilities[0].name}
          </div>
        )}

        {/* Input */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-widest mb-1.5">
            Input (JSON)
          </label>
          <textarea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            rows={5}
            className="w-full bg-[#0a0a0f] border border-[#27272a] rounded-lg px-3 py-2 text-sm text-gray-200 font-mono resize-y focus:outline-none focus:border-cyan-400/50"
            placeholder='{"text": "Hello world..."}'
            spellCheck={false}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {needsCredits ? (
            <button
              onClick={handleBuyCredits}
              disabled={buyingCredits}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {buyingCredits ? "Redirecting to Stripe..." : "Buy $5 Credits"}
            </button>
          ) : (
            <button
              onClick={handleTryIt}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Calling agent...
                </span>
              ) : (
                "Try It"
              )}
            </button>
          )}

          {needsCredits && (
            <span className="text-xs text-gray-500">
              This agent costs ${rateAmount}/call — credits expire in 24h
            </span>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Response display */}
        {response && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 uppercase tracking-widest">
                Response
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#0a0a0f] text-gray-400 border border-[#27272a]">
                {response.duration_ms}ms
              </span>
              {response.verified ? (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                  verified
                </span>
              ) : (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                  unverified
                </span>
              )}
              {response.cost > 0 && (
                <span className="text-xs font-mono text-gray-500">
                  cost: ${response.cost}
                </span>
              )}
            </div>
            <pre className="p-3 bg-[#0a0a0f] border border-[#27272a] rounded-lg text-sm text-gray-300 font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(response.output, null, 2)}
            </pre>
            <p className="text-xs text-gray-600 font-mono">
              job_id: {response.job_id}
            </p>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-2 border-t border-[#1f2028]">
          <p className="text-xs text-gray-600">
            Anonymous proxy — 10 requests/min •{" "}
            {isPaid ? "$5/day cap • 24h session" : "No account needed"} •{" "}
            <a
              href="/docs#guides"
              className="text-cyan-400/60 hover:text-cyan-400 transition-colors"
            >
              Build your own agent →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
