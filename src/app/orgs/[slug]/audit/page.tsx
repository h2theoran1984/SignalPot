"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";

interface AuditEvent {
  id: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export default function OrgAuditPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  async function loadEvents(p: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${slug}/audit?page=${p}&limit=25`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setEvents(data.events ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents(1);
  }, [slug]);

  const totalPages = Math.ceil(total / 25);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <a
            href={`/orgs/${slug}`}
            className="text-sm text-gray-500 hover:text-white transition-colors"
          >
            Back to org
          </a>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-gray-500">No audit events yet.</p>
        ) : (
          <>
            <div className="space-y-1">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded-lg text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-cyan-400 text-xs">{event.action}</span>
                    {event.target_type && (
                      <span className="text-gray-600 text-xs">
                        {event.target_type}
                        {event.target_id && `:${event.target_id.slice(0, 8)}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-600">
                    {event.ip_address && event.ip_address !== "unknown" && (
                      <span className="font-mono">{event.ip_address}</span>
                    )}
                    <span>{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => loadEvents(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm text-gray-400 border border-[#1f2028] rounded hover:text-white disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => loadEvents(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm text-gray-400 border border-[#1f2028] rounded hover:text-white disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
