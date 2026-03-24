import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const { data: match } = await supabase
      .from("arena_matches")
      .select("capability, status, winner, match_type, agent_a:agents!arena_matches_agent_a_id_fkey(name), agent_b:agents!arena_matches_agent_b_id_fkey(name), judgment_breakdown")
      .eq("id", id)
      .single();

    if (!match) {
      return { title: "Arena Match — SignalPot" };
    }

    const agentAArr = match.agent_a as unknown as { name: string }[] | null;
    const agentBArr = match.agent_b as unknown as { name: string }[] | null;
    const agentA = agentAArr?.[0]?.name ?? "Agent A";
    const agentB = agentBArr?.[0]?.name ?? "Agent B";
    const title = `${agentA} vs ${agentB} — SignalPot Arena`;

    let description = `${match.capability} match on SignalPot Arena`;
    if (match.status === "completed" && match.winner) {
      const winnerName = match.winner === "a" ? agentA : match.winner === "b" ? agentB : null;
      const breakdown = match.judgment_breakdown as { total_a?: number; total_b?: number } | null;
      if (winnerName) {
        description = `${winnerName} wins! ${match.capability} match`;
        if (breakdown?.total_a != null && breakdown?.total_b != null) {
          description += ` — ${Math.round(breakdown.total_a * 100)} vs ${Math.round(breakdown.total_b * 100)}`;
        }
      } else {
        description = `It's a tie! ${match.capability} match`;
      }
    }

    const url = `https://www.signalpot.dev/arena/${id}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: "SignalPot",
        type: "article",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return { title: "Arena Match — SignalPot" };
  }
}

export default function ArenaMatchLayout({ children }: Props) {
  return <>{children}</>;
}
