import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validations";
import { inngest } from "@/lib/inngest/client";

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

      if (isNewUser) {
        await inngest.send({
          name: "user/signed.up",
          data: {
            user_id: data.user.id,
            email: data.user.email ?? "",
            display_name:
              data.user.user_metadata?.full_name ??
              data.user.user_metadata?.user_name ??
              null,
          },
        });
      }

      const separator = next.includes("?") ? "&" : "?";
      const eventParam = isNewUser ? `${separator}event=sign_up` : "";
      return NextResponse.redirect(`${origin}${next}${eventParam}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
