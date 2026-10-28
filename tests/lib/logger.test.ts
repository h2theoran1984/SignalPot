import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/logger";

describe("log", () => {
  const spies = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };

  beforeEach(() => {
    spies.log.mockClear();
    spies.warn.mockClear();
    spies.error.mockClear();
  });

  afterEach(() => vi.mocked(console.log).mockClear());

  function lastEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
    return JSON.parse(spy.mock.calls.at(-1)![0] as string);
  }

  it("emits single-line JSON with level, time and msg", () => {
    log.info("agent_registered", { slug: "my-agent" });
    const entry = lastEntry(spies.log);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("agent_registered");
    expect(entry.slug).toBe("my-agent");
    expect(typeof entry.time).toBe("string");
  });

  it("routes warn to console.warn and error to console.error", () => {
    log.warn("w");
    log.error("e");
    expect(lastEntry(spies.warn).level).toBe("warn");
    expect(lastEntry(spies.error).level).toBe("error");
  });

  it("marks critical entries with alert:true on stderr", () => {
    log.critical("audit_write_failed");
    const entry = lastEntry(spies.error);
    expect(entry.level).toBe("critical");
    expect(entry.alert).toBe(true);
  });

  it("serializes Error values in context", () => {
    log.error("boom", { err: new Error("kaput") });
    const entry = lastEntry(spies.error) as { err: { message: string; stack?: string } };
    expect(entry.err.message).toBe("kaput");
    expect(entry.err.stack).toBeDefined();
  });

  it("nests scopes with dot notation", () => {
    log.scope("billing").scope("webhook").info("received");
    expect(lastEntry(spies.log).scope).toBe("billing.webhook");
  });
});
