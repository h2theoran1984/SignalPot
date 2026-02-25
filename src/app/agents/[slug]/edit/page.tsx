import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import EditAgentForm from "./EditAgentForm";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .eq("owner_id", user.id)
    .single();

  if (!agent) {
    notFound();
  }

  return <EditAgentForm agent={agent} />;
}
