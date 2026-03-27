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

type Tab = "sources" | "taxonomy" | "datasets" | "analysis";

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
    { key: "analysis", label: "Analysis" },
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
        {/* TAB 4: ANALYSIS                                                   */}
        {/* ================================================================= */}
        {activeTab === "analysis" && (
          <div>
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm mb-8">
                Select a validated dataset to begin analysis
              </p>

              <div className="grid grid-cols-3 gap-4">
                {[
                  {
                    step: "1",
                    title: "Validate",
                    desc: "Run Sentinel to check data quality",
                  },
                  {
                    step: "2",
                    title: "Investigate",
                    desc: "Run Pathfinder on flagged anomalies",
                  },
                  {
                    step: "3",
                    title: "Compile",
                    desc: "Generate presentation-ready output with Brief",
                  },
                ].map((card) => (
                  <div
                    key={card.step}
                    className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg text-center"
                  >
                    <div className="w-8 h-8 rounded-full bg-cyan-400/10 text-cyan-400 font-bold text-sm flex items-center justify-center mx-auto mb-3">
                      {card.step}
                    </div>
                    <p className="text-sm font-medium text-white mb-1">
                      {card.title}
                    </p>
                    <p className="text-xs text-gray-500">{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
