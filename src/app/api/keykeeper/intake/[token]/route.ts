import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeSecret } from "@/lib/keykeeper/vault";
import { checkIpRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const intakeSchema = z.object({
  value: z.string().min(1).max(10_000),
});

/**
 * GET /api/keykeeper/intake/[token]
 * Renders a browser-friendly form for pasting a secret value.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return new NextResponse(renderPage("Invalid token", "", true), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const admin = createAdminClient();
  const { data: intake } = await admin
    .from("keykeeper_intake_tokens")
    .select("secret_name, provider, expires_at, used_at")
    .eq("token", token)
    .single();

  if (!intake) {
    return new NextResponse(renderPage("Token not found", "", true), {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (intake.used_at) {
    return new NextResponse(renderPage("This link has already been used", "", true), {
      status: 410,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (new Date(intake.expires_at) < new Date()) {
    return new NextResponse(renderPage("This link has expired", "", true), {
      status: 410,
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse(
    renderPage(
      `Submit credential: ${intake.secret_name}`,
      `<p style="color:#888;font-size:13px;margin-bottom:24px;">Provider: <strong style="color:#67e8f9;">${intake.provider}</strong> &middot; This link can only be used once.</p>
      <form id="intake-form">
        <label style="display:block;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Secret Value</label>
        <textarea id="secret-value" required rows="4" style="width:100%;padding:10px;background:#0a0a0f;border:1px solid #1f2028;border-radius:8px;color:#fff;font-family:monospace;font-size:14px;resize:vertical;" placeholder="sk-..."></textarea>
        <button type="submit" style="margin-top:16px;padding:10px 24px;background:#22d3ee;color:#0a0a0f;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">Submit</button>
        <p id="status" style="margin-top:12px;font-size:13px;"></p>
      </form>
      <script>
        document.getElementById("intake-form").addEventListener("submit", async (e) => {
          e.preventDefault();
          const btn = e.target.querySelector("button");
          const status = document.getElementById("status");
          btn.disabled = true;
          btn.textContent = "Submitting...";
          status.style.color = "#888";
          status.textContent = "";
          try {
            const res = await fetch(window.location.href, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value: document.getElementById("secret-value").value }),
            });
            const data = await res.json();
            if (res.ok) {
              status.style.color = "#4ade80";
              status.textContent = "Credential stored securely.";
              btn.textContent = "Done";
              document.getElementById("secret-value").value = "";
            } else {
              status.style.color = "#f87171";
              status.textContent = data.error || "Something went wrong.";
              btn.disabled = false;
              btn.textContent = "Submit";
            }
          } catch {
            status.style.color = "#f87171";
            status.textContent = "Network error.";
            btn.disabled = false;
            btn.textContent = "Submit";
          }
        });
      </script>`
    ),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function renderPage(title: string, body: string, isError = false) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeyKeeper Intake</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;font-family:-apple-system,system-ui,sans-serif;">
<div style="max-width:480px;width:100%;padding:32px;background:#111118;border:1px solid #1f2028;border-radius:12px;margin:16px;">
<h1 style="font-size:18px;color:${isError ? "#f87171" : "#fff"};margin:0 0 16px;">${title}</h1>
${body}
</div></body></html>`;
}

/**
 * POST /api/keykeeper/intake/[token]
 * Unauthenticated — accepts a secret value via one-time magic link token.
 * Encrypts and stores via vault, then invalidates the token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit by IP to prevent brute-force token guessing
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  const rateCheck = await checkIpRateLimit(ip);
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  // Validate token format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return NextResponse.json(
      { error: "Invalid token" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = intakeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "A non-empty 'value' field is required" },
      { status: 400 }
    );
  }

  const { value } = result.data;
  const admin = createAdminClient();

  // Fetch token — check exists, not used, not expired
  const { data: intake, error: fetchError } = await admin
    .from("keykeeper_intake_tokens")
    .select("token, owner_id, secret_name, provider, expires_at, used_at")
    .eq("token", token)
    .single();

  if (fetchError || !intake) {
    return NextResponse.json(
      { error: "Token not found" },
      { status: 404 }
    );
  }

  if (intake.used_at) {
    return NextResponse.json(
      { error: "Token has already been used" },
      { status: 410 }
    );
  }

  if (new Date(intake.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Token has expired" },
      { status: 410 }
    );
  }

  // Atomically mark token as used — prevents race conditions
  const { data: updated } = await admin
    .from("keykeeper_intake_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)
    .is("used_at", null)
    .select("token");

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "Token was already consumed" },
      { status: 409 }
    );
  }

  // Encrypt and store the secret
  try {
    await storeSecret(
      admin,
      intake.owner_id,
      intake.secret_name,
      value,
      intake.provider as "openai" | "stripe" | "github" | "anthropic" | "google" | "other"
    );
  } catch {
    // Roll back: unmark the token so the user can retry
    await admin
      .from("keykeeper_intake_tokens")
      .update({ used_at: null })
      .eq("token", token);

    return NextResponse.json(
      { error: "Failed to store secret" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
