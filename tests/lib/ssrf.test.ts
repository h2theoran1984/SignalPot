import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ lookup: lookupMock }));

import { assertSafeUrl } from "@/lib/ssrf";

describe("assertSafeUrl", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    // Neutralize the same-origin bypass unless a test opts in
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("blocked hostnames and literal private IPs", () => {
    it.each([
      "http://localhost:3000/mcp",
      "https://0.0.0.0/",
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://192.168.1.1/",
      "https://172.16.0.1/",
      "https://172.31.255.255/",
      "https://169.254.169.254/latest/meta-data/", // AWS metadata
    ])("rejects %s", async (url) => {
      await expect(assertSafeUrl(url)).rejects.toThrow();
      expect(lookupMock).not.toHaveBeenCalled();
    });

    it("allows 172.32.0.1 (just outside the private range)", async () => {
      await expect(assertSafeUrl("https://172.32.0.1/")).resolves.toBeUndefined();
    });
  });

  describe("cloud metadata hostnames", () => {
    it.each([
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://anything.internal/",
    ])("rejects %s", async (url) => {
      await expect(assertSafeUrl(url)).rejects.toThrow(/metadata/);
    });
  });

  describe("DNS rebinding", () => {
    it("rejects a public hostname that resolves to a private IP", async () => {
      lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
      await expect(assertSafeUrl("https://evil.example.com/")).rejects.toThrow(
        /private IP/
      );
    });

    it("rejects when any of multiple resolved addresses is private", async () => {
      lookupMock.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.0.10", family: 4 },
      ]);
      await expect(assertSafeUrl("https://evil.example.com/")).rejects.toThrow(
        /private IP/
      );
    });

    it("rejects IPv4-mapped IPv6 resolutions (::ffff:127.0.0.1)", async () => {
      lookupMock.mockResolvedValue([{ address: "::ffff:127.0.0.1", family: 6 }]);
      await expect(assertSafeUrl("https://evil.example.com/")).rejects.toThrow(
        /private IP/
      );
    });

    it("allows a hostname resolving to a public IP", async () => {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      await expect(assertSafeUrl("https://agent.example.com/mcp")).resolves.toBeUndefined();
      expect(lookupMock).toHaveBeenCalledWith("agent.example.com", { all: true });
    });
  });

  describe("fail-closed behavior", () => {
    it("rejects when DNS resolution fails", async () => {
      lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(assertSafeUrl("https://nonexistent.example.com/")).rejects.toThrow(
        /DNS resolution failed/
      );
    });
  });

  describe("HTTPS enforcement", () => {
    it("rejects plain http in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await expect(assertSafeUrl("http://agent.example.com/")).rejects.toThrow(
        /HTTPS/
      );
    });

    it("allows http outside production (local dev)", async () => {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      await expect(assertSafeUrl("http://agent.example.com/")).resolves.toBeUndefined();
    });
  });

  describe("same-origin bypass", () => {
    it("skips all checks for the platform's own hostname", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://signalpot.dev");
      await expect(
        assertSafeUrl("https://signalpot.dev/api/keykeeper/dispatch")
      ).resolves.toBeUndefined();
      expect(lookupMock).not.toHaveBeenCalled();
    });

    it("does not extend the bypass to other hostnames", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://signalpot.dev");
      lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
      await expect(assertSafeUrl("https://evil.example.com/")).rejects.toThrow();
    });
  });
});
