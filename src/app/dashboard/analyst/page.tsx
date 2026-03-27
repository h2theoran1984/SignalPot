"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Source {
  id: string;
  name: string;
  slug: string;
  description: string;
  format_type: string;
  active: boolean;
  created_at: string;
}

interface Dimension {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface Entity {
  id: string;
  canonical_name: string;
  dimension_id: string;
  parent_entity_id: string | null;
  alias_count?: number;
  metadata?: Record<string, unknown>;
}

interface Dataset {
  id: string;
  name: string;
  source_id: string;
  source_name?: string;
  period: string;
  row_count: number;
  status: "pending" | "normalizing" | "validated" | "ready" | "error";
  uploaded_at: string;
}

interface ValidationRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  dimension_id: string | null;
  config: Record<string, unknown>;
  severity: "error" | "warning" | "info";
  active: boolean;
  created_at: string;
}

interface ValidationRun {
  run_id: string;
  status: string;
  rules_applied: number;
  total_findings: number;
  errors: number;
  warnings: number;
  infos: number;
  started_at: string;
  completed_at: string | null;
}

interface AnomalyItem {
  id: string;
  metric: string;
  value: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
  direction: "high" | "low";
  severity: "error" | "warning" | "info";
  context: Record<string, unknown>;
  explanation: string | null;
  status: string;
  created_at: string;
}

interface DrillGroup {
  entity_id: string;
  entity_name: string | null;
  record_count: number;
  metrics: Record<string, { sum: number; avg: number; min: number; max: number; count: number }>;
}

interface CompileTemplate {
  id: string;
  name: string;
  description: string | null;
  output_type: string;
  params: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

type Tab = "sources" | "taxonomy" | "datasets" | "validation" | "analysis" | "compile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function datasetStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="status" status="pending">
          pending
        </Badge>
      );
    case "normalizing":
      return (
        <Badge variant="status" status="running">
          normalizing
        </Badge>
      );
    case "validated":
      return (
        <Badge variant="status" status="active">
          validated
        </Badge>
      );
    case "ready":
      return (
        <Badge variant="trust">ready</Badge>
      );
    case "error":
      return (
        <Badge variant="status" status="failed">
          error
        </Badge>
      );
    default:
      return <Badge variant="tag">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetectStats({ result }: { result: Record<string, unknown> }) {
  const stats = result.stats as Record<string, number> | undefined;
  return (
    <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg mb-6">
      <div className="grid grid-cols-4 gap-4 text-center">
        <div>
          <p className="text-xl font-bold text-white">{String(stats?.count ?? 0)}</p>
          <p className="text-xs text-gray-500">Data Points</p>
        </div>
        <div>
          <p className="text-xl font-bold text-gray-300">{Number(stats?.mean ?? 0).toFixed(2)}</p>
          <p className="text-xs text-gray-500">Mean</p>
        </div>
        <div>
          <p className="text-xl font-bold text-gray-300">{Number(stats?.stddev ?? 0).toFixed(2)}</p>
          <p className="text-xs text-gray-500">Std Dev</p>
        </div>
        <div>
          <p className="text-xl font-bold text-orange-400">{String(stats?.anomaly_count ?? 0)}</p>
          <p className="text-xs text-gray-500">Anomalies Found</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalystSuiteDashboard() {
  const router = useRouter();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("sources");

  // Sources state
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceSlug, setSourceSlug] = useState("");
  const [sourceDesc, setSourceDesc] = useState("");
  const [sourceFormat, setSourceFormat] = useState("csv");
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [sourceSubmitting, setSourceSubmitting] = useState(false);

  // Taxonomy state
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [dimensionsLoading, setDimensionsLoading] = useState(false);
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [showAddDimension, setShowAddDimension] = useState(false);
  const [dimName, setDimName] = useState("");
  const [dimSlug, setDimSlug] = useState("");
  const [dimDesc, setDimDesc] = useState("");
  const [dimFormError, setDimFormError] = useState<string | null>(null);
  const [dimSubmitting, setDimSubmitting] = useState(false);
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [entityParent, setEntityParent] = useState("");
  const [entityFormError, setEntityFormError] = useState<string | null>(null);
  const [entitySubmitting, setEntitySubmitting] = useState(false);

  // Datasets state
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [showImportDataset, setShowImportDataset] = useState(false);
  const [dsSourceId, setDsSourceId] = useState("");
  const [dsName, setDsName] = useState("");
  const [dsPeriod, setDsPeriod] = useState("");
  const [dsFormError, setDsFormError] = useState<string | null>(null);
  const [dsSubmitting, setDsSubmitting] = useState(false);

  // Validation state
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleDesc, setRuleDesc] = useState("");
  const [ruleType, setRuleType] = useState("required_field");
  const [ruleSeverity, setRuleSeverity] = useState("warning");
  const [ruleConfig, setRuleConfig] = useState("{}");
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [ruleSubmitting, setRuleSubmitting] = useState(false);
  const [validationRuns, setValidationRuns] = useState<ValidationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runDatasetId, setRunDatasetId] = useState("");
  const [runningValidation, setRunningValidation] = useState(false);
  const [runResult, setRunResult] = useState<Record<string, unknown> | null>(null);

  // Investigation state
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [investigateDatasetId, setInvestigateDatasetId] = useState("");
  const [investigateMetric, setInvestigateMetric] = useState("");
  const [investigateThreshold, setInvestigateThreshold] = useState("2");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<Record<string, unknown> | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [drillDatasetId, setDrillDatasetId] = useState("");
  const [drillDimensionId, setDrillDimensionId] = useState("");
  const [drilling, setDrilling] = useState(false);
  const [drillResult, setDrillResult] = useState<DrillGroup[] | null>(null);

  // Compile state
  const [templates, setTemplates] = useState<CompileTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplType, setTplType] = useState("report");
  const [tplParams, setTplParams] = useState("{}");
  const [tplFormError, setTplFormError] = useState<string | null>(null);
  const [tplSubmitting, setTplSubmitting] = useState(false);
  const [compileType, setCompileType] = useState("report");
  const [compileDatasetId, setCompileDatasetId] = useState("");
  const [compileTitle, setCompileTitle] = useState("");
  const [compileTemplateId, setCompileTemplateId] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<Record<string, unknown> | null>(null);

  // ---------------------------------------------------------------------------
  // Fetchers
  // ---------------------------------------------------------------------------

  const fetchSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await fetch("/api/analyst/sources");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch {
      // ignore
    } finally {
      setSourcesLoading(false);
    }
  }, [router]);

  const fetchDimensions = useCallback(async () => {
    setDimensionsLoading(true);
    try {
      const res = await fetch("/api/analyst/dimensions");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setDimensions(data.dimensions ?? []);
    } catch {
      // ignore
    } finally {
      setDimensionsLoading(false);
    }
  }, [router]);

  const fetchEntities = useCallback(async (dimensionId: string) => {
    setEntitiesLoading(true);
    try {
      const res = await fetch(`/api/analyst/entities?dimension_id=${dimensionId}`);
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setEntities(data.entities ?? []);
    } catch {
      // ignore
    } finally {
      setEntitiesLoading(false);
    }
  }, [router]);

  const fetchDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    try {
      const res = await fetch("/api/analyst/datasets");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setDatasets(data.datasets ?? []);
    } catch {
      // ignore
    } finally {
      setDatasetsLoading(false);
    }
  }, [router]);

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await fetch("/api/analyst/validation-rules");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch {
      // ignore
    } finally {
      setRulesLoading(false);
    }
  }, [router]);

  // ---------------------------------------------------------------------------
  // Effects — fetch when tab becomes active
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (activeTab === "sources") fetchSources();
  }, [activeTab, fetchSources]);

  useEffect(() => {
    if (activeTab === "taxonomy") fetchDimensions();
  }, [activeTab, fetchDimensions]);

  useEffect(() => {
    if (activeTab === "datasets") {
      fetchDatasets();
      // Also fetch sources for the import form dropdown
      fetchSources();
    }
  }, [activeTab, fetchDatasets, fetchSources]);

  useEffect(() => {
    if (selectedDimension) fetchEntities(selectedDimension);
  }, [selectedDimension, fetchEntities]);

  useEffect(() => {
    if (activeTab === "validation") {
      fetchRules();
      fetchDatasets();
    }
  }, [activeTab, fetchRules, fetchDatasets]);

  useEffect(() => {
    if (activeTab === "analysis") {
      fetchDatasets();
      fetchDimensions();
    }
  }, [activeTab, fetchDatasets, fetchDimensions]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/analyst/templates");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      // ignore
    } finally {
      setTemplatesLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (activeTab === "compile") {
      fetchTemplates();
      fetchDatasets();
    }
  }, [activeTab, fetchTemplates, fetchDatasets]);

  // ---------------------------------------------------------------------------
  // Source form handlers
  // ---------------------------------------------------------------------------

  function handleSourceNameChange(val: string) {
    setSourceName(val);
    setSourceSlug(toSlug(val));
  }

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    setSourceFormError(null);
    setSourceSubmitting(true);
    try {
      const res = await fetch("/api/analyst/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sourceName.trim(),
          slug: sourceSlug,
          description: sourceDesc.trim(),
          format_type: sourceFormat,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSourceFormError(data.error ?? "Failed to create source"); return; }
      setSourceName(""); setSourceSlug(""); setSourceDesc(""); setSourceFormat("csv");
      setShowAddSource(false);
      await fetchSources();
    } catch {
      setSourceFormError("Network error");
    } finally {
      setSourceSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Dimension form handlers
  // ---------------------------------------------------------------------------

  function handleDimNameChange(val: string) {
    setDimName(val);
    setDimSlug(toSlug(val));
  }

  async function handleAddDimension(e: React.FormEvent) {
    e.preventDefault();
    setDimFormError(null);
    setDimSubmitting(true);
    try {
      const res = await fetch("/api/analyst/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dimName.trim(),
          slug: dimSlug,
          description: dimDesc.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setDimFormError(data.error ?? "Failed to create dimension"); return; }
      setDimName(""); setDimSlug(""); setDimDesc("");
      setShowAddDimension(false);
      await fetchDimensions();
    } catch {
      setDimFormError("Network error");
    } finally {
      setDimSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Entity form handlers
  // ---------------------------------------------------------------------------

  async function handleAddEntity(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDimension) return;
    setEntityFormError(null);
    setEntitySubmitting(true);
    try {
      const res = await fetch("/api/analyst/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_name: entityName.trim(),
          dimension_id: selectedDimension,
          parent_entity_id: entityParent || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setEntityFormError(data.error ?? "Failed to create entity"); return; }
      setEntityName(""); setEntityParent("");
      setShowAddEntity(false);
      await fetchEntities(selectedDimension);
    } catch {
      setEntityFormError("Network error");
    } finally {
      setEntitySubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Dataset form handlers
  // ---------------------------------------------------------------------------

  async function handleImportDataset(e: React.FormEvent) {
    e.preventDefault();
    setDsFormError(null);
    setDsSubmitting(true);
    try {
      const res = await fetch("/api/analyst/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: dsSourceId,
          name: dsName.trim(),
          period: dsPeriod.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setDsFormError(data.error ?? "Failed to import dataset"); return; }
      setDsSourceId(""); setDsName(""); setDsPeriod("");
      setShowImportDataset(false);
      await fetchDatasets();
    } catch {
      setDsFormError("Network error");
    } finally {
      setDsSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Validation rule form handlers
  // ---------------------------------------------------------------------------

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    setRuleFormError(null);
    setRuleSubmitting(true);

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(ruleConfig);
    } catch {
      setRuleFormError("Invalid JSON in config field");
      setRuleSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/analyst/validation-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName.trim(),
          description: ruleDesc.trim() || null,
          rule_type: ruleType,
          severity: ruleSeverity,
          config: parsedConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRuleFormError(data.error ?? "Failed to create rule"); return; }
      setRuleName(""); setRuleDesc(""); setRuleType("required_field"); setRuleSeverity("warning"); setRuleConfig("{}");
      setShowAddRule(false);
      await fetchRules();
    } catch {
      setRuleFormError("Network error");
    } finally {
      setRuleSubmitting(false);
    }
  }

  async function handleToggleRule(ruleId: string, active: boolean) {
    await fetch("/api/analyst/validation-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ruleId, active }),
    });
    await fetchRules();
  }

  async function handleDeleteRule(ruleId: string) {
    await fetch(`/api/analyst/validation-rules?id=${ruleId}`, {
      method: "DELETE",
    });
    await fetchRules();
  }

  async function handleRunValidation() {
    if (!runDatasetId) return;
    setRunningValidation(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/analyst/validation-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: runDatasetId }),
      });
      const data = await res.json();
      if (res.ok) {
        setRunResult(data);
        // Refresh run history
        await fetchRunHistory(runDatasetId);
      } else {
        setRunResult({ error: data.error ?? "Validation run failed" });
      }
    } catch {
      setRunResult({ error: "Network error" });
    } finally {
      setRunningValidation(false);
    }
  }

  async function fetchRunHistory(datasetId: string) {
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/analyst/validation-run?dataset_id=${datasetId}`);
      if (res.ok) {
        const data = await res.json();
        setValidationRuns(data.history ?? []);
      }
    } catch {
      // ignore
    } finally {
      setRunsLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Compile handlers
  // ---------------------------------------------------------------------------

  async function handleAddTemplate(e: React.FormEvent) {
    e.preventDefault();
    setTplFormError(null);
    setTplSubmitting(true);

    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = JSON.parse(tplParams);
    } catch {
      setTplFormError("Invalid JSON in params field");
      setTplSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/analyst/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tplName.trim(),
          description: tplDesc.trim() || null,
          output_type: tplType,
          params: parsedParams,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setTplFormError(data.error ?? "Failed to create template"); return; }
      setTplName(""); setTplDesc(""); setTplType("report"); setTplParams("{}");
      setShowAddTemplate(false);
      await fetchTemplates();
    } catch {
      setTplFormError("Network error");
    } finally {
      setTplSubmitting(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    await fetch(`/api/analyst/templates?id=${id}`, { method: "DELETE" });
    await fetchTemplates();
  }

  async function handleCompile() {
    if (!compileDatasetId) return;
    setCompiling(true);
    setCompileResult(null);

    const payload: Record<string, unknown> = {
      output_type: compileType,
      template_id: compileTemplateId || undefined,
    };

    if (compileType === "report" || compileType === "slide") {
      payload.dataset_ids = [compileDatasetId];
      payload.title = compileTitle || "Untitled";
    } else {
      payload.dataset_id = compileDatasetId;
    }

    // For table/chart, provide minimal defaults
    if (compileType === "table") {
      payload.dimensions = [];
      payload.metrics = ["value"];
    } else if (compileType === "chart") {
      payload.chart_type = "bar";
      payload.x = "period";
      payload.y = "value";
    }

    try {
      const res = await fetch("/api/analyst/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setCompileResult(data);
    } catch {
      setCompileResult({ error: "Network error" });
    } finally {
      setCompiling(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Investigation handlers
  // ---------------------------------------------------------------------------

  async function handleDetectAnomalies() {
    if (!investigateDatasetId || !investigateMetric) return;
    setDetecting(true);
    setDetectResult(null);
    try {
      const res = await fetch("/api/analyst/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect",
          dataset_id: investigateDatasetId,
          metric: investigateMetric,
          threshold: Number(investigateThreshold) || 2,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDetectResult(data);
        setAnomalies(data.anomalies ?? []);
      } else {
        setDetectResult({ error: data.error ?? "Detection failed" });
      }
    } catch {
      setDetectResult({ error: "Network error" });
    } finally {
      setDetecting(false);
    }
  }

  async function handleExplain(anomalyId: string) {
    setExplaining(anomalyId);
    try {
      const res = await fetch("/api/analyst/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "explain", anomaly_id: anomalyId }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnomalies((prev) =>
          prev.map((a) =>
            a.id === anomalyId ? { ...a, explanation: data.explanation } : a
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setExplaining(null);
    }
  }

  async function handleDrill() {
    if (!drillDatasetId || !drillDimensionId) return;
    setDrilling(true);
    setDrillResult(null);
    try {
      const res = await fetch("/api/analyst/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "drill",
          dataset_id: drillDatasetId,
          dimension_id: drillDimensionId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDrillResult(data.groups ?? []);
      }
    } catch {
      // ignore
    } finally {
      setDrilling(false);
    }
  }

  async function handleUpdateAnomalyStatus(anomalyId: string, status: string) {
    await fetch("/api/analyst/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", anomaly_id: anomalyId, status }),
    });
    setAnomalies((prev) =>
      prev.map((a) => (a.id === anomalyId ? { ...a, status } : a))
    );
  }

  // ---------------------------------------------------------------------------
  // Skeleton loader
  // ---------------------------------------------------------------------------

  function Skeleton({ count = 3 }: { count?: number }) {
    return (
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="h-16 bg-[#111118] border border-[#1f2028] rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Input style constants
  // ---------------------------------------------------------------------------

  const inputCls =
    "w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-700 transition-colors";
  const labelCls = "block text-xs text-gray-500 uppercase tracking-widest mb-1";
  const btnPrimary =
    "px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold";
  const btnCancel = "text-xs text-gray-500 hover:text-gray-300 transition-colors";

  // ---------------------------------------------------------------------------
  // Tab definitions
  // ---------------------------------------------------------------------------

  const tabs: { key: Tab; label: string }[] = [
    { key: "sources", label: "Sources" },
    { key: "taxonomy", label: "Taxonomy" },
    { key: "datasets", label: "Datasets" },
    { key: "validation", label: "Validation" },
    { key: "analysis", label: "Analysis" },
    { key: "compile", label: "Compile" },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Analyst Suite</h1>
          <p className="text-sm text-gray-500">
            Multi-source data normalization &amp; analysis
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-6 border-b border-[#1f2028]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? "text-white border-cyan-400"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SOURCES                                                    */}
        {/* ================================================================= */}
        {activeTab === "sources" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Data Sources</h2>
              <button
                onClick={() => setShowAddSource(!showAddSource)}
                className={btnPrimary}
              >
                Add Source
              </button>
            </div>

            {/* Add source form */}
            {showAddSource && (
              <form
                onSubmit={handleAddSource}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      type="text"
                      value={sourceName}
                      onChange={(e) => handleSourceNameChange(e.target.value)}
                      placeholder="e.g. Bloomberg Terminal"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Slug</label>
                    <input
                      type="text"
                      value={sourceSlug}
                      readOnly
                      className={inputCls + " text-gray-500"}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      type="text"
                      value={sourceDesc}
                      onChange={(e) => setSourceDesc(e.target.value)}
                      placeholder="Brief description"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Format Type</label>
                    <select
                      value={sourceFormat}
                      onChange={(e) => setSourceFormat(e.target.value)}
                      className={inputCls}
                    >
                      <option value="csv">CSV</option>
                      <option value="xlsx">XLSX</option>
                      <option value="json">JSON</option>
                      <option value="api">API</option>
                    </select>
                  </div>
                </div>

                {sourceFormError && (
                  <p className="text-sm text-red-400 mb-3">{sourceFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={sourceSubmitting || !sourceName.trim()}
                    className={btnPrimary}
                  >
                    {sourceSubmitting ? "Creating..." : "Create Source"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSource(false);
                      setSourceFormError(null);
                    }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {sourcesLoading && <Skeleton />}

            {!sourcesLoading && sources.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-sm">
                No sources configured yet. Add your first data source above.
              </div>
            )}

            {!sourcesLoading && sources.length > 0 && (
              <div className="space-y-2">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
                  <div className="col-span-4">Name</div>
                  <div className="col-span-2">Format</div>
                  <div className="col-span-2 text-center">Status</div>
                  <div className="col-span-4 text-right">Created</div>
                </div>

                {sources.map((s) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                  >
                    <div className="col-span-4 font-mono text-sm text-white truncate">
                      {s.name}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="tag">{s.format_type}</Badge>
                    </div>
                    <div className="col-span-2 text-center">
                      <Badge variant="status" status={s.active ? "active" : "inactive"}>
                        {s.active ? "active" : "inactive"}
                      </Badge>
                    </div>
                    <div className="col-span-4 text-right text-sm text-gray-400">
                      {new Date(s.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}

                <div className="pt-4 text-xs text-gray-600">
                  {sources.length} source{sources.length !== 1 ? "s" : ""} configured
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: TAXONOMY                                                   */}
        {/* ================================================================= */}
        {activeTab === "taxonomy" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Taxonomy</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddDimension(!showAddDimension)}
                  className={btnPrimary}
                >
                  Add Dimension
                </button>
                {selectedDimension && (
                  <button
                    onClick={() => setShowAddEntity(!showAddEntity)}
                    className={btnPrimary}
                  >
                    Add Entity
                  </button>
                )}
              </div>
            </div>

            {/* Add dimension form */}
            {showAddDimension && (
              <form
                onSubmit={handleAddDimension}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      type="text"
                      value={dimName}
                      onChange={(e) => handleDimNameChange(e.target.value)}
                      placeholder="e.g. Asset Class"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Slug</label>
                    <input
                      type="text"
                      value={dimSlug}
                      readOnly
                      className={inputCls + " text-gray-500"}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      type="text"
                      value={dimDesc}
                      onChange={(e) => setDimDesc(e.target.value)}
                      placeholder="Brief description"
                      className={inputCls}
                    />
                  </div>
                </div>

                {dimFormError && (
                  <p className="text-sm text-red-400 mb-3">{dimFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={dimSubmitting || !dimName.trim()}
                    className={btnPrimary}
                  >
                    {dimSubmitting ? "Creating..." : "Create Dimension"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDimension(false);
                      setDimFormError(null);
                    }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Add entity form */}
            {showAddEntity && selectedDimension && (
              <form
                onSubmit={handleAddEntity}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Canonical Name</label>
                    <input
                      type="text"
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      placeholder="e.g. United States"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Parent Entity (optional)</label>
                    <select
                      value={entityParent}
                      onChange={(e) => setEntityParent(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">None</option>
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.canonical_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {entityFormError && (
                  <p className="text-sm text-red-400 mb-3">{entityFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={entitySubmitting || !entityName.trim()}
                    className={btnPrimary}
                  >
                    {entitySubmitting ? "Creating..." : "Create Entity"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddEntity(false);
                      setEntityFormError(null);
                    }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {dimensionsLoading && <Skeleton />}

            {!dimensionsLoading && (
              <div className="grid grid-cols-12 gap-4">
                {/* Left column: dimensions list */}
                <div className="col-span-4 space-y-2">
                  {dimensions.length === 0 && (
                    <div className="text-center py-8 text-gray-600 text-sm">
                      No dimensions yet.
                    </div>
                  )}
                  {dimensions.map((dim) => (
                    <button
                      key={dim.id}
                      onClick={() => setSelectedDimension(dim.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedDimension === dim.id
                          ? "bg-cyan-400/10 border-cyan-400/30 text-cyan-400"
                          : "bg-[#111118] border-[#1f2028] text-white hover:border-[#2d3044]"
                      }`}
                    >
                      <p className="text-sm font-medium">{dim.name}</p>
                      {dim.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {dim.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>

                {/* Right column: entities for selected dimension */}
                <div className="col-span-8">
                  {!selectedDimension && (
                    <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
                      Select a dimension to view its entities
                    </div>
                  )}

                  {selectedDimension && entitiesLoading && <Skeleton count={2} />}

                  {selectedDimension && !entitiesLoading && entities.length === 0 && (
                    <div className="flex items-center justify-center h-40 text-gray-600 text-sm">
                      No entities in this dimension yet.
                    </div>
                  )}

                  {selectedDimension && !entitiesLoading && entities.length > 0 && (
                    <div className="space-y-2">
                      {entities.map((ent) => (
                        <div
                          key={ent.id}
                          className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-white">
                              {ent.canonical_name}
                            </p>
                            {ent.alias_count !== undefined && ent.alias_count > 0 && (
                              <Badge variant="tag">
                                {ent.alias_count} alias{ent.alias_count !== 1 ? "es" : ""}
                              </Badge>
                            )}
                          </div>
                          {ent.metadata && Object.keys(ent.metadata).length > 0 && (
                            <p className="text-xs text-gray-600 mt-1 font-mono truncate">
                              {JSON.stringify(ent.metadata).slice(0, 80)}
                              {JSON.stringify(ent.metadata).length > 80 ? "..." : ""}
                            </p>
                          )}
                        </div>
                      ))}

                      <div className="pt-2 text-xs text-gray-600">
                        {entities.length} entit{entities.length !== 1 ? "ies" : "y"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: DATASETS                                                   */}
        {/* ================================================================= */}
        {activeTab === "datasets" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Datasets</h2>
              <button
                onClick={() => setShowImportDataset(!showImportDataset)}
                className={btnPrimary}
              >
                Import Dataset
              </button>
            </div>

            {/* Import dataset form */}
            {showImportDataset && (
              <form
                onSubmit={handleImportDataset}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Source</label>
                    <select
                      value={dsSourceId}
                      onChange={(e) => setDsSourceId(e.target.value)}
                      required
                      className={inputCls}
                    >
                      <option value="">Select a source...</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Dataset Name</label>
                    <input
                      type="text"
                      value={dsName}
                      onChange={(e) => setDsName(e.target.value)}
                      placeholder="e.g. Q4 2025 Revenue"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Period</label>
                    <input
                      type="text"
                      value={dsPeriod}
                      onChange={(e) => setDsPeriod(e.target.value)}
                      placeholder="e.g. 2025-Q4"
                      required
                      className={inputCls}
                    />
                  </div>
                </div>

                {dsFormError && (
                  <p className="text-sm text-red-400 mb-3">{dsFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={dsSubmitting || !dsSourceId || !dsName.trim() || !dsPeriod.trim()}
                    className={btnPrimary}
                  >
                    {dsSubmitting ? "Importing..." : "Import Dataset"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportDataset(false);
                      setDsFormError(null);
                    }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {datasetsLoading && <Skeleton />}

            {!datasetsLoading && datasets.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-sm">
                No datasets imported yet. Import your first dataset above.
              </div>
            )}

            {!datasetsLoading && datasets.length > 0 && (
              <div className="space-y-2">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
                  <div className="col-span-3">Name</div>
                  <div className="col-span-2">Source</div>
                  <div className="col-span-1 text-center">Period</div>
                  <div className="col-span-1 text-right">Rows</div>
                  <div className="col-span-2 text-center">Status</div>
                  <div className="col-span-3 text-right">Uploaded</div>
                </div>

                {datasets.map((ds) => (
                  <div
                    key={ds.id}
                    className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                  >
                    <div className="col-span-3 font-mono text-sm text-white truncate">
                      {ds.name}
                    </div>
                    <div className="col-span-2 text-sm text-gray-400 truncate">
                      {ds.source_name ?? "—"}
                    </div>
                    <div className="col-span-1 text-center text-sm text-gray-400">
                      {ds.period}
                    </div>
                    <div className="col-span-1 text-right text-sm text-gray-400">
                      {ds.row_count?.toLocaleString() ?? "—"}
                    </div>
                    <div className="col-span-2 text-center">
                      {datasetStatusBadge(ds.status)}
                    </div>
                    <div className="col-span-3 text-right text-sm text-gray-400">
                      {new Date(ds.uploaded_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}

                <div className="pt-4 text-xs text-gray-600">
                  {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: VALIDATION                                                 */}
        {/* ================================================================= */}
        {activeTab === "validation" && (
          <div>
            {/* --- Rules Section --- */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Validation Rules</h2>
              <button
                onClick={() => setShowAddRule(!showAddRule)}
                className={btnPrimary}
              >
                Add Rule
              </button>
            </div>

            {/* Add rule form */}
            {showAddRule && (
              <form
                onSubmit={handleAddRule}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Rule Name</label>
                    <input
                      type="text"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      placeholder="e.g. Market share must be positive"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      type="text"
                      value={ruleDesc}
                      onChange={(e) => setRuleDesc(e.target.value)}
                      placeholder="Brief description"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Rule Type</label>
                    <select
                      value={ruleType}
                      onChange={(e) => setRuleType(e.target.value)}
                      className={inputCls}
                    >
                      <option value="required_field">Required Field</option>
                      <option value="range_check">Range Check</option>
                      <option value="cross_source">Cross-Source</option>
                      <option value="trend_deviation">Trend Deviation</option>
                      <option value="custom">Custom Expression</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Severity</label>
                    <select
                      value={ruleSeverity}
                      onChange={(e) => setRuleSeverity(e.target.value)}
                      className={inputCls}
                    >
                      <option value="error">Error</option>
                      <option value="warning">Warning</option>
                      <option value="info">Info</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Config (JSON)</label>
                    <textarea
                      value={ruleConfig}
                      onChange={(e) => setRuleConfig(e.target.value)}
                      placeholder='e.g. {"fields": ["unit_share", "volume"]}'
                      rows={3}
                      className={inputCls + " font-mono text-xs"}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      {ruleType === "required_field" && 'Required: {"fields": ["field1", "field2"]}'}
                      {ruleType === "range_check" && 'Required: {"field": "metric_name", "min": 0, "max": 100}'}
                      {ruleType === "cross_source" && 'Required: {"compare_dataset_id": "uuid", "match_key": "field", "compare_field": "field", "tolerance_pct": 5}'}
                      {ruleType === "trend_deviation" && 'Required: {"metric": "field_name", "std_dev_threshold": 2}'}
                      {ruleType === "custom" && 'Required: {"expression": "field > 100"}'}
                    </p>
                  </div>
                </div>

                {ruleFormError && (
                  <p className="text-sm text-red-400 mb-3">{ruleFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={ruleSubmitting || !ruleName.trim()}
                    className={btnPrimary}
                  >
                    {ruleSubmitting ? "Creating..." : "Create Rule"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddRule(false);
                      setRuleFormError(null);
                    }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {rulesLoading && <Skeleton />}

            {!rulesLoading && rules.length === 0 && (
              <div className="text-center py-8 text-gray-600 text-sm">
                No validation rules configured yet. Add your first rule above.
              </div>
            )}

            {!rulesLoading && rules.length > 0 && (
              <div className="space-y-2 mb-8">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
                  <div className="col-span-3">Name</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2 text-center">Severity</div>
                  <div className="col-span-2 text-center">Status</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>

                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                  >
                    <div className="col-span-3">
                      <p className="font-mono text-sm text-white truncate">{rule.name}</p>
                      {rule.description && (
                        <p className="text-xs text-gray-500 truncate">{rule.description}</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="tag">{rule.rule_type.replace("_", " ")}</Badge>
                    </div>
                    <div className="col-span-2 text-center">
                      <Badge
                        variant="status"
                        status={
                          rule.severity === "error" ? "failed" :
                          rule.severity === "warning" ? "pending" : "active"
                        }
                      >
                        {rule.severity}
                      </Badge>
                    </div>
                    <div className="col-span-2 text-center">
                      <Badge variant="status" status={rule.active ? "active" : "inactive"}>
                        {rule.active ? "active" : "disabled"}
                      </Badge>
                    </div>
                    <div className="col-span-3 flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggleRule(rule.id, !rule.active)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {rule.active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-2 text-xs text-gray-600">
                  {rules.length} rule{rules.length !== 1 ? "s" : ""} configured
                  ({rules.filter((r) => r.active).length} active)
                </div>
              </div>
            )}

            {/* --- Run Validation Section --- */}
            <div className="border-t border-[#1f2028] pt-6 mt-6">
              <h2 className="text-lg font-semibold mb-4">Run Validation</h2>

              <div className="flex items-end gap-4 mb-6">
                <div className="flex-1">
                  <label className={labelCls}>Dataset</label>
                  <select
                    value={runDatasetId}
                    onChange={(e) => {
                      setRunDatasetId(e.target.value);
                      setRunResult(null);
                      if (e.target.value) fetchRunHistory(e.target.value);
                    }}
                    className={inputCls}
                  >
                    <option value="">Select a dataset...</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.period})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleRunValidation}
                  disabled={!runDatasetId || runningValidation || rules.filter((r) => r.active).length === 0}
                  className={btnPrimary}
                >
                  {runningValidation ? "Running..." : "Run Sentinel"}
                </button>
              </div>

              {/* Run result */}
              {runResult && (
                <div className={`p-5 rounded-lg border mb-6 ${
                  (runResult as Record<string, unknown>).error
                    ? "bg-red-950/20 border-red-800/30"
                    : "bg-[#111118] border-[#1f2028]"
                }`}>
                  {(runResult as Record<string, unknown>).error ? (
                    <p className="text-sm text-red-400">
                      {String((runResult as Record<string, unknown>).error)}
                    </p>
                  ) : (
                    <div>
                      <div className="flex items-center gap-4 mb-4">
                        <h3 className="text-sm font-semibold text-white">Validation Complete</h3>
                        <Badge variant="status" status="active">
                          {String((runResult as Record<string, unknown>).status)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-4 mb-4">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-white">
                            {String((runResult as Record<string, unknown>).rules_applied ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">Rules Applied</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-red-400">
                            {String((runResult as Record<string, unknown>).errors ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">Errors</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-yellow-400">
                            {String((runResult as Record<string, unknown>).warnings ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">Warnings</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-400">
                            {String((runResult as Record<string, unknown>).infos ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">Info</p>
                        </div>
                      </div>

                      {/* Findings list */}
                      {Array.isArray((runResult as Record<string, unknown>).findings) &&
                        ((runResult as Record<string, unknown>).findings as Array<Record<string, unknown>>).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Findings</p>
                          {((runResult as Record<string, unknown>).findings as Array<Record<string, unknown>>).map((f, i) => (
                            <div
                              key={i}
                              className={`p-3 rounded border text-sm ${
                                f.severity === "error"
                                  ? "border-red-800/30 bg-red-950/10 text-red-300"
                                  : f.severity === "warning"
                                  ? "border-yellow-800/30 bg-yellow-950/10 text-yellow-300"
                                  : "border-blue-800/30 bg-blue-950/10 text-blue-300"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="status" status={
                                  f.severity === "error" ? "failed" :
                                  f.severity === "warning" ? "pending" : "active"
                                }>
                                  {String(f.severity)}
                                </Badge>
                                <span className="font-mono text-xs text-gray-400">{String(f.rule_name)}</span>
                              </div>
                              <p>{String(f.message)}</p>
                              {Array.isArray(f.record_ids) && f.record_ids.length > 0 && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Affects {f.record_ids.length} record{f.record_ids.length !== 1 ? "s" : ""}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {Array.isArray((runResult as Record<string, unknown>).findings) &&
                        ((runResult as Record<string, unknown>).findings as unknown[]).length === 0 && (
                        <p className="text-sm text-green-400">
                          All checks passed — no issues found.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Run history */}
              {runDatasetId && !runsLoading && validationRuns.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-white mb-3">Run History</h3>
                  <div className="space-y-2">
                    {validationRuns.map((run) => (
                      <div
                        key={run.run_id}
                        className="grid grid-cols-12 gap-2 items-center p-3 bg-[#111118] border border-[#1f2028] rounded-lg text-sm"
                      >
                        <div className="col-span-2">
                          <Badge variant="status" status={
                            run.status === "completed" ? "active" :
                            run.status === "failed" ? "failed" : "running"
                          }>
                            {run.status}
                          </Badge>
                        </div>
                        <div className="col-span-2 text-gray-400 text-center">
                          {run.rules_applied} rules
                        </div>
                        <div className="col-span-2 text-center">
                          <span className="text-red-400">{run.errors}E</span>
                          {" / "}
                          <span className="text-yellow-400">{run.warnings}W</span>
                          {" / "}
                          <span className="text-blue-400">{run.infos}I</span>
                        </div>
                        <div className="col-span-2 text-gray-400 text-center">
                          {run.total_findings} findings
                        </div>
                        <div className="col-span-4 text-right text-gray-500">
                          {new Date(run.started_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {runDatasetId && runsLoading && <Skeleton count={2} />}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 5: ANALYSIS                                                   */}
        {/* ================================================================= */}
        {activeTab === "analysis" && (
          <div>
            {/* --- Anomaly Detection --- */}
            <h2 className="text-lg font-semibold mb-4">Anomaly Detection</h2>

            <div className="flex items-end gap-4 mb-6">
              <div className="flex-1">
                <label className={labelCls}>Dataset</label>
                <select
                  value={investigateDatasetId}
                  onChange={(e) => setInvestigateDatasetId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a dataset...</option>
                  {datasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.period})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-48">
                <label className={labelCls}>Metric</label>
                <input
                  type="text"
                  value={investigateMetric}
                  onChange={(e) => setInvestigateMetric(e.target.value)}
                  placeholder="e.g. unit_share"
                  className={inputCls}
                />
              </div>
              <div className="w-24">
                <label className={labelCls}>Threshold</label>
                <input
                  type="number"
                  value={investigateThreshold}
                  onChange={(e) => setInvestigateThreshold(e.target.value)}
                  step="0.5"
                  min="1"
                  className={inputCls}
                />
              </div>
              <button
                onClick={handleDetectAnomalies}
                disabled={!investigateDatasetId || !investigateMetric || detecting}
                className={btnPrimary}
              >
                {detecting ? "Scanning..." : "Detect"}
              </button>
            </div>

            {/* Detection stats */}
            {detectResult && !detectResult.error && (
              <DetectStats result={detectResult} />
            )}

            {detectResult && "error" in detectResult && detectResult.error != null && (
              <p className="text-sm text-red-400 mb-6">
                {String(detectResult.error)}
              </p>
            )}

            {/* Anomalies list */}
            {anomalies.length > 0 && (
              <div className="space-y-2 mb-8">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
                  Detected Anomalies
                </p>
                {anomalies.map((a) => (
                  <div
                    key={a.id}
                    className={`p-4 rounded-lg border ${
                      a.severity === "error"
                        ? "border-red-800/30 bg-red-950/10"
                        : a.severity === "warning"
                        ? "border-yellow-800/30 bg-yellow-950/10"
                        : "border-blue-800/30 bg-blue-950/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="status" status={
                          a.severity === "error" ? "failed" :
                          a.severity === "warning" ? "pending" : "active"
                        }>
                          {a.severity}
                        </Badge>
                        <span className="text-sm font-mono text-white">
                          {a.metric} = {a.value}
                        </span>
                        <span className="text-xs text-gray-500">
                          (z={Number(a.z_score).toFixed(2)}, {a.direction})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="tag">{a.status}</Badge>
                        {a.status === "open" && (
                          <>
                            <button
                              onClick={() => handleUpdateAnomalyStatus(a.id, "acknowledged")}
                              className="text-xs text-gray-500 hover:text-gray-300"
                            >
                              Acknowledge
                            </button>
                            <button
                              onClick={() => handleUpdateAnomalyStatus(a.id, "false_positive")}
                              className="text-xs text-gray-500 hover:text-gray-300"
                            >
                              False Positive
                            </button>
                          </>
                        )}
                        {!a.explanation && (
                          <button
                            onClick={() => handleExplain(a.id)}
                            disabled={explaining === a.id}
                            className={btnPrimary + " text-xs !px-2 !py-1"}
                          >
                            {explaining === a.id ? "Analyzing..." : "Explain"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">
                      Expected: {Number(a.expected_mean).toFixed(2)} +/- {Number(a.expected_stddev).toFixed(2)}
                    </div>
                    {a.explanation && (
                      <div className="mt-3 p-3 bg-[#0a0a0f] rounded border border-[#1f2028] text-sm text-gray-300 whitespace-pre-wrap">
                        {a.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* --- Dimension Drill-Down --- */}
            <div className="border-t border-[#1f2028] pt-6 mt-6">
              <h2 className="text-lg font-semibold mb-4">Dimension Drill-Down</h2>

              <div className="flex items-end gap-4 mb-6">
                <div className="flex-1">
                  <label className={labelCls}>Dataset</label>
                  <select
                    value={drillDatasetId}
                    onChange={(e) => setDrillDatasetId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select a dataset...</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.period})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Dimension</label>
                  <select
                    value={drillDimensionId}
                    onChange={(e) => setDrillDimensionId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select a dimension...</option>
                    {dimensions.map((dim) => (
                      <option key={dim.id} value={dim.id}>
                        {dim.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleDrill}
                  disabled={!drillDatasetId || !drillDimensionId || drilling}
                  className={btnPrimary}
                >
                  {drilling ? "Drilling..." : "Drill Down"}
                </button>
              </div>

              {/* Drill results */}
              {drillResult && drillResult.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
                    <div className="col-span-4">Entity</div>
                    <div className="col-span-2 text-right">Records</div>
                    <div className="col-span-6 text-right">Metrics (avg)</div>
                  </div>
                  {drillResult.map((group) => (
                    <div
                      key={group.entity_id}
                      className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
                    >
                      <div className="col-span-4 font-mono text-sm text-white truncate">
                        {group.entity_name ?? group.entity_id.slice(0, 8)}
                      </div>
                      <div className="col-span-2 text-right text-sm text-gray-400">
                        {group.record_count}
                      </div>
                      <div className="col-span-6 text-right">
                        <div className="flex flex-wrap gap-2 justify-end">
                          {Object.entries(group.metrics).slice(0, 4).map(([key, m]) => (
                            <span key={key} className="text-xs text-gray-400">
                              <span className="text-gray-600">{key}:</span>{" "}
                              {m.avg.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 text-xs text-gray-600">
                    {drillResult.length} group{drillResult.length !== 1 ? "s" : ""}
                  </div>
                </div>
              )}

              {drillResult && drillResult.length === 0 && (
                <p className="text-sm text-gray-600">
                  No records found for this dimension in the selected dataset.
                </p>
              )}
            </div>
          </div>
        )}
        {/* ================================================================= */}
        {/* TAB 6: COMPILE                                                    */}
        {/* ================================================================= */}
        {activeTab === "compile" && (
          <div>
            {/* --- Templates Section --- */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Output Templates</h2>
              <button
                onClick={() => setShowAddTemplate(!showAddTemplate)}
                className={btnPrimary}
              >
                New Template
              </button>
            </div>

            {/* Add template form */}
            {showAddTemplate && (
              <form
                onSubmit={handleAddTemplate}
                className="mb-6 p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>Template Name</label>
                    <input
                      type="text"
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="e.g. Q1 Market Share Report"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <input
                      type="text"
                      value={tplDesc}
                      onChange={(e) => setTplDesc(e.target.value)}
                      placeholder="Brief description"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Output Type</label>
                    <select
                      value={tplType}
                      onChange={(e) => setTplType(e.target.value)}
                      className={inputCls}
                    >
                      <option value="report">Report</option>
                      <option value="slide">Slide Deck</option>
                      <option value="table">Table</option>
                      <option value="chart">Chart</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Params (JSON)</label>
                    <textarea
                      value={tplParams}
                      onChange={(e) => setTplParams(e.target.value)}
                      rows={5}
                      className={inputCls + " font-mono text-xs"}
                      placeholder={
                        tplType === "report"
                          ? '{\n  "sections": ["executive_summary", "metrics", "breakdown"],\n  "metrics": ["unit_share", "growth_rate"],\n  "group_by": "brand"\n}'
                          : tplType === "slide"
                          ? '{\n  "slides": [\n    {"type": "title"},\n    {"type": "kpi_grid", "metrics": ["unit_share"]},\n    {"type": "chart", "chart_type": "bar", "metric": "unit_share", "group_by": "brand"}\n  ]\n}'
                          : tplType === "table"
                          ? '{\n  "dimensions": ["brand", "region"],\n  "metrics": ["unit_share", "volume"],\n  "sort_by": "unit_share",\n  "top_n": 20,\n  "include_totals": true\n}'
                          : '{\n  "chart_type": "bar",\n  "x": "brand",\n  "y": "unit_share",\n  "group_by": "region",\n  "top_n": 10\n}'
                      }
                    />
                  </div>
                </div>

                {tplFormError && (
                  <p className="text-sm text-red-400 mb-3">{tplFormError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={tplSubmitting || !tplName.trim()}
                    className={btnPrimary}
                  >
                    {tplSubmitting ? "Creating..." : "Create Template"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddTemplate(false); setTplFormError(null); }}
                    className={btnCancel}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {templatesLoading && <Skeleton />}

            {!templatesLoading && templates.length === 0 && (
              <div className="text-center py-8 text-gray-600 text-sm">
                No templates yet. Create your first output template above.
              </div>
            )}

            {!templatesLoading && templates.length > 0 && (
              <div className="space-y-2 mb-8">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
                  <div className="col-span-4">Name</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-3">Description</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>

                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="grid grid-cols-12 gap-2 items-center p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                  >
                    <div className="col-span-4 font-mono text-sm text-white truncate">
                      {tpl.name}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="tag">{tpl.output_type}</Badge>
                    </div>
                    <div className="col-span-3 text-sm text-gray-500 truncate">
                      {tpl.description ?? "—"}
                    </div>
                    <div className="col-span-3 flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setCompileTemplateId(tpl.id);
                          setCompileType(tpl.output_type);
                        }}
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-2 text-xs text-gray-600">
                  {templates.length} template{templates.length !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {/* --- Run Compile Section --- */}
            <div className="border-t border-[#1f2028] pt-6 mt-6">
              <h2 className="text-lg font-semibold mb-4">Run Compilation</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className={labelCls}>Output Type</label>
                  <select
                    value={compileType}
                    onChange={(e) => { setCompileType(e.target.value); setCompileTemplateId(""); }}
                    className={inputCls}
                  >
                    <option value="report">Report</option>
                    <option value="slide">Slide Deck</option>
                    <option value="table">Table</option>
                    <option value="chart">Chart</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Dataset</label>
                  <select
                    value={compileDatasetId}
                    onChange={(e) => setCompileDatasetId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select a dataset...</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.period})
                      </option>
                    ))}
                  </select>
                </div>
                {(compileType === "report" || compileType === "slide") && (
                  <div>
                    <label className={labelCls}>Title</label>
                    <input
                      type="text"
                      value={compileTitle}
                      onChange={(e) => setCompileTitle(e.target.value)}
                      placeholder="e.g. Q1 2026 Market Overview"
                      className={inputCls}
                    />
                  </div>
                )}
                <div>
                  <label className={labelCls}>Template (optional)</label>
                  <select
                    value={compileTemplateId}
                    onChange={(e) => setCompileTemplateId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">No template (defaults)</option>
                    {templates
                      .filter((t) => t.output_type === compileType)
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleCompile}
                disabled={!compileDatasetId || compiling}
                className={btnPrimary + " mb-6"}
              >
                {compiling ? "Compiling..." : "Run Brief"}
              </button>

              {/* Compile result */}
              {compileResult && (
                <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg">
                  {"error" in compileResult && compileResult.error != null ? (
                    <p className="text-sm text-red-400">{String(compileResult.error)}</p>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="status" status="active">compiled</Badge>
                        <span className="text-xs text-gray-500">
                          {String((compileResult as Record<string, unknown>).generated_at ?? "")}
                        </span>
                      </div>
                      <pre className="text-xs text-gray-300 bg-[#0a0a0f] p-4 rounded border border-[#1f2028] overflow-auto max-h-96 font-mono whitespace-pre-wrap">
                        {JSON.stringify(compileResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
