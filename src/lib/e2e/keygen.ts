// E2E Key Generation — creates P-256 keypairs for agent encryption.
// Public key goes on the agent card, private key goes in KeyKeeper.

import { generateKeyPair, exportJWK } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";

const ALGORITHM = "ECDH-ES+A256KW";
const CURVE = "P-256";

export interface E2EKeyPair {
  kid: string;
  version: number;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

/**
 * Generate a new P-256 keypair for an agent.
 */
export async function generateAgentKeyPair(
  agentSlug: string,
  version: number = 1
): Promise<E2EKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, {
    crv: CURVE,
    extractable: true,
  });

  const publicKeyJwk = await exportJWK(publicKey);
  const privateKeyJwk = await exportJWK(privateKey);

  const kid = `${agentSlug}-v${version}`;

  // Add kid to the JWKs
  publicKeyJwk.kid = kid;
  privateKeyJwk.kid = kid;

  return { kid, version, publicKeyJwk, privateKeyJwk };
}

/**
 * Enable E2E encryption for an agent.
 * Generates keypair, stores public key in agent_e2e_keys,
 * stores private key in keykeeper_secrets.
 */
export async function enableE2E(
  agentId: string,
  agentSlug: string,
  ownerId: string
): Promise<{ kid: string; version: number; publicKeyJwk: JsonWebKey }> {
  const admin = createAdminClient();

  // Check if agent already has an active key
  const { data: existingKey } = await admin
    .from("agent_e2e_keys")
    .select("id, version")
    .eq("agent_id", agentId)
    .eq("status", "active")
    .maybeSingle();

  const nextVersion = existingKey ? (existingKey.version as number) + 1 : 1;
  const keypair = await generateAgentKeyPair(agentSlug, nextVersion);

  // If rotating, mark old key as rotating
  if (existingKey) {
    await admin
      .from("agent_e2e_keys")
      .update({ status: "rotating" })
      .eq("id", existingKey.id);
  }

  // Store public key
  const { error: pubError } = await admin.from("agent_e2e_keys").insert({
    agent_id: agentId,
    kid: keypair.kid,
    version: keypair.version,
    public_key_jwk: keypair.publicKeyJwk,
    status: "active",
  });

  if (pubError) {
    throw new Error(`Failed to store public key: ${pubError.message}`);
  }

  // Store private key in KeyKeeper vault
  const { encryptSecret } = await import("@/lib/keykeeper/vault");
  const encryptedPrivateKey = encryptSecret(JSON.stringify(keypair.privateKeyJwk));

  const { error: privError } = await admin.from("keykeeper_secrets").insert({
    owner_id: ownerId,
    name: `e2e:${agentSlug}:private_key:v${keypair.version}`,
    provider: "other",
    encrypted_value: encryptedPrivateKey,
  });

  if (privError) {
    // Rollback public key
    await admin.from("agent_e2e_keys").delete().eq("kid", keypair.kid);
    throw new Error(`Failed to store private key: ${privError.message}`);
  }

  // Mark agent as E2E enabled
  await admin
    .from("agents")
    .update({ e2e_enabled: true })
    .eq("id", agentId);

  return {
    kid: keypair.kid,
    version: keypair.version,
    publicKeyJwk: keypair.publicKeyJwk,
  };
}

/**
 * Disable E2E encryption for an agent.
 * Revokes active keys and removes the E2E flag.
 */
export async function disableE2E(agentId: string): Promise<void> {
  const admin = createAdminClient();

  // Revoke all active/rotating keys
  await admin
    .from("agent_e2e_keys")
    .update({ status: "revoked", retired_at: new Date().toISOString() })
    .eq("agent_id", agentId)
    .in("status", ["active", "rotating"]);

  // Mark agent as E2E disabled
  await admin
    .from("agents")
    .update({ e2e_enabled: false })
    .eq("id", agentId);
}

/**
 * Get the active public key for an agent.
 */
export async function getAgentPublicKey(
  agentId: string
): Promise<{ kid: string; version: number; jwk: JsonWebKey; activatedAt: string } | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("agent_e2e_keys")
    .select("kid, version, public_key_jwk, activated_at")
    .eq("agent_id", agentId)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    kid: data.kid as string,
    version: data.version as number,
    jwk: data.public_key_jwk as JsonWebKey,
    activatedAt: data.activated_at as string,
  };
}
