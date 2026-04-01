// E2E Decryption — decrypts JWE payloads using the agent's private key.

import { compactDecrypt, importJWK } from "jose";

const ALGORITHM = "ECDH-ES+A256KW";

/**
 * Decrypt a JWE compact serialization string using a private key.
 * Returns the plaintext JSON payload.
 */
export async function decryptPayload(
  jwe: string,
  privateKeyJwk: JsonWebKey
): Promise<Record<string, unknown>> {
  const privateKey = await importJWK(privateKeyJwk, ALGORITHM);
  const { plaintext } = await compactDecrypt(jwe, privateKey);
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}
