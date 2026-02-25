import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-keys";
import { createApiKeySchema } from "@/lib/validations";

// GET /api/keys — List current user's API keys (session auth only)
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, scopes, rate_limit_rpm, last_used_at, expires_at, revoked, created_at")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch API keys" },
      { status: 500 }
    );
  }

  return NextResponse.json({ keys: data ?? [] });
}

// POST /api/keys — Generate a new API key (session auth only)
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = createApiKeySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Limit to 10 keys per user
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .eq("revoked", false);

  if (count !== null && count >= 10) {
    return NextResponse.json(
      { error: "API key limit reached (max 10 active keys)" },
      { status: 429 }
    );
  }

  const { key, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      profile_id: user.id,
      name: result.data.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: result.data.scopes,
      rate_limit_rpm: result.data.rate_limit_rpm,
    })
    .select("id, name, key_prefix, scopes, rate_limit_rpm, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 }
    );
  }

  // Return the full key ONCE — it cannot be retrieved again
  return NextResponse.json(
    { ...data, key },
    { status: 201 }
  );
}
