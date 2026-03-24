"use client";

import { useCallback, useMemo } from "react";
import type { Section, AgentFormData, ChecklistItem, CapabilityEntry } from "./buildSections";

/* ── Props ── */

interface SectionDetailProps {
  section: Section;
  allSections: Section[];
  formData: AgentFormData;
  activeTab: "guide" | "configure";
  onTabChange: (tab: "guide" | "configure") => void;
  onUpdateField: <K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => void;
  onToggleChecklist: (field: "trustChecklist" | "coreLogicChecklist" | "errorHandlingChecklist" | "deploymentChecklist" | "testingChecklist", itemId: string) => void;
  onAddCapability: () => void;
  onRemoveCapability: (id: string) => void;
  onUpdateCapability: (id: string, field: keyof Omit<CapabilityEntry, "id">, value: string) => void;
  onToggleComplete: (id: number) => void;
  onSelectSection: (id: number) => void;
  generateSlug: (name: string) => string;
}

/* ── Lightweight markdown renderer ── */

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Process inline: **bold**, *italic*, `code`, [links](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={key++} className="text-gray-200 font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++} className="text-gray-500 italic">{match[4]}</em>);
    } else if (match[5]) {
      parts.push(<code key={key++} className="bg-[#1a1a22] text-cyan-400 px-1.5 py-0.5 rounded text-xs font-mono">{match[6]}</code>);
    } else if (match[7]) {
      parts.push(<span key={key++} className="text-cyan-400">{match[8]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function SimpleMarkdown({ content }: { content: string }) {
  const elements = useMemo(() => {
    const lines = content.split("\n");
    const result: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.startsWith("```")) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        result.push(
          <pre key={key++} className="mb-3 overflow-x-auto">
            <code className="block bg-[#0a0a0f] text-gray-300 p-4 rounded-lg text-xs font-mono overflow-x-auto border border-[#1f2028] whitespace-pre">
              {codeLines.join("\n")}
            </code>
          </pre>
        );
        continue;
      }

      // Table
      if (line.includes("|") && line.trim().startsWith("|")) {
        const tableRows: string[] = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
          tableRows.push(lines[i]);
          i++;
        }
        // Filter out separator rows (|---|---|)
        const dataRows = tableRows.filter((r) => !r.match(/^\|[\s-:|]+\|$/));
        if (dataRows.length > 0) {
          const headerCells = dataRows[0].split("|").filter((c) => c.trim());
          const bodyRows = dataRows.slice(1);
          result.push(
            <div key={key++} className="overflow-x-auto mb-3">
              <table className="w-full text-sm border-collapse">
                <thead className="border-b border-[#1f2028]">
                  <tr>
                    {headerCells.map((cell, ci) => (
                      <th key={ci} className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2">{cell.trim()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.split("|").filter((c) => c.trim()).map((cell, ci) => (
                        <td key={ci} className="text-sm text-gray-400 px-3 py-2 border-b border-[#1f2028]/50">{renderInline(cell.trim())}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        continue;
      }

      // Headings
      if (line.startsWith("## ")) {
        result.push(<h2 key={key++} className="text-base font-semibold text-gray-200 mt-6 mb-3 pb-2 border-b border-[#1f2028]">{line.slice(3)}</h2>);
        i++; continue;
      }
      if (line.startsWith("### ")) {
        result.push(<h3 key={key++} className="text-sm font-semibold text-gray-300 mt-4 mb-2">{line.slice(4)}</h3>);
        i++; continue;
      }

      // Unordered list
      if (line.match(/^[-*] /)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^[-*] /)) {
          items.push(lines[i].replace(/^[-*] /, ""));
          i++;
        }
        result.push(
          <ul key={key++} className="text-sm text-gray-400 space-y-1 mb-3 ml-4 list-disc">
            {items.map((item, ii) => <li key={ii} className="leading-relaxed">{renderInline(item)}</li>)}
          </ul>
        );
        continue;
      }

      // Ordered list
      if (line.match(/^\d+\. /)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^\d+\. /)) {
          items.push(lines[i].replace(/^\d+\. /, ""));
          i++;
        }
        result.push(
          <ol key={key++} className="text-sm text-gray-400 space-y-1 mb-3 ml-4 list-decimal">
            {items.map((item, ii) => <li key={ii} className="leading-relaxed">{renderInline(item)}</li>)}
          </ol>
        );
        continue;
      }

      // Empty line
      if (line.trim() === "") { i++; continue; }

      // Paragraph (collect consecutive non-empty lines)
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].match(/^[-*] /) && !lines[i].match(/^\d+\. /) && !(lines[i].includes("|") && lines[i].trim().startsWith("|"))) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        result.push(<p key={key++} className="text-sm text-gray-400 leading-relaxed mb-3">{renderInline(paraLines.join(" "))}</p>);
      }
    }

    return result;
  }, [content]);

  return <div>{elements}</div>;
}

/* ── Shared form field components ── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{children}</label>;
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function TextInput({ value, onChange, placeholder, maxLength, type = "text", min, max, step }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; type?: string; min?: string; max?: string; step?: string;
}) {
  return (
    <input
      type={type} value={value} placeholder={placeholder} maxLength={maxLength} min={min} max={max} step={step}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; maxLength?: number;
}) {
  return (
    <textarea
      value={value} placeholder={placeholder} rows={rows} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors resize-y min-h-[60px]"
    />
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-sm text-white focus:outline-none focus:border-cyan-700 transition-colors cursor-pointer appearance-none"
    >
      {children}
    </select>
  );
}

function Checkbox({ checked, onChange, children, strikethrough = false }: {
  checked: boolean; onChange: () => void; children: React.ReactNode; strikethrough?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm cursor-pointer mb-2 group">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-cyan-400" />
      <span className={`transition-colors ${checked && strikethrough ? "line-through text-emerald-400" : "text-gray-400 group-hover:text-gray-300"}`}>
        {children}
      </span>
    </label>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0f] rounded-lg p-4 border border-[#1f2028] mb-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

/* ── Validation helpers ── */

function getMissingFields(sectionId: number, formData: AgentFormData): string[] {
  if (sectionId === 1) {
    const missing: string[] = [];
    if (!formData.name.trim()) missing.push("Agent Name");
    if (!formData.goal.trim()) missing.push("Goal");
    return missing;
  }
  return [];
}

/* ── Main component ── */

export default function SectionDetail({
  section, allSections, formData, activeTab, onTabChange,
  onUpdateField, onToggleChecklist, onAddCapability, onRemoveCapability, onUpdateCapability,
  onToggleComplete, onSelectSection, generateSlug,
}: SectionDetailProps) {

  const isLocked = section.status === "locked";
  const missingFields = getMissingFields(section.id, formData);
  const canComplete = missingFields.length === 0;

  /* ── Locked state ── */
  if (isLocked) {
    const depSections = section.deps.map((d) => allSections.find((s) => s.id === d)).filter(Boolean) as Section[];
    return (
      <div className="animate-in fade-in duration-200">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl text-gray-600">{section.icon}</span>
          <div>
            <h2 className="text-lg font-semibold text-gray-500">{section.title}</h2>
            <p className="text-xs text-gray-600">{section.subtitle}</p>
          </div>
        </div>
        <div className="bg-[#0a0a0f] rounded-lg p-4 border border-[#1f2028]">
          <div className="text-sm text-gray-500 mb-3">This section is locked. Complete these first:</div>
          <div className="space-y-2">
            {depSections.map((dep) => (
              <button
                key={dep.id}
                onClick={() => dep.status !== "locked" ? onSelectSection(dep.id) : undefined}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  dep.status === "completed"
                    ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                    : dep.status === "active"
                    ? "bg-[#111118] border-[#1f2028] text-amber-400 hover:border-amber-800 cursor-pointer"
                    : "bg-[#111118] border-[#1f2028] text-gray-600 cursor-default"
                }`}
              >
                <span className="text-lg">{dep.icon}</span>
                <span className="text-sm font-medium flex-1">{dep.title}</span>
                <span className={`text-xs uppercase tracking-wider ${
                  dep.status === "completed" ? "text-emerald-500" : dep.status === "active" ? "text-amber-500" : "text-gray-600"
                }`}>
                  {dep.status === "completed" ? "Done" : dep.status === "active" ? "Ready" : "Locked"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Tab content ── */

  const hasChecklist = [3, 4, 8, 9, 10].includes(section.id);

  const renderGuide = () => (
    <div className="prose-custom">
      <SimpleMarkdown content={section.prompt} />
    </div>
  );

  const renderConfigure = () => {
    switch (section.id) {
      case 1: return <Section1Form formData={formData} onUpdateField={onUpdateField} generateSlug={generateSlug} />;
      case 2: return <Section2Form formData={formData} onUpdateField={onUpdateField} />;
      case 3: return <Section3Form formData={formData} onUpdateField={onUpdateField} onToggleChecklist={onToggleChecklist} />;
      case 4: return <Section4Form formData={formData} onUpdateField={onUpdateField} onToggleChecklist={onToggleChecklist} />;
      case 5: return <Section5Form formData={formData} onUpdateField={onUpdateField} onAddCapability={onAddCapability} onRemoveCapability={onRemoveCapability} onUpdateCapability={onUpdateCapability} />;
      case 6: return <Section6Form formData={formData} onUpdateField={onUpdateField} />;
      case 7: return <Section7Form formData={formData} onUpdateField={onUpdateField} />;
      case 8: return <Section8Form formData={formData} onUpdateField={onUpdateField} onToggleChecklist={onToggleChecklist} />;
      case 9: return <Section9Form formData={formData} onUpdateField={onUpdateField} onToggleChecklist={onToggleChecklist} />;
      case 10: return <Section10Form formData={formData} onUpdateField={onUpdateField} onToggleChecklist={onToggleChecklist} />;
      default: return null;
    }
  };

  return (
    <div className="animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <span className={`text-2xl ${section.status === "completed" ? "text-emerald-400" : "text-amber-400"}`}>{section.icon}</span>
        <div className="flex-1">
          <h2 className={`text-lg font-semibold ${section.status === "completed" ? "text-emerald-400" : "text-gray-200"}`}>{section.title}</h2>
          <p className="text-xs text-gray-500">{section.subtitle}</p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
          section.classification === "REQUIRED"
            ? "bg-red-950/30 text-red-400 border-red-900/50"
            : section.classification === "DEVELOPER OWNED"
            ? "bg-blue-950/30 text-blue-400 border-blue-900/50"
            : "bg-amber-950/30 text-amber-400 border-amber-900/50"
        }`}>
          {section.classification}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-5 leading-relaxed">{section.description}</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-[#0a0a0f] rounded-lg p-1 border border-[#1f2028]">
        {(["guide", "configure"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-[#1f2028] text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "guide" ? "Guide" : "Configure"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mb-5">
        {activeTab === "guide" ? renderGuide() : renderConfigure()}
      </div>

      {/* Mark Complete */}
      <button
        onClick={() => onToggleComplete(section.id)}
        disabled={section.status !== "completed" && !canComplete}
        className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${
          section.status === "completed"
            ? "bg-[#111118] border border-emerald-900/50 text-emerald-400 hover:bg-emerald-950/20 cursor-pointer"
            : canComplete
            ? "bg-amber-950/20 border border-amber-800/50 text-amber-400 hover:bg-amber-950/30 cursor-pointer"
            : "bg-[#111118] border border-[#1f2028] text-gray-600 cursor-not-allowed"
        }`}
      >
        {section.status === "completed" ? "Reopen Section" : "Mark Complete"}
      </button>
      {!canComplete && section.status !== "completed" && missingFields.length > 0 && (
        <p className="text-xs text-gray-600 mt-2 text-center">
          Fill in required fields first: {missingFields.join(", ")}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Per-section form components
   ══════════════════════════════════════════════════════════ */

type FormProps = {
  formData: AgentFormData;
  onUpdateField: <K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => void;
};

type ChecklistFormProps = FormProps & {
  onToggleChecklist: (field: "trustChecklist" | "coreLogicChecklist" | "errorHandlingChecklist" | "deploymentChecklist" | "testingChecklist", itemId: string) => void;
};

function Section1Form({ formData, onUpdateField, generateSlug }: FormProps & { generateSlug: (name: string) => string }) {
  return (
    <FormSection title="Agent Config">
      <FieldGroup>
        <FieldLabel>Agent Name *</FieldLabel>
        <TextInput
          value={formData.name} placeholder="My AI Agent" maxLength={200}
          onChange={(v) => {
            onUpdateField("name", v);
            if (!formData.slug || formData.slug === generateSlug(formData.name)) onUpdateField("slug", generateSlug(v));
          }}
        />
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Slug</FieldLabel>
        <TextInput
          value={formData.slug} placeholder="my-ai-agent" maxLength={64}
          onChange={(v) => onUpdateField("slug", v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
        />
        <p className="text-xs text-gray-600 mt-1">signalpot.dev/agents/{formData.slug || "your-slug"}</p>
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Description (max 280)</FieldLabel>
        <TextArea value={formData.description} placeholder="What does your agent do?" rows={2} maxLength={280} onChange={(v) => onUpdateField("description", v)} />
        <p className="text-xs text-gray-600 mt-1 text-right">{formData.description.length}/280</p>
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Goal *</FieldLabel>
        <TextArea value={formData.goal} placeholder="What objective does this agent pursue?" rows={3} maxLength={500} onChange={(v) => onUpdateField("goal", v)} />
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Decision Logic</FieldLabel>
        <TextArea value={formData.decisionLogic} placeholder="How does it decide what to do?" rows={3} maxLength={2000} onChange={(v) => onUpdateField("decisionLogic", v)} />
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Agent Type</FieldLabel>
        <Select value={formData.agentType} onChange={(v) => onUpdateField("agentType", v as AgentFormData["agentType"])}>
          <option value="autonomous">Autonomous</option>
          <option value="reactive">Reactive</option>
          <option value="hybrid">Hybrid</option>
        </Select>
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Source URL (GitHub repo)</FieldLabel>
        <TextInput value={formData.sourceUrl} placeholder="https://github.com/you/your-agent" onChange={(v) => onUpdateField("sourceUrl", v)} />
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Long Description (Markdown)</FieldLabel>
        <TextArea value={formData.longDescription} placeholder="Detailed explanation of your agent..." rows={4} onChange={(v) => onUpdateField("longDescription", v)} />
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Tags (comma-separated)</FieldLabel>
        <TextInput value={formData.tags} placeholder="nlp, monitoring, reports" onChange={(v) => onUpdateField("tags", v)} />
        {formData.tags && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {formData.tags.split(",").map((t) => t.trim()).filter(Boolean).map((tag, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded bg-amber-950/30 text-amber-400 border border-amber-900/30">{tag}</span>
            ))}
          </div>
        )}
      </FieldGroup>
    </FormSection>
  );
}

function Section2Form({ formData, onUpdateField }: FormProps) {
  return (
    <FormSection title="Interface Config">
      <FieldGroup>
        <FieldLabel>Endpoint URL</FieldLabel>
        <TextInput value={formData.endpointUrl} placeholder="https://my-agent.example.com" onChange={(v) => onUpdateField("endpointUrl", v)} />
        {formData.endpointUrl && formData.slug && (
          <p className="text-xs text-cyan-400 mt-1">MCP: {formData.endpointUrl}/mcp</p>
        )}
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>MCP Endpoint (override)</FieldLabel>
        <TextInput value={formData.mcpEndpoint} placeholder="https://my-agent.example.com/mcp/tools" onChange={(v) => onUpdateField("mcpEndpoint", v)} />
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <FieldGroup>
          <FieldLabel>Transport</FieldLabel>
          <Select value={formData.transport} onChange={(v) => onUpdateField("transport", v as AgentFormData["transport"])}>
            <option value="sse">SSE (Server-Sent Events)</option>
            <option value="stdio">Stdio</option>
            <option value="http">HTTP</option>
          </Select>
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>Max Payload (KB)</FieldLabel>
          <TextInput type="number" value={formData.maxPayloadKb} min="1" max="10000" onChange={(v) => onUpdateField("maxPayloadKb", v)} />
        </FieldGroup>
      </div>
      <FieldGroup>
        <FieldLabel>Protocol Support</FieldLabel>
        {(["a2a", "mcp", "rest"] as const).map((p) => (
          <Checkbox key={p} checked={formData.protocolSupport[p]} onChange={() => onUpdateField("protocolSupport", { ...formData.protocolSupport, [p]: !formData.protocolSupport[p] })}>
            {p.toUpperCase()}
          </Checkbox>
        ))}
      </FieldGroup>
      <div className="border-t border-[#1f2028] pt-4 mt-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Hiring Strategy (Outbound)</div>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup>
            <FieldLabel>Strategy</FieldLabel>
            <Select value={formData.hiringStrategy} onChange={(v) => onUpdateField("hiringStrategy", v as AgentFormData["hiringStrategy"])}>
              <option value="standard_first">Standard Match First</option>
              <option value="tag_first">Tag Match First</option>
              <option value="cost_first">Lowest Cost First</option>
            </Select>
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>Budget Cap / Hire (USD)</FieldLabel>
            <TextInput type="number" step="0.01" min="0" value={formData.budgetCapPerHire} onChange={(v) => onUpdateField("budgetCapPerHire", v)} />
          </FieldGroup>
        </div>
      </div>
    </FormSection>
  );
}

function Section3Form({ formData, onUpdateField, onToggleChecklist }: ChecklistFormProps) {
  return (
    <FormSection title="Auth Config">
      <FieldGroup>
        <FieldLabel>Auth Type</FieldLabel>
        <Select value={formData.authType} onChange={(v) => onUpdateField("authType", v as AgentFormData["authType"])}>
          <option value="none">None (open access)</option>
          <option value="bearer">Bearer Token</option>
          <option value="api_key">API Key</option>
          <option value="oauth2">OAuth 2.0</option>
        </Select>
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Min Trust Score (0 = open, 1 = max)</FieldLabel>
        <TextInput type="number" step="0.1" min="0" max="1" value={formData.minTrustScore} onChange={(v) => onUpdateField("minTrustScore", v)} />
        <div className="h-1 bg-[#1f2028] rounded mt-2 overflow-hidden">
          <div
            className="h-full rounded transition-all duration-300"
            style={{
              width: `${(parseFloat(formData.minTrustScore) || 0) * 100}%`,
              background: (parseFloat(formData.minTrustScore) || 0) > 0.7 ? "#22c55e" : (parseFloat(formData.minTrustScore) || 0) > 0.3 ? "#eab308" : "#ef4444",
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-1"><span>Open</span><span>Restrictive</span></div>
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Auth Notes</FieldLabel>
        <TextArea value={formData.authNotes} placeholder="Auth implementation notes..." rows={3} onChange={(v) => onUpdateField("authNotes", v)} />
      </FieldGroup>
      <div className="border-t border-[#1f2028] pt-4 mt-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Trust Integration Checklist</div>
        {formData.trustChecklist.map((item) => (
          <Checkbox key={item.id} checked={item.checked} onChange={() => onToggleChecklist("trustChecklist", item.id)} strikethrough>
            {item.label}
          </Checkbox>
        ))}
      </div>
    </FormSection>
  );
}

function Section4Form({ formData, onUpdateField, onToggleChecklist }: ChecklistFormProps) {
  return (
    <FormSection title="Core Logic">
      <FieldGroup>
        <FieldLabel>Notes</FieldLabel>
        <TextArea value={formData.coreLogicNotes} placeholder="Describe your internal tools, capability handlers, scheduler..." rows={4} onChange={(v) => onUpdateField("coreLogicNotes", v)} />
      </FieldGroup>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Implementation Checklist</div>
      {formData.coreLogicChecklist.map((item) => (
        <Checkbox key={item.id} checked={item.checked} onChange={() => onToggleChecklist("coreLogicChecklist", item.id)} strikethrough>
          {item.label}
        </Checkbox>
      ))}
    </FormSection>
  );
}

function Section5Form({ formData, onUpdateField, onAddCapability, onRemoveCapability, onUpdateCapability }: FormProps & {
  onAddCapability: () => void; onRemoveCapability: (id: string) => void; onUpdateCapability: (id: string, field: keyof Omit<CapabilityEntry, "id">, value: string) => void;
}) {
  return (
    <FormSection title="Capabilities">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-gray-500">{formData.capabilities.length} defined</span>
        <button onClick={onAddCapability} className="text-xs px-3 py-1 rounded bg-cyan-950/30 text-cyan-400 border border-cyan-900/50 hover:bg-cyan-950/50 transition-colors">
          + Add
        </button>
      </div>
      {formData.capabilities.length === 0 && (
        <p className="text-sm text-gray-600 italic mb-3">No capabilities defined yet. Click + Add to start.</p>
      )}
      {formData.capabilities.map((cap, idx) => (
        <div key={cap.id} className="bg-[#111118] rounded-lg p-3 mb-2 border border-[#1f2028]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-500">Capability {idx + 1}</span>
            <button onClick={() => onRemoveCapability(cap.id)} className="text-red-400 hover:text-red-300 text-sm">&times;</button>
          </div>
          <FieldGroup>
            <FieldLabel>ID</FieldLabel>
            <TextInput value={cap.name} placeholder="signalpot/my-capability@v1" onChange={(v) => onUpdateCapability(cap.id, "name", v)} />
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>Display Name</FieldLabel>
            <TextInput value={cap.displayName} placeholder="My Capability" onChange={(v) => onUpdateCapability(cap.id, "displayName", v)} />
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>Description</FieldLabel>
            <TextArea value={cap.description} placeholder="What does this capability do?" rows={2} onChange={(v) => onUpdateCapability(cap.id, "description", v)} />
          </FieldGroup>
        </div>
      ))}
      <div className="border-t border-[#1f2028] pt-4 mt-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">I/O Contracts</div>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup>
            <FieldLabel>Validation Mode</FieldLabel>
            <Select value={formData.validationMode} onChange={(v) => onUpdateField("validationMode", v as AgentFormData["validationMode"])}>
              <option value="strict">Strict (reject invalid)</option>
              <option value="lenient">Lenient (coerce types)</option>
            </Select>
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>Error Format</FieldLabel>
            <Select value={formData.errorFormat} onChange={(v) => onUpdateField("errorFormat", v as AgentFormData["errorFormat"])}>
              <option value="signalpot/error@v1">signalpot/error@v1</option>
              <option value="custom">Custom</option>
            </Select>
          </FieldGroup>
        </div>
      </div>
    </FormSection>
  );
}

function Section6Form({ formData, onUpdateField }: FormProps) {
  return (
    <FormSection title="Observability Config">
      <FieldGroup>
        <FieldLabel>Notes</FieldLabel>
        <TextArea value={formData.observabilityNotes} placeholder="Logging setup, custom metrics, dashboards..." rows={3} onChange={(v) => onUpdateField("observabilityNotes", v)} />
      </FieldGroup>
      <Checkbox checked={formData.loggingEnabled} onChange={() => onUpdateField("loggingEnabled", !formData.loggingEnabled)}>
        Platform logging enabled
      </Checkbox>
      <FieldGroup>
        <FieldLabel>Custom Metrics (comma-separated)</FieldLabel>
        <TextInput value={formData.customMetrics} placeholder="mentions_per_cycle, escalations" onChange={(v) => onUpdateField("customMetrics", v)} />
        {formData.customMetrics && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {formData.customMetrics.split(",").map((m) => m.trim()).filter(Boolean).map((metric, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded bg-cyan-950/30 text-cyan-400 border border-cyan-900/30">{metric}</span>
            ))}
          </div>
        )}
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <FieldGroup>
          <FieldLabel>Alert on Error Rate (%)</FieldLabel>
          <TextInput type="number" min="1" max="100" value={formData.alertOnErrorRate} onChange={(v) => onUpdateField("alertOnErrorRate", v)} />
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>Log Retention (days)</FieldLabel>
          <TextInput type="number" min="1" max="365" value={formData.logRetentionDays} onChange={(v) => onUpdateField("logRetentionDays", v)} />
        </FieldGroup>
      </div>
    </FormSection>
  );
}

function Section7Form({ formData, onUpdateField }: FormProps) {
  const rate = parseFloat(formData.rateAmount) || 0;
  const platformFee = Math.max(0.001, rate * 0.10);
  const reserve = rate * 0.02;
  return (
    <FormSection title="Billing Config">
      <FieldGroup>
        <FieldLabel>Rate Type</FieldLabel>
        <Select value={formData.rateType} onChange={(v) => onUpdateField("rateType", v as AgentFormData["rateType"])}>
          <option value="free">Free</option>
          <option value="per_call">Per Call</option>
          <option value="per_task">Per Task</option>
          <option value="per_hour">Per Hour</option>
          <option value="per_token">Per Token</option>
        </Select>
      </FieldGroup>
      {formData.rateType !== "free" && (
        <>
          <FieldGroup>
            <FieldLabel>Rate Amount (USD)</FieldLabel>
            <TextInput type="number" step="0.001" min="0.001" value={formData.rateAmount} onChange={(v) => onUpdateField("rateAmount", v)} />
            <p className="text-xs text-gray-600 mt-1">Minimum $0.001 per transaction</p>
          </FieldGroup>
          <div className="bg-[#111118] rounded-lg p-3 border border-[#1f2028] mb-4">
            <div className="text-xs text-gray-500 mb-2">Fee Breakdown</div>
            <div className="grid grid-cols-2 gap-1 text-sm text-gray-400">
              <span>Agent fee:</span><span className="text-right">${rate.toFixed(4)}</span>
              <span>Platform (10%):</span><span className="text-right">${platformFee.toFixed(4)}</span>
              <span>Reserve (2%):</span><span className="text-right">${reserve.toFixed(4)}</span>
              <span className="text-white font-medium border-t border-[#1f2028] pt-1">Caller pays:</span>
              <span className="text-right text-amber-400 font-medium border-t border-[#1f2028] pt-1">${(rate + platformFee + reserve).toFixed(4)}</span>
            </div>
          </div>
        </>
      )}
      <div className="border-t border-[#1f2028] pt-4 mt-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Free Tier</div>
        <Checkbox checked={formData.freeTierEnabled} onChange={() => onUpdateField("freeTierEnabled", !formData.freeTierEnabled)}>
          Enable free tier
        </Checkbox>
        {formData.freeTierEnabled && (
          <FieldGroup>
            <FieldLabel>Monthly Free Requests</FieldLabel>
            <TextInput type="number" min="0" max="10000" value={formData.freeTierMonthlyRequests} onChange={(v) => onUpdateField("freeTierMonthlyRequests", v)} />
          </FieldGroup>
        )}
      </div>
    </FormSection>
  );
}

function Section8Form({ formData, onUpdateField, onToggleChecklist }: ChecklistFormProps) {
  return (
    <FormSection title="Resilience Config">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <FieldGroup>
          <FieldLabel>Retry Policy</FieldLabel>
          <Select value={formData.retryPolicy} onChange={(v) => onUpdateField("retryPolicy", v as AgentFormData["retryPolicy"])}>
            <option value="exponential_backoff">Exponential Backoff</option>
            <option value="linear">Linear</option>
            <option value="none">No Retries</option>
          </Select>
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>Max Retries</FieldLabel>
          <TextInput type="number" min="0" max="10" value={formData.maxRetries} onChange={(v) => onUpdateField("maxRetries", v)} />
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>CB Threshold (%)</FieldLabel>
          <TextInput type="number" min="10" max="100" value={formData.circuitBreakerThreshold} onChange={(v) => onUpdateField("circuitBreakerThreshold", v)} />
        </FieldGroup>
      </div>
      <FieldGroup>
        <FieldLabel>Error Handling Notes</FieldLabel>
        <TextArea value={formData.errorHandlingNotes} placeholder="Error categories, fallback strategy..." rows={3} onChange={(v) => onUpdateField("errorHandlingNotes", v)} />
      </FieldGroup>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Implementation Checklist</div>
      {formData.errorHandlingChecklist.map((item) => (
        <Checkbox key={item.id} checked={item.checked} onChange={() => onToggleChecklist("errorHandlingChecklist", item.id)} strikethrough>
          {item.label}
        </Checkbox>
      ))}
    </FormSection>
  );
}

function Section9Form({ formData, onUpdateField, onToggleChecklist }: ChecklistFormProps) {
  return (
    <FormSection title="Deployment Config">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <FieldGroup>
          <FieldLabel>Deployment Target</FieldLabel>
          <Select value={formData.deploymentTarget} onChange={(v) => onUpdateField("deploymentTarget", v as AgentFormData["deploymentTarget"])}>
            <option value="vercel">Vercel</option>
            <option value="aws">AWS</option>
            <option value="gcp">Google Cloud</option>
            <option value="fly">Fly.io</option>
            <option value="railway">Railway</option>
            <option value="self_hosted">Self-Hosted</option>
          </Select>
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>Current Version</FieldLabel>
          <TextInput value={formData.currentVersion} placeholder="1.0.0" onChange={(v) => onUpdateField("currentVersion", v)} />
        </FieldGroup>
      </div>
      <FieldGroup>
        <FieldLabel>Health Endpoint</FieldLabel>
        <TextInput value={formData.healthEndpoint} placeholder="/health" onChange={(v) => onUpdateField("healthEndpoint", v)} />
        {formData.endpointUrl && formData.healthEndpoint && (
          <p className="text-xs text-cyan-400 mt-1">{formData.endpointUrl}{formData.healthEndpoint}</p>
        )}
      </FieldGroup>
      <FieldGroup>
        <FieldLabel>Deployment Notes</FieldLabel>
        <TextArea value={formData.deploymentNotes} placeholder="CI/CD pipeline, env vars, rollback plan..." rows={3} onChange={(v) => onUpdateField("deploymentNotes", v)} />
      </FieldGroup>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Deployment Checklist</div>
      {formData.deploymentChecklist.map((item) => (
        <Checkbox key={item.id} checked={item.checked} onChange={() => onToggleChecklist("deploymentChecklist", item.id)} strikethrough>
          {item.label}
        </Checkbox>
      ))}
    </FormSection>
  );
}

function Section10Form({ formData, onUpdateField, onToggleChecklist }: ChecklistFormProps) {
  return (
    <FormSection title="Testing">
      <FieldGroup>
        <FieldLabel>Notes</FieldLabel>
        <TextArea value={formData.testingNotes} placeholder="Test strategy, coverage targets..." rows={3} onChange={(v) => onUpdateField("testingNotes", v)} />
      </FieldGroup>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Testing Checklist</div>
      {formData.testingChecklist.map((item) => (
        <Checkbox key={item.id} checked={item.checked} onChange={() => onToggleChecklist("testingChecklist", item.id)} strikethrough>
          {item.label}
        </Checkbox>
      ))}
    </FormSection>
  );
}
