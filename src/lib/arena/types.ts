// Arena types — Agent-vs-Agent competition system

export type ArenaMatchStatus = "pending" | "running" | "judging" | "voting" | "completed" | "failed";
export type ArenaMatchType = "undercard" | "championship";
export type ArenaVoteChoice = "a" | "b" | "tie";
export type ArenaWinner = "a" | "b" | "tie";

export interface ArenaChallenge {
  id: string;
  title: string;
  description: string;
  capability: string;
  prompt: Record<string, unknown>;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  featured: boolean;
  featured_week: string | null;
  created_at: string;
}

export interface ArenaMatch {
  id: string;
  creator_id: string;
  agent_a_id: string;
  agent_b_id: string;
  challenge_id: string | null;
  capability: string;
  prompt: Record<string, unknown>;
  prompt_text: string | null;
  job_a_id: string | null;
  job_b_id: string | null;
  response_a: Record<string, unknown> | null;
  response_b: Record<string, unknown> | null;
  duration_a_ms: number | null;
  duration_b_ms: number | null;
  verified_a: boolean | null;
  verified_b: boolean | null;
  status: ArenaMatchStatus;
  winner: ArenaWinner | null;
  votes_a: number;
  votes_b: number;
  votes_tie: number;
  voting_ends_at: string | null;
  cost_a: number;
  cost_b: number;
  match_type: ArenaMatchType;
  judgment_reasoning: string | null;
  judgment_confidence: number | null;
  judgment_source: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ArenaVote {
  id: string;
  match_id: string;
  voter_id: string;
  vote: ArenaVoteChoice;
  created_at: string;
}

export interface ArenaRating {
  id: string;
  agent_id: string;
  capability: string;
  elo: number;
  matches_played: number;
  wins: number;
  losses: number;
  ties: number;
  updated_at: string;
}

// Arena judgment from The Arbiter (undercard matches)
export interface ArenaJudgment {
  winner: "a" | "b" | "tie";
  reasoning: string;
  confidence: number;
  source: "arbiter" | "fallback";
}

// Joined types for API responses
export interface ArenaMatchWithAgents extends ArenaMatch {
  agent_a: { name: string; slug: string; description: string | null };
  agent_b: { name: string; slug: string; description: string | null };
}

// SSE event types for live match streaming
export type ArenaStreamEvent =
  | { type: "match_started"; match_id: string; started_at: string }
  | { type: "agent_status"; side: "a" | "b"; status: "running" | "completed" | "failed"; duration_ms?: number }
  | { type: "agent_response"; side: "a" | "b"; response: Record<string, unknown>; duration_ms: number; verified: boolean }
  | { type: "voting_open"; voting_ends_at: string }
  | { type: "match_completed"; winner: ArenaWinner | null; votes_a: number; votes_b: number; votes_tie: number }
  | { type: "match_failed"; error: string }
  | { type: "judging_started"; match_id: string }
  | { type: "judgment_rendered"; winner: string; reasoning: string; confidence: number }
  | { type: "heartbeat"; timestamp: string };
