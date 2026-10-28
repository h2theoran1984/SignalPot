import { describe, it, expect } from "vitest";
import {
  ssoConfigSchema,
  createAgentSchema,
  proxyCallSchema,
  mergeConstraints,
  escapeIlike,
  safeRedirectPath,
  stripSensitiveAgentFields,
} from "@/lib/validations";

describe("ssoConfigSchema", () => {
  const base = {
    provider: "okta" as const,
    client_id: "client-123",
    issuer_url: "https://idp.example.com",
    allowed_domains: ["example.com"],
  };

  it("accepts a valid config", () => {
    const parsed = ssoConfigSchema.parse(base);
    expect(parsed.allowed_domains).toEqual(["example.com"]);
    expect(parsed.default_role).toBe("developer");
  });

  it("normalizes mixed-case and padded domains to lowercase", () => {
    const parsed = ssoConfigSchema.parse({
      ...base,
      allowed_domains: ["  Company.COM ", "Sub.Example.ORG"],
    });
    expect(parsed.allowed_domains).toEqual(["company.com", "sub.example.org"]);
  });

  it("rejects strings that are not domains", () => {
    expect(() =>
      ssoConfigSchema.parse({ ...base, allowed_domains: ["not a domain"] })
    ).toThrow();
  });

  it("requires at least one allowed domain", () => {
    expect(() =>
      ssoConfigSchema.parse({ ...base, allowed_domains: [] })
    ).toThrow();
  });

  it("rejects non-HTTPS issuer URLs", () => {
    expect(() =>
      ssoConfigSchema.parse({ ...base, issuer_url: "http://idp.example.com" })
    ).toThrow();
  });
});

describe("safeRedirectPath", () => {
  it("passes through normal relative paths", () => {
    expect(safeRedirectPath("/agents/my-agent?tab=jobs")).toBe(
      "/agents/my-agent?tab=jobs"
    );
  });

  it.each([
    "//evil.com/phish", // protocol-relative
    "https://evil.com", // absolute URL
    "/\\evil.com", // backslash trick
    "\\evil.com", // no leading slash
    "javascript:alert(1)", // protocol
  ])("falls back to /dashboard for %s", (path) => {
    expect(safeRedirectPath(path)).toBe("/dashboard");
  });
});

describe("escapeIlike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeIlike("50%_off\\now")).toBe("50\\%\\_off\\\\now");
  });

  it("leaves normal text untouched", () => {
    expect(escapeIlike("hello world")).toBe("hello world");
  });
});

describe("mergeConstraints", () => {
  it("returns undefined when neither side has constraints", () => {
    expect(mergeConstraints(undefined, undefined)).toBeUndefined();
  });

  it("takes the stricter (higher) min_trust", () => {
    const merged = mergeConstraints({ min_trust: 0.3 }, { min_trust: 0.7 });
    expect(merged?.min_trust).toBe(0.7);
  });

  it("takes the stricter (lower) max_cost when both set", () => {
    const merged = mergeConstraints({ max_cost: 5 }, { max_cost: 2 });
    expect(merged?.max_cost).toBe(2);
  });

  it("preserves a one-sided max_cost", () => {
    expect(mergeConstraints({ max_cost: 5 }, {})?.max_cost).toBe(5);
    expect(mergeConstraints({}, { max_cost: 3 })?.max_cost).toBe(3);
  });

  it("unions and dedupes tags and blocked agents", () => {
    const merged = mergeConstraints(
      { required_tags: ["a", "b"], blocked_agents: ["x"] },
      { required_tags: ["b", "c"], blocked_agents: ["x", "y"] }
    );
    expect(merged?.required_tags).toEqual(["a", "b", "c"]);
    expect(merged?.blocked_agents).toEqual(["x", "y"]);
  });
});

describe("stripSensitiveAgentFields", () => {
  const agent = { id: "1", owner_id: "owner-1", auth_config: { secret: "s" } };

  it("strips auth_config for non-owners", () => {
    const safe = stripSensitiveAgentFields(agent, "someone-else");
    expect(safe.auth_config).toBeUndefined();
    expect(safe.id).toBe("1");
  });

  it("strips auth_config for anonymous callers", () => {
    expect(stripSensitiveAgentFields(agent, undefined).auth_config).toBeUndefined();
  });

  it("keeps auth_config for the owner", () => {
    expect(stripSensitiveAgentFields(agent, "owner-1").auth_config).toEqual({
      secret: "s",
    });
  });
});

describe("createAgentSchema", () => {
  const base = { name: "My Agent", slug: "my-agent" };

  it("accepts a minimal valid agent", () => {
    const parsed = createAgentSchema.parse(base);
    expect(parsed.visibility).toBe("public");
    expect(parsed.rate_type).toBe("per_call");
  });

  it.each(["Bad_Slug", "-leading", "trailing-", "ab", "UPPER"])(
    "rejects invalid slug %s",
    (slug) => {
      expect(() => createAgentSchema.parse({ ...base, slug })).toThrow();
    }
  );

  it("rejects non-HTTPS mcp_endpoint", () => {
    expect(() =>
      createAgentSchema.parse({ ...base, mcp_endpoint: "http://agent.example.com" })
    ).toThrow();
  });

  it("rejects a suite agent with a parent", () => {
    expect(() =>
      createAgentSchema.parse({
        ...base,
        listing_type: "suite",
        parent_agent_id: "8f2a2b1e-9d1c-4a8e-b0d3-1f2e3c4d5a6b",
      })
    ).toThrow(/Suite agents cannot have a parent/);
  });
});

describe("proxyCallSchema", () => {
  const base = {
    capability: "signalpot/meeting-summary@v1",
    idempotency_key: "idem-key-12345",
  };

  it("accepts a normal payload", () => {
    expect(() =>
      proxyCallSchema.parse({ ...base, input: { text: "hello" } })
    ).not.toThrow();
  });

  it("rejects idempotency keys shorter than 8 chars", () => {
    expect(() =>
      proxyCallSchema.parse({ ...base, idempotency_key: "short", input: {} })
    ).toThrow();
  });

  it("rejects inputs over 10KB", () => {
    expect(() =>
      proxyCallSchema.parse({ ...base, input: { data: "x".repeat(11_000) } })
    ).toThrow(/too large/);
  });

  it("gives E2E-encrypted payloads base64 headroom up to 14KB", () => {
    expect(() =>
      proxyCallSchema.parse({
        ...base,
        input: { _e2e: true, payload: "x".repeat(11_000) },
      })
    ).not.toThrow();
  });
});
