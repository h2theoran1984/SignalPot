"use client";

import { useEffect, useState, useCallback } from "react";

interface Draft {
  id: string;
  title: string;
  slug: string;
  description: string;
  tags: string[];
  content?: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  published_at: string | null;
}

export default function BlogDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const fetchDrafts = useCallback(async () => {
    const res = await fetch("/api/blog/drafts");
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  async function selectDraft(id: string) {
    const res = await fetch(`/api/blog/drafts/${id}`);
    if (res.ok) {
      const data = await res.json();
      setSelected(data.draft);
    }
  }

  async function handleAction(id: string, action: "approve" | "reject") {
    if (
      action === "approve" &&
      !confirm("Publish this post? It will go live after Vercel deploys.")
    )
      return;

    setActing(true);
    const res = await fetch(`/api/blog/drafts/${id}/${action}`, {
      method: "POST",
    });

    if (res.ok) {
      setSelected(null);
      fetchDrafts();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
    setActing(false);
  }

  const pending = drafts.filter((d) => d.status === "draft");
  const processed = drafts.filter((d) => d.status !== "draft");

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold">Blog Drafts</h1>
        <p className="mb-8 text-neutral-400">
          AI-generated drafts awaiting your review. Approve to publish, reject
          to discard.
        </p>

        {loading ? (
          <p className="text-neutral-500">Loading...</p>
        ) : selected ? (
          /* ── Full draft preview ── */
          <div>
            <button
              onClick={() => setSelected(null)}
              className="mb-6 text-sm text-blue-400 hover:text-blue-300"
            >
              &larr; Back to list
            </button>

            <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">{selected.title}</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    {selected.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                    selected.status === "draft"
                      ? "bg-yellow-900/50 text-yellow-400"
                      : selected.status === "published"
                        ? "bg-green-900/50 text-green-400"
                        : "bg-red-900/50 text-red-400"
                  }`}
                >
                  {selected.status}
                </span>
              </div>

              {/* Raw MDX preview */}
              <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-4 text-sm leading-relaxed text-neutral-300">
                {selected.content}
              </pre>
            </div>

            {selected.status === "draft" && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleAction(selected.id, "approve")}
                  disabled={acting}
                  className="rounded-lg bg-green-600 px-6 py-2.5 font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
                >
                  {acting ? "Publishing..." : "Approve & Publish"}
                </button>
                <button
                  onClick={() => handleAction(selected.id, "reject")}
                  disabled={acting}
                  className="rounded-lg bg-red-600/20 px-6 py-2.5 font-medium text-red-400 transition hover:bg-red-600/30 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Draft list ── */
          <div>
            {pending.length === 0 && (
              <p className="mb-8 text-neutral-500">
                No pending drafts. The next one generates weekdays at 9 AM ET.
              </p>
            )}

            {pending.length > 0 && (
              <div className="mb-10">
                <h2 className="mb-4 text-lg font-semibold text-yellow-400">
                  Pending Review ({pending.length})
                </h2>
                <div className="space-y-3">
                  {pending.map((d) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      onClick={() => selectDraft(d.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {processed.length > 0 && (
              <div>
                <h2 className="mb-4 text-lg font-semibold text-neutral-500">
                  History
                </h2>
                <div className="space-y-3">
                  {processed.map((d) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      onClick={() => selectDraft(d.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  onClick,
}: {
  draft: Draft;
  onClick: () => void;
}) {
  const date = new Date(draft.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-700 hover:bg-neutral-800/50"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{draft.title}</h3>
          <p className="mt-0.5 truncate text-sm text-neutral-400">
            {draft.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-neutral-500">{date}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              draft.status === "draft"
                ? "bg-yellow-900/50 text-yellow-400"
                : draft.status === "published"
                  ? "bg-green-900/50 text-green-400"
                  : "bg-red-900/50 text-red-400"
            }`}
          >
            {draft.status}
          </span>
        </div>
      </div>
    </button>
  );
}
