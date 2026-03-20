import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Get the encryption key from env. Must be 32 bytes hex-encoded (64 chars).
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.KEYKEEPER_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("Missing KEYKEEPER_ENCRYPTION_KEY environment variable");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "KEYKEEPER_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"
    );
  }
  return key;
}

/**
 * Encrypt a plaintext secret. Returns "iv:authTag:ciphertext" (all base64).
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored secret. Input format: "iv:authTag:ciphertext" (all base64).
 */
export function decryptSecret(stored: string): string {
  const key = getEncryptionKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid auth tag length");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Store an encrypted secret. Upserts on (owner_id, name).
 */
export async function storeSecret(
  admin: SupabaseClient,
  ownerId: string,
  name: string,
  value: string,
  provider: "openai" | "stripe" | "github" | "anthropic" | "google" | "other",
  rotationDays = 90
): Promise<void> {
  const encrypted = encryptSecret(value);

  const { error } = await admin.from("keykeeper_secrets").upsert(
    {
      owner_id: ownerId,
      name,
      encrypted_value: encrypted,
      provider,
      rotation_days: rotationDays,
      last_rotated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,name" }
  );

  if (error) {
    throw new Error(`Failed to store secret: ${error.message}`);
  }
}

/**
 * Read and decrypt a secret. Returns null if not found.
 * The decrypted value is only held in memory — never log or return it.
 */
export async function readSecret(
  admin: SupabaseClient,
  ownerId: string,
  name: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("keykeeper_secrets")
    .select("encrypted_value")
    .eq("owner_id", ownerId)
    .eq("name", name)
    .single();

  if (error || !data) return null;

  return decryptSecret(data.encrypted_value);
}

/**
 * Delete a secret by owner and name.
 */
export async function deleteSecret(
  admin: SupabaseClient,
  ownerId: string,
  name: string
): Promise<void> {
  const { error } = await admin
    .from("keykeeper_secrets")
    .delete()
    .eq("owner_id", ownerId)
    .eq("name", name);

  if (error) {
    throw new Error(`Failed to delete secret: ${error.message}`);
  }
}
