// E2E Middleware — auto-decrypt incoming requests and auto-encrypt responses
// for agents running on SignalPot's infrastructure.
//
// Used by the universal agent endpoint (/api/arena/custom/[slug]).
// Handles the _e2e envelope transparently so agent logic never sees crypto.

import { decryptPayload } from "./decrypt";
import { encryptPayload } from "./encrypt";
import { isE2EEncrypted, extractE2EEnvelope } from "./envelope";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Decrypt an incoming E2E-encrypted request payload.
 * Returns the plaintext input if encrypted, or the original input if not.
 */
export async function decryptRequest(
  input: Record<string, unknown>,
  agentSlug: string
): Promise<{ plaintext: Record<string, unknown>; wasEncrypted: boolean; senderKid: string | null; senderJwk: JsonWebKey | null }> {
  if (!isE2EEncrypted(input)) {
    return { plaintext: input, wasEncrypted: false, senderKid: null, senderJwk: null };
  }

  const envelope = extractE2EEnvelope(input);
  if (!envelope) {
    throw new Error("Invalid E2E envelope");
  }

  // Load the agent's private key from KeyKeeper
  const admin = createAdminClient();
  const { decryptSecret } = await import("@/lib/keykeeper/vault");

  // Find the private key matching the kid in the JWE header
  // The kid is in the JWE protected header — extract it
  const jweHeader = JSON.parse(
    Buffer.from(envelope.jwe.split(".")[0], "base64url").toString()
  );
  const kid = jweHeader.kid as string;

  // Look up which version this kid maps to
  const { data: keyRecord } = await admin
    .from("agent_e2e_keys")
    .select("agent_id, version")
    .eq("kid", kid)
    .in("status", ["active", "rotating"])
    .single();

  if (!keyRecord) {
    throw new Error(`No active key found for kid: ${kid}`);
  }

  // Get the agent slug to find the private key in KeyKeeper
  const { data: agent } = await admin
    .from("agents")
    .select("slug, owner_id")
    .eq("id", keyRecord.agent_id)
    .single();

  if (!agent) {
    throw new Error("Agent not found for key");
  }

  // Fetch private key from KeyKeeper
  const secretName = `e2e:${agent.slug}:private_key:v${keyRecord.version}`;
  const { data: secret } = await admin
    .from("keykeeper_secrets")
    .select("encrypted_value")
    .eq("owner_id", agent.owner_id)
    .eq("name", secretName)
    .single();

  if (!secret) {
    throw new Error(`Private key not found: ${secretName}`);
  }

  const privateKeyJwk = JSON.parse(
    decryptSecret(secret.encrypted_value as string)
  ) as JsonWebKey;

  const plaintext = await decryptPayload(envelope.jwe, privateKeyJwk);

  return {
    plaintext,
    wasEncrypted: true,
    senderKid: envelope.sender_kid ?? null,
    senderJwk: (envelope.sender_jwk as JsonWebKey) ?? null,
  };
}

/**
 * Encrypt a response payload back to the caller.
 * Only encrypts if the caller provided a public key (sender_kid or sender_jwk).
 * Skips encryption for Arena calls (source: "arena").
 */
export async function encryptResponse(
  output: Record<string, unknown>,
  senderKid: string | null,
  senderJwk: JsonWebKey | null,
  metadata?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Don't encrypt Arena responses — judge needs to read them
  if (metadata?.source === "arena") {
    return output;
  }

  // If caller provided an inline JWK, encrypt with that
  if (senderJwk) {
    const jwe = await encryptPayload(output, senderJwk, "ephemeral");
    return { _e2e: { jwe, version: 1 } };
  }

  // If caller provided a kid, look up their public key
  if (senderKid) {
    const admin = createAdminClient();
    const { data: callerKey } = await admin
      .from("agent_e2e_keys")
      .select("public_key_jwk")
      .eq("kid", senderKid)
      .eq("status", "active")
      .single();

    if (callerKey) {
      const jwe = await encryptPayload(
        output,
        callerKey.public_key_jwk as JsonWebKey,
        senderKid
      );
      return { _e2e: { jwe, version: 1 } };
    }
  }

  // No caller key — return cleartext
  return output;
}
