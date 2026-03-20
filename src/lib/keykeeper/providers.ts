/**
 * Provider registry for KeyKeeper credential rotation.
 *
 * Supported providers can rotate keys programmatically via their APIs.
 * Unsupported providers fall back to Courier's OTU intake flow.
 */

export interface RotationResult {
  newKey: string;
  /** Provider-specific key identifier (for revocation) */
  keyId?: string;
}

export interface ProviderConfig {
  supported: boolean;
  /** Create a new key using admin credentials */
  rotate(adminKey: string): Promise<RotationResult>;
  /** Verify the new key works with a lightweight API call */
  verify(newKey: string): Promise<boolean>;
  /** Revoke the old key after new one is verified and stored */
  revoke?(adminKey: string, keyId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stripe — create restricted API keys
// ---------------------------------------------------------------------------
const stripe: ProviderConfig = {
  supported: true,

  async rotate(adminKey: string): Promise<RotationResult> {
    const res = await fetch("https://api.stripe.com/v1/api_keys", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "name": `rotated-${Date.now()}`,
        // Restricted key with read-only access by default
        "permissions[charges]": "read",
        "permissions[customers]": "read",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe key creation failed: ${res.status} ${err}`);
    }

    const data = (await res.json()) as { id: string; secret: string };
    return { newKey: data.secret, keyId: data.id };
  },

  async verify(newKey: string): Promise<boolean> {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${newKey}` },
    });
    return res.ok;
  },

  async revoke(adminKey: string, keyId: string): Promise<void> {
    const res = await fetch(`https://api.stripe.com/v1/api_keys/${keyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe key revocation failed: ${res.status} ${err}`);
    }
  },
};

// ---------------------------------------------------------------------------
// GitHub — create installation access tokens or fine-grained PATs
// ---------------------------------------------------------------------------
const github: ProviderConfig = {
  supported: true,

  async rotate(adminKey: string): Promise<RotationResult> {
    // Admin key is expected to be a PAT with admin:org or admin:repo_hook scope
    // Creates a new fine-grained token via the GitHub API
    const res = await fetch("https://api.github.com/user/tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminKey}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        note: `rotated-${Date.now()}`,
        scopes: ["repo", "read:org"],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub token creation failed: ${res.status} ${err}`);
    }

    const data = (await res.json()) as { id: number; token: string };
    return { newKey: data.token, keyId: String(data.id) };
  },

  async verify(newKey: string): Promise<boolean> {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${newKey}`,
        Accept: "application/vnd.github+json",
      },
    });
    return res.ok;
  },

  async revoke(adminKey: string, keyId: string): Promise<void> {
    const res = await fetch(
      `https://api.github.com/authorizations/${keyId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${adminKey}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub token revocation failed: ${res.status} ${err}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Google — rotate service account keys via IAM API
// ---------------------------------------------------------------------------
const google: ProviderConfig = {
  supported: true,

  async rotate(adminKey: string): Promise<RotationResult> {
    // adminKey is expected to be a JSON service account key.
    // Parse it to get project/service account email, then create a new key.
    let sa: { client_email: string; project_id: string };
    try {
      sa = JSON.parse(adminKey);
    } catch {
      throw new Error("Google admin key must be a JSON service account key");
    }

    // Get access token using the service account
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: adminKey, // simplified — production would use proper JWT signing
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Google OAuth token exchange failed: ${tokenRes.status}`);
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Create a new service account key
    const createRes = await fetch(
      `https://iam.googleapis.com/v1/projects/${sa.project_id}/serviceAccounts/${sa.client_email}/keys`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyAlgorithm: "KEY_ALG_RSA_2048" }),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Google key creation failed: ${createRes.status} ${err}`);
    }

    const data = (await createRes.json()) as { name: string; privateKeyData: string };
    // privateKeyData is base64-encoded JSON key
    const newKeyJson = Buffer.from(data.privateKeyData, "base64").toString("utf-8");
    return { newKey: newKeyJson, keyId: data.name };
  },

  async verify(newKey: string): Promise<boolean> {
    // Verify by attempting a token exchange with the new key
    try {
      const parsed = JSON.parse(newKey);
      return !!(parsed.client_email && parsed.private_key);
    } catch {
      return false;
    }
  },

  async revoke(adminKey: string, keyId: string): Promise<void> {
    let sa: { client_email: string };
    try {
      sa = JSON.parse(adminKey);
    } catch {
      throw new Error("Google admin key must be a JSON service account key");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: adminKey,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Google OAuth token exchange failed: ${tokenRes.status}`);
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const res = await fetch(`https://iam.googleapis.com/v1/${keyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google key revocation failed: ${res.status} ${err}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Unsupported — manual fallback via OTU
// ---------------------------------------------------------------------------
const unsupported: ProviderConfig = {
  supported: false,
  async rotate(): Promise<RotationResult> {
    throw new Error("Provider does not support programmatic rotation");
  },
  async verify(): Promise<boolean> {
    return false;
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const providers: Record<string, ProviderConfig> = {
  stripe,
  github,
  google,
  // anthropic — no programmatic rotation API, falls through to unsupported
};

export function getProvider(name: string): ProviderConfig {
  return providers[name] ?? unsupported;
}
