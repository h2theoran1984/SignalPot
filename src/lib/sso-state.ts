/**
 * Shared SSO state signing and verification.
 * Used by both the SSO login and callback routes.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface StatePayload {
  org_id: string;
  slug: string;
  nonce: string;
  iat: number;
}

/**
 * Get the dedicated SSO state secret.
 * Throws if SSO_STATE_SECRET is not configured — never falls back to service role key.
 */
function getSsoStateSecret(): string {
  const secret = process.env.SSO_STATE_SECRET;
  if (!secret) {
    throw new Error(
      "[sso] SSO_STATE_SECRET is not set. A dedicated secret is required for SSO — do not reuse SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return secret;
}

/**
 * Sign a state payload using HMAC-SHA256.
 */
export function signState(payload: Record<string, unknown>): string {
  const secret = getSsoStateSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/**
 * Verify an HMAC-signed state parameter.
 * Returns the decoded payload or null if invalid / expired.
 */
export function verifyState(state: string): StatePayload | null {
  const secret = getSsoStateSecret();
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");

  // Constant-time comparison using Node.js built-in
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));

    // Reject states older than 10 minutes
    const age = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);
    if (age > 600 || age < 0) return null;

    return payload as StatePayload;
  } catch {
    return null;
  }
}
