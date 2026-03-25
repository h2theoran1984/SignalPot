import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validations";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next") ?? "/dashboard");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const separator = next.includes("?") ? "&" : "?";
      return NextResponse.redirect(`${origin}${next}${separator}event=sign_up`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
