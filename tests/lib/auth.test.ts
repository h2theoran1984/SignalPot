import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyApiKeyMock, checkIpRateLimitMock, checkApiKeyRateLimitMock, createClientMock } =
  vi.hoisted(() => ({
    verifyApiKeyMock: vi.fn(),
    checkIpRateLimitMock: vi.fn(),
    checkApiKeyRateLimitMock: vi.fn(),
    createClientMock: vi.fn(),
  }));

vi.mock("@/lib/api-keys", () => ({ verifyApiKey: verifyApiKeyMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkIpRateLimit: checkIpRateLimitMock,
  checkApiKeyRateLimit: checkApiKeyRateLimitMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

import {
  getAuthContext,
  hasScope,
  rateLimitResponse,
  checkPublicRateLimit,
  type AuthContext,
} from "@/lib/auth";

describe("hasScope", () => {
  const auth = { scopes: ["agents:read", "jobs:write"] } as AuthContext;

  it("returns true for a granted scope", () => {
    expect(hasScope(auth, "jobs:write")).toBe(true);
  });

  it("returns false for a missing scope", () => {
    expect(hasScope(auth, "agents:write")).toBe(false);
  });
});

describe("rateLimitResponse", () => {
  it("returns 429 with a Retry-After header", () => {
    const res = rateLimitResponse(Date.now() + 30_000);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(29);
    expect(retryAfter).toBeLessThanOrEqual(31);
  });

  it("clamps Retry-After to at least 1 second even if reset is in the past", () => {
    const res = rateLimitResponse(Date.now() - 5_000);
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});

describe("checkPublicRateLimit", () => {
  beforeEach(() => {
    checkIpRateLimitMock.mockReset();
  });

  it("uses the LAST x-forwarded-for entry (first is spoofable)", async () => {
    checkIpRateLimitMock.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
    const req = new Request("http://test.local/api", {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" },
    });
    await checkPublicRateLimit(req);
    expect(checkIpRateLimitMock).toHaveBeenCalledWith("203.0.113.7");
  });

  it("returns null when under the limit", async () => {
    checkIpRateLimitMock.mockResolvedValue({ success: true, remaining: 9, reset: 0 });
    const req = new Request("http://test.local/api");
    expect(await checkPublicRateLimit(req)).toBeNull();
  });

  it("returns a 429 response when over the limit", async () => {
    checkIpRateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 10_000,
    });
    const req = new Request("http://test.local/api");
    const res = await checkPublicRateLimit(req);
    expect(res?.status).toBe(429);
  });
});

describe("getAuthContext", () => {
  beforeEach(() => {
    verifyApiKeyMock.mockReset();
    checkApiKeyRateLimitMock.mockReset();
    createClientMock.mockReset();
  });

  it("returns null for an invalid API key", async () => {
    verifyApiKeyMock.mockResolvedValue(null);
    const req = new Request("http://test.local/api", {
      headers: { authorization: "Bearer sp_live_bogus" },
    });
    expect(await getAuthContext(req)).toBeNull();
  });

  it("returns null when the API key is rate limited", async () => {
    verifyApiKeyMock.mockResolvedValue({
      profileId: "p1",
      keyPrefix: "sp_live_abc",
      rateLimitRpm: 60,
      scopes: ["agents:read"],
      orgId: null,
    });
    checkApiKeyRateLimitMock.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    const req = new Request("http://test.local/api", {
      headers: { authorization: "Bearer sp_live_abc123" },
    });
    expect(await getAuthContext(req)).toBeNull();
  });

  it("returns an api_key context with the key's scopes", async () => {
    verifyApiKeyMock.mockResolvedValue({
      profileId: "p1",
      keyPrefix: "sp_live_abc",
      rateLimitRpm: 60,
      scopes: ["agents:read", "jobs:read"],
      orgId: null,
    });
    checkApiKeyRateLimitMock.mockResolvedValue({ success: true, remaining: 59, reset: 0 });
    const req = new Request("http://test.local/api", {
      headers: { authorization: "Bearer sp_live_abc123" },
    });
    const ctx = await getAuthContext(req);
    expect(ctx?.authMethod).toBe("api_key");
    expect(ctx?.profileId).toBe("p1");
    expect(ctx?.scopes).toEqual(["agents:read", "jobs:read"]);
    expect(ctx?.orgId).toBeNull();
  });

  it("returns null when there is no session and no API key", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    const req = new Request("http://test.local/api");
    expect(await getAuthContext(req)).toBeNull();
  });
});
