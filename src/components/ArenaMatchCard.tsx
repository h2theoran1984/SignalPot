import { Badge } from "@/components/ui/badge";
import type { ArenaMatchStatus, ArenaMatchType } from "@/lib/arena/types";

interface ArenaMatchCardProps {
  match: {
    id: string;
    capability: string;
    status: ArenaMatchStatus;
    match_type?: ArenaMatchType;
    winner: string | null;
    votes_a: number;
    votes_b: number;
    votes_tie: number;
    duration_a_ms: number | null;
    duration_b_ms: number | null;
    created_at: string;
    level?: number | null;
    agent_a: { name: string; slug: string } | null;
    agent_b: { name: string; slug: string } | null;
  };
}

function statusLabel(status: ArenaMatchStatus): string {
  switch (status) {
    case "pending": return "Pending";
    case "running": return "Live";
    case "judging": return "Judging";
    case "voting": return "Voting";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}

export function ArenaMatchCard({ match }: ArenaMatchCardProps) {
  const agentAName = match.agent_a?.name ?? "Unknown";
  const agentBName = match.agent_b?.name ?? "Unknown";
  const isLive = match.status === "running";
  const isJudging = match.status === "judging";
  const isVoting = match.status === "voting";
  const isCompleted = match.status === "completed";
  const isChampionship = match.match_type === "championship";
  const totalVotes = match.votes_a + match.votes_b + match.votes_tie;

  return (
    <a
      href={`/arena/${match.id}`}
      className={`block p-5 bg-[#111118] border rounded-lg hover:border-[#2d3044] transition-colors group ${
        isChampionship ? "border-yellow-700/30" : "border-[#1f2028]"
      }`}
    >
      {/* Status + Capability */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isChampionship && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 rounded">
              CHAMP
            </span>
          )}
          <Badge variant="tag">{match.capability}</Badge>
          {match.level && match.level > 1 && (
            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
              match.level === 4
                ? "bg-red-950/70 text-yellow-300 border border-yellow-700/50"
                : match.level === 3
                  ? "bg-purple-900/50 text-purple-400 border border-purple-700/50"
                  : "bg-blue-900/50 text-blue-400 border border-blue-700/50"
            }`}>
              {match.level === 4 ? "BOSS" : `LVL ${match.level}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          )}
          {isJudging && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              JUDGING
            </span>
          )}
          <Badge variant="status" status={match.status === "judging" ? "running" : match.status as "pending" | "running" | "completed" | "failed"}>
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
