import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/keys/[id] — Revoke an API key
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id)
    .eq("profile_id", user.id); // ensure ownership

  if (error) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
