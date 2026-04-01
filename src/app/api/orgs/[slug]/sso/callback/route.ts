import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyState } from "@/lib/sso-state";
import { assertSafeUrl } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/env";

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
  try {
    await assertSafeUrl(discoveryUrl);
  } catch (err) {
    console.error("[sso] Blocked unsafe discovery URL:", err);
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

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

  try {
    await assertSafeUrl(discovery.token_endpoint);
    await assertSafeUrl(discovery.jwks_uri);
  } catch (err) {
    console.error("[sso] Blocked unsafe token/JWKS URL:", err);
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  // Exchange authorization code for tokens
  const redirectUri = `${getAppOrigin(request.url)}/api/orgs/${slug}/sso/callback`;
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

  // Validate nonce — prevents token replay attacks
  if (claims.nonce !== state.nonce) {
    console.error("[sso] Nonce mismatch: ID token nonce does not match state nonce");
    return NextResponse.redirect(new URL(`/login?error=sso_nonce_mismatch`, url.origin));
  }

  const email = claims.email as string | undefined;
  const emailVerified = claims.email_verified as boolean | undefined;
  const name = (claims.name as string | undefined) ?? (claims.preferred_username as string | undefined);

  if (!email) {
    return NextResponse.redirect(new URL(`/login?error=sso_no_email`, url.origin));
  }

  // Require verified email from the IdP to prevent account takeover
  if (emailVerified === false) {
    console.error("[sso] Email not verified by IdP:", email);
    return NextResponse.redirect(new URL(`/login?error=sso_email_not_verified`, url.origin));
  }

  // Verify email domain against allowed_domains
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (!emailDomain || !ssoConfig.allowed_domains.includes(emailDomain)) {
    return NextResponse.redirect(new URL(`/login?error=sso_domain_not_allowed`, url.origin));
  }

  // Look up existing user by email via RPC (avoids fetching all users)
  const { data: existingUserId } = await admin.rpc("lookup_auth_user_by_email", {
    p_email: email,
  });

  let userId: string;

  if (existingUserId) {
    userId = existingUserId as string;
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

  // Generate a magic link, then exchange it server-side to set session cookies
  // without ever exposing the token in browser history or Referer headers.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${getAppOrigin(request.url)}/orgs/${slug}`,
    },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[sso] Failed to generate session link:", linkErr);
    return NextResponse.redirect(new URL(`/login?error=sso_session_failed`, url.origin));
  }

  // Extract the OTP token hash from the magic link and verify it server-side
  const actionUrl = new URL(linkData.properties.action_link);
  const tokenHash = actionUrl.searchParams.get("token_hash") ?? actionUrl.hash?.replace("#", "");
  const otpType = (actionUrl.searchParams.get("type") ?? "magiclink") as "magiclink";

  if (!tokenHash) {
    console.error("[sso] No token_hash in generated magic link");
    return NextResponse.redirect(new URL(`/login?error=sso_session_failed`, url.origin));
  }

  // Exchange the OTP server-side — this sets the session cookies without
  // ever sending the magic link token through the browser
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType,
  });

  if (verifyErr) {
    console.error("[sso] Server-side OTP verification failed:", verifyErr.message);
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

  // Session cookies are set — redirect to the org page
  return NextResponse.redirect(new URL(`/orgs/${slug}`, getAppOrigin(request.url)));
}
