/**
 * ELO projection utility — calculate projected rating changes
 * for both outcomes before a match runs.
 *
 * Uses the same K=32, 400-point scale as elo.ts.
 */

const K_FACTOR = 32;

/**
 * Calculate projected ELO changes for both outcomes before a match runs.
 * Returns the delta (positive for win, negative for loss) for each agent.
 */
export function projectEloStakes(
  ratingA: number,
  ratingB: number,
  kFactor: number = K_FACTOR
): {
  agentA: { ifWin: number; ifLose: number };
  agentB: { ifWin: number; ifLose: number };
} {
  // Expected scores (same formula as calculateElo in elo.ts)
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  // If A wins: scoreA=1, scoreB=0
  const deltaA_ifWin = Math.round(kFactor * (1 - expectedA));
  const deltaB_ifLose = Math.round(kFactor * (0 - expectedB));

  // If B wins: scoreA=0, scoreB=1
  const deltaA_ifLose = Math.round(kFactor * (0 - expectedA));
  const deltaB_ifWin = Math.round(kFactor * (1 - expectedB));

  return {
    agentA: { ifWin: deltaA_ifWin, ifLose: deltaA_ifLose },
    agentB: { ifWin: deltaB_ifWin, ifLose: deltaB_ifLose },
  };
}
