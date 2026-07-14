import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyState } from "@/lib/sso-state";
import { assertSafeUrl } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/env";
import { log } from "@/lib/logger";

const ssoLog = log.scope("sso.callback");

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
    ssoLog.error("jwt_verification_failed", { err });
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
    ssoLog.error("oidc_error_response", { slug, oidcError: errorParam, description: desc });
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
    ssoLog.error("unsafe_discovery_url_blocked", { err, slug });
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  let discovery: { token_endpoint?: string; jwks_uri?: string; issuer?: string };
  try {
    const res = await fetch(discoveryUrl, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Discovery fetch failed: ${res.status}`);
    discovery = await res.json();
  } catch (err) {
    ssoLog.error("oidc_discovery_fetch_failed", { err, slug });
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  if (!discovery.token_endpoint || !discovery.jwks_uri || !discovery.issuer) {
    return NextResponse.redirect(new URL(`/login?error=sso_provider_error`, url.origin));
  }

  try {
    await assertSafeUrl(discovery.token_endpoint);
    await assertSafeUrl(discovery.jwks_uri);
  } catch (err) {
    ssoLog.error("unsafe_token_or_jwks_url_blocked", { err, slug });
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
      // Token exchange may be rejected by strict providers without a client_secret
      ssoLog.warn("no_client_secret_configured", { slug });
    }
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      ssoLog.error("token_exchange_failed", { status: tokenRes.status, body: errBody, slug });
      return NextResponse.redirect(new URL(`/login?error=sso_token_error`, url.origin));
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    ssoLog.error("token_exchange_error", { err, slug });
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
    ssoLog.error("nonce_mismatch", { slug });
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
    ssoLog.error("email_not_verified_by_idp", { email, slug });
    return NextResponse.redirect(new URL(`/login?error=sso_email_not_verified`, url.origin));
  }

  // Verify email domain against allowed_domains (normalize both sides — legacy configs may have mixed case)
  const emailDomain = email.split("@")[1]?.toLowerCase();
  const allowedDomains = ssoConfig.allowed_domains.map((d) => d.trim().toLowerCase());
  if (!emailDomain || !allowedDomains.includes(emailDomain)) {
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
      ssoLog.error("user_create_failed", { err: createErr, slug });
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
        // Don't fail the login — they can be added manually
        ssoLog.error("member_autoprovision_failed", { err: memberErr, slug });
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
    ssoLog.error("session_link_generation_failed", { err: linkErr, slug });
    return NextResponse.redirect(new URL(`/login?error=sso_session_failed`, url.origin));
  }

  // Extract the OTP token hash from the magic link and verify it server-side
  const actionUrl = new URL(linkData.properties.action_link);
  const tokenHash = actionUrl.searchParams.get("token_hash") ?? actionUrl.hash?.replace("#", "");
  const otpType = (actionUrl.searchParams.get("type") ?? "magiclink") as "magiclink";

  if (!tokenHash) {
    ssoLog.error("magic_link_missing_token_hash", { slug });
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
    ssoLog.error("otp_verification_failed", { err: verifyErr, slug });
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
