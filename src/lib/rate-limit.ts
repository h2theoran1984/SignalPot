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
  if (!r) return { success: true, remaining: limitRpm, reset: 0 };

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
  if (!r) return { success: true, remaining: 10, reset: 0 };

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

// Global IP-based rate limiter for unauthenticated endpoints
export async function checkIpRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getRedis();
  if (!r) return { success: true, remaining: 120, reset: 0 };

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
