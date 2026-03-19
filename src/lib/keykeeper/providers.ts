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
};

export function getProvider(name: string): ProviderConfig {
  return providers[name] ?? unsupported;
}
