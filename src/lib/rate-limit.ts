import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { warnOnce } from "@/lib/env";

let redis: Redis | null = null;
type RateLimitResult = { success: boolean; remaining: number; reset: number };

function allowWithoutRedis(reason: string): RateLimitResult {
  warnOnce(
    `ratelimit-fail-open:${reason}`,
    `[infra] Rate limiting fail-open: ${reason}. Configure Upstash Redis to enforce limits.`
  );
  return {
    success: true,
    remaining: Number.MAX_SAFE_INTEGER,
    reset: Date.now() + 60_000,
  };
}

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
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limitRpm, "1 m"),
    prefix: "sp:apikey",
  });

  try {
    const result = await limiter.limit(keyPrefix);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for API key rate limit");
  }
}

// Anonymous proxy rate limiter: 10 rpm per IP (stricter than general IP limit)
export async function checkAnonRateLimit(
  ip: string
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "sp:anon",
  });

  try {
    const result = await limiter.limit(ip);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for anonymous rate limit");
  }
}

// Per-agent global cap for anonymous calls: 100/hour regardless of IP count
// Prevents VPN swarm attacks on free agents
export async function checkAnonAgentRateLimit(
  agentSlug: string
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(100, "1 h"),
    prefix: "sp:anon-agent",
  });

  try {
    const result = await limiter.limit(agentSlug);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis(
      "Upstash request failed for anonymous per-agent rate limit"
    );
  }
}

// Arena match creation: plan-tiered rate limit per user
export async function checkArenaRateLimit(
  profileId: string,
  limitPerHour: number = 5
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(limitPerHour, "1 h"),
    prefix: "sp:arena",
  });

  try {
    const result = await limiter.limit(profileId);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for arena rate limit");
  }
}

// Org-level monthly quota: tracks total API calls per org per calendar month
export async function checkOrgMonthlyQuota(
  orgId: string,
  monthlyLimit: number
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  // Use a monthly key that resets each calendar month
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `sp:org-quota:${orgId}:${monthKey}`;

  // Increment and check
  let current: number;
  try {
    current = await r.incr(key);
  } catch {
    return allowWithoutRedis("Upstash request failed for org monthly quota");
  }

  // Set TTL on first use (expire after 35 days to cover month boundary)
  if (current === 1) {
    try {
      await r.expire(key, 35 * 24 * 60 * 60);
    } catch {
      return allowWithoutRedis("Upstash TTL set failed for org monthly quota");
    }
  }

  // Calculate reset time (start of next month)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const reset = nextMonth.getTime();

  if (current > monthlyLimit) {
    // Over quota - decrement back since we pre-incremented
    try {
      await r.decr(key);
    } catch {
      // No-op: fail-open and avoid blocking paid traffic on cleanup failure.
      return allowWithoutRedis("Upstash decrement failed for org monthly quota");
    }
    return { success: false, remaining: 0, reset };
  }

  return { success: true, remaining: monthlyLimit - current, reset };
}

// Admin auth rate limiter: 10 attempts per minute per IP
export async function checkAdminAuthRateLimit(
  ip: string
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "sp:admin-auth",
  });

  try {
    const result = await limiter.limit(ip);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for admin auth rate limit");
  }
}

// KeyKeeper dispatch: 30 requests/min per IP — tight enough to block brute-force,
// loose enough for legitimate agent bursts
export async function checkDispatchRateLimit(
  ip: string
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "sp:kk-dispatch",
  });

  try {
    const result = await limiter.limit(ip);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for dispatch rate limit");
  }
}

// Global IP-based rate limiter for unauthenticated endpoints
export async function checkIpRateLimit(
  ip: string
): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r) return allowWithoutRedis("UPSTASH_REDIS_REST_URL/TOKEN missing");

  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(120, "1 m"),
    prefix: "sp:ip",
  });

  try {
    const result = await limiter.limit(ip);
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return allowWithoutRedis("Upstash request failed for IP rate limit");
  }
}
