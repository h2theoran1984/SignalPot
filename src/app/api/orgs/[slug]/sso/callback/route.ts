import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHmac } from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { createRemoteJWKSet, jwtVerify } from "jose";

interface SsoConfig {
  enabled: boolean;
  provider: string;
  client_id: string;
  client_secret?: string;
  issuer_url: string;
  allowed_domains: string[];
  auto_provision: boolean;
  default_role: string;
}

interface StatePayload {
  org_id: string;
  slug: string;
  nonce: string;
  iat: number;
}

/**
 * Verify the HMAC-signed state parameter.
 * Returns the decoded payload or null if invalid.
 */
function getSsoStateSecret(): string {
  const dedicated = process.env.SSO_STATE_SECRET;
  if (dedicated) return dedicated;
  console.warn("[sso] SSO_STATE_SECRET not set — falling back to SUPABASE_SERVICE_ROLE_KEY. Set a dedicated secret for production.");
  return process.env.SUPABASE_SERVICE_ROLE_KEY!;
}

function verifyState(state: string): StatePayload | null {
  const secret = getSsoStateSecret();
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [data, signature] = parts;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");

  // Constant-time comparison
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

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

/**
 * Verify a JWT ID token using the provider's JWKS endpoint.
 * Fetches the public keys from the provider's jwks_uri and validates the signature.
 */
async function verifyIdToken(
  token: string,
  jwksUri: string,
  expectedIssuer: string,
  expectedAudience: string
): Promise<Record<string, unknown> | null> {
  try {
    const JWKS = createRemoteJWKSet(new URL(jwksUri));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: expectedIssuer,
      audience: expectedAudience,
    });
    return payload as Record<string, unknown>;
  } catch (err) {
    console.error("[sso] JWT verification failed:", err);
    return null;
  }
}

// GET /api/orgs/[slug]/sso/callback — OIDC callback handler
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Handle OIDC error responses
  if (errorParam) {
    const desc = url.searchParams.get("error_description") ?? "Authentication failed";
    console.error(`[sso] OIDC error for ${slug}: ${errorParam} - ${desc}`);
    return NextResponse.redirect(new URL(`/login?error=sso_failed`, url.origin));
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(new URL(`/login?error=sso_invalid_request`, url.origin));
  }

  // Verify state
  const state = verifyState(stateParam);
  if (!state) {
    return NextResponse.redirect(new URL(`/login?error=sso_invalid_state`, url.origin));
  }

  if (state.slug !== slug) {
    return NextResponse.redirect(new URL(`/login?error=sso_invalid_state`, url.origin));
  }

  const admin = createAdminClient();

  // Look up org and SSO config
  const { data: org } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("id", state.org_id)
    .single();

  if (!org) {
    return NextResponse.redirect(new URL(`/login?error=sso_org_not_found`, url.origin));
  }

  const ssoConfig = (org.settings as Record<string, unknown>)?.sso as SsoConfig | undefined;

  if (!ssoConfig?.enabled) {
    return NextResponse.redirect(new URL(`/login?error=sso_not_enabled`, url.origin));
  }

  // Fetch OIDC discovery document for token endpoint and JWKS URI
  const discoveryUrl = `${ssoConfig.issuer_url.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let discovery: { token_endpoint?: string; jwks_uri?: string; issuer?: string };
  try {
    const res = await fetch(discoveryUrl, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Discovery fetch failed: ${res.status}`);
    discovery = await res.json();
  } catch (err) {
    console.error("[sso] Failed to fetch OIDC discovery:", err);
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  if (!discovery.token_endpoint || !discovery.jwks_uri || !discovery.issuer) {
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  // Exchange authorization code for tokens
  const redirectUri = `${url.origin}/api/orgs/${slug}/sso/callback`;
  let tokenData: { id_token?: string; access_token?: string };
  try {
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: ssoConfig.client_id,
    };
    if (ssoConfig.client_secret) {
      tokenParams.client_secret = ssoConfig.client_secret;
    } else {
      console.warn("[sso] No client_secret configured for org", slug, "— token exchange may be rejected by strict providers");
    }
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[sso] Token exchange failed:", tokenRes.status, errBody);
      return NextResponse.redirect(new URL(`/login?error=sso_token_error`, url.origin));
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error("[sso] Token exchange error:", err);
    return NextResponse.redirect(new URL(`/login?error=sso_token_error`, url.origin));
  }

  if (!tokenData.id_token) {
    return NextResponse.redirect(new URL(`/login?error=sso_no_id_token`, url.origin));
  }

  // Verify the ID token signature against the provider's JWKS
  const claims = await verifyIdToken(
    tokenData.id_token,
    discovery.jwks_uri,
    discovery.issuer,
    ssoConfig.client_id
  );
  if (!claims) {
    return NextResponse.redirect(new URL(`/login?error=sso_invalid_token`, url.origin));
  }

  const email = claims.email as string | undefined;
  const name = (claims.name as string | undefined) ?? (claims.preferred_username as string | undefined);

  if (!email) {
    return NextResponse.redirect(new URL(`/login?error=sso_no_email`, url.origin));
  }

  // Verify email domain against allowed_domains
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain || !ssoConfig.allowed_domains.includes(emailDomain)) {
    return NextResponse.redirect(new URL(`/login?error=sso_domain_not_allowed`, url.origin));
  }

  // Look up or create the Supabase user
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
  } else {
    // Create a new user via Supabase admin API
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true, // SSO-verified email, mark as confirmed
      user_metadata: { full_name: name, sso_provider: ssoConfig.provider },
    });

    if (createErr || !newUser.user) {
      console.error("[sso] Failed to create user:", createErr);
      return NextResponse.redirect(new URL(`/login?error=sso_user_create_failed`, url.origin));
    }

    userId = newUser.user.id;
  }

  // Auto-provision: add user to org if not already a member
  if (ssoConfig.auto_provision) {
    const { data: existingMember } = await admin
      .from("org_members")
      .select("profile_id")
      .eq("org_id", org.id)
      .eq("profile_id", userId)
      .single();

    if (!existingMember) {
      const { error: memberErr } = await admin.from("org_members").insert({
        org_id: org.id,
        profile_id: userId,
        role: ssoConfig.default_role ?? "developer",
      });

      if (memberErr) {
        console.error("[sso] Failed to auto-provision member:", memberErr);
        // Don't fail the login — they can be added manually
      } else {
        logAuditEvent({
          orgId: org.id,
          actorId: userId,
          action: "org.member.sso_provisioned",
          targetType: "profile",
          targetId: userId,
          metadata: { provider: ssoConfig.provider, email, role: ssoConfig.default_role },
        });
      }
    }
  }

  // Generate a magic link / session for the user
  // Supabase admin.generateLink creates a one-time link that establishes a session
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${url.origin}/orgs/${slug}`,
    },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[sso] Failed to generate session link:", linkErr);
    return NextResponse.redirect(new URL(`/login?error=sso_session_failed`, url.origin));
  }

  logAuditEvent({
    orgId: org.id,
    actorId: userId,
    action: "org.sso.login",
    targetType: "profile",
    targetId: userId,
    metadata: { provider: ssoConfig.provider, email },
  });

  // Redirect through the magic link to establish the Supabase session
  return NextResponse.redirect(linkData.properties.action_link);
}
