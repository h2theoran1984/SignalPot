// E2E Encryption — encrypts payloads using JWE (RFC 7516).
// ECDH-ES+A256KW key agreement + A256GCM content encryption.

import { CompactEncrypt, importJWK } from "jose";

const ALGORITHM = "ECDH-ES+A256KW";
const ENCRYPTION = "A256GCM";

/**
 * Encrypt a JSON payload for a recipient agent using their public key.
 * Returns a JWE compact serialization string.
 */
export async function encryptPayload(
  plaintext: Record<string, unknown>,
  recipientPublicKeyJwk: JsonWebKey,
  kid: string
): Promise<string> {
  const publicKey = await importJWK(recipientPublicKeyJwk, ALGORITHM);
  const encoder = new TextEncoder();
  const payload = encoder.encode(JSON.stringify(plaintext));

  const jwe = await new CompactEncrypt(payload)
    .setProtectedHeader({
      alg: ALGORITHM,
      enc: ENCRYPTION,
      kid,
    })
    .encrypt(publicKey);

  return jwe;
}
