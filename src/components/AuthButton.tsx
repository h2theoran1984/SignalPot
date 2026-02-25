"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export default function AuthButton() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  if (loading) return null;

  if (!user) {
    return (
      <a
        href="/login"
        className="px-4 py-2 text-sm bg-white text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
      >
        Sign In
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <a
        href="/dashboard"
        className="text-sm text-gray-300 hover:text-white transition-colors"
      >
        Dashboard
      </a>
      <button
        onClick={signOut}
        className="px-4 py-2 text-sm bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 border border-gray-700 transition-colors cursor-pointer"
      >
        Sign Out
      </button>
    </div>
  );
}
