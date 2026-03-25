import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validations";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next") ?? "/dashboard");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const isNewUser =
        Date.now() - new Date(data.user.created_at).getTime() < 60_000;
      const separator = next.includes("?") ? "&" : "?";
      const eventParam = isNewUser ? `${separator}event=sign_up` : "";
      return NextResponse.redirect(`${origin}${next}${eventParam}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
