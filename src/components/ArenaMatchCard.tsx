import { Badge } from "@/components/ui/badge";
import type { ArenaMatchStatus } from "@/lib/arena/types";

interface ArenaMatchCardProps {
  match: {
    id: string;
    capability: string;
    status: ArenaMatchStatus;
    winner: string | null;
    votes_a: number;
    votes_b: number;
    votes_tie: number;
    duration_a_ms: number | null;
    duration_b_ms: number | null;
    created_at: string;
    agent_a: { name: string; slug: string } | null;
    agent_b: { name: string; slug: string } | null;
  };
}

function statusLabel(status: ArenaMatchStatus): string {
  switch (status) {
    case "pending": return "Pending";
    case "running": return "Live";
    case "voting": return "Voting";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}

export function ArenaMatchCard({ match }: ArenaMatchCardProps) {
  const agentAName = match.agent_a?.name ?? "Unknown";
  const agentBName = match.agent_b?.name ?? "Unknown";
  const isLive = match.status === "running";
  const isVoting = match.status === "voting";
  const isCompleted = match.status === "completed";
  const totalVotes = match.votes_a + match.votes_b + match.votes_tie;

  return (
    <a
      href={`/arena/${match.id}`}
      className="block p-5 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group"
    >
      {/* Status + Capability */}
      <div className="flex items-center justify-between mb-3">
        <Badge variant="tag">{match.capability}</Badge>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          )}
          <Badge variant="status" status={match.status as "pending" | "running" | "completed" | "failed"}>
            {statusLabel(match.status)}
          </Badge>
        </div>
      </div>

      {/* Agent A vs Agent B */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 text-right">
          <p className={`font-semibold text-sm truncate ${isCompleted && match.winner === "a" ? "text-cyan-400" : "text-white"}`}>
            {agentAName}
          </p>
        </div>
        <span className="text-xs text-gray-600 font-bold tracking-wider shrink-0">VS</span>
        <div className="flex-1">
          <p className={`font-semibold text-sm truncate ${isCompleted && match.winner === "b" ? "text-cyan-400" : "text-white"}`}>
            {agentBName}
          </p>
        </div>
      </div>

      {/* Vote counts or duration */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        {(isVoting || isCompleted) && totalVotes > 0 ? (
          <span>{totalVotes} vote{totalVotes !== 1 ? "s" : ""}</span>
        ) : (
          <span>&nbsp;</span>
        )}
        {isCompleted && match.winner && (
          <span className="text-cyan-400 font-medium">
            Winner: {match.winner === "a" ? agentAName : match.winner === "b" ? agentBName : "Tie"}
          </span>
        )}
        {isCompleted && match.winner === "tie" && (
          <span className="text-yellow-400 font-medium">Tie</span>
        )}
        <span className="text-gray-600">
          {new Date(match.created_at).toLocaleDateString()}
        </span>
      </div>
    </a>
  );
}
