export const PLAN_LIMITS = {
  free: 60,
  pro: 600,
  team: 3000,
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getRpmForPlan(plan: Plan): number {
  return PLAN_LIMITS[plan];
}

export const PLAN_PRICES: Record<Exclude<Plan, 'free'>, number> = {
  pro: 9,
  team: 49,
};

export const AGENT_LIMITS = {
  free: 5,
  pro: 25,
  team: 100,
} as const;

export function getAgentLimitForPlan(plan: Plan): number {
  return AGENT_LIMITS[plan];
}

/** Arena matches per hour, by plan tier. */
export const ARENA_LIMITS = {
  free: 5,
  pro: 25,
  team: 100,
} as const;

export function getArenaLimitForPlan(plan: Plan): number {
  return ARENA_LIMITS[plan];
}

/** Monthly API call quotas per org plan tier. */
export const ORG_MONTHLY_QUOTAS: Record<string, number> = {
  free: 1_000,
  pro: 50_000,
  team: 500_000,
};
