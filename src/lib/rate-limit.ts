import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

// Per-API-key rate limiter (uses the key's configured RPM)
export async function checkApiKeyRateLimit(
  keyPrefix: string,
  limitRpm: number
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limitRpm, "1 m"),
    prefix: "sp:apikey",
  });

  const result = await limiter.limit(keyPrefix);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// Anonymous proxy rate limiter: 10 rpm per IP (stricter than general IP limit)
export async function checkAnonRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "sp:anon",
  });

  const result = await limiter.limit(ip);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// Per-agent global cap for anonymous calls: 100/hour regardless of IP count
// Prevents VPN swarm attacks on free agents
export async function checkAnonAgentRateLimit(
  agentSlug: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(100, "1 h"),
    prefix: "sp:anon-agent",
  });

  const result = await limiter.limit(agentSlug);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// Arena match creation: plan-tiered rate limit per user
export async function checkArenaRateLimit(
  profileId: string,
  limitPerHour: number = 5
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limitPerHour, "1 h"),
    prefix: "sp:arena",
  });

  const result = await limiter.limit(profileId);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// Org-level monthly quota: tracks total API calls per org per calendar month
export async function checkOrgMonthlyQuota(
  orgId: string,
  monthlyLimit: number
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  // Use a monthly key that resets each calendar month
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `sp:org-quota:${orgId}:${monthKey}`;

  // Increment and check
  const current = await r.incr(key);

  // Set TTL on first use (expire after 35 days to cover month boundary)
  if (current === 1) {
    await r.expire(key, 35 * 24 * 60 * 60);
  }

  // Calculate reset time (start of next month)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const reset = nextMonth.getTime();

  if (current > monthlyLimit) {
    // Over quota - decrement back since we pre-incremented
    await r.decr(key);
    return { success: false, remaining: 0, reset };
  }

  return { success: true, remaining: monthlyLimit - current, reset };
}

// Admin auth rate limiter: 10 attempts per minute per IP
export async function checkAdminAuthRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "sp:admin-auth",
  });

  const result = await limiter.limit(ip);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// KeyKeeper dispatch: 30 requests/min per IP — tight enough to block brute-force,
// loose enough for legitimate agent bursts
export async function checkDispatchRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "sp:kk-dispatch",
  });

  const result = await limiter.limit(ip);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

// Global IP-based rate limiter for unauthenticated endpoints
export async function checkIpRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: false, remaining: 0, reset: Date.now() + 60_000 };

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(120, "1 m"),
    prefix: "sp:ip",
  });

  const result = await limiter.limit(ip);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}
