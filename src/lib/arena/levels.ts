// Arena Leveling System — 4-level progression for the house agent.
// Higher levels use smarter models, better prompts, and stricter judging.
// Agents unlock levels by reaching per-capability ELO thresholds.

export type ArenaLevel = 1 | 2 | 3 | 4;

export const ARENA_LEVELS = [1, 2, 3, 4] as const;

export interface LevelConfig {
  level: ArenaLevel;
  label: string;
  description: string;
  model: string;
  maxTokens: number;
  eloThreshold: number;
  promptStyle: "basic" | "enhanced" | "master" | "boss";
  rubricStrictness: number;   // quality criteria weight multiplier
  speedTierScale: number;     // lower = tighter speed thresholds
}

export const LEVEL_CONFIGS: Record<ArenaLevel, LevelConfig> = {
  1: {
    level: 1,
    label: "Level 1",
    description: "Standard difficulty. Haiku model with basic prompts.",
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    eloThreshold: 0,
    promptStyle: "basic",
    rubricStrictness: 1.0,
    speedTierScale: 1.0,
  },
  2: {
    level: 2,
    label: "Level 2",
    description: "Enhanced difficulty. Sonnet model with chain-of-thought prompts and stricter judging.",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    eloThreshold: 1300,
    promptStyle: "enhanced",
    rubricStrictness: 1.3,
    speedTierScale: 0.75,
  },
  3: {
    level: 3,
    label: "Level 3",
    description: "Master difficulty. Opus model with multi-step reasoning and strictest judging.",
    model: "claude-opus-4-20250514",
    maxTokens: 4096,
    eloThreshold: 1500,
    promptStyle: "master",
    rubricStrictness: 1.6,
    speedTierScale: 0.5,
  },
  4: {
    level: 4,
    label: "Final Boss",
    description: "Final Boss. Opus with adversarial prompts, edge-case exploitation, and zero-tolerance judging.",
    model: "claude-opus-4-20250514",
    maxTokens: 8192,
    eloThreshold: 1700,
    promptStyle: "boss",
    rubricStrictness: 2.0,
    speedTierScale: 0.35,
  },
};

export const DEFAULT_LEVEL: ArenaLevel = 1;

/** Get the highest level an agent qualifies for at the given ELO. */
export function getLevelForElo(elo: number): ArenaLevel {
  if (elo >= LEVEL_CONFIGS[4].eloThreshold) return 4;
  if (elo >= LEVEL_CONFIGS[3].eloThreshold) return 3;
  if (elo >= LEVEL_CONFIGS[2].eloThreshold) return 2;
  return 1;
}

/** Check whether a given ELO qualifies for the requested level. */
export function isLevelUnlocked(elo: number, level: ArenaLevel): boolean {
  return elo >= LEVEL_CONFIGS[level].eloThreshold;
}

/** Return all levels the agent has unlocked at the given ELO. */
export function getUnlockedLevels(elo: number): ArenaLevel[] {
  return ARENA_LEVELS.filter((l) => isLevelUnlocked(elo, l));
}
