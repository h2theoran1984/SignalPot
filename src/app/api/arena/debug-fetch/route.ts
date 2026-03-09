import { NextResponse } from "next/server";

/**
 * GET /api/arena/debug-fetch — Temporary diagnostic endpoint.
 * Tests fetch from this Vercel deployment → external agent,
 * to debug why arena engine can't reach agents.
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET() {
  const target = "https://signalpot-agent-text-analyzer.vercel.app/a2a/rpc";
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `debug-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: { text: "Meeting: Quick test. Alice: Ship it. Bob: Done." } }],
          },
          metadata: {
            capability_used: "signalpot/meeting-summary@v1",
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const durationMs = Date.now() - startTime;

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return NextResponse.json({
      success: true,
      status: res.status,
      durationMs,
      responsePreview: text.slice(0, 500),
      parsedOk: json !== null,
      headers: Object.fromEntries(res.headers.entries()),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return NextResponse.json({
      success: false,
      durationMs,
      error: err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error",
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    });
  }
}
