"use client";

import { useMemo, useState } from "react";

type AuditIntakeFormProps = {
  packageName: string;
  initialIntent: string;
};

export default function AuditIntakeForm({ packageName, initialIntent }: AuditIntakeFormProps) {
  const [name, setName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [company, setCompany] = useState("");
  const [timeline, setTimeline] = useState("This month");
  const [risk, setRisk] = useState("Agent reliability in production");
  const [notes, setNotes] = useState("");

  const subject = `${packageName} inquiry`;

  const body = useMemo(() => {
    const lines = [
      `Intent: ${initialIntent || "general"}`,
      `Package: ${packageName}`,
      `Name: ${name || "(not provided)"}`,
      `Work email: ${workEmail || "(not provided)"}`,
      `Company: ${company || "(not provided)"}`,
      `Timeline: ${timeline}`,
      `Primary risk concern: ${risk}`,
      "",
      "Context:",
      notes || "(add deployment details, stack, and business impact here)",
    ];
    return lines.join("\n");
  }, [company, initialIntent, name, notes, packageName, risk, timeline, workEmail]);

  function openEmailDraft() {
    const url = `mailto:support@signalpot.dev?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  return (
    <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8">
      <p className="text-xs tracking-[0.2em] uppercase text-cyan-300 mb-3">Sales Contact</p>
      <h1 className="text-3xl font-bold mb-3">Let&apos;s scope your {packageName.toLowerCase()}.</h1>
      <p className="text-gray-300 mb-6">
        Share a few details and we will draft the fastest path to stabilize and grow revenue safely.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
        />
        <input
          type="email"
          value={workEmail}
          onChange={(e) => setWorkEmail(e.target.value)}
          placeholder="Work email"
          className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company"
          className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
        />
        <select
          value={timeline}
          onChange={(e) => setTimeline(e.target.value)}
          className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-400/50 transition-colors"
        >
          <option>This week</option>
          <option>This month</option>
          <option>Next quarter</option>
        </select>
      </div>

      <div className="mb-3">
        <select
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-400/50 transition-colors"
        >
          <option>Agent reliability in production</option>
          <option>Auth and tenant boundary risk</option>
          <option>Revenue leakage in job/credit flow</option>
          <option>General launch readiness</option>
        </select>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={6}
        placeholder="What is breaking today? Include your stack, current blockers, and what this is costing."
        className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-400/50 transition-colors mb-6"
      />

      <div className="space-y-3 mb-8">
        <div className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Email</p>
          <p className="font-medium">support@signalpot.dev</p>
        </div>
        <div className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Subject</p>
          <p className="font-medium">{subject}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={openEmailDraft}
          className="px-6 py-3 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors cursor-pointer"
        >
          Open Pre-Filled Email
        </button>
        <a
          href="/audit"
          className="px-6 py-3 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
        >
          Back to Audit Details
        </a>
      </div>
    </section>
  );
}
