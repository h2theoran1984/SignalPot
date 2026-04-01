import { createHmac, timingSafeEqual } from "crypto";

function getCallbackSecret(): string {
  const secret =
    process.env.ARENA_CALLBACK_SECRET ??
    process.env.INTERNAL_DISPATCH_KEY ??
    process.env.ARENA_ADMIN_SECRET;

  if (!secret) {
    throw new Error(
      "[arena-callback] Missing callback secret. Set ARENA_CALLBACK_SECRET (preferred), INTERNAL_DISPATCH_KEY, or ARENA_ADMIN_SECRET."
    );
  }

  return secret;
}

function buildPayload(matchId: string, side: "a" | "b", jobId: string): string {
  return `${matchId}:${side}:${jobId}`;
}

export function signCallbackToken(
  matchId: string,
  side: "a" | "b",
  jobId: string
): string {
  const secret = getCallbackSecret();
  const payload = buildPayload(matchId, side, jobId);
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyCallbackToken(
  matchId: string,
  side: "a" | "b",
  jobId: string,
  token: string | null
): boolean {
  if (!token) return false;

  try {
    const expected = signCallbackToken(matchId, side, jobId);
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    if (tokenBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(tokenBuf, expectedBuf);
  } catch {
    return false;
  }
}
