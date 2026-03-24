"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { sections as initialSections, getAvailableSections, DEFAULT_FORM_DATA } from "./buildSections";
import type { Section, SectionStatus, AgentFormData, CapabilityEntry } from "./buildSections";
import SectionDetail from "./SectionDetail";

export default function AgentBuildoutTracker() {
  const [data, setData] = useState<Section[]>(initialSections);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"guide" | "configure">("guide");
  const [formData, setFormData] = useState<AgentFormData>(DEFAULT_FORM_DATA);
  const [loaded, setLoaded] = useState(false);

  /* ── localStorage: load ── */
  useEffect(() => {
    try {
      const sf = localStorage.getItem("signalpot-buildout-form");
      if (sf) setFormData((p) => ({ ...p, ...JSON.parse(sf) }));
      const ss = localStorage.getItem("signalpot-buildout-status");
      if (ss) {
        const m = JSON.parse(ss) as Record<number, SectionStatus>;
        setData((prev) => getAvailableSections(prev.map((s) => ({ ...s, status: m[s.id] === "completed" ? "completed" : s.status }))));
      }
    } catch { /* ignore */ }
    setLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── localStorage: save form ── */
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem("signalpot-buildout-form", JSON.stringify(formData)); } catch { /* */ }
  }, [formData, loaded]);

  /* ── localStorage: save section status ── */
  useEffect(() => {
    if (!loaded) return;
    const m: Record<number, SectionStatus> = {};
    data.forEach((s) => { m[s.id] = s.status; });
    try { localStorage.setItem("signalpot-buildout-status", JSON.stringify(m)); } catch { /* */ }
  }, [data, loaded]);

  const completedCount = data.filter((s) => s.status === "completed").length;
  const progress = (completedCount / data.length) * 100;

  const configProgress = useMemo(() => {
    let filled = 0;
    const total = 16;
    if (formData.name) filled++;
    if (formData.description) filled++;
    if (formData.goal) filled++;
    if (formData.decisionLogic) filled++;
    if (formData.endpointUrl) filled++;
    if (formData.authType !== "none") filled++;
    if (formData.coreLogicChecklist.some((c) => c.checked)) filled++;
    if (formData.capabilities.length > 0) filled++;
    if (formData.observabilityNotes || formData.customMetrics) filled++;
    if (formData.rateType !== "free" || formData.freeTierEnabled) filled++;
    if (formData.errorHandlingChecklist.some((c) => c.checked)) filled++;
    if (formData.currentVersion) filled++;
    if (formData.healthEndpoint) filled++;
    if (formData.deploymentChecklist.some((c) => c.checked)) filled++;
    if (formData.testingChecklist.some((c) => c.checked)) filled++;
    if (formData.sourceUrl) filled++;
    return Math.round((filled / total) * 100);
  }, [formData]);

  const toggleComplete = useCallback((id: number) => {
    setData((prev) =>
      getAvailableSections(prev.map((s) => s.id === id ? { ...s, status: (s.status === "completed" ? "active" : "completed") as SectionStatus } : s))
    );
  }, []);

  const sel = data.find((s) => s.id === selected) || null;

  /* ── Form helpers ── */
  const updateField = useCallback(<K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => {
    setFormData((p) => ({ ...p, [key]: value }));
  }, []);

  const generateSlug = useCallback((name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64), []);

  const toggleChecklist = useCallback((field: "trustChecklist" | "coreLogicChecklist" | "errorHandlingChecklist" | "deploymentChecklist" | "testingChecklist", itemId: string) => {
    setFormData((p) => ({ ...p, [field]: (p[field] as { id: string; label: string; checked: boolean }[]).map((i) => i.id === itemId ? { ...i, checked: !i.checked } : i) }));
  }, []);

  const addCapability = useCallback(() => {
    setFormData((p) => ({ ...p, capabilities: [...p.capabilities, { id: `cap-${Date.now()}`, name: "", displayName: "", description: "" }] }));
  }, []);

  const removeCapability = useCallback((capId: string) => {
    setFormData((p) => ({ ...p, capabilities: p.capabilities.filter((c) => c.id !== capId) }));
  }, []);

  const updateCapability = useCallback((capId: string, field: keyof Omit<CapabilityEntry, "id">, value: string) => {
    setFormData((p) => ({ ...p, capabilities: p.capabilities.map((c) => c.id === capId ? { ...c, [field]: value } : c) }));
  }, []);

  const exportConfig = useCallback(() => {
    const tags = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const config = {
      name: formData.name,
      slug: formData.slug || generateSlug(formData.name),
      description: formData.description || null,
      long_description: formData.longDescription || null,
      source_url: formData.sourceUrl || null,
      goal: formData.goal || null,
      decision_logic: formData.decisionLogic || null,
      agent_type: formData.agentType,
      tags,
      communication: {
        endpoint_url: formData.endpointUrl || null,
        mcp_endpoint: formData.mcpEndpoint || null,
        transport: formData.transport,
        max_payload_kb: parseInt(formData.maxPayloadKb) || 100,
        protocols: Object.entries(formData.protocolSupport).filter(([, v]) => v).map(([k]) => k),
      },
      hiring_strategy: {
        prefer: formData.hiringStrategy,
        budget_cap_per_hire: parseFloat(formData.budgetCapPerHire) || 0.10,
      },
      auth: {
        type: formData.authType,
        min_trust_score: parseFloat(formData.minTrustScore) || 0,
        notes: formData.authNotes || null,
      },
      capabilities: formData.capabilities.filter((c) => c.name.trim()).map((c) => ({
        capability_name: c.name,
        display_name: c.displayName,
        description: c.description,
        input_schema: {},
        output_schema: {},
      })),
      io_contracts: { validation_mode: formData.validationMode, error_format: formData.errorFormat },
      observability: {
        platform_logging: formData.loggingEnabled,
        custom_metrics: formData.customMetrics ? formData.customMetrics.split(",").map((m) => m.trim()).filter(Boolean) : [],
        alert_on_error_rate: parseInt(formData.alertOnErrorRate) || 20,
        log_retention_days: parseInt(formData.logRetentionDays) || 90,
      },
      pricing: {
        model: formData.rateType,
        rate_amount: formData.rateType === "free" ? 0 : parseFloat(formData.rateAmount) || 0,
        free_tier: formData.freeTierEnabled ? { enabled: true, monthly_requests: parseInt(formData.freeTierMonthlyRequests) || 100 } : { enabled: false },
      },
      resilience: {
        retry_policy: formData.retryPolicy,
        max_retries: parseInt(formData.maxRetries) || 3,
        circuit_breaker_threshold: parseInt(formData.circuitBreakerThreshold) || 50,
      },
      deployment: {
        target: formData.deploymentTarget,
        version: formData.currentVersion || "1.0.0",
        health_endpoint: formData.healthEndpoint || "/health",
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "signalpot.config.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [formData, generateSlug]);

  const registerAgent = useCallback(() => {
    const prefill = {
      name: formData.name,
      slug: formData.slug || generateSlug(formData.name),
      description: formData.description,
      goal: formData.goal,
      decision_logic: formData.decisionLogic,
      agent_type: formData.agentType,
      mcp_endpoint: formData.endpointUrl || formData.mcpEndpoint || "",
      rate_type: formData.rateType === "free" ? "per_call" : formData.rateType,
      rate_amount: formData.rateType === "free" ? "0.001" : formData.rateAmount || "0.001",
      auth_type: formData.authType,
      tags: formData.tags,
    };
    localStorage.setItem("signalpot-register-prefill", JSON.stringify(prefill));
    window.location.href = "/agents/new";
  }, [formData, generateSlug]);

  const resetForm = useCallback(() => {
    if (window.confirm("Clear all form data? This cannot be undone.")) {
      setFormData(DEFAULT_FORM_DATA);
      localStorage.removeItem("signalpot-buildout-form");
    }
  }, []);

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-surface text-foreground p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-[0.2em] mb-2">SignalPot</p>
            <h1 className="text-2xl font-bold text-white mb-1">Build Your Agent</h1>
            <p className="text-sm text-gray-500">
              10 steps from idea to marketplace. Start with Section 1 — everything else unlocks from there.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={registerAgent}
              disabled={!formData.name || !formData.goal}
              className="px-4 py-2 text-xs font-medium uppercase tracking-wider rounded-lg transition-colors bg-cyan-400 text-gray-950 hover:bg-cyan-300 disabled:bg-[#1f2028] disabled:text-gray-600 disabled:cursor-not-allowed"
            >
              Register Agent
            </button>
            <button
              onClick={exportConfig}
              disabled={!formData.name}
              className="px-4 py-2 text-xs font-medium uppercase tracking-wider rounded-lg border border-[#1f2028] text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
            >
              Export Config
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 text-xs font-medium uppercase tracking-wider rounded-lg border border-[#1f2028] text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Progress bars */}
        <div className="grid grid-cols-2 gap-6 mt-6 max-w-md">
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-gray-500">Build</span>
              <span className="text-xs text-emerald-400 font-medium">{completedCount}/{data.length}</span>
            </div>
            <div className="h-1.5 bg-[#1f2028] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-gray-500">Config</span>
              <span className="text-xs text-cyan-400 font-medium">{configProgress}%</span>
            </div>
            <div className="h-1.5 bg-[#1f2028] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-500" style={{ width: `${configProgress}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main layout: Stepper + Detail */}
      <div className="max-w-6xl mx-auto flex gap-8">
        {/* Left: Stepper */}
        <nav className="w-64 shrink-0 hidden lg:block">
          <div className="sticky top-6">
            {data.map((s, i) => {
              const isSelected = selected === s.id;
              const isCompleted = s.status === "completed";
              const isActive = s.status === "active";
              const isLocked = s.status === "locked";

              return (
                <div key={s.id} className="flex gap-3">
                  {/* Circle + line */}
                  <div className="flex flex-col items-center">
                    <button
                      onClick={() => { setSelected(s.id); if (isLocked) setActiveTab("guide"); }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-all border-2 ${
                        isCompleted
                          ? "bg-emerald-950 border-emerald-500 text-emerald-400"
                          : isActive
                          ? isSelected
                            ? "bg-amber-950 border-amber-400 text-amber-300 ring-2 ring-amber-400/20"
                            : "bg-amber-950/50 border-amber-600 text-amber-400 hover:border-amber-400"
                          : "bg-[#111118] border-[#1f2028] text-gray-600"
                      }`}
                      title={isLocked ? `Complete ${s.deps.map((d) => `S${d}`).join(", ")} first` : undefined}
                    >
                      {isCompleted ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      ) : isLocked ? (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                      ) : s.id}
                    </button>
                    {i < data.length - 1 && (
                      <div className={`w-0.5 flex-1 min-h-[24px] ${isCompleted ? "bg-emerald-800" : "bg-[#1f2028]"}`} />
                    )}
                  </div>

                  {/* Label */}
                  <button
                    onClick={() => { setSelected(s.id); if (isLocked) setActiveTab("guide"); }}
                    className={`text-left pb-4 pt-1 transition-colors ${
                      isSelected
                        ? "text-white"
                        : isCompleted
                        ? "text-emerald-400/70 hover:text-emerald-400"
                        : isActive
                        ? "text-gray-400 hover:text-white"
                        : "text-gray-600"
                    }`}
                  >
                    <div className="text-sm font-medium leading-tight">{s.title}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{s.summary}</div>
                  </button>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Mobile: horizontal step indicator */}
        <div className="lg:hidden w-full mb-4">
          <div className="flex gap-1 overflow-x-auto pb-2">
            {data.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelected(s.id); if (s.status === "locked") setActiveTab("guide"); }}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-all border-2 ${
                  s.status === "completed"
                    ? "bg-emerald-950 border-emerald-500 text-emerald-400"
                    : s.status === "active"
                    ? selected === s.id
                      ? "bg-amber-950 border-amber-400 text-amber-300"
                      : "bg-amber-950/50 border-amber-600 text-amber-400"
                    : "bg-[#111118] border-[#1f2028] text-gray-600"
                }`}
              >
                {s.status === "completed" ? "\u2713" : s.id}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Detail panel */}
        <div className="flex-1 min-w-0">
          {sel ? (
            <div className="bg-panel border border-border rounded-xl p-6 lg:p-8">
              <SectionDetail
                section={sel}
                allSections={data}
                formData={formData}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onUpdateField={updateField}
                onToggleChecklist={toggleChecklist}
                onAddCapability={addCapability}
                onRemoveCapability={removeCapability}
                onUpdateCapability={updateCapability}
                onToggleComplete={toggleComplete}
                onSelectSection={(id) => { setSelected(id); setActiveTab("guide"); }}
                generateSlug={generateSlug}
              />
            </div>
          ) : (
            <div className="bg-panel border border-border rounded-xl p-12 text-center">
              <div className="text-4xl text-gray-700 mb-4">{"\u25c6"}</div>
              <p className="text-sm text-gray-500 mb-2">Select a section to get started</p>
              <p className="text-xs text-gray-600">
                Begin with <button onClick={() => setSelected(1)} className="text-amber-400 hover:text-amber-300 underline underline-offset-2">Section 1: Agent Identity</button> — it unlocks everything else.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
