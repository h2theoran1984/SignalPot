import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { signState } from "@/lib/sso-state";

interface SsoConfig {
  enabled: boolean;
  provider: string;
  client_id: string;
  issuer_url: string;
  allowed_domains: string[];
  auto_provision: boolean;
  default_role: string;
}

// GET /api/orgs/[slug]/sso/login — Initiate SSO login flow (public)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();

  // Look up org and SSO config
  const { data: org } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const ssoConfig = (org.settings as Record<string, unknown>)?.sso as SsoConfig | undefined;

  if (!ssoConfig?.enabled) {
    return NextResponse.json({ error: "SSO is not enabled for this organization" }, { status: 400 });
  }

  // Fetch OIDC discovery document
  const discoveryUrl = `${ssoConfig.issuer_url.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let discovery: { authorization_endpoint?: string };
  try {
    const res = await fetch(discoveryUrl, { next: { revalidate: 3600 } });
    if (!res.ok) {
      throw new Error(`Discovery fetch failed: ${res.status}`);
    }
    discovery = await res.json();
  } catch (err) {
    console.error("[sso] Failed to fetch OIDC discovery document:", err);
    return NextResponse.json({ error: "Failed to reach identity provider" }, { status: 502 });
  }

  if (!discovery.authorization_endpoint) {
    return NextResponse.json({ error: "Invalid OIDC discovery document" }, { status: 502 });
  }

  // Build state parameter (signed JWT-like token with nonce)
  const nonce = randomUUID();
  const state = signState({
    org_id: org.id,
    slug,
    nonce,
    iat: Math.floor(Date.now() / 1000),
  });

  // Build the redirect URI based on request origin
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/orgs/${slug}/sso/callback`;

  // Build authorization URL
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set("client_id", ssoConfig.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);

  return NextResponse.redirect(authUrl.toString());
}
