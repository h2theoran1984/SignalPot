"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";

interface Member {
  profile_id: string;
  role: string;
  joined_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export default function OrgMembersPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  async function loadMembers() {
    try {
      const res = await fetch(`/api/orgs/${slug}/members`);
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, [slug]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);

    const res = await fetch(`/api/orgs/${slug}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });

    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error ?? "Failed to add member");
      return;
    }

    setInviteSuccess(`Added ${data.name ?? inviteEmail} as ${inviteRole}`);
    setInviteEmail("");
    loadMembers();
  }

  async function handleRemove(profileId: string) {
    if (!confirm("Remove this member from the organization?")) return;

    const res = await fetch(`/api/orgs/${slug}/members/${profileId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      loadMembers();
    }
  }

  async function handleRoleChange(profileId: string, newRole: string) {
    const res = await fetch(`/api/orgs/${slug}/members/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });

    if (res.ok) {
      loadMembers();
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Members</h1>
          <a
            href={`/orgs/${slug}`}
            className="text-sm text-gray-500 hover:text-white transition-colors"
          >
            Back to org
          </a>
        </div>

        {/* Invite form */}
        <form onSubmit={handleInvite} className="flex gap-2 mb-6">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="flex-1 px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/50"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-3 py-2 bg-[#111118] border border-[#1f2028] rounded-lg text-white text-sm focus:outline-none focus:border-cyan-400/50"
          >
            <option value="developer">Developer</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
            <option value="auditor">Auditor</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold"
          >
            Add
          </button>
        </form>

        {inviteError && (
          <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {inviteError}
          </div>
        )}
        {inviteSuccess && (
          <div className="text-green-400 text-sm bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2 mb-4">
            {inviteSuccess}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.profile_id}
                className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {m.avatar_url && (
                    <img src={m.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{m.full_name ?? m.email}</div>
                    {m.full_name && m.email && (
                      <div className="text-xs text-gray-600">{m.email}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.role === "owner" ? (
                    <span className="text-xs text-cyan-400 px-2 py-1 bg-cyan-400/10 rounded">
                      owner
                    </span>
                  ) : (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.profile_id, e.target.value)}
                        className="text-xs px-2 py-1 bg-[#0a0a0f] border border-[#1f2028] rounded text-gray-400 focus:outline-none"
                      >
                        <option value="admin">admin</option>
                        <option value="developer">developer</option>
                        <option value="viewer">viewer</option>
                        <option value="auditor">auditor</option>
                      </select>
                      <button
                        onClick={() => handleRemove(m.profile_id)}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
