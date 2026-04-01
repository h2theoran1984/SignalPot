// E2E Envelope — the _e2e structure that wraps encrypted payloads.
// Used in both proxy input and output.

import { z } from "zod";

/**
 * The E2E envelope schema for encrypted payloads.
 * This replaces the normal `input` contents when encryption is active.
 */
export const e2eEnvelopeSchema = z.object({
  /** JWE compact serialization string */
  jwe: z.string().min(10),
  /** E2E protocol version */
  version: z.literal(1),
  /** Sender's key ID — if provided, response will be encrypted back */
  sender_kid: z.string().optional(),
  /** Sender's public key as inline JWK — for anonymous callers without registered keys */
  sender_jwk: z.record(z.string(), z.unknown()).optional(),
});

export type E2EEnvelope = z.infer<typeof e2eEnvelopeSchema>;

/**
 * Check if an input object contains an E2E envelope.
 */
export function isE2EEncrypted(input: Record<string, unknown>): boolean {
  return input._e2e != null && typeof input._e2e === "object";
}

/**
 * Extract the E2E envelope from an input object.
 * Returns null if not present or invalid.
 */
export function extractE2EEnvelope(input: Record<string, unknown>): E2EEnvelope | null {
  if (!isE2EEncrypted(input)) return null;

  const result = e2eEnvelopeSchema.safeParse(input._e2e);
  return result.success ? result.data : null;
}

/**
 * Wrap an encrypted JWE string into an E2E envelope for the response.
 */
export function wrapE2EResponse(
  jwe: string,
  version: number = 1
): { _e2e: E2EEnvelope } {
  return {
    _e2e: { jwe, version: version as 1 },
  };
}
